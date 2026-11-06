import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Times one verification run, step by step:
 *
 *   challenge  →  solve  →  redeem  →  siteverify
 *
 * The widget does the first three on its own, so their timings come from the
 * browser's Resource Timing entries for `<endpoint>challenge` and
 * `<endpoint>redeem` (anything that started before this run is ignored);
 * solve is the gap between the two, with the widget's `progress` events for
 * the live percentage. Siteverify is our own fetch and is timed directly.
 *
 * A click widget may solve speculatively before the click, so challenge and
 * redeem can already be done when the visitor arrives: that is what really
 * happened, and the trace shows it as such.
 */
export type StepId = "challenge" | "solve" | "redeem" | "verify";
export type StepState = "idle" | "running" | "done" | "fail";

export interface Step {
  id: StepId;
  state: StepState;
  /** Whole milliseconds, once known. */
  ms?: number;
}

interface Span {
  start: number;
  end: number;
}

interface Trace {
  startedAt: number;
  challenge?: Span;
  redeem?: Span;
  /** Last `progress` value, 0–100; null before the first event. */
  progress: number | null;
  /** When progress first reached 100 (redeem may still be in flight). */
  solvedAt?: number;
  /** When the widget handed over the token. */
  tokenAt?: number;
  verify?: { start: number; end?: number; ok?: boolean };
  failed: boolean;
}

const fresh = (): Trace => ({
  startedAt: performance.now(),
  progress: null,
  failed: false,
});

const ms = (from?: number, to?: number) =>
  from === undefined || to === undefined
    ? undefined
    : Math.max(0, Math.round(to - from));

export function deriveSteps(t: Trace): Step[] {
  const challenge: Step = t.challenge
    ? { id: "challenge", state: "done", ms: ms(t.challenge.start, t.challenge.end) }
    : { id: "challenge", state: t.progress !== null ? "running" : "idle" };

  const solveEnd = t.redeem?.start ?? t.solvedAt ?? t.tokenAt;
  const solve: Step =
    solveEnd !== undefined
      ? { id: "solve", state: "done", ms: ms(t.challenge?.end, solveEnd) }
      : {
          id: "solve",
          state: t.challenge && t.progress !== null ? "running" : "idle",
        };

  const redeem: Step = t.redeem
    ? { id: "redeem", state: "done", ms: ms(t.redeem.start, t.redeem.end) }
    : t.tokenAt !== undefined
      ? { id: "redeem", state: "done" }
      : { id: "redeem", state: solve.state === "done" ? "running" : "idle" };

  const verify: Step = !t.verify
    ? { id: "verify", state: "idle" }
    : t.verify.end === undefined
      ? { id: "verify", state: "running" }
      : {
          id: "verify",
          state: t.verify.ok ? "done" : "fail",
          ms: ms(t.verify.start, t.verify.end),
        };

  const steps = [challenge, solve, redeem, verify];
  // A failure lands on the first step that had not finished.
  if (t.failed) {
    const open = steps.find((s) => s.state !== "done");
    if (open && open.state !== "fail") open.state = "fail";
  }
  return steps;
}

/** Total time from the first request to the siteverify answer. */
export function totalMs(t: Trace): number | undefined {
  const first = t.challenge?.start ?? t.redeem?.start;
  return ms(first, t.verify?.end);
}

export function useRunTrace(endpoint: string, runKey: string) {
  const [trace, setTrace] = useState<Trace>(fresh);
  const current = useRef(trace);
  current.current = trace;

  // Every run starts from a clean slate (and a new time origin).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per run
  useEffect(() => {
    setTrace(fresh());
  }, [runKey]);

  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    const challengeUrl = new URL(`${endpoint}challenge`, location.href).href;
    const redeemUrl = new URL(`${endpoint}redeem`, location.href).href;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const kind = entry.name.startsWith(challengeUrl)
          ? "challenge"
          : entry.name.startsWith(redeemUrl)
            ? "redeem"
            : null;
        if (!kind) continue;
        const span = {
          start: entry.startTime,
          end: entry.startTime + entry.duration,
        };
        setTrace((t) =>
          span.start < t.startedAt ? t : { ...t, [kind]: span },
        );
      }
    });
    observer.observe({ type: "resource" });
    return () => observer.disconnect();
  }, [endpoint]);

  const onProgress = useCallback((progress: number) => {
    const now = performance.now();
    setTrace((t) => ({
      ...t,
      progress,
      solvedAt: progress >= 100 && t.solvedAt === undefined ? now : t.solvedAt,
    }));
  }, []);

  const onToken = useCallback(() => {
    const now = performance.now();
    setTrace((t) => ({ ...t, tokenAt: now, verify: { start: now } }));
  }, []);

  const onVerified = useCallback((ok: boolean) => {
    const now = performance.now();
    setTrace((t) =>
      t.verify ? { ...t, verify: { ...t.verify, end: now, ok } } : t,
    );
  }, []);

  const onFail = useCallback(() => {
    setTrace((t) => ({ ...t, failed: true }));
  }, []);

  return { trace, onProgress, onToken, onVerified, onFail };
}

export type RunTrace = ReturnType<typeof useRunTrace>;
export type { Trace };
