import {
  createExecutionContext,
  env,
  runInDurableObject,
  SELF,
  waitOnExecutionContext,
} from "cloudflare:test";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { solveChallengeResponse } from "../scripts/solve.js";
import { bucketWindow } from "../src/admin/stats-api.js";
import { redeemFailReason, verifyFailReason } from "../src/handlers.js";
import worker from "../src/index.js";
import { forgetSites } from "../src/sites.js";
import { hourOf, STATS_EVENTS } from "../src/stats.js";

const ORIGIN = "https://verify.rakko.cn";
const SITEVERIFY_SECRET = "test-siteverify-secret-0123456789abcdef";
const ADMIN_SUB = "plu_UUHsG7WuUqDXh4R6";
const HTML_ACCEPT = "text/html,application/xhtml+xml,*/*;q=0.8";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A host nobody else uses, so its `gate:<host>` counters start at zero. */
function uniqueHost() {
  return `t${randomHex(6)}.stats.test`;
}

function globalStats() {
  return env.STATS_STORE.getByName("global");
}

/** `{ "<event>/<reason>": n }` for `site`, read straight from the table. */
async function countsFor(site) {
  return runInDurableObject(globalStats(), (_instance, state) => {
    const rows = state.storage.sql
      .exec(
        "SELECT event, reason, SUM(n) AS n FROM counts WHERE site = ? GROUP BY event, reason",
        site,
      )
      .toArray();
    return Object.fromEntries(
      rows.map((row) => [`${row.event}/${row.reason}`, row.n]),
    );
  });
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

function postJson(url, body, headers = {}, extraEnv = {}) {
  return call(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    extraEnv,
  );
}

async function mintToken(base) {
  const challengeRes = await call(`${base}challenge`, { method: "POST" });
  expect(challengeRes.status).toBe(200);
  const challenge = await challengeRes.json();
  const solutions = await solveChallengeResponse(challenge);
  const redeemRes = await postJson(`${base}redeem`, {
    token: challenge.token,
    solutions,
    instr_blocked: true,
  });
  expect(redeemRes.status).toBe(200);
  return (await redeemRes.json()).token;
}

function registry() {
  return env.SITE_REGISTRY.getByName("registry");
}

async function createSite(name = "Stats blog") {
  const siteKey = randomHex(5);
  const secret = randomHex(32);
  await registry().createSite({
    siteKey,
    name,
    origins: ["https://blog.example"],
    settings: {},
    secretHash: sha256(secret),
  });
  forgetSites();
  return { siteKey, secret };
}

async function adminCookie() {
  const id = randomHex(32);
  await registry().createSession(
    sha256(id),
    ADMIN_SUB,
    { name: "Rakko", email: null },
    Date.now() + 60_000,
  );
  return `__Host-pv_admin=${id}`;
}

async function statsApi(query, cookie) {
  return SELF.fetch(`${ORIGIN}/admin/api/stats${query}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
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

/** A Durable Object namespace double that counts how often it is reached. */
function countingNamespace(namespace) {
  const store = {
    calls: 0,
    getByName(name) {
      store.calls++;
      return namespace.getByName(name);
    },
  };
  return store;
}

/** A TOKEN_STORE double that counts how often it is reached. */
function countingTokenStore() {
  return countingNamespace(env.TOKEN_STORE);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StatsStore", () => {
  it("adds up writes per (hour, site, event, reason)", async () => {
    const stub = env.STATS_STORE.getByName(`test-${randomHex(4)}`);
    const t = Date.UTC(2026, 10, 1, 10, 5);
    await stub.record("s", "redeem_fail", "expired", 1, t);
    await stub.record("s", "redeem_fail", "expired", 2, t + 20 * 60_000);
    await stub.record("s", "redeem_fail", "invalid_solution", 1, t);
    await stub.record("s", "redeem_ok", "", 1, t + HOUR_MS);
    await stub.record("other", "redeem_ok", "", 5, t);

    const from = hourOf(t);
    const all = await stub.query(from, from + 2 * 3600);
    expect(all.series).toEqual(
      expect.arrayContaining([
        { hour: from, event: "redeem_fail", n: 4 },
        { hour: from, event: "redeem_ok", n: 5 },
        { hour: from + 3600, event: "redeem_ok", n: 1 },
      ]),
    );
    expect(all.series).toHaveLength(3);

    const one = await stub.query(from, from + 2 * 3600, "s");
    expect(one.reasons).toEqual(
      expect.arrayContaining([
        { event: "redeem_fail", reason: "expired", n: 3 },
        { event: "redeem_fail", reason: "invalid_solution", n: 1 },
      ]),
    );
    expect(one.reasons).toHaveLength(2);
    expect(one.series).toHaveLength(2);
    // bySite ignores the site filter.
    expect(one.bySite).toEqual(
      expect.arrayContaining([
        { site: "s", event: "redeem_fail", n: 4 },
        { site: "s", event: "redeem_ok", n: 1 },
        { site: "other", event: "redeem_ok", n: 5 },
      ]),
    );

    // Only hours inside [from, to) are read.
    const first = await stub.query(from, from + 3600, "s");
    expect(first.series).toEqual([{ hour: from, event: "redeem_fail", n: 4 }]);
  });

  it("drops rows older than 90 days on the first write of a new hour", async () => {
    const stub = env.STATS_STORE.getByName(`test-${randomHex(4)}`);
    const now = Date.now();
    await stub.record("s", "gate_shown", "", 1, now - 91 * DAY_MS);
    await stub.record("s", "gate_shown", "", 1, now - 89 * DAY_MS);
    await stub.record("s", "gate_shown", "", 1, now);
    const left = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql.exec("SELECT hour FROM counts ORDER BY hour").toArray(),
    );
    expect(left.map((row) => row.hour)).toEqual([
      hourOf(now - 89 * DAY_MS),
      hourOf(now),
    ]);
  });
});

describe("statistics reasons", () => {
  it("maps capjs-core redeem failures onto the redeem_fail reasons", () => {
    const cases = {
      invalid_solution: "invalid_solution",
      expired: "expired",
      already_redeemed: "already_redeemed",
      instr_timeout: "instr_timeout",
      invalid_token: "invalid_token",
      scope_mismatch: "invalid_token",
      invalid_body: "bad_request",
      missing_token: "bad_request",
      missing_solutions: "bad_request",
      invalid_solutions: "bad_request",
      nonce_store_error: "internal",
      something_new: "other",
    };
    for (const [reason, expected] of Object.entries(cases)) {
      expect(redeemFailReason({ reason })).toBe(expected);
    }
    expect(
      redeemFailReason({
        reason: "instr_automated_browser",
        instr_error: true,
      }),
    ).toBe("instr_blocked");
    expect(redeemFailReason({ reason: "x", blockedBy: "webdriver" })).toBe(
      "instr_blocked",
    );
    expect(
      redeemFailReason({ reason: "instr_timeout", instr_error: true }),
    ).toBe("instr_timeout");
  });

  it("maps siteverify failures onto the siteverify_fail reasons", () => {
    expect(verifyFailReason(400, "Missing required parameters")).toBe(
      "bad_request",
    );
    expect(verifyFailReason(404, "Token not found")).toBe("token_not_found");
    expect(verifyFailReason(403, "Token expired")).toBe("token_expired");
    expect(verifyFailReason(403, "Invalid secret")).toBe("invalid_secret");
    expect(verifyFailReason(500, "Siteverify is not configured")).toBe(
      "internal",
    );
    expect(verifyFailReason(403, "Forbidden")).toBe("other");
  });
});

describe("statistics events", () => {
  it("counts default-route challenges, redeems and siteverifies under `default`", async () => {
    const before = await countsFor("default");
    const delta = async (key) =>
      ((await countsFor("default"))[key] ?? 0) - (before[key] ?? 0);

    const token = await mintToken(`${ORIGIN}/`);
    const ok = await postJson(`${ORIGIN}/siteverify`, {
      secret: SITEVERIFY_SECRET,
      response: token,
    });
    expect(ok.status).toBe(200);
    const badSecret = await postJson(`${ORIGIN}/siteverify`, {
      secret: "wrong",
      response: token,
    });
    expect(badSecret.status).toBe(403);
    const replay = await postJson(`${ORIGIN}/siteverify`, {
      secret: SITEVERIFY_SECRET,
      response: token,
    });
    expect(replay.status).toBe(404);
    const badBody = await call(`${ORIGIN}/redeem`, {
      method: "POST",
      body: "not json",
    });
    expect(badBody.status).toBe(400);
    // A demo challenge redeemed at /redeem: scope_mismatch -> invalid_token.
    const demo = await (
      await call(`${ORIGIN}/demo/challenge`, { method: "POST" })
    ).json();
    const mismatch = await postJson(`${ORIGIN}/redeem`, {
      token: demo.token,
      solutions: await solveChallengeResponse(demo),
      instr_blocked: true,
    });
    expect(mismatch.status).toBe(403);
    // The demo shortcut only takes same-origin calls.
    const forbidden = await postJson(`${ORIGIN}/demo/siteverify`, {
      response: "x",
    });
    expect(forbidden.status).toBe(403);

    expect(await delta("challenge_issued/")).toBe(2);
    expect(await delta("redeem_ok/")).toBe(1);
    expect(await delta("redeem_fail/bad_request")).toBe(1);
    expect(await delta("redeem_fail/invalid_token")).toBe(1);
    expect(await delta("siteverify_ok/")).toBe(1);
    expect(await delta("siteverify_fail/invalid_secret")).toBe(1);
    expect(await delta("siteverify_fail/token_not_found")).toBe(1);
    expect(await delta("siteverify_fail/other")).toBe(1);
  });

  it("counts a registered site's traffic under its site key", async () => {
    const { siteKey, secret } = await createSite();
    const token = await mintToken(`${ORIGIN}/${siteKey}/`);
    const ok = await postJson(`${ORIGIN}/${siteKey}/siteverify`, {
      secret,
      response: token,
    });
    expect(ok.status).toBe(200);
    const malformed = await postJson(`${ORIGIN}/${siteKey}/siteverify`, {
      secret,
      response: "abc",
    });
    expect(malformed.status).toBe(400);

    expect(await countsFor(siteKey)).toEqual({
      "challenge_issued/": 1,
      "redeem_ok/": 1,
      "siteverify_ok/": 1,
      "siteverify_fail/bad_request": 1,
    });
  });

  it("counts the gate under gate:<host>", async () => {
    const host = uniqueHost();
    const base = `https://${host}`;

    const page = await call(`${base}/protected`, {
      headers: { Accept: HTML_ACCEPT },
    });
    expect(page.status).toBe(403);
    const api = await call(`${base}/protected/x`);
    expect(api.status).toBe(403);

    const token = await mintToken(`${base}/__gate/`);
    const passRes = await postJson(
      `${base}/__gate/pass`,
      { token, return: "/protected" },
      { Origin: base },
    );
    expect(passRes.status).toBe(200);
    const replay = await postJson(
      `${base}/__gate/pass`,
      { token, return: "/protected" },
      { Origin: base },
    );
    expect(replay.status).toBe(404);
    const missing = await postJson(`${base}/__gate/pass`, {}, { Origin: base });
    expect(missing.status).toBe(400);
    const crossOrigin = await postJson(
      `${base}/__gate/pass`,
      { token },
      { Origin: "https://evil.example" },
    );
    expect(crossOrigin.status).toBe(403);

    expect(await countsFor(`gate:${host}`)).toEqual({
      "gate_shown/": 2,
      "challenge_issued/": 1,
      "redeem_ok/": 1,
      "gate_pass/": 1,
      "gate_pass_fail/token_not_found": 1,
      "gate_pass_fail/bad_request": 1,
      "gate_pass_fail/other": 1,
    });
  });

  it("records nothing without an execution context", async () => {
    const host = uniqueHost();
    const res = await worker.fetch(
      new Request(`https://${host}/protected`),
      env,
    );
    expect(res.status).toBe(403);
    expect(await countsFor(`gate:${host}`)).toEqual({});
  });
});

