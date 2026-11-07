/**
 * Priestess Verification on Cloudflare Workers — router for verify.rakko.cn.
 *
 * Routes:
 *   GET  /                    showcase page (seven widget variants + same-origin verify)
 *   GET  /widget.js           the repo's widget/src/cap.min.js, byte for byte
 *   GET  /widget-floating.js  the repo's widget/src/cap-floating.min.js
 *   GET  /cap_wasm_bg.wasm    the repo's PoW wasm (window.CAP_CUSTOM_WASM_URL)
 *   GET  /hashwx.wasm         the repo's hashwx wasm (window.CAP_CUSTOM_HASHWX_URL)
 *   GET  /pako_inflate.min.js pako@2.1.0 (window.CAP_PAKO_URL)
 *   GET  /mascot/checking.webp  data-cap-mascot art, served from this origin
 *   GET  /mascot/error.webp     (the widget's default <script dir>/mascot/ base)
 *   GET  /mascot/done.webp
 *   POST /challenge           challenge generation        (scope "site", CORS)
 *   POST /redeem              challenge redemption        (scope "site", CORS)
 *   POST /siteverify          server-to-server validation (no CORS)
 *   POST /demo/challenge      challenge generation        (scope "demo", CORS)
 *   POST /demo/redeem         challenge redemption        (scope "demo", CORS)
 *   POST /demo/siteverify     same-origin-only validation for the demo page,
 *                             accepts demo-scoped tokens only
 *   POST /<siteKey>/challenge   a registered site's challenge (site scope, site origins)
 *   POST /<siteKey>/redeem      a registered site's redemption
 *   POST /<siteKey>/siteverify  a registered site's validation (site secret, no CORS)
 *
 * Every challenge, redeem and gate-pass entry point is rate limited per IP
 * (`RL_CHALLENGE` / `RL_REDEEM`, see `stats.js`) before any Durable Object is
 * touched, and every outcome is counted in `StatsStore` (`recordEvent`).
 *   *    /admin…               admin console, Priestess sign-in (see admin/index.js)
 *
 * Server-side gate (`gate.js`), checked before every route above:
 *   ANY  <gate host>/*      whole site gated (hosts from `GATE_UPSTREAMS` or
 *                             added in /admin); exempt paths and disabled hosts
 *                             are proxied straight through, otherwise a valid
 *                             pass cookie is required before the request is
 *                             reverse-proxied to that host's origin
 *   GET  /protected, /protected/*  gated on every other host; a valid pass gets
 *                             the built-in example page
 *   GET  /__gate/widget.js, /__gate/mascot/*.webp, /__gate/*.wasm,
 *        /__gate/pako_inflate.min.js
 *                             the assets above, same-origin for the gate page
 *   POST /__gate/challenge    challenge generation        (scope "gate")
 *   POST /__gate/redeem       challenge redemption        (scope "gate")
 *   POST /__gate/pass         same-origin: consumes a gate token, sets the pass
 *   POST /__gate/logout       same-origin: clears the pass
 *   (`/__gate/*` is reserved on every host and never proxied.)
 */

import { setHashwxModule } from "../../core/src/index.js";
import hashwxWasmModule from "../../core/vendor/hashwx.wasm";
import { handleAdmin, isAdminPath } from "./admin/index.js";
import { readConfig } from "./config.js";
import { corsHeaders, preflightHeaders, resolveAllowedOrigin } from "./cors.js";
import { renderDemoPage } from "./demo-page.js";
import { handleGate } from "./gate.js";
import {
  DEMO_TENANT,
  SITE_TENANT,
  handleChallenge,
  handleDemoSiteverify,
  handleRedeem,
  handleSiteSiteverify,
  handleSiteverify,
  jsonResponse,
  rateLimitedResponse,
} from "./handlers.js";
import { registryFor } from "./site-registry.js";
import { loadSite, parseSitePath, siteConfig, siteTenant } from "./sites.js";
import {
  DEFAULT_SITE,
  isRateLimited,
  recordRateLimited,
} from "./stats.js";
import {
  ASSET_PATHS,
  isWidgetPath,
  versionedPath,
  widgetResponse,
} from "./widget.js";

// Cloudflare Workers forbid `WebAssembly.compile()` at runtime, and capjs-core
// normally compiles its embedded hashwx blob on first use. Hand it the module
// that wrangler compiled from `core/vendor/hashwx.wasm` instead. A packaging
// change must not take the whole Worker down: on failure hashwx stays on its
// JS fallback path (and hashwx is opt-in anyway).
try {
  setHashwxModule(hashwxWasmModule);
} catch (error) {
  console.error("[priestess-verification] hashwx module not injected", error);
}

export { SiteRegistry } from "./site-registry.js";
export { StatsStore } from "./stats.js";
export { TokenStore } from "./token-store.js";

