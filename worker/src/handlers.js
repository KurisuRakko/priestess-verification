/**
 * Request handlers for the API routes.
 *
 * `/challenge` and `/redeem` wrap capjs-core (`consumeNonce` + token storage),
 * `/siteverify` mirrors the standalone contract, and `/demo/siteverify` is the
 * same-origin shortcut used by the demo page so the browser never sees the
 * siteverify secret.
 *
 * Tenants: every challenge belongs to one tenant, `{ scope, keySuffix }`.
 * The scope is signed into the challenge JWT (capjs-core's `scope` option,
 * stored as `sk` and enforced by `validateChallenge`) and the suffix is
 * appended to the token's storage key, so tenants are isolated twice over:
 *
 *   - a challenge minted for one tenant fails `scope_mismatch` when redeemed
 *     at another tenant's `/redeem`;
 *   - even a token that somehow reached the wrong store cannot be consumed,
 *     because its storage key differs.
 *
 * The tenants are the Worker-wide production one (`SITE_TENANT`, the legacy
 * `/challenge` routes with the env secrets), the demo page (`DEMO_TENANT`) and
 * one per registered site (`siteTenant()` in `sites.js`). `/demo/siteverify`
 * therefore only ever accepts demo tokens: it cannot be used as a secret-free
 * `/siteverify` for real ones.
 *
 * The server-side gate (`gate.js`) is one more tenant, `GATE_TENANT` (scope
 * `"gate"`, suffix `@gate`): `/__gate/challenge` + `/__gate/redeem` mint tokens
 * that only `/__gate/pass` consumes, and neither `/siteverify`,
 * `/demo/siteverify` nor a site's `/<siteKey>/siteverify` accepts them (nor
 * does `/__gate/pass` accept theirs).
 */

import { randomHex, sha256Hex } from "../../core/src/crypto.js";
import { generateChallenge, validateChallenge } from "../../core/src/index.js";
import { corsHeaders } from "./cors.js";
import { shardNameForKey } from "./shards.js";
import { recordEvent } from "./stats.js";
import {
  constantTimeSecretMatch,
  consumeRedeemToken,
  storageKeyFor,
} from "./siteverify.js";

export const SITE_TENANT = Object.freeze({ scope: "site", keySuffix: "" });
export const DEMO_TENANT = Object.freeze({ scope: "demo", keySuffix: "@demo" });
export const GATE_TENANT = Object.freeze({ scope: "gate", keySuffix: "@gate" });

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

export function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

/**
 * 429 for a rate-limited entry point (`isRateLimited` in `stats.js`), with
 * the entry point's own CORS headers so the widget can read it.
 */
export function rateLimitedResponse(extraHeaders = {}) {
  return jsonResponse(
    { success: false, reason: "rate_limited", error: "Too many requests" },
    429,
    { "Retry-After": "60", ...extraHeaders },
  );
}

/**
 * Statistics hook of the handlers below: `stats` is `{ ctx, site }` (see
 * `stats.js`); callers that pass none (unit tests) record nothing.
 */
function record(env, stats, event, reason = "") {
  if (!stats) return;
  recordEvent(env, stats.ctx, { site: stats.site, event, reason });
}

/** capjs-core redeem failure -> the `redeem_fail` statistics reason. */
export function redeemFailReason(result) {
  switch (result.reason) {
    case "invalid_solution":
    case "expired":
    case "already_redeemed":
    case "instr_timeout":
      return result.reason;
    case "invalid_token":
    case "scope_mismatch":
      return "invalid_token";
    case "invalid_body":
    case "missing_token":
    case "missing_solutions":
    case "invalid_solutions":
      return "bad_request";
    case "nonce_store_error":
      return "internal";
  }
  if (result.instr_error || result.blockedBy) return "instr_blocked";
  return "other";
}

/**
 * Siteverify-style HTTP failure -> the `siteverify_fail` / `gate_pass_fail`
 * statistics reason.
 */
export function verifyFailReason(status, error) {
  if (status === 400) return "bad_request";
  if (status === 404) return "token_not_found";
  if (error === "Token expired") return "token_expired";
  if (error === "Invalid secret") return "invalid_secret";
  if (status >= 500) return "internal";
  return "other";
}

function tokenStoreFor(env, key) {
  return env.TOKEN_STORE.getByName(shardNameForKey(key));
}

