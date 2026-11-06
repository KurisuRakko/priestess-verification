#!/usr/bin/env node
/**
 * scripts/check-design.mjs —— Worker 页面的 Rakko Design 合规检查（Node 标准库，零依赖）。
 *
 * 检查对象：
 *   worker/web/src 下的 .css           React 前端（展示页 / 门禁页）自己的样式
 *   worker/web/src 下的 .ts / .tsx     React 前端源码
 *   worker/src/demo-page.js、gate-page.js 服务端页面壳（首帧 HTML、style 属性）
 *   worker/src/admin/admin.css、admin.client.js、page.js  后台（不走 React，单独一组）
 *
 * 规则（注释里的内容不算）：
 *   - CSS（逐条声明）：裸 hex（只有 mask 声明里的 #000 / #fff 例外）、rgb/hsl/hwb/lab/lch/
 *     oklab/oklch/color() 颜色函数、CSS 颜色名、backdrop-filter（材质只能来自 vendor 的
 *     glass.css / data-glass）、font-family 不是 var(--font-*)/inherit、transition(-property): all、
 *     font-weight 或 font 简写里的字重 > 600 / bold（CJK 禁伪粗）、z-index 不是 var(--layer-*)
 *     也不是 -2…2 的局部层叠记账。
 *   - 玻璃出生规则：选择器命中 [data-glass] 或页面骨架里带 data-glass 的元素的 class/id 时，
 *     规则块里不许有 opacity: 0 / display: none / visibility: hidden（查不到祖先元素上的隐藏）。
 *   - JS：backdrop-filter、SVG 的 fill/stroke 写死颜色（必须 currentColor 或 none）、style 属性里的 hex。
 *   - 零外网：fonts.googleapis、@import url(http。
 *   - 样式入口顺序：worker/web/src/shared/base.css 前两条 @import 必须依次是
 *     '@rakko/design-system/tokens.css' 与 '@rakko/react/styles.css'；每个入口 main.tsx 第一条 import
 *     必须是 ../shared/base.css；两个页面壳必须内联 ./generated/<入口>.css。
 *     后台页面必须内联 vendor 的 tokens.generated.css、glass.css、state-layer.css，且 vendor
 *     样式在页面样式之前。
 *   - vendor 完整性（给了 RAKKO_DESIGN_DIR 时）：vendor/rakko-design/design-system/src/* 与
 *     react/src 整棵树（排除 *.test.ts、*.test.tsx、vitest.setup.ts）跟上游逐字节一致、文件集合一致；
 *     tokens.generated.css 的两段与 scaffold 原文一致。
 *
 * 输出：逐条 `文件:行号: 原因`；有问题 exit 1，否则一行 OK。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAKKO_DIR = process.env.RAKKO_DESIGN_DIR || "";
const VENDOR = join(ROOT, "vendor/rakko-design");

const WEB_SRC = join(ROOT, "worker/web/src");
const BASE_CSS = join(WEB_SRC, "shared/base.css");
const SHELLS = [
  { file: join(ROOT, "worker/src/demo-page.js"), entry: "showcase" },
  { file: join(ROOT, "worker/src/gate-page.js"), entry: "gate" },
];
// 后台是服务端拼的静态页（admin.css + admin.client.js 内联），不在 web/src 里，单独查。
const ADMIN = {
  css: join(ROOT, "worker/src/admin/admin.css"),
  client: join(ROOT, "worker/src/admin/admin.client.js"),
  page: join(ROOT, "worker/src/admin/page.js"),
};

const issues = [];
const rel = (p) => relative(ROOT, p).split("\\").join("/");
const add = (file, line, why) => issues.push(`${rel(file)}:${line}: ${why}`);

function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === "\n") n += 1;
  return n;
}

function read(path) {
  if (!existsSync(path)) {
    add(path, 1, "缺少文件");
    return "";
  }
  return readFileSync(path, "utf8");
}

/** 注释换成等长空白（保留换行），规则只查生效的代码。 */
function stripComments(text, kind) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (kind === "js") out = out.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p) => p + blank(m.slice(p.length)));
  return out;
}

function each(text, regex, fn) {
  for (const m of text.matchAll(regex)) fn(m, lineOf(text, m.index));
}

function listFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listFiles(p, out);
    else out.push(p);
  }
  return out;
}

const CSS_FILES = listFiles(WEB_SRC).filter((p) => p.endsWith(".css"));
const SCRIPT_FILES = listFiles(WEB_SRC).filter((p) => /\.tsx?$/.test(p));
if (CSS_FILES.length === 0) add(WEB_SRC, 1, "web/src 下没有任何 CSS（目录结构变了？）");

// ------------------------------------------------------------------ CSS
// CSS 颜色名全集（CSS Color 4）；transparent / currentColor 不算写死颜色。
const NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue " +
    "blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk " +
    "crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki " +
    "darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue " +
    "dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite " +
    "gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen " +
    "lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen " +
    "magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream " +
    "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen " +
    "steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;
