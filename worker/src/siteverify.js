import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Server-to-server verification helpers, shared by `/siteverify` and the demo
 * page's same-origin shortcut.
 *
 * The request/response contract mirrors `standalone/src/siteverify.js`
 * (`{ secret, response }` -> `{ success }`, same status codes and error
 * strings) so the dashboard's Node snippet keeps working unchanged.
 *
 * Redeem tokens are `<challenge-signature-hex>:<secret>` (see `handlers.js`).
 * The signature is the storage key (issued by the Worker's own `signToken`
 * hook); the secret is only ever stored as a sha256 hash, and a token is
 * consumed with a single conditional UPDATE, which is what makes verification
 * both atomic and single use.
 */

/**
 * Compares two secrets without leaking their contents or their length through
 * timing. Both sides are hashed to a fixed 32 bytes first, then compared with
 * `timingSafeEqual`.
 */
export function constantTimeSecretMatch(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string")
    return false;
  if (provided.length === 0 || expected.length === 0) return false;
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * Splits a redeem token (`<signature>:<secret>`) into its parts. Returns `null`
 * for anything that is not exactly two non-empty segments.
 */
export function parseRedeemToken(token) {
  if (typeof token !== "string") return null;
  const separator = token.indexOf(":");
  if (separator <= 0 || separator !== token.lastIndexOf(":")) return null;
  const id = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!id || !secret) return null;
  return { id, secret };
}

/**
 * Storage key for a token signature. The demo page uses its own prefix so that
 * demo-scoped tokens and production tokens can never consume each other's rows.
 */
export function storageKeyFor(id, keyPrefix = "") {
  return `${keyPrefix}${id}`;
}

/** Hash of the token secret; the raw secret never reaches the store. */
export function tokenSecretHash(secret) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * Single-use consumption of a redeem token.
 *
 * `consumeToken(key, secretHash)` must atomically consume the key and return
 * its expiry (epoch ms) or `null`. The token is consumed before the expiry
 * check so a stale token cannot be replayed after it expires either.
 */
export async function consumeRedeemToken(
  token,
  consumeToken,
  keyPrefix = "",
) {
  const parsed = parseRedeemToken(token);
  if (!parsed) {
    return { ok: false, status: 400, error: "Missing required parameters" };
  }

  const key = storageKeyFor(parsed.id, keyPrefix);
  const expires = await consumeToken(key, tokenSecretHash(parsed.secret));
  if (expires === null || expires === undefined) {
    return { ok: false, status: 404, error: "Token not found" };
  }
  if (Number(expires) < Date.now()) {
    return { ok: false, status: 403, error: "Token expired" };
  }
  return { ok: true, status: 200 };
}
