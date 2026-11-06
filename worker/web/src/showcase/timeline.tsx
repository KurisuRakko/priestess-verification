import { List, NumberRoll, Progress } from "@rakko/react";
import { useEffect, useState } from "react";

import { StepGlyph } from "./icons";
import type { ShowcaseStrings } from "./strings";
import type { Step } from "./trace";

/**
 * The run's four steps as a grouped list: a state glyph, the step and its
 * route, and its time on the right (solve shows a live progress bar while it
 * runs). Times roll in with NumberRoll once a step finishes.
 */
export function Timeline({
  steps,
  progress,
  s,
}: {
  steps: Step[];
  progress: number | null;
  s: ShowcaseStrings;
}) {
  return (
    <List.Group header={s.traceTitle} className="pv-trace">
      {steps.map((step) => (
        <List.Row
          key={step.id}
          className="pv-trace__row"
          data-state={step.state}
          leading={<StepGlyph state={step.state} />}
          detail={<StepTime step={step} progress={progress} />}
        >
          <span className="pv-trace__name">
            {s.steps[step.id]}
            <span className="pv-visually-hidden">
              {` — ${s.stepState[step.state]}`}
            </span>
          </span>
          <span className="pv-trace__note">{s.stepNotes[step.id]}</span>
          {step.id === "solve" && step.state === "running" ? (
            <Progress.Root
              className="pv-trace__progress"
              value={progress ?? 0}
              aria-label={s.solving}
            >
              <Progress.Track>
                <Progress.Indicator />
              </Progress.Track>
            </Progress.Root>
          ) : null}
        </List.Row>
      ))}
    </List.Group>
  );
}

function StepTime({ step, progress }: { step: Step; progress: number | null }) {
  if (step.ms !== undefined) {
    return (
      <span className="pv-trace__time">
        <RolledMs ms={step.ms} />
        <span className="pv-trace__unit">ms</span>
      </span>
    );
  }
  if (step.id === "solve" && step.state === "running") {
    return (
      <span className="pv-trace__time">
        {progress ?? 0}
        <span className="pv-trace__unit">%</span>
      </span>
    );
  }
  return (
    <span className="pv-trace__time" data-empty="">
      —
    </span>
  );
}

/**
 * Mounts at the same number of zeros and rolls to the value on the next
 * frame, so a finished step's time rolls in digit by digit instead of
 * appearing (NumberRoll only animates digits that change).
 */
function RolledMs({ ms }: { ms: number }) {
  const value = String(ms);
  const [shown, setShown] = useState(() => "0".repeat(value.length));
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <NumberRoll value={shown} />;
}