// Content-versioned URLs for everything the demo page loads, hashed once per
// isolate on first use (see `versionedPath`).
let demoAssets = null;
function demoAssetUrls() {
  demoAssets ??= {
    widget: versionedPath("/widget.js"),
    capWasm: versionedPath(ASSET_PATHS.capWasm),
    hashwx: versionedPath(ASSET_PATHS.hashwx),
    pako: versionedPath(ASSET_PATHS.pako),
  };
  return demoAssets;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    let config;
    try {
      config = readConfig(env);
    } catch (error) {
      // The message can quote the raw env var, so it stays in the logs.
      console.error("[priestess-verification]", error);
      return jsonResponse({ success: false, error: "Internal error" }, 500);
    }

    // The gate goes first: on a gated host it owns every path, including
    // OPTIONS, and on this Worker's own host it only claims `/protected*` and
    // `/__gate/*` (it returns `null` for everything else). The registered-site
    // routes and `/admin` below are therefore only reachable on hosts that are
    // not gate hosts (`GATE_UPSTREAMS` or the hosts added in /admin).
    try {
      const gated = await handleGate(request, env, config, ctx);
      if (gated) return gated;
    } catch (error) {
      console.error("[priestess-verification] gate", error);
      return jsonResponse({ success: false, error: "Internal error" }, 500);
    }

    const sitePath = parseSitePath(url.pathname);
    if (sitePath) {
      try {
        return await handleSiteRequest(request, env, config, sitePath, ctx);
      } catch (error) {
        console.error("[priestess-verification]", error);
        return jsonResponse({ success: false, error: "Internal error" }, 500, {
          Vary: "Origin",
        });
      }
    }

    if (isAdminPath(url.pathname)) {
      try {
        return await handleAdmin(request, env, config, url);
      } catch (error) {
        console.error("[priestess-verification]", error);
        return jsonResponse({ success: false, error: "Internal error" }, 500, {
          "Cache-Control": "no-store",
        });
      }
    }

    const origin = resolveAllowedOrigin(request, config.allowedOrigins);
    const stats = { ctx, site: DEFAULT_SITE };

    if (request.method === "OPTIONS") {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: preflightHeaders(origin),
      });
    }

    try {
      if (url.pathname === "/" && request.method === "GET") {
        return new Response(renderDemoPage(demoAssetUrls()), {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }

      if (isWidgetPath(url.pathname) && request.method === "GET") {
        return widgetResponse(request, url.pathname);
      }

      if (
        (url.pathname === "/challenge" || url.pathname === "/demo/challenge") &&
        request.method === "POST"
      ) {
        if (await isRateLimited(env, ctx, request, "challenge", DEFAULT_SITE)) {
          return rateLimitedResponse(corsHeaders(origin));
        }
        const tenant = url.pathname.startsWith("/demo/")
          ? DEMO_TENANT
          : SITE_TENANT;
        return await handleChallenge(
          request,
          env,
          config,
          origin,
          tenant,
          stats,
        );
      }

      if (
        (url.pathname === "/redeem" || url.pathname === "/demo/redeem") &&
        request.method === "POST"
      ) {
        if (await isRateLimited(env, ctx, request, "redeem", DEFAULT_SITE)) {
          return rateLimitedResponse(corsHeaders(origin));
        }
        const tenant = url.pathname.startsWith("/demo/")
          ? DEMO_TENANT
          : SITE_TENANT;
        return await handleRedeem(request, env, config, origin, tenant, stats);
      }

      if (url.pathname === "/siteverify" && request.method === "POST") {
        return await handleSiteverify(request, env, config, stats);
      }

      if (url.pathname === "/demo/siteverify" && request.method === "POST") {
        return await handleDemoSiteverify(request, env, config, stats);
      }
    } catch (error) {
      console.error("[priestess-verification]", error);
      return jsonResponse(
        { success: false, error: "Internal error" },
        500,
        corsHeaders(origin),
      );
    }

    return jsonResponse({ success: false, error: "Not found" }, 404);
  },
};

/**
 * `/<siteKey>/challenge|redeem|siteverify` for a site registered in the admin
 * console. Unknown and disabled sites look the same: 404, no CORS headers.
 *
 * The rate limit is checked before the registry is read. A rejected request
 * still looks the site up (the per-isolate snapshot, so a flood costs no extra
 * registry reads) for its CORS headers and statistics: an unknown site gets a
 * bare 429 and is not counted, so random site keys cannot add rows.
 */
async function handleSiteRequest(
  request,
  env,
  config,
  { siteKey, action },
  ctx,
) {
  const limitKind =
    request.method === "POST" && action !== "siteverify" ? action : null;
  const limited =
    limitKind !== null &&
    (await isRateLimited(env, ctx, request, limitKind, null));

  const site = await loadSite(registryFor(env), siteKey);
  const cfg = site?.enabled ? siteConfig(config, site) : null;
  const origin = cfg ? resolveAllowedOrigin(request, cfg.allowedOrigins) : null;

  if (limited) {
    if (!cfg) return rateLimitedResponse({ Vary: "Origin" });
    recordRateLimited(env, ctx, siteKey, limitKind);
    return rateLimitedResponse(corsHeaders(origin));
  }

  if (request.method === "OPTIONS") {
    if (!origin || action === "siteverify") {
      return new Response(null, { status: 403, headers: { Vary: "Origin" } });
    }
    return new Response(null, {
      status: 204,
      headers: preflightHeaders(origin),
    });
  }

  if (request.method !== "POST") {
    return jsonResponse({ success: false, error: "Not found" }, 404, {
      Vary: "Origin",
    });
  }

  if (!cfg) {
    return jsonResponse(
      { success: false, error: "Site not found" },
      404,
      action === "siteverify" ? {} : corsHeaders(origin),
    );
  }

  const tenant = siteTenant(siteKey);
  const stats = { ctx, site: siteKey };
  if (action === "challenge") {
    return handleChallenge(request, env, cfg, origin, tenant, stats);
  }
  if (action === "redeem") {
    return handleRedeem(request, env, cfg, origin, tenant, stats);
  }
  return handleSiteSiteverify(request, env, site, tenant.keySuffix, stats);
}
