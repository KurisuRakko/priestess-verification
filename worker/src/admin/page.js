/**
 * The admin console (`GET /admin`) and the Priestess callback page
 * (`GET /admin/callback`).
 *
 * Both pages are served with a per-request CSP nonce (see `admin/index.js`):
 * every inline `<style>` and `<script>` carries it, nothing else inline runs.
 * The console itself is static; `admin.client.js` asks `/admin/api/me`
 * whether a session exists and shows either the sign-in panel or the console
 * (sites, statistics, verification gate). Styling follows the showcase page:
 * Rakko Design's tokens, glass and state layer from `vendor/rakko-design/`,
 * plus the plain-CSS halves of the tabs, segmented choice and switch
 * primitives (the console has no React, so it reuses their class names on
 * hand-built markup), then `admin.css`.
 */

import glassCss from "../../../vendor/rakko-design/design-system/src/glass.css";
import stateLayerCss from "../../../vendor/rakko-design/design-system/src/state-layer.css";
import segmentedCss from "../../../vendor/rakko-design/react/src/segmented-choice/segmented-choice.css";
import switchCss from "../../../vendor/rakko-design/react/src/switch/switch.css";
import tabsCss from "../../../vendor/rakko-design/react/src/tabs/tabs.css";
import tokensCss from "../../../vendor/rakko-design/tokens.generated.css";
import adminScript from "./admin.client.js";
import adminCss from "./admin.css";

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function rawText(source, tag) {
  if (new RegExp(`</${tag}`, "i").test(source)) {
    throw new Error(`admin page: inlined ${tag} contains a closing </${tag}>`);
  }
  return source;
}

const VENDOR_CSS = rawText(
  [tokensCss, glassCss, stateLayerCss, tabsCss, segmentedCss, switchCss].join("\n"),
  "style",
);
const PAGE_CSS = rawText(adminCss, "style");
const APP_SCRIPT = rawText(adminScript, "script");

const THEME_BOOT = `(() => {
        let theme = null;
        try { theme = localStorage.getItem("pv-theme"); } catch {}
        if (theme !== "light" && theme !== "dark") {
          theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        }
        document.documentElement.dataset.theme = theme;
      })();`;

const ICON_MARK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V6z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4"/></svg>';
const ICON_SUN =
  '<svg class="icon-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></svg>';
const ICON_MOON =
  '<svg class="icon-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
const ICON_PLUS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_REFRESH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
const ICON_LOGOUT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/></svg>';

function head(nonce, title) {
  return `<meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${title}</title>
    <link rel="icon" href="data:," />
    <script nonce="${nonce}">
      ${THEME_BOOT}
    </script>
    <style nonce="${nonce}" data-vendor="rakko-design">
${VENDOR_CSS}
    </style>
    <style nonce="${nonce}" data-page>
${PAGE_CSS}
    </style>`;
}

function topbar(extra = "", themeToggle = true) {
  return `<header class="topbar" data-glass="chrome">
      <div class="topbar-inner">
        <a class="brand" href="/admin">
          <span class="brand-mark">${ICON_MARK}</span>
          <span>Priestess Verification <span class="brand-sub">· 后台</span></span>
        </a>
        ${extra}
        ${themeToggle ? `<button id="theme-toggle" class="icon-button" type="button" data-ripple data-ripple-centered aria-label="切换深色模式">${ICON_SUN}${ICON_MOON}</button>` : ""}
      </div>
    </header>`;
}

