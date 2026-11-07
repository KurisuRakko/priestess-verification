import { env } from "cloudflare:test";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../src/config.js";
import { createPassValue, passKey } from "../src/gate.js";
import {
  forgetGateHosts,
  GATE_CACHE_TTL_MS,
  GATE_RETRY_MS,
  gatePolicy,
  isExemptPath,
  loadAdminGateHosts,
  selfHosts,
  validateExemptPaths,
} from "../src/gate-hosts.js";
import worker from "../src/index.js";

const ORIGIN = "https://verify.rakko.cn";
const ADMIN_SUB = "plu_UUHsG7WuUqDXh4R6";
const UA = "Mozilla/5.0 (gate-hosts-test) Chrome/140.0";
const HTML_ACCEPT = "text/html,application/xhtml+xml,*/*;q=0.8";
const UPSTREAMS = JSON.stringify({ "cfg.example": "https://cfg-origin.example" });

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function registry() {
  return env.SITE_REGISTRY.getByName("registry");
}

/** Calls the Worker module in this isolate, so it shares the gate host cache. */
function callWorker(url, init = {}, extraEnv = {}) {
  return worker.fetch(new Request(url, init), { ...env, ...extraEnv });
}

async function adminCookie() {
  const id = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await registry().createSession(
    sha256(id),
    ADMIN_SUB,
    { name: "Rakko", email: null },
    Date.now() + 60_000,
  );
  return `__Host-pv_admin=${id}`;
}

async function gateApi(
  path,
  { method = "GET", body, cookie, extraEnv = {} } = {},
) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (method !== "GET") {
    headers["content-type"] = "application/json";
    headers.Origin = ORIGIN;
  }
  return callWorker(
    `${ORIGIN}/admin/api/gate${path}`,
    {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    },
    extraEnv,
  );
}

let counter = 0;
/** A host no other test has used, so registry rows never collide. */
function freshHost() {
  counter += 1;
  return `h${counter}-${Date.now().toString(36)}.example`;
}

async function passCookie(host) {
  const key = await passKey(readConfig(env));
  const exp = Math.floor(Date.now() / 1000) + 600;
  return `__pv_pass=${await createPassValue(key, `h:${host}`, UA, exp)}`;
}

/** An env whose SITE_REGISTRY counts `getByName` calls (each one = a DO stub). */
function countingEnv() {
  const calls = { n: 0 };
  const real = env.SITE_REGISTRY;
  const binding = {
    getByName(name) {
      calls.n += 1;
      return real.getByName(name);
    },
  };
  return { calls, extraEnv: { SITE_REGISTRY: binding } };
}

beforeEach(() => forgetGateHosts());
afterEach(() => {
  vi.unstubAllGlobals();
  forgetGateHosts();
});

describe("gate hosts: exempt path matching", () => {
  it("matches prefixes, exact paths and parent segments", () => {
    const paths = ["/api/", "/robots.txt"];
    expect(isExemptPath(paths, "/api/")).toBe(true);
    expect(isExemptPath(paths, "/api/v1/items")).toBe(true);
    expect(isExemptPath(paths, "/api")).toBe(false);
    expect(isExemptPath(paths, "/apix")).toBe(false);
    expect(isExemptPath(paths, "/robots.txt")).toBe(true);
    expect(isExemptPath(paths, "/robots.txt/x")).toBe(true);
    expect(isExemptPath(paths, "/robots.txtx")).toBe(false);
    expect(isExemptPath(paths, "/")).toBe(false);
    expect(isExemptPath([], "/api/")).toBe(false);
  });

  it("never matches a path with an encoded separator", () => {
    expect(isExemptPath(["/api/"], "/api/..%2Fadmin")).toBe(false);
    expect(isExemptPath(["/api/"], "/api/%2e%2e/admin")).toBe(false);
    expect(isExemptPath(["/api/"], "/api/a%5Cb")).toBe(false);
  });
});

describe("gate hosts: validation helpers", () => {
  it("deduplicates exempt paths", () => {
    expect(validateExemptPaths(undefined)).toEqual([]);
    expect(validateExemptPaths(["/a", "/b/", "/a"])).toEqual(["/a", "/b/"]);
    expect(validateExemptPaths(Array(60).fill("/same"))).toEqual(["/same"]);
  });

  it("derives selfHosts from ALLOWED_ORIGINS minus configured gate hosts", () => {
    const config = readConfig({
      ALLOWED_ORIGINS: "https://verify.rakko.cn,https://cfg.example",
      GATE_UPSTREAMS: UPSTREAMS,
    });
    expect([...selfHosts(config)]).toEqual(["verify.rakko.cn"]);
  });
});

