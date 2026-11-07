/**
 * Worker configuration, read from `env` on every request.
 *
 * Secrets (`CAP_SECRET`, `SITEVERIFY_SECRET`, the optional `GATE_COOKIE_SECRET`)
 * come from `.dev.vars` locally and `wrangler secret put` in production. Everything else is a plain `vars` entry
 * in `wrangler.jsonc`, so it can be tuned without touching code.
 */

const DEFAULT_ALLOWED_ORIGINS = "https://verify.rakko.cn";

const SUPPORTED_PROTOCOLS = new Set([
  "sha256-pow",
  "hashwx",
  "instrumentation",
]);

export const DEFAULTS = {
  challengeCount: 50,
  challengeSize: 32,
  challengeDifficulty: 4,
  instrumentationLevel: 3,
  blockAutomatedBrowsers: false,
  gateBlockAutomatedBrowsers: true,
  tokenTtlMs: 20 * 60 * 1000,
  // Calibrated with the real widget (README "Proof of work"): about 1.4 s on
  // an emulated low-end phone, at the widget's 1 s minimum on a desktop.
  hashwxDifficulty: 150_000,
  hashwxChallengeCount: 8,
  gatePassTtlS: 30 * 60,
  riskDatacenterFactor: 4,
  riskWarpFactor: 6,
  riskBurstFactor: 3,
  riskMaxFactor: 18,
};

/** Upper bounds of the two workloads the adaptive difficulty scales. */
export const MAX_CHALLENGE_COUNT = 1000;
export const MAX_HASHWX_DIFFICULTY = 1_000_000_000;

function intVar(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `[config] ${name} must be an integer in [${min}, ${max}], got ${JSON.stringify(raw)}`,
    );
  }
  return value;
}

function boolVar(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = String(raw).trim().toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(
    `[config] ${name} must be a boolean, got ${JSON.stringify(raw)}`,
  );
}

/**
 * Settings an admin may override per site (`sites.settings` in the
 * `SiteRegistry`). Anything a site leaves out inherits the Worker-wide value
 * from `vars`, and the ranges are the same as for the env vars.
 */
export const SITE_SETTING_RANGES = {
  challengeCount: [1, 1000],
  challengeSize: [1, 256],
  challengeDifficulty: [1, 16],
  hashwxDifficulty: [1, MAX_HASHWX_DIFFICULTY],
  tokenTtlMs: [1000, 24 * 60 * 60 * 1000],
};

export function parseAllowedOrigins(raw) {
  const list = String(raw ?? DEFAULT_ALLOWED_ORIGINS)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const origins = new Set();
  for (const entry of list) {
    let url;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`[config] ALLOWED_ORIGINS entry is not a URL: ${entry}`);
    }
    if (url.origin !== entry.replace(/\/$/, "")) {
      throw new Error(
        `[config] ALLOWED_ORIGINS entries must be bare origins (no path), got ${entry}`,
      );
    }
    origins.add(url.origin);
  }
  return origins;
}

/**
 * `RISK_EXTRA_ASNS` / `RISK_EXEMPT_ASNS`: comma-separated AS numbers (`64500`
 * or `AS64500`) -> `Set<number>`. Empty or unset = an empty set.
 */
export function parseAsnList(raw, name) {
  const asns = new Set();
  for (const entry of String(raw ?? "").split(",")) {
    const value = entry.trim();
    if (!value) continue;
    const match = /^(?:AS)?([0-9]{1,10})$/i.exec(value);
    const asn = match ? Number(match[1]) : Number.NaN;
    if (!Number.isInteger(asn) || asn < 1 || asn > 4_294_967_295) {
      throw new Error(
        `[config] ${name} entries must be AS numbers, got ${JSON.stringify(value)}`,
      );
    }
    asns.add(asn);
  }
  return asns;
}

/**
 * The proof of work a challenge carries, as the admin console shows it:
 * `"legacy"` (format 1, SHA-256) or the format-2 PoW protocols in order
 * (`"hashwx"`, `"sha256-pow"`, `"sha256-pow,hashwx"`; empty when format 2
 * carries no PoW at all).
 */
export function powProtocol(config) {
  if (config.protocols.length === 0) return "legacy";
  return config.protocols
    .filter((protocol) => protocol !== "instrumentation")
    .join(",");
}

