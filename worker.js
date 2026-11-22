/**
 * DomainWatch RDAP and .im WHOIS lookup.
 *
 * The .im registry has no IANA-registered RDAP endpoint. Query its official
 * WHOIS server using Cloudflare's outbound TCP socket support instead.
 * This handler is shared by a standalone Worker and a Cloudflare Pages Function.
 */
import { connect } from 'cloudflare:sockets';

const JSON_TYPE = 'application/json; charset=utf-8';
const enc = new TextEncoder();

function response(body, status = 200, origin = '*', ttl = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': JSON_TYPE,
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Vary': 'Origin',
      'Cache-Control': ttl ? `public, max-age=${ttl}` : 'no-store',
    },
  });
}

function validDomain(domain) {
  return domain.length <= 253 && domain.includes('.') &&
    domain.split('.').every(s => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s));
}

function normalizedDate(raw, dayFirst = false) {
  if (!raw) return null;
  const value = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const m = dayFirst && value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function whoisField(text, names) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    for (const name of names) {
      const re = new RegExp('^\\s*' + name + '\\s*:?\\s*(\\d{1,2}\\/\\d{1,2}\\/\\d{4}|\\d{4}-\\d{2}-\\d{2})', 'i');
      const match = line.match(re);
      if (match) return normalizedDate(match[1], true);
    }
  }
  return null;
}

async function withTimeout(promise, ms) {
  let id;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { id = setTimeout(() => reject(new Error('WHOIS_TIMEOUT')), ms); }),
    ]);
  } finally {
    clearTimeout(id);
  }
}

async function lookupImWhois(domain) {
  // Fixed destination: not a general TCP proxy, and no user-controlled hosts.
  const socket = connect({ hostname: 'whois.nic.im', port: 43 }, { allowHalfOpen: true });
  const deadline = Date.now() + 13000;
  try {
    await withTimeout(socket.opened, 10000);
    const writer = socket.writable.getWriter();
    await withTimeout(writer.write(enc.encode(domain + '\r\n')), 7000);
    await withTimeout(writer.close(), 7000);

    const reader = socket.readable.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('WHOIS_TIMEOUT');
      const { value, done } = await withTimeout(reader.read(), remaining);
      if (done) break;
      bytes += value?.byteLength || 0;
      if (bytes > 65536) throw new Error('WHOIS_RESPONSE_TOO_LARGE');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    if (!text.trim()) throw new Error('WHOIS_EMPTY_RESPONSE');
    if (/(?:no match|not registered|no entries found|domain (?:does not exist|not found))/i.test(text)) {
      return { error: 'DOMAIN_NOT_FOUND', source: 'WHOIS', status: 404 };
    }
    const registrationDate = whoisField(text, ['Registration Date', 'Creation Date', 'Created Date']);
    const expirationDate = whoisField(text, ['Expiry Date', 'Expiration Date', 'Registry Expiry Date', 'Expiry']);
    return { domain, registrationDate, expirationDate, source: 'WHOIS' };
  } finally {
    try { await socket.close(); } catch {}
  }
}

async function lookupRdap(domain) {
  const upstream = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
    method: 'GET',
    redirect: 'follow',
    headers: { Accept: 'application/rdap+json, application/json' },
    signal: AbortSignal.timeout(12000),
    cf: { cacheEverything: true, cacheTtl: 21600 },
  });
  if (!upstream.ok) {
    if (upstream.status === 429) return { error: 'RDAP_RATE_LIMITED', source: 'RDAP', status: 429 };
    if (upstream.status === 404) return { error: 'RDAP_UNAVAILABLE_OR_DOMAIN_NOT_FOUND', source: 'RDAP', status: 404 };
    return { error: 'RDAP_UPSTREAM_ERROR', source: 'RDAP', status: 502 };
  }
  const json = await upstream.json();
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { error: 'INVALID_RDAP_RESPONSE', source: 'RDAP', status: 502 };
  }
  const events = Array.isArray(json.events) ? json.events : [];
  const dateFor = actions => events.find(e => actions.includes(String(e.eventAction || '').toLowerCase()))?.eventDate ?? null;
  return {
    domain,
    registrationDate: dateFor(['registration', 'reregistration']),
    expirationDate: dateFor(['registrar expiration', 'expiration']),
    source: 'RDAP',
  };
}

export default {
  async fetch(request, env = {}) {
    const origin = env?.ALLOWED_ORIGIN || '*';
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Accept',
          'Vary': 'Origin',
        },
      });
    }
    if (request.method !== 'GET') return response({ error: 'METHOD_NOT_ALLOWED' }, 405, origin);
    if (url.pathname === '/health') return response({ ok: true, service: 'domainwatch-rdap-whois' }, 200, origin);
    if (url.pathname !== '/api/rdap') return response({ error: 'NOT_FOUND' }, 404, origin);
    const domain = String(url.searchParams.get('domain') || '').toLowerCase().trim();
    if (!validDomain(domain)) return response({ error: 'INVALID_DOMAIN' }, 400, origin);
    try {
      const result = domain.endsWith('.im')
        ? await lookupImWhois(domain)
        : await lookupRdap(domain);
      if (result.status) {
        const { status, ...body } = result;
        return response(body, status, origin);
      }
      return response(result, 200, origin, 3600);
    } catch (error) {
      const code = String(error?.message || '');
      const isIm = domain.endsWith('.im');
      return response({
        error: code === 'WHOIS_TIMEOUT' ? code : isIm ? 'WHOIS_LOOKUP_FAILED' : 'RDAP_LOOKUP_FAILED',
        source: isIm ? 'WHOIS' : 'RDAP',
      }, 502, origin);
    }
  },
};
