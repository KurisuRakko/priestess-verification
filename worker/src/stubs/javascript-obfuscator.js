// Stub for `javascript-obfuscator` inside Cloudflare Workers.
//
// `core/src/instrumentation.js` dynamically imports javascript-obfuscator for
// obfuscation levels 8-10. It is a heavy pure-JS package that is not installed
// for the Worker bundle, so the specifier is aliased here: importing it
// rejects, instrumentation.js falls back to the level 4-7 path.
throw new Error(
  "[priestess-verification-worker] javascript-obfuscator is unavailable in Workers",
);
