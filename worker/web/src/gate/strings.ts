import type { Lang } from "../shared/i18n";

/**
 * Gate page copy, the single source for both sides: the React app reads it,
 * and so does the server shell (`src/gate-page.js` imports this file), which
 * renders the first frame — the same markup the app mounts — plus the footer
 * and `<title>`. Keep this module free of runtime imports: it is bundled into
 * the Worker too.
 *
 * Placeholders, filled in with `fill` (common.ts): `{host}` (the gated host),
 * `{ttl}` (the pass lifetime, see `formatTtl`), `{scope}` (where the pass
 * applies, see `passScopeText`), `{n}` (a number), `{domain}` (the cookie
 * domain), `{name}` in `poweredBy` (the linked product name, filled in by
 * the shell), `{time}` in `expiresAt` (the local clock time).
 */
const zh = {
  htmlLang: "zh-CN",
  // challenge
  gateTitle: "安全验证 · {host}",
  // the line under the host, one per outcome
  subChecking: "正在验证您是否为真人，这可能需要几秒钟时间。",
  subPassed: "验证成功，正在等待 {host} 响应…",
  subFailed: "验证失败",
  noscript:
    "完成验证需要启用 JavaScript。请在浏览器设置中启用 JavaScript 后刷新本页面。",
  // the status line, played one by one in order (see status-steps.ts); each
  // group belongs to the real phase it describes
  statusSteps: {
    checking: ["正在初始化验证环境…", "正在获取验证任务…", "正在检测浏览器运行环境…"],
    computing: ["正在进行工作量证明计算…", "正在验证工作量…", "正在校验任务完整性…"],
    submitting: ["正在提交验证结果…", "正在等待服务器确认…"],
    passed: ["验证成功"],
  },
  // the real progress after the step, from the first progress event on
  percent: "{n}%",
  // the small line under the status
  hintWorking: "验证完成前，请勿关闭此页面。",
  hintPassed: "即将跳转至 {host}。",
  // the failed state, one entry per FailureKind (failure.ts): `label` takes
  // the status line, `hint` the line under it, saying what to do
  failures: {
    rate_limited: {
      label: "验证请求过于频繁",
      hint: "当前网络发出的验证请求过多，请等待一分钟后重新验证。",
    },
    env_blocked: {
      label: "浏览器环境检测未通过",
      hint: "请停用可能修改网页脚本的扩展程序，或改用最新版本的 Chrome、Edge、Firefox 或 Safari 后重新验证。",
    },
    expired: {
      label: "验证结果已失效",
      hint: "本次验证已过期或已被使用，请重新验证。",
    },
    network: {
      label: "无法连接验证服务",
      hint: "请检查网络连接后重新验证。",
    },
    unknown: {
      label: "验证过程中出现错误",
      hint: "请重新验证；如问题持续出现，请将页面底部的会话 ID 提供给站点管理员。",
    },
  },
  retry: "重新验证",
  errorCode: "错误代码：",
  explain:
    "{host} 需要先确认您的连接安全，然后才能继续。验证由一组在您浏览器本地完成的工作量证明计算和运行环境检测组成，无需任何操作，也不会收集任何个人数据。",
  // facts filled into the copy
  ttlUnits: {
    hour: ["{n} 小时", "{n} 小时"],
    minute: ["{n} 分钟", "{n} 分钟"],
    second: ["{n} 秒", "{n} 秒"],
  },
  scopeDomain: "{domain} 及其子域",
  // footer
  ray: "会话 ID：",
  copyRay: "复制会话 ID",
  copiedRay: "已复制",
  poweredBy: "Powered by {name}",
  // passed (/protected)
  passedTitle: "受保护的示例页面",
  verified: "已通过验证",
  passedEyebrow: "受保护的内容",
  passedHeading: "您已通过验证",
  passedLede:
    "本页面是位于服务端访问保护之后的示例页面。您的浏览器已持有经签名的访问凭证，在凭证到期前使用当前浏览器访问时无需再次验证。该凭证适用于 {scope}。",
  remaining: "访问凭证剩余有效时间",
  expiresAt: "将于 {time} 到期",
  expired: "访问凭证已过期，请重新验证后继续访问。",
  logout: "清除访问凭证并重新验证",
  reverify: "重新验证",
  logoutDone: "访问凭证已清除，正在返回验证页面…",
  logoutFailed: "清除访问凭证失败，请稍后重试。",
  howHeading: "访问保护的工作流程",
  howFooter:
    "访问凭证与当前浏览器（User-Agent）绑定，适用于 {scope}；更换设备或浏览器后需要重新验证。",
  steps: [
    {
      title: "拦截请求",
      text: "未持有有效访问凭证的请求将被拦截，服务器返回验证页面（HTTP 403），不返回原页面内容。",
    },
    {
      title: "自动验证",
      text: "浏览器在后台完成工作量证明计算并接受运行环境检测，无需手动操作。",
    },
    {
      title: "签发凭证",
      text: "服务器校验验证结果后，签发有效期为 {ttl}的签名 Cookie（HttpOnly、Secure）。",
    },
    {
      title: "允许访问",
      text: "凭证有效期内，携带凭证的请求将直接送达原站点。",
    },
  ],
};

