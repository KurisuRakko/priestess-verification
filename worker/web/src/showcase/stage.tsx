import { useEffect, useRef } from "react";

import { CapWidget, createInvisibleCap } from "../shared/cap-widget";
import type { Variant } from "./config";

export interface StageEvents {
  onSolve: (token: string) => void;
  onError: (message: string) => void;
  onProgress: (progress: number) => void;
}

/** Runs the invisible variant: `new Cap()` in the background, after a beat on screen. */
function Invisible({
  endpoint,
  run,
  note,
  sub,
  events,
}: {
  endpoint: string;
  run: number;
  note: string;
  sub: string;
  events: StageEvents;
}) {
  const latest = useRef(events);
  latest.current = events;

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new `run` starts a fresh Cap
  useEffect(() => {
    const cap = createInvisibleCap(endpoint, latest);
    const timer = setTimeout(cap.start, 900);
    return () => {
      clearTimeout(timer);
      cap.dispose();
    };
  }, [endpoint, run]);

  return (
    <div className="pv-ghost">
      <p className="pv-ghost__title">{note}</p>
      <p className="pv-ghost__sub">{sub}</p>
    </div>
  );
}

/**
 * Where the selected variant lives. The parent keys it by variant, run and
 * language, so every change mounts a fresh widget, which enters with
 * `.pv-stage__slot`'s spring (a cross-fade would need a clone of the old
 * `<cap-widget>`, and a cloned widget connects and starts solving).
 */
export function Stage({
  variant,
  endpoint,
  lang,
  run,
  ghostNote,
  ghostSub,
  events,
}: {
  variant: Variant;
  endpoint: string;
  lang: string;
  run: number;
  ghostNote: string;
  ghostSub: string;
  events: StageEvents;
}) {
  return (
    <div className="pv-stage__slot">
      {variant.invisible ? (
        <Invisible
          endpoint={endpoint}
          run={run}
          note={ghostNote}
          sub={ghostSub}
          events={events}
        />
      ) : (
        <CapWidget
          endpoint={endpoint}
          lang={lang}
          mascot={variant.mascot}
          auto={variant.auto}
          bare={variant.bare}
          run={run}
          {...events}
        />
      )}
    </div>
  );
}
