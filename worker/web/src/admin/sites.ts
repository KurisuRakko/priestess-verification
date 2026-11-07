/**
 * Site management helpers: what `/admin/api/sites` returns, the settings
 * summary on each site, the edit form ↔ request body, and the integration
 * snippets. Pure functions (unit-tested in test/admin-ui.test.js).
 */

export interface SiteSettings {
  challengeDifficulty?: number;
  challengeCount?: number;
  challengeSize?: number;
  hashwxDifficulty?: number;
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

/** The Worker-wide value of every per-site setting (`siteDefaults`, admin/api.js). */
export type SiteDefaults = Required<SiteSettings>;

/** `GET /admin/api/sites`. */
export interface SitesResponse {
  sites: Site[];
  defaults: SiteDefaults;
  /** `"legacy"` (format 1, SHA-256) or the format-2 PoW protocols, comma separated. */
  protocol: string;
}

/** Which proof of work the challenges carry, and so which settings apply. */
export function powKinds(protocol: string): {
  sha256: boolean;
  hashwx: boolean;
} {
  const list = protocol.split(",");
  return {
    sha256: protocol === "legacy" || list.includes("sha256-pow"),
    hashwx: list.includes("hashwx"),
  };
}

/** The advanced settings' note on the proof of work in effect. */
export function protocolNote(protocol: string): string {
  const { sha256, hashwx } = powKinds(protocol);
  if (hashwx && sha256)
    return "当前工作量证明同时使用 HashWX 与 SHA-256，以下设置均生效。";
  if (hashwx)
    return "当前工作量证明为 HashWX，SHA-256 相关设置不适用，因此不予显示。";
  if (sha256)
    return "当前工作量证明为 SHA-256，HashWX 相关设置不适用，因此不予显示。";
  return "当前未启用工作量证明，难度设置不适用，因此不予显示。";
}

/** `ms` in minutes, at most three decimals, without trailing zeros. */
export function minutesText(ms: number): string {
  return String(Math.round((ms / 60000) * 1000) / 1000);
}

const SETTING_LABELS: Record<string, (value: never) => string> = {
  challengeDifficulty: (v: number) => `SHA-256 难度 ${v}`,
  challengeCount: (v: number) => `SHA-256 题目数量 ${v}`,
  challengeSize: (v: number) => `SHA-256 题目长度 ${v}`,
  hashwxDifficulty: (v: number) => `HashWX 难度 ${v}`,
  tokenTtlMs: (v: number) => `token 有效期 ${minutesText(v)} 分钟`,
  blockAutomatedBrowsers: (v: boolean) =>
    v ? "拦截自动化浏览器" : "放行自动化浏览器",
};

const SHA256_SETTINGS = [
  "challengeDifficulty",
  "challengeCount",
  "challengeSize",
];

/**
 * "HashWX 难度 300000 · token 有效期 10 分钟", or "" when the site uses every
 * default. A setting the current protocol ignores is marked as such.
 */
export function describeSettings(
  settings: SiteSettings,
  protocol: string,
): string {
  const kinds = powKinds(protocol);
  return Object.entries(settings)
    .map(([key, value]) => {
      const text = SETTING_LABELS[key]?.(value as never) ?? `${key}=${value}`;
      const inactive =
        (SHA256_SETTINGS.includes(key) && !kinds.sha256) ||
        (key === "hashwxDifficulty" && !kinds.hashwx);
      return inactive ? `${text}（当前协议下不生效）` : text;
    })
    .join(" · ");
}

/** The site dialog's fields, as the inputs hold them (strings). */
export interface SiteForm {
  name: string;
  origins: string;
  challengeDifficulty: string;
  challengeCount: string;
  hashwxDifficulty: string;
  tokenTtlMinutes: string;
  blockAutomatedBrowsers: boolean;
}

const numberText = (value: number | undefined) =>
  value == null ? "" : String(value);

export function siteForm(site: Site | null, defaults?: SiteDefaults): SiteForm {
  const s = site?.settings ?? {};
  return {
    name: site?.name ?? "",
    origins: site ? site.origins.join("\n") : "",
    challengeDifficulty: numberText(s.challengeDifficulty),
    challengeCount: numberText(s.challengeCount),
    hashwxDifficulty: numberText(s.hashwxDifficulty),
    tokenTtlMinutes: s.tokenTtlMs == null ? "" : minutesText(s.tokenTtlMs),
    blockAutomatedBrowsers:
      s.blockAutomatedBrowsers ?? defaults?.blockAutomatedBrowsers ?? false,
  };
}

/**
 * The POST / PATCH body. `settings` starts from the site's stored settings,
 * and only the fields the admin changed (against `siteForm(site)`) replace
 * them: a setting the form hides or leaves alone is sent back unchanged, even
 * one the form cannot show exactly (a sub-minute token lifetime). A cleared
 * field is `null` (use the global default), and so is the checkbox when it
 * matches the global default. Origins split on any whitespace.
 */
export function siteBody(
  form: SiteForm,
  site: Site | null = null,
  defaults?: SiteDefaults,
) {
  const initial = siteForm(site, defaults);
  const settings: Record<string, string | number | boolean | null> = {
    ...(site?.settings ?? {}),
  };
  for (const key of [
    "challengeDifficulty",
    "challengeCount",
    "hashwxDifficulty",
  ] as const) {
    if (form[key] !== initial[key]) settings[key] = form[key].trim() || null;
  }
  if (form.tokenTtlMinutes !== initial.tokenTtlMinutes) {
    const minutes = form.tokenTtlMinutes.trim();
    settings.tokenTtlMs = minutes ? Math.round(Number(minutes) * 60000) : null;
  }
  if (form.blockAutomatedBrowsers !== initial.blockAutomatedBrowsers) {
    settings.blockAutomatedBrowsers =
      form.blockAutomatedBrowsers ===
      (defaults?.blockAutomatedBrowsers ?? false)
        ? null
        : form.blockAutomatedBrowsers;
  }
  return {
    name: form.name,
    origins: form.origins.split(/\s+/).filter(Boolean),
    settings,
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
