# <img src="https://github.com/tiagozip/cap/blob/main/docs/public/logo-small.webp?raw=true" alt="" align="left" width="40" height="40"> Priestess Verification

Priestess Verification is a fork of [Cap](https://github.com/tiagozip/cap) by Tiago, licensed under Apache-2.0. Modified by Rakko (KurisuRakko): renamed the user-facing branding.

Priestess Verification is a lightweight, modern open-source CAPTCHA alternative using <a href="https://trycap.dev/guide/effectiveness?utm_source=github&utm_campaign=pow_link" target="_blank">proof-of-work</a> and <a href="https://trycap.dev/guide/instrumentation?utm_source=github&utm_campaign=inst_link" target="_blank">instrumentation challenges</a>. It's fast, private, and extremely simple to integrate.

<a href="https://trycap.dev/guide/demo?utm_source=github&utm_campaign=captcha_animated" target="_blank"><img src="./assets/captcha-animated.svg" alt="Priestess Verification widget" width="270"></a>

## Using the widget

The fork distributes the widget through jsDelivr's GitHub channel (there is no npm package):

```html
<!-- pin to a release tag in production, e.g. @v1.0.0 -->
<script src="https://cdn.jsdelivr.net/gh/KurisuRakko/priestess-verification@main/widget/src/cap.min.js"></script>

<cap-widget data-cap-api-endpoint="https://your-cap-server.example/your-site-key/"></cap-widget>
```

`@main` is cached at jsDelivr's edge for up to 12 hours, so a push to this fork can take that long to reach users. In production, pin the widget to a release tag instead (e.g. `@v1.0.0`, created at release time) or to a commit sha.

Floating mode loads `cap-floating.min.js` from the same directory. The element name, attributes and JavaScript API stay compatible with upstream Cap, so the [upstream documentation](https://trycap.dev) still applies.

Note: `widget/src/cap.compat.min.js` is upstream's legacy compatibility bundle. It still contains the upstream branding and has not been rebuilt.

### Avoiding jsDelivr at runtime

The widget does not bundle everything it needs: at runtime it fetches a PoW wasm module, the optional hashwx wasm module, and (only on browsers without `DecompressionStream`) pako. By default those three URLs point at `cdn.jsdelivr.net`, and the PoW module is prefetched as soon as the widget script loads. The Cloudflare Workers deployment serves all three from the same origin, so set the widget's override variables **before** loading `widget.js`:

```html
<script>
  window.CAP_CUSTOM_WASM_URL = "https://verify.rakko.cn/cap_wasm_bg.wasm";
  window.CAP_CUSTOM_HASHWX_URL = "https://verify.rakko.cn/hashwx.wasm";
  window.CAP_PAKO_URL = "https://verify.rakko.cn/pako_inflate.min.js";
</script>
<script src="https://verify.rakko.cn/widget.js"></script>

<cap-widget data-cap-api-endpoint="https://your-cap-server.example/your-site-key/"></cap-widget>
```

Without those three lines the widget still works, but it makes a cross-origin request to jsDelivr at load time (and falls back to the slower JS solver if that request fails). The demo page at `/` sets all three itself.

## Deploy to Cloudflare Workers

`worker/` is a self-contained Cloudflare Workers deployment of this fork (Durable Objects with the SQLite backend, no KV). It serves the widget and its runtime dependencies (wasm + pako) itself, so the demo page never talks to jsDelivr; embedders get the same guarantee by setting the three `window.CAP_CUSTOM_*` / `window.CAP_PAKO_URL` variables shown above:

| Route | Purpose |
| --- | --- |
| `GET /` | showcase page: seven live widget variants (auto, invisible, click, mascot, mascot + auto, background-free mascot, background-free mascot + auto), each verified through `/demo/siteverify` |
| `GET /widget.js`, `GET /widget-floating.js` | this repo's `widget/src/cap.min.js` / `cap-floating.min.js`, byte for byte |
| `GET /cap_wasm_bg.wasm`, `GET /hashwx.wasm` | this repo's `wasm/src/browser/*.wasm`, byte for byte |
| `GET /pako_inflate.min.js` | `pako@2.1.0` `dist/pako_inflate.min.js` (sha256 `fa226c8e…f8bb43`, identical to the jsDelivr copy) |
| `POST /challenge`, `POST /redeem` | challenge generation / redemption via `core/` (scope `site`) |
| `POST /siteverify` | server-to-server validation for your backend |
| `POST /demo/challenge`, `POST /demo/redeem`, `POST /demo/siteverify` | the demo page's own endpoints (scope `demo`); `/demo/siteverify` needs no secret and only accepts demo-scoped tokens |
| `GET /protected`, `GET /protected/*` | server-side gate demo: a full-page challenge (403) until the visitor holds a pass, then a built-in example page |
| any path on a `GATE_UPSTREAMS` host | server-side gate in front of a whole site: challenge page until the visitor holds a pass, then reverse-proxied to the upstream origin |
| `GET /__gate/widget.js`, `/__gate/mascot/*.webp`, `/__gate/*.wasm`, `/__gate/pako_inflate.min.js` | the assets above under the gate's reserved prefix, so the gate page stays same-origin on every gated host |
| `POST /__gate/challenge`, `POST /__gate/redeem`, `POST /__gate/pass`, `POST /__gate/logout` | the gate's own endpoints (scope `gate`); `/__gate/pass` (same-origin only) consumes a gate token and sets the pass cookie, `/__gate/logout` clears it |

Every route whose response headers depend on `Origin` — the widget assets, the wasm/pako files, `/challenge` and `/redeem` — sends `Vary: Origin` unconditionally, including for requests without an `Origin` header, so a cached no-`Origin` variant can never be replayed to a CORS caller.


### Local development

```sh
cd worker
npm install
cp .dev.vars.example .dev.vars   # then replace both secrets
npm run dev                      # http://127.0.0.1:8787
```

`wrangler.jsonc` pins a single `compatibility_date` (`2026-09-25`) that `wrangler dev`, the vitest pool and `wrangler deploy` all use, so local, CI and production run the same runtime semantics.

Automated checks:

```sh
npm test                                             # vitest + @cloudflare/vitest-pool-workers
node scripts/acceptance.mjs http://127.0.0.1:8787    # curl-style end-to-end checks
node scripts/browser-e2e.mjs http://127.0.0.1:8787  # real browser; fails if anything hits cdn.jsdelivr.net
node scripts/cpu-bench.mjs                           # CPU cost of /challenge, /redeem, /siteverify
```

The pages the Worker renders — the showcase at `/`, the gate page and the `/protected` example — are React apps built with [Rakko Design](https://github.com/KurisuRakko/Rakko-Design)'s `@rakko/react` primitives. The sources live in `worker/web/` (Vite + React; `src/showcase/`, `src/gate/`, `src/shared/`), and `worker/src/demo-page.js` / `gate-page.js` are server-rendered shells that inline the built bundles (the widget script, `window.CAP_*` variables, the gate's CSP nonce, the theme boot script and a `#page-config` JSON block stay in the shell). The bundles are checked in under `worker/src/generated/`, one script and one stylesheet per page family, so rebuild them after any change under `worker/web/`:

```sh
cd worker
npm run build:web       # web/ → src/generated/{showcase,gate}.client.js + .css
npm run typecheck:web   # tsc over web/src and the vendored @rakko/react
npm run dev:web         # optional: Vite with hot reload on :5198 (showcase.html, gate.html),
                        # proxying the widget and /demo/, /__gate/ to `npm run dev` on :8787
```

Rakko Design itself (tokens, glass material, state layer, ripple runtime and the `@rakko/react` sources) lives in `vendor/rakko-design/`, which only `scripts/sync-design.sh` may write (`RAKKO_DESIGN_DIR=<local checkout> scripts/sync-design.sh` works offline); `node scripts/check-design.mjs` checks `worker/web/` and the page shells against the design rules (no raw colours, no `backdrop-filter` outside the vendored `glass.css`, system font stacks only, …) and, given `RAKKO_DESIGN_DIR`, that the vendor copy matches upstream byte for byte.

### Deploy

The custom domain is attached by the deploy itself, so the account needs the zone first:

- the `rakko.cn` zone must be in the same Cloudflare account, active, and the account needs Workers + Durable Objects access;
- `verify.rakko.cn` must not already exist as a conflicting DNS record (`custom_domain: true` makes wrangler create the proxied record; an existing A/AAAA/CNAME with the same name fails the deploy);
- `workers_dev` is `false`, so the only address is the custom domain — if the route fails to attach, the deploy fails rather than silently going live on `*.workers.dev`. For a first deploy on a fresh account, temporarily set `"workers_dev": true` to get a fallback URL.

```sh
cd worker
npm install                                  # required: wrangler.jsonc points its $schema at node_modules
npx wrangler login
npx wrangler secret put CAP_SECRET           # e.g. openssl rand -hex 32
npx wrangler secret put SITEVERIFY_SECRET    # e.g. openssl rand -hex 32
npx wrangler deploy
```

`ALLOWED_ORIGINS` is a comma separated list of extra browser origins allowed to call `/challenge`, `/redeem` and the widget assets; the worker's own origin is always allowed, and `/siteverify` never sends CORS headers.

### Calling `/siteverify` from your backend

Use the same shape as the standalone server, so the dashboard snippet keeps working:

```js
const res = await fetch("https://verify.rakko.cn/siteverify", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ secret: process.env.SITEVERIFY_SECRET, response: token }),
});
const { success } = await res.json();
```

`token` is what the widget hands your page (`event.detail.token` on the `solve` event, or the hidden `cap-token` input). Tokens are single use: verifying the same token twice returns `{ success: false }`. Never call `/siteverify` from the browser — it needs the secret; the demo page uses the same-origin-only `/demo/siteverify` instead, which takes no secret and only accepts tokens minted by `/demo/challenge` + `/demo/redeem` (production tokens are rejected there, and demo tokens are rejected by `/siteverify`).

### Configuration

All optional tuning lives in `wrangler.jsonc` under `vars` (defaults shown): `ALLOWED_ORIGINS` (`https://verify.rakko.cn`), `CHALLENGE_COUNT` (50), `CHALLENGE_SIZE` (32), `CHALLENGE_DIFFICULTY` (4), `INSTRUMENTATION_LEVEL` (3), `BLOCK_AUTOMATED_BROWSERS` (false), `TOKEN_TTL_MS` (20 min), `CHALLENGE_PROTOCOLS` (empty = format 1), `HASHWX_DIFFICULTY` (1000000), `HASHWX_CHALLENGE_COUNT` (4), and for the server-side gate `GATE_UPSTREAMS` (empty), `GATE_PASS_TTL_S` (1800), `GATE_COOKIE_DOMAIN` (empty = host-only), `GATE_BLOCK_AUTOMATED_BROWSERS` (true: gate challenges reject automated browsers regardless of `BLOCK_AUTOMATED_BROWSERS`).

Instrumentation obfuscation levels 4-10 fall back to a weaker script inside Workers, because `esbuild` (native binary) and `javascript-obfuscator` cannot run in workerd. Keep `INSTRUMENTATION_LEVEL` at 3 (the default) unless you have measured the trade-off yourself.

### Server-side gate

Besides the embeddable widget, the Worker can stand in front of a whole website, like Cloudflare's challenge page: a visitor without a valid pass gets a full-screen page (status 403, `Cache-Control: no-store`, `X-Robots-Tag: noindex`, a nonce-based CSP) on which a mascot + auto widget solves a challenge by itself, trades the token for a pass cookie at `POST /__gate/pass` and reloads the page they asked for. Non-HTML requests without a pass (API calls, `POST`s, anything whose `Accept` lacks `text/html`) get `403 {"success":false,"error":"gate_required"}`. Every gate response carries a random `X-Gate-Ray` request ID, also shown in the page footer. `/__gate/*` is reserved on every gated host and always answered by the Worker, never by the upstream.

On the Worker's own host only `/protected` and `/protected/*` are gated (a built-in example page with the pass's remaining time and a "clear the pass" button). To gate a real site:

1. Map its public hostname to the origin that actually serves it, in `wrangler.jsonc` `vars`:
   ```jsonc
   "GATE_UPSTREAMS": "{\"example.com\":\"https://origin.example.com\"}"
   ```
   Keys are bare hostnames, values bare `https:` origins; anything else fails every request with a logged config error.
2. Route the hostname to this Worker, e.g. `"routes": [{ "pattern": "example.com/*", "zone_name": "example.com" }, …]`. The upstream must be reachable under a hostname that is **not** routed to this Worker (otherwise the proxy loops back into the gate).

Passed requests are proxied with their method, headers and body intact (`redirect: "manual"`), with `X-Forwarded-Host` / `X-Forwarded-Proto` set, our `__pv_pass` cookie removed from `Cookie`, and `Location` headers that point at the upstream origin rewritten onto the public host. `Origin` and `Referer` still name the public host, so an origin with strict CSRF checks must accept it.

The pass is the `__pv_pass` cookie, `1.<exp>.<mac>`, with `HttpOnly; Secure; SameSite=Lax; Path=/` and `Max-Age` = `GATE_PASS_TTL_S` (default 1800, 60–86400). `mac` is an HMAC-SHA256 over the host (or cookie domain, below), the expiry and a SHA-256 of the `User-Agent`; it is not bound to the IP, so it survives network changes, and is checked in constant time. The key is the `GATE_COOKIE_SECRET` secret (`npx wrangler secret put GATE_COOKIE_SECRET`); when unset it is derived from `SITEVERIFY_SECRET` as HMAC-SHA256(SITEVERIFY_SECRET, `"gate-cookie"`), so rotating either secret invalidates every pass. Gate tokens are single use, and gate, site and demo tokens never cross scopes (`/__gate/pass` rejects site/demo tokens, `/siteverify` and `/demo/siteverify` reject gate tokens). The `return` path posted to `/__gate/pass` must be a same-origin path (starting with a single `/`); anything else redirects to `/`.

`GATE_COOKIE_DOMAIN` (optional, e.g. `rakko.cn` or `.rakko.cn`) shares one pass across subdomains: the cookie is then set (and cleared) with `Domain=rakko.cn` and signed for the domain instead of the host, so a pass earned on `a.rakko.cn` is accepted on `b.rakko.cn` and `rakko.cn`, but never on `evil-rakko.cn` or `rakko.cn.evil.com`. A request host outside the domain keeps the host-only behaviour. Every subdomain — including ones that are not gated or not yours to trust — can then read the cookie; it only proves that a browser with this `User-Agent` passed a verification, it is not a session or an identity, so do not use it as one.

### Free plan capacity

Cloudflare's free-tier limits ([Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), last updated Aug 25, 2026): **100,000 requests/day** (the page states requests "Includes HTTP requests, RPC sessions, WebSocket messages, and alarm invocations") and **100,000 rows written/day**, with the footnotes "Each `setAlarm()` is billed as a single row written" and "Deletes are counted as rows written".

One full verification (`/challenge` → `/redeem` → `/siteverify`) costs:

| Metered dimension | Cost per verification | Free limit ÷ cost |
| --- | --- | --- |
| Durable Object rows written | **3** — the redeem INSERT (claim + token row), the siteverify UPDATE that consumes it, and the sweep DELETE | **33,333 / day** |
| Durable Object requests | **2** — one to redeem, one to verify (plus the alarms, below) | ~50,000 / day |
| Worker requests | **3** — challenge, redeem, siteverify (the widget/page itself is cached) | ~33,000 / day |

So the free plan supports **~33,000 verifications/day**, and **rows written is the binding limit**. That is why the store keeps one row per redeem — the challenge claim and the token are the same row — has **no secondary indexes** (every index entry is billed as an extra row written on insert and delete), keeps the alarm cadence at 5 minutes and only calls `setAlarm()` when none is pending (4 shards × 288 alarms/day ≈ 1,150 alarms and ≈ 1,150 extra row writes per day, i.e. ~1% of the budget).

Expired rows are still cleaned up: deletes happen opportunistically on write (at most once per 5 minutes per shard) and from the alarm while rows remain; a row that outlives its `expires` is rejected by `/siteverify` with `Token expired` because the expiry is checked on read, so the sweep is about storage hygiene, not correctness. The atomicity and single-use guarantees are unchanged: the redeem INSERT is "insert if absent" (a replayed challenge gets `already_redeemed`), and verification is a single conditional `UPDATE … RETURNING` that can only succeed once.

## Documentation

**[Read the docs](https://trycap.dev/?utm_source=github&utm_campaign=read_docs)**, try the [demo](https://trycap.dev/guide/demo.html?utm_source=github&utm_campaign=demo_link)

The documentation site belongs to the upstream project and has not been migrated to this fork: its examples still load the widget from the npm package `@cap.js/widget`. In this fork, load the widget from jsDelivr as shown in [Using the widget](#using-the-widget), and set `WIDGET_VERSION` to a git tag or commit of this fork.

## What is Priestess Verification?

Priestess Verification replaces visual captchas with modern, accessible and privacy-preserving challenges. No images, no tracking, no dependencies, works everywhere.

The default way to use Priestess Verification is with the Standalone Docker container. [Learn more about how Priestess Verification works](https://trycap.dev/guide/?utm_source=github&utm_campaign=learn_more)

## Why Priestess Verification?

- **250x smaller than hCaptcha**  
  ~20kb, zero dependencies, loads in milliseconds

- **Privacy-first**  
   Priestess Verification doesn't send any telemetry back to our servers

- **Fully customizable**  
   Change the colors, size, position, icons and more with CSS variables

- **Proof-of-work**  
   Your users no longer have to waste time solving visual puzzles.

- **Standalone mode**  
   Run Priestess Verification anywhere with a Docker container with analytics & more

- **No user interaction needed**  
   Hide Priestess Verification's widget and solve challenges in the background

- **Open-source**  
   Completely free & open-source under the Apache 2.0 license

Priestess Verification is a great alternative to [reCAPTCHA](https://www.google.com/recaptcha/about/), [hCaptcha](https://www.hcaptcha.com/) and [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)

## License

This project is licensed under the Apache-2.0 License, please see the [LICENSE](https://github.com/tiagozip/cap/blob/main/LICENSE) file for details.

Copyright ©2025 - present [tiago](https://tiago.zip)

<!--

<a href="https://www.digitalocean.com/">
  <img src="https://opensource.nyc3.cdn.digitaloceanspaces.com/attribution/assets/SVG/DO_Logo_icon_blue.svg" width="30px">
</a>

Cap's free instance is supported by DigitalOcean for open-source. <a href="https://www.digitalocean.com/?refcode=7e41cf645be3&utm_campaign=Referral_Invite&utm_medium=Referral_Program&utm_source=badge">Try DigitalOcean</a> and get $250 worth of credits.
-->

---

[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/9920/badge?v=gold)](https://www.bestpractices.dev/projects/9920) [![](https://data.jsdelivr.com/v1/package/npm/@cap.js/wasm/badge)](https://www.jsdelivr.com/package/npm/@cap.js/wasm)
