// Serve domain lookups from the same origin as the Cloudflare Pages dashboard.
// The shared handler supports RDAP and native .im WHOIS queries.
import lookupWorker from '../../worker.js';

export function onRequest(context) {
  return lookupWorker.fetch(context.request, context.env);
}
