import type { Variant } from "./config";

/**
 * The seven variants as two choices: a look and a trigger. `invisible` has
 * no click form, so picking it pins the trigger to `auto`.
 */
export type Look = "standard" | "mascot" | "bare" | "invisible";
export type Trigger = "click" | "auto";

export const LOOKS: Look[] = ["standard", "mascot", "bare", "invisible"];
export const TRIGGERS: Trigger[] = ["click", "auto"];

export function lookOf(variant: Variant): Look {
  if (variant.invisible) return "invisible";
  if (variant.bare) return "bare";
  if (variant.mascot) return "mascot";
  return "standard";
}

export function triggerOf(variant: Variant): Trigger {
  return variant.auto || variant.invisible ? "auto" : "click";
}

/** The variant for a look + trigger; `invisible` ignores the trigger. */
export function findVariant(
  variants: Variant[],
  look: Look,
  trigger: Trigger,
): Variant | undefined {
  return variants.find(
    (v) =>
      lookOf(v) === look && (look === "invisible" || triggerOf(v) === trigger),
  );
}

/** `/#<id>` (also `/#/<id>`); unknown or empty → the first variant. */
export function variantFromHash(variants: Variant[]): Variant {
  const id = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  return variants.find((v) => v.id === id) ?? variants[0];
}
