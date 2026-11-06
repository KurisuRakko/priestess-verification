import type { GlyphName, MascotPose } from "./common";
import { GLYPHS, MASCOT_POSES, mascotSrc } from "./common";

/** A glyph from common.ts; the shell draws the same SVG with `glyphMarkup`. */
export function Icon({
  name,
  className,
}: {
  name: GlyphName;
  className: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * The mascot from common.ts in `pose`; the shell draws the same markup with
 * `mascotMarkup`.
 */
export function Mascot({
  endpoint,
  pose,
  className,
}: {
  endpoint: string;
  pose: MascotPose;
  className: string;
}) {
  return (
    <span className={className} data-pose={pose} aria-hidden="true">
      {MASCOT_POSES.map((p) => (
        <img
          key={p}
          className={`${className}-pose`}
          data-pose={p}
          src={mascotSrc(endpoint, p)}
          alt=""
          decoding="async"
          draggable={false}
        />
      ))}
    </span>
  );
}
