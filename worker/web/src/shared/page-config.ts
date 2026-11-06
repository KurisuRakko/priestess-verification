import { useState } from "react";

/**
 * The server-rendered shell (`demo-page.js` / `gate-page.js`) hands the page
 * its data as `<script type="application/json" id="page-config">`. The JSON is
 * parsed once per page load; it never changes afterwards.
 */
const ELEMENT_ID = "page-config";

let cached: unknown;

export function readPageConfig<T>(): T {
  if (cached === undefined) {
    const node = document.getElementById(ELEMENT_ID);
    if (!node?.textContent) throw new Error(`missing #${ELEMENT_ID}`);
    cached = JSON.parse(node.textContent);
  }
  return cached as T;
}

/** `readPageConfig` as a hook: the same object on every render. */
export function usePageConfig<T>(): T {
  const [config] = useState(() => readPageConfig<T>());
  return config;
}
