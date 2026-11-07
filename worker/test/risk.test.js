import {
  createExecutionContext,
  env,
  runInDurableObject,
  SELF,
  waitOnExecutionContext,
} from "cloudflare:test";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hashwxHash,
  hashwxReady,
  hashwxSeed,
  hashwxTarget,
} from "../../core/src/index.js";
import { solveChallengeResponse } from "../scripts/solve.js";
import { readConfig } from "../src/config.js";
import { handleChallenge, handleRedeem } from "../src/handlers.js";
import worker from "../src/index.js";
import {
  applyRisk,
  asnSignal,
  assessRisk,
  DATACENTER_ASNS,
  NO_RISK,
  riskFor,
  WARP_ASNS,
} from "../src/risk.js";
import { forgetSites, siteConfig } from "../src/sites.js";

const ORIGIN = "https://verify.rakko.cn";
const CAP_SECRET = "test-cap-secret-0123456789abcdef";
const ADMIN_SUB = "plu_UUHsG7WuUqDXh4R6";
const IP = { "CF-Connecting-IP": "203.0.113.9" };
const AWS = 16509;
const WARP = 13335;
// iCloud Private Relay egress operated by Akamai and Fastly.
const PRIVATE_RELAY = [36183, 20940, 54113];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A rate limiter double: `success` for every call, records the keys. */
function fakeLimiter(success) {
  const keys = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      return { success };
    },
  };
}

