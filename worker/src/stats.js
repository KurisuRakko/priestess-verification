import { DurableObject } from "cloudflare:workers";

/**
 * Traffic statistics and per-IP rate limiting.
 *
 * Statistics are nothing but counters: "site x UTC hour x event x reason ->
 * count", kept in one SQLite Durable Object (`StatsStore`, single instance
 * "global"). No visitor data is ever recorded — no IP, User-Agent, cookie,
 * session, token or country. The IP only ever exists as a rate-limit key
 * handed to the `ratelimits` bindings, never stored here.
 *
 * `site` is a registered site's key, `gate:<host>` for the server-side gate,
 * or `default` for the Worker-wide legacy routes (`/challenge`, `/redeem`,
 * `/siteverify`, the demo page's routes).
 *
 * Writes go through `ctx.waitUntil`, so recording never delays or fails a
 * response.
 */

export const STATS_EVENTS = Object.freeze([
  "challenge_issued",
  "redeem_ok",
  "redeem_fail",
  "siteverify_ok",
  "siteverify_fail",
  "gate_shown",
  "gate_pass",
  "gate_pass_fail",
  "rate_limited",
]);

/** The events that carry a reason, in the order the API lists them. */
export const REASON_EVENTS = Object.freeze([
  "redeem_fail",
  "siteverify_fail",
  "gate_pass_fail",
  "rate_limited",
]);

export const DEFAULT_SITE = "default";
export const STATS_RETENTION_DAYS = 90;

const STATS_NAME = "global";
const HOUR_S = 3600;
const RETENTION_S = STATS_RETENTION_DAYS * 24 * HOUR_S;

/** One in `RATE_LIMIT_SAMPLE` rejections is recorded, with this weight. */
const RATE_LIMIT_SAMPLE = 10;

export function statsFor(env) {
  return env.STATS_STORE.getByName(STATS_NAME);
}

/** `gate:<host>` for the gate's events on `host`. */
export function gateSite(host) {
  return `gate:${String(host).toLowerCase()}`;
}

/** The UTC hour (unix seconds) that `ms` falls in. */
export function hourOf(ms) {
  return Math.floor(ms / 1000 / HOUR_S) * HOUR_S;
}

/**
 * Counts one occurrence of `event` (with `weight`) for `site`. Returns
 * immediately; never throws. A no-op without the binding or an execution
 * context (unit tests that call handlers directly).
 */
export function recordEvent(
  env,
  ctx,
  { site, event, reason = "", weight = 1 },
) {
  if (!env?.STATS_STORE || typeof ctx?.waitUntil !== "function") return;
  try {
    const write = statsFor(env)
      .record(String(site), event, reason, weight)
      .catch((error) => {
        console.error("[priestess-verification] stats", error);
      });
    ctx.waitUntil(write);
  } catch (error) {
    console.error("[priestess-verification] stats", error);
  }
}

/**
 * Per-IP rate limit for one entry point, checked before any Durable Object is
 * touched. `kind` is `challenge` (RL_CHALLENGE), `redeem` or `gate_pass`
 * (both RL_REDEEM); the key is `<kind>:<CF-Connecting-IP>`. Without the
 * binding or the header (local development, tests) the request is let through,
 * and so is a binding error: rate limiting must not take verification down.
 *
 * Returns `true` when the request must be rejected. With a `site` the
 * rejection is also counted (`recordRateLimited`); callers that only learn the
 * site afterwards pass none and count it themselves.
 */
export async function isRateLimited(env, ctx, request, kind, site) {
  const binding = kind === "challenge" ? env.RL_CHALLENGE : env.RL_REDEEM;
  const ip = request.headers.get("CF-Connecting-IP");
  if (typeof binding?.limit !== "function" || !ip) return false;
  let success;
  try {
    ({ success } = await binding.limit({ key: `${kind}:${ip}` }));
  } catch (error) {
    console.error("[priestess-verification] rate limit", error);
    return false;
  }
  if (success) return false;
  if (site) recordRateLimited(env, ctx, site, kind);
  return true;
}

/**
 * Counts a rate-limited request: one in `RATE_LIMIT_SAMPLE` is recorded with
 * that weight, so a flood costs a tenth of the writes.
 */
export function recordRateLimited(env, ctx, site, kind) {
  if (Math.random() >= 1 / RATE_LIMIT_SAMPLE) return;
  recordEvent(env, ctx, {
    site,
    event: "rate_limited",
    reason: kind,
    weight: RATE_LIMIT_SAMPLE,
  });
}

/**
 * The counters. One row per (hour, site, event, reason); every write is an
 * UPSERT that adds to `n`.
 *
 * Retention: rows older than `STATS_RETENTION_DAYS` are deleted by the first
 * write of every new hour (piggybacked on `record`, no alarm). An hour with no
 * traffic deletes nothing, but then nothing grows either; queries never read
 * past the retention window anyway.
 */
export class StatsStore extends DurableObject {
  #sql;
  #purgedHour = -1;

  constructor(ctx, env) {
    super(ctx, env);
    this.#sql = ctx.storage.sql;
    this.#sql.exec(
      `CREATE TABLE IF NOT EXISTS counts (
         hour INTEGER NOT NULL,
         site TEXT NOT NULL,
         event TEXT NOT NULL,
         reason TEXT NOT NULL,
         n INTEGER NOT NULL,
         PRIMARY KEY (hour, site, event, reason)
       ) WITHOUT ROWID`,
    );
  }

  async record(site, event, reason = "", weight = 1, now = Date.now()) {
    const hour = hourOf(now);
    if (hour !== this.#purgedHour) {
      this.#purgedHour = hour;
      this.purge(now);
    }
    this.#sql.exec(
      `INSERT INTO counts (hour, site, event, reason, n) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(hour, site, event, reason) DO UPDATE SET n = n + excluded.n`,
      hour,
      site,
      event,
      reason,
      weight,
    );
  }

  /** Deletes every row older than the retention window. */
  purge(now = Date.now()) {
    this.#sql.exec(
      "DELETE FROM counts WHERE hour < ?",
      hourOf(now) - RETENTION_S,
    );
  }

  /**
   * Aggregates for hours in `[fromHour, toHour)` (unix seconds). `site`
   * (optional) narrows `series` and `reasons`; `bySite` always covers every
   * site.
   *
   *   series:  [{ hour, event, n }]
   *   reasons: [{ event, reason, n }]   (only rows with a reason)
   *   bySite:  [{ site, event, n }]
   */
  async query(fromHour, toHour, site = null) {
    const siteFilter = site === null ? "" : " AND site = ?";
    const siteArgs = site === null ? [] : [site];
    const series = this.#sql
      .exec(
        `SELECT hour, event, SUM(n) AS n FROM counts
         WHERE hour >= ? AND hour < ?${siteFilter}
         GROUP BY hour, event`,
        fromHour,
        toHour,
        ...siteArgs,
      )
      .toArray();
    const reasons = this.#sql
      .exec(
        `SELECT event, reason, SUM(n) AS n FROM counts
         WHERE hour >= ? AND hour < ? AND reason != ''${siteFilter}
         GROUP BY event, reason`,
        fromHour,
        toHour,
        ...siteArgs,
      )
      .toArray();
    const bySite = this.#sql
      .exec(
        `SELECT site, event, SUM(n) AS n FROM counts
         WHERE hour >= ? AND hour < ?
         GROUP BY site, event`,
        fromHour,
        toHour,
      )
      .toArray();
    return { series, reasons, bySite };
  }
}