export function renderAdminPage({ nonce, ripple }) {
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
  <head>
    ${head(nonce, "Priestess Verification 后台")}
  </head>
  <body>
    ${topbar(`<span class="user-name" id="user-name" hidden></span>
        <button id="logout" class="icon-button" type="button" data-ripple hidden>${ICON_LOGOUT}<span>退出</span></button>`)}

    <main class="main">
      <section id="login-view" hidden>
        <div class="login-panel" data-glass="panel">
          <h1>站点后台</h1>
          <p>使用 Priestess 账号登录后，可管理接入站点、域名与密钥。</p>
          <p class="notice" id="login-error" role="alert" hidden></p>
          <a class="button is-primary" href="/admin/login" data-ripple>使用 Priestess 登录</a>
        </div>
      </section>

      <section id="console-view" hidden>
        <div class="rk-tabs view-tabs" id="view-tabs" role="tablist" aria-label="后台页面">
          <button class="rk-tab" id="tab-sites" type="button" role="tab" data-view="sites" aria-controls="view-sites" aria-selected="true" data-ripple>站点</button>
          <button class="rk-tab" id="tab-stats" type="button" role="tab" data-view="stats" aria-controls="view-stats" aria-selected="false" tabindex="-1" data-ripple>统计</button>
          <button class="rk-tab" id="tab-gate" type="button" role="tab" data-view="gate" aria-controls="view-gate" aria-selected="false" tabindex="-1" data-ripple>验证网关</button>
          <span class="rk-tabs__indicator" id="view-tabs-indicator" aria-hidden="true"></span>
        </div>

        <section class="view" id="view-sites" role="tabpanel" aria-labelledby="tab-sites">
          <div class="console-head">
            <div>
              <h1>站点</h1>
              <p>每个站点拥有独立的 site key、密钥与允许的域名。修改将在 30 秒内生效。</p>
            </div>
            <button id="new-site" class="button is-primary" type="button" data-ripple>${ICON_PLUS}<span>新建站点</span></button>
          </div>
          <ul class="site-list" id="site-list"></ul>
          <p class="empty" id="site-empty" hidden>暂无站点。新建站点后，将接入代码添加至目标网站即可。</p>
        </section>

        <section class="view" id="view-stats" role="tabpanel" aria-labelledby="tab-stats" hidden>
          <div class="console-head">
            <div>
              <h1>统计</h1>
              <p id="stats-period">按时间段汇总的挑战、验证与网关计数。</p>
            </div>
            <button id="stats-refresh" class="button" type="button" data-ripple>${ICON_REFRESH}<span>刷新</span></button>
          </div>
          <div class="toolbar">
            <div class="rk-segments range-choice" id="stats-range" role="radiogroup" aria-label="时间范围">
              <button class="rk-segment" type="button" role="radio" data-range="24h" aria-checked="true" data-checked data-ripple>24 小时</button>
              <button class="rk-segment" type="button" role="radio" data-range="7d" aria-checked="false" tabindex="-1" data-ripple>7 天</button>
              <button class="rk-segment" type="button" role="radio" data-range="30d" aria-checked="false" tabindex="-1" data-ripple>30 天</button>
            </div>
            <label class="select-field">
              <span class="field-label">站点</span>
              <select class="input" id="stats-site">
                <option value="">全部站点</option>
              </select>
            </label>
          </div>
          <p class="notice" id="stats-error" role="alert" hidden></p>
          <div id="stats-body" aria-busy="true">
            <ul class="metrics" id="stats-metrics" aria-label="主要指标"></ul>
            <p class="empty" id="stats-empty" hidden>所选时间范围内没有记录。</p>
            <div id="stats-detail">
              <section class="panel" data-glass="panel" aria-labelledby="stats-chart-title">
                <div class="panel-head">
                  <h2 id="stats-chart-title">验证结果趋势</h2>
                  <ul class="legend" aria-label="图例">
                    <li><span class="swatch is-ok" aria-hidden="true"></span>验证通过</li>
                    <li><span class="swatch is-fail" aria-hidden="true"></span>验证失败</li>
                  </ul>
                </div>
                <div class="chart" id="stats-chart"></div>
                <p class="field-hint" id="stats-chart-hint">将指针悬停于柱上，或聚焦图表后使用左右方向键，可查看各时段的数值。</p>
                <details class="advanced chart-table">
                  <summary>以表格查看</summary>
                  <div class="table-scroll">
                    <table class="table" id="stats-series-table"></table>
                  </div>
                </details>
              </section>
              <section class="panel" data-glass="panel" aria-labelledby="stats-reasons-title">
                <h2 id="stats-reasons-title">失败原因</h2>
                <div class="table-scroll">
                  <table class="table" id="stats-reasons"></table>
                </div>
                <p class="field-hint" id="stats-reasons-empty" hidden>所选时间范围内没有失败或限流记录。</p>
              </section>
              <div class="panel-pair">
                <section class="panel" data-glass="panel" aria-labelledby="stats-siteverify-title">
                  <h2 id="stats-siteverify-title">服务端核验</h2>
                  <dl class="counts" id="stats-siteverify"></dl>
                </section>
                <section class="panel" data-glass="panel" aria-labelledby="stats-gate-title">
                  <h2 id="stats-gate-title">验证网关</h2>
                  <dl class="counts" id="stats-gate"></dl>
                </section>
              </div>
              <section class="panel" data-glass="panel" aria-labelledby="stats-sites-title">
                <h2 id="stats-sites-title">各站点</h2>
                <div class="table-scroll">
                  <table class="table" id="stats-by-site"></table>
                </div>
              </section>
            </div>
          </div>
          <p class="footnote">统计数据仅为按小时汇总的计数，不包含任何访客个人信息。</p>
        </section>

        <section class="view" id="view-gate" role="tabpanel" aria-labelledby="tab-gate" hidden>
          <div class="console-head">
            <div>
              <h1>验证网关</h1>
              <p>为整站启用验证页：访客须先完成验证，方可访问源站。</p>
            </div>
            <button id="new-gate" class="button is-primary" type="button" data-ripple>${ICON_PLUS}<span>添加域名</span></button>
          </div>
          <ul class="notes">
            <li>仅当该域名已通过 Worker 路由指向本服务时，网关设置才会生效。</li>
            <li>修改将在 60 秒内生效。</li>
          </ul>
          <p class="notice" id="gate-error" role="alert" hidden></p>
          <div class="panel table-panel" data-glass="panel" id="gate-panel">
            <div class="table-scroll">
              <table class="table" id="gate-table">
                <thead>
                  <tr>
                    <th scope="col">域名</th>
                    <th scope="col">源站地址</th>
                    <th scope="col">状态</th>
                    <th scope="col" class="num">放行路径</th>
                    <th scope="col">来源</th>
                    <th scope="col"><span class="visually-hidden">操作</span></th>
                  </tr>
                </thead>
                <tbody id="gate-rows"></tbody>
              </table>
            </div>
          </div>
          <p class="empty" id="gate-empty" hidden>暂无网关域名。</p>
        </section>
      </section>
    </main>

    <dialog class="dialog" id="site-dialog" data-glass="panel" aria-labelledby="site-dialog-title">
      <form class="dialog-body" id="site-form" method="dialog">
        <h2 id="site-dialog-title">新建站点</h2>
        <label class="field">
          <span class="field-label">名称</span>
          <input class="input" name="name" maxlength="80" required autocomplete="off" />
        </label>
        <label class="field">
          <span class="field-label">允许的域名</span>
          <textarea class="input" name="origins" required spellcheck="false" placeholder="https://example.com"></textarea>
          <span class="field-hint">每行一个，仅填写协议与域名（例如 https://blog.rakko.cn），不含路径。本地调试可填写 http://localhost:5173。</span>
        </label>
        <details class="advanced">
          <summary>高级设置（留空则使用全局默认值）</summary>
          <div class="advanced-grid">
            <label class="field">
              <span class="field-label">难度</span>
              <input class="input" name="challengeDifficulty" type="number" min="1" max="16" placeholder="4" />
            </label>
            <label class="field">
              <span class="field-label">题目数量</span>
              <input class="input" name="challengeCount" type="number" min="1" max="1000" placeholder="50" />
            </label>
            <label class="field">
              <span class="field-label">token 有效期（分钟）</span>
              <input class="input" name="tokenTtlMinutes" type="number" min="1" max="1440" placeholder="20" />
            </label>
            <label class="check">
              <input name="blockAutomatedBrowsers" type="checkbox" />
              <span>拦截自动化浏览器</span>
            </label>
          </div>
        </details>
        <p class="notice" id="site-form-error" role="alert" hidden></p>
        <div class="dialog-actions">
          <button class="button" type="button" data-close data-ripple>取消</button>
          <button class="button is-primary" type="submit" data-ripple>保存</button>
        </div>
      </form>
    </dialog>

    <dialog class="dialog" id="secret-dialog" data-glass="panel" aria-labelledby="secret-dialog-title">
      <div class="dialog-body">
        <h2 id="secret-dialog-title">接入信息</h2>
        <p class="secret-warning" id="secret-warning"></p>
        <div id="secret-section">
          <div class="code-head">
            <span class="field-label">Secret（仅显示一次）</span>
            <button class="icon-button" type="button" data-copy="secret-value" data-ripple>复制</button>
          </div>
          <pre class="code-block"><code id="secret-value"></code></pre>
        </div>
        <div>
          <div class="code-head">
            <span class="field-label">前端：添加至页面</span>
            <button class="icon-button" type="button" data-copy="snippet-frontend" data-ripple>复制</button>
          </div>
          <pre class="code-block"><code id="snippet-frontend"></code></pre>
        </div>
        <div>
          <div class="code-head">
            <span class="field-label">后端：校验 token</span>
            <button class="icon-button" type="button" data-copy="snippet-backend" data-ripple>复制</button>
          </div>
          <pre class="code-block"><code id="snippet-backend"></code></pre>
        </div>
        <div class="dialog-actions">
          <button class="button is-primary" type="button" data-close data-ripple>完成</button>
        </div>
      </div>
    </dialog>

    <dialog class="dialog" id="gate-dialog" data-glass="panel" aria-labelledby="gate-dialog-title">
      <form class="dialog-body" id="gate-form" method="dialog">
        <h2 id="gate-dialog-title">添加域名</h2>
        <p class="readonly-note" id="gate-readonly" hidden>该域名由部署配置定义，需修改部署配置并重新部署。</p>
        <label class="field">
          <span class="field-label">域名</span>
          <input class="input" name="host" required autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="blog.example.com" />
          <span class="field-hint">小写主机名，不含协议与端口。创建后不可修改。</span>
        </label>
        <label class="field">
          <span class="field-label">源站地址</span>
          <input class="input" name="upstream" required autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="https://origin.example.com" />
          <span class="field-hint">以 https:// 开头的源站地址，不含路径。</span>
        </label>
        <label class="field">
          <span class="field-label">放行路径</span>
          <textarea class="input" name="exemptPaths" spellcheck="false" placeholder="/api/webhook&#10;/static/"></textarea>
          <span class="field-hint">每行一条，最多 50 条。以 / 结尾的路径按前缀匹配，其余按完整路径匹配。命中的请求无需验证，直接转发至源站。</span>
        </label>
        <div class="switch-row">
          <span class="switch-text">
            <span class="field-label" id="gate-enabled-label">启用网关</span>
            <span class="field-hint">停用后，该域名的所有请求将直接转发至源站，不再要求验证。</span>
          </span>
          <button class="rk-switch" id="gate-enabled" type="button" role="switch" aria-checked="true" aria-labelledby="gate-enabled-label" data-checked data-ripple data-ripple-centered>
            <span class="rk-switch__track" aria-hidden="true"></span>
            <span class="rk-switch__thumb" aria-hidden="true"></span>
          </button>
        </div>
        <p class="notice" id="gate-form-error" role="alert" hidden></p>
        <div class="dialog-actions">
          <button class="button is-danger push-start" id="gate-delete" type="button" data-ripple hidden>删除</button>
          <button class="button" type="button" id="gate-cancel" data-close data-ripple>取消</button>
          <button class="button is-primary" type="submit" id="gate-save" data-ripple>保存</button>
        </div>
      </form>
    </dialog>

    <dialog class="dialog" id="confirm-dialog" data-glass="panel" aria-labelledby="confirm-title">
      <form class="dialog-body" method="dialog">
        <h2 id="confirm-title"></h2>
        <p id="confirm-text"></p>
        <div class="dialog-actions">
          <button class="button" value="cancel" data-ripple>取消</button>
          <button class="button is-danger" value="ok" id="confirm-ok" data-ripple></button>
        </div>
      </form>
    </dialog>

    <p class="toast" id="toast" role="status" hidden></p>

    <script type="module" nonce="${nonce}">
      import { installRippleFeedback } from ${jsonForScript(ripple)};
      installRippleFeedback(document);
    </script>
    <script nonce="${nonce}">
${APP_SCRIPT}
    </script>
  </body>
</html>
`;
}

/**
 * `/admin/callback`: Priestess puts `login_code` and `state` in the URL
 * fragment. This page takes them out of the address bar straight away, posts
 * them to `/admin/api/session` and moves on to the console; on any error it
 * sends the browser to `/admin?error=<code>` instead of starting another
 * login, so a denied user never loops.
 */
const CALLBACK_SCRIPT = `(() => {
        const params = new URLSearchParams(location.hash.slice(1));
        history.replaceState(null, "", location.pathname);
        const done = (error) => {
          location.replace(error ? "/admin?error=" + encodeURIComponent(error) : "/admin");
        };
        const authError = params.get("auth_error");
        if (authError) return done(authError);
        const loginCode = params.get("login_code");
        if (!loginCode) return done("missing_login_code");
        fetch("/admin/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login_code: loginCode, state: params.get("state") || "" }),
          credentials: "same-origin",
        })
          .then((res) => res.json().then((body) => (res.ok ? done(null) : done(body.error || "sign_in_failed"))))
          .catch(() => done("network_error"));
      })();`;

export function renderCallbackPage({ nonce }) {
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
  <head>
    ${head(nonce, "正在登录…")}
  </head>
  <body>
    ${topbar("", false)}
    <main class="main">
      <div class="login-panel" data-glass="panel">
        <h1>正在登录…</h1>
        <p>正在向 Priestess 确认身份。</p>
      </div>
    </main>
    <script nonce="${nonce}">
      ${CALLBACK_SCRIPT}
    </script>
  </body>
</html>
`;
}
