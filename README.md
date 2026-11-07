# <img src="https://github.com/tiagozip/cap/blob/main/docs/public/logo-small.webp?raw=true" alt="" align="left" width="40" height="40"> Priestess Verification

Priestess Verification is a fork of [Cap](https://github.com/tiagozip/cap) by Tiago, licensed under Apache-2.0. Modified by Rakko (KurisuRakko): renamed the user-facing branding.

Priestess Verification is a lightweight, modern open-source CAPTCHA alternative using <a href="https://trycap.dev/guide/effectiveness?utm_source=github&utm_campaign=pow_link" target="_blank">proof-of-work</a> and <a href="https://trycap.dev/guide/instrumentation?utm_source=github&utm_campaign=inst_link" target="_blank">instrumentation challenges</a>. It's fast, private, and extremely simple to integrate.

<a href="https://trycap.dev/guide/demo?utm_source=github&utm_campaign=captcha_animated" target="_blank"><img src="./assets/captcha-animated.svg" alt="Priestess Verification widget" width="270"></a>

## Using the widget

The fork distributes the widget through jsDelivr's GitHub channel (there is no npm package):

```html
<!-- pin to a release tag in production, e.g. @v1.0.0 -->
<script src="https://cdn.jsdelivr.net/gh/KurisuRakko/priestess-verification@main/widget/src/cap.min.js"></script>

<!-- <site-key> comes from the admin console at https://verify.rakko.cn/admin (see "Registering a site") -->
<cap-widget data-cap-api-endpoint="https://verify.rakko.cn/<site-key>/"></cap-widget>
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

<cap-widget data-cap-api-endpoint="https://verify.rakko.cn/<site-key>/"></cap-widget>
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
| `POST /<siteKey>/challenge`, `POST /<siteKey>/redeem` | a registered site's endpoints (scope `site:<siteKey>`), CORS for that site's origins only |
| `POST /<siteKey>/siteverify` | a registered site's server-to-server validation, with that site's secret |
| `GET /admin` | admin console: register sites, edit their origins and settings, rotate secrets, view traffic statistics and manage verification-gate hosts (Priestess sign-in; `#stats` and `#gate` open the last two tabs) |
| `GET /admin/api/stats`, `/admin/api/gate…` | admin API behind the console for statistics and gate hosts (admin session required; see "Traffic statistics" and "Server-side gate") |
| `GET /protected`, `GET /protected/*` | server-side gate demo: a full-page challenge (403) until the visitor holds a pass, then a built-in example page |
| any path on a gate host (`GATE_UPSTREAMS` or a host added in `/admin`) | server-side gate in front of a whole site: challenge page until the visitor holds a pass, then reverse-proxied to the upstream origin; exempt paths and disabled hosts are proxied without a pass |
| `GET /__gate/widget.js`, `/__gate/mascot/*.webp`, `/__gate/*.wasm`, `/__gate/pako_inflate.min.js` | the assets above under the gate's reserved prefix, so the gate page stays same-origin on every gated host |
| `POST /__gate/challenge`, `POST /__gate/redeem`, `POST /__gate/pass`, `POST /__gate/logout` | the gate's own endpoints (scope `gate`); `/__gate/pass` (same-origin only) consumes a gate token and sets the pass cookie, `/__gate/logout` clears it |

The gate is routed first: `/__gate/*` is answered by the Worker on every host, and on a gate host (`GATE_UPSTREAMS` or a host added in `/admin`) every other path is gated and proxied — except exempt paths and disabled hosts, which are proxied without a pass — so `/admin`, the `/<siteKey>/…` routes and the rest of the table are only reachable on hosts that are not gate hosts.

The static assets (widget scripts, wasm, pako, mascot art) are public and always send `Access-Control-Allow-Origin: *`. `/challenge`, `/redeem` and their per-site versions echo the allowed `Origin` and send `Vary: Origin` unconditionally, including for requests without an `Origin` header, so a cached no-`Origin` variant can never be replayed to a CORS caller.

### Registering a site

Each embedder gets its own site in the admin console at `https://verify.rakko.cn/admin`: a 10-character site key, its own siteverify secret (shown once; only its sha256 is stored) and the browser origins allowed to call it. Tokens are bound to their site twice — the challenge scope is `site:<siteKey>` and the token's storage key carries the site key — so a token solved on one site can neither be redeemed nor verified on another, nor on the legacy routes.

Sites live in the `SiteRegistry` Durable Object. The Worker caches each lookup (including misses) for 30 seconds per isolate, so verification traffic only reads the registry on a cache miss and never writes to it; an edit in the console takes up to 30 seconds to reach every isolate. Disabled and deleted sites answer 404.

The console signs in through Priestess (Phainon app `priestess-verification`, native login-code flow with state + S256 PKCE). The Worker exchanges the login code, reads `/me` and revokes the Priestess refresh token straight away, all server-side; then it requires the Priestess `sub` to be listed in `ADMIN_ALLOWED_SUBS` (empty = nobody) and sets its own 8-hour `__Host-pv_admin` session cookie. Revoking a user in Priestess does not end a console session that already exists; it expires on its own, or immediately once the sub is removed from `ADMIN_ALLOWED_SUBS` and the Worker redeployed.

### Traffic statistics

The console's statistics tab (`/admin#stats`) reads counters kept in the `StatsStore` Durable Object (single instance, `getByName("global")`). The Worker records the following events; an empty reason cell means the event is recorded without a reason.

| Event | Reasons |
| --- | --- |
| `challenge_issued` | empty, `datacenter`, `warp`, `burst`, `datacenter+burst`, `warp+burst` |
| `redeem_ok` | |
| `redeem_fail` | `invalid_solution`, `expired`, `already_redeemed`, `instr_blocked`, `instr_timeout`, `invalid_token`, `bad_request`, `internal`, `other` |
| `siteverify_ok` | |
| `siteverify_fail` | `invalid_secret`, `token_not_found`, `token_expired`, `bad_request`, `internal`, `other` |
| `gate_shown` | |
| `gate_pass` | |
| `gate_pass_fail` | `token_not_found`, `token_expired`, `bad_request`, `other` |
| `rate_limited` | `challenge`, `redeem`, `gate_pass`, `siteverify` |

For `challenge_issued`, the reason states why the difficulty was raised (see [Adaptive difficulty](#adaptive-difficulty)); an empty reason means the challenge was issued at the configured difficulty. For `redeem_fail`, `instr_blocked` covers an instrumentation error or a `blockedBy` result, `invalid_token` includes a scope mismatch, `bad_request` covers `invalid_body`, `missing_token`, `missing_solutions` and `invalid_solutions`, and `internal` covers a nonce-store error and a missing `CAP_SECRET`. For `rate_limited`, the reason is the entry point that was limited.

The `site` dimension has three forms:

- a registered site's key, for `/<siteKey>/challenge`, `/<siteKey>/redeem` and `/<siteKey>/siteverify`;
- `gate:<host>`, with the request host lowercased, for `/__gate/*`, the gate page, `/protected` and pass handling;
- `default`, for `/challenge`, `/redeem`, `/siteverify` and the demo routes.

Counters are aggregated: one row per site, UTC hour, event and reason. The hour value is the Unix timestamp of the start of the UTC hour. Every write is an UPSERT that adds to the existing count. `recordEvent` writes through `ctx.waitUntil`, so recording neither delays nor fails the response; a failed write is logged. Without the `STATS_STORE` binding or an execution context, recording is a no-op.

Counters are retained for 90 days. Rows older than the retention window are deleted by the first write of each new UTC hour; no alarm is used for this cleanup, and an hour without traffic performs no deletion.

The store contains no IP address, User-Agent, cookie, session ID, token or country. The stored facts are the site identifier, the UTC hour, the event, the reason and the count. The client IP is used only as a rate-limit key and is never written to `StatsStore`.

Rejected requests are sampled for the `rate_limited` event: approximately one rejection in ten is written, with a weight of 10. The resulting counts are estimates for the limited entry point.

`GET /admin/api/stats` requires an admin session.

| Parameter | Meaning |
| --- | --- |
| `range` | `24h`, `7d` or `30d`; default `24h`. |
| `site` | Optional site key, `default`, or `gate:<host>`. |
| `tz` | Optional offset in minutes east of UTC; default `0`, range `-720` to `840`, rounded to a whole hour. |

`24h` produces 24 hourly buckets. `7d` and `30d` produce 7 and 30 daily buckets, with day boundaries at local midnight for `tz`. Buckets are contiguous, zero-filled and in ascending order; the last bucket contains the current moment.

The response has the following structure (a schema sketch, not literal JSON):

```text
{
  "range": "24h",
  "bucket": "hour",
  "tz": 660,
  "from": "<ISO 8601>",
  "to": "<ISO 8601>",
  "generatedAt": "<ISO 8601>",
  "site": null,
  "events": [ <the nine event names, in a fixed order> ],
  "totals": { <each of the nine event names>: 0 },
  "reasons": {
    "challenge_issued": { <reason>: 0 },
    "redeem_fail": { <reason>: 0 },
    "siteverify_fail": { <reason>: 0 },
    "gate_pass_fail": { <reason>: 0 },
    "rate_limited": { <reason>: 0 }
  },
  "series": [ { "t": "<ISO 8601>", <each of the nine event names>: 0 } ],
  "bySite": [
    { "site": "<site>", "label": "<label>", "kind": "site|gate|default", <each of the nine event names>: 0 }
  ]
}
```

`totals` and every `series` row always contain all nine event keys, with zero for an event that has no data. Each reason group is present; a group contains only the reasons that were recorded, and the empty reason is never listed. `reasons.challenge_issued` therefore holds only the raised challenges; the challenges issued at the configured difficulty are the difference between `totals.challenge_issued` and its sum. `bySite` always covers every site seen in the range, even when `site` is set; it is sorted by `challenge_issued` in descending order, then by site identifier. `label` is the registered site's name, the host for a `gate:<host>` entry, `default`, or the site key when the registry has no matching site.

With a session, invalid parameters answer `400` with `{ "error": "<short message>" }`, a non-GET request answers `405`, and a deployment without `STATS_STORE` answers `503`. Responses are sent with `Cache-Control: no-store`.

### Rate limiting

Four rate-limit bindings are configured in `wrangler.jsonc`; `RL_REDEEM` serves both redeem and gate-pass checks under different key prefixes, and `RL_CHALLENGE_SOFT` never refuses a request:

| Binding | Limit | Key prefix | Entry points |
| --- | --- | --- | --- |
| `RL_CHALLENGE` | 60 requests per 60 seconds | `challenge:` | `/challenge`, `/demo/challenge`, `/<siteKey>/challenge`, `/__gate/challenge` |
| `RL_REDEEM` | 30 requests per 60 seconds | `redeem:` | `/redeem`, `/demo/redeem`, `/<siteKey>/redeem`, `/__gate/redeem` |
| `RL_REDEEM` | 30 requests per 60 seconds | `gate_pass:` | `/__gate/pass` |
| `RL_SITEVERIFY` | 600 requests per 60 seconds | `siteverify:` | `/siteverify`, `/demo/siteverify`, `/<siteKey>/siteverify` |
| `RL_CHALLENGE_SOFT` | 15 requests per 60 seconds (soft) | `challenge_soft:` | the `RL_CHALLENGE` entry points |

The key is `<kind>:<CF-Connecting-IP>`. For rate limiting, the IP exists only in that key for the duration of the limit check; the Worker does not persist it. Limits are counted per Cloudflare location and are approximate by design.

The check runs before the rate-limited handler's Durable Object work. For a registered site's route it runs before that site's registry lookup, and for redeem, siteverify and gate-pass entries it runs before the token store is touched. If the binding is missing, the `CF-Connecting-IP` header is missing, or the binding throws, the request is allowed; rate limiting must not take verification down.

A limited request answers HTTP `429` with `Retry-After: 60` and the body

```json
{ "success": false, "reason": "rate_limited", "error": "Too many requests" }
```

Where the entry point sends CORS headers, the 429 response carries them as well; the `siteverify` endpoints send none. A limited request for an unknown site key answers `429` but is not counted, so random site keys cannot add statistics rows.

`RL_CHALLENGE_SOFT` is checked only after `RL_CHALLENGE` has let a challenge request through; a request refused by `RL_CHALLENGE` answers `429` and never reaches the soft limit. Exceeding the soft limit does not refuse the request: it raises the difficulty of the challenge (the `burst` signal, see [Adaptive difficulty](#adaptive-difficulty)). A missing binding, a missing `CF-Connecting-IP` header or a binding error counts as no burst.

### Proof of work

Production challenges use format 2 with HashWX: `CHALLENGE_PROTOCOLS` is `hashwx,instrumentation` in `wrangler.jsonc`. HashWX is a memory-hard hash with a randomly generated program per seed, so a GPU or a hand-written SHA-256 solver gains far less over a browser than it does against SHA-256. The widget downloads the HashWX module from `/hashwx.wasm`, which the Worker serves regardless of `CHALLENGE_PROTOCOLS`; the integration snippet in the console already sets `window.CAP_CUSTOM_HASHWX_URL` to it.

`instrumentation` must stay in the list. Format 1 (an empty `CHALLENGE_PROTOCOLS`) always runs the environment check; format 2 runs it only when `instrumentation` is listed. The gate adds it on its own, but registered sites and the legacy routes do not.

A HashWX challenge consists of `HASHWX_CHALLENGE_COUNT` sub-challenges, each with difficulty `HASHWX_DIFFICULTY / HASHWX_CHALLENGE_COUNT`. The client needs on average `HASHWX_DIFFICULTY` hash evaluations in total, so the solving time is proportional to `HASHWX_DIFFICULTY`. More sub-challenges lower the variance of the solving time; the server verifies one hash per sub-challenge.

The defaults, `HASHWX_DIFFICULTY` 150000 and `HASHWX_CHALLENGE_COUNT` 8, were calibrated with the real widget against a local Worker (Chromium, the median of seven complete verifications each). On an emulated low-end phone (four cores with a combined CPU budget of one sixth of four desktop cores, `navigator.hardwareConcurrency` = 4) a verification takes about 1.4 seconds; on an 8-core desktop it completes within the widget's minimum display time of one second. Chrome's DevTools CPU throttling does not apply to Web Workers, which do the hashing, so the emulation limits the browser's CPU with a cgroup quota instead. Verifying a solution costs the Worker well under one millisecond of CPU time per redeem.

To adjust the workload, change `HASHWX_DIFFICULTY` (1 to 1000000000) in `wrangler.jsonc` and redeploy; a registered site can override it in the console (高级设置, HashWX 难度). Double the value to double the expected solving time. `CHALLENGE_COUNT`, `CHALLENGE_SIZE` and `CHALLENGE_DIFFICULTY` only apply to SHA-256 challenges (format 1 or `sha256-pow`) and have no effect while the protocol is HashWX; the console hides these settings accordingly and marks stored overrides as not in effect.

#### Browsers without WebAssembly

HashWX has no JavaScript fallback: a browser that does not support WebAssembly, or has it disabled, cannot pass verification. This includes Safari with Lockdown Mode turned on in iOS or macOS; on some versions, adding the site as a Lockdown Mode exception does not restore WebAssembly (WebKit bug 273824). The widget then fails with `challenge_unsupported` ("hashwx requires WebAssembly"), and the gate page shows a dedicated failure message asking the visitor to turn off Lockdown Mode or use a different browser. A hashwx.wasm that fails to load or compile is reported the same way. There is deliberately no SHA-256 fallback for these browsers: an attacker would always choose the weaker path, which would remove the GPU resistance HashWX provides.

#### Content Security Policy for embedders

A page that embeds the widget under a Content Security Policy must allow the following, where `https://verify.rakko.cn` stands for this service's origin (the gate page's own policy, `contentSecurityPolicy` in `worker/src/gate.js`, is the reference):

- `script-src https://verify.rakko.cn 'wasm-unsafe-eval'`: `widget.js` and, on browsers without `DecompressionStream`, `pako_inflate.min.js` are loaded as scripts from the service; `'wasm-unsafe-eval'` permits `WebAssembly.compile`. The environment check runs one inline script in a sandboxed `srcdoc` iframe that inherits the page's policy and calls `eval`, so it also needs `'unsafe-eval'` and either `'unsafe-inline'` or a nonce passed through `window.CAP_SCRIPT_NONCE`.
- `connect-src https://verify.rakko.cn`: `cap_wasm_bg.wasm` and `hashwx.wasm` are downloaded with `fetch`, as are the `/challenge` and `/redeem` calls.
- `worker-src blob:`: the solver runs in a Web Worker created from a `blob:` URL.
- `img-src https://verify.rakko.cn`: the mascot images load from `mascot/` next to `widget.js`.
- `style-src 'unsafe-inline'`, or a nonce passed through `window.CAP_CSS_NONCE`: the widget's shadow-DOM styles are inline.

Without the `window.CAP_CUSTOM_*` overrides above, the wasm and pako URLs point at `https://cdn.jsdelivr.net` and that origin must be allowed instead.

### Adaptive difficulty

Every challenge entry point (`/challenge`, `/demo/challenge`, `/<siteKey>/challenge` and `/__gate/challenge`) assesses the request before any Durable Object is called and raises the workload when one of the following signals applies:

| Signal | Condition | Factor (variable, default) |
| --- | --- | --- |
| `datacenter` | `request.cf.asn` belongs to a cloud or hosting provider | `RISK_DATACENTER_FACTOR`, 4 |
| `warp` | `request.cf.asn` is a Cloudflare WARP egress | `RISK_WARP_FACTOR`, 6 |
| `burst` | the client IP exceeded `RL_CHALLENGE_SOFT` (15 challenges per 60 seconds) | `RISK_BURST_FACTOR`, 3 |

`datacenter` and `warp` are mutually exclusive: an AS number belongs to at most one list. When both an AS signal and `burst` apply, the factors are multiplied and the product is capped at `RISK_MAX_FACTOR` (default 18). The resulting reasons are `datacenter`, `warp`, `burst`, `datacenter+burst` (12) and `warp+burst` (18). All four factors are integers; the per-signal factors accept 1 to 1000 and the cap 1 to 1000000, and an invalid value fails every request with a logged configuration error.

The factor multiplies `HASHWX_DIFFICULTY` when the challenge carries HashWX, after any per-site override; at the defaults, the raised challenges carry 450000 (×3), 600000 (×4), 900000 (×6), 1800000 (×12) and 2700000 (×18). For SHA-256 challenges (format 1 or `sha256-pow`) the factor multiplies `CHALLENGE_COUNT` instead, up to 1000. The parameters are signed into the challenge (format 1: the JWT payload; format 2: the encrypted expectations inside the JWT), so redeem verifies the difficulty the client was given, not the current configuration, and an edited difficulty fails with `invalid_token` or `invalid_solution`.

The AS lists are `DATACENTER_ASNS` and `WARP_ASNS` in `worker/src/risk.js`, one AS number per line with its holder as a comment. They cover the major clouds (AWS, Google Cloud, Azure, Oracle Cloud, Alibaba Cloud, Tencent Cloud, Huawei Cloud) and common VPS providers (DigitalOcean, Akamai Connected Cloud/Linode, Vultr, Hetzner, OVH, Contabo, Scaleway, IT7/BandwagonHost, RackNerd, DMIT, Leaseweb, Hostinger). To maintain them:

- check a candidate on `https://bgp.he.net/AS<n>` and add it only if its address space is predominantly rented servers; leave it out when in doubt;
- never list privacy relays or consumer VPN egress networks. iCloud Private Relay egress operated by Akamai (AS36183, AS20940) and Fastly (AS54113) is deliberately absent, and so is Google's AS15169, which also carries Google's own privacy proxies;
- `RISK_EXTRA_ASNS` adds AS numbers to the hosting list and `RISK_EXEMPT_ASNS` exempts AS numbers from both lists, without a code change. Both take comma-separated AS numbers, with or without the `AS` prefix.

Cloudflare's AS13335 is treated as `warp`, because many VPN products now tunnel through WARP. Part of iCloud Private Relay's egress also uses AS13335, and those Private Relay users therefore receive the `warp` factor as well. AS209242 (Cloudflare London) is not listed: it originates customer prefixes announced through Cloudflare, not WARP egress.

Privacy: the AS number and the IP address are read only in memory while the challenge request is handled, compared against the lists and the soft limit, and discarded. They are never logged, written to storage or included in statistics; the statistics record only the resulting reason as a `challenge_issued` reason. Country and region are not used.

### Local development

```sh
cd worker
npm ci
cp .dev.vars.example .dev.vars   # then replace both secrets
npm run dev                      # http://127.0.0.1:8787
```

`worker/package-lock.json` is tracked in the repository; the root `.gitignore` excludes `package-lock.json` and then re-includes this file. CI installs with `npm ci`, so a dependency change must include the updated lockfile in the same commit.

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
npm ci                                       # required: wrangler.jsonc points its $schema at node_modules
npx wrangler login
npx wrangler secret put CAP_SECRET           # e.g. openssl rand -hex 32
npx wrangler secret put SITEVERIFY_SECRET    # e.g. openssl rand -hex 32
npx wrangler deploy
```

`ALLOWED_ORIGINS` is a comma separated list of extra browser origins allowed to call the legacy `/challenge` and `/redeem`; the worker's own origin is always allowed, and `/siteverify` never sends CORS headers. New embedders should be registered as sites in `/admin` instead, which needs no redeploy.

The deploy applies the `v2` (`SiteRegistry`) and `v3` (`StatsStore`) Durable Object migrations. The Phainon app `priestess-verification` must exist with `https://verify.rakko.cn` as its allowed origin and `https://verify.rakko.cn/admin/callback` as its return URL.

#### Continuous deployment

`.github/workflows/worker.yml` runs on pushes that touch `worker/**`, `core/**`, `vendor/rakko-design/**` or the workflow file, on pull requests to `main` that touch the same paths, and on manual dispatch.

The `test` job runs on Ubuntu with Node.js 22: `npm ci` in `worker/` (using `worker/package-lock.json` for the cache and the install), `npm test`, `npm run build:web`, a `git diff --exit-code -- src/generated` check that fails when the checked-in bundles are stale, and `node scripts/check-design.mjs` from the repository root.

The `deploy` job depends on `test`, runs only for a push to `main`, and uses the `worker-deploy` concurrency group without cancelling an in-progress deployment. Its first step reads `CLOUDFLARE_API_TOKEN`; when the secret is absent, the step records a notice and every remaining deploy step is skipped. Otherwise the job installs with `npm ci` and runs `npx wrangler deploy` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The workflow does not run `scripts/acceptance.mjs` or `scripts/browser-e2e.mjs`; those remain local checks.

The workflow needs two GitHub Actions repository secrets, which are separate from the Worker's own secrets set with `wrangler secret put`:

| Secret | Use |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Authenticates the deploy step; its absence skips the deploy. |
| `CLOUDFLARE_ACCOUNT_ID` | Selects the Cloudflare account for the deploy. |

Create the API token in the Cloudflare dashboard from the `Edit Cloudflare Workers` template, select this account under Account Resources, and include the `rakko.cn` zone under Zone Resources. Store the token as `CLOUDFLARE_API_TOKEN` and the account ID as `CLOUDFLARE_ACCOUNT_ID`; do not commit either value.

A push to `main` is the normal deployment path. A manual `npx wrangler deploy` from `worker/` remains available for a first deployment or when GitHub Actions is unavailable; it applies pending Durable Object migrations, including `v3` for `StatsStore`.

### Calling `/siteverify` from your backend

For a registered site, post to `/<siteKey>/siteverify` with that site's secret (the console shows the exact snippet). The legacy `/siteverify` uses the Worker-wide `SITEVERIFY_SECRET`. Both take the same shape as the standalone server:

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

All optional tuning lives in `wrangler.jsonc` under `vars` (defaults shown): `ALLOWED_ORIGINS` (`https://verify.rakko.cn`), `CHALLENGE_COUNT` (50), `CHALLENGE_SIZE` (32), `CHALLENGE_DIFFICULTY` (4), `INSTRUMENTATION_LEVEL` (3), `BLOCK_AUTOMATED_BROWSERS` (false), `TOKEN_TTL_MS` (20 min), `CHALLENGE_PROTOCOLS` (empty = format 1; `wrangler.jsonc` sets `hashwx,instrumentation`), `HASHWX_DIFFICULTY` (150000), `HASHWX_CHALLENGE_COUNT` (8), `RISK_DATACENTER_FACTOR` (4), `RISK_WARP_FACTOR` (6), `RISK_BURST_FACTOR` (3), `RISK_MAX_FACTOR` (18), `RISK_EXTRA_ASNS` and `RISK_EXEMPT_ASNS` (empty), and for the server-side gate `GATE_UPSTREAMS` (empty), `GATE_PASS_TTL_S` (1800), `GATE_COOKIE_DOMAIN` (empty = host-only), `GATE_BLOCK_AUTOMATED_BROWSERS` (true: gate challenges reject automated browsers regardless of `BLOCK_AUTOMATED_BROWSERS`). A registered site can override `CHALLENGE_COUNT`, `CHALLENGE_SIZE`, `CHALLENGE_DIFFICULTY`, `HASHWX_DIFFICULTY`, `TOKEN_TTL_MS` and `BLOCK_AUTOMATED_BROWSERS` for itself in the console; the console shows only the settings that apply to the protocol in effect, and saving keeps every setting it does not show or that was not changed.

Admin sign-in: `PRIESTESS_API_BASE` (`https://api.rakko.cn/auth/priestess/oidc`), `PRIESTESS_APP_ID` (`priestess-verification`), `ADMIN_ALLOWED_SUBS` (comma separated Priestess subs; empty lets nobody in).

Instrumentation obfuscation levels 4-10 fall back to a weaker script inside Workers, because `esbuild` (native binary) and `javascript-obfuscator` cannot run in workerd. Keep `INSTRUMENTATION_LEVEL` at 3 (the default) unless you have measured the trade-off yourself.

### Server-side gate

Besides the embeddable widget, the Worker can stand in front of a whole website, like Cloudflare's challenge page: a visitor without a valid pass gets a full-screen page (status 403, `Cache-Control: no-store`, `X-Robots-Tag: noindex`, a nonce-based CSP) on which a mascot + auto widget solves a challenge by itself, trades the token for a pass cookie at `POST /__gate/pass` and reloads the page they asked for. Non-HTML requests without a pass (API calls, `POST`s, anything whose `Accept` lacks `text/html`) get `403 {"success":false,"error":"gate_required"}`. Every gate response carries a random `X-Gate-Ray` request ID, also shown in the page footer. `/__gate/*` is reserved on every gated host and always answered by the Worker, never by the upstream.

On the Worker's own host only `/protected` and `/protected/*` are gated (a built-in example page with the pass's remaining time and a "clear the pass" button). To gate a real site, add the host in one of two ways:

- **In the console (recommended).** Open `/admin`, switch to the 验证网关 tab and add the hostname, its upstream origin, optional exempt paths and the enabled flag. This writes the `gate_hosts` table in `SiteRegistry`: the policy change needs no redeploy and reaches every isolate within 60 seconds. The hostname must still be routed to this Worker (see the routing requirement below); the console manages policy, not routing.
- **In `wrangler.jsonc`.** Map its public hostname to the origin that actually serves it:
   ```jsonc
   "GATE_UPSTREAMS": "{\"example.com\":\"https://origin.example.com\"}"
   ```
   Keys are bare hostnames, values bare `https:` origins; anything else fails every request with a logged config error. These hosts are read-only in the console and API, always enabled, and have no exempt paths.

Either way, route the hostname to this Worker, e.g. `"routes": [{ "pattern": "example.com/*", "zone_name": "example.com" }, …]`. The upstream must be reachable under a hostname that is **not** routed to this Worker (otherwise the proxy loops back into the gate).

An admin host is validated on write: `host` is a lowercase bare hostname without a port, must not be one of the Worker's own hosts, and `upstream` must be a bare `https:` origin whose hostname differs from `host`; the table holds at most 200 hosts. A host cannot live in both sources: `GATE_UPSTREAMS` wins at request time, and the admin API answers `409` when asked to create, update or delete a configured host. A duplicate admin host also answers `409`.

An exempt path is proxied to the upstream without a pass check. An entry ending in `/` matches as a prefix (`/api/` covers `/api/x`); any other entry matches exactly, or matches a path that starts with the entry followed by `/` (`/robots.txt` covers `/robots.txt` and `/robots.txt/x`, not `/robots.txtx`). The pathname comes from the parsed request URL, so `..` segments are already resolved; a pathname that still contains `%2f`, `%5c`, `%2e` or `%3b`, in either case, or a literal `;`, never matches, because origins such as Tomcat or Spring normalise `..;` to `..`. An admin host accepts at most 50 exempt paths, each starting with `/`, at most 256 characters, with no `?`, `#`, `..` or whitespace, not `/`, not under `/__gate/`, and duplicates are removed. When `enabled` is `false`, every request outside `/__gate/` is proxied to the upstream without a pass check; `/__gate/*` is still answered by the Worker.

Each isolate caches the complete admin host table and refreshes it after 60 seconds; a write through the admin API drops the snapshot in the isolate that handled it immediately, so other isolates normally pick the change up within 60 seconds. If a refresh fails while an older snapshot exists, that snapshot keeps serving and the read is retried after 5 seconds (`GATE_RETRY_MS` in `worker/src/gate-hosts.js`). `selfHosts` is derived from the hostnames in `ALLOWED_ORIGINS`, minus any host that `GATE_UPSTREAMS` gates; these are the hostnames on which the Worker answers as itself. Requests to a self host never read the gate host table, and the admin API rejects an attempt to add one as a gate host.

Passed requests are proxied with their method, headers and body intact (`redirect: "manual"`), with `X-Forwarded-Host` / `X-Forwarded-Proto` set, our `__pv_pass` cookie removed from `Cookie`, and `Location` headers that point at the upstream origin rewritten onto the public host. `Origin` and `Referer` still name the public host, so an origin with strict CSRF checks must accept it.

The pass is the `__pv_pass` cookie, `1.<exp>.<mac>`, with `HttpOnly; Secure; SameSite=Lax; Path=/` and `Max-Age` = `GATE_PASS_TTL_S` (default 1800, 60–86400). `mac` is an HMAC-SHA256 over the host (or cookie domain, below), the expiry and a SHA-256 of the `User-Agent`; it is not bound to the IP, so it survives network changes, and is checked in constant time. The key is the `GATE_COOKIE_SECRET` secret (`npx wrangler secret put GATE_COOKIE_SECRET`); when unset it is derived from `SITEVERIFY_SECRET` as HMAC-SHA256(SITEVERIFY_SECRET, `"gate-cookie"`), so rotating either secret invalidates every pass. Gate tokens are single use, and gate, site and demo tokens never cross scopes (`/__gate/pass` rejects site/demo tokens, `/siteverify` and `/demo/siteverify` reject gate tokens). The `return` path posted to `/__gate/pass` must be a same-origin path (starting with a single `/`); anything else redirects to `/`.

`GATE_COOKIE_DOMAIN` (optional, e.g. `rakko.cn` or `.rakko.cn`) shares one pass across subdomains: the cookie is then set (and cleared) with `Domain=rakko.cn` and signed for the domain instead of the host, so a pass earned on `a.rakko.cn` is accepted on `b.rakko.cn` and `rakko.cn`, but never on `evil-rakko.cn` or `rakko.cn.evil.com`. A request host outside the domain keeps the host-only behaviour. Every subdomain — including ones that are not gated or not yours to trust — can then read the cookie; it only proves that a browser with this `User-Agent` passed a verification, it is not a session or an identity, so do not use it as one.

When a gate check fails, the page classifies the cause into one of five kinds and shows the matching label, a handling hint, a retry control and an error code, in Chinese or English selected from `Accept-Language`: `rate_limited` (too many requests from this network; wait one minute), `env_blocked` (an instrumentation block or timeout; disable script-modifying extensions or update the browser), `expired` (a challenge or token that expired or was already used; verify again), `network` (a fetch, JSON-parse or wasm-load failure; check the connection), and `unknown` (anything else; verify again, and give the session ID at the bottom of the page to the site administrator). The page does not include contact details.

### Free plan capacity

Cloudflare's free-tier limits ([Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), last updated Aug 25, 2026): **100,000 requests/day** (the page states requests "Includes HTTP requests, RPC sessions, WebSocket messages, and alarm invocations") and **100,000 rows written/day**, with the footnotes "Each `setAlarm()` is billed as a single row written" and "Deletes are counted as rows written".

One full verification (`/challenge` → `/redeem` → `/siteverify`) costs:

| Metered dimension | Cost per verification | Free limit ÷ cost |
| --- | --- | --- |
| Durable Object rows written | **6** — the three token-store writes (redeem INSERT, siteverify UPDATE, sweep DELETE) and three `StatsStore` UPSERTs (`challenge_issued`, `redeem_ok`, `siteverify_ok`) | **16,666 / day** |
| Durable Object requests | **5** — one to redeem and one to verify (token store) plus three `StatsStore` `record` RPCs | 20,000 / day |
| Worker requests | **3** — challenge, redeem, siteverify (the widget/page itself is cached) | ~33,000 / day |

So the free plan supports **~16,666 verifications/day**, and **rows written is still the binding limit**. The statistics add one `record` RPC and one row write per recorded event: `challenge_issued`, `redeem_ok` and `siteverify_ok` each cost one `StatsStore` call and one UPSERT, which doubles rows written from 3 to 6 and halves the ceiling from ~33,333 to ~16,666. The counters stay compact — one row per site, UTC hour, event and reason, not one row per verification. The hourly retention purge is an extra `DELETE` on the first write of each new UTC hour; its cost is proportional to the number of counter rows in the expired hour, not to verification volume, so it does not change the per-verification figure. That is why the token store keeps one row per redeem — the challenge claim and the token are the same row — has **no secondary indexes** (every index entry is billed as an extra row written on insert and delete), keeps the alarm cadence at 5 minutes and only calls `setAlarm()` when none is pending (4 shards × 288 alarms/day ≈ 1,150 alarms and ≈ 1,150 extra row writes per day, i.e. ~1% of the rows-written budget).

Expired rows are still cleaned up: deletes happen opportunistically on write (at most once per 5 minutes per shard) and from the alarm while rows remain; a row that outlives its `expires` is rejected by `/siteverify` with `Token expired` because the expiry is checked on read, so the sweep is about storage hygiene, not correctness. The atomicity and single-use guarantees are unchanged: the redeem INSERT is "insert if absent" (a replayed challenge gets `already_redeemed`), and verification is a single conditional `UPDATE … RETURNING` that can only succeed once.

These figures are the free plan's. The Workers Paid plan has different included allowances and overage pricing for Durable Object requests and rows written; recompute against that plan's current pricing before sizing a deployment.

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
