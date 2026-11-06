import { useEffect, useMemo, useState } from "react";

import type { StatusGroup, StatusStep } from "./status-steps";
import { flattenSteps, nextStatusStep, STATUS_MIN_MS } from "./status-steps";

/**
 * Plays the status steps one at a time, each up for at least STATUS_MIN_MS,
 * never ahead of `real` and skipping what `real` has already left behind
 * (`nextStatusStep`). A new `run` starts over from the first step. Returns the
 * step on screen and when it went up (`performance.now()`), which the caller
 * uses to hold the passed step for its own STATUS_MIN_MS before leaving.
 * A failure is not a step: the caller shows it over this, right away.
 */
export function usePacedStatus(
  steps: Record<StatusGroup, readonly string[]>,
  real: StatusGroup,
  run: number,
): StatusStep & { since: number } {
  const list = useMemo(() => flattenSteps(steps), [steps]);
  const [shown, setShown] = useState(() => ({
    run,
    index: 0,
    since: performance.now(),
  }));

  // A retry: back to the first step (during render, so no stale frame).
  if (shown.run !== run) {
    setShown({ run, index: 0, since: performance.now() });
  }

  const target = nextStatusStep(list, shown.index, real);
  useEffect(() => {
    if (target === shown.index) return;
    const wait = Math.max(0, shown.since + STATUS_MIN_MS - performance.now());
    const timer = window.setTimeout(
      () =>
        setShown((prev) =>
          prev.run === shown.run && prev.index === shown.index
            ? { run: prev.run, index: target, since: performance.now() }
            : prev,
        ),
      wait,
    );
    return () => window.clearTimeout(timer);
  }, [target, shown]);

  return { ...list[shown.index], since: shown.since };
}
