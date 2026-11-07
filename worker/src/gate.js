/**
 * Server-side gate: a full-page verification in front of a website, like
 * Cloudflare's challenge page.
 *
 * Which requests are gated:
 *
 *   - on a gate host — listed in `GATE_UPSTREAMS`
 *     (`{"example.com":"https://origin…"}`) or added in the admin console
 *     (see `gate-hosts.js`) — every request is gated; once the visitor holds a
 *     valid pass it is reverse-proxied to that host's upstream origin. An
 *     admin host may be disabled (every request proxied unchecked) and may
 *     list exempt paths, which are proxied without a pass;
 *   - on any other host (this Worker's own, e.g. verify.rakko.cn) only
 *     `/protected` and `/protected/*` are gated, and a valid pass gets the
 *     built-in example page (`renderProtectedPage`).
 *
 * `/__gate/*` is reserved on every host and always answered by the Worker
 * itself, never proxied:
 *
 *   GET  /__gate/widget.js, /__gate/mascot/*.webp, /__gate/*.wasm,
 *        /__gate/pako_inflate.min.js
 *                          the same assets as `/widget.js` & co. (`widget.js`),
 *                          so the gate page stays same-origin; the mascot base
 *                          `<script dir>/mascot/` resolves to `/__gate/mascot/`
 *   POST /__gate/challenge challenge generation  (scope "gate")
 *   POST /__gate/redeem    challenge redemption  (scope "gate")
 *   POST /__gate/pass      `{ token, return }`, same-origin only: consumes a
 *                          gate-scoped token in-process (no siteverify secret
 *                          involved) and sets the pass cookie
 *   POST /__gate/logout    same-origin only: clears the pass cookie
 *
 * The pass is the `__pv_pass` cookie, `1.<exp>.<mac>`: `exp` is the expiry in
 * epoch seconds and `mac` is base64url(HMAC-SHA256(key,
 * "pv-pass|1|<binding>|<exp>|<sha256(User-Agent)>")). It is bound to the
 * User-Agent (not the IP, which changes under mobile networks) and to:
 *
 *   - `h:<hostname>` by default: a host-only cookie, valid on that host only;
 *   - `d:<GATE_COOKIE_DOMAIN>` when that var is set and the request host is the
 *     domain itself or a subdomain of it: the cookie is sent with
 *     `Domain=<domain>`, so one pass covers every subdomain. A host outside the
 *     domain keeps the host-only behaviour.
 *
 * The `h:` / `d:` tag keeps the two kinds from ever validating as each other.
 * Passes are verified with `crypto.subtle.verify`, a constant-time comparison.
 * The key is `GATE_COOKIE_SECRET`, or HMAC-SHA256(SITEVERIFY_SECRET,
 * "gate-cookie") when that secret is not set.
 */

import { sha256Hex } from "../../core/src/crypto.js";
import { corsHeaders } from "./cors.js";
import { gatePolicy, isExemptPath } from "./gate-hosts.js";
import { renderGatePage, renderProtectedPage } from "./gate-page.js";
import {
  GATE_TENANT,
  consumeScopedToken,
  handleChallenge,
  handleRedeem,
  isSameOriginRequest,
  jsonResponse,
  rateLimitedResponse,
  verifyFailReason,
} from "./handlers.js";
import { registryFor } from "./site-registry.js";
import { gateSite, isRateLimited, recordEvent } from "./stats.js";
import { ASSET_PATHS, isWidgetPath, versionedPath, widgetResponse } from "./widget.js";

export const GATE_PREFIX = "/__gate/";
export const PASS_COOKIE = "__pv_pass";
const PASS_VERSION = "1";
const PROTECTED_PATH = "/protected";

const encoder = new TextEncoder();

// ---- pass cookie --------------------------------------------------------

// One entry per distinct secret; in practice exactly one per isolate.
const keyCache = new Map();

