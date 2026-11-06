import { useLayoutEffect, useRef } from "react";

import type { CapInstance } from "../env";

/**
 * React wrapper for the widget's `<cap-widget>` custom element (defined by
 * `/widget.js`, which the page shell loads before this bundle).
 *
 * Props map onto the element's `data-cap-*` attributes; the element reads
 * them once, when it connects, so any change to them mounts a fresh element
 * (the `key` below). Bump `run` to start over with the same props.
 *
 * Colours come from Rakko Design tokens through the widget's public `--cap-*`
 * variables (shared/cap-widget.css), so it follows light and dark mode;
 * `bare` drops the card fill and border so the host page shows through.
 */
export interface CapWidgetProps {
  /** `data-cap-api-endpoint`, e.g. `/demo/` or `/__gate/`. */
  endpoint: string;
  /** `data-cap-lang`, e.g. `zh-cn` or `en` (see `capLang` in i18n.ts). */
  lang?: string;
  /** `data-cap-mascot`: the vertical card with the mascot art. */
  mascot?: boolean;
  /** `data-cap-auto`: start solving as soon as the widget is in view. */
  auto?: boolean;
  /** No card background or border. */
  bare?: boolean;
  /** Changing this remounts the widget (a "try again"). */
  run?: number;
  className?: string;
  onSolve?: (token: string) => void;
  onError?: (message: string) => void;
  /** 0–100, as the widget reports it. */
  onProgress?: (progress: number) => void;
}

interface CapEvents {
  onSolve?: (token: string) => void;
  onError?: (message: string) => void;
  onProgress?: (progress: number) => void;
}

/**
 * Wires `solve` / `error` / `progress` from a widget element or a
 * programmatic Cap to the latest callbacks. Returns the unsubscribe function.
 */
export function listenToCap(
  target: EventTarget,
  events: { current: CapEvents },
): () => void {
  const onSolve = (event: Event) => {
    const token = (event as CustomEvent<{ token?: string }>).detail?.token;
    if (token) events.current.onSolve?.(token);
  };
  const onError = (event: Event) => {
    const message = (event as CustomEvent<{ message?: string }>).detail
      ?.message;
    events.current.onError?.(message || "unknown");
  };
  const onProgress = (event: Event) => {
    const progress = (event as CustomEvent<{ progress?: number }>).detail
      ?.progress;
    events.current.onProgress?.(Math.round(progress ?? 0));
  };
  target.addEventListener("solve", onSolve);
  target.addEventListener("error", onError);
  target.addEventListener("progress", onProgress);
  return () => {
    target.removeEventListener("solve", onSolve);
    target.removeEventListener("error", onError);
    target.removeEventListener("progress", onProgress);
  };
}

export function CapWidget({
  endpoint,
  lang,
  mascot = false,
  auto = false,
  bare = false,
  run = 0,
  className,
  onSolve,
  onError,
  onProgress,
}: CapWidgetProps) {
  const ref = useRef<HTMLElement>(null);
  const events = useRef<CapEvents>({});
  events.current = { onSolve, onError, onProgress };

  const key = [endpoint, lang, mascot, auto, run].join("|");

  // Layout effect: listening before the browser gets a chance to run the
  // widget's own (auto-start) observers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the element itself
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    return listenToCap(element, events);
  }, [key]);

  return (
    <cap-widget
      key={key}
      ref={ref}
      className={["pv-cap", bare && "pv-cap--bare", className]
        .filter(Boolean)
        .join(" ")}
      data-cap-api-endpoint={endpoint}
      data-cap-lang={lang}
      data-cap-mascot={mascot ? "" : undefined}
      data-cap-auto={auto ? "" : undefined}
    />
  );
}

/**
 * The widget's programmatic mode (`new Cap()`): solves in the background
 * without rendering anything on the page. `start` begins solving; the
 * returned `dispose` cancels and removes the hidden element Cap appends.
 */
export function createInvisibleCap(
  endpoint: string,
  events: { current: CapEvents },
) {
  const Cap = window.Cap;
  if (!Cap) throw new Error("the widget script (/widget.js) is not loaded");
  const cap: CapInstance = new Cap({ apiEndpoint: endpoint });
  const unlisten = listenToCap(cap.widget, events);
  return {
    // Failures arrive as an `error` event too.
    start: () => void cap.solve().catch(() => {}),
    dispose: () => {
      unlisten();
      cap.widget?.remove();
    },
  };
}
