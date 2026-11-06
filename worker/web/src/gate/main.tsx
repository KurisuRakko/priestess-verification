import "../shared/base.css";
import "./gate.css";

import { installRippleFeedback } from "@rakko/design-system/ripple";
import { installPressFeedback } from "@rakko/react";
import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { GateApp } from "./app";

/*
 * Like shared/mount.tsx, but the first render is synchronous: the shell's
 * first frame (the same markup) is swapped for React's in one task, so no
 * frame with an empty #root is ever painted.
 */
const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
installRippleFeedback(document);
installPressFeedback(document);
const app = createRoot(root);
root.replaceChildren();
flushSync(() =>
  app.render(
    <StrictMode>
      <GateApp />
    </StrictMode>,
  ),
);
