/**
 * Minimal client-side solver for the challenge formats capjs-core can mint.
 *
 * Used by the curl acceptance script and by the Worker's automated tests. The
 * sha256-pow derivation matches `widget/src/src/worker.js` (and therefore the
 * server's `validateChallenge`): the seed for challenge `i` is
 * `fnv1a(token + (i + 1))`.
 */

import {
  parseHexPrefix,
  powMatchesPrefix,
  sha256Bytes,
} from "../../core/src/crypto.js";
import {
  hashwxHash,
  hashwxReady,
  hashwxSeed,
  hashwxTarget,
} from "../../core/src/index.js";
import { fnv1a, fnv1aResume, prngFromHash } from "../../core/src/prng.js";

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function deriveSha256Challenge(token, index, size, difficulty) {
  const saltSeed = fnv1aResume(fnv1a(token), String(index + 1));
  const targetSeed = fnv1aResume(saltSeed, "d");
  return {
    salt: prngFromHash(saltSeed, size),
    target: prngFromHash(targetSeed, difficulty),
  };
}

export function solveSha256(salt, target) {
  const parsed = parseHexPrefix(target);
  for (let nonce = 0; ; nonce++) {
    if (powMatchesPrefix(sha256Bytes(salt + nonce), parsed)) return nonce;
  }
}

export function solveFormat1(token, challenge) {
  const solutions = [];
  for (let i = 0; i < challenge.c; i++) {
    const { salt, target } = deriveSha256Challenge(
      token,
      i,
      challenge.s,
      challenge.d,
    );
    solutions.push(solveSha256(salt, target));
  }
  return solutions;
}

export async function solveHashwx(payload) {
  const state = await hashwxReady();
  const challenge = hexToBytes(payload.c);
  const target = hashwxTarget(payload.d);
  const noncesPerHash = BigInt(payload.n);
  for (let nonce = 0n; ; nonce++) {
    const seed = hashwxSeed(challenge, nonce / noncesPerHash);
    if (hashwxHash(state, seed, nonce) <= target) return nonce.toString();
  }
}

/** Solves a `/challenge` response and returns the `solutions` array. */
export async function solveChallengeResponse(resp) {
  if (resp.format === 2) {
    const solutions = [];
    for (const entry of resp.challenges) {
      if (entry.protocol === "sha256-pow") {
        solutions.push({
          nonce: solveSha256(entry.payload.salt, entry.payload.target),
        });
      } else if (entry.protocol === "hashwx") {
        solutions.push({ nonce: await solveHashwx(entry.payload) });
      } else if (entry.protocol === "instrumentation") {
        // The instrumentation script needs a DOM. Declaring the probe blocked
        // is what the widget itself sends when its probe cannot run;
        // capjs-core accepts it unless the challenge was minted with
        // blockAutomatedBrowsers.
        solutions.push({ blocked: true });
      } else {
        throw new Error(
          `cannot solve protocol '${entry.protocol}' outside a browser`,
        );
      }
    }
    return solutions;
  }

  return solveFormat1(resp.token, resp.challenge);
}

/**
 * Requests a challenge, solves it and redeems it. `instr_blocked: true` tells
 * the server the instrumentation probe never ran, which capjs-core accepts
 * unless the challenge was minted with `blockAutomatedBrowsers` (the widget
 * sends the same flag when its own probe is blocked).
 */
export async function solveAndRedeem(baseUrl) {
  const challengeRes = await postJson(new URL("/challenge", baseUrl));
  const challenge = challengeRes.body;
  if (challengeRes.status !== 200 || challenge.error) {
    throw new Error(
      `challenge failed: ${challengeRes.status} ${JSON.stringify(challenge)}`,
    );
  }

  const solutions = await solveChallengeResponse(challenge);
  const body = {
    token: challenge.token,
    solutions,
    instr_blocked: true,
  };
  const redeemRes = await postJson(new URL("/redeem", baseUrl), body);
  return {
    challenge,
    body,
    redeemStatus: redeemRes.status,
    redeem: redeemRes.body,
  };
}

/**
 * POSTs JSON over a brand-new HTTP connection. Node's global fetch keeps the
 * socket from `/challenge` in a pool, and the pool can drop it while the client
 * is still solving (milliseconds to seconds), which surfaces as a bogus
 * "other side closed" on the redeem call.
 */
export async function postJson(url, body, extraHeaders = {}) {
  const { request } = await import("node:http");
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return await new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        agent: false,
        headers: {
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
          ...extraHeaders,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = { error: "invalid JSON response", raw: text };
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: parsed,
          });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