/** Calls the Worker with an execution context and waits for its `waitUntil`s. */
async function call(url, init = {}, extraEnv = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(url, init),
    { ...env, ...extraEnv },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

function config(vars = {}) {
  return readConfig({ CAP_SECRET, ALLOWED_ORIGINS: ORIGIN, ...vars });
}

function challengeRequest(cf, headers = {}) {
  return new Request(`${ORIGIN}/challenge`, { method: "POST", cf, headers });
}

function redeemRequest(body) {
  return new Request(`${ORIGIN}/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function mint(cfg, risk) {
  const res = await handleChallenge(
    challengeRequest(),
    env,
    cfg,
    null,
    undefined,
    null,
    risk,
  );
  expect(res.status).toBe(200);
  return res.json();
}

function redeem(cfg, body) {
  return handleRedeem(redeemRequest(body), env, cfg, null);
}

function registry() {
  return env.SITE_REGISTRY.getByName("registry");
}

async function createSite(settings = {}) {
  const siteKey = randomHex(5);
  await registry().createSite({
    siteKey,
    name: "Risk blog",
    origins: ["https://blog.example"],
    settings,
    secretHash: sha256(randomHex(32)),
  });
  forgetSites();
  return siteKey;
}

/** `{ "<event>/<reason>": n }` for `site`, read straight from the table. */
async function countsFor(site) {
  return runInDurableObject(
    env.STATS_STORE.getByName("global"),
    (_instance, state) => {
      const rows = state.storage.sql
        .exec(
          "SELECT event, reason, SUM(n) AS n FROM counts WHERE site = ? GROUP BY event, reason",
          site,
        )
        .toArray();
      return Object.fromEntries(
        rows.map((row) => [`${row.event}/${row.reason}`, row.n]),
      );
    },
  );
}

/** A JWT with its payload rewritten (the signature no longer matches). */
function tamperJwt(token, change) {
  const [header, payload, signature] = token.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
  const forged = Buffer.from(JSON.stringify(change(decoded))).toString(
    "base64url",
  );
  return `${header}.${forged}.${signature}`;
}

describe("risk signals", () => {
  const cfg = config();

  it("multiplies the factors of the signals that fire and caps the product", () => {
    expect(riskFor("", false, cfg)).toBe(NO_RISK);
    expect(riskFor("datacenter", false, cfg)).toEqual({
      level: 1,
      reason: "datacenter",
      factor: 4,
    });
    expect(riskFor("warp", false, cfg)).toEqual({
      level: 1,
      reason: "warp",
      factor: 6,
    });
    expect(riskFor("", true, cfg)).toEqual({
      level: 1,
      reason: "burst",
      factor: 3,
    });
    expect(riskFor("datacenter", true, cfg)).toEqual({
      level: 2,
      reason: "datacenter+burst",
      factor: 12,
    });
    expect(riskFor("warp", true, cfg)).toEqual({
      level: 2,
      reason: "warp+burst",
      factor: 18,
    });
    const capped = config({ RISK_MAX_FACTOR: "10" });
    expect(riskFor("warp", true, capped).factor).toBe(10);
    expect(riskFor("datacenter", false, capped).factor).toBe(4);
  });

  it("classifies AS numbers, never penalising Private Relay egress", () => {
    expect(asnSignal(AWS, cfg)).toBe("datacenter");
    expect(asnSignal(WARP, cfg)).toBe("warp");
    for (const asn of PRIVATE_RELAY) {
      expect(asnSignal(asn, cfg)).toBe("");
      expect(DATACENTER_ASNS.has(asn) || WARP_ASNS.has(asn)).toBe(false);
    }
    expect(asnSignal(64500, cfg)).toBe("");
    expect(asnSignal(Number.NaN, cfg)).toBe("");
    expect(asnSignal(0, cfg)).toBe("");
    for (const asn of WARP_ASNS) expect(DATACENTER_ASNS.has(asn)).toBe(false);

    const tuned = config({
      RISK_EXTRA_ASNS: "AS64500, 64501",
      RISK_EXEMPT_ASNS: `${AWS},${WARP}`,
    });
    expect(asnSignal(64500, tuned)).toBe("datacenter");
    expect(asnSignal(64501, tuned)).toBe("datacenter");
    expect(asnSignal(AWS, tuned)).toBe("");
    expect(asnSignal(WARP, tuned)).toBe("");
  });

  it("validates the risk variables", () => {
    expect(cfg).toMatchObject({
      riskDatacenterFactor: 4,
      riskWarpFactor: 6,
      riskBurstFactor: 3,
      riskMaxFactor: 18,
    });
    expect(cfg.riskExtraAsns.size).toBe(0);
    for (const vars of [
      { RISK_DATACENTER_FACTOR: "0" },
      { RISK_WARP_FACTOR: "2.5" },
      { RISK_BURST_FACTOR: "x" },
      { RISK_MAX_FACTOR: "0" },
      { RISK_EXTRA_ASNS: "64500,abc" },
      { RISK_EXEMPT_ASNS: "0" },
      { RISK_EXEMPT_ASNS: "AS99999999999" },
    ]) {
      expect(() => config(vars), JSON.stringify(vars)).toThrow(/\[config\]/);
    }
  });

  it("reads the AS number and the soft limit, and fails open", async () => {
    const soft = fakeLimiter(false);
    const both = await assessRisk(
      challengeRequest({ asn: AWS }, IP),
      { RL_CHALLENGE_SOFT: soft },
      cfg,
    );
    expect(both.reason).toBe("datacenter+burst");
    expect(soft.keys).toEqual(["challenge_soft:203.0.113.9"]);

    // No IP, no binding, or a failing binding: never a burst.
    const noIp = fakeLimiter(false);
    expect(
      (
        await assessRisk(
          challengeRequest({ asn: WARP }),
          { RL_CHALLENGE_SOFT: noIp },
          cfg,
        )
      ).reason,
    ).toBe("warp");
    expect(noIp.keys).toEqual([]);
    expect((await assessRisk(challengeRequest({}, IP), {}, cfg)).reason).toBe(
      "",
    );
    const broken = {
      limit: async () => {
        throw new Error("down");
      },
    };
    expect(
      (
        await assessRisk(
          challengeRequest({}, IP),
          { RL_CHALLENGE_SOFT: broken },
          cfg,
        )
      ).reason,
    ).toBe("");
  });
});

describe("applying the factor", () => {
  const risk = riskFor("datacenter", false, config());

  it("scales hashwxDifficulty under hashwx, on top of a site override", () => {
    const cfg = config({ CHALLENGE_PROTOCOLS: "hashwx,instrumentation" });
    const site = siteConfig(cfg, {
      origins: [],
      settings: { hashwxDifficulty: 1000, challengeCount: 7 },
    });
    const scaled = applyRisk(site, risk);
    expect(scaled.hashwxDifficulty).toBe(4000);
    expect(scaled.challengeCount).toBe(7);
    expect(applyRisk(site, NO_RISK)).toBe(site);
    const huge = applyRisk({ ...cfg, hashwxDifficulty: 900_000_000 }, risk);
    expect(huge.hashwxDifficulty).toBe(1_000_000_000);
  });

  it("scales challengeCount under SHA-256, capped at 1000", () => {
    const legacy = config({ CHALLENGE_COUNT: "50", HASHWX_DIFFICULTY: "10" });
    expect(applyRisk(legacy, risk)).toMatchObject({
      challengeCount: 200,
      hashwxDifficulty: 10,
    });
    const pow = config({
      CHALLENGE_PROTOCOLS: "sha256-pow",
      CHALLENGE_COUNT: "300",
    });
    expect(applyRisk(pow, risk).challengeCount).toBe(1000);
  });
});

describe("risk-raised challenges", () => {
  const hashwx = config({
    CHALLENGE_PROTOCOLS: "hashwx,instrumentation",
    HASHWX_DIFFICULTY: "64",
    HASHWX_CHALLENGE_COUNT: "1",
  });

  it("issues, solves and redeems a raised hashwx challenge", async () => {
    const risk = riskFor("datacenter", false, hashwx);
    const challenge = await mint(hashwx, risk);
    const pow = challenge.challenges.find((c) => c.protocol === "hashwx");
    expect(pow.payload.d).toBe(256);
    expect(challenge.challenges.map((c) => c.protocol)).toEqual([
      "hashwx",
      "instrumentation",
    ]);
    const res = await redeem(hashwx, {
      token: challenge.token,
      solutions: await solveChallengeResponse(challenge),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it("checks the signed difficulty, not the current configuration", async () => {
    const risk = riskFor("warp", true, hashwx);
    const challenge = await mint(hashwx, risk);
    const pow = challenge.challenges[0];
    expect(pow.payload.d).toBe(64 * 18);

    // A nonce that meets the base difficulty but not the raised one.
    const state = await hashwxReady();
    const c = Uint8Array.from(Buffer.from(pow.payload.c, "hex"));
    const low = hashwxTarget(64);
    const high = hashwxTarget(pow.payload.d);
    let nonce = 0n;
    for (; ; nonce++) {
      const seed = hashwxSeed(c, nonce / BigInt(pow.payload.n));
      const hash = hashwxHash(state, seed, nonce);
      if (hash <= low && hash > high) break;
    }
    // Redeemed under a configuration without the factor (and a lower base
    // difficulty still): the challenge's own parameters decide.
    const relaxed = config({
      CHALLENGE_PROTOCOLS: "hashwx,instrumentation",
      HASHWX_DIFFICULTY: "1",
      HASHWX_CHALLENGE_COUNT: "1",
    });
    const weak = await redeem(relaxed, {
      token: challenge.token,
      solutions: [{ nonce: nonce.toString() }, { blocked: true }],
    });
    expect(weak.status).toBe(403);
    expect((await weak.json()).reason).toBe("invalid_solution");

    const fresh = await mint(hashwx, risk);
    const ok = await redeem(relaxed, {
      token: fresh.token,
      solutions: await solveChallengeResponse(fresh),
    });
    expect(ok.status).toBe(200);
  });

  it("rejects a challenge whose difficulty was edited", async () => {
    const risk = riskFor("datacenter", false, hashwx);
    const challenge = await mint(hashwx, risk);
    // The payload the client sees is not what redeem checks: the expected
    // values travel encrypted inside the signed token.
    const lowered = {
      ...challenge,
      challenges: challenge.challenges.map((entry) =>
        entry.protocol === "hashwx"
          ? { ...entry, payload: { ...entry.payload, d: 1 } }
          : entry,
      ),
    };
    const forgedToken = tamperJwt(challenge.token, (payload) => ({
      ...payload,
      exp: payload.exp + 60_000,
    }));
    const tampered = await redeem(hashwx, {
      token: forgedToken,
      solutions: await solveChallengeResponse(lowered),
    });
    expect(tampered.status).toBe(403);
    expect((await tampered.json()).reason).toBe("invalid_token");

    // Format 1: the count is in the signed payload itself.
    const legacy = config({ CHALLENGE_COUNT: "2", CHALLENGE_DIFFICULTY: "1" });
    const raised = await mint(legacy, riskFor("", true, legacy));
    expect(raised.challenge.c).toBe(6);
    const fewer = tamperJwt(raised.token, (payload) => ({ ...payload, c: 2 }));
    const forged = await redeem(legacy, {
      token: fewer,
      solutions: await solveChallengeResponse({
        token: fewer,
        challenge: { ...raised.challenge, c: 2 },
      }),
      instr_blocked: true,
    });
    expect(forged.status).toBe(403);
    expect((await forged.json()).reason).toBe("invalid_token");
  });
});

describe("risk at the entry points", () => {
  it("raises a legacy /challenge from a hosting network and counts the reason", async () => {
    const res = await call(`${ORIGIN}/challenge`, {
      method: "POST",
      cf: { asn: AWS },
    });
    expect(res.status).toBe(200);
    const challenge = await res.json();
    // vitest.config.js: format 1 with CHALLENGE_COUNT 5.
    expect(challenge.challenge.c).toBe(20);
    const redeemRes = await call(`${ORIGIN}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: challenge.token,
        solutions: await solveChallengeResponse(challenge),
        instr_blocked: true,
      }),
    });
    expect(redeemRes.status).toBe(200);
  });

  it("raises a site's challenge on top of its settings and records warp+burst", async () => {
    const siteKey = await createSite({ challengeCount: 2 });
    const res = await call(
      `${ORIGIN}/${siteKey}/challenge`,
      { method: "POST", cf: { asn: WARP }, headers: IP },
      { RL_CHALLENGE_SOFT: fakeLimiter(false) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).challenge.c).toBe(36);
    const plain = await call(
      `${ORIGIN}/${siteKey}/challenge`,
      { method: "POST", cf: { asn: 64500 }, headers: IP },
      { RL_CHALLENGE_SOFT: fakeLimiter(true) },
    );
    expect((await plain.json()).challenge.c).toBe(2);
    expect(await countsFor(siteKey)).toEqual({
      "challenge_issued/": 1,
      "challenge_issued/warp+burst": 1,
    });
  });

  it("raises the gate's challenge", async () => {
    const host = `t${randomHex(6)}.risk.test`;
    const res = await call(`https://${host}/__gate/challenge`, {
      method: "POST",
      cf: { asn: AWS },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).challenge.c).toBe(20);
    expect(await countsFor(`gate:${host}`)).toEqual({
      "challenge_issued/datacenter": 1,
    });
  });

  it("checks the hard limit first and never consults the soft one for a refused request", async () => {
    const siteKey = await createSite();
    for (const url of [
      `${ORIGIN}/challenge`,
      `${ORIGIN}/demo/challenge`,
      `${ORIGIN}/${siteKey}/challenge`,
      `https://t${randomHex(6)}.risk.test/__gate/challenge`,
    ]) {
      const soft = fakeLimiter(false);
      const res = await call(
        url,
        { method: "POST", headers: IP, cf: { asn: AWS } },
        { RL_CHALLENGE: fakeLimiter(false), RL_CHALLENGE_SOFT: soft },
      );
      expect(res.status, url).toBe(429);
      expect(soft.keys, url).toEqual([]);
    }
  });

  it("counts a burst with the real soft limit (15 per 60 s) without refusing", async () => {
    const headers = {
      "CF-Connecting-IP": `198.51.100.${1 + Math.floor(Math.random() * 250)}`,
    };
    const counts = [];
    for (let i = 0; i < 17; i += 1) {
      const res = await call(`${ORIGIN}/demo/challenge`, {
        method: "POST",
        headers,
      });
      expect(res.status).toBe(200);
      counts.push((await res.json()).challenge.c);
    }
    expect(counts.slice(0, 15)).toEqual(Array(15).fill(5));
    expect(counts.slice(15)).toEqual([15, 15]);
  });
});

describe("statistics: raised challenges", () => {
  it("lists the challenge_issued reasons that occurred, without the empty one", async () => {
    const site = `gate:t${randomHex(6)}.risk.test`;
    await runInDurableObject(
      env.STATS_STORE.getByName("global"),
      async (instance) => {
        await instance.record(site, "challenge_issued", "", 5);
        await instance.record(site, "challenge_issued", "datacenter", 2);
        await instance.record(site, "challenge_issued", "warp+burst", 1);
      },
    );
    const id = randomHex(32);
    await registry().createSession(
      sha256(id),
      ADMIN_SUB,
      { name: "Rakko", email: null },
      Date.now() + 60_000,
    );
    const res = await SELF.fetch(
      `${ORIGIN}/admin/api/stats?range=24h&site=${encodeURIComponent(site)}`,
      { headers: { Cookie: `__Host-pv_admin=${id}` } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals.challenge_issued).toBe(8);
    expect(body.reasons.challenge_issued).toEqual({
      datacenter: 2,
      "warp+burst": 1,
    });
  });
});
