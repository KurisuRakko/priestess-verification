// Admin console logic (runs in the browser). Inlined into /admin by
// admin/page.js with a CSP nonce; talks only to this origin's /admin/api/*.
(() => {
  const $ = (id) => document.getElementById(id);
  const origin = location.origin;

  const ERRORS = {
    not_an_admin: "该 Priestess 账号没有后台访问权限。",
    app_access_denied: "该 Priestess 账号未获授权使用本应用。",
    invalid_state: "登录状态已失效（可能已超过 10 分钟），请重新登录。",
    invalid_login_code: "登录码已失效，请重新登录。",
    missing_login_code: "未收到登录码，请重新登录。",
    priestess_unreachable: "暂时无法连接 Priestess，请稍后重试。",
    network_error: "网络连接异常，请重新登录。",
  };

  // ── theme ───────────────────────────────────────────────────────────
  $("theme-toggle").addEventListener("click", () => {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("pv-theme", next);
    } catch {}
  });

  // ── helpers ─────────────────────────────────────────────────────────
  let toastTimer = 0;
  function toast(text) {
    const el = $("toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2600);
  }

  async function api(path, { method = "GET", body } = {}) {
    const init = { method, credentials: "same-origin", headers: {} };
    if (method !== "GET") {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body ?? {});
    }
    const res = await fetch(`/admin/api${path}`, init);
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (res.status === 401) {
      showLogin("登录已过期，请重新登录。");
      throw new Error("unauthenticated");
    }
    if (!res.ok) {
      const error = new Error(data?.error || `HTTP ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return data;
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (
        key.startsWith("data-") ||
        key.startsWith("aria-") ||
        key === "role" ||
        key === "scope" ||
        key === "colspan"
      )
        node.setAttribute(key, value);
      else node[key] = value;
    }
    for (const child of children) node.append(child);
    return node;
  }

  function button(text, onClick, extraClass = "") {
    const node = el("button", {
      class: `button ${extraClass}`.trim(),
      type: "button",
      text,
      "data-ripple": "",
    });
    node.addEventListener("click", onClick);
    return node;
  }

  // Spelled in two pieces: this file is inlined into a <script> element.
  const SCRIPT_END = "<" + "/script>";

  const SETTING_LABELS = {
    challengeDifficulty: (v) => `难度 ${v}`,
    challengeCount: (v) => `题目数量 ${v}`,
    challengeSize: (v) => `题目长度 ${v}`,
    tokenTtlMs: (v) => `token 有效期 ${Math.round(v / 60000)} 分钟`,
    blockAutomatedBrowsers: (v) =>
      v ? "拦截自动化浏览器" : "放行自动化浏览器",
  };

  function describeSettings(settings) {
    return Object.entries(settings)
      .map(([key, value]) => SETTING_LABELS[key]?.(value) ?? `${key}=${value}`)
      .join(" · ");
  }

  function snippets(siteKey) {
    const frontend = [
      "<script>",
      `  window.CAP_CUSTOM_WASM_URL = "${origin}/cap_wasm_bg.wasm";`,
      `  window.CAP_CUSTOM_HASHWX_URL = "${origin}/hashwx.wasm";`,
      `  window.CAP_PAKO_URL = "${origin}/pako_inflate.min.js";`,
      SCRIPT_END,
      `<script src="${origin}/widget.js">${SCRIPT_END}`,
      "",
      `<cap-widget data-cap-api-endpoint="${origin}/${siteKey}/"></cap-widget>`,
    ].join("\n");
    const backend = [
      "// token = the widget's `solve` event detail.token, or the cap-token form field",
      `const res = await fetch("${origin}/${siteKey}/siteverify", {`,
      '  method: "POST",',
      '  headers: { "content-type": "application/json" },',
      "  body: JSON.stringify({ secret: process.env.PRIESTESS_SECRET, response: token }),",
      "});",
      "const { success } = await res.json();",
    ].join("\n");
    return { frontend, backend };
  }

  // ── views ───────────────────────────────────────────────────────────
  function showLogin(message) {
    $("console-view").hidden = true;
    $("logout").hidden = true;
    $("user-name").hidden = true;
    $("login-view").hidden = false;
    const error = $("login-error");
    error.textContent = message || "";
    error.hidden = !message;
  }

  function showConsole(user) {
    $("login-view").hidden = true;
    $("console-view").hidden = false;
    $("logout").hidden = false;
    $("user-name").textContent = user.name;
    $("user-name").hidden = false;
  }

  let sites = [];

  function renderSites() {
    const list = $("site-list");
    list.replaceChildren();
    $("site-empty").hidden = sites.length > 0;
    for (const site of sites) {
      const origins = el(
        "ul",
        { class: "chips", "aria-label": "允许的域名" },
        site.origins.map((o) => el("li", { class: "chip", text: o })),
      );
      const settings = Object.entries(site.settings);
      const card = el(
        "li",
        {
          class: `site-card${site.enabled ? "" : " is-disabled"}`,
          "data-glass": "panel",
        },
        [
          el("div", { class: "site-top" }, [
            el("h2", { class: "site-title", text: site.name }),
            el("code", { class: "site-key", text: site.siteKey }),
            el("span", {
              class: `chip${site.enabled ? "" : " is-muted"}`,
              text: site.enabled ? "已启用" : "已停用",
            }),
          ]),
          origins,
          settings.length
            ? el("p", {
                class: "field-hint",
                text: `自定义设置：${describeSettings(site.settings)}`,
              })
            : "",
          el("div", { class: "site-actions" }, [
            button("接入代码", () => showSecret(site, null)),
            button("编辑", () => openSiteDialog(site)),
            button(site.enabled ? "停用" : "启用", () => toggleSite(site)),
            button("轮换 secret", () => rotateSecret(site)),
            button("删除", () => deleteSite(site), "is-danger"),
          ]),
        ],
      );
      list.append(card);
    }
  }

  async function loadSites() {
    const data = await api("/sites");
    sites = data.sites;
    renderSites();
  }

  // ── dialogs ─────────────────────────────────────────────────────────
  for (const closer of document.querySelectorAll("[data-close]")) {
    closer.addEventListener("click", () => closer.closest("dialog").close());
  }

  for (const copy of document.querySelectorAll("[data-copy]")) {
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText($(copy.dataset.copy).textContent);
        toast("已复制");
      } catch {
        toast("复制失败，请手动选择内容后复制。");
      }
    });
  }

  function confirmAction(title, text, okLabel) {
    const dialog = $("confirm-dialog");
    $("confirm-title").textContent = title;
    $("confirm-text").textContent = text;
    $("confirm-ok").textContent = okLabel;
    dialog.returnValue = "";
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener(
        "close",
        () => resolve(dialog.returnValue === "ok"),
        { once: true },
      );
    });
  }

  function showSecret(site, secret) {
    const { frontend, backend } = snippets(site.siteKey);
    $("secret-section").hidden = !secret;
    $("secret-value").textContent = secret || "";
    $("secret-warning").textContent = secret
      ? "Secret 仅显示一次，关闭后无法再次查看。请立即将其保存至服务器的环境变量（例如 PRIESTESS_SECRET）；如有遗失，只能通过轮换重新生成。"
      : `站点「${site.name}」的接入代码。Secret 不再显示；如有遗失，请轮换 secret。`;
    $("snippet-frontend").textContent = frontend;
    $("snippet-backend").textContent = backend;
    $("secret-dialog").showModal();
  }

  let editing = null;

  function openSiteDialog(site) {
    editing = site;
    const form = $("site-form");
    form.reset();
    $("site-form-error").hidden = true;
    $("site-dialog-title").textContent = site ? "编辑站点" : "新建站点";
    if (site) {
      form.elements.name.value = site.name;
      form.elements.origins.value = site.origins.join("\n");
      const s = site.settings;
      form.elements.challengeDifficulty.value = s.challengeDifficulty ?? "";
      form.elements.challengeCount.value = s.challengeCount ?? "";
      form.elements.tokenTtlMinutes.value = s.tokenTtlMs
        ? Math.round(s.tokenTtlMs / 60000)
        : "";
      form.elements.blockAutomatedBrowsers.checked =
        s.blockAutomatedBrowsers === true;
    }
    $("site-dialog").showModal();
  }

  $("site-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const f = form.elements;
    const minutes = f.tokenTtlMinutes.value.trim();
    const body = {
      name: f.name.value,
      origins: f.origins.value.split(/\s+/).filter(Boolean),
      settings: {
        challengeDifficulty: f.challengeDifficulty.value.trim() || null,
        challengeCount: f.challengeCount.value.trim() || null,
        tokenTtlMs: minutes ? Number(minutes) * 60000 : null,
        blockAutomatedBrowsers: f.blockAutomatedBrowsers.checked || null,
      },
    };
    try {
      if (editing) {
        await api(`/sites/${editing.siteKey}`, { method: "PATCH", body });
        $("site-dialog").close();
        toast("已保存，修改将在 30 秒内生效。");
        await loadSites();
      } else {
        const data = await api("/sites", { method: "POST", body });
        $("site-dialog").close();
        await loadSites();
        showSecret(data.site, data.secret);
      }
    } catch (error) {
      if (error.message === "unauthenticated") return;
      const box = $("site-form-error");
      box.textContent = `保存失败：${error.message}`;
      box.hidden = false;
    }
  });

  $("new-site").addEventListener("click", () => openSiteDialog(null));

  async function toggleSite(site) {
    try {
      await api(`/sites/${site.siteKey}`, {
        method: "PATCH",
        body: { enabled: !site.enabled },
      });
      toast(site.enabled ? "已停用" : "已启用");
      await loadSites();
    } catch (error) {
      if (error.message !== "unauthenticated") toast(error.message);
    }
  }

  async function rotateSecret(site) {
    const ok = await confirmAction(
      "轮换 secret",
      `轮换后，${site.name} 的旧 secret 将立即失效，接入方后端须改用新 secret 方可继续校验。`,
      "轮换",
    );
    if (!ok) return;
    try {
      const data = await api(`/sites/${site.siteKey}/rotate`, {
        method: "POST",
      });
      showSecret(site, data.secret);
    } catch (error) {
      if (error.message !== "unauthenticated") toast(error.message);
    }
  }

  async function deleteSite(site) {
    const ok = await confirmAction(
      "删除站点",
      `删除 ${site.name}（${site.siteKey}）后，其接入代码与 secret 将全部失效，且无法恢复。`,
      "删除",
    );
    if (!ok) return;
    try {
      await api(`/sites/${site.siteKey}`, { method: "DELETE" });
      toast("已删除");
      await loadSites();
    } catch (error) {
      if (error.message !== "unauthenticated") toast(error.message);
    }
  }

  // ── console tabs ────────────────────────────────────────────────────
  const VIEWS = ["sites", "stats", "gate"];
  let currentView = "sites";

  // The rk-tabs indicator reads its offset and width from custom properties.
  function placeTabIndicator() {
    const bar = $("view-tabs");
    const tab = $(`tab-${currentView}`);
    if (bar.offsetParent === null) return;
    bar.style.setProperty("--active-tab-left", `${tab.offsetLeft}px`);
    bar.style.setProperty("--active-tab-width", `${tab.offsetWidth}px`);
  }

  function showView(view, { focus = false } = {}) {
    const name = VIEWS.includes(view) ? view : "sites";
    currentView = name;
    for (const other of VIEWS) {
      const tab = $(`tab-${other}`);
      const selected = other === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $(`view-${other}`).hidden = !selected;
    }
    if (focus) $(`tab-${name}`).focus();
    placeTabIndicator();
    const hash = name === "sites" ? "" : `#${name}`;
    if (location.hash !== hash) {
      history.replaceState(null, "", location.pathname + hash);
    }
    if (name === "stats") loadStats();
    if (name === "gate") loadGate();
  }

  for (const tab of document.querySelectorAll("#view-tabs [role=tab]")) {
    tab.addEventListener("click", () => showView(tab.dataset.view));
  }

  // Roving focus for tab lists and radio groups: arrows, Home and End.
  function rovingIndex(event, index, count) {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[
      event.key
    ];
    if (step) return (index + step + count) % count;
    if (event.key === "Home") return 0;
    if (event.key === "End") return count - 1;
    return -1;
  }

  $("view-tabs").addEventListener("keydown", (event) => {
    const next = rovingIndex(event, VIEWS.indexOf(currentView), VIEWS.length);
    if (next < 0) return;
    event.preventDefault();
    showView(VIEWS[next], { focus: true });
  });

  addEventListener("resize", placeTabIndicator);
  addEventListener("hashchange", () => {
    if (!$("console-view").hidden) showView(location.hash.slice(1));
  });

  // ── error wording ───────────────────────────────────────────────────
  // The API answers in short English sentences; the console shows a Chinese
  // explanation first and keeps the original text for reference.
  const HTTP_ERRORS = {
    400: "提交的内容未通过校验。",
    403: "当前账号无权执行此操作。",
    404: "请求的对象不存在，可能已被删除。",
    409: "该操作与现有配置冲突。",
    429: "请求过于频繁，请稍后重试。",
  };

  function describeError(error, messages = {}) {
    const status = error.status;
    let text;
    if (!status) text = "网络连接异常，请稍后重试。";
    else
      text =
        messages[status] ||
        HTTP_ERRORS[status] ||
        (status >= 500 ? "服务内部错误，请稍后重试。" : "请求未能完成。");
    const raw = error.message;
    return raw && raw !== `HTTP ${status}` ? `${text}（原始信息：${raw}）` : text;
  }

  function showNotice(box, text) {
    box.textContent = text;
    box.hidden = false;
  }

  // ── statistics ──────────────────────────────────────────────────────
  const EVENT_LABELS = {
    challenge_issued: "发出挑战",
    redeem_ok: "验证通过",
    redeem_fail: "验证失败",
    siteverify_ok: "服务端核验成功",
    siteverify_fail: "服务端核验失败",
    gate_shown: "显示验证页",
    gate_pass: "发放通行凭证",
    gate_pass_fail: "通行凭证发放失败",
    rate_limited: "触发限流",
  };
  const EVENTS = Object.keys(EVENT_LABELS);

  const REASON_LABELS = {
    invalid_solution: "计算结果无效",
    expired: "挑战已过期",
    already_redeemed: "重复提交",
    instr_blocked: "环境检测未通过",
    instr_timeout: "环境检测超时",
    invalid_token: "挑战令牌无效",
    bad_request: "请求格式错误",
    internal: "服务内部错误",
    other: "其他",
    invalid_secret: "密钥错误",
    token_not_found: "令牌不存在",
    token_expired: "令牌已过期",
  };
  const RATE_LIMIT_LABELS = {
    challenge: "获取挑战",
    redeem: "提交结果",
    gate_pass: "网关放行",
    siteverify: "服务端核验",
  };
  const KIND_LABELS = { site: "站点", gate: "验证网关", default: "旧接口" };
  const REASON_GROUPS = [
    "redeem_fail",
    "siteverify_fail",
    "gate_pass_fail",
    "rate_limited",
  ];

  function reasonLabel(group, reason) {
    const labels = group === "rate_limited" ? RATE_LIMIT_LABELS : REASON_LABELS;
    return labels[reason] || reason || "未注明";
  }

  const numberFormat = new Intl.NumberFormat("zh-CN");
  const fmt = (n) => numberFormat.format(n || 0);
  const pad2 = (n) => String(n).padStart(2, "0");

  function percent(part, total) {
    return total ? `${((part / total) * 100).toFixed(1)}%` : "—";
  }

  function passRate(row) {
    const ok = row.redeem_ok || 0;
    return percent(ok, ok + (row.redeem_fail || 0));
  }

  function dayText(date) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function clockText(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  // Bucket names: axis ticks are short, tooltips and the table spell it out.
  // Hour buckets are named in the browser's local time (with minutes, so a
  // half-hour zone reads 10:30–11:30). Day buckets follow the API's day
  // boundaries, which use `tz` rounded to a whole hour: in UTC+5:30 a "day"
  // starts at 23:30 local time the evening before, so its date is read in
  // that rounded offset rather than from the local clock.
  function bucketText(iso, bucket, long, tz) {
    if (bucket !== "hour") {
      const d = new Date(Date.parse(iso) + (tz || 0) * 60_000);
      const month = d.getUTCMonth() + 1;
      const day = d.getUTCDate();
      return long ? `${month}月${day}日` : `${month}/${day}`;
    }
    const start = new Date(iso);
    if (!long) return clockText(start);
    const end = new Date(start.getTime() + 3_600_000);
    return `${dayText(start)} ${clockText(start)}–${clockText(end)}`;
  }

  // The period line is read in the API's own offset `data.tz` (minutes east
  // of UTC, rounded to a whole hour), like the day buckets above, so it names
  // the same instants the counts cover. When that differs from the browser's
  // offset (a half-hour zone) the offset used is stated; otherwise the times
  // are simply the local ones.
  function offsetText(tz) {
    if (!tz) return "UTC";
    const abs = Math.abs(tz);
    const minutes = abs % 60;
    const hours = (abs - minutes) / 60;
    return `UTC${tz < 0 ? "-" : "+"}${hours}${minutes ? `:${pad2(minutes)}` : ""}`;
  }

  function zonedText(iso, tz) {
    const d = new Date(Date.parse(iso) + (tz || 0) * 60_000);
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  }

  function periodText(data, browserTz) {
    const tz = data.tz || 0;
    const zone = tz === browserTz ? "本地时间" : `按 ${offsetText(tz)} 统计`;
    return `统计区间：${zonedText(data.from, tz)} 至 ${zonedText(data.to, tz)}（${zone}），更新于 ${zonedText(data.generatedAt, tz)}。`;
  }

  const stats = { range: "24h", site: "", seq: 0, data: null, active: -1 };

  async function loadStats() {
    const seq = ++stats.seq;
    const query = new URLSearchParams({
      range: stats.range,
      tz: String(-new Date().getTimezoneOffset()),
    });
    if (stats.site) query.set("site", stats.site);
    $("stats-body").setAttribute("aria-busy", "true");
    try {
      const data = await api(`/stats?${query}`);
      if (seq !== stats.seq) return;
      $("stats-error").hidden = true;
      renderStats(data);
    } catch (error) {
      if (seq !== stats.seq || error.message === "unauthenticated") return;
      showNotice(
        $("stats-error"),
        `统计数据加载失败：${describeError(error, { 400: "统计查询参数无效。" })}`,
      );
      $("stats-body").hidden = !stats.data;
    } finally {
      if (seq === stats.seq) $("stats-body").setAttribute("aria-busy", "false");
    }
  }

  function syncSiteOptions(rows) {
    const options = [el("option", { value: "", text: "全部站点" })];
    for (const row of rows) {
      const kind = KIND_LABELS[row.kind] || row.kind;
      options.push(
        el("option", { value: row.site, text: `${row.label}（${kind}）` }),
      );
    }
    if (stats.site && !rows.some((row) => row.site === stats.site)) {
      options.push(el("option", { value: stats.site, text: stats.site }));
    }
    const select = $("stats-site");
    select.replaceChildren(...options);
    select.value = stats.site;
  }

  function renderStats(data) {
    stats.data = data;
    stats.active = -1;
    $("stats-body").hidden = false;
    syncSiteOptions(data.bySite || []);
    const totals = data.totals;
    $("stats-period").textContent = periodText(
      data,
      -new Date(data.to).getTimezoneOffset(),
    );

    const metrics = [
      ["发出挑战", fmt(totals.challenge_issued), ""],
      ["验证通过", fmt(totals.redeem_ok), ""],
      ["验证失败", fmt(totals.redeem_fail), ""],
      ["通过率", passRate(totals), "验证通过 ÷（验证通过 + 验证失败）"],
      ["触发限流", fmt(totals.rate_limited), "按 1/10 抽样估算"],
    ];
    $("stats-metrics").replaceChildren(
      ...metrics.map(([label, value, hint]) =>
        el("li", { class: "metric", "data-glass": "panel" }, [
          el("span", { class: "metric-label", text: label }),
          el("span", { class: "metric-value", text: value }),
          hint ? el("span", { class: "metric-hint", text: hint }) : "",
        ]),
      ),
    );

    const empty = EVENTS.every((name) => !totals[name]);
    $("stats-empty").hidden = !empty;
    $("stats-detail").hidden = empty;
    if (empty) return;
    renderChart();
    renderSeriesTable();
    renderReasons();
    renderCounts();
    renderBySite();
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, String(value));
    }
    return node;
  }

  // Round step (1, 2 or 5 × 10^n, at least 1) for four gridline intervals.
  function niceStep(raw) {
    const exp = 10 ** Math.floor(Math.log10(raw));
    for (const m of [1, 2, 5, 10]) if (m * exp >= raw) return Math.max(1, m * exp);
    return Math.max(1, raw);
  }

  // A bar segment; the top segment of each stack gets rounded upper corners.
  function barPath(x, y, w, h, rounded) {
    const r = rounded ? Math.min(4, w / 2, h) : 0;
    return [
      `M${x},${y + h}`,
      `V${y + r}`,
      r ? `Q${x},${y} ${x + r},${y}` : "",
      `H${x + w - r}`,
      r ? `Q${x + w},${y} ${x + w},${y + r}` : "",
      `V${y + h}`,
      "Z",
    ].join(" ");
  }

  const chart = { width: 0, slots: [] };

  function renderChart() {
    const box = $("stats-chart");
    const { series, bucket } = stats.data;
    const width = Math.max(box.clientWidth, 240);
    const height = 220;
    chart.width = width;
    const max = Math.max(1, ...series.map((r) => r.redeem_ok + r.redeem_fail));
    const step = niceStep(max / 4);
    const top = step * 4;
    const left = 10 + 7 * fmt(top).length;
    const plot = { x: left, y: 10, w: width - left - 4, h: height - 10 - 28 };
    const y = (v) => plot.y + plot.h * (1 - v / top);
    const slot = plot.w / series.length;
    const barWidth = Math.max(2, Math.min(28, slot * 0.64));

    const root = svg("svg", {
      class: "chart-svg",
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      "aria-hidden": "true",
    });
    for (let i = 0; i <= 4; i += 1) {
      const gy = Math.round(y(step * i)) + 0.5;
      root.append(
        svg("line", {
          class: i ? "chart-grid" : "chart-axis",
          x1: plot.x,
          x2: plot.x + plot.w,
          y1: gy,
          y2: gy,
        }),
      );
      const label = svg("text", {
        class: "chart-label",
        x: plot.x - 6,
        y: gy + 4,
        "text-anchor": "end",
      });
      label.textContent = fmt(step * i);
      root.append(label);
    }

    const band = svg("rect", {
      class: "chart-band",
      y: plot.y,
      width: slot,
      height: plot.h,
      visibility: "hidden",
    });
    root.append(band);

    const every = Math.ceil(series.length / Math.max(1, Math.floor(plot.w / 46)));
    chart.slots = [];
    series.forEach((row, i) => {
      const x = plot.x + slot * i + (slot - barWidth) / 2;
      const base = y(0);
      const okH = base - y(row.redeem_ok);
      const failH = base - y(row.redeem_fail);
      const gap = okH > 0 && failH > 0 ? 2 : 0;
      if (okH > 0) {
        root.append(
          svg("path", {
            class: "chart-bar is-ok",
            d: barPath(x, base - okH, barWidth, okH, failH <= 0),
          }),
        );
      }
      if (failH > 0) {
        const h = Math.max(1, failH - gap);
        root.append(
          svg("path", {
            class: "chart-bar is-fail",
            d: barPath(x, base - okH - gap - h, barWidth, h, true),
          }),
        );
      }
      if (i % every === 0) {
        const tick = svg("text", {
          class: "chart-label",
          x: plot.x + slot * i + slot / 2,
          y: height - 8,
          "text-anchor": "middle",
        });
        tick.textContent = bucketText(row.t, bucket, false, stats.data.tz);
        root.append(tick);
      }
      const hit = svg("rect", {
        class: "chart-hit",
        x: plot.x + slot * i,
        y: plot.y,
        width: slot,
        height: plot.h,
      });
      hit.addEventListener("pointerenter", () => setActive(i, false));
      root.append(hit);
      chart.slots.push({
        x: plot.x + slot * i,
        center: plot.x + slot * i + slot / 2,
        top: base - okH - (failH > 0 ? gap + Math.max(1, failH - gap) : 0),
      });
    });
    chart.band = band;
    root.addEventListener("pointerleave", () => {
      if (document.activeElement !== box) setActive(-1, false);
    });

    const okTotal = stats.data.totals.redeem_ok;
    const failTotal = stats.data.totals.redeem_fail;
    box.setAttribute(
      "aria-label",
      `验证结果趋势图，共 ${series.length} 个时段，验证通过合计 ${fmt(okTotal)} 次，验证失败合计 ${fmt(failTotal)} 次。`,
    );
    box.replaceChildren(
      root,
      el("div", { class: "chart-tip", id: "stats-chart-tip", hidden: true }),
      el("p", { class: "visually-hidden", id: "stats-chart-live", "aria-live": "polite" }),
    );
    if (stats.active >= 0) setActive(stats.active, false);
  }

  function setActive(index, announce) {
    stats.active = index;
    const tip = $("stats-chart-tip");
    if (!tip) return;
    if (index < 0 || !stats.data) {
      chart.band.setAttribute("visibility", "hidden");
      tip.hidden = true;
      return;
    }
    const row = stats.data.series[index];
    const slot = chart.slots[index];
    chart.band.setAttribute("x", slot.x);
    chart.band.setAttribute("visibility", "visible");
    const title = bucketText(
      row.t,
      stats.data.bucket,
      true,
      stats.data.tz,
    );
    const lines = [
      ["验证通过", fmt(row.redeem_ok), "is-ok"],
      ["验证失败", fmt(row.redeem_fail), "is-fail"],
      ["通过率", passRate(row), ""],
    ];
    tip.replaceChildren(
      el("span", { class: "chart-tip-title", text: title }),
      ...lines.map(([label, value, swatch]) =>
        el("span", { class: "chart-tip-row" }, [
          el("span", { class: `swatch ${swatch}`.trim(), "aria-hidden": "true" }),
          el("span", { text: label }),
          el("span", { class: "chart-tip-value", text: value }),
        ]),
      ),
    );
    tip.hidden = false;
    const half = tip.offsetWidth / 2;
    const left = Math.min(Math.max(slot.center, half), chart.width - half);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(slot.top - 8, tip.offsetHeight)}px`;
    if (announce) {
      $("stats-chart-live").textContent =
        `${title}：验证通过 ${fmt(row.redeem_ok)} 次，验证失败 ${fmt(row.redeem_fail)} 次，通过率 ${passRate(row)}。`;
    }
  }

  $("stats-chart").tabIndex = 0;
  $("stats-chart").setAttribute("role", "group");
  $("stats-chart").setAttribute("aria-describedby", "stats-chart-hint");
  $("stats-chart").addEventListener("keydown", (event) => {
    if (!stats.data) return;
    const count = stats.data.series.length;
    const from = stats.active < 0 ? count : stats.active;
    let next = rovingIndex(event, from, count);
    if (stats.active < 0 && (event.key === "ArrowRight" || event.key === "ArrowDown")) {
      next = 0;
    }
    if (event.key === "Escape") next = -1;
    else if (next < 0) return;
    event.preventDefault();
    setActive(next, next >= 0);
  });
  $("stats-chart").addEventListener("focus", () => {
    if (stats.data && stats.active < 0) {
      setActive(stats.data.series.length - 1, true);
    }
  });
  $("stats-chart").addEventListener("blur", () => setActive(-1, false));

  let chartFrame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(chartFrame);
    chartFrame = requestAnimationFrame(() => {
      const box = $("stats-chart");
      if (
        stats.data &&
        box.offsetParent !== null &&
        box.clientWidth !== chart.width
      ) {
        renderChart();
      }
    });
  }).observe($("stats-chart"));

  function table(target, head, rows) {
    const thead = el("thead", {}, [
      el(
        "tr",
        {},
        head.map(([text, numeric]) =>
          el("th", { scope: "col", class: numeric ? "num" : "", text }),
        ),
      ),
    ]);
    target.replaceChildren(thead, el("tbody", {}, rows));
  }

  function cells(values, numericFrom) {
    return values.map((value, i) =>
      i === 0
        ? el("th", { scope: "row", text: value })
        : el("td", { class: i >= numericFrom ? "num" : "", text: value }),
    );
  }

  function renderSeriesTable() {
    const { series, bucket } = stats.data;
    table(
      $("stats-series-table"),
      [
        [bucket === "hour" ? "时段（本地时间）" : "日期（本地时间）"],
        ["验证通过", true],
        ["验证失败", true],
        ["通过率", true],
      ],
      series.map((row) =>
        el(
          "tr",
          {},
          cells(
            [
              bucketText(row.t, bucket, true, stats.data.tz),
              fmt(row.redeem_ok),
              fmt(row.redeem_fail),
              passRate(row),
            ],
            1,
          ),
        ),
      ),
    );
  }

  function renderReasons() {
    const reasons = stats.data.reasons || {};
    const rows = [];
    for (const group of REASON_GROUPS) {
      const entries = Object.entries(reasons[group] || {})
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1]);
      if (!entries.length) continue;
      const total = entries.reduce((sum, [, n]) => sum + n, 0);
      rows.push(
        el("tr", { class: "group-row" }, [
          el("th", {
            scope: "rowgroup",
            colspan: "3",
            text: `${EVENT_LABELS[group]}（共 ${fmt(total)} 次）`,
          }),
        ]),
      );
      for (const [reason, n] of entries) {
        rows.push(
          el(
            "tr",
            {},
            cells([reasonLabel(group, reason), fmt(n), percent(n, total)], 1),
          ),
        );
      }
    }
    $("stats-reasons").hidden = !rows.length;
    $("stats-reasons-empty").hidden = rows.length > 0;
    table(
      $("stats-reasons"),
      [["原因"], ["次数", true], ["占比", true]],
      rows,
    );
  }

  function countList(target, items) {
    const totals = stats.data.totals;
    target.replaceChildren(
      ...items.map(([event, label]) =>
        el("div", { class: "count" }, [
          el("dt", { text: label }),
          el("dd", { text: fmt(totals[event]) }),
        ]),
      ),
    );
  }

  function renderCounts() {
    countList($("stats-siteverify"), [
      ["siteverify_ok", "成功"],
      ["siteverify_fail", "失败"],
    ]);
    countList($("stats-gate"), [
      ["gate_shown", "显示验证页"],
      ["gate_pass", "发放通行凭证"],
      ["gate_pass_fail", "发放失败"],
    ]);
  }

  function renderBySite() {
    const rows = (stats.data.bySite || []).map((row) => {
      const tr = el(
        "tr",
        { class: row.site === stats.site ? "is-selected" : "" },
        cells(
          [
            row.label,
            KIND_LABELS[row.kind] || row.kind,
            fmt(row.challenge_issued),
            fmt(row.redeem_ok),
            fmt(row.redeem_fail),
            passRate(row),
            fmt(row.rate_limited),
          ],
          2,
        ),
      );
      return tr;
    });
    if (!rows.length) {
      rows.push(
        el("tr", {}, [
          el("td", { colspan: "7", class: "muted", text: "暂无站点数据。" }),
        ]),
      );
    }
    table(
      $("stats-by-site"),
      [
        ["站点"],
        ["类型"],
        ["发出挑战", true],
        ["验证通过", true],
        ["验证失败", true],
        ["通过率", true],
        ["触发限流", true],
      ],
      rows,
    );
  }

  const rangeButtons = [...document.querySelectorAll("#stats-range [data-range]")];
  function selectRange(button, focus) {
    for (const other of rangeButtons) {
      const checked = other === button;
      other.setAttribute("aria-checked", String(checked));
      other.toggleAttribute("data-checked", checked);
      other.tabIndex = checked ? 0 : -1;
    }
    if (focus) button.focus();
    if (stats.range === button.dataset.range) return;
    stats.range = button.dataset.range;
    loadStats();
  }
  for (const button of rangeButtons) {
    button.addEventListener("click", () => selectRange(button, false));
  }
  $("stats-range").addEventListener("keydown", (event) => {
    const current = rangeButtons.findIndex(
      (b) => b.getAttribute("aria-checked") === "true",
    );
    const next = rovingIndex(event, current, rangeButtons.length);
    if (next < 0) return;
    event.preventDefault();
    selectRange(rangeButtons[next], true);
  });
  $("stats-site").addEventListener("change", (event) => {
    stats.site = event.currentTarget.value;
    loadStats();
  });
  $("stats-refresh").addEventListener("click", () => loadStats());

  // ── verification gate ───────────────────────────────────────────────
  let gateHosts = [];
  let gateEditing = null;

  // The gate API's 400 messages (gate-hosts.js, gate-api.js) name the field
  // they are about. The first rule whose text occurs in the lowercased message
  // gives the field to mark and the explanation; admin-ui.test.js runs every
  // backend message through this table. Kept as plain JSON for that test.
  const GATE_ERROR_RULES = [
    ["this service's own host", "host", "该域名是本服务自身的域名，不能设为网关域名。"],
    ["host must be a bare hostname", "host", "域名格式无效，应为小写主机名，不含协议、端口与路径。"],
    ["gate hosts", "host", "网关域名数量已达上限，请先删除不再使用的域名。"],
    ["upstream must not point at the host itself", "upstream", "源站地址不能指向该域名本身。"],
    ["upstream must use https", "upstream", "源站地址必须使用 https:// 协议。"],
    ["upstream must be a bare origin", "upstream", "源站地址不能包含路径、查询参数或片段。"],
    ["upstream", "upstream", "源站地址格式无效，应为以 https:// 开头的地址。"],
    ["exempt path must not be /", "exemptPaths", "放行路径不能为 /，否则整个域名都将免于验证。"],
    ["exempt path must not be under", "exemptPaths", "放行路径不能位于 /__gate/ 之下。"],
    ["must not contain", "exemptPaths", "放行路径不能包含 ?、#、;、..、空白字符或编码后的分隔符（如 %2F）。"],
    ["characters", "exemptPaths", "每条放行路径不能超过 256 个字符。"],
    ["starting with /", "exemptPaths", "每条放行路径都必须以 / 开头。"],
    ["exempt paths", "exemptPaths", "放行路径最多 50 条。"],
    ["exemptpaths", "exemptPaths", "放行路径格式无效。"]
  ];

  // -> { text, field }: `field` is the form control the error is about.
  function describeGateError(error, creating) {
    const raw = (error.message || "").toLowerCase();
    const rule =
      error.status === 400
        ? GATE_ERROR_RULES.find(([needle]) => raw.includes(needle))
        : null;
    const text = describeError(error, {
      400: rule ? rule[2] : "提交的内容未通过校验。",
      404: "该域名不存在，可能已被删除。",
      409: creating
        ? "该域名已存在于后台或部署配置中。"
        : "该域名由部署配置定义，无法在后台修改。",
    });
    const field = rule ? rule[1] : creating && error.status === 409 ? "host" : null;
    return { text, field };
  }

  function clearGateInvalid() {
    for (const control of $("gate-form").querySelectorAll("[aria-invalid]")) {
      control.removeAttribute("aria-invalid");
      control.removeAttribute("aria-describedby");
    }
  }

  function markGateInvalid(field) {
    clearGateInvalid();
    const control = field ? $("gate-form").elements[field] : null;
    if (!control) return;
    control.setAttribute("aria-invalid", "true");
    control.setAttribute("aria-describedby", "gate-form-error");
    control.focus();
  }

  async function loadGate() {
    try {
      const data = await api("/gate");
      gateHosts = data.hosts || [];
      $("gate-error").hidden = true;
      renderGate();
    } catch (error) {
      if (error.message === "unauthenticated") return;
      showNotice($("gate-error"), `网关列表加载失败：${describeError(error)}`);
    }
  }

  function renderGate() {
    $("gate-empty").hidden = gateHosts.length > 0;
    $("gate-panel").hidden = gateHosts.length === 0;
    $("gate-rows").replaceChildren(
      ...gateHosts.map((host) => {
        const fromConfig = host.source === "config";
        const actions = fromConfig
          ? [button("查看", () => openGateDialog(host), "is-small")]
          : [
              button("编辑", () => openGateDialog(host), "is-small"),
              button("删除", () => deleteGate(host), "is-small is-danger"),
            ];
        return el("tr", { class: host.enabled ? "" : "is-disabled" }, [
          el("th", { scope: "row", class: "mono", text: host.host }),
          el("td", { class: "mono", "data-label": "源站地址", text: host.upstream }),
          el("td", { "data-label": "状态" }, [
            el("span", {
              class: `chip${host.enabled ? " is-on" : " is-muted"}`,
              text: host.enabled ? "已启用" : "已停用",
            }),
          ]),
          el("td", {
            class: "num",
            "data-label": "放行路径",
            text: fmt(host.exemptPaths?.length),
          }),
          el("td", {
            class: "muted",
            "data-label": "来源",
            text: fromConfig ? "部署配置" : "后台添加",
          }),
          el("td", { class: "actions" }, [
            el("div", { class: "row-actions" }, actions),
          ]),
        ]);
      }),
    );
  }

  function setGateSwitch(on) {
    const toggle = $("gate-enabled");
    toggle.setAttribute("aria-checked", String(on));
    toggle.toggleAttribute("data-checked", on);
  }

  $("gate-enabled").addEventListener("click", () => {
    setGateSwitch($("gate-enabled").getAttribute("aria-checked") !== "true");
  });

  function openGateDialog(host) {
    gateEditing = host;
    const readOnly = host?.source === "config";
    const form = $("gate-form");
    const f = form.elements;
    form.reset();
    $("gate-form-error").hidden = true;
    clearGateInvalid();
    $("gate-dialog-title").textContent = !host
      ? "添加域名"
      : readOnly
        ? "查看域名"
        : "编辑域名";
    f.host.value = host?.host ?? "";
    f.host.readOnly = Boolean(host);
    f.upstream.value = host?.upstream ?? "";
    f.upstream.readOnly = readOnly;
    f.exemptPaths.value = (host?.exemptPaths ?? []).join("\n");
    f.exemptPaths.readOnly = readOnly;
    setGateSwitch(host ? host.enabled : true);
    $("gate-enabled").disabled = readOnly;
    $("gate-enabled").toggleAttribute("data-readonly", readOnly);
    $("gate-readonly").hidden = !readOnly;
    $("gate-save").hidden = readOnly;
    $("gate-delete").hidden = !host || readOnly;
    $("gate-cancel").textContent = readOnly ? "关闭" : "取消";
    $("gate-dialog").showModal();
  }

  $("new-gate").addEventListener("click", () => openGateDialog(null));
  // Editing a marked field takes its error mark away; the notice stays until
  // the next save attempt.
  $("gate-form").addEventListener("input", (event) => {
    if (event.target.getAttribute?.("aria-invalid") !== "true") return;
    event.target.removeAttribute("aria-invalid");
    event.target.removeAttribute("aria-describedby");
  });
  $("gate-delete").addEventListener("click", () => deleteGate(gateEditing));

  $("gate-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (gateEditing?.source === "config") return;
    const f = event.currentTarget.elements;
    const body = {
      upstream: f.upstream.value.trim(),
      exemptPaths: f.exemptPaths.value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      enabled: $("gate-enabled").getAttribute("aria-checked") === "true",
    };
    const creating = !gateEditing;
    try {
      if (creating) {
        body.host = f.host.value.trim().toLowerCase();
        await api("/gate", { method: "POST", body });
      } else {
        await api(`/gate/${encodeURIComponent(gateEditing.host)}`, {
          method: "PATCH",
          body,
        });
      }
      $("gate-dialog").close();
      toast(
        creating
          ? "已添加，设置将在 60 秒内生效。"
          : "已保存，修改将在 60 秒内生效。",
      );
      await loadGate();
    } catch (error) {
      if (error.message === "unauthenticated") return;
      const { text, field } = describeGateError(error, creating);
      showNotice($("gate-form-error"), `保存失败：${text}`);
      markGateInvalid(field);
    }
  });

  async function deleteGate(host) {
    const ok = await confirmAction(
      "删除网关域名",
      `删除 ${host.host} 的网关设置后无法恢复，修改将在 60 秒内生效。`,
      "删除",
    );
    if (!ok) return;
    try {
      await api(`/gate/${encodeURIComponent(host.host)}`, { method: "DELETE" });
      if ($("gate-dialog").open) $("gate-dialog").close();
      toast("已删除。");
      await loadGate();
    } catch (error) {
      if (error.message === "unauthenticated") return;
      const message = `删除失败：${describeGateError(error, false).text}`;
      if ($("gate-dialog").open) showNotice($("gate-form-error"), message);
      else showNotice($("gate-error"), message);
    }
  }

  $("logout").addEventListener("click", async () => {
    try {
      await api("/logout", { method: "POST" });
    } catch {}
    showLogin("已退出。");
  });

  // ── boot ────────────────────────────────────────────────────────────
  (async () => {
    const query = new URLSearchParams(location.search);
    const error = query.get("error");
    if (error) history.replaceState(null, "", location.pathname);
    const res = await fetch("/admin/api/me", { credentials: "same-origin" });
    if (!res.ok) {
      showLogin(error ? ERRORS[error] || `登录失败：${error}` : "");
      return;
    }
    const { user } = await res.json();
    showConsole(user);
    showView(location.hash.slice(1));
    await loadSites();
  })().catch(() => showLogin("加载失败，请刷新页面后重试。"));
})();
