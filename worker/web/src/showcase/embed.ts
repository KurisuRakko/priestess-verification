import type { Lang } from "../shared/i18n";
import { capLang } from "../shared/i18n";
import type { Variant } from "./config";

/**
 * The HTML a site would paste to get the variant on the stage, pointed at
 * this origin's production endpoint (`/`, scope "site").
 *
 * This file is bundled into an inline `<script>`, so the source must never
 * spell a closing script tag or an HTML comment opener: `END_SCRIPT` is
 * assembled at runtime (web/build.mjs refuses a bundle that contains either).
 */
const END_SCRIPT = ["<", "/script>"].join("");

export function embedSnippet(
  variant: Variant,
  origin: string,
  lang: Lang,
  tokenComment: string,
): string {
  const wasm = [
    "<script>",
    `  window.CAP_CUSTOM_WASM_URL = "${origin}/cap_wasm_bg.wasm";`,
    `  window.CAP_CUSTOM_HASHWX_URL = "${origin}/hashwx.wasm";`,
    `  window.CAP_PAKO_URL = "${origin}/pako_inflate.min.js";`,
    END_SCRIPT,
    `<script src="${origin}/widget.js">${END_SCRIPT}`,
  ];

  if (variant.invisible) {
    return [
      ...wasm,
      "<script>",
      `  const cap = new Cap({ apiEndpoint: "${origin}/" });`,
      "  cap.solve().then(({ token }) => {",
      `    // ${tokenComment}`,
      "  });",
      END_SCRIPT,
    ].join("\n");
  }

  const attrs = [`data-cap-api-endpoint="${origin}/"`];
  if (lang === "zh") attrs.push(`data-cap-lang="${capLang(lang)}"`);
  if (variant.mascot) attrs.push("data-cap-mascot");
  if (variant.auto) attrs.push("data-cap-auto");
  if (variant.bare) {
    attrs.push(
      'style="--cap-background: transparent; --cap-border-color: transparent"',
    );
  }
  return [
    ...wasm,
    "",
    "<cap-widget",
    ...attrs.map((a) => `  ${a}`),
    "></cap-widget>",
  ].join("\n");
}
