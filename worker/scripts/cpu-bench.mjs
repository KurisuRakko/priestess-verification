/**
 * CPU-cost benchmark for the three API routes.
 *
 * The Cloudflare free plan allows 10 ms of CPU per request, and workerd does
 * not expose per-request CPU time locally, so this measures the exact same
 * capjs-core / worker code with `process.cpuUsage()` under Node. The storage
 * part of `/siteverify` is approximated with `node:sqlite` (same SQLite, same
 * statements); Durable Object RPC and serialisation are *not* included.
 *
 *   node scripts/cpu-bench.mjs [iterations]
 *
 * Prints p50/p95/mean/max in milliseconds per operation.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { generateChallenge, validateChallenge } from "../../core/src/index.js";
import { solveChallengeResponse } from "./solve.js";

const SECRET = "cpu-bench-secret-0123456789abcdef";
const ITERATIONS = Number(process.argv[2] ?? 400);

function percentile(sorted, p) {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[index];
}

async function bench(label, fn, iterations = ITERATIONS) {
  for (let i = 0; i < 10; i++) await fn();

  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const before = process.cpuUsage();
    await fn();
    const delta = process.cpuUsage(before);
    samples.push((delta.user + delta.system) / 1000);
  }
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const result = {
    label,
    iterations,
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    mean,
    max: samples.at(-1),
  };
  console.log(
    `${label.padEnd(52)} p50=${result.p50.toFixed(3)}ms p95=${result.p95.toFixed(3)}ms mean=${mean.toFixed(3)}ms max=${result.max.toFixed(3)}ms`,
  );
  return result;
}

async function main() {
  console.log(`node ${process.version} — ${ITERATIONS} iterations each\n`);

  const results = [];

  results.push(
    await bench("challenge: format 1, no instrumentation", () =>
      generateChallenge(SECRET, {}),
    ),
  );
  results.push(
    await bench("challenge: instrumentation level 1", () =>
      generateChallenge(SECRET, { instrumentation: { obfuscationLevel: 1 } }),
    ),
  );
  results.push(
    await bench("challenge: instrumentation level 3 (default)", () =>
      generateChallenge(SECRET, { instrumentation: { obfuscationLevel: 3 } }),
    ),
  );
  results.push(
    await bench("challenge: instrumentation level 4 (esbuild stub)", () =>
      generateChallenge(SECRET, { instrumentation: { obfuscationLevel: 4 } }),
    ),
  );
  results.push(
    await bench("challenge: instrumentation level 7 (esbuild stub)", () =>
      generateChallenge(SECRET, { instrumentation: { obfuscationLevel: 7 } }),
    ),
  );
  results.push(
    await bench("challenge: instrumentation level 10 (both stubs)", () =>
      generateChallenge(SECRET, { instrumentation: { obfuscationLevel: 10 } }),
    ),
  );

  // Redeem: one solved body per shape, re-validated every iteration with a
  // no-op consumeNonce (the Durable Object round trip is measured separately).
  const format1 = await generateChallenge(SECRET, { instrumentation: true });
  const format1Body = {
    token: format1.token,
    solutions: await solveChallengeResponse(format1),
    instr_blocked: true,
  };
  results.push(
    await bench("redeem: format 1 (50 challenges, difficulty 4)", () =>
      validateChallenge(SECRET, format1Body, {
        consumeNonce: async () => true,
      }),
    ),
  );

  const format2 = await generateChallenge(SECRET, {
    format: 2,
    protocols: ["sha256-pow", "instrumentation"],
    challengeCount: 50,
    challengeDifficulty: 4,
  });
  const format2Body = {
    token: format2.token,
    solutions: await solveChallengeResponse(format2),
  };
  results.push(
    await bench("redeem: format 2 (sha256-pow x50 + instr)", () =>
      validateChallenge(SECRET, format2Body, {
        consumeNonce: async () => true,
      }),
    ),
  );

  const hashwx = await generateChallenge(SECRET, {
    format: 2,
    protocols: ["hashwx"],
    hashwxDifficulty: 200_000,
  });
  const hashwxBody = {
    token: hashwx.token,
    solutions: await solveChallengeResponse(hashwx),
  };
  results.push(
    await bench(
      "redeem: format 2 (hashwx x4, d=200k)",
      () =>
        validateChallenge(SECRET, hashwxBody, {
          consumeNonce: async () => true,
        }),
      200,
    ),
  );

  // siteverify: constant-time secret compare + token key + SQLite consume.
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE tokens (key TEXT PRIMARY KEY, expires INTEGER NOT NULL) WITHOUT ROWID",
  );
  db.exec("CREATE INDEX tokens_expires ON tokens (expires)");
  const insert = db.prepare(
    "INSERT OR REPLACE INTO tokens (key, expires) VALUES (?, ?)",
  );
  const consume = db.prepare(
    "DELETE FROM tokens WHERE key = ? RETURNING expires",
  );
  const provided = SECRET;
  const expected = SECRET;
  results.push(
    await bench("siteverify: secret compare + key + sqlite consume", () => {
      const a = createHash("sha256").update(provided, "utf8").digest();
      const b = createHash("sha256").update(expected, "utf8").digest();
      if (!timingSafeEqual(a, b)) throw new Error("unexpected mismatch");
      const key = `deadbeefdeadbeef:${createHash("sha256")
        .update(randomBytes(15).toString("hex"), "utf8")
        .digest("hex")}`;
      insert.run(key, Date.now() + 60_000);
      const rows = consume.all(key);
      if (rows.length !== 1) throw new Error("unexpected consume result");
    }),
  );

  console.log("\nJSON:");
  console.log(JSON.stringify(results, null, 2));
}

await main();