describe("rate limiting", () => {
  const IP = { "CF-Connecting-IP": "203.0.113.7" };

  it("answers a limited challenge with 429, Retry-After and the route's CORS headers", async () => {
    const limiter = fakeLimiter(false);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const before = (await countsFor("default"))["rate_limited/challenge"] ?? 0;
    const res = await call(
      `${ORIGIN}/challenge`,
      { method: "POST", headers: { Origin: ORIGIN, ...IP } },
      { RL_CHALLENGE: limiter },
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(await res.json()).toEqual({
      success: false,
      reason: "rate_limited",
      error: "Too many requests",
    });
    expect(limiter.keys).toEqual(["challenge:203.0.113.7"]);
    const after = (await countsFor("default"))["rate_limited/challenge"] ?? 0;
    expect(after - before).toBe(10);
  });

  it("samples rate_limited: nine in ten rejections are not written", async () => {
    const host = uniqueHost();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const res = await call(
      `https://${host}/__gate/challenge`,
      { method: "POST", headers: IP },
      { RL_CHALLENGE: fakeLimiter(false) },
    );
    expect(res.status).toBe(429);
    expect(await countsFor(`gate:${host}`)).toEqual({});
  });

  it("rejects a limited redeem before the token store is reached", async () => {
    const store = countingTokenStore();
    const limiter = fakeLimiter(false);
    const res = await postJson(
      `${ORIGIN}/redeem`,
      { token: "x", solutions: [] },
      IP,
      { RL_REDEEM: limiter, TOKEN_STORE: store },
    );
    expect(res.status).toBe(429);
    expect(limiter.keys).toEqual(["redeem:203.0.113.7"]);
    expect(store.calls).toBe(0);
  });

  it("limits /__gate/pass on RL_REDEEM with the gate_pass key", async () => {
    const host = uniqueHost();
    const base = `https://${host}`;
    const store = countingTokenStore();
    const limiter = fakeLimiter(false);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const res = await postJson(
      `${base}/__gate/pass`,
      { token: "abc:def" },
      { Origin: base, ...IP },
      { RL_REDEEM: limiter, TOKEN_STORE: store },
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(limiter.keys).toEqual(["gate_pass:203.0.113.7"]);
    expect(store.calls).toBe(0);
    expect(await countsFor(`gate:${host}`)).toEqual({
      "rate_limited/gate_pass": 10,
    });
  });

  it("limits a registered site's redeem before its tokens are touched", async () => {
    const { siteKey } = await createSite();
    const store = countingTokenStore();
    const limiter = fakeLimiter(false);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const res = await postJson(
      `${ORIGIN}/${siteKey}/redeem`,
      { token: "x", solutions: [] },
      { Origin: "https://blog.example", ...IP },
      { RL_REDEEM: limiter, TOKEN_STORE: store },
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "https://blog.example",
    );
    expect(store.calls).toBe(0);
    expect(await countsFor(siteKey)).toEqual({ "rate_limited/redeem": 10 });
  });

  it("does not count a limited request for an unknown site key", async () => {
    const siteKey = randomHex(5);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const res = await call(
      `${ORIGIN}/${siteKey}/challenge`,
      { method: "POST", headers: IP },
      { RL_CHALLENGE: fakeLimiter(false) },
    );
    expect(res.status).toBe(429);
    expect(await countsFor(siteKey)).toEqual({});
  });

  it("lets requests through without an IP, under the limit, or when the binding fails", async () => {
    const noIp = fakeLimiter(false);
    const res1 = await call(
      `${ORIGIN}/challenge`,
      { method: "POST" },
      { RL_CHALLENGE: noIp },
    );
    expect(res1.status).toBe(200);
    expect(noIp.keys).toEqual([]);

    const res2 = await call(
      `${ORIGIN}/challenge`,
      { method: "POST", headers: IP },
      { RL_CHALLENGE: fakeLimiter(true) },
    );
    expect(res2.status).toBe(200);

    vi.spyOn(console, "error").mockImplementation(() => {});
    const res3 = await call(
      `${ORIGIN}/challenge`,
      { method: "POST", headers: IP },
      {
        RL_CHALLENGE: {
          limit: async () => {
            throw new Error("down");
          },
        },
      },
    );
    expect(res3.status).toBe(200);
  });

  it("is configured from wrangler.jsonc", () => {
    expect(typeof env.RL_CHALLENGE?.limit).toBe("function");
    expect(typeof env.RL_REDEEM?.limit).toBe("function");
    expect(typeof env.RL_SITEVERIFY?.limit).toBe("function");
  });
});

describe("rate limiting: siteverify", () => {
  const IP = { "CF-Connecting-IP": "203.0.113.9" };
  const LIMITED_BODY = {
    success: false,
    reason: "rate_limited",
    error: "Too many requests",
  };

  /**
   * A SITE_REGISTRY double that counts registry reads (`listSites` RPCs);
   * taking a stub is free, so the warm site snapshot still costs nothing.
   */
  function countingRegistry() {
    const registry = {
      calls: 0,
      getByName(name) {
        const stub = env.SITE_REGISTRY.getByName(name);
        return {
          listSites() {
            registry.calls++;
            return stub.listSites();
          },
        };
      },
    };
    return registry;
  }

  /** Doubles for every Durable Object a siteverify could reach. */
  function counters() {
    return {
      TOKEN_STORE: countingNamespace(env.TOKEN_STORE),
      SITE_REGISTRY: countingRegistry(),
      STATS_STORE: countingNamespace(env.STATS_STORE),
    };
  }

  function callsOf(doubles) {
    return Object.values(doubles).map((store) => store.calls);
  }

  async function expectLimited(res, limiter) {
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(await res.json()).toEqual(LIMITED_BODY);
    expect(limiter.keys).toEqual(["siteverify:203.0.113.9"]);
  }

  it("limits /siteverify before any Durable Object is reached", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const doubles = counters();
    const limiter = fakeLimiter(false);
    const res = await postJson(`${ORIGIN}/siteverify`, {}, IP, {
      RL_SITEVERIFY: limiter,
      ...doubles,
    });
    await expectLimited(res, limiter);
    expect(callsOf(doubles)).toEqual([0, 0, 0]);
  });

  it("limits /demo/siteverify before any Durable Object is reached", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const doubles = counters();
    const limiter = fakeLimiter(false);
    const res = await postJson(
      `${ORIGIN}/demo/siteverify`,
      { response: "abc:def" },
      { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", ...IP },
      { RL_SITEVERIFY: limiter, ...doubles },
    );
    await expectLimited(res, limiter);
    expect(callsOf(doubles)).toEqual([0, 0, 0]);
  });

  it("limits a registered site's siteverify before its tokens or registry are read", async () => {
    const { siteKey, secret } = await createSite();
    // Warm the per-isolate site snapshot, as live traffic would.
    await postJson(`${ORIGIN}/${siteKey}/siteverify`, {});
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const doubles = counters();
    const limiter = fakeLimiter(false);
    const res = await postJson(
      `${ORIGIN}/${siteKey}/siteverify`,
      { secret, response: "abc:def" },
      IP,
      { RL_SITEVERIFY: limiter, ...doubles },
    );
    await expectLimited(res, limiter);
    expect(callsOf(doubles)).toEqual([0, 0, 0]);
  });

  it("samples limited siteverifies as rate_limited/siteverify", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const before = (await countsFor("default"))["rate_limited/siteverify"] ?? 0;
    for (const path of ["/siteverify", "/demo/siteverify"]) {
      const res = await postJson(`${ORIGIN}${path}`, {}, IP, {
        RL_SITEVERIFY: fakeLimiter(false),
      });
      expect(res.status).toBe(429);
    }
    const after = (await countsFor("default"))["rate_limited/siteverify"] ?? 0;
    expect(after - before).toBe(20);

    const { siteKey } = await createSite();
    const res = await postJson(`${ORIGIN}/${siteKey}/siteverify`, {}, IP, {
      RL_SITEVERIFY: fakeLimiter(false),
    });
    expect(res.status).toBe(429);
    expect(await countsFor(siteKey)).toEqual({ "rate_limited/siteverify": 10 });

    const unknown = randomHex(5);
    const res2 = await postJson(`${ORIGIN}/${unknown}/siteverify`, {}, IP, {
      RL_SITEVERIFY: fakeLimiter(false),
    });
    expect(res2.status).toBe(429);
    expect(await countsFor(unknown)).toEqual({});
  });

  it("verifies as before under the limit", async () => {
    const limiter = fakeLimiter(true);
    const extra = { RL_SITEVERIFY: limiter };
    const token = await mintToken(`${ORIGIN}/`);
    const ok = await postJson(
      `${ORIGIN}/siteverify`,
      { secret: SITEVERIFY_SECRET, response: token },
      IP,
      extra,
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).success).toBe(true);

    const bad = await postJson(`${ORIGIN}/siteverify`, {}, IP, extra);
    expect(bad.status).toBe(400);

    const demo = await postJson(
      `${ORIGIN}/demo/siteverify`,
      { response: "abc:def" },
      { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", ...IP },
      extra,
    );
    expect(demo.status).not.toBe(429);

    const { siteKey } = await createSite();
    const site = await postJson(
      `${ORIGIN}/${siteKey}/siteverify`,
      {},
      IP,
      extra,
    );
    expect(site.status).not.toBe(429);
    expect(limiter.keys).toEqual(Array(4).fill("siteverify:203.0.113.9"));
  });
});

