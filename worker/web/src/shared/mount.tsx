import { installRippleFeedback } from "@rakko/design-system/ripple";
import { installPressFeedback } from "@rakko/react";
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

/**
 * Mounts a page into `#root`, replacing what the server rendered there.
 * Ripple and press feedback are delegated: installed once on the document,
 * surfaces opt in with `data-ripple` / `data-press`.
 */
export function mount(app: ReactNode): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("missing #root");
  installRippleFeedback(document);
  installPressFeedback(document);
  root.replaceChildren();
  createRoot(root).render(<StrictMode>{app}</StrictMode>);
}