async function hmacKey(rawKey) {
  return crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** The pass-signing key, or `null` when neither secret is configured. */
export async function passKey(config) {
  const source = config.gateCookieSecret
    ? `gate:${config.gateCookieSecret}`
    : config.siteverifySecret
      ? `derived:${config.siteverifySecret}`
      : null;
  if (!source) return null;
  let key = keyCache.get(source);
  if (!key) {
    let raw;
    if (config.gateCookieSecret) {
      raw = encoder.encode(config.gateCookieSecret);
    } else {
      const parent = await hmacKey(encoder.encode(config.siteverifySecret));
      raw = await crypto.subtle.sign("HMAC", parent, encoder.encode("gate-cookie"));
    }
    key = await hmacKey(raw);
    keyCache.set(source, key);
  }
  return key;
}

function passMessage(binding, exp, userAgent) {
  return encoder.encode(
    `pv-pass|${PASS_VERSION}|${binding}|${exp}|${sha256Hex(userAgent ?? "")}`,
  );
}

/**
 * What a pass on `host` is bound to: `{ binding, domain }`, where `domain` is
 * the cookie's `Domain` attribute (or `null` for a host-only cookie).
 */
export function passScope(config, host) {
  const domain = config.gateCookieDomain;
  if (domain && (host === domain || host.endsWith(`.${domain}`))) {
    return { binding: `d:${domain}`, domain };
  }
  return { binding: `h:${host}`, domain: null };
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Mints a pass value for `binding` + `userAgent` that expires at `exp` (epoch s). */
export async function createPassValue(key, binding, userAgent, exp) {
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    passMessage(binding, exp, userAgent),
  );
  return `${PASS_VERSION}.${exp}.${base64url(mac)}`;
}

/**
 * Returns the pass expiry (epoch s) when `value` is a valid, unexpired pass for
 * `binding` + `userAgent`, otherwise `null`.
 */
export async function verifyPassValue(key, value, binding, userAgent, now = Date.now()) {
  if (!key || typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== PASS_VERSION) return null;
  if (!/^\d{1,12}$/.test(parts[1])) return null;
  const exp = Number(parts[1]);
  if (exp * 1000 <= now) return null;
  const mac = fromBase64url(parts[2]);
  if (!mac || mac.length !== 32) return null;
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    mac,
    passMessage(binding, exp, userAgent),
  );
  return ok ? exp : null;
}

function cookieValues(request, name) {
  const header = request.headers.get("Cookie");
  if (!header) return [];
  const values = [];
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      values.push(part.slice(separator + 1).trim());
    }
  }
  return values;
}

/** The expiry of the request's valid pass, or `null`. */
async function validPass(request, config, host) {
  const values = cookieValues(request, PASS_COOKIE);
  if (values.length === 0) return null;
  const key = await passKey(config);
  const { binding } = passScope(config, host);
  const userAgent = request.headers.get("User-Agent");
  for (const value of values) {
    const exp = await verifyPassValue(key, value, binding, userAgent);
    if (exp !== null) return exp;
  }
  return null;
}

function passCookie(value, maxAge, domain) {
  const domainAttr = domain ? `; Domain=${domain}` : "";
  return `${PASS_COOKIE}=${value}; Max-Age=${maxAge}${domainAttr}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

/** The request's `Cookie` header without our pass, or `null` if nothing is left. */
export function stripPassCookie(header) {
  if (!header) return null;
  const kept = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && part.split("=")[0].trim() !== PASS_COOKIE);
  return kept.length > 0 ? kept.join("; ") : null;
}

/**
 * Where to send the visitor after a pass: a same-origin path only. Anything
 * that does not start with a single `/` (`//evil`, `/\evil`, `https://…`,
 * `javascript:`) falls back to `/`, so `/__gate/pass` is not an open redirect.
 */
export function safeReturnPath(raw, selfOrigin) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/";
  }
  // Tabs and newlines are stripped by the URL parser and control characters
  // have no business in a path: refuse rather than normalise.
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return "/";
  let url;
  try {
    url = new URL(raw, selfOrigin);
  } catch {
    return "/";
  }
  if (url.origin !== selfOrigin) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

// ---- gate pages ---------------------------------------------------------

let gateAssets = null;
function gateAssetUrls() {
  const prefixed = (path) => `${GATE_PREFIX.slice(0, -1)}${versionedPath(path)}`;
  gateAssets ??= {
    widget: prefixed("/widget.js"),
    capWasm: prefixed(ASSET_PATHS.capWasm),
    hashwx: prefixed(ASSET_PATHS.hashwx),
    pako: prefixed(ASSET_PATHS.pako),
  };
  return gateAssets;
}

