import { defineStrings } from "../shared/i18n";

/**
 * Showcase copy. Style and trigger labels are keyed by `Look` / `Trigger`
 * (modes.ts); `{ms}` and `{n}` are filled in by the caller.
 */
export const STRINGS = defineStrings({
  zh: {
    brand: "Priestess Verification",
    controlsLabel: "页面设置",
    langLabel: "语言",
    themeToLight: "切换到浅色",
    themeToDark: "切换到深色",
    github: "在 GitHub 上查看源码",

    eyebrow: "工作量证明 · 自托管",
    heroTitle: "不打扰真人的人机验证",
    heroLede:
      "浏览器在后台算一道小小的工作量证明，再顺手查一下运行环境，脚本就被挡在门外。不用找红绿灯，不追踪访客，整套跑在你自己的 Cloudflare Workers 上。",
    tryIt: "试一试",
    seeGate: "看全屏门禁",
    heroFacts: ["Apache-2.0 开源", "零第三方请求", "token 用后即废"],

    playEyebrow: "01 · 试玩",
    playTitle: "挑一种样子，真的验证一次",
    playLede:
      "每一次都会向服务器要一道真题、在你的浏览器里解出来，再把拿到的 token 交给服务器核验。旁边的「过程」记下了每一步花了多久。",
    lookLabel: "样式",
    triggerLabel: "触发",
    looks: {
      standard: "标准",
      mascot: "看板娘",
      bare: "无背景",
      invisible: "隐形",
    },
    triggers: { click: "点击", auto: "自动" },
    modeNotes: {
      click: "最常见的样子：访客勾一下，后台解题。",
      auto: "进入视野就开始解题，访客什么都不用做。",
      mascot: "竖版卡片，看板娘陪着访客等结果。",
      "mascot-auto": "看板娘卡片，进入视野就自动开始。",
      bare: "去掉卡片底色和边框，直接融进你的页面。",
      "bare-auto": "无背景的看板娘，自动开始。",
      invisible: "页面上什么都不出现，验证在后台悄悄完成。",
    } as Record<string, string>,
    replay: "重来",
    stageLabel: "演示舞台",
    ghost: "这里什么都不会出现。",
    ghostSub: "验证正在后台进行，「过程」里能看到它走到了哪一步。",

    traceTitle: "过程",
    steps: {
      challenge: "取题",
      solve: "求解",
      redeem: "兑换 token",
      verify: "服务端核验",
    },
    stepNotes: {
      challenge: "POST /demo/challenge",
      solve: "工作量证明 · 环境检测",
      redeem: "POST /demo/redeem",
      verify: "POST /demo/siteverify",
    },
    stepState: {
      idle: "等待",
      running: "进行中",
      done: "完成",
      fail: "失败",
    },
    solving: "求解进度",
    status: {
      idle: "等待开始",
      waitClick: "点一下上面的验证框开始",
      running: "正在验证…",
      checking: "拿到 token，正在请服务器核验…",
      ok: "服务器核验通过，共 {ms} ms",
      rejected: "服务器没有通过这个 token",
      widgetError: "组件出错：{msg}",
      network: "核验请求失败：{msg}",
    },
    rawResult: "服务器原始返回",

    embedTitle: "嵌入代码",
    embedLede:
      "复制到你的页面里，就是上面这个样子。后端收到 token 后，带上密钥调用 POST /siteverify 核验。",
    copy: "复制嵌入代码",
    copied: "已复制",
    copiedToast: "嵌入代码已复制",
    copyFailed: "复制失败，请手动选择代码",
    tokenComment: "把 token 交给你的后端，由它调用 POST /siteverify 核验",

    featuresEyebrow: "02 · 为什么用它",
    featuresTitle: "对真人几乎无感，对脚本是实打实的成本",
    features: [
      {
        title: "工作量证明",
        body: "访客的浏览器花一小会儿算一道哈希题。对一个人来说是一眨眼，对一次想刷上万次的脚本，就是上万份算力账单。",
      },
      {
        title: "不追踪",
        body: "不加载第三方脚本，不给访客建档。题目和 token 只在你的页面和你的服务器之间往返，每个 token 只能核验一次。",
      },
      {
        title: "看板娘卡片",
        body: "可选的竖版卡片：验证中、通过、出错各有一张表情。也可以去掉底色，让她直接站在你的页面上。",
      },
      {
        title: "Cloudflare Workers 自托管",
        body: "Workers 加 Durable Objects，一次完整验证只有 3 个请求、写 3 行数据，免费额度就够日常使用。",
      },
    ],

    gateEyebrow: "03 · 整站门禁",
    gateTitle: "把验证放在整个网站前面",
    gateBody:
      "不想改前端时，可以让 Worker 在请求到达源站之前拦下来：没通过验证的访客先看到一张全屏验证页，通过后拿到 30 分钟的通行证，再回到原来要去的地方。",
    gateFlow: [
      "GET /protected",
      "全屏验证页",
      "POST /__gate/pass",
      "回到 /protected",
    ],
    gateFlowLabel: "门禁流程",
    gateCta: "打开 /protected 看看",
  },
  en: {
    brand: "Priestess Verification",
    controlsLabel: "Page settings",
    langLabel: "Language",
    themeToLight: "Switch to light theme",
    themeToDark: "Switch to dark theme",
    github: "View the source on GitHub",

    eyebrow: "Proof of work · Self-hosted",
    heroTitle: "Bot checks that stay out of the way",
    heroLede:
      "The browser quietly works through a small proof-of-work puzzle and takes a quick look at its own environment — enough to keep scripts out. No traffic lights to click, no tracking, and it all runs on your own Cloudflare Workers.",
    tryIt: "Try it",
    seeGate: "See the full-page gate",
    heroFacts: [
      "Apache-2.0",
      "No third-party requests",
      "Single-use tokens",
    ],

    playEyebrow: "01 · Playground",
    playTitle: "Pick a look, run a real check",
    playLede:
      "Each run asks the server for a fresh challenge, solves it in your browser, and hands the token back to the server to verify. The trace alongside times every step.",
    lookLabel: "Style",
    triggerLabel: "Trigger",
    looks: {
      standard: "Standard",
      mascot: "Mascot",
      bare: "Bare",
      invisible: "Invisible",
    },
    triggers: { click: "Click", auto: "Auto" },
    modeNotes: {
      click: "The familiar one: tick the box, the work happens behind it.",
      auto: "Starts solving as soon as it scrolls into view. Nothing to click.",
      mascot: "A tall card with a mascot who waits with your visitor.",
      "mascot-auto": "The mascot card, starting on its own.",
      bare: "No card fill or border — it sits right on your page.",
      "bare-auto": "The bare mascot, starting on its own.",
      invisible: "Nothing shows up at all; the check finishes in the background.",
    } as Record<string, string>,
    replay: "Run again",
    stageLabel: "Demo stage",
    ghost: "Nothing will appear here.",
    ghostSub:
      "The check is running in the background — follow along in the trace.",

    traceTitle: "What happens",
    steps: {
      challenge: "Fetch challenge",
      solve: "Solve",
      redeem: "Redeem token",
      verify: "Server-side check",
    },
    stepNotes: {
      challenge: "POST /demo/challenge",
      solve: "Proof of work · environment check",
      redeem: "POST /demo/redeem",
      verify: "POST /demo/siteverify",
    },
    stepState: {
      idle: "Waiting",
      running: "In progress",
      done: "Done",
      fail: "Failed",
    },
    solving: "Solving progress",
    status: {
      idle: "Waiting to start",
      waitClick: "Click the checkbox above to start",
      running: "Verifying…",
      checking: "Got a token, asking the server to check it…",
      ok: "Verified by the server in {ms} ms",
      rejected: "The server rejected this token",
      widgetError: "Widget error: {msg}",
      network: "Verification request failed: {msg}",
    },
    rawResult: "Raw server response",

    embedTitle: "Embed code",
    embedLede:
      "Paste this into your page to get exactly what you see above. Your backend then checks the token with POST /siteverify and its secret.",
    copy: "Copy embed code",
    copied: "Copied",
    copiedToast: "Embed code copied",
    copyFailed: "Couldn't copy — select the code by hand",
    tokenComment: "send the token to your backend, which checks it with POST /siteverify",

    featuresEyebrow: "02 · Why it works",
    featuresTitle: "Nearly free for people, real cost for scripts",
    features: [
      {
        title: "Proof of work",
        body: "Each visitor's browser spends a moment on a hashing puzzle. For a person that's a blink; for a script trying ten thousand times, it's ten thousand compute bills.",
      },
      {
        title: "No tracking",
        body: "No third-party scripts, no visitor profiles. Challenges and tokens only travel between your page and your server, and every token verifies exactly once.",
      },
      {
        title: "Mascot card",
        body: "An optional tall card with a face for checking, passed and error. Drop the background and she stands right on your page.",
      },
      {
        title: "Self-hosted on Workers",
        body: "Workers plus Durable Objects: a full check is 3 requests and 3 rows written, so the free tier covers everyday traffic.",
      },
    ],

    gateEyebrow: "03 · Site-wide gate",
    gateTitle: "Put the check in front of a whole site",
    gateBody:
      "When you'd rather not touch the front end, the Worker can stop requests before they reach your origin. Unverified visitors get a full-page check first, then a 30-minute pass that sends them on to where they were going.",
    gateFlow: [
      "GET /protected",
      "Full-page check",
      "POST /__gate/pass",
      "Back to /protected",
    ],
    gateFlowLabel: "Gate flow",
    gateCta: "Open /protected",
  },
});

export type ShowcaseStrings = (typeof STRINGS)["en"];

/** `"{ms} ms"` → `"812 ms"`. */
export function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}