/** Maps capjs-core failure reasons onto standalone-style statuses/messages. */
function redeemFailure(result, headers) {
  const known = {
    invalid_body: [400, "Invalid request body"],
    missing_token: [400, "Missing challenge token"],
    missing_solutions: [400, "Missing solutions"],
    invalid_solutions: [400, "Invalid solutions"],
    expired: [403, "Challenge expired"],
    scope_mismatch: [403, "Challenge token does not match scope"],
    invalid_token: [403, "Invalid challenge token"],
    already_redeemed: [403, "Challenge already redeemed"],
    invalid_solution: [403, "Invalid solution"],
    instr_timeout: [429, "Instrumentation timeout"],
    nonce_store_error: [500, "Nonce store unavailable"],
  };
  const [status, error] = known[result.reason] ?? [
    403,
    result.instr_error ? "Blocked by instrumentation" : "Validation failed",
  ];
  return jsonResponse(
    {
      success: false,
      reason: result.reason,
      error,
      ...(result.instr_error ? { instr_error: true } : {}),
      ...(result.blockedBy ? { blockedBy: result.blockedBy } : {}),
    },
    status,
    headers,
  );
}

function challengeOptions(config, scope) {
  // The gate hands out a pass that unlocks a whole site, so it rejects
  // automated browsers by default (GATE_BLOCK_AUTOMATED_BROWSERS): otherwise a
  // script skips the environment check by reporting `instr_blocked` and only
  // pays for the proof of work.
  const isGate = scope === GATE_TENANT.scope;
  const instrumentation = {
    blockAutomatedBrowsers: isGate
      ? config.gateBlockAutomatedBrowsers
      : config.blockAutomatedBrowsers,
    obfuscationLevel: config.instrumentationLevel,
  };

  if (config.protocols.length === 0) {
    return {
      scope,
      challengeCount: config.challengeCount,
      challengeSize: config.challengeSize,
      challengeDifficulty: config.challengeDifficulty,
      instrumentation,
    };
  }

  const options = {
    scope,
    format: 2,
    protocols:
      isGate && !config.protocols.includes("instrumentation")
        ? [...config.protocols, "instrumentation"]
        : config.protocols,
    instrumentation,
  };
  if (config.protocols.includes("sha256-pow")) {
    options.challengeCount = config.challengeCount;
    options.challengeSize = config.challengeSize;
    options.challengeDifficulty = config.challengeDifficulty;
  }
  if (config.protocols.includes("hashwx")) {
    options.hashwxDifficulty = config.hashwxDifficulty;
    options.hashwxChallengeCount = config.hashwxChallengeCount;
  }
  return options;
}

export async function handleChallenge(
  _request,
  env,
  config,
  origin,
  tenant = SITE_TENANT,
  stats = null,
) {
  if (!config.capSecret) {
    return jsonResponse(
      { error: "CAP_SECRET is not configured" },
      500,
      corsHeaders(origin),
    );
  }
  const challenge = await generateChallenge(
    config.capSecret,
    challengeOptions(config, tenant.scope),
  );
  record(env, stats, "challenge_issued");
  return jsonResponse(challenge, 200, corsHeaders(origin));
}

