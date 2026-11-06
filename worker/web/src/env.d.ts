/// <reference types="vite/client" />

import type { DetailedHTMLProps, HTMLAttributes } from "react";

/** What `/widget.js` (widget/src/cap.min.js) puts on `window`. */
export interface CapInstance {
  solve(): Promise<unknown>;
  reset(): void;
  /**
   * The hidden `<cap-widget>` a programmatic Cap appends to `<html>`. Cap only
   * forwards `addEventListener` to it, so listeners go on this element.
   */
  widget: HTMLElement;
}

declare global {
  interface Window {
    Cap?: new (options: { apiEndpoint: string }) => CapInstance;
    CAP_CUSTOM_WASM_URL?: string;
    CAP_CUSTOM_HASHWX_URL?: string;
    CAP_PAKO_URL?: string;
    CAP_SCRIPT_NONCE?: string;
  }
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      // Attributes are `data-cap-*` (hyphenated, so JSX does not type-check
      // them); see shared/cap-widget.tsx.
      "cap-widget": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