describe("GET /admin/api/stats", () => {
  /** Writes counters straight into the global store, at `at` (epoch ms). */
  async function seed(entries) {
    const stub = globalStats();
    for (const [site, event, reason, n, at] of entries) {
      await stub.record(site, event, reason, n, at);
    }
  }

  it("requires an admin session", async () => {
    const res = await statsApi("?range=24h");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("rejects invalid parameters with 400", async () => {
    const cookie = await adminCookie();
    for (const query of [
      "?range=1y",
      "?tz=abc",
      "?tz=1.5",
      "?tz=900",
      "?tz=-780",
      "?site=..%2Fx",
      "?site=gate:",
      "?site=ABCDEF0123",
    ]) {
      const res = await statsApi(query, cookie);
      expect(res.status, query).toBe(400);
      const body = await res.json();
      expect(typeof body.error).toBe("string");
    }
  });

  it("returns 24 zero-filled hourly buckets with every event key", async () => {
    const cookie = await adminCookie();
    const site = `gate:${uniqueHost()}`;
    const now = Date.now();
    await seed([
      [site, "gate_shown", "", 3, now],
      [site, "gate_shown", "", 1, now - 2 * HOUR_MS],
      [site, "gate_pass_fail", "token_expired", 2, now - HOUR_MS],
      [site, "gate_shown", "", 50, now - 25 * HOUR_MS],
    ]);
    const res = await statsApi(`?range=24h&site=${site}`, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();

    expect(body.range).toBe("24h");
    expect(body.bucket).toBe("hour");
    expect(body.tz).toBe(0);
    expect(body.site).toBe(site);
    expect(body.events).toEqual(STATS_EVENTS);
    expect(Object.keys(body.totals).sort()).toEqual([...STATS_EVENTS].sort());
    expect(body.totals.gate_shown).toBe(4);
    expect(body.totals.gate_pass_fail).toBe(2);
    expect(body.totals.challenge_issued).toBe(0);
    expect(body.reasons).toEqual({
      challenge_issued: {},
      redeem_fail: {},
      siteverify_fail: {},
      gate_pass_fail: { token_expired: 2 },
      rate_limited: {},
    });

    expect(body.series).toHaveLength(24);
    for (const [index, bucket] of body.series.entries()) {
      for (const event of STATS_EVENTS)
        expect(typeof bucket[event]).toBe("number");
      if (index > 0) {
        expect(
          Date.parse(bucket.t) - Date.parse(body.series[index - 1].t),
        ).toBe(HOUR_MS);
      }
    }
    const last = Date.parse(body.series[23].t);
    expect(last).toBeLessThanOrEqual(Date.parse(body.generatedAt));
    expect(last + HOUR_MS).toBeGreaterThan(Date.parse(body.generatedAt));
    expect(body.from).toBe(body.series[0].t);
    expect(Date.parse(body.to)).toBe(last + HOUR_MS);
    expect(body.series[23].gate_shown).toBe(3);
    expect(body.series[21].gate_shown).toBe(1);
    expect(body.series[22].gate_pass_fail).toBe(2);
  });

  it("returns 7 and 30 daily buckets", async () => {
    const cookie = await adminCookie();
    for (const [range, count] of [
      ["7d", 7],
      ["30d", 30],
    ]) {
      const body = await (await statsApi(`?range=${range}`, cookie)).json();
      expect(body.bucket).toBe("day");
      expect(body.series).toHaveLength(count);
      for (const [index, bucket] of body.series.entries()) {
        if (index > 0) {
          expect(
            Date.parse(bucket.t) - Date.parse(body.series[index - 1].t),
          ).toBe(DAY_MS);
        }
        expect(Object.keys(bucket)).toHaveLength(STATS_EVENTS.length + 1);
      }
      // UTC midnight with tz omitted.
      expect(body.series[count - 1].t.endsWith("T00:00:00.000Z")).toBe(true);
    }
  });

  it("puts day boundaries at local midnight for `tz`, rounded to the hour", async () => {
    const cookie = await adminCookie();
    const site = `gate:${uniqueHost()}`;
    const now = Date.now();
    const tzMs = 660 * 60_000;
    // Local (UTC+11) midnight today, as an instant.
    const midnight = Math.floor((now + tzMs) / DAY_MS) * DAY_MS - tzMs;
    await seed([
      [site, "challenge_issued", "", 1, midnight - HOUR_MS],
      [site, "challenge_issued", "", 2, midnight],
    ]);

    // 650 rounds to 660.
    const body = await (
      await statsApi(`?range=7d&tz=650&site=${site}`, cookie)
    ).json();
    expect(body.tz).toBe(660);
    expect(Date.parse(body.series[6].t)).toBe(midnight);
    expect(body.series[6].t.endsWith("T13:00:00.000Z")).toBe(true);
    expect(body.series[5].challenge_issued).toBe(1);
    expect(body.series[6].challenge_issued).toBe(2);

    expect(bucketWindow("7d", -300, Date.UTC(2026, 10, 7, 3)).end).toBe(
      Date.UTC(2026, 10, 7, 5) / 1000,
    );
  });

  it("filters totals by site but keeps every site in bySite", async () => {
    const cookie = await adminCookie();
    const { siteKey } = await createSite("Stats filter blog");
    const host = uniqueHost();
    const now = Date.now();
    await seed([
      [siteKey, "challenge_issued", "", 5, now],
      [siteKey, "redeem_fail", "expired", 1, now],
      [`gate:${host}`, "challenge_issued", "", 7, now],
      [`gate:${host}`, "rate_limited", "challenge", 10, now],
    ]);

    const body = await (
      await statsApi(`?range=24h&site=${siteKey}`, cookie)
    ).json();
    expect(body.totals.challenge_issued).toBe(5);
    expect(body.totals.rate_limited).toBe(0);
    expect(body.reasons.redeem_fail).toEqual({ expired: 1 });
    expect(body.reasons.rate_limited).toEqual({});

    const mine = body.bySite.filter(
      (entry) => entry.site === siteKey || entry.site === `gate:${host}`,
    );
    expect(mine).toEqual([
      expect.objectContaining({
        site: `gate:${host}`,
        label: host,
        kind: "gate",
        challenge_issued: 7,
        rate_limited: 10,
      }),
      expect.objectContaining({
        site: siteKey,
        label: "Stats filter blog",
        kind: "site",
        challenge_issued: 5,
        redeem_fail: 1,
      }),
    ]);
    for (const entry of body.bySite) {
      for (const event of STATS_EVENTS)
        expect(typeof entry[event]).toBe("number");
    }
    const counts = body.bySite.map((entry) => entry.challenge_issued);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));

    await seed([["default", "challenge_issued", "", 1, now]]);
    const all = await (await statsApi("?range=24h", cookie)).json();
    expect(all.site).toBeNull();
    expect(all.bySite.find((entry) => entry.site === "default")).toMatchObject({
      label: "default",
      kind: "default",
    });
  });
});
