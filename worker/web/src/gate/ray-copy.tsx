import { CopyButton } from "@rakko/react";
import { useState } from "react";
import { createPortal } from "react-dom";

import type { GateStrings } from "./strings";

/**
 * The copy button next to the session ID. The footer is part of the server
 * shell (outside #root, so it reads the same with or without JS); the shell
 * leaves a slot of the button's size in it and this portals into that slot.
 */
export function RayCopy({ ray, s }: { ray: string; s: GateStrings }) {
  const [slot] = useState(() => document.getElementById("gate-ray-copy"));
  if (!slot) return null;
  return createPortal(
    <CopyButton
      text={ray}
      aria-label={s.copyRay}
      copiedLabel={s.copiedRay}
      className="pv-ray-copy"
    />,
    slot,
  );
}
