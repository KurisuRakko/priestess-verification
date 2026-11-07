/**
 * Gate host policy: which hosts the server-side gate (`gate.js`) sits in front
 * of, where it proxies them, and which paths it lets through unchecked.
 *
 * Two sources, never overlapping on one host:
 *
 *   - `config`: `GATE_UPSTREAMS` from the deployment (`config.js`), read-only
 *     in the admin console, always enabled, no exempt paths;
 *   - `admin`: rows in the `SiteRegistry` `gate_hosts` table, managed through
 *     `/admin/api/gate` (`admin/gate-api.js`).
 *
 * A host only ever reaches the gate when a wrangler route sends it to this
 * Worker; the table manages policy, not routing.
 *
 * Kept free of `cloudflare:workers` imports so it can be unit tested outside a
 * Worker; the registry is passed in.
 */

import { bareHostname, parseHttpsOrigin } from "./config.js";
import { ValidationError } from "./sites.js";

export const MAX_EXEMPT_PATHS = 50;
export const MAX_EXEMPT_PATH_LENGTH = 256;
/** Kept small on purpose: every isolate holds the whole table in memory. */
export const MAX_GATE_HOSTS = 200;

const GATE_PREFIX = "/__gate/";

// ---- self hosts ---------------------------------------------------------

let selfHostsMemo = null; // { key, hosts }

/**
 * The hostnames this Worker answers as itself (e.g. verify.rakko.cn): the
 * hosts of `ALLOWED_ORIGINS` (`config.allowedOrigins`), minus any host that
 * `GATE_UPSTREAMS` gates. The runtime cannot see its own wrangler routes, and
 * `ALLOWED_ORIGINS` is the existing setting that names the Worker's own
 * public origin (the demo page and `/admin` run there), so it stands in for
 * them. Requests to these hosts never look up the registry, and the admin API
 * refuses to gate them. Memoised on the origin list, since `readConfig` runs
 * on every request.
 */
export function selfHosts(config) {
  const origins = [...config.allowedOrigins];
  const gated = [...config.gateUpstreams.keys()];
  const key = `${origins.join(",")}|${gated.join(",")}`;
  if (selfHostsMemo?.key !== key) {
    const hosts = new Set();
    for (const origin of origins) {
      const host = new URL(origin).hostname.toLowerCase();
      if (!config.gateUpstreams.has(host)) hosts.add(host);
    }
    selfHostsMemo = { key, hosts };
  }
  return selfHostsMemo.hosts;
}

// ---- validation ---------------------------------------------------------

export function validateGateHost(input, config) {
  const host = typeof input === "string" ? bareHostname(input) : null;
  if (!host) {
    throw new ValidationError("host must be a bare hostname without a port");
  }
  if (selfHosts(config).has(host)) {
    throw new ValidationError("host is this service's own host");
  }
  return host;
}

export function validateUpstream(input, host) {
  if (typeof input !== "string") {
    throw new ValidationError("upstream must be an https origin");
  }
  const { url, error } = parseHttpsOrigin(input.trim());
  if (error === "url") throw new ValidationError("upstream is not a URL");
  if (error === "https") throw new ValidationError("upstream must use https");
  if (error === "origin") {
    throw new ValidationError("upstream must be a bare origin (no path)");
  }
  if (url.hostname === host) {
    throw new ValidationError("upstream must not point at the host itself");
  }
  return url.origin;
}

/**
 * Admin input -> deduplicated list of exempt paths, in input order. See
 * `isExemptPath` for how an entry matches.
 */
export function validateExemptPaths(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new ValidationError("exemptPaths must be a list");
  }
  const paths = [];
  for (const entry of input) {
    if (typeof entry !== "string" || !entry.startsWith("/")) {
      throw new ValidationError("exempt paths must be strings starting with /");
    }
    if (entry.length > MAX_EXEMPT_PATH_LENGTH) {
      throw new ValidationError(
        `exempt paths must be at most ${MAX_EXEMPT_PATH_LENGTH} characters`,
      );
    }
    if (/[?#\s]/.test(entry) || entry.includes("..")) {
      throw new ValidationError(
        `exempt path must not contain ?, #, .. or whitespace: ${entry}`,
      );
    }
    if (entry === "/") {
      throw new ValidationError("exempt path must not be /");
    }
    if (entry.startsWith(GATE_PREFIX)) {
      throw new ValidationError(`exempt path must not be under ${GATE_PREFIX}`);
    }
    if (!paths.includes(entry)) paths.push(entry);
  }
  if (paths.length > MAX_EXEMPT_PATHS) {
    throw new ValidationError(`at most ${MAX_EXEMPT_PATHS} exempt paths`);
  }
  return paths;
}

