/**
 * The server-side gate's two pages (see `gate.js`), both a server-rendered
 * shell around one React bundle (`web/src/gate/`, built by
 * `npm run build:web` into `src/generated/gate.client.js` + `gate.css`),
 * which renders the view named in the page config:
 *
 *   - `renderGatePage` (`view: "challenge"`): the full-screen challenge
 *     (status 403) shown in place of any gated page while the visitor has no
 *     valid pass. An auto widget, kept out of sight, solves on its own (the
 *     mascot beside the status shows how it goes) and the `solve` token goes
 *     to `POST /__gate/pass`, which sets the pass cookie; the page
 *     then `location.replace()`s itself to the URL it was shown on.
 *   - `renderProtectedPage` (`view: "passed"`): the built-in example behind
 *     `/protected`, which shows the pass's remaining lifetime and can clear it.
 *
 * Both are rendered in the visitor's `Accept-Language` (Chinese or English,
 * `pickLang` in gate.js) and follow the OS theme. The shell renders a first
 * frame inside `#root` — the same markup the app mounts, with the copy taken
 * from the app's own `web/src/gate/strings.ts` — that React swaps for its own
 * in one task, plus the footer with the session ID (also sent as
 * `X-Gate-Ray`), whose copy button the app portals into a reserved slot.
 *
 * Every asset URL is same-origin under `/__gate/` (also on proxied hosts, where
 * `/` belongs to the upstream site), and the pages run under a nonce-based CSP
 * (see `contentSecurityPolicy` in `gate.js`): every inline script carries the
 * nonce, and `window.CAP_SCRIPT_NONCE` hands it to the widget's sandboxed
 * instrumentation iframe. The bundle is inline too, so nothing but the widget
 * and its wasm/mascot assets is fetched.
 */

import {
  fill,
  formatLeft,
  glyphMarkup,
  mascotMarkup,
  passFacts,
  secondsLeft,
  withHost,
} from "../web/src/gate/common.ts";
import { STRINGS } from "../web/src/gate/strings.ts";
import appScript from "./generated/gate.client.js";
import appCss from "./generated/gate.css";

function rawText(source, tag) {
  if (new RegExp(`</${tag}`, "i").test(source)) {
    throw new Error(`gate page: inlined ${tag} contains a closing </${tag}>`);
  }
  return source;
}

const APP_CSS = rawText(appCss, "style");
const APP_SCRIPT = rawText(appScript, "script");

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Follows the OS theme, before the first frame and live afterwards.
const THEME_BOOT = `(() => {
        const media = matchMedia("(prefers-color-scheme: dark)");
        const apply = () => {
          document.documentElement.dataset.theme = media.matches ? "dark" : "light";
        };
        apply();
        media.addEventListener("change", apply);
      })();`;

// The first frame: the same markup the React app (web/src/gate/) mounts, so
// taking over moves nothing. The copy comes from the app's own strings module
// and the mascot and countdown format from its common.ts.
function challengeFrame(s, { host, endpoint }) {
  return `      <main class="pv-gate" data-phase="checking">
        <section class="pv-gate__body" aria-labelledby="gate-title">
          <h1 class="pv-gate__title" id="gate-title">${escapeHtml(host)}</h1>
          <p class="pv-gate__subtitle"><span class="rk-swap-text">${escapeHtml(s.subChecking)}</span></p>
          <noscript>
            <p class="pv-gate__noscript">${escapeHtml(STRINGS.zh.noscript)}<br />${escapeHtml(STRINGS.en.noscript)}</p>
            <style>.pv-gate__status { display: none; }</style>
          </noscript>
          <div class="pv-gate__status">
            ${mascotMarkup(endpoint, "checking", "pv-gate__mascot")}<div class="pv-gate__state"><p class="pv-gate__state-text"><span aria-live="polite"><span class="rk-swap-text">${escapeHtml(s.statusSteps.checking[0])}</span></span></p><p class="pv-gate__hint"><span class="rk-swap-text">${escapeHtml(s.hintWorking)}</span></p></div><div class="pv-gate__engine" aria-hidden="true" inert=""></div>
          </div>
          <p class="pv-gate__explain">${escapeHtml(withHost(s.explain, host))}</p>
        </section>
      </main>`;
}

// NumberRoll's markup with its cells still empty (the CSS draws each digit
// from data-c until the component fills them in).
function numberRollMarkup(value) {
  const chars = Array.from(value);
  const cells = chars
    .map((char, index) => {
      const r = chars.length - 1 - index;
      return /[0-9]/.test(char)
        ? `<span class="rk-number-roll__digit" data-r="${r}" data-c="${char}" aria-hidden="true"></span>`
        : `<span aria-hidden="true">${escapeHtml(char)}</span>`;
    })
    .join("");
  return `<span class="rk-number-roll"><span class="rk-number-roll__text">${escapeHtml(value)}</span>${cells}</span>`;
}