export function parseProtocols(raw) {
  const protocols = String(raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const protocol of protocols) {
    if (!SUPPORTED_PROTOCOLS.has(protocol)) {
      throw new Error(
        `[config] CHALLENGE_PROTOCOLS has unsupported protocol '${protocol}' (supported: ${[...SUPPORTED_PROTOCOLS].join(", ")})`,
      );
    }
  }
  return protocols;
}

/**
 * `raw` trimmed and lowercased when it is a bare hostname (no scheme, port,
 * path or credentials), otherwise `null`. Shared by `GATE_UPSTREAMS` and the
 * admin gate API (`gate-hosts.js`).
 */
export function bareHostname(raw) {
  const name = String(raw ?? "")
    .trim()
    .toLowerCase();
  let hostUrl;
  try {
    hostUrl = new URL(`https://${name}`);
  } catch {
    hostUrl = null;
  }
  return name && hostUrl?.hostname === name ? name : null;
}

/**
 * `raw` as a bare `https:` origin: `{ url }` on success, otherwise `{ error }`
 * with `"url"` (not a URL), `"https"` (another scheme) or `"origin"` (has a
 * path, query, credentials or non-canonical spelling). A trailing `/` is
 * tolerated.
 */
export function parseHttpsOrigin(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return { error: "url" };
  }
  if (url.protocol !== "https:") return { error: "https" };
  if (url.origin !== String(raw).replace(/\/$/, "")) return { error: "origin" };
  return { url };
}

/**
 * `GATE_UPSTREAMS`: a JSON object mapping a public hostname to the origin the
 * server-side gate proxies it to, e.g. `{"example.com":"https://origin.example.com"}`.
 * Keys are bare hostnames (matched against the request URL's hostname, case
 * insensitive); values must be bare `https:` origins.
 */
export function parseGateUpstreams(raw) {
  const upstreams = new Map();
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return upstreams;
  }
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    throw new Error("[config] GATE_UPSTREAMS is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "[config] GATE_UPSTREAMS must be a JSON object of host -> https origin",
    );
  }
  for (const [host, target] of Object.entries(parsed)) {
    const name = bareHostname(host);
    if (!name) {
      throw new Error(
        `[config] GATE_UPSTREAMS keys must be bare hostnames, got ${JSON.stringify(host)}`,
      );
    }
    const parsedTarget = parseHttpsOrigin(target);
    if (parsedTarget.error === "url") {
      throw new Error(
        `[config] GATE_UPSTREAMS[${JSON.stringify(host)}] is not a URL: ${JSON.stringify(target)}`,
      );
    }
    if (parsedTarget.error === "https") {
      throw new Error(
        `[config] GATE_UPSTREAMS[${JSON.stringify(host)}] must be an https: origin, got ${JSON.stringify(target)}`,
      );
    }
    if (parsedTarget.error === "origin") {
      throw new Error(
        `[config] GATE_UPSTREAMS[${JSON.stringify(host)}] must be a bare origin (no path), got ${JSON.stringify(target)}`,
      );
    }
    const url = parsedTarget.url;
    upstreams.set(name, url.origin);
  }
  return upstreams;
}

/**
 * `GATE_COOKIE_DOMAIN`: optional parent domain for the gate's pass cookie
 * (`rakko.cn` or `.rakko.cn`, normalised to `rakko.cn`). Empty = host-only.
 */
export function parseCookieDomain(raw) {
  if (raw === undefined || raw === null) return "";
  const value = String(raw).trim().toLowerCase().replace(/^\./, "");
  if (value === "") return "";
  let url = null;
  try {
    url = new URL(`https://${value}`);
  } catch {}
  if (
    url?.hostname !== value ||
    !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value) ||
    value
      .split(".")
      .some((label) => label.startsWith("-") || label.endsWith("-")) ||
    /^[0-9.]+$/.test(value)
  ) {
    throw new Error(
      `[config] GATE_COOKIE_DOMAIN must be a domain name like rakko.cn, got ${JSON.stringify(raw)}`,
    );
  }
  return value;
}

const DEFAULT_PRIESTESS_API_BASE = "https://api.rakko.cn/auth/priestess/oidc";
const DEFAULT_PRIESTESS_APP_ID = "priestess-verification";