function randomRay() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomNonce() {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

// The widget needs: a blob: Web Worker for the PoW, wasm compilation
// ('wasm-unsafe-eval'), and a sandboxed srcdoc iframe for the instrumentation
// probe, which inherits this policy, runs one inline script carrying
// `window.CAP_SCRIPT_NONCE`, and calls `eval` on purpose ('unsafe-eval').
// Its shadow-DOM styles are inline, hence style-src 'unsafe-inline'.
function contentSecurityPolicy(nonce) {
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'unsafe-eval' 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function gateHeaders(ray, extra = {}) {
  return {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Gate-Ray": ray,
    Vary: "Accept, Accept-Language, Cookie, User-Agent",
    ...extra,
  };
}

function htmlHeaders(ray, nonce) {
  return gateHeaders(ray, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": contentSecurityPolicy(nonce),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
  });
}

export function pickLang(request) {
  const header = request.headers.get("Accept-Language") ?? "";
  let best = { lang: "en", q: -1 };
  for (const part of header.split(",")) {
    const [tag, ...params] = part.trim().toLowerCase().split(";");
    if (!tag) continue;
    const qParam = params.find((p) => p.trim().startsWith("q="));
    const q = qParam ? Number(qParam.trim().slice(2)) : 1;
    if (!Number.isFinite(q) || q <= best.q) continue;
    if (tag.startsWith("zh")) best = { lang: "zh", q };
    else if (tag.startsWith("en") || tag === "*") best = { lang: "en", q };
  }
  return best.lang;
}

/** The pass facts the example page states: its lifetime and where it applies. */
function passFacts(config, host) {
  return {
    passTtlS: config.gatePassTtlS,
    passDomain: passScope(config, host).domain,
  };
}

function wantsHtml(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  return (request.headers.get("Accept") ?? "").toLowerCase().includes("text/html");
}

function gateRequired(request, config, url, env, ctx) {
  recordEvent(env, ctx, { site: gateSite(url.hostname), event: "gate_shown" });
  const ray = randomRay();
  if (!wantsHtml(request)) {
    return jsonResponse(
      { success: false, error: "gate_required" },
      403,
      gateHeaders(ray),
    );
  }
  const nonce = randomNonce();
  const html = renderGatePage({
    assets: gateAssetUrls(),
    host: url.hostname,
    lang: pickLang(request),
    nonce,
    ray,
    passTtlS: config.gatePassTtlS,
  });
  return new Response(request.method === "HEAD" ? null : html, {
    status: 403,
    headers: htmlHeaders(ray, nonce),
  });
}

function protectedPage(request, config, url, exp) {
  const ray = randomRay();
  const nonce = randomNonce();
  const html = renderProtectedPage({
    assets: gateAssetUrls(),
    host: url.hostname,
    lang: pickLang(request),
    nonce,
    ray,
    expiresAt: exp,
    ...passFacts(config, url.hostname),
  });
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: htmlHeaders(ray, nonce),
  });
}

// ---- reverse proxy ------------------------------------------------------

async function proxyToUpstream(request, url, upstream) {
  // Assign the path onto the upstream URL instead of resolving it against
  // the upstream: a path such as `//evil.example/x` would otherwise resolve
  // as scheme-relative and send the request to an arbitrary host.
  const target = new URL(upstream);
  target.pathname = url.pathname;
  target.search = url.search;
  if (target.origin !== upstream) {
    return jsonResponse({ success: false, error: "bad_request" }, 400);
  }
  const headers = new Headers(request.headers);
  const cookie = stripPassCookie(headers.get("Cookie"));
  if (cookie) headers.set("Cookie", cookie);
  else headers.delete("Cookie");
  // `fetch` derives Host from the target URL; tell the origin what the
  // visitor actually asked for.
  headers.delete("Host");
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Proto", url.protocol.slice(0, -1));
  // Client-supplied forwarding headers must not reach an origin that may
  // trust them; replace them with the address Cloudflare saw.
  headers.delete("Forwarded");
  headers.delete("X-Real-IP");
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (clientIp) headers.set("X-Forwarded-For", clientIp);
  else headers.delete("X-Forwarded-For");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: "manual",
  });

  // Keep the visitor on the public host when the origin redirects to itself.
  const location = response.headers.get("Location");
  if (location) {
    let resolved = null;
    try {
      resolved = new URL(location, target);
    } catch {}
    if (resolved && resolved.origin === upstream) {
      const rewritten = new Response(response.body, response);
      rewritten.headers.set(
        "Location",
        `${url.origin}${resolved.pathname}${resolved.search}${resolved.hash}`,
      );
      return rewritten;
    }
  }
  return response;
}

