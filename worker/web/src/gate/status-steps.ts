/**
 * The challenge's status line plays its steps one by one (`statusSteps` in
 * strings.ts), paced by `usePacedStatus` (paced-status.ts). This is the pure
 * half: which step comes next, given the real phase. No runtime imports — the
 * Worker's tests import it.
 */

/** Real phases in order; each owns one group of steps. */
export const STATUS_GROUPS = [
  "checking",
  "computing",
  "submitting",
  "passed",
] as const;

export type StatusGroup = (typeof STATUS_GROUPS)[number];

/** How long each step stays up before the next one may replace it. */
export const STATUS_MIN_MS = 700;

export interface StatusStep {
  group: StatusGroup;
  text: string;
}

/** The steps as one flat list, groups in phase order. */
export function flattenSteps(
  steps: Record<StatusGroup, readonly string[]>,
): StatusStep[] {
  return STATUS_GROUPS.flatMap((group) =>
    steps[group].map((text) => ({ group, text })),
  );
}

/**
 * The step to show after `index` has had its time, or `index` itself to hold:
 *
 *   - a pass skips straight to the passed step;
 *   - a next step from a later phase than the real one waits for it;
 *   - a next step from an earlier phase than the real one is skipped: the
 *     real phase's first step comes instead;
 *   - otherwise, the next step.
 */
export function nextStatusStep(
  steps: readonly StatusStep[],
  index: number,
  real: StatusGroup,
): number {
  const rank = (group: StatusGroup) => STATUS_GROUPS.indexOf(group);
  const realRank = rank(real);
  const next = index + 1;
  if (next >= steps.length) return index;
  if (real === "passed") {
    const passed = steps.findIndex((step) => step.group === "passed");
    return passed > index ? passed : index;
  }
  const nextRank = rank(steps[next].group);
  if (nextRank > realRank) return index;
  if (nextRank < realRank) {
    const first = steps.findIndex((step) => step.group === real);
    return first > index ? first : index;
  }
  return next;
}
