/**
 * The admin console (`GET /admin`) and the Priestess callback page
 * (`GET /admin/callback`): a server-rendered shell around one React bundle
 * (`web/src/admin/`, built by `npm run build:web` into
 * `src/generated/admin.client.js` + `admin.css`), which renders the view named
 * in the page config:
 *
 *   - `console`: asks `/admin/api/me` whether a session exists and shows
 *     either the sign-in panel or the console (sites, statistics,
 *     verification gate);
 *   - `callback`: posts the login code from the URL fragment to
 *     `/admin/api/session` and moves on (see `web/src/admin/callback.ts`).
 *
 * Both are served with a per-request CSP nonce (see `admin/index.js`): every
 * `<style>` and `<script>` carries it, nothing else inline runs. The bundle
 * reads the nonce from its own script element and hands it to Base UI, whose
 * runtime `<style>` elements need it too. The theme boot script sets
 * `<html data-theme>` from `pv-theme` in localStorage (shared with the
 * showcase), else the OS preference, before the first frame.
 */

import appScript from "../generated/admin.client.js";
import appCss from "../generated/admin.css";

function rawText(source, tag) {
  if (new RegExp(`</${tag}`, "i").test(source)) {
    throw new Error(`admin page: inlined ${tag} contains a closing </${tag}>`);
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

const THEME_BOOT = `(() => {
        let theme = null;
        try { theme = localStorage.getItem("pv-theme"); } catch {}
        if (theme !== "light" && theme !== "dark") {
          theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        }
        document.documentElement.dataset.theme = theme;
      })();`;

const NOSCRIPT = "后台需要启用 JavaScript。";

function shell({ nonce, title, config }) {
  const n = escapeHtml(nonce);
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(title)}</title>
    <link rel="icon" href="data:," />
    <script nonce="${n}">
      ${THEME_BOOT}
    </script>
    <style nonce="${n}" data-app="admin">
${APP_CSS}
    </style>
  </head>
  <body>
    <div id="root">
      <noscript><p class="pv-noscript">${escapeHtml(NOSCRIPT)}</p></noscript>
    </div>
    <script type="application/json" id="page-config" nonce="${n}">${jsonForScript(config)}</script>
    <script nonce="${n}">
${APP_SCRIPT}
    </script>
  </body>
</html>
`;
}

export function renderAdminPage({ nonce }) {
  return shell({
    nonce,
    title: "Priestess Verification 后台",
    config: { view: "console" },
  });
}

export function renderCallbackPage({ nonce }) {
  return shell({
    nonce,
    title: "正在登录…",
    config: { view: "callback" },
  });
}
