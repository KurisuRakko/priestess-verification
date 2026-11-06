import type { Lang } from "../shared/i18n";

/** `#page-config` of the gate pages (see `gate-page.js`). */
export interface GateConfig {
  view: "challenge" | "passed";
  host: string;
  /** Session ID, also sent as `X-Gate-Ray`. */
  ray: string;
  lang: Lang;
  /** `/__gate/`: challenge, redeem, pass and logout live under it. */
  endpoint: string;
  /** Pass expiry in epoch seconds (`passed` only). */
  expiresAt?: number;
  /** Lifetime of a pass in seconds (`GATE_PASS_TTL_S`). */
  passTtlS: number;
  /**
   * The parent domain the pass cookie is set for (`GATE_COOKIE_DOMAIN`, when
   * this host is under it), or null for a host-only pass (`passed` only).
   */
  passDomain?: string | null;
  /**
   * Dev preview only (web/gate-stay.html): stay on the success state instead
   * of leaving. The Worker never sets it.
   */
  stayOnPass?: boolean;
}

/** Same-origin JSON POST to `<endpoint><path>`. */
export async function postJson(
  config: GateConfig,
  path: string,
  body?: unknown,
) {
  const res = await fetch(config.endpoint + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body ?? {}),
  });
  let data: { ok?: boolean; redirect?: string; error?: string } | null = null;
  try {
    data = await res.json();
  } catch {}
  return { res, data };
}
