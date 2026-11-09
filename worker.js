/**
 * Cloudflare Workers RDAP / WHOIS-equivalent lookup proxy.
 * Deploy with wrangler; then configure the public /api/rdap URL in the board.
 * Optional env ALLOWED_ORIGIN: restrict browser origins (default * for easy setup).
 */
export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Vary': 'Origin',
      'Content-Type': 'application/json; charset=utf-8',
    };
    const output = (body, status = 200, cache = 0) => new Response(JSON.stringify(body), {
      status, headers: {...headers, 'Cache-Control': cache ? `public, max-age=${cache}` : 'no-store'},
    });
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    if (request.method !== 'GET') return output({error:'METHOD_NOT_ALLOWED'},405);
    const url = new URL(request.url);
    if (url.pathname === '/health') return output({ok:true, service:'domainwatch-rdap'});
    if (url.pathname !== '/api/rdap') return output({error:'NOT_FOUND'},404);
    const domain = String(url.searchParams.get('domain') || '').toLowerCase();
    if (domain.length > 253 || !domain.includes('.') || !domain.split('.').every(s => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s))) {
      return output({error:'INVALID_DOMAIN'},400);
    }
    try {
      const upstream = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
        method: 'GET', redirect: 'follow', headers: {'Accept':'application/rdap+json, application/json'},
        signal: AbortSignal.timeout(13000), cf: {cacheEverything: true, cacheTtl: 21600},
      });
      if (!upstream.ok) {
        const msg = upstream.status === 404 ? 'Domain not found by registry' : `Upstream RDAP status ${upstream.status}`;
        return output({error:msg}, upstream.status === 429 ? 429 : upstream.status === 404 ? 404 : 502);
      }
      const data = await upstream.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) return output({error:'INVALID_RDAP_RESPONSE'},502);
      const events = Array.isArray(data.events) ? data.events : [];
      const eventDate = actions => events.find(e => actions.includes(String(e.eventAction||'').toLowerCase()))?.eventDate ?? null;
      return output({
        domain,
        registrationDate: eventDate(['registration','reregistration']),
        expirationDate: eventDate(['registrar expiration','expiration']),
        source: 'RDAP',
      }, 200, 3600);
    } catch(e) {
      return output({error:e?.name === 'TimeoutError' ? 'RDAP_TIMEOUT' : 'RDAP_LOOKUP_FAILED'}, 502);
    }
  }
};