describe("gate hosts: per-isolate cache", () => {
  function fakeRegistry(list) {
    const calls = { n: 0 };
    const registryFn = () => {
      calls.n += 1;
      return { listGateHosts: async () => list };
    };
    return { calls, registryFn };
  }
  const row = {
    host: "cached.example",
    upstream: "https://o.example",
    exemptPaths: [],
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  };

  it("serves hits from memory and reloads after the TTL", async () => {
    const { calls, registryFn } = fakeRegistry([row]);
    const now = 1_000_000;
    expect((await loadAdminGateHosts(registryFn, now)).has("cached.example")).toBe(true);
    await loadAdminGateHosts(registryFn, now + GATE_CACHE_TTL_MS - 1);
    expect(calls.n).toBe(1);
    await loadAdminGateHosts(registryFn, now + GATE_CACHE_TTL_MS);
    expect(calls.n).toBe(2);
    forgetGateHosts();
    await loadAdminGateHosts(registryFn, now + GATE_CACHE_TTL_MS + 1);
    expect(calls.n).toBe(3);
  });

  it("keeps serving the last snapshot while the registry fails", async () => {
    const { calls, registryFn } = fakeRegistry([row]);
    const now = 2_000_000;
    await loadAdminGateHosts(registryFn, now);
    const failing = () => {
      calls.n += 1;
      return {
        listGateHosts: async () => {
          throw new Error("registry down");
        },
      };
    };
    const later = now + GATE_CACHE_TTL_MS;
    expect((await loadAdminGateHosts(failing, later)).has("cached.example")).toBe(true);
    expect(calls.n).toBe(2);
    // Retried only after GATE_RETRY_MS, not on every request.
    await loadAdminGateHosts(failing, later + GATE_RETRY_MS - 1);
    expect(calls.n).toBe(2);
    await loadAdminGateHosts(failing, later + GATE_RETRY_MS);
    expect(calls.n).toBe(3);
  });

  it("fails when the registry is down and nothing was loaded yet", async () => {
    const failing = () => ({
      listGateHosts: async () => {
        throw new Error("registry down");
      },
    });
    await expect(loadAdminGateHosts(failing, 1)).rejects.toThrow("registry down");
  });

  it("shares one registry read between concurrent misses", async () => {
    const { calls, registryFn } = fakeRegistry([row]);
    await Promise.all(
      Array.from({ length: 10 }, () => loadAdminGateHosts(registryFn, 5)),
    );
    expect(calls.n).toBe(1);
  });

  it("never reads the registry for self or configured hosts", async () => {
    const { calls, registryFn } = fakeRegistry([row]);
    const config = readConfig({ GATE_UPSTREAMS: UPSTREAMS });
    expect(await gatePolicy(config, "verify.rakko.cn", registryFn)).toBeNull();
    const configured = await gatePolicy(config, "cfg.example", registryFn);
    expect(configured).toMatchObject({
      upstream: "https://cfg-origin.example",
      enabled: true,
      source: "config",
    });
    expect(calls.n).toBe(0);
    expect(await gatePolicy(config, "cached.example", registryFn)).toMatchObject({
      source: "admin",
    });
    expect(await gatePolicy(config, "other.example", registryFn)).toBeNull();
    expect(calls.n).toBe(1);
  });
});

