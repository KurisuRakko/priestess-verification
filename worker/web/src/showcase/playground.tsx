import {
  Button,
  CopyButton,
  SegmentedChoice,
  SwapText,
  useSnackbar,
} from "@rakko/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Lang } from "../shared/i18n";
import { capLang } from "../shared/i18n";
import type { ShowcaseConfig, Variant } from "./config";
import { embedSnippet } from "./embed";
import { ReplayIcon } from "./icons";
import type { Look, Trigger } from "./modes";
import {
  LOOKS,
  TRIGGERS,
  findVariant,
  lookOf,
  triggerOf,
  variantFromHash,
} from "./modes";
import { Stage } from "./stage";
import type { ShowcaseStrings } from "./strings";
import { fill } from "./strings";
import { Timeline } from "./timeline";
import { deriveSteps, totalMs, useRunTrace } from "./trace";

type Status = {
  state: "idle" | "running" | "ok" | "fail";
  text: string;
};

/** The selected variant, kept in step with `/#<id>` both ways. */
function useHashVariant(variants: Variant[]) {
  const [variant, setVariant] = useState(() => variantFromHash(variants));

  useEffect(() => {
    const onHash = () => setVariant(variantFromHash(variants));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [variants]);

  const select = useCallback((next: Variant) => {
    // replaceState: switching modes should not fill the back button.
    history.replaceState(null, "", `#${next.id}`);
    setVariant(next);
  }, []);

  return [variant, select] as const;
}

/**
 * The playground: look × trigger picker, the stage with the live widget, the
 * step trace and siteverify result beside it, and the embed code for the
 * current mode underneath.
 */
export function Playground({
  config,
  lang,
  s,
}: {
  config: ShowcaseConfig;
  lang: Lang;
  s: ShowcaseStrings;
}) {
  const [variant, select] = useHashVariant(config.variants);
  const [run, setRun] = useState(0);
  const [status, setStatus] = useState<Status>({ state: "idle", text: "" });
  const [result, setResult] = useState<unknown>(null);

  const runKey = `${variant.id}|${run}|${lang}`;
  const runRef = useRef(runKey);
  runRef.current = runKey;
  const trace = useRunTrace(config.endpoint, runKey);

  // Every (re)mount starts from a clean slate.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per run
  useEffect(() => {
    setStatus({ state: "idle", text: "" });
    setResult(null);
  }, [runKey]);

  const look = lookOf(variant);
  const trigger = triggerOf(variant);

  const pick = (nextLook: Look, nextTrigger: Trigger) => {
    const next = findVariant(config.variants, nextLook, nextTrigger);
    if (next && next.id !== variant.id) select(next);
  };

  const verify = useCallback(
    async (token: string) => {
      const id = runRef.current;
      trace.onToken();
      setStatus({ state: "running", text: s.status.checking });
      try {
        const res = await fetch(config.siteverify, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ response: token }),
        });
        const data = await res.json();
        if (id !== runRef.current) return;
        const ok = res.ok && data.success === true;
        trace.onVerified(ok);
        setResult({ status: res.status, ...data });
        setStatus(
          ok
            ? { state: "ok", text: "" }
            : { state: "fail", text: s.status.rejected },
        );
      } catch (error) {
        if (id !== runRef.current) return;
        trace.onVerified(false);
        setStatus({
          state: "fail",
          text: fill(s.status.network, { msg: (error as Error).message }),
        });
      }
    },
    [config.siteverify, s, trace.onToken, trace.onVerified],
  );

  const events = {
    onSolve: verify,
    onError: (message: string) => {
      trace.onFail();
      setStatus({
        state: "fail",
        text: fill(s.status.widgetError, { msg: message }),
      });
    },
    onProgress: (progress: number) => {
      trace.onProgress(progress);
      setStatus((current) =>
        current.state === "idle"
          ? { state: "running", text: s.status.running }
          : current,
      );
    },
  };

  const steps = deriveSteps(trace.trace);
  const total = totalMs(trace.trace);
  const statusText =
    status.state === "ok"
      ? fill(s.status.ok, { ms: String(total ?? "—") })
      : status.text ||
        (trigger === "click" ? s.status.waitClick : s.status.idle);

  const snippet = useMemo(
    () => embedSnippet(variant, location.origin, lang, s.tokenComment),
    [variant, lang, s.tokenComment],
  );
  const snackbar = useSnackbar();

  return (
    <div className="pv-play">
      <div className="pv-modes">
        <div className="pv-modes__group">
          <span className="pv-modes__label" id="pv-look-label">
            {s.lookLabel}
          </span>
          <SegmentedChoice.Root
            aria-labelledby="pv-look-label"
            className="pv-modes__segments"
            value={look}
            onValueChange={(value) => pick(value as Look, trigger)}
          >
            {LOOKS.map((id) => (
              <SegmentedChoice.Item key={id} value={id}>
                {s.looks[id]}
              </SegmentedChoice.Item>
            ))}
          </SegmentedChoice.Root>
        </div>
        <div className="pv-modes__group">
          <span className="pv-modes__label" id="pv-trigger-label">
            {s.triggerLabel}
          </span>
          <SegmentedChoice.Root
            aria-labelledby="pv-trigger-label"
            className="pv-modes__segments"
            value={trigger}
            onValueChange={(value) => pick(look, value as Trigger)}
          >
            {TRIGGERS.map((id) => (
              <SegmentedChoice.Item
                key={id}
                value={id}
                disabled={look === "invisible" && id === "click"}
              >
                {s.triggers[id]}
              </SegmentedChoice.Item>
            ))}
          </SegmentedChoice.Root>
        </div>
      </div>

      <div className="pv-play__grid">
        <section
          className="pv-stage"
          aria-label={s.stageLabel}
          data-look={look}
        >
          <header className="pv-stage__head">
            <p className="pv-stage__note">
              <span className="pv-stage__id">#{variant.id}</span>
              <SwapText value={s.modeNotes[variant.id] ?? ""} />
            </p>
            <Button
              variant="ghost"
              icon={<ReplayIcon />}
              onClick={() => setRun((n) => n + 1)}
            >
              {s.replay}
            </Button>
          </header>
          <div id="stage" className="pv-stage__body">
            <Stage
              key={runKey}
              variant={variant}
              endpoint={config.endpoint}
              lang={capLang(lang)}
              run={run}
              ghostNote={s.ghost}
              ghostSub={s.ghostSub}
              events={events}
            />
          </div>
          <output id="status" className="pv-status" data-state={status.state}>
            <span className="pv-status__dot" aria-hidden="true" />
            <SwapText value={statusText} />
          </output>
        </section>

        <aside className="pv-side">
          <Timeline
            steps={steps}
            progress={trace.trace.progress}
            s={s}
          />
          <details className="pv-raw">
            <summary>{s.rawResult}</summary>
            <pre id="result" className="pv-raw__json">
              {result ? JSON.stringify(result, null, 2) : "—"}
            </pre>
          </details>
        </aside>
      </div>

      <section className="pv-embed" aria-labelledby="pv-embed-title">
        <header className="pv-embed__head">
          <div>
            <h3 id="pv-embed-title" className="pv-embed__title">
              {s.embedTitle}
              <span className="pv-embed__mode">#{variant.id}</span>
            </h3>
            <p className="pv-embed__lede">{s.embedLede}</p>
          </div>
          <CopyButton
            text={snippet}
            aria-label={s.copy}
            copiedLabel={s.copied}
            onCopied={() => snackbar.add({ title: s.copiedToast })}
            onCopyError={() => snackbar.add({ title: s.copyFailed })}
          />
        </header>
        <pre className="pv-embed__code">
          <code>{snippet}</code>
        </pre>
      </section>
    </div>
  );
}