const MASK_HEX = /^#(?:000|fff|000000|ffffff)$/i;

/** 带 data-glass 的元素的 class / id（页面骨架里写死的那些），用来查「玻璃被藏起来」。 */
function glassSelectors(files) {
  const names = new Set();
  const sources = files.map(read);
  for (const text of sources) {
    for (const tag of text.matchAll(/<[a-z][^<>]*data-glass="[^"]+"[^<>]*>/g)) {
      for (const m of tag[0].matchAll(/\b(class|id)="([^"]+)"/g)) {
        for (const name of m[2].split(/\s+/)) {
          if (name) names.add(m[1] === "id" ? `#${name}` : `.${name}`);
        }
      }
    }
  }
  return [...names];
}

function checkCss(PAGE_CSS, glass) {
  const css = stripComments(read(PAGE_CSS), "css");

  // 逐条声明：prop: value
  each(css, /([a-z-]+)\s*:\s*([^;{}]+)(?=[;}])/g, (m, line) => {
    const prop = m[1];
    const value = m[2].trim();
    for (const hex of value.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
      if (!(/mask/.test(prop) && MASK_HEX.test(hex))) {
        add(PAGE_CSS, line, `裸 hex ${hex}（${prop}；只有 mask 里的 #000/#fff 例外）`);
      }
    }
    if (COLOR_FUNCTION.test(value)) {
      add(PAGE_CSS, line, `颜色字面量 ${value.match(COLOR_FUNCTION)[0]}…（${prop}；用 token + color-mix）`);
    }
    const bare = value.replace(/var\([^()]*\)/g, " ").replace(/url\([^()]*\)/g, " ");
    for (const word of bare.toLowerCase().match(/[a-z]+/g) ?? []) {
      if (NAMED_COLORS.has(word)) add(PAGE_CSS, line, `颜色名 ${word}（${prop}；用 token）`);
    }
    if (prop === "backdrop-filter" || prop === "-webkit-backdrop-filter") {
      add(PAGE_CSS, line, "backdrop-filter 只能来自 glass.css（用 data-glass）");
    }
    if (prop === "font-family" && !/^(?:var\(--font-(?:sans|serif|mono)\)|inherit)$/.test(value)) {
      add(PAGE_CSS, line, `font-family 必须是 var(--font-*)：${value}`);
    }
    if ((prop === "transition" || prop === "transition-property") && /(?:^|,)\s*all\b/.test(value)) {
      add(PAGE_CSS, line, `${prop}: all`);
    }
    if (prop === "font-weight" || prop === "font") {
      const weight = prop === "font-weight" ? value : (value.match(/\b([1-9]00|bold(?:er)?)\b/)?.[1] ?? "");
      if (/bold/.test(weight) || Number(weight) > 600) add(PAGE_CSS, line, `字重 ${weight}（CJK 禁伪粗，最多 600）`);
    }
    if (prop === "z-index" && !/^var\(--layer-(?:chrome|overlay|popup|toast)\)$/.test(value) && !/^-?[0-2]$/.test(value)) {
      add(PAGE_CSS, line, `z-index ${value}（用 var(--layer-*)）`);
    }
  });

  // 玻璃表面不许被 opacity:0 / display:none / visibility:hidden 藏起来（出生规则）。
  each(css, /\s*([^{}\s][^{}]*)\{([^{}]*)\}/g, (m) => {
    const selector = m[1];
    const line = lineOf(css, m.index + m[0].indexOf(selector));
    const body = m[2];
    const hits = selector.includes("[data-glass") || glass.some((g) => new RegExp(`${g.replace(/[.#-]/g, "\\$&")}(?![\\w-])`).test(selector));
    if (!hits) return;
    if (/(?:^|;)\s*(?:opacity\s*:\s*0(?![.\d])|display\s*:\s*none|visibility\s*:\s*hidden)/.test(body)) {
      add(PAGE_CSS, line, `玻璃表面被隐藏（${selector.trim()}）：玻璃必须从第一帧起常驻`);
    }
  });
}

const webGlass = glassSelectors([...SHELLS.map((s) => s.file), ...SCRIPT_FILES]);
for (const file of CSS_FILES) checkCss(file, webGlass);
checkCss(ADMIN.css, glassSelectors([ADMIN.page, ADMIN.client]));

// ------------------------------------------------------------------ JS / HTML 骨架
for (const file of [...SCRIPT_FILES, ...SHELLS.map((s) => s.file), ADMIN.client, ADMIN.page]) {
  const js = stripComments(read(file), "js");
  each(js, /backdrop-filter/g, (_m, line) => add(file, line, "backdrop-filter 只能来自 glass.css（用 data-glass）"));
  each(js, /\b(?:fill|stroke)="(?!currentColor|none)[^"]*"/g, (m, line) => add(file, line, `SVG 颜色写死：${m[0]}（用 currentColor）`));
  each(js, /style="[^"]*#[0-9a-fA-F]{3,8}/g, (m, line) => add(file, line, `style 属性里的 hex：${m[0]}`));
  for (const [needle, why] of [
    ["fonts.googleapis", "外部字体（零外网）"],
    ["@import url(http", "外部 CSS @import（零外网）"],
  ]) {
    let at = js.indexOf(needle);
    while (at !== -1) {
      add(file, lineOf(js, at), why);
      at = js.indexOf(needle, at + needle.length);
    }
  }
}