describe("gate hosts: admin API", () => {
  it("requires a session", async () => {
    for (const [path, method] of [
      ["", "GET"],
      ["", "POST"],
      ["/x.example", "PATCH"],
      ["/x.example", "DELETE"],
    ]) {
      const res = await gateApi(path, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthenticated" });
    }
  });

  it("creates, lists, updates and deletes a host", async () => {
    const cookie = await adminCookie();
    const host = freshHost();
    const created = await gateApi("", {
      method: "POST",
      cookie,
      body: {
        host: host.toUpperCase(),
        upstream: "https://origin.example/",
        exemptPaths: ["/api/", "/robots.txt", "/api/"],
      },
    });
    expect(created.status).toBe(201);
    const { host: entry } = await created.json();
    expect(entry).toMatchObject({
      host,
      upstream: "https://origin.example",
      exemptPaths: ["/api/", "/robots.txt"],
      enabled: true,
      source: "admin",
    });
    expect(entry.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(entry.updatedAt).toBe(entry.createdAt);

    const listed = await gateApi("", { cookie, extraEnv: { GATE_UPSTREAMS: UPSTREAMS } });
    expect(listed.status).toBe(200);
    const list = await listed.json();
    expect(list.selfHosts).toEqual(["verify.rakko.cn"]);
    expect(list.hosts[0]).toEqual({
      host: "cfg.example",
      upstream: "https://cfg-origin.example",
      exemptPaths: [],
      enabled: true,
      source: "config",
      createdAt: null,
      updatedAt: null,
    });
    expect(list.hosts.find((h) => h.host === host)).toEqual(entry);

    const patched = await gateApi(`/${host}`, {
      method: "PATCH",
      cookie,
      body: { enabled: false, exemptPaths: [] },
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).host).toMatchObject({
      host,
      upstream: "https://origin.example",
      exemptPaths: [],
      enabled: false,
      source: "admin",
    });

    const deleted = await gateApi(`/${host}`, { method: "DELETE", cookie });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    const after = await (await gateApi("", { cookie })).json();
    expect(after.hosts.some((h) => h.host === host)).toBe(false);
  });

  it("answers 404 for unknown hosts", async () => {
    const cookie = await adminCookie();
    const host = freshHost();
    const patched = await gateApi(`/${host}`, {
      method: "PATCH",
      cookie,
      body: { enabled: false },
    });
    expect(patched.status).toBe(404);
    expect(await patched.json()).toEqual({ error: "host not found" });
    const deleted = await gateApi(`/${host}`, { method: "DELETE", cookie });
    expect(deleted.status).toBe(404);
  });

  it("answers 409 for duplicates and configured hosts", async () => {
    const cookie = await adminCookie();
    const host = freshHost();
    const body = { host, upstream: "https://origin.example" };
    expect((await gateApi("", { method: "POST", cookie, body })).status).toBe(201);
    const dup = await gateApi("", { method: "POST", cookie, body });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "host already exists" });

    const extraEnv = { GATE_UPSTREAMS: UPSTREAMS };
    for (const [path, method, reqBody] of [
      ["", "POST", { host: "cfg.example", upstream: "https://o.example" }],
      ["/cfg.example", "PATCH", { enabled: false }],
      ["/cfg.example", "DELETE", undefined],
    ]) {
      const res = await gateApi(path, { method, cookie, body: reqBody, extraEnv });
      expect(res.status, `${method} ${path}`).toBe(409);
      expect((await res.json()).error).toMatch(/deployment configuration/);
    }
  });

  it("rejects invalid input with 400", async () => {
    const cookie = await adminCookie();
    const host = freshHost();
    const ok = { host, upstream: "https://origin.example" };
    const cases = [
      [{ ...ok, host: undefined }, /host/],
      [{ ...ok, host: "example.com:8443" }, /host/],
      [{ ...ok, host: "https://example.com" }, /host/],
      [{ ...ok, host: "example.com/path" }, /host/],
      [{ ...ok, host: "verify.rakko.cn" }, /own host/],
      [{ ...ok, upstream: undefined }, /upstream/],
      [{ ...ok, upstream: "not a url" }, /not a URL/],
      [{ ...ok, upstream: "http://origin.example" }, /https/],
      [{ ...ok, upstream: "https://origin.example/app" }, /bare origin/],
      [{ ...ok, upstream: `https://${host}` }, /host itself/],
      [{ ...ok, exemptPaths: "/api/" }, /list/],
      [{ ...ok, exemptPaths: ["api/"] }, /starting with \//],
      [{ ...ok, exemptPaths: [42] }, /starting with \//],
      [{ ...ok, exemptPaths: [`/${"a".repeat(256)}`] }, /256/],
      [{ ...ok, exemptPaths: ["/a?b"] }, /must not contain/],
      [{ ...ok, exemptPaths: ["/a#b"] }, /must not contain/],
      [{ ...ok, exemptPaths: ["/a/../b"] }, /must not contain/],
      [{ ...ok, exemptPaths: ["/a b"] }, /must not contain/],
      [{ ...ok, exemptPaths: ["/a\tb"] }, /must not contain/],
      [{ ...ok, exemptPaths: ["/"] }, /must not be \//],
      [{ ...ok, exemptPaths: ["/__gate/widget.js"] }, /__gate/],
      [
        { ...ok, exemptPaths: Array.from({ length: 51 }, (_, i) => `/p${i}`) },
        /at most 50/,
      ],
      [{ ...ok, enabled: "yes" }, /enabled/],
    ];
    for (const [body, why] of cases) {
      const res = await gateApi("", { method: "POST", cookie, body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error, JSON.stringify(body)).toMatch(why);
    }
    const notJson = await callWorker(`${ORIGIN}/admin/api/gate`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: ORIGIN, "content-type": "application/json" },
      body: "{nope",
    });
    expect(notJson.status).toBe(400);
    // Nothing was created by any of the rejected requests.
    const list = await (await gateApi("", { cookie })).json();
    expect(list.hosts.some((h) => h.host === host)).toBe(false);

    expect((await gateApi("", { method: "POST", cookie, body: ok })).status).toBe(201);
    for (const [body, why] of [
      [{ upstream: "http://origin.example" }, /https/],
      [{ exemptPaths: ["/"] }, /must not be \//],
      [{ enabled: 1 }, /enabled/],
    ]) {
      const res = await gateApi(`/${host}`, { method: "PATCH", cookie, body });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error).toMatch(why);
    }
  });
});

describe("gate hosts: request handling", () => {
  async function addHost(body) {
    const cookie = await adminCookie();
    const res = await gateApi("", { method: "POST", cookie, body });
    expect(res.status).toBe(201);
    return cookie;
  }

  it("gates an admin host and proxies exempt paths and passes", async () => {
    const host = freshHost();
    await addHost({
      host,
      upstream: "https://admin-origin.example",
      exemptPaths: ["/api/", "/robots.txt"],
    });
    const upstream = vi.fn(async () => new Response("from origin"));
    vi.stubGlobal("fetch", upstream);

    const gated = await callWorker(`https://${host}/`, {
      headers: { Accept: HTML_ACCEPT, "User-Agent": UA },
    });
    expect(gated.status).toBe(403);
    expect(await gated.text()).toContain(`id="gate-title">${host}</h1>`);
    for (const path of ["/robots.txtx", "/api", "/api/..%2Fadmin"]) {
      const res = await callWorker(`https://${host}${path}`);
      expect(res.status, path).toBe(403);
    }
    expect(upstream).not.toHaveBeenCalled();

    for (const path of ["/api/items?q=1", "/robots.txt", "/robots.txt/x"]) {
      const res = await callWorker(`https://${host}${path}`, {
        headers: { Cookie: "session=abc; __pv_pass=forged" },
      });
      expect(res.status, path).toBe(200);
      expect(await res.text()).toBe("from origin");
    }
    expect(upstream).toHaveBeenCalledTimes(3);
    const [target, init] = upstream.mock.calls[0];
    expect(String(target)).toBe("https://admin-origin.example/api/items?q=1");
    // Exempt requests still go through proxyToUpstream's header handling.
    expect(new Headers(init.headers).get("Cookie")).toBe("session=abc");
    expect(new Headers(init.headers).get("X-Forwarded-Host")).toBe(host);

    const passed = await callWorker(`https://${host}/private`, {
      headers: { "User-Agent": UA, Cookie: await passCookie(host) },
    });
    expect(passed.status).toBe(200);
    expect(String(upstream.mock.calls[3][0])).toBe("https://admin-origin.example/private");
  });

  it("proxies every request of a disabled host", async () => {
    const host = freshHost();
    await addHost({ host, upstream: "https://off-origin.example", enabled: false });
    const upstream = vi.fn(async () => new Response("open"));
    vi.stubGlobal("fetch", upstream);
    const res = await callWorker(`https://${host}/anything`, {
      headers: { Accept: HTML_ACCEPT },
    });
    expect(res.status).toBe(200);
    expect(String(upstream.mock.calls[0][0])).toBe("https://off-origin.example/anything");
    // The gate's own routes stay with the Worker.
    const widget = await callWorker(`https://${host}/__gate/widget.js`);
    expect(widget.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("applies admin changes in this isolate at once", async () => {
    const host = freshHost();
    const cookie = await addHost({ host, upstream: "https://chg-origin.example" });
    const upstream = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", upstream);
    expect((await callWorker(`https://${host}/`)).status).toBe(403);
    const patched = await gateApi(`/${host}`, {
      method: "PATCH",
      cookie,
      body: { enabled: false },
    });
    expect(patched.status).toBe(200);
    expect((await callWorker(`https://${host}/`)).status).toBe(200);
    await gateApi(`/${host}`, { method: "DELETE", cookie });
    // No longer a gate host: the regular routes answer (404 for `/x`).
    const res = await callWorker(`https://${host}/x`);
    expect(res.status).toBe(404);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("does not touch the registry for self hosts and cache hits", async () => {
    const { calls, extraEnv } = countingEnv();
    for (const path of ["/", "/protected", "/widget.js", "/x"]) {
      await callWorker(`${ORIGIN}${path}`, {}, extraEnv);
    }
    expect(calls.n).toBe(0);

    await callWorker("https://unknown-a.example/x", {}, extraEnv);
    expect(calls.n).toBe(1);
    for (const host of ["unknown-a.example", "unknown-b.example"]) {
      await callWorker(`https://${host}/x`, {}, extraEnv);
    }
    expect(calls.n).toBe(1);
  });

  it("reloads the snapshot once it expires", async () => {
    const { calls, extraEnv } = countingEnv();
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    await callWorker("https://expiry.example/x", {}, extraEnv);
    now.mockReturnValue(start + GATE_CACHE_TTL_MS - 1);
    await callWorker("https://expiry.example/x", {}, extraEnv);
    expect(calls.n).toBe(1);
    now.mockReturnValue(start + GATE_CACHE_TTL_MS);
    await callWorker("https://expiry.example/x", {}, extraEnv);
    expect(calls.n).toBe(2);
    now.mockRestore();
  });
});
