import { DurableObject } from "cloudflare:workers";

/**
 * Single-use storage for redeemed tokens.
 *
 * One row per redeem. The row key is the challenge JWT signature (the same
 * value capjs-core passes to `consumeNonce`), so the insert that claims the
 * nonce and the insert that stores the token are the same row: a full
 * challenge -> redeem -> siteverify cycle costs three row writes (insert,
 * consume, sweep) instead of four, which is what keeps the free plan's
 * 100,000 rows written / day above 30,000 verifications.
 *
 * There are deliberately **no secondary indexes**: every index entry is billed
 * as an extra row written on insert and on delete, and nothing here queries by
 * `expires` as a predicate that an index would help.
 *
 * Backed by a SQLite Durable Object. Every key is owned by exactly one shard,
 * so "insert if absent" and "consume exactly once" stay atomic even though
 * they are split across shards (see `shards.js`).
 *
 * Expired rows are deleted opportunistically on write (at most once per
 * `SWEEP_INTERVAL_MS`) and by the Durable Object alarm when the object is idle,
 * so the table cannot grow without bound. The alarm is only armed when none is
 * pending, and only re-armed while rows remain: `setAlarm()` is billed as one
 * row written and an alarm invocation is billed as one request.
 */

const SWEEP_INTERVAL_MS = 5 * 60_000;
const MIN_TTL_MS = 1;

export class TokenStore extends DurableObject {
  #sql;
  #nextSweepAt = 0;

  constructor(ctx, env) {
    super(ctx, env);
    this.#sql = ctx.storage.sql;
    // Tokens are short-lived by design, so a schema change simply rebuilds the
    // table: any token minted by an older build is not worth migrating.
    const columns = this.#sql
      .exec("PRAGMA table_info(tokens)")
      .toArray()
      .map((column) => column.name);
    if (columns.length > 0 && !columns.includes("secret")) {
      this.#sql.exec("DROP TABLE tokens");
    }
    if (
      this.#sql
        .exec(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'nonces'",
        )
        .toArray().length > 0
    ) {
      // Pre-2026-09-26 builds kept challenge nonces in their own table.
      this.#sql.exec("DROP TABLE nonces");
    }
    this.#sql.exec(
      `CREATE TABLE IF NOT EXISTS tokens (
         key TEXT PRIMARY KEY,
         expires INTEGER NOT NULL,
         secret TEXT,
         consumed INTEGER NOT NULL DEFAULT 0
       ) WITHOUT ROWID`,
    );
  }

  /**
   * Atomically claims `key` and stores the redeem-token secret hash next to it.
   * Returns `false` when the key was already claimed (the same challenge
   * signature was redeemed before), in which case nothing is written.
   */
  async consumeNonce(key, ttlMs, secretHash = null) {
    const now = Date.now();
    this.#sweepIfDue(now);
    this.#sql.exec(
      "INSERT INTO tokens (key, expires, secret) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING",
      key,
      now + Math.max(MIN_TTL_MS, Number(ttlMs) || 0),
      secretHash,
    );
    // One table row, no index: sqlite's "changes" counter is 1 on insert and 0
    // on conflict.
    const claimed =
      this.#sql.exec("SELECT changes() AS changed").one().changed === 1;
    await this.#armCleanup();
    return claimed;
  }

  /** Stores (or re-arms) a redeem token until `expires` (epoch ms). */
  async storeToken(key, expires, secretHash = null) {
    const now = Date.now();
    this.#sweepIfDue(now);
    this.#sql.exec(
      `INSERT INTO tokens (key, expires, secret, consumed) VALUES (?, ?, ?, 0)
       ON CONFLICT(key) DO UPDATE SET expires = excluded.expires, secret = excluded.secret, consumed = 0`,
      key,
      expires,
      secretHash,
    );
    await this.#armCleanup();
  }

  /**
   * Atomically consumes `key` once and returns its stored expiry, or `null`
   * when the token does not exist, was already consumed, or the secret does not
   * match. The row is kept (marked consumed) until its expiry so that the same
   * challenge cannot be redeemed again after its token was verified.
   */
  async consumeToken(key, secretHash = null) {
    const rows = (
      secretHash === null
        ? this.#sql.exec(
            "UPDATE tokens SET consumed = 1 WHERE key = ? AND consumed = 0 RETURNING expires",
            key,
          )
        : this.#sql.exec(
            "UPDATE tokens SET consumed = 1 WHERE key = ? AND consumed = 0 AND secret = ? RETURNING expires",
            key,
            secretHash,
          )
    ).toArray();
    return rows.length > 0 ? Number(rows[0].expires) : null;
  }

  async alarm() {
    const now = Date.now();
    this.#deleteExpired(now);
    this.#nextSweepAt = now + SWEEP_INTERVAL_MS;
    // Re-arm only while there is something left to clean up. Sweeping on a
    // fixed cadence (instead of "1s after the earliest expiry") avoids an alarm
    // storm under steady traffic, where the earliest expiry is always ~now.
    if (this.#hasRows()) {
      await this.ctx.storage.setAlarm(now + SWEEP_INTERVAL_MS);
    }
  }

  #sweepIfDue(now) {
    if (now < this.#nextSweepAt) return;
    this.#nextSweepAt = now + SWEEP_INTERVAL_MS;
    this.#deleteExpired(now);
  }

  #deleteExpired(now) {
    this.#sql.exec("DELETE FROM tokens WHERE expires <= ?", now);
  }

  #hasRows() {
    const row = this.#sql.exec("SELECT COUNT(*) AS n FROM tokens").one();
    return Number(row.n) > 0;
  }

  async #armCleanup() {
    // `getAlarm()` is a storage read; calling `setAlarm()` unconditionally on
    // every write would add one billed row written per verification.
    if ((await this.ctx.storage.getAlarm()) !== null) return;
    await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }
}
