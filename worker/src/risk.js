/**
 * Adaptive difficulty: how much harder a challenge is made for the request
 * that asks for it.
 *
 * Three signals, all judged in memory while the challenge request is handled:
 *
 *   - `datacenter`: `request.cf.asn` is a cloud or hosting network
 *     (`DATACENTER_ASNS` plus `RISK_EXTRA_ASNS`), multiplied by
 *     `RISK_DATACENTER_FACTOR` (4);
 *   - `warp`: `request.cf.asn` is a Cloudflare WARP egress (`WARP_ASNS`),
 *     multiplied by `RISK_WARP_FACTOR` (6). Many VPN products tunnel through
 *     WARP, and some iCloud Private Relay egress shares AS13335 as well;
 *   - `burst`: the IP exceeded the soft per-IP limit `RL_CHALLENGE_SOFT`
 *     (15 challenges per 60 seconds), multiplied by `RISK_BURST_FACTOR` (3).
 *     The request is not refused.
 *
 * `datacenter` and `warp` are mutually exclusive (one AS belongs to one list).
 * The factors of the signals that fire are multiplied and capped at
 * `RISK_MAX_FACTOR` (18). `RISK_EXEMPT_ASNS` turns both AS signals off for
 * the listed networks.
 *
 * Privacy: the AS number and the IP are only read here, compared and dropped.
 * Nothing about them is logged, stored or counted; statistics only see the
 * resulting `reason`. Country and region are never used.
 *
 * The signal is applied when a challenge is minted, and the difficulty is
 * signed into the challenge itself (format 1: `c` in the JWT; format 2: the
 * encrypted `expected` list), so redeem checks the parameters the client was
 * actually given, never the current configuration.
 */

import { MAX_CHALLENGE_COUNT, MAX_HASHWX_DIFFICULTY } from "./config.js";

/** Every `reason` a challenge can be issued with, `""` meaning none. */
export const RISK_REASONS = Object.freeze([
  "",
  "datacenter",
  "warp",
  "burst",
  "datacenter+burst",
  "warp+burst",
]);

export const NO_RISK = Object.freeze({ level: 0, reason: "", factor: 1 });

/**
 * Cloudflare WARP egress. Deliberately not exempted: consumer VPNs commonly
 * chain through WARP. iCloud Private Relay egress operated by Akamai
 * (AS36183, AS20940) and Fastly (AS54113) is not listed anywhere here.
 */
export const WARP_ASNS = new Set([
  13335, // Cloudflare, Inc. (WARP, Zero Trust egress)
]);

/**
 * Cloud and hosting networks. Only networks whose address space is
 * predominantly rented servers are listed; privacy relays and consumer VPN
 * egress networks are not. Keep one AS per line with its holder, and check a
 * candidate on https://bgp.he.net/AS<n> before adding it.
 */
export const DATACENTER_ASNS = new Set([
  // Amazon Web Services
  16509, // Amazon.com, Inc. (AMAZON-02)
  14618, // Amazon.com, Inc. (AMAZON-AES)
  8987, // Amazon Technologies Inc. (AWS EU)
  38895, // Amazon.com Tech Telecom (AWS Asia Pacific)
  // Google Cloud
  396982, // Google LLC (GOOGLE-CLOUD-PLATFORM)
  // Microsoft Azure
  8075, // Microsoft Corporation
  // Oracle Cloud
  31898, // Oracle Corporation (ORACLE-BMC-31898)
  // Alibaba Cloud
  45102, // Alibaba (US) Technology Co., Ltd.
  37963, // Hangzhou Alibaba Advertising Co., Ltd. (Aliyun, mainland China)
  134963, // Alibaba Cloud (Singapore) Private Limited
  // Tencent Cloud
  132203, // Tencent Building, Kejizhongyi Avenue (Tencent Cloud)
  45090, // Shenzhen Tencent Computer Systems Company Limited
  // Huawei Cloud
  136907, // HUAWEI CLOUDS
  55990, // Huawei Cloud Service data center
  // VPS and dedicated server providers
  14061, // DigitalOcean, LLC
  63949, // Akamai Connected Cloud (Linode)
  20473, // The Constant Company, LLC (Vultr)
  24940, // Hetzner Online GmbH
  213230, // Hetzner Online GmbH (Hetzner Cloud)
  212317, // Hetzner Online GmbH (US)
  16276, // OVH SAS
  51167, // Contabo GmbH
  12876, // Scaleway SAS
  25820, // IT7 Networks Inc (BandwagonHost)
  35916, // MULTACOM CORPORATION (RackNerd)
  54574, // DMIT Cloud Services
  60781, // LeaseWeb Netherlands B.V.
  47583, // Hostinger International Limited
]);

