/**
 * The showcase page served at `/`: a server-rendered shell around the React
 * app in `web/src/showcase/` (built by `npm run build:web` into
 * `src/generated/showcase.client.js` + `showcase.css`, inlined here by
 * wrangler's Text rules).
 *
 * The shell carries everything the page needs before (or without) React:
 *
 *   - the theme boot script: `<html data-theme>` from `pv-theme` in
 *     localStorage, else the OS preference, before the first frame;
 *   - the `window.CAP_CUSTOM_*` variables, which point the widget's wasm and
 *     pako fetches at this origin instead of jsDelivr — they must be set
 *     before the widget script loads;
 *   - `/widget.js`, ahead of the app so `<cap-widget>` is defined when React
 *     mounts;
 *   - `#page-config` (endpoint, siteverify route, the variant list) for React;
 *   - a minimal first frame inside `#root` (the hero's eyebrow, title and
 *     lede with the same classes React renders, plus `<noscript>`), which
 *     React replaces when it mounts, and the provenance footer.
 *
 * The variants (`/#auto`, `/#invisible`, `/#click`, `/#mascot`,
 * `/#mascot-auto`, `/#bare`, `/#bare-auto`) solve a real challenge against
 * `/demo/challenge` + `/demo/redeem`, which issue demo-scoped tokens, and send
 * the token to `POST /demo/siteverify` — a same-origin-only route that runs
 * the exact same server-side verification as `/siteverify` with the Worker's
 * secret, so no secret ever reaches the browser. The mascot variants need no
 * image URL: the widget's default `<script directory>/mascot/` base resolves
 * to `/mascot/*.webp` on this origin. Every asset URL carries a `?v=` content
 * hash (`versionedPath` in `src/widget.js`), so after a deploy no browser
 * pairs this page with a widget it cached earlier.
 */

import appScript from "./generated/showcase.client.js";
import appCss from "./generated/showcase.css";

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// Text that ends up inside a raw-text <style>/<script> element must not be
// able to close it early.
function rawText(source, tag) {
  if (new RegExp(`</${tag}`, "i").test(source)) {
    throw new Error(`demo page: inlined ${tag} contains a closing </${tag}>`);
  }
  return source;
}

const APP_CSS = rawText(appCss, "style");
const APP_SCRIPT = rawText(appScript, "script");

// Runs in <head> so the first frame already has the right theme.
const THEME_BOOT = `(() => {
        let theme = null;
        try { theme = localStorage.getItem("pv-theme"); } catch {}
        if (theme !== "light" && theme !== "dark") {
          theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        }
        document.documentElement.dataset.theme = theme;
      })();`;

/**
 * The variants, in the order the page offers them. `invisible` uses the
 * widget's programmatic `new Cap()`; `bare` drops the card background and
 * border (`--cap-background` / `--cap-border-color: transparent`).
 */
const VARIANTS = [
  { id: "auto", tags: ["auto"], auto: true },
  { id: "invisible", tags: ["auto", "invisible"], invisible: true },
  { id: "click", tags: ["click"] },
  { id: "mascot", tags: ["click", "mascot"], mascot: true },
  { id: "mascot-auto", tags: ["auto", "mascot"], mascot: true, auto: true },
  { id: "bare", tags: ["click", "mascot", "bare"], mascot: true, bare: true },
  {
    id: "bare-auto",
    tags: ["auto", "mascot", "bare"],
    mascot: true,
    auto: true,
    bare: true,
  },
];

const REPO = "https://github.com/KurisuRakko/priestess-verification";

const PAGE_CONFIG = jsonForScript({
  endpoint: "/demo/",
  siteverify: "/demo/siteverify",
  repo: REPO,
  variants: VARIANTS,
});

export function renderDemoPage({ widget, capWasm, hashwx, pako }) {
  // Relative URLs keep the widget same-origin no matter how the page is
  // reached. An absolute `url.origin` would break `wrangler dev`, where the
  // custom-domain route makes the Worker see `http://verify.rakko.cn` while
  // the browser is talking to `http://127.0.0.1:8787`.
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Priestess Verification</title>
    <link rel="icon" href="data:," />
    <meta name="description" content="Self-hosted proof-of-work CAPTCHA — seven live variants of the Priestess Verification widget." />
    <script>
      ${THEME_BOOT}
    </script>
    <style data-app="showcase">
${APP_CSS}
    </style>
  </head>
  <body>
    <div id="root">
      <main class="pv-page">
        <header class="pv-hero">
          <p class="pv-eyebrow">Proof of work · Self-hosted</p>
          <h1 class="pv-hero__title">Priestess Verification</h1>
          <p class="pv-hero__lede">A self-hosted proof-of-work CAPTCHA with no image puzzles and no tracking.</p>
          <noscript><p class="pv-noscript">The live demos need JavaScript.</p></noscript>
        </header>
      </main>
    </div>

    <footer class="pv-footer">
      Based on Cap by Tiago (Apache-2.0) —
      <a href="https://github.com/tiagozip/cap">tiagozip/cap</a>.
      Source:
      <a href="${REPO}">KurisuRakko/priestess-verification</a>.
      Demo tokens are scoped to this page and never accepted by <code>/siteverify</code>.
    </footer>

    <script type="application/json" id="page-config">${PAGE_CONFIG}</script>
    <script>
      window.CAP_CUSTOM_WASM_URL = ${jsonForScript(capWasm)};
      window.CAP_CUSTOM_HASHWX_URL = ${jsonForScript(hashwx)};
      window.CAP_PAKO_URL = ${jsonForScript(pako)};
    </script>
    <script src="${widget}"></script>
    <script>
${APP_SCRIPT}
    </script>
  </body>
</html>
`;
}
