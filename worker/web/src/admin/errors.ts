/**
 * Error wording for the console. The API answers in short English sentences
 * (`{ "error": "…" }`); the console shows a Chinese explanation first and
 * keeps the original text for reference. Pure functions, unit-tested in
 * test/admin-ui.test.js (which also runs every gate validation message from
 * the backend through `GATE_ERROR_RULES`).
 */

/** `/admin?error=<code>` after a failed sign-in (see callback.ts). */
export const LOGIN_ERRORS: Readonly<Record<string, string>> = {
  not_an_admin: "该 Priestess 账号没有后台访问权限。",
  app_access_denied: "该 Priestess 账号未获授权使用本应用。",
  invalid_state: "登录状态已失效（可能已超过 10 分钟），请重新登录。",
  invalid_login_code: "登录码已失效，请重新登录。",
  missing_login_code: "未收到登录码，请重新登录。",
  priestess_unreachable: "暂时无法连接 Priestess，请稍后重试。",
  network_error: "网络连接异常，请重新登录。",
};

export function loginErrorText(code: string | null): string {
  if (!code) return "";
  return LOGIN_ERRORS[code] || `登录失败：${code}`;
}

export const SESSION_EXPIRED = "登录已过期，请重新登录。";
export const SIGNED_OUT = "已退出。";
export const BOOT_FAILED = "加载失败，请刷新页面后重试。";

/**
 * A failed API call: `status` is the HTTP status, or null when the request
 * never got an answer; `message` is the API's own `error` text (or
 * `HTTP <status>` when the body had none).
 */
export class ApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Thrown after a 401: the console has already switched to the sign-in panel. */
export class Unauthenticated extends Error {
  constructor() {
    super("unauthenticated");
    this.name = "Unauthenticated";
  }
}

export interface ErrorLike {
  status?: number | null;
  message: string;
}

const HTTP_ERRORS: Readonly<Record<number, string>> = {
  400: "提交的内容未通过校验。",
  403: "当前账号无权执行此操作。",
  404: "请求的对象不存在，可能已被删除。",
  409: "该操作与现有配置冲突。",
  429: "请求过于频繁，请稍后重试。",
};

export function describeError(
  error: ErrorLike,
  messages: Readonly<Record<number, string>> = {},
): string {
  const status = error.status;
  let text: string;
  if (!status) text = "网络连接异常，请稍后重试。";
  else
    text =
      messages[status] ||
      HTTP_ERRORS[status] ||
      (status >= 500 ? "服务内部错误，请稍后重试。" : "请求未能完成。");
  const raw = error.message;
  return raw && raw !== `HTTP ${status}` ? `${text}（原始信息：${raw}）` : text;
}

export type GateField = "host" | "upstream" | "exemptPaths";

/**
 * The gate API's 400 messages (gate-hosts.js, gate-api.js) name the field
 * they are about. The first rule whose text occurs in the lowercased message
 * gives the field to mark and the explanation.
 */
export const GATE_ERROR_RULES: ReadonlyArray<
  readonly [needle: string, field: GateField, text: string]
> = [
  [
    "this service's own host",
    "host",
    "该域名是本服务自身的域名，不能设为网关域名。",
  ],
  [
    "host must be a bare hostname",
    "host",
    "域名格式无效，应为小写主机名，不含协议、端口与路径。",
  ],
  ["gate hosts", "host", "网关域名数量已达上限，请先删除不再使用的域名。"],
  [
    "upstream must not point at the host itself",
    "upstream",
    "源站地址不能指向该域名本身。",
  ],
  ["upstream must use https", "upstream", "源站地址必须使用 https:// 协议。"],
  [
    "upstream must be a bare origin",
    "upstream",
    "源站地址不能包含路径、查询参数或片段。",
  ],
  ["upstream", "upstream", "源站地址格式无效，应为以 https:// 开头的地址。"],
  [
    "exempt path must not be /",
    "exemptPaths",
    "放行路径不能为 /，否则整个域名都将免于验证。",
  ],
  [
    "exempt path must not be under",
    "exemptPaths",
    "放行路径不能位于 /__gate/ 之下。",
  ],
  [
    "must not contain",
    "exemptPaths",
    "放行路径不能包含 ?、#、;、..、空白字符或编码后的分隔符（如 %2F）。",
  ],
  ["characters", "exemptPaths", "每条放行路径不能超过 256 个字符。"],
  ["starting with /", "exemptPaths", "每条放行路径都必须以 / 开头。"],
  ["exempt paths", "exemptPaths", "放行路径最多 50 条。"],
  ["exemptpaths", "exemptPaths", "放行路径格式无效。"],
];