export function validateEnabled(input) {
  if (typeof input !== "boolean") {
    throw new ValidationError("enabled must be a boolean");
  }
  return input;
}

// ---- matching -----------------------------------------------------------

const UNSAFE_PATH = /%(2f|5c|2e|3b)|;/i;

/**
 * Whether `pathname` is let through without a pass: an entry ending in `/`
 * matches as a prefix (`/api/` covers `/api/x`); any other entry matches
 * itself exactly or as a parent segment (`/robots.txt` covers `/robots.txt`
 * and `/robots.txt/x`, not `/robots.txtx`).
 *
 * `pathname` is the parsed URL's, so `..` segments are already resolved. A
 * path still holding an encoded `/`, `\` or `.` never matches: an origin that
 * decodes those could otherwise read `/api/..%2Fadmin` as `/admin`. Nor does
 * one holding `;` or `%3b`: Tomcat/Spring-style origins strip path parameters
 * and read `/api/..;/admin` as `/api/../admin`, i.e. `/admin`.
 */
export function isExemptPath(exemptPaths, pathname) {
  if (UNSAFE_PATH.test(pathname)) return false;
  for (const entry of exemptPaths) {
    if (entry.endsWith("/")) {
      if (pathname.startsWith(entry)) return true;
    } else if (pathname === entry || pathname.startsWith(`${entry}/`)) {
      return true;
    }
  }
  return false;
}

// ---- per-isolate cache --------------------------------------------------

/**
 * Per-isolate snapshot of the whole `gate_hosts` table (at most
 * `MAX_GATE_HOSTS` rows), refreshed at most once per `GATE_CACHE_TTL_MS`, the
 * same scheme as the site cache in `sites.js`: a flood of requests for unknown
 * hosts costs no more registry reads than real traffic does. An admin change
 * reaches other isolates within `GATE_CACHE_TTL_MS`; the isolate that handled
 * it drops its snapshot at once (`forgetGateHosts`).
 *
 * When a refresh fails and an older snapshot exists, that snapshot keeps
 * serving and the read is retried after `GATE_RETRY_MS`, so a registry
 * outage does not turn every request on an admin-managed host into a 500.
 */
export const GATE_CACHE_TTL_MS = 60_000;
export const GATE_RETRY_MS = 5_000;
let snapshot = null; // { at, hosts: Map }
let pending = null;

export async function loadAdminGateHosts(registry, now = Date.now()) {
  if (!snapshot || now - snapshot.at >= GATE_CACHE_TTL_MS) {
    // One registry read per isolate at a time, however many requests miss.
    pending ??= Promise.resolve()
      .then(() => registry().listGateHosts())
      .then((list) => {
        snapshot = {
          at: now,
          hosts: new Map(list.map((entry) => [entry.host, entry])),
        };
      })
      .finally(() => {
        pending = null;
      });
    try {
      await pending;
    } catch (error) {
      if (!snapshot) throw error;
      snapshot.at = now - GATE_CACHE_TTL_MS + GATE_RETRY_MS;
    }
  }
  return snapshot.hosts;
}

export function forgetGateHosts() {
  snapshot = null;
}

/**
 * The gate policy for request host `host` (lowercase):
 * `{ host, upstream, exemptPaths, enabled, source }`, or `null` when the host
 * is not gated. `registry` is a function returning the `SiteRegistry` stub; it
 * is only called on a cache miss for a host that is neither configured nor
 * one of `selfHosts`.
 */
export async function gatePolicy(config, host, registry, now = Date.now()) {
  const upstream = config.gateUpstreams.get(host);
  if (upstream) return configGateHost(host, upstream);
  if (selfHosts(config).has(host)) return null;
  const hosts = await loadAdminGateHosts(registry, now);
  const entry = hosts.get(host);
  return entry ? { ...entry, source: "admin" } : null;
}

function configGateHost(host, upstream) {
  return {
    host,
    upstream,
    exemptPaths: [],
    enabled: true,
    source: "config",
    createdAt: null,
    updatedAt: null,
  };
}

/**
 * Every gate host for the admin console: configured hosts first, then the
 * registry's. A registry row whose host is also configured is shadowed by the
 * configuration, exactly as at request time, and is left out.
 */
export function mergeGateHosts(config, adminHosts) {
  const hosts = [];
  for (const [host, upstream] of config.gateUpstreams) {
    hosts.push(configGateHost(host, upstream));
  }
  for (const entry of adminHosts) {
    if (config.gateUpstreams.has(entry.host)) continue;
    hosts.push({ ...entry, source: "admin" });
  }
  return hosts;
}