export async function handleRedeem(
  request,
  env,
  config,
  origin,
  tenant = SITE_TENANT,
  stats = null,
) {
  const headers = corsHeaders(origin);
  if (!config.capSecret) {
    record(env, stats, "redeem_fail", "internal");
    return jsonResponse(
      { success: false, error: "CAP_SECRET is not configured" },
      500,
      headers,
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    record(env, stats, "redeem_fail", "bad_request");
    return jsonResponse(
      {
        success: false,
        reason: "invalid_body",
        error: "Invalid request body",
      },
      400,
      headers,
    );
  }

  // `consumeNonce` both claims the challenge signature and stores the token
  // secret in the same row (one write instead of two). The token the client
  // receives is `<signature>:<secret>`, so verification can find that row again
  // from the token alone.
  let minted = null;
  const result = await validateChallenge(config.capSecret, body, {
    scope: tenant.scope,
    consumeNonce: async (sigHex, ttlMs) => {
      const verToken = randomHex(15);
      const ttlMs_ = Math.max(ttlMs, config.tokenTtlMs);
      const key = storageKeyFor(sigHex, tenant.keySuffix);
      const claimed = await tokenStoreFor(env, key).consumeNonce(
        key,
        ttlMs_,
        sha256Hex(verToken),
      );
      if (claimed) {
        minted = { token: `${sigHex}:${verToken}`, expires: Date.now() + ttlMs_ };
      }
      return claimed;
    },
    signToken: () => minted?.token,
    tokenTtlMs: config.tokenTtlMs,
  });

  if (!result.success) {
    if (result.reason === "nonce_store_error") {
      // The client only gets the generic message; the cause stays in the logs.
      console.error("[priestess-verification] nonce store error", result.error);
    }
    record(env, stats, "redeem_fail", redeemFailReason(result));
    return redeemFailure(result, headers);
  }

  record(env, stats, "redeem_ok");
  return jsonResponse(
    { success: true, token: result.token, expires: minted.expires },
    200,
    headers,
  );
}

async function consumeForTenant(response, env, keySuffix) {
  return consumeRedeemToken(
    response,
    (key, secretHash) => tokenStoreFor(env, key).consumeToken(key, secretHash),
    keySuffix,
  );
}

/**
 * Single-use consumption of a token minted for `tenant`, for routes that
 * verify tokens in-process instead of through `/siteverify` (the gate).
 */
export function consumeScopedToken(token, env, tenant) {
  return consumeForTenant(token, env, tenant.keySuffix);
}

/** A siteverify answer, counted as `siteverify_ok` / `siteverify_fail`. */
function verifyResult(env, stats, body, status) {
  if (body.success) {
    record(env, stats, "siteverify_ok");
  } else {
    record(env, stats, "siteverify_fail", verifyFailReason(status, body.error));
  }
  return jsonResponse(body, status);
}

/** `/siteverify`: the Worker-wide tenant, checked against `SITEVERIFY_SECRET`. */
export async function handleSiteverify(request, env, config, stats = null) {
  if (!config.siteverifySecret) {
    return verifyResult(
      env,
      stats,
      { success: false, error: "Siteverify is not configured" },
      500,
    );
  }
  return verifyWithSecret(
    request,
    env,
    (secret) => constantTimeSecretMatch(secret, config.siteverifySecret),
    SITE_TENANT.keySuffix,
    stats,
  );
}

/**
 * `/<siteKey>/siteverify`: a registered site's tokens, checked against the
 * sha256 of that site's secret (`site.secretHash`).
 */
export async function handleSiteSiteverify(
  request,
  env,
  site,
  keySuffix,
  stats = null,
) {
  return verifyWithSecret(
    request,
    env,
    (secret) =>
      constantTimeSecretMatch(sha256Hex(String(secret)), site.secretHash),
    keySuffix,
    stats,
  );
}

async function verifyWithSecret(
  request,
  env,
  secretMatches,
  keySuffix,
  stats,
) {
  let body;
  try {
    body = await request.json();
  } catch {
    return verifyResult(
      env,
      stats,
      { success: false, error: "Missing required parameters" },
      400,
    );
  }
  if (!body || typeof body !== "object") {
    return verifyResult(
      env,
      stats,
      { success: false, error: "Missing required parameters" },
      400,
    );
  }

  const { secret, response } = body;
  if (!secret || !response) {
    return verifyResult(
      env,
      stats,
      { success: false, error: "Missing required parameters" },
      400,
    );
  }

  if (!secretMatches(secret)) {
    return verifyResult(
      env,
      stats,
      { success: false, error: "Invalid secret" },
      403,
    );
  }

  const result = await consumeForTenant(response, env, keySuffix);
  if (!result.ok) {
    return verifyResult(
      env,
      stats,
      { success: false, error: result.error },
      result.status,
    );
  }
  return verifyResult(env, stats, { success: true }, 200);
}

/**
 * Same-origin-only verification used by the demo page. It never accepts a
 * secret from the caller. Only demo-scoped tokens are stored under the
 * `@demo` suffix, so a production token is never accepted here.
 */
export async function handleDemoSiteverify(request, env, config, stats = null) {
  if (!isSameOriginRequest(request)) {
    return verifyResult(
      env,
      stats,
      { success: false, error: "Forbidden" },
      403,
    );
  }
  if (!config.siteverifySecret) {
    return verifyResult(
      env,
      stats,
      { success: false, error: "Siteverify is not configured" },
      500,
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const token = body?.response;
  if (!token) {
    return verifyResult(
      env,
      stats,
      { success: false, error: "Missing required parameters" },
      400,
    );
  }

  const result = await consumeForTenant(token, env, DEMO_TENANT.keySuffix);
  if (!result.ok) {
    return verifyResult(
      env,
      stats,
      { success: false, error: result.error },
      result.status,
    );
  }
  return verifyResult(env, stats, { success: true }, 200);
}

export function isSameOriginRequest(request) {
  let selfOrigin;
  try {
    selfOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }
  const origin = request.headers.get("Origin");
  if (origin) return origin === selfOrigin;
  // `Sec-Fetch-Site` is a browser-set header; "none" means the user typed the
  // URL into the address bar, which is not a same-origin XHR and must not be
  // accepted for a JSON POST endpoint.
  return request.headers.get("Sec-Fetch-Site") === "same-origin";
}
