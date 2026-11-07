/**
 * Admin API for traffic statistics. Runs behind `readAdminSession` (see
 * `admin/index.js`).
 *
 *   GET /admin/api/stats?range=24h|7d|30d&site=<site>&tz=<minutes east of UTC>
 *
 * `range` defaults to 24h (24 hourly buckets), 7d and 30d are daily buckets.
 * Day boundaries follow `tz`, rounded to a whole hour (the counters are
 * hourly). Buckets are contiguous, zero-filled and ascending; the last one
 * holds the current moment. `site` narrows `totals`, `reasons` and `series`;
 * `bySite` always lists every site seen in the range.
 */

import { registryFor } from "../site-registry.js";
import { SITE_KEY_PATTERN } from "../sites.js";
import {
  DEFAULT_SITE,
  REASON_EVENTS,
  STATS_EVENTS,
  hourOf,
  statsFor,
} from "../stats.js";

const HOUR_S = 3600;
const DAY_S = 24 * HOUR_S;

const RANGES = {
  "24h": { bucket: "hour", bucketS: HOUR_S, count: 24 },
  "7d": { bucket: "day", bucketS: DAY_S, count: 7 },
  "30d": { bucket: "day", bucketS: DAY_S, count: 30 },
};

// UTC-12:00 .. UTC+14:00, the offsets in use anywhere.
const MIN_TZ = -720;
const MAX_TZ = 840;

const GATE_SITE_PATTERN = /^gate:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;

class BadRequest extends Error {}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function parseParams(params) {
  const range = params.get("range") ?? "24h";
  if (!Object.hasOwn(RANGES, range)) {
    throw new BadRequest("range must be 24h, 7d or 30d");
  }

  const rawTz = params.get("tz");
  let tz = 0;
  if (rawTz !== null && rawTz !== "") {
    if (!/^[+-]?\d{1,4}$/.test(rawTz)) {
      throw new BadRequest("tz must be an integer number of minutes");
    }
    tz = Number(rawTz);
    if (tz < MIN_TZ || tz > MAX_TZ) {
      throw new BadRequest(`tz must be in [${MIN_TZ}, ${MAX_TZ}]`);
    }
    // `|| 0`: rounding -20 gives -0.
    tz = Math.round(tz / 60) * 60 || 0;
  }

  const rawSite = params.get("site");
  let site = null;
  if (rawSite !== null && rawSite !== "") {
    if (
      rawSite !== DEFAULT_SITE &&
      !SITE_KEY_PATTERN.test(rawSite) &&
      !GATE_SITE_PATTERN.test(rawSite)
    ) {
      throw new BadRequest("unknown site");
    }
    site = rawSite;
  }

  return { range, tz, site };
}

/** `[firstStart, end)` in unix seconds, plus the bucket size. */
export function bucketWindow(range, tz, nowMs) {
  const { bucket, bucketS, count } = RANGES[range];
  let lastStart;
  if (bucket === "hour") {
    lastStart = hourOf(nowMs);
  } else {
    const offsetS = tz * 60;
    const localS = Math.floor(nowMs / 1000) + offsetS;
    lastStart = Math.floor(localS / DAY_S) * DAY_S - offsetS;
  }
  const firstStart = lastStart - (count - 1) * bucketS;
  return { bucket, bucketS, count, firstStart, end: lastStart + bucketS };
}

function zeroCounts() {
  return Object.fromEntries(STATS_EVENTS.map((event) => [event, 0]));
}

function iso(seconds) {
  return new Date(seconds * 1000).toISOString();
}

function siteKind(site) {
  if (site === DEFAULT_SITE) return "default";
  if (site.startsWith("gate:")) return "gate";
  return "site";
}

async function siteLabels(env) {
  try {
    const sites = await registryFor(env).listSites();
    return new Map(sites.map((site) => [site.siteKey, site.name]));
  } catch (error) {
    console.error("[priestess-verification] stats labels", error);
    return new Map();
  }
}

function siteLabel(site, names) {
  const kind = siteKind(site);
  if (kind === "gate") return site.slice("gate:".length);
  if (kind === "default") return DEFAULT_SITE;
  return names.get(site) ?? site;
}

export async function handleStatsApi(request, env, url) {
  if (request.method !== "GET") {
    return json({ error: "method not allowed" }, 405);
  }
  let params;
  try {
    params = parseParams(url.searchParams);
  } catch (error) {
    if (error instanceof BadRequest) return json({ error: error.message }, 400);
    throw error;
  }
  if (!env.STATS_STORE) {
    return json({ error: "statistics are not configured" }, 503);
  }

  const { range, tz, site } = params;
  const now = Date.now();
  const window = bucketWindow(range, tz, now);
  const [rows, names] = await Promise.all([
    statsFor(env).query(window.firstStart, window.end, site),
    siteLabels(env),
  ]);

  const totals = zeroCounts();
  const series = Array.from({ length: window.count }, (_, index) => ({
    t: iso(window.firstStart + index * window.bucketS),
    ...zeroCounts(),
  }));
  for (const { hour, event, n } of rows.series) {
    if (!Object.hasOwn(totals, event)) continue;
    const index = Math.floor((hour - window.firstStart) / window.bucketS);
    if (index < 0 || index >= window.count) continue;
    series[index][event] += n;
    totals[event] += n;
  }

  const reasons = Object.fromEntries(REASON_EVENTS.map((event) => [event, {}]));
  for (const { event, reason, n } of rows.reasons) {
    if (!reasons[event]) continue;
    reasons[event][reason] = (reasons[event][reason] ?? 0) + n;
  }

  const sites = new Map();
  for (const row of rows.bySite) {
    if (!STATS_EVENTS.includes(row.event)) continue;
    let entry = sites.get(row.site);
    if (!entry) {
      entry = {
        site: row.site,
        label: siteLabel(row.site, names),
        kind: siteKind(row.site),
        ...zeroCounts(),
      };
      sites.set(row.site, entry);
    }
    entry[row.event] += row.n;
  }
  const bySite = [...sites.values()].sort(
    (a, b) =>
      b.challenge_issued - a.challenge_issued || a.site.localeCompare(b.site),
  );

  return json({
    range,
    bucket: window.bucket,
    tz,
    from: iso(window.firstStart),
    to: iso(window.end),
    generatedAt: new Date(now).toISOString(),
    site,
    events: [...STATS_EVENTS],
    totals,
    reasons,
    series,
    bySite,
  });
}