/** `"datacenter"`, `"warp"` or `""` for an AS number. */
export function asnSignal(asn, config) {
  if (!Number.isInteger(asn) || asn <= 0) return "";
  if (config.riskExemptAsns?.has(asn)) return "";
  if (WARP_ASNS.has(asn)) return "warp";
  if (DATACENTER_ASNS.has(asn) || config.riskExtraAsns?.has(asn)) {
    return "datacenter";
  }
  return "";
}

/**
 * `true` when the IP is over the soft challenge limit. No binding, no IP or a
 * binding error count as no burst.
 */
async function isBurst(env, request) {
  const binding = env.RL_CHALLENGE_SOFT;
  const ip = request.headers.get("CF-Connecting-IP");
  if (typeof binding?.limit !== "function" || !ip) return false;
  try {
    const { success } = await binding.limit({ key: `challenge_soft:${ip}` });
    return !success;
  } catch (error) {
    console.error("[priestess-verification] soft rate limit", error);
    return false;
  }
}

/** The combined factor and reason for a set of signals. */
export function riskFor(asSignal, burst, config) {
  let factor = 1;
  let level = 0;
  if (asSignal === "datacenter") factor *= config.riskDatacenterFactor;
  if (asSignal === "warp") factor *= config.riskWarpFactor;
  if (asSignal) level += 1;
  if (burst) {
    factor *= config.riskBurstFactor;
    level += 1;
  }
  if (level === 0) return NO_RISK;
  const reason = [asSignal, burst ? "burst" : ""].filter(Boolean).join("+");
  return { level, reason, factor: Math.min(factor, config.riskMaxFactor) };
}

/**
 * The risk of one challenge request: `{ level, reason, factor }`. Called
 * after the hard `RL_CHALLENGE` limit let the request through and before any
 * Durable Object is touched; costs one rate-limit call.
 */
export async function assessRisk(request, env, config) {
  const asSignal = asnSignal(Number(request.cf?.asn), config);
  const burst = await isBurst(env, request);
  return riskFor(asSignal, burst, config);
}

/**
 * `config` with the workload multiplied by `risk.factor`, applied on top of
 * any per-site override: `hashwxDifficulty` when the challenge carries
 * hashwx, `challengeCount` when it carries SHA-256 (format 1 or
 * `sha256-pow`). Both are clamped to what capjs-core accepts. Returns
 * `config` itself when nothing grew (no PoW protocol, e.g. instrumentation
 * only, or already at the cap), so callers can tell by identity whether the
 * risk reason actually applied.
 */
export function applyRisk(config, risk) {
  if (!risk || risk.factor <= 1) return config;
  const protocols = config.protocols;
  const next = { ...config };
  if (protocols.includes("hashwx")) {
    next.hashwxDifficulty = Math.min(
      config.hashwxDifficulty * risk.factor,
      MAX_HASHWX_DIFFICULTY,
    );
  }
  if (protocols.length === 0 || protocols.includes("sha256-pow")) {
    next.challengeCount = Math.min(
      config.challengeCount * risk.factor,
      MAX_CHALLENGE_COUNT,
    );
  }
  const grew =
    next.hashwxDifficulty !== config.hashwxDifficulty ||
    next.challengeCount !== config.challengeCount;
  return grew ? next : config;
}
