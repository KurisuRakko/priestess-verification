/**
 * Dependency-free pieces the React app and the server shell
 * (`src/gate-page.js`) both use, so the shell's first frame draws exactly what
 * the app mounts: the icons, the mascot, the placeholder fill-ins and the
 * pass countdown's format. Like strings.ts, no runtime imports here — it
 * is bundled into the Worker too.
 */

/** 24×24 stroked glyphs (lucide-style), drawn with `currentColor`. */
export const GLYPHS = {
  shield: [
    "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
  ],
  shieldCheck: [
    "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
    "m9 12 2 2 4-4",
  ],
  check: ["M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z", "m8 12.5 2.8 2.8 5.7-5.8"],
} as const;

export type GlyphName = keyof typeof GLYPHS;

/** The glyph as an SVG string (the shell's half of `<Icon>` in icons.tsx). */
export function glyphMarkup(name: GlyphName, className: string): string {
  const paths = GLYPHS[name].map((d) => `<path d="${d}"></path>`).join("");
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

/**
 * The challenge's status mark: the mascot in one of her three poses, the same
 * art the widget's mascot card uses (served under `<endpoint>mascot/`). All
 * three are stacked and loaded up front; `data-pose` on the figure picks the
 * one shown and gate.css cross-fades between them.
 */
export const MASCOT_POSES = ["checking", "done", "error"] as const;

export type MascotPose = (typeof MASCOT_POSES)[number];

export function mascotSrc(endpoint: string, pose: MascotPose): string {
  return `${endpoint}mascot/${pose}.webp`;
}

/** The mascot as markup (the shell's half of `<Mascot>` in icons.tsx). */
export function mascotMarkup(
  endpoint: string,
  pose: MascotPose,
  className: string,
): string {
  const images = MASCOT_POSES.map(
    (p) =>
      `<img class="${className}-pose" data-pose="${p}" src="${mascotSrc(endpoint, p)}" alt="" decoding="async" draggable="false" />`,
  ).join("");
  return `<span class="${className}" data-pose="${pose}" aria-hidden="true">${images}</span>`;
}

/**
 * `text` with its `{key}` placeholders filled in from `values` (see
 * strings.ts); unknown keys are left as they are.
 */
export function fill(text: string, values: Record<string, string | number>) {
  // A function, so a `$` in a value is not read as a replacement pattern.
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** `text` with its `{host}` placeholder filled in. */
export function withHost(text: string, host: string): string {
  return fill(text, { host });
}

interface FactStrings {
  ttlUnits: Record<"hour" | "minute" | "second", string[]>;
  scopeDomain: string;
}

/**
 * The pass lifetime in words: whole hours as hours, otherwise whole minutes
 * as minutes (so under an hour, or 90 minutes), otherwise seconds.
 */
export function formatTtl(seconds: number, s: FactStrings): string {
  const [unit, n] =
    seconds % 3600 === 0
      ? (["hour", seconds / 3600] as const)
      : seconds % 60 === 0
        ? (["minute", seconds / 60] as const)
        : (["second", seconds] as const);
  return fill(s.ttlUnits[unit][n === 1 ? 0 : 1], { n });
}

/**
 * Where the pass applies: `<domain> and its subdomains` when the server sets
 * it for a parent domain (`passDomain`, see `passScope` in gate.js),
 * otherwise this host alone.
 */
export function passScopeText(
  host: string,
  passDomain: string | null | undefined,
  s: FactStrings,
): string {
  return passDomain ? fill(s.scopeDomain, { domain: passDomain }) : host;
}

/** What the pages need to know about the pass (see `GateConfig`). */
interface PassFacts {
  host: string;
  passTtlS: number;
  passDomain?: string | null;
}

/** `{ ttl, scope }` for the copy's `{ttl}` / `{scope}` placeholders. */
export function passFacts(facts: PassFacts, s: FactStrings) {
  return {
    ttl: formatTtl(facts.passTtlS, s),
    scope: passScopeText(facts.host, facts.passDomain, s),
  };
}

/** Seconds left on a pass expiring at `expiresAt` (epoch seconds). */
export function secondsLeft(expiresAt: number, nowMs: number): number {
  return Math.max(0, Math.round(expiresAt - nowMs / 1000));
}

/** `mm:ss`, or `h:mm:ss` from an hour up. */
export function formatLeft(left: number): string {
  const hours = Math.floor(left / 3600);
  const minutes = String(Math.floor((left % 3600) / 60)).padStart(2, "0");
  const seconds = String(left % 60).padStart(2, "0");
  return hours ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}
