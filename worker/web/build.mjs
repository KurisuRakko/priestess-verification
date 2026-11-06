/**
 * `npm run build:web` — builds the two front-end entries into
 * `src/generated/`, one at a time so neither can share (and so split out) a
 * chunk with the other:
 *
 *   src/generated/showcase.client.js + showcase.css   →  `/`
 *   src/generated/gate.client.js     + gate.css       →  gate page, `/protected`
 *
 * The `.client.js` / `.css` names put both under wrangler's Text rules, so the
 * Worker imports them as strings and inlines them. Each script is a classic
 * IIFE (the pages load `/widget.js` first, then this). The output is checked
 * in, like the widget's `*.min.js`: rerun this after any change under `web/`.
 *
 * After building, every file is checked for `</script` and `</style`: the
 * pages inline them raw, and either sequence would end the element early
 * (the page modules also refuse to load such a file). Scripts must not hold
 * `<!--` either: followed by a `<script`, it puts the HTML parser in the
 * double-escaped state, where `</script>` no longer closes the element.
 */
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "vite";

const WEB = fileURLToPath(new URL(".", import.meta.url));
const OUT = fileURLToPath(new URL("../src/generated/", import.meta.url));
const ENTRIES = ["showcase", "gate"];

for (const name of ENTRIES) {
  await build({
    configFile: `${WEB}vite.config.ts`,
    mode: "production",
    logLevel: "warn",
    build: {
      outDir: OUT,
      // Both entries write into the same directory.
      emptyOutDir: false,
      copyPublicDir: false,
      rolldownOptions: {
        input: `${WEB}src/${name}/main.tsx`,
        output: {
          format: "iife",
          codeSplitting: false,
          entryFileNames: `${name}.client.js`,
          assetFileNames: (asset) =>
            asset.names.some((n) => n.endsWith(".css"))
              ? `${name}.css`
              : `${name}-[name][extname]`,
        },
      },
    },
  });
}

let failed = false;
for (const name of ENTRIES) {
  for (const [file, tag] of [
    [`${name}.client.js`, "script"],
    [`${name}.css`, "style"],
  ]) {
    const path = `${OUT}${file}`;
    const text = readFileSync(path, "utf8");
    for (const closer of [
      "</script",
      "</style",
      ...(tag === "script" ? ["<!--"] : []),
    ]) {
      if (text.toLowerCase().includes(closer)) {
        console.error(
          `[build:web] ${file} contains ${closer} and cannot be inlined in <${tag}>`,
        );
        failed = true;
      }
    }
    const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;
    console.log(
      `[build:web] ${file.padEnd(20)} ${kb(statSync(path).size).padStart(10)}  gzip ${kb(gzipSync(text).length)}`,
    );
  }
}
if (failed) process.exit(1);
