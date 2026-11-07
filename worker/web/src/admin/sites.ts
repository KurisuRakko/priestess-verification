/**
 * Site management helpers: what `/admin/api/sites` returns, the settings
 * summary on each site, the edit form ↔ request body, and the integration
 * snippets. Pure functions (unit-tested in test/admin-ui.test.js).
 */

export interface SiteSettings {
  challengeDifficulty?: number;
  challengeCount?: number;
  challengeSize?: number;
  tokenTtlMs?: number;
  blockAutomatedBrowsers?: boolean;
}

export interface Site {
  siteKey: string;
  name: string;
  origins: string[];
  enabled: boolean;
  settings: SiteSettings;
}

const SETTING_LABELS: Record<string, (value: never) => string> = {
  challengeDifficulty: (v: number) => `难度 ${v}`,
  challengeCount: (v: number) => `题目数量 ${v}`,
  challengeSize: (v: number) => `题目长度 ${v}`,
  tokenTtlMs: (v: number) => `token 有效期 ${Math.round(v / 60000)} 分钟`,
  blockAutomatedBrowsers: (v: boolean) =>
    v ? "拦截自动化浏览器" : "放行自动化浏览器",
};

/** "难度 4 · 题目数量 50", or "" when the site uses every default. */
export function describeSettings(settings: SiteSettings): string {
  return Object.entries(settings)
    .map(
      ([key, value]) =>
        SETTING_LABELS[key]?.(value as never) ?? `${key}=${value}`,
    )
    .join(" · ");
}

/** The site dialog's fields, as the inputs hold them (strings). */
export interface SiteForm {
  name: string;
  origins: string;
  challengeDifficulty: string;
  challengeCount: string;
  tokenTtlMinutes: string;
  blockAutomatedBrowsers: boolean;
}

export function siteForm(site: Site | null): SiteForm {
  const s = site?.settings ?? {};
  return {
    name: site?.name ?? "",
    origins: site ? site.origins.join("\n") : "",
    challengeDifficulty:
      s.challengeDifficulty == null ? "" : String(s.challengeDifficulty),
    challengeCount: s.challengeCount == null ? "" : String(s.challengeCount),
    tokenTtlMinutes: s.tokenTtlMs
      ? String(Math.round(s.tokenTtlMs / 60000))
      : "",
    blockAutomatedBrowsers: s.blockAutomatedBrowsers === true,
  };
}

/**
 * The POST / PATCH body. An empty setting is `null` (use the global
 * default); origins split on any whitespace.
 */
export function siteBody(form: SiteForm) {
  const minutes = form.tokenTtlMinutes.trim();
  return {
    name: form.name,
    origins: form.origins.split(/\s+/).filter(Boolean),
    settings: {
      challengeDifficulty: form.challengeDifficulty.trim() || null,
      challengeCount: form.challengeCount.trim() || null,
      tokenTtlMs: minutes ? Number(minutes) * 60000 : null,
      blockAutomatedBrowsers: form.blockAutomatedBrowsers || null,
    },
  };
}

/** The front-end and back-end integration code for `siteKey` on `origin`. */
export function snippets(origin: string, siteKey: string) {
  // Spelled in two pieces: the bundle is inlined into a <script> element.
  const scriptEnd = "</" + "script>";
  const frontend = [
    "<script>",
    `  window.CAP_CUSTOM_WASM_URL = "${origin}/cap_wasm_bg.wasm";`,
    `  window.CAP_CUSTOM_HASHWX_URL = "${origin}/hashwx.wasm";`,
    `  window.CAP_PAKO_URL = "${origin}/pako_inflate.min.js";`,
    scriptEnd,
    `<script src="${origin}/widget.js">${scriptEnd}`,
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

/** The secret dialog's lead text: with a fresh secret, or snippets only. */
export function secretWarning(site: Site, secret: string | null): string {
  return secret
    ? "Secret 仅显示一次，关闭后无法再次查看。请立即将其保存至服务器的环境变量（例如 PRIESTESS_SECRET）；如有遗失，只能通过轮换重新生成。"
    : `站点「${site.name}」的接入代码。Secret 不再显示；如有遗失，请轮换 secret。`;
}
