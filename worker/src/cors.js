/**
 * CORS policy.
 *
 * `/challenge`, `/redeem`, `/widget*.js` and the vendored static assets are
 * cross-origin: they echo `Access-Control-Allow-Origin` only for the same
 * origin or for an origin in the `ALLOWED_ORIGINS` var. Requests from anywhere
 * else still reach the Worker (CORS is a browser-side gate), but the browser
 * cannot read the response, which makes the widget unusable from that origin.
 *
 * `Vary: Origin` is sent **unconditionally**, including when the request has no
 * `Origin` header at all. The body does not depend on the origin, but the
 * headers do, so a shared cache that stored a no-`Origin` variant (the plain
 * `<script src="/widget.js">` cache key) must not replay it for a CORS
 * `fetch()` from an allowlisted origin. Without `Vary` the cached response has
 * no `Access-Control-Allow-Origin` and CORS fails for up to `max-age` — one
 * year for the wasm files.
 *
 * `/siteverify` is server-to-server and never gets CORS headers.
 */

export function resolveAllowedOrigin(request, allowedOrigins) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  let selfOrigin;
  try {
    selfOrigin = new URL(request.url).origin;
  } catch {
    return null;
  }
  if (origin === selfOrigin || allowedOrigins.has(origin)) return origin;
  return null;
}

/** Headers for an actual (non-preflight) cross-origin response. */
export function corsHeaders(origin) {
  const headers = { Vary: "Origin" };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

/** Headers for an `OPTIONS` preflight response. */
export function preflightHeaders(origin) {
  const headers = { Vary: "Origin" };
  if (!origin) return headers;
  headers["Access-Control-Allow-Origin"] = origin;
  headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type";
  headers["Access-Control-Max-Age"] = "86400";
  return headers;
}