function passedFrame(s, facts, expiresAt) {
  const { host } = facts;
  const filled = passFacts(facts, s);
  const left = formatLeft(secondsLeft(expiresAt, Date.now()));
  const steps = s.steps
    .map(
      (step, index) => `
              <div class="rk-list-row" role="listitem" data-leading=""><span class="rk-list-row__leading"><span class="pv-pass__step">${index + 1}</span></span><span class="rk-list-row__body"><span class="pv-pass__step-title">${escapeHtml(step.title)}</span><span class="pv-pass__step-text">${escapeHtml(fill(step.text, filled))}</span></span></div>`,
    )
    .join("");
  return `      <header class="rk-top-bar pv-pass-bar" data-glass="chrome" data-reveal="scroll" data-at-top="" style="--rk-glass-reveal: 120px;">
        <div class="rk-top-bar__title pv-pass-bar__title">${glyphMarkup("shield", "pv-pass-bar__icon")}<span class="pv-pass-bar__host">${escapeHtml(host)}</span></div>
        <div class="rk-top-bar__actions" role="group" aria-label="${escapeHtml(s.verified)}"><span class="pv-pass-badge">${glyphMarkup("check", "pv-pass-badge__icon")}<span>${escapeHtml(s.verified)}</span></span></div>
      </header>
      <main class="pv-pass">
        <section class="pv-pass__card" aria-labelledby="pass-heading">
          <p class="pv-pass__eyebrow">${escapeHtml(s.passedEyebrow)}</p>
          <h1 class="pv-pass__title" id="pass-heading">${escapeHtml(s.passedHeading)}</h1>
          <p class="pv-pass__lede">${escapeHtml(fill(s.passedLede, filled))}</p>
          <div class="pv-pass__timer">
            <p class="pv-pass__label">${escapeHtml(s.remaining)}</p>
            <p class="pv-pass__clock" role="timer">${numberRollMarkup(left)}</p>
            <p class="pv-pass__expires"><span class="rk-swap-text">&nbsp;</span></p>
          </div>
          <div class="pv-pass__actions"><button type="button" class="rk-button rk-button--secondary"><span class="rk-swap-text">${escapeHtml(s.logout)}</span></button></div>
        </section>
        <section class="rk-list-group pv-pass__how">
          <h2 class="rk-list-group__header" id="pass-how">${escapeHtml(s.howHeading)}</h2>
          <div class="rk-list-group__card" role="list" aria-labelledby="pass-how">${steps}
          </div>
          <p class="rk-list-group__footer">${escapeHtml(fill(s.howFooter, filled))}</p>
        </section>
      </main>`;
}

// "Powered by {name}", with the name as the link to the project.
function poweredBy(s) {
  const [before, after = ""] = s.poweredBy.split("{name}");
  return `${escapeHtml(before)}<a href="https://github.com/KurisuRakko/priestess-verification" rel="noopener">Priestess Verification</a>${escapeHtml(after)}`;
}

function shell({ s, title, view, nonce, assets, config, firstFrame, ray }) {
  const n = escapeHtml(nonce);
  return `<!DOCTYPE html>
<html lang="${s.htmlLang}" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${escapeHtml(title)}</title>
    <link rel="icon" href="data:," />
    <script nonce="${n}">
      ${THEME_BOOT}
    </script>
    <style data-app="gate">
${APP_CSS}
    </style>
  </head>
  <body data-gate-view="${view}">
    <div id="root">
${firstFrame}
    </div>
    <footer class="pv-footer pv-gate-footer">
      <span class="pv-gate-footer__ray">${escapeHtml(s.ray)} <code>${escapeHtml(ray)}</code><span class="pv-gate-footer__copy" id="gate-ray-copy"></span></span>
      <span class="pv-gate-footer__dot" aria-hidden="true">·</span>
      <span>${poweredBy(s)}</span>
    </footer>
    <script type="application/json" id="page-config">${jsonForScript(config)}</script>
    <script nonce="${n}">
      window.CAP_CUSTOM_WASM_URL = ${jsonForScript(assets.capWasm)};
      window.CAP_CUSTOM_HASHWX_URL = ${jsonForScript(assets.hashwx)};
      window.CAP_PAKO_URL = ${jsonForScript(assets.pako)};
      window.CAP_SCRIPT_NONCE = ${jsonForScript(nonce)};
    </script>
    ${view === "challenge" ? `<script nonce="${n}" src="${escapeHtml(assets.widget)}"></script>` : ""}
    <script nonce="${n}">
${APP_SCRIPT}
    </script>
  </body>
</html>
`;
}

/**
 * `passTtlS` is the pass lifetime, stated on the example page (the challenge
 * only passes it on in its config); `passDomain` (the example page only) the
 * parent domain the pass cookie is set for on this
 * host, null for a host-only pass. Both go into the page config too.
 */
export function renderGatePage({ assets, host, lang, nonce, ray, passTtlS }) {
  const s = STRINGS[lang] ?? STRINGS.en;
  const endpoint = "/__gate/";
  return shell({
    s,
    title: withHost(s.gateTitle, host),
    view: "challenge",
    nonce,
    assets,
    ray,
    firstFrame: challengeFrame(s, { host, endpoint }),
    config: {
      view: "challenge",
      host,
      ray,
      lang,
      endpoint,
      passTtlS,
    },
  });
}

export function renderProtectedPage({
  assets,
  host,
  lang,
  nonce,
  ray,
  expiresAt,
  passTtlS,
  passDomain,
}) {
  const s = STRINGS[lang] ?? STRINGS.en;
  return shell({
    s,
    title: `${s.passedTitle} · ${host}`,
    view: "passed",
    nonce,
    assets,
    ray,
    firstFrame: passedFrame(s, { host, passTtlS, passDomain }, expiresAt),
    config: {
      view: "passed",
      host,
      ray,
      lang,
      endpoint: "/__gate/",
      expiresAt,
      passTtlS,
      passDomain,
    },
  });
}