/** The rule a 400 message falls under, or undefined. */
export function gateErrorRule(message: string) {
  const raw = message.toLowerCase();
  return GATE_ERROR_RULES.find(([needle]) => raw.includes(needle));
}

/**
 * -> `{ text, field, detail }`: `text` is the full explanation with the
 * original message (for the notice under the form), `field` the form
 * control the error is about (or null), and `detail` the Chinese
 * explanation alone, shown under that field. A 409 means "already exists"
 * when creating and "defined by the deployment configuration" otherwise.
 */
export function describeGateError(
  error: ErrorLike,
  creating: boolean,
): { text: string; field: GateField | null; detail: string } {
  const rule =
    error.status === 400 ? gateErrorRule(error.message || "") : undefined;
  const messages = {
    400: rule ? rule[2] : "提交的内容未通过校验。",
    404: "该域名不存在，可能已被删除。",
    409: creating
      ? "该域名已存在于后台或部署配置中。"
      : "该域名由部署配置定义，无法在后台修改。",
  };
  const text = describeError(error, messages);
  const field = rule
    ? rule[1]
    : creating && error.status === 409
      ? "host"
      : null;
  const detail = field ? messages[error.status as 400 | 409] : text;
  return { text, field, detail };
}

export type SiteField =
  | "name"
  | "origins"
  | "challengeDifficulty"
  | "challengeCount"
  | "hashwxDifficulty"
  | "tokenTtlMinutes";

/**
 * The sites API's 400 messages (sites.js, admin/api.js), matched like
 * `GATE_ERROR_RULES`: the first rule whose text occurs in the lowercased
 * message gives the site form field (or null) and the explanation.
 */
export const SITE_ERROR_RULES: ReadonlyArray<
  readonly [needle: string, field: SiteField | null, text: string]
> = [
  ["name must be", "name", "名称须为 1 至 80 个字符。"],
  [
    "not a url",
    "origins",
    "允许的域名中有无法识别的地址，每行应为一个以协议开头的地址（例如 https://example.com）。",
  ],
  [
    "must be a bare origin",
    "origins",
    "允许的域名只能包含协议与域名（可带端口），不能包含路径、查询参数或片段。",
  ],
  [
    "must use https",
    "origins",
    "允许的域名必须使用 https:// 协议；仅 localhost、127.0.0.1 与 [::1] 可使用 http://。",
  ],
  ["at least one origin", "origins", "至少需要填写一个允许的域名。"],
  ["origins must be", "origins", "允许的域名格式无效。"],
  ["origins", "origins", "允许的域名最多 50 个。"],
  ["sites", null, "站点数量已达上限，请先删除不再使用的站点。"],
  [
    "challengedifficulty",
    "challengeDifficulty",
    "SHA-256 难度须为 1 至 16 之间的整数。",
  ],
  [
    "challengecount",
    "challengeCount",
    "SHA-256 题目数量须为 1 至 1000 之间的整数。",
  ],
  ["challengesize", null, "SHA-256 题目长度须为 1 至 256 之间的整数。"],
  [
    "hashwxdifficulty",
    "hashwxDifficulty",
    "HashWX 难度须为 1 至 1000000000 之间的整数。",
  ],
  [
    "tokenttlms",
    "tokenTtlMinutes",
    "token 有效期须介于 1 秒与 1440 分钟之间。",
  ],
];

export function siteErrorRule(message: string) {
  const raw = message.toLowerCase();
  return SITE_ERROR_RULES.find(([needle]) => raw.includes(needle));
}

/**
 * -> `{ text, field }` for a failed sites API call. A 400 the rules know and
 * a 404 read as a Chinese explanation alone; anything else is the general
 * explanation with the original message (`describeError`). `field` is the
 * site form control the error is about, or null.
 */
export function describeSiteError(error: ErrorLike): {
  text: string;
  field: SiteField | null;
} {
  const rule =
    error.status === 400 ? siteErrorRule(error.message || "") : undefined;
  if (rule) return { text: rule[2], field: rule[1] };
  if (error.status === 404) {
    return { text: "该站点不存在，可能已被删除。", field: null };
  }
  return { text: describeError(error), field: null };
}

const SITE_ACTIONS = {
  load: "站点列表加载失败",
  enable: "启用失败",
  disable: "停用失败",
  rotate: "轮换失败",
  delete: "删除失败",
} as const;

export type SiteAction = keyof typeof SITE_ACTIONS;

/** The Snackbar line for a failed site action: "停用失败：…". */
export function siteFailureText(action: SiteAction, error: ErrorLike): string {
  return `${SITE_ACTIONS[action]}：${describeSiteError(error).text}`;
}
