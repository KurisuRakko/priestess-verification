import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import capMinJs from "../../widget/src/cap.min.js?raw";
import gateClientJs from "../src/generated/gate.client.js?raw";
import { solveChallengeResponse } from "../scripts/solve.js";
import { parseCookieDomain, parseGateUpstreams, readConfig } from "../src/config.js";
import {
  createPassValue,
  passKey,
  safeReturnPath,
  stripPassCookie,
} from "../src/gate.js";
import worker from "../src/index.js";
import { fill, formatTtl } from "../web/src/gate/common.ts";
import { flattenSteps, nextStatusStep } from "../web/src/gate/status-steps.ts";
import { STRINGS } from "../web/src/gate/strings.ts";

const ORIGIN = "https://verify.rakko.cn";
const UA = "Mozilla/5.0 (gate-test) Chrome/140.0";
const HTML_ACCEPT = "text/html,application/xhtml+xml,*/*;q=0.8";
const UPSTREAMS = JSON.stringify({ "app.example": "https://origin.example" });

function at(origin, path, init = {}) {
  return SELF.fetch(`${origin}${path}`, init);
}

function postJson(origin, path, body, headers = {}) {
  return at(origin, path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** Runs the widget flow against `challengePath`/`redeemPath`, returns the token. */
async function mintToken(base = "/__gate/", origin = ORIGIN) {
  const challengeRes = await at(origin, `${base}challenge`, { method: "POST" });
  expect(challengeRes.status).toBe(200);
  const challenge = await challengeRes.json();
  const solutions = await solveChallengeResponse(challenge);
  const redeemRes = await postJson(origin, `${base}redeem`, {
    token: challenge.token,
    solutions,
    instr_blocked: true,
  });
  expect(redeemRes.status).toBe(200);
  const redeem = await redeemRes.json();
  expect(redeem.success).toBe(true);
  return redeem.token;
}

function pass(token, { origin = ORIGIN, ret = "/protected", ua = UA } = {}) {
  return postJson(
    origin,
    "/__gate/pass",
    { token, return: ret },
    { Origin: origin, "User-Agent": ua },
  );
}

/** The page's `#page-config` JSON block, parsed. */
function pageConfig(html) {
  const match = /<script type="application\/json" id="page-config">([^<]*)<\/script>/.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse(match[1]);
}

/** `name=value` of the `__pv_pass` Set-Cookie. */
function cookiePair(res) {
  const header = res.headers.get("set-cookie") ?? "";
  return header.split(";")[0];
}

async function passCookieFor(options = {}) {
  const res = await pass(await mintToken("/__gate/", options.origin), options);
  expect(res.status).toBe(200);
  return cookiePair(res);
}

function getProtected(cookie, { origin = ORIGIN, ua = UA, path = "/protected" } = {}) {
  return at(origin, path, {
    headers: {
      Accept: HTML_ACCEPT,
      "User-Agent": ua,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
}

/** Calls the Worker module directly, so `env` overrides and a stubbed fetch apply. */
function callWorker(url, init = {}, extraEnv = {}) {
  return worker.fetch(new Request(url, init), { ...env, ...extraEnv });
}

describe("gate: without a pass", () => {
  it("answers /protected with the 403 challenge page", async () => {
    const res = await getProtected(null, { path: "/protected/deep?x=1" });
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("vary")).toContain("Cookie");
    const ray = res.headers.get("x-gate-ray");
    expect(ray).toMatch(/^[0-9a-f]{16}$/);
    const csp = res.headers.get("content-security-policy");
    const nonce = /'nonce-([^']+)'/.exec(csp)[1];
    expect(csp).toContain("frame-ancestors 'none'");

    const html = await res.text();
    expect(html).toContain(`<code>${ray}</code>`);
    expect(html).toContain('id="gate-ray-copy"');
    expect(html).toContain('<h1 class="pv-gate__title" id="gate-title">verify.rakko.cn</h1>');
    expect(html).toContain("Session ID: <code>");
    expect(html).toContain("Powered by <a ");
    expect(html).toContain("Verifying you are human. This may take a few seconds.");
    expect(html).toContain(
      "verify.rakko.cn needs to review the security of your connection before proceeding.",
    );
    // No pass lifetime on the challenge any more.
    expect(html).not.toContain("30 minutes");
    // The subtitle sits right under the host; the mascot is the status mark,
    // in her checking pose from the first frame, with no ring and no bar.
    expect(html).toMatch(
      /id="gate-title">verify\.rakko\.cn<\/h1>\s*<p class="pv-gate__subtitle">/,
    );
    expect(html).toContain('<span class="pv-gate__mascot" data-pose="checking" aria-hidden="true">');
    for (const pose of ["checking", "done", "error"]) {
      expect(html).toContain(`src="/__gate/mascot/${pose}.webp"`);
    }
    expect(html).toContain('<div class="pv-gate__engine" aria-hidden="true" inert=""></div>');
    expect(html).not.toContain("pv-gate__ring");
    expect(html).not.toContain('class="rk-progress');
    expect(html).not.toContain('class="pv-gate__card');
    expect(html).toContain("<noscript>");
    expect(html).toMatch(
      /<script nonce="[^"]+" src="\/__gate\/widget\.js\?v=[0-9a-f]{12}"><\/script>/,
    );
    expect(html).toMatch(/window\.CAP_CUSTOM_WASM_URL = "\/__gate\/cap_wasm_bg\.wasm\?v=/);
    expect(html).toMatch(/window\.CAP_PAKO_URL = "\/__gate\/pako_inflate\.min\.js\?v=/);
    expect(html).toContain(`window.CAP_SCRIPT_NONCE = "${nonce}"`);
    const config = pageConfig(html);
    expect(config).toEqual({
      view: "challenge",
      host: "verify.rakko.cn",
      ray,
      lang: "en",
      endpoint: "/__gate/",
      passTtlS: 1800,
    });
    // Every executable inline script carries the nonce.
    // (The inlined bundle itself is left out: React's minified source holds a
    // harmless "<script>" string literal.)
    const markup = html.replace(gateClientJs.trim(), "");
    for (const tag of markup.match(/<script(?![^>]*application\/json)[^>]*>/g)) {
      expect(tag).toContain(`nonce="${nonce}"`);
    }
    expect(html).toContain(gateClientJs.trim());
    // The bundle follows the widget script, so <cap-widget> is defined when
    // React mounts; the theme follows the OS from the first frame.
    expect(html.indexOf(gateClientJs.trim())).toBeGreaterThan(html.indexOf("/__gate/widget.js?v="));
    expect(html).toContain('matchMedia("(prefers-color-scheme: dark)")');
    expect(html).toContain('<style data-app="gate">');
    expect(html).not.toContain("/design/");
    expect(html).not.toContain("cdn.jsdelivr.net");
    expect(html).not.toContain(env.SITEVERIFY_SECRET);
  });

  it("follows Accept-Language", async () => {
    const zh = await at(ORIGIN, "/protected", {
      headers: { Accept: HTML_ACCEPT, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
    });
    const zhHtml = await zh.text();
    expect(zhHtml).toContain("正在验证您是否为真人，这可能需要几秒钟时间。");
    expect(zhHtml).toContain("verify.rakko.cn 需要先确认您的连接安全，然后才能继续。");
    expect(zhHtml).not.toContain("访问凭证在");
    expect(zhHtml).toContain("会话 ID： <code>");
    // The product line stays in English on the Chinese page.
    expect(zhHtml).toContain("Powered by <a ");
    expect(zhHtml).toContain("<title>安全验证 · verify.rakko.cn</title>");
    expect(zhHtml).toContain('<html lang="zh-CN"');
    expect(pageConfig(zhHtml).lang).toBe("zh");
    const en = await at(ORIGIN, "/protected", {
      headers: { Accept: HTML_ACCEPT, "Accept-Language": "en-US,zh;q=0.5" },
    });
    const enHtml = await en.text();
    expect(enHtml).toContain("no action is needed and no data is collected");
    expect(enHtml).toContain("<title>Security verification · verify.rakko.cn</title>");
  });

  it("answers non-HTML requests with 403 JSON", async () => {
    const res = await at(ORIGIN, "/protected", { headers: { Accept: "application/json" } });
    expect(res.status).toBe(403);
    expect(res.headers.get("x-gate-ray")).toMatch(/^[0-9a-f]{16}$/);
    expect(await res.json()).toEqual({ success: false, error: "gate_required" });

    const post = await at(ORIGIN, "/protected/form", {
      method: "POST",
      headers: { Accept: HTML_ACCEPT },
      body: "a=1",
    });
    expect(post.status).toBe(403);
    expect(await post.json()).toEqual({ success: false, error: "gate_required" });
  });

  it("answers HEAD with a bodiless 403", async () => {
    const res = await at(ORIGIN, "/protected", {
      method: "HEAD",
      headers: { Accept: HTML_ACCEPT },
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("");
  });

  it("leaves the rest of the Worker's own host alone", async () => {
    expect((await at(ORIGIN, "/")).status).toBe(200);
    expect((await at(ORIGIN, "/protectedx", { headers: { Accept: HTML_ACCEPT } })).status).toBe(404);
  });
});

describe("gate: /__gate/ assets", () => {
  it("serves the widget and the mascot art under /__gate/", async () => {
    const widget = await at(ORIGIN, "/__gate/widget.js");
    expect(widget.status).toBe(200);
    expect(await widget.text()).toBe(capMinJs);
    for (const art of ["checking", "error", "done"]) {
      const res = await at(ORIGIN, `/__gate/mascot/${art}.webp`);
      expect(res.status, art).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
    }
    for (const path of ["/__gate/cap_wasm_bg.wasm", "/__gate/pako_inflate.min.js"]) {
      expect((await at(ORIGIN, path)).status, path).toBe(200);
    }
    // The ripple runtime is bundled into the page now.
    expect((await at(ORIGIN, "/__gate/design/ripple.js")).status).toBe(404);
    expect((await at(ORIGIN, "/__gate/nope.js")).status).toBe(404);
  });
});

describe("gate: /__gate/pass", () => {
  it("trades a gate token for a pass cookie that unlocks /protected", async () => {
    const token = await mintToken();
    const res = await pass(token, { ret: "/protected/deep?x=1#frag" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, redirect: "/protected/deep?x=1#frag" });
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toMatch(/^__pv_pass=1\.\d+\.[A-Za-z0-9_-]{43}; /);
    expect(setCookie).toContain("Max-Age=1800");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Domain=");

    const page = await getProtected(`theme=dark; ${cookiePair(res)}`, { path: "/protected/deep" });
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
    const html = await page.text();
    expect(html).toContain('data-gate-view="passed"');
    const config = pageConfig(html);
    expect(config.view).toBe("passed");
    expect(config.endpoint).toBe("/__gate/");
    expect(Number.isInteger(config.expiresAt)).toBe(true);
    expect(config.passTtlS).toBe(1800);
    expect(config.passDomain).toBeNull();
    expect(html).toContain("valid for 30 minutes.");
    expect(html).toContain("and applies to verify.rakko.cn.");
    expect(html).toContain(`<code>${page.headers.get("x-gate-ray")}</code>`);
    expect(html).toContain('id="gate-ray-copy"');
    // No widget on the example page.
    expect(html).not.toContain("/__gate/widget.js");
  });

  it("accepts each token once", async () => {
    const token = await mintToken();
    expect((await pass(token)).status).toBe(200);
    const again = await pass(token);
    expect(again.status).toBe(404);
    expect((await again.json()).ok).toBe(false);
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("never accepts site or demo tokens", async () => {
    for (const base of ["/", "/demo/"]) {
      const res = await pass(await mintToken(base));
      expect(res.status, base).toBe(404);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("keeps gate tokens out of the other scopes", async () => {
    const challenge = await (await at(ORIGIN, "/__gate/challenge", { method: "POST" })).json();
    const solutions = await solveChallengeResponse(challenge);
    const redeem = await postJson(ORIGIN, "/redeem", {
      token: challenge.token,
      solutions,
      instr_blocked: true,
    });
    expect(redeem.status).toBe(403);
    expect((await redeem.json()).reason).toBe("scope_mismatch");

    const token = await mintToken();
    const verify = await postJson(ORIGIN, "/siteverify", {
      secret: env.SITEVERIFY_SECRET,
      response: token,
    });
    expect(verify.status).toBe(404);
    const demoVerify = await postJson(ORIGIN, "/demo/siteverify", { response: token }, { Origin: ORIGIN });
    expect(demoVerify.status).toBe(404);
    // ...and the token is still good for the gate.
    expect((await pass(token)).status).toBe(200);
  });

  it("rejects cross-origin and malformed calls", async () => {
    const token = await mintToken();
    const cross = await postJson(
      ORIGIN,
      "/__gate/pass",
      { token, return: "/" },
      { Origin: "https://evil.example" },
    );
    expect(cross.status).toBe(403);
    const noOrigin = await postJson(ORIGIN, "/__gate/pass", { token });
    expect(noOrigin.status).toBe(403);
    expect((await postJson(ORIGIN, "/__gate/pass", {}, { Origin: ORIGIN })).status).toBe(400);
    // The rejected calls did not consume the token.
    expect((await pass(token)).status).toBe(200);
  });

  it("is not an open redirect", async () => {
    for (const ret of [
      "//evil.example/x",
      "/\\evil.example",
      "https://evil.example/",
      "javascript:alert(1)",
      "evil",
      "/\t/evil.example",
      "",
      42,
    ]) {
      expect(safeReturnPath(ret, ORIGIN), String(ret)).toBe("/");
    }
    expect(safeReturnPath("/a/b?c=d#e", ORIGIN)).toBe("/a/b?c=d#e");

    const res = await pass(await mintToken(), { ret: "//evil.example/" });
    expect(res.status).toBe(200);
    expect((await res.json()).redirect).toBe("/");
  });
});

describe("gate: pass validation", () => {
  async function key(extraEnv = {}) {
    return passKey(readConfig({ ...env, ...extraEnv }));
  }

  it("rejects a tampered signature", async () => {
    const cookie = await passCookieFor();
    const last = cookie.at(-1) === "A" ? "B" : "A";
    expect((await getProtected(cookie.slice(0, -1) + last)).status).toBe(403);
    expect((await getProtected(cookie.replace(/=1\.(\d+)/, (_, e) => `=1.${Number(e) + 60}`))).status).toBe(403);
    expect((await getProtected("__pv_pass=garbage")).status).toBe(403);
  });

  it("rejects an expired pass", async () => {
    const past = Math.floor(Date.now() / 1000) - 5;
    const value = await createPassValue(await key(), "h:verify.rakko.cn", UA, past);
    expect((await getProtected(`__pv_pass=${value}`)).status).toBe(403);
    const future = Math.floor(Date.now() / 1000) + 600;
    const fresh = await createPassValue(await key(), "h:verify.rakko.cn", UA, future);
    expect((await getProtected(`__pv_pass=${fresh}`)).status).toBe(200);
  });

  it("rejects a pass presented with another User-Agent", async () => {
    const cookie = await passCookieFor();
    expect((await getProtected(cookie)).status).toBe(200);
    expect((await getProtected(cookie, { ua: `${UA} other` })).status).toBe(403);
  });

  it("rejects a pass presented on another host", async () => {
    const cookie = await passCookieFor();
    expect((await getProtected(cookie, { origin: "https://other.rakko.cn" })).status).toBe(403);
  });

  it("does not cross subdomains without GATE_COOKIE_DOMAIN", async () => {
    const k = await key();
    const exp = Math.floor(Date.now() / 1000) + 600;
    const value = await createPassValue(k, "h:a.rakko.cn", UA, exp);
    const headers = { Accept: HTML_ACCEPT, "User-Agent": UA, Cookie: `__pv_pass=${value}` };
    expect((await callWorker("https://a.rakko.cn/protected", { headers })).status).toBe(200);
    expect((await callWorker("https://b.rakko.cn/protected", { headers })).status).toBe(403);
  });

  it("rejects a pass signed with another key", async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const other = await key({ GATE_COOKIE_SECRET: "some-other-gate-secret-0123456789" });
    const value = await createPassValue(other, "h:verify.rakko.cn", UA, exp);
    expect((await getProtected(`__pv_pass=${value}`)).status).toBe(403);
  });
});

describe("gate: GATE_COOKIE_DOMAIN", () => {
  const DOMAIN_ENV = { GATE_COOKIE_DOMAIN: ".rakko.cn" };

  async function domainPass(host) {
    const origin = `https://${host}`;
    const token = await mintToken("/__gate/", origin);
    return callWorker(
      `${origin}/__gate/pass`,
      {
        method: "POST",
        headers: { "content-type": "application/json", Origin: origin, "User-Agent": UA },
        body: JSON.stringify({ token, return: "/protected" }),
      },
      DOMAIN_ENV,
    );
  }

  function getWithDomain(host, cookie) {
    return callWorker(
      `https://${host}/protected`,
      { headers: { Accept: HTML_ACCEPT, "User-Agent": UA, Cookie: cookie } },
      DOMAIN_ENV,
    );
  }

  it("normalises and validates the domain", () => {
    expect(parseCookieDomain(".Rakko.CN")).toBe("rakko.cn");
    expect(parseCookieDomain("rakko.cn")).toBe("rakko.cn");
    expect(parseCookieDomain("")).toBe("");
    expect(parseCookieDomain(undefined)).toBe("");
    for (const bad of ["cn", "https://rakko.cn", "rakko.cn/x", "a b.cn", "-x.cn", "1.2.3.4", "*.rakko.cn"]) {
      expect(() => parseCookieDomain(bad), bad).toThrow(/GATE_COOKIE_DOMAIN/);
    }
  });

  it("lets a pass from a.rakko.cn through on b.rakko.cn, and nowhere else", async () => {
    const res = await domainPass("a.rakko.cn");
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("; Domain=rakko.cn;");
    const cookie = cookiePair(res);

    const page = await getWithDomain("a.rakko.cn", cookie);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(pageConfig(html).passDomain).toBe("rakko.cn");
    expect(html).toContain("applies to rakko.cn and its subdomains.");
    expect((await getWithDomain("b.rakko.cn", cookie)).status).toBe(200);
    expect((await getWithDomain("rakko.cn", cookie)).status).toBe(200);
    const outside = await getWithDomain("evil-rakko.cn", cookie);
    expect(outside.status).toBe(403);
    // The challenge states the lifetime only, not the scope.
    expect(pageConfig(await outside.text())).not.toHaveProperty("passDomain");
    expect((await getWithDomain("rakko.cn.evil.com", cookie)).status).toBe(403);
    // Without the var the same cookie is a domain pass on a host-only Worker.
    const headers = { Accept: HTML_ACCEPT, "User-Agent": UA, Cookie: cookie };
    expect((await callWorker("https://a.rakko.cn/protected", { headers })).status).toBe(403);
  });

  it("clears the cookie on the same Domain", async () => {
    const res = await callWorker(
      "https://a.rakko.cn/__gate/logout",
      { method: "POST", headers: { Origin: "https://a.rakko.cn" } },
      DOMAIN_ENV,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("__pv_pass=; Max-Age=0; Domain=rakko.cn;");
  });
});

describe("gate: /__gate/logout", () => {
  it("clears the pass, same-origin only", async () => {
    const res = await at(ORIGIN, "/__gate/logout", { method: "POST", headers: { Origin: ORIGIN } });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toMatch(/^__pv_pass=; Max-Age=0; Path=\//);
    expect(setCookie).not.toContain("Domain=");
    const cross = await at(ORIGIN, "/__gate/logout", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(cross.status).toBe(403);
  });
});

describe("gate: GATE_UPSTREAMS reverse proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function upstreamCookie() {
    const k = await passKey(readConfig({ ...env, GATE_UPSTREAMS: UPSTREAMS }));
    const exp = Math.floor(Date.now() / 1000) + 600;
    return `__pv_pass=${await createPassValue(k, "h:app.example", UA, exp)}`;
  }

  it("gates the whole upstream host", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const res = await callWorker(
      "https://app.example/",
      { headers: { Accept: HTML_ACCEPT, "User-Agent": UA } },
      { GATE_UPSTREAMS: UPSTREAMS },
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('id="gate-title">app.example</h1>');
    const api = await callWorker(
      "https://app.example/api/data",
      { method: "OPTIONS" },
      { GATE_UPSTREAMS: UPSTREAMS },
    );
    expect(api.status).toBe(403);
    // The gate's own assets are served by the Worker, never proxied.
    const widget = await callWorker("https://app.example/__gate/widget.js", {}, { GATE_UPSTREAMS: UPSTREAMS });
    expect(widget.status).toBe(200);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("proxies passed requests without the pass cookie", async () => {
    const upstream = vi.fn(async () =>
      new Response("from origin", { status: 201, headers: { "X-Origin": "yes" } }),
    );
    vi.stubGlobal("fetch", upstream);
    const res = await callWorker(
      "https://app.example/api/items?q=1",
      {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "text/plain",
          "X-Custom": "kept",
          Cookie: `session=abc; ${await upstreamCookie()}; theme=dark`,
        },
        body: "hello upstream",
      },
      { GATE_UPSTREAMS: UPSTREAMS },
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("x-origin")).toBe("yes");
    expect(await res.text()).toBe("from origin");

    expect(upstream).toHaveBeenCalledTimes(1);
    const [target, init] = upstream.mock.calls[0];
    expect(String(target)).toBe("https://origin.example/api/items?q=1");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    const headers = new Headers(init.headers);
    expect(headers.get("cookie")).toBe("session=abc; theme=dark");
    expect(headers.get("x-custom")).toBe("kept");
    expect(headers.get("x-forwarded-host")).toBe("app.example");
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(await new Response(init.body).text()).toBe("hello upstream");
  });

  it("drops the Cookie header when the pass was the only cookie", async () => {
    const upstream = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", upstream);
    const res = await callWorker(
      "https://app.example/page",
      { headers: { "User-Agent": UA, Cookie: await upstreamCookie() } },
      { GATE_UPSTREAMS: UPSTREAMS },
    );
    expect(res.status).toBe(200);
    const [, init] = upstream.mock.calls[0];
    expect(new Headers(init.headers).has("cookie")).toBe(false);
    expect(init.body).toBeUndefined();
  });

  it("rewrites origin redirects onto the public host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(null, { status: 302, headers: { Location: "https://origin.example/login?n=1" } }),
      ),
    );
    const res = await callWorker(
      "https://app.example/account",
      { headers: { "User-Agent": UA, Cookie: await upstreamCookie() } },
      { GATE_UPSTREAMS: UPSTREAMS },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.example/login?n=1");
  });

  it("never lets a scheme-relative path pick the proxy target", async () => {
    const upstream = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", upstream);
    for (const path of ["//evil.example/x", "///evil.example/x", "/\\\\evil.example/x"]) {
      await callWorker(
        `https://app.example${path}`,
        { headers: { "User-Agent": UA, Cookie: await upstreamCookie() } },
        { GATE_UPSTREAMS: UPSTREAMS },
      );
    }
    for (const [target] of upstream.mock.calls) {
      expect(new URL(String(target)).origin).toBe("https://origin.example");
    }
  });

  it("replaces client-supplied forwarding headers", async () => {
    const upstream = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", upstream);
    await callWorker(
      "https://app.example/page",
      {
        headers: {
          "User-Agent": UA,
          Cookie: await upstreamCookie(),
          "X-Forwarded-For": "1.2.3.4",
          "X-Real-IP": "1.2.3.4",
          Forwarded: "for=1.2.3.4",
          "CF-Connecting-IP": "203.0.113.7",
        },
      },
      { GATE_UPSTREAMS: UPSTREAMS },
    );
    const headers = new Headers(upstream.mock.calls[0][1].headers);
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(headers.has("x-real-ip")).toBe(false);
    expect(headers.has("forwarded")).toBe(false);
  });

  it("keeps hosts outside the table on the regular routes", async () => {
    const res = await callWorker("https://verify.rakko.cn/", {}, { GATE_UPSTREAMS: UPSTREAMS });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Priestess Verification");
  });
});

describe("gate: automated browsers", () => {
  it("rejects instr_blocked on gate challenges by default", async () => {
    const strict = { GATE_BLOCK_AUTOMATED_BROWSERS: undefined };
    const challenge = await (
      await callWorker(`${ORIGIN}/__gate/challenge`, { method: "POST" }, strict)
    ).json();
    const solutions = await solveChallengeResponse(challenge);
    const res = await callWorker(
      `${ORIGIN}/__gate/redeem`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: challenge.token, solutions, instr_blocked: true }),
      },
      strict,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("instr_automated_browser");
  });
});

describe("gate: config", () => {
  it("parses GATE_UPSTREAMS", () => {
    expect(parseGateUpstreams(undefined).size).toBe(0);
    expect(parseGateUpstreams("")).toEqual(new Map());
    expect(parseGateUpstreams('{"Example.COM":"https://origin.example.com/"}')).toEqual(
      new Map([["example.com", "https://origin.example.com"]]),
    );
    for (const [raw, why] of [
      ["{nope", /valid JSON/],
      ['["a"]', /JSON object/],
      ['{"example.com":"http://origin.example.com"}', /https/],
      ['{"example.com":"https://origin.example.com/app"}', /bare origin/],
      ['{"example.com":"not a url"}', /not a URL/],
      ['{"https://example.com":"https://o.example"}', /bare hostnames/],
    ]) {
      expect(() => parseGateUpstreams(raw), raw).toThrow(why);
    }
  });

  it("bounds GATE_PASS_TTL_S", () => {
    expect(readConfig({}).gatePassTtlS).toBe(1800);
    expect(readConfig({ GATE_PASS_TTL_S: "60" }).gatePassTtlS).toBe(60);
    expect(() => readConfig({ GATE_PASS_TTL_S: "59" })).toThrow(/GATE_PASS_TTL_S/);
    expect(() => readConfig({ GATE_PASS_TTL_S: "86401" })).toThrow(/GATE_PASS_TTL_S/);
  });

  it("uses GATE_PASS_TTL_S for the cookie lifetime", async () => {
    const token = await mintToken();
    const res = await callWorker(
      `${ORIGIN}/__gate/pass`,
      {
        method: "POST",
        headers: { "content-type": "application/json", Origin: ORIGIN, "User-Agent": UA },
        body: JSON.stringify({ token }),
      },
      { GATE_PASS_TTL_S: "120" },
    );
    expect(res.headers.get("set-cookie")).toContain("Max-Age=120");

    const page = await callWorker(
      `${ORIGIN}/protected`,
      { headers: { Accept: HTML_ACCEPT, "Accept-Language": "zh-CN" } },
      { GATE_PASS_TTL_S: "7200" },
    );
    const html = await page.text();
    expect(pageConfig(html).passTtlS).toBe(7200);
    // The challenge no longer states the lifetime; the example page does.
    expect(html).not.toContain("2 小时");
    const passed = await callWorker(
      `${ORIGIN}/protected`,
      {
        headers: {
          Accept: HTML_ACCEPT,
          "Accept-Language": "zh-CN",
          "User-Agent": UA,
          Cookie: cookiePair(res),
        },
      },
      { GATE_PASS_TTL_S: "7200" },
    );
    expect(passed.status).toBe(200);
    expect(await passed.text()).toContain("有效期为 2 小时的签名 Cookie");
  });

  it("words the pass lifetime and fills placeholders literally", () => {
    expect(formatTtl(1800, STRINGS.en)).toBe("30 minutes");
    expect(formatTtl(60, STRINGS.en)).toBe("1 minute");
    expect(formatTtl(3600, STRINGS.en)).toBe("1 hour");
    expect(formatTtl(5400, STRINGS.zh)).toBe("90 分钟");
    expect(formatTtl(86400, STRINGS.zh)).toBe("24 小时");
    expect(formatTtl(90, STRINGS.en)).toBe("90 seconds");
    expect(fill("{host} / {x}", { host: "$&$1" })).toBe("$&$1 / {x}");
  });

  it("answers 500 when GATE_UPSTREAMS is invalid", async () => {
    const res = await callWorker(`${ORIGIN}/protected`, {}, { GATE_UPSTREAMS: "{bad" });
    expect(res.status).toBe(500);
  });

  it("strips only the pass from a Cookie header", () => {
    expect(stripPassCookie("a=1; __pv_pass=x; b=2")).toBe("a=1; b=2");
    expect(stripPassCookie("__pv_pass=x")).toBeNull();
    expect(stripPassCookie("__pv_passx=1")).toBe("__pv_passx=1");
    expect(stripPassCookie(null)).toBeNull();
  });
});

describe("gate: paced status steps", () => {
  const steps = flattenSteps(STRINGS.zh.statusSteps);
  const at = (group) => steps.findIndex((step) => step.group === group);

  it("has 8 working steps ending in an ellipsis, then the plain success", () => {
    for (const lang of ["zh", "en"]) {
      const list = flattenSteps(STRINGS[lang].statusSteps);
      expect(list.map((step) => step.group)).toEqual([
        "checking", "checking", "checking",
        "computing", "computing", "computing",
        "submitting", "submitting",
        "passed",
      ]);
      for (const step of list.slice(0, 8)) expect(step.text.endsWith("…"), step.text).toBe(true);
      expect(list[8].text.endsWith("…")).toBe(false);
    }
  });

  it("walks the real phase's steps, then holds", () => {
    expect(nextStatusStep(steps, 0, "checking")).toBe(1);
    expect(nextStatusStep(steps, 2, "checking")).toBe(2);
    expect(nextStatusStep(steps, 2, "computing")).toBe(3);
    expect(nextStatusStep(steps, 5, "computing")).toBe(5);
    expect(nextStatusStep(steps, 7, "submitting")).toBe(7);
  });

  it("skips what the real phase has left behind", () => {
    expect(nextStatusStep(steps, 0, "computing")).toBe(at("computing"));
    expect(nextStatusStep(steps, 1, "submitting")).toBe(at("submitting"));
    expect(nextStatusStep(steps, 4, "submitting")).toBe(at("submitting"));
  });

  it("goes straight to the success once passed, and stays there", () => {
    expect(nextStatusStep(steps, 0, "passed")).toBe(at("passed"));
    expect(nextStatusStep(steps, 6, "passed")).toBe(at("passed"));
    expect(nextStatusStep(steps, at("passed"), "passed")).toBe(at("passed"));
  });
});
