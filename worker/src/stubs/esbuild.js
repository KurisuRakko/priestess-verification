// Stub for `esbuild` inside Cloudflare Workers.
//
// `core/src/instrumentation.js` dynamically imports esbuild for obfuscation
// levels 4-7. esbuild ships a native binary that cannot run in workerd, and
// bundling it would fail at build time. Wrangler aliases the specifier to this
// module: importing it rejects, the try/catch in instrumentation.js turns that
// into a clean fallback, and levels 4-7 degrade to the unminified string-table
// output (levels <= 3 never import esbuild at all).
throw new Error(
  "[priestess-verification-worker] esbuild is unavailable in Workers",
);