// ------------------------------------------------------------------ 样式入口
{
  const css = stripComments(read(BASE_CSS), "css");
  const imports = [...css.matchAll(/@import\s+([^;]+);/g)].map((m) => m[1].trim().replace(/^['"]|['"]$/g, ""));
  const want = ["@rakko/design-system/tokens.css", "@rakko/react/styles.css"];
  if (!css.trimStart().startsWith("@import") || imports[0] !== want[0] || imports[1] !== want[1]) {
    add(BASE_CSS, 1, `样式入口顺序错：前两条 @import 必须依次是 ${want.join(" → ")}（现在是 ${imports.slice(0, 2).join(" → ") || "空"}）`);
  }
}
for (const { file, entry } of SHELLS) {
  const main = join(WEB_SRC, entry, "main.tsx");
  const first = stripComments(read(main), "js").match(/import\s+["']([^"']+)["']/)?.[1];
  if (first !== "../shared/base.css") add(main, 1, `第一条 import 必须是 "../shared/base.css"（现在是 ${first ?? "空"}）`);
  const page = read(file);
  if (!page.includes(`./generated/${entry}.css`)) add(file, 1, `没有内联 ./generated/${entry}.css`);
  if (!page.includes(`./generated/${entry}.client.js`)) add(file, 1, `没有内联 ./generated/${entry}.client.js`);
}
{
  const page = read(ADMIN.page);
  const imports = [
    "vendor/rakko-design/tokens.generated.css",
    "vendor/rakko-design/design-system/src/glass.css",
    "vendor/rakko-design/design-system/src/state-layer.css",
  ];
  for (const path of imports) if (!page.includes(path)) add(ADMIN.page, 1, `没有内联 ${path}`);
  const vendorAt = page.search(/<style[^>]*data-vendor/);
  const pageAt = page.search(/<style[^>]*data-page/);
  if (vendorAt === -1 || pageAt === -1 || vendorAt > pageAt) add(ADMIN.page, 1, "vendor 样式必须在页面样式之前内联");
}

// ------------------------------------------------------------------ vendor 完整性
if (!existsSync(join(VENDOR, "tokens.generated.css"))) {
  add(join(VENDOR, "tokens.generated.css"), 1, "缺少 vendor：先跑 scripts/sync-design.sh");
}
if (RAKKO_DIR) {
  // @rakko/react 的测试文件不同步（scripts/sync-design.sh 的 copy_tree）。
  const isTest = (p) => /\.test\.tsx?$/.test(p) || basename(p) === "vitest.setup.ts";
  for (const [sub, skipTests] of [
    ["design-system/src", false],
    ["react/src", true],
  ]) {
    const upstream = join(RAKKO_DIR, sub);
    const mine = join(VENDOR, sub);
    const up = new Set(
      listFiles(upstream)
        .map((p) => relative(upstream, p))
        .filter((p) => !(skipTests && isTest(p))),
    );
    const have = new Set(listFiles(mine).map((p) => relative(mine, p)));
    if (up.size === 0) add(upstream, 1, "上游目录为空或不存在（RAKKO_DESIGN_DIR 指错了？）");
    for (const f of up) {
      if (!have.has(f)) add(join(mine, f), 1, "上游有、vendor 没有");
      else if (!readFileSync(join(upstream, f)).equals(readFileSync(join(mine, f)))) add(join(mine, f), 1, "与上游不一致（vendor 不许手改）");
    }
    for (const f of have) if (!up.has(f)) add(join(mine, f), 1, "vendor 多出的文件（上游没有）");
  }

  const scaffold = readFileSync(join(RAKKO_DIR, "design-system/templates/scaffold.html"), "utf8");
  const first = scaffold.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? "";
  const tokens = read(join(VENDOR, "tokens.generated.css"));
  for (const block of [first.match(/:root\s*\{([^{}]*)\}/)?.[1], first.match(/\[data-theme\s*=\s*['"]dark['"]\]\s*\{([^{}]*)\}/)?.[1]]) {
    const body = (block ?? "").replace(/^\s*\n/, "").replace(/\s*$/, "");
    if (!body || !tokens.includes(body)) add(join(VENDOR, "tokens.generated.css"), 1, "与 scaffold.html 的 token 块不一致");
  }
}

if (issues.length) {
  for (const line of issues) console.error(line);
  console.error(`[check-design] ${issues.length} 个问题`);
  process.exit(1);
}
console.log(
  `[check-design] OK（web/src ${CSS_FILES.length} 个 CSS / ${SCRIPT_FILES.length} 个 TS(X) + 页面壳 + 后台${RAKKO_DIR ? " + vendor 完整性" : ""}）`,
);