const en: typeof zh = {
  htmlLang: "en",
  gateTitle: "Security verification · {host}",
  subChecking: "Verifying you are human. This may take a few seconds.",
  subPassed: "Verification successful. Waiting for {host} to respond…",
  subFailed: "Verification failed",
  noscript:
    "JavaScript is required to complete verification. Enable JavaScript in your browser settings and reload this page.",
  statusSteps: {
    checking: [
      "Initializing verification…",
      "Fetching the challenge…",
      "Checking the browser environment…",
    ],
    computing: [
      "Computing proof of work…",
      "Verifying the work…",
      "Checking task integrity…",
    ],
    submitting: ["Submitting the result…", "Waiting for server confirmation…"],
    passed: ["Verification successful"],
  },
  percent: "{n}%",
  hintWorking: "Please keep this page open until verification completes.",
  hintPassed: "You will be redirected to {host} shortly.",
  failures: {
    rate_limited: {
      label: "Too many verification requests",
      hint: "Too many verification requests have been made from your network. Wait one minute, then verify again.",
    },
    env_blocked: {
      label: "The browser environment check did not pass",
      hint: "Disable extensions that modify page scripts, or use the latest version of Chrome, Edge, Firefox or Safari, then verify again.",
    },
    expired: {
      label: "The verification result is no longer valid",
      hint: "This verification has expired or has already been used. Verify again.",
    },
    network: {
      label: "Unable to reach the verification service",
      hint: "Check your network connection, then verify again.",
    },
    unknown: {
      label: "An error occurred during verification",
      hint: "Verify again. If the problem persists, provide the session ID at the bottom of this page to the site administrator.",
    },
  },
  retry: "Verify again",
  errorCode: "Error code: ",
  explain:
    "{host} needs to review the security of your connection before proceeding. Verification consists of a proof-of-work computation and an environment check that run locally in your browser; no action is needed and no personal data is collected.",
  ttlUnits: {
    hour: ["{n} hour", "{n} hours"],
    minute: ["{n} minute", "{n} minutes"],
    second: ["{n} second", "{n} seconds"],
  },
  scopeDomain: "{domain} and its subdomains",
  ray: "Session ID:",
  copyRay: "Copy session ID",
  copiedRay: "Copied",
  poweredBy: "Powered by {name}",
  passedTitle: "Protected example page",
  verified: "Verified",
  passedEyebrow: "Protected content",
  passedHeading: "Verification complete",
  passedLede:
    "This is an example page behind the server-side access gate. Your browser holds a signed access pass; until it expires, this browser is not asked to verify again. The pass applies to {scope}.",
  remaining: "Access pass expires in",
  expiresAt: "Expires at {time}",
  expired: "The access pass has expired. Verify again to continue.",
  logout: "Clear access pass and verify again",
  reverify: "Verify again",
  logoutDone: "Access pass cleared. Returning to verification…",
  logoutFailed: "Failed to clear the access pass. Please try again later.",
  howHeading: "How the access gate works",
  howFooter:
    "The access pass is bound to this browser (by its User-Agent) and applies to {scope}. Another device or browser must be verified separately.",
  steps: [
    {
      title: "Request intercepted",
      text: "A request without a valid access pass is intercepted and answered with the verification page (HTTP 403); the original page is not returned.",
    },
    {
      title: "Automatic verification",
      text: "The browser completes a proof-of-work computation and an environment check in the background; no interaction is required.",
    },
    {
      title: "Pass issued",
      text: "The server validates the result and issues a signed cookie (HttpOnly, Secure) valid for {ttl}.",
    },
    {
      title: "Access granted",
      text: "While the pass is valid, requests carrying it go straight through to the site.",
    },
  ],
};

export const STRINGS: Record<Lang, typeof zh> = { zh, en };

export type GateStrings = typeof zh;
