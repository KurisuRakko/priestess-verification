/**
 * Why a gate check failed, as far as the page can tell, so the failed state
 * can say what to do next (`failures` in strings.ts). Pure, no runtime
 * imports — the Worker's tests import it.
 *
 * Two sources:
 *  - the widget's `error` event, of which `listenToCap` passes on only the
 *    message: the widget's own text for client-side failures, or the server's
 *    `error` field from /challenge and /redeem (it never sees the status);
 *  - the `/__gate/pass` response: status and JSON body.
 * Matching is on those exact texts (widget/src/src/cap.js, handlers.js
 * `redeemFailure`, siteverify.js, the 429 body); anything else is `unknown`.
 * The first matching pattern wins, so their order matters.
 */
export const FAILURE_KINDS = [
  "rate_limited",
  "env_blocked",
  "unsupported",
  "expired",
  "network",
  "unknown",
] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

const PATTERNS: [FailureKind, RegExp][] = [
  // The 429 body's `error` ("Too many requests"), or its `reason`.
  ["rate_limited", /too many requests|rate_limited/i],
  // The widget's "Instrumentation blocked (…)" / "Instrumentation timed out",
  // the server's "Instrumentation timeout" / "Blocked by instrumentation".
  [
    "env_blocked",
    /^instrumentation (blocked|timed out|timeout)|blocked by instrumentation/i,
  ],
  // The widget's `challenge_unsupported` texts ("hashwx requires
  // WebAssembly", "unsupported format-2 protocol '…'", "malformed hashwx
  // challenge payload"), and a hashwx.wasm that would not load or compile
  // ("Failed to fetch hashwx wasm: 404", WebAssembly CompileError texts).
  // Before `network`: the wasm fetch error also starts with "Failed to fetch".
  [
    "unsupported",
    /requires webassembly|unsupported format-2 protocol|malformed hashwx|hashwx wasm|webassembly|compileerror/i,
  ],
  // Redeem: "Challenge expired" / "Challenge already redeemed"; pass:
  // "Token expired" / "Token not found".
  [
    "expired",
    /^challenge (expired|already redeemed)$|^token (expired|not found)$/i,
  ],
  // fetch() rejections (Chromium, Firefox, Safari, React Native polyfills),
  // a response that is not the service's JSON.
  [
    "network",
    /failed to fetch|networkerror|load failed|network request failed|failed to parse|unable to solve challenge/i,
  ],
];

/** The kind for a widget `error` message (or a server `error` text). */
export function failureFromMessage(message: string | undefined): FailureKind {
  if (!message) return "unknown";
  for (const [kind, pattern] of PATTERNS) {
    if (pattern.test(message)) return kind;
  }
  return "unknown";
}

/**
 * The kind for a `/__gate/pass` response that is not `ok`. No JSON body
 * means something other than the Worker answered (a proxy or CDN error
 * page): counted as the service being out of reach.
 */
export function failureFromPass(
  status: number,
  data: { error?: string; reason?: string } | null,
): FailureKind {
  if (status === 429 || data?.reason === "rate_limited") return "rate_limited";
  if (!data) return "network";
  return failureFromMessage(data.error);
}
