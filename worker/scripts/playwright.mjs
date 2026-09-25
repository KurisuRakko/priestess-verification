/**
 * Resolves `playwright` from the worker's own node_modules when present, and
 * otherwise falls back to the copy the widget package already installs.
 * Keeps the browser scripts dependency-free without hard-coding a path.
 */

async function loadPlaywright() {
  const candidates = [
    "playwright",
    new URL("../../widget/node_modules/playwright/index.mjs", import.meta.url)
      .href,
  ];
  const failures = [];
  for (const specifier of candidates) {
    try {
      return await import(specifier);
    } catch (error) {
      failures.push(`${specifier}: ${error.message}`);
    }
  }
  throw new Error(
    `playwright is not installed. Tried:\n  ${failures.join("\n  ")}\n` +
      "Install it with `npm install --no-save playwright` in worker/, or run " +
      "`bun install` in widget/.",
  );
}

export const { chromium } = await loadPlaywright();