// ---- /__gate/* ----------------------------------------------------------

async function handlePass(request, env, config, url, ctx) {
  const site = gateSite(url.hostname);
  const fail = (error, status, reason) => {
    recordEvent(env, ctx, { site, event: "gate_pass_fail", reason });
    return jsonResponse({ ok: false, error }, status);
  };
  if (!isSameOriginRequest(request)) return fail("Forbidden", 403, "other");
  const key = await passKey(config);
  if (!key) return fail("Gate is not configured", 500, "other");

  let body;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const token = body?.token;
  if (typeof token !== "string" || token.length === 0) {
    return fail("Missing required parameters", 400, "bad_request");
  }

  const result = await consumeScopedToken(token, env, GATE_TENANT);
  if (!result.ok) {
    const reason = verifyFailReason(result.status, result.error);
    return fail(result.error, result.status, reason);
  }
  recordEvent(env, ctx, { site, event: "gate_pass" });

  const exp = Math.floor(Date.now() / 1000) + config.gatePassTtlS;
  const { binding, domain } = passScope(config, url.hostname);
  const value = await createPassValue(
    key,
    binding,
    request.headers.get("User-Agent"),
    exp,
  );
  return jsonResponse(
    { ok: true, redirect: safeReturnPath(body.return, url.origin) },
    200,
    { "Set-Cookie": passCookie(value, config.gatePassTtlS, domain) },
  );
}

function handleLogout(request, config, url) {
  if (!isSameOriginRequest(request)) {
    return jsonResponse({ ok: false, error: "Forbidden" }, 403);
  }
  const { domain } = passScope(config, url.hostname);
  return jsonResponse({ ok: true }, 200, {
    "Set-Cookie": passCookie("", 0, domain),
  });
}

// `/__gate/*` POST route -> rate-limit kind (`isRateLimited` in `stats.js`).
const GATE_RATE_LIMITS = {
  "/challenge": "challenge",
  "/redeem": "redeem",
  "/pass": "gate_pass",
};

async function handleGateRoute(request, env, config, url, ctx) {
  const subPath = url.pathname.slice(GATE_PREFIX.length - 1);
  // The gate only ever talks to its own origin.
  const origin =
    request.headers.get("Origin") === url.origin ? url.origin : null;

  if (request.method === "GET" && isWidgetPath(subPath)) {
    return widgetResponse(request, subPath);
  }
  if (request.method === "POST") {
    // Rate limits come before any Durable Object call (see `stats.js`).
    const site = gateSite(url.hostname);
    const stats = { ctx, site };
    const limit = GATE_RATE_LIMITS[subPath];
    if (limit && (await isRateLimited(env, ctx, request, limit, site))) {
      return rateLimitedResponse(
        limit === "gate_pass" ? {} : corsHeaders(origin),
      );
    }
    switch (subPath) {
      case "/challenge":
        return handleChallenge(request, env, config, origin, GATE_TENANT, stats);
      case "/redeem":
        return handleRedeem(request, env, config, origin, GATE_TENANT, stats);
      case "/pass":
        return handlePass(request, env, config, url, ctx);
      case "/logout":
        return handleLogout(request, config, url);
    }
  }
  return jsonResponse({ success: false, error: "Not found" }, 404);
}

/**
 * Answers the request when the gate is responsible for it, otherwise returns
 * `null` so the regular routes handle it.
 */
export async function handleGate(request, env, config, ctx) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();

  if (url.pathname.startsWith(GATE_PREFIX)) {
    return handleGateRoute(request, env, config, url, ctx);
  }

  // Configured hosts and this Worker's own hosts resolve without the
  // registry; any other host reads the per-isolate snapshot (gate-hosts.js).
  const policy = await gatePolicy(config, host, () => registryFor(env));
  if (
    policy &&
    (!policy.enabled || isExemptPath(policy.exemptPaths, url.pathname))
  ) {
    return proxyToUpstream(request, url, policy.upstream);
  }
  const upstream = policy?.upstream ?? null;

  const selfProtected =
    url.pathname === PROTECTED_PATH ||
    url.pathname.startsWith(`${PROTECTED_PATH}/`);
  if (!upstream && !selfProtected) return null;

  const exp = await validPass(request, config, host);
  if (exp === null) return gateRequired(request, config, url, env, ctx);
  if (upstream) return proxyToUpstream(request, url, upstream);
  return protectedPage(request, config, url, exp);
}
