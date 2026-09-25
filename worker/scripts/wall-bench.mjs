/**
 * End-to-end wall-clock benchmark against a running `wrangler dev`.
 *
 * Complements `cpu-bench.mjs`: this measures the full local request path
 * (HTTP + Worker + Durable Object + SQLite) as seen by the client. It is not
 * CPU time — `wrangler dev` does not expose per-request CPU locally — but it
 * bounds it: a route that never exceeds ~10 ms of wall time locally cannot be
 * hiding tens of milliseconds of CPU.
 *
 *   node scripts/wall-bench.mjs http://127.0.0.1:8787 [challenges] [rounds]
 *
 * Every connection is fresh (`agent: false`) because the client spends
 * seconds solving between two requests.
 */

import { postJson, solveChallengeResponse } from "./solve.js";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:8787";
const challengeIterations = Number(process.argv[3] ?? 300);
const rounds = Number(process.argv[4] ?? 25);

const SECRET =
  process.env.SITEVERIFY_SECRET ??
  "dev-siteverify-secret-change-me-0123456789abcdef";

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (p) =>
    sorted[
      Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
    ];
  return {
    n: sorted.length,
    p50: pick(0.5),
    p95: pick(0.95),
    min: sorted[0],
    max: sorted.at(-1),
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

async function timed(fn) {
  const start = performance.now();
  const result = await fn();
  return { ms: performance.now() - start, result };
}

async function main() {
  const measurements = {
    challenge: [],
    redeem: [],
    redeemReplay: [],
    siteverify: [],
    siteverifyReplay: [],
  };

  for (let i = 0; i < challengeIterations; i++) {
    const { ms, result } = await timed(() =>
      postJson(new URL("/challenge", baseUrl)),
    );
    if (result.status !== 200) throw new Error(`challenge ${result.status}`);
    measurements.challenge.push(ms);
  }

  for (let i = 0; i < rounds; i++) {
    const challenge = (await postJson(new URL("/challenge", baseUrl))).body;
    const solutions = await solveChallengeResponse(challenge);
    const body = { token: challenge.token, solutions, instr_blocked: true };

    const redeem = await timed(() =>
      postJson(new URL("/redeem", baseUrl), body),
    );
    if (redeem.result.status !== 200) {
      throw new Error(
        `redeem ${redeem.result.status}: ${JSON.stringify(redeem.result.body)}`,
      );
    }
    measurements.redeem.push(redeem.ms);

    const replay = await timed(() =>
      postJson(new URL("/redeem", baseUrl), body),
    );
    if (replay.result.body.reason !== "already_redeemed") {
      throw new Error(
        `replay was not rejected: ${JSON.stringify(replay.result.body)}`,
      );
    }
    measurements.redeemReplay.push(replay.ms);

    const token = redeem.result.body.token;
    const verify = await timed(() =>
      postJson(new URL("/siteverify", baseUrl), {
        secret: SECRET,
        response: token,
      }),
    );
    if (verify.result.body.success !== true) {
      throw new Error(
        `siteverify failed: ${JSON.stringify(verify.result.body)}`,
      );
    }
    measurements.siteverify.push(verify.ms);

    const verifyReplay = await timed(() =>
      postJson(new URL("/siteverify", baseUrl), {
        secret: SECRET,
        response: token,
      }),
    );
    if (verifyReplay.result.body.success !== false) {
      throw new Error("siteverify replay unexpectedly succeeded");
    }
    measurements.siteverifyReplay.push(verifyReplay.ms);
  }

  const output = {};
  for (const [label, samples] of Object.entries(measurements)) {
    output[label] = stats(samples);
    const s = output[label];
    console.log(
      `${label.padEnd(18)} n=${s.n} p50=${s.p50.toFixed(2)}ms p95=${s.p95.toFixed(2)}ms mean=${s.mean.toFixed(2)}ms max=${s.max.toFixed(2)}ms`,
    );
  }
  console.log("\nJSON:");
  console.log(JSON.stringify(output, null, 2));
}

await main();