/**
 * `/admin` login settings. The admin console signs in through Priestess (the
 * Phainon Worker's native login-code flow) and then additionally requires the
 * Priestess `sub` to be listed in `ADMIN_ALLOWED_SUBS`; an empty list lets
 * nobody in.
 */
export function readAdminConfig(env) {
  const apiBase = String(
    env.PRIESTESS_API_BASE || DEFAULT_PRIESTESS_API_BASE,
  ).replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(apiBase);
  } catch {
    throw new Error(`[config] PRIESTESS_API_BASE is not a URL: ${apiBase}`);
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1") {
    throw new Error(`[config] PRIESTESS_API_BASE must be https: ${apiBase}`);
  }
  return {
    apiBase,
    appId: String(env.PRIESTESS_APP_ID || DEFAULT_PRIESTESS_APP_ID),
    allowedSubs: new Set(
      String(env.ADMIN_ALLOWED_SUBS ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  };
}

export function readConfig(env) {
  return {
    capSecret: env.CAP_SECRET ?? "",
    siteverifySecret: env.SITEVERIFY_SECRET ?? "",
    gateCookieSecret: env.GATE_COOKIE_SECRET ?? "",
    gateUpstreams: parseGateUpstreams(env.GATE_UPSTREAMS),
    gateCookieDomain: parseCookieDomain(env.GATE_COOKIE_DOMAIN),
    gatePassTtlS: intVar(
      env,
      "GATE_PASS_TTL_S",
      DEFAULTS.gatePassTtlS,
      60,
      24 * 60 * 60,
    ),
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    protocols: parseProtocols(env.CHALLENGE_PROTOCOLS),
    challengeCount: intVar(
      env,
      "CHALLENGE_COUNT",
      DEFAULTS.challengeCount,
      1,
      1000,
    ),
    challengeSize: intVar(
      env,
      "CHALLENGE_SIZE",
      DEFAULTS.challengeSize,
      1,
      256,
    ),
    challengeDifficulty: intVar(
      env,
      "CHALLENGE_DIFFICULTY",
      DEFAULTS.challengeDifficulty,
      1,
      16,
    ),
    instrumentationLevel: intVar(
      env,
      "INSTRUMENTATION_LEVEL",
      DEFAULTS.instrumentationLevel,
      1,
      10,
    ),
    blockAutomatedBrowsers: boolVar(
      env,
      "BLOCK_AUTOMATED_BROWSERS",
      DEFAULTS.blockAutomatedBrowsers,
    ),
    gateBlockAutomatedBrowsers: boolVar(
      env,
      "GATE_BLOCK_AUTOMATED_BROWSERS",
      DEFAULTS.gateBlockAutomatedBrowsers,
    ),
    tokenTtlMs: intVar(
      env,
      "TOKEN_TTL_MS",
      DEFAULTS.tokenTtlMs,
      1000,
      24 * 60 * 60 * 1000,
    ),
    hashwxDifficulty: intVar(
      env,
      "HASHWX_DIFFICULTY",
      DEFAULTS.hashwxDifficulty,
      1,
      MAX_HASHWX_DIFFICULTY,
    ),
    hashwxChallengeCount: intVar(
      env,
      "HASHWX_CHALLENGE_COUNT",
      DEFAULTS.hashwxChallengeCount,
      1,
      64,
    ),
    // Adaptive difficulty (`risk.js`).
    riskDatacenterFactor: intVar(
      env,
      "RISK_DATACENTER_FACTOR",
      DEFAULTS.riskDatacenterFactor,
      1,
      1000,
    ),
    riskWarpFactor: intVar(
      env,
      "RISK_WARP_FACTOR",
      DEFAULTS.riskWarpFactor,
      1,
      1000,
    ),
    riskBurstFactor: intVar(
      env,
      "RISK_BURST_FACTOR",
      DEFAULTS.riskBurstFactor,
      1,
      1000,
    ),
    riskMaxFactor: intVar(
      env,
      "RISK_MAX_FACTOR",
      DEFAULTS.riskMaxFactor,
      1,
      1_000_000,
    ),
    riskExtraAsns: parseAsnList(env.RISK_EXTRA_ASNS, "RISK_EXTRA_ASNS"),
    riskExemptAsns: parseAsnList(env.RISK_EXEMPT_ASNS, "RISK_EXEMPT_ASNS"),
  };
}
