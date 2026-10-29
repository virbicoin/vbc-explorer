/**
 * nginx njs filter for the public JSON-RPC endpoints (rpc2.virbicoin.com,
 * apne4.virbicoin.com, rpc2.digitalregion.jp, apne4.digitalregion.jp).
 *
 * Install:  apt install libnginx-mod-http-js   (Debian nginx 1.26, njs 0.8.x)
 *           cp docs/njs/rpc-filter.js /etc/nginx/njs/rpc-filter.js
 * Wire-up:  see docs/nginx-rpc.conf.example (js_import, /_rpc_post, /_rpc).
 *
 * Every POST body is parsed as JSON-RPC (single call or batch). A request is
 * refused before it reaches the node when
 *   - the body was not buffered (`r.requestText` undefined, i.e. larger than
 *     client_body_buffer_size)                              → 413
 *   - the body is not JSON                                  → 400, -32700 Parse error
 *   - an element has no string `method`                    → 400, -32600 Invalid Request
 *   - any method starts with one of FORBIDDEN_PREFIXES     → 403, -32601
 * Otherwise the body is forwarded unchanged to the internal /_rpc location
 * and the upstream status and body are returned as they are. The node itself
 * (ovbc --jsonrpc-apis) is not changed: local clients and the allow-listed
 * direct 8329 connections keep every API.
 *
 * `classify()` is pure (no nginx objects), so it is unit-tested in
 * tests/ops/rpc-filter.test.ts with Node.
 */

/** Method prefixes that must never be served on the public endpoint. */
const FORBIDDEN_PREFIXES = ['trace_', 'parity_', 'debug_', 'personal_', 'admin_', 'miner_'];

const FORBIDDEN_MESSAGE = 'Method not allowed on the public endpoint';

function errorBody(code, message) {
  return JSON.stringify({ jsonrpc: '2.0', error: { code: code, message: message }, id: null });
}

/** True when `method` begins with a forbidden prefix (case-insensitive). */
function isForbidden(method) {
  const lower = String(method).toLowerCase();
  for (let i = 0; i < FORBIDDEN_PREFIXES.length; i++) {
    if (lower.indexOf(FORBIDDEN_PREFIXES[i]) === 0) return true;
  }
  return false;
}

/**
 * Decide what to do with a request body.
 * Returns `{ status, body }` when the request must be refused, or `null` when
 * it may be forwarded to the node.
 */
function classify(bodyText) {
  if (bodyText === undefined || bodyText === null) {
    return { status: 413, body: errorBody(-32600, 'Request body too large') };
  }
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch (e) {
    return { status: 400, body: errorBody(-32700, 'Parse error') };
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  if (calls.length === 0) {
    return { status: 400, body: errorBody(-32600, 'Invalid Request') };
  }
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    if (
      !call ||
      typeof call !== 'object' ||
      Array.isArray(call) ||
      typeof call.method !== 'string'
    ) {
      return { status: 400, body: errorBody(-32600, 'Invalid Request: method must be a string') };
    }
    if (isForbidden(call.method)) {
      return { status: 403, body: errorBody(-32601, FORBIDDEN_MESSAGE) };
    }
  }
  return null;
}

/** js_content handler for `location = /_rpc_post`. */
function rpc(r) {
  const verdict = classify(r.requestText);
  if (verdict) {
    r.headersOut['Content-Type'] = 'application/json';
    r.return(verdict.status, verdict.body);
    return;
  }
  r.subrequest('/_rpc', { method: 'POST', body: r.requestText })
    .then(function (reply) {
      r.headersOut['Content-Type'] = reply.headersOut['Content-Type'] || 'application/json';
      r.return(reply.status, reply.responseText);
    })
    .catch(function (error) {
      r.error('rpc-filter: subrequest to /_rpc failed: ' + error);
      r.headersOut['Content-Type'] = 'application/json';
      r.return(502, errorBody(-32603, 'Upstream error'));
    });
}

export default { rpc, classify, isForbidden, FORBIDDEN_PREFIXES, FORBIDDEN_MESSAGE };
