import { Button, SwapText } from "@rakko/react";
import { useEffect, useRef, useState } from "react";

import { CapWidget } from "../shared/cap-widget";
import { capLang } from "../shared/i18n";
import type { MascotPose } from "./common";
import { fill, withHost } from "./common";
import type { GateConfig } from "./config";
import { postJson } from "./config";
import { Mascot } from "./icons";
import { usePacedStatus } from "./paced-status";
import type { StatusGroup } from "./status-steps";
import { STATUS_MIN_MS } from "./status-steps";
import type { GateStrings } from "./strings";

/**
 * The real state: checking → computing (the widget's progress events) →
 * submitting (the token goes to /__gate/pass) → passed, or failed from any of
 * them. `failed` carries what to show and an optional code. What the page
 * shows trails it through `usePacedStatus`.
 */
type Phase =
  | { name: "checking" }
  | { name: "computing"; progress: number }
  | { name: "submitting" }
  | { name: "passed" }
  | { name: "failed"; detail: string; code?: string };

/**
 * The challenge (status 403 page), laid out like a browser-check page: no
 * card, one left-aligned column on the page itself — the host as the heading,
 * a line saying what is going on, the status line (the mascot, whose pose is
 * the status, and two lines of text), then a paragraph on what the check is.
 * The status line plays its steps paced (paced-status.ts), with the real
 * progress beside them; the mascot, the subtitle and the leaving all follow
 * the step on screen, so the success shows only once its step does, and the
 * page leaves only once that step has been up for STATUS_MIN_MS.
 * The widget does the work out of sight (`pv-gate__engine` in gate.css keeps
 * it on screen for `data-cap-auto`, at 1px); the mascot here follows the
 * phase, not the widget, so a pass that the server rejects shows her error
 * pose too. The shell (`gate-page.js`) renders this same markup as the first
 * frame, in `checking`, with the widget slot empty; React takes over without
 * moving anything.
 */
export function Challenge({
  config,
  s,
}: {
  config: GateConfig;
  s: GateStrings;
}) {
  const [run, setRun] = useState(0);
  const [phase, setPhase] = useState<Phase>({ name: "checking" });
  const current = useRef(0);
  current.current = run;

  const [target, setTarget] = useState<string | null>(null);

  async function pass(token: string, id: number) {
    setPhase({ name: "submitting" });
    const back = location.pathname + location.search + location.hash;
    try {
      const { res, data } = await postJson(config, "pass", {
        token,
        return: back,
      });
      if (id !== current.current) return;
      if (res.ok && data?.ok) {
        setPhase({ name: "passed" });
        if (!config.stayOnPass) setTarget(data.redirect || "/");
        return;
      }
      setPhase({
        name: "failed",
        detail: s.passFailed,
        code: data?.error || `HTTP ${res.status}`,
      });
    } catch (error) {
      if (id === current.current) {
        setPhase({
          name: "failed",
          detail: s.network,
          code: (error as Error).message,
        });
      }
    }
  }

  function retry() {
    setPhase({ name: "checking" });
    setRun((n) => n + 1);
  }

  const failed = phase.name === "failed" ? phase : null;
  // A failure stops the steps where they are (and is shown over them).
  const real: StatusGroup = phase.name === "failed" ? "checking" : phase.name;
  const step = usePacedStatus(s.statusSteps, real, run);
  const passed = !failed && step.group === "passed";

  // Leave once the passed step has been up for its full time.
  useEffect(() => {
    if (!passed || target === null) return;
    const wait = Math.max(0, step.since + STATUS_MIN_MS - performance.now());
    const timer = window.setTimeout(() => location.replace(target), wait);
    return () => window.clearTimeout(timer);
  }, [passed, target, step.since]);

  const pose: MascotPose = failed ? "error" : passed ? "done" : "checking";
  const subtitle = failed
    ? s.subFailed
    : passed
      ? withHost(s.subPassed, config.host)
      : s.subChecking;
  const label = failed ? failed.detail : step.text;
  // The real progress, live (only the text is paced): none before the first
  // progress event, 100 once the work is done, gone on success or failure.
  const percent =
    failed || passed || phase.name === "checking"
      ? null
      : phase.name === "computing"
        ? Math.round(phase.progress)
        : 100;
  const hint = failed
    ? null
    : passed
      ? withHost(s.hintPassed, config.host)
      : s.hintWorking;

  return (
    <main
      className="pv-gate"
      data-phase={failed ? "failed" : passed ? "passed" : step.group}
    >
      <section className="pv-gate__body" aria-labelledby="gate-title">
        <h1 className="pv-gate__title" id="gate-title">
          {config.host}
        </h1>
        <p className="pv-gate__subtitle">
          <SwapText value={subtitle} />
        </p>
        <div className="pv-gate__status">
          <Mascot
            endpoint={config.endpoint}
            pose={pose}
            className="pv-gate__mascot"
          />
          <div className="pv-gate__state" role={failed ? "alert" : undefined}>
            <p className="pv-gate__state-text">
              <span aria-live="polite">
                <SwapText value={label} />
              </span>
              {percent === null ? null : (
                <span className="pv-gate__percent" aria-hidden="true">
                  {fill(s.percent, { n: percent })}
                </span>
              )}
            </p>
            {hint ? (
              <p className="pv-gate__hint">
                <SwapText value={hint} />
              </p>
            ) : null}
            {failed ? (
              <div className="pv-gate__error">
                <Button variant="primary" onClick={retry}>
                  {s.retry}
                </Button>
                {failed.code ? (
                  <p className="pv-gate__error-code">
                    {s.errorCode}
                    <code>{failed.code}</code>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="pv-gate__engine" aria-hidden="true" inert>
            <CapWidget
              endpoint={config.endpoint}
              lang={capLang(config.lang)}
              auto
              bare
              run={run}
              onProgress={(progress) => {
                // The widget reports 0 as soon as it starts, before it even
                // has a challenge: still checking until there is real work.
                if (run !== current.current || progress <= 0) return;
                setPhase((prev) =>
                  prev.name === "checking" || prev.name === "computing"
                    ? progress >= 100
                      ? { name: "submitting" }
                      : { name: "computing", progress }
                    : prev,
                );
              }}
              onSolve={(token) => pass(token, run)}
              onError={(message) =>
                setPhase({
                  name: "failed",
                  detail: s.widgetError,
                  code: message,
                })
              }
            />
          </div>
        </div>
        <p className="pv-gate__explain">{withHost(s.explain, config.host)}</p>
      </section>
    </main>
  );
}
