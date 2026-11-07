import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import appScript from "../src/generated/admin.client.js";
import appCss from "../src/generated/admin.css";
import { readConfig, SITE_SETTING_RANGES } from "../src/config.js";
import {
  MAX_EXEMPT_PATH_LENGTH,
  MAX_EXEMPT_PATHS,
  MAX_GATE_HOSTS,
  validateExemptPaths,
  validateGateHost,
  validateUpstream,
} from "../src/gate-hosts.js";
import {
  MAX_ORIGINS,
  validateName,
  validateOrigins,
  validateSettings,
} from "../src/sites.js";
import { doneUrl, finishSignIn } from "../web/src/admin/callback.ts";
import {
  describeError,
  describeGateError,
  describeSiteError,
  gateErrorRule,
  loginErrorText,
  siteFailureText,
} from "../web/src/admin/errors.ts";
import {
  GATE_COPY,
  gateBody,
  gateDialogTitle,
  gateForm,
} from "../web/src/admin/gate.ts";
import {
  describeSettings,
  powKinds,
  protocolNote,
  siteBody,
  siteForm,
  siteFormError,
  snippets,
} from "../web/src/admin/sites.ts";
import {
  bucketText,
  isEmpty,
  metrics,
  passRate,
  periodText,
  raisedCount,
  reasonSections,
  riskRows,
  siteOptions,
  STATS_NOTES,
} from "../web/src/admin/stats.ts";

const ORIGIN = "https://verify.rakko.cn";

async function page(path) {
  const res = await SELF.fetch(`${ORIGIN}${path}`, { redirect: "manual" });
  expect(res.status).toBe(200);
  return { res, html: await res.text() };
}

/** `#page-config` of a shell. */
function pageConfig(html) {
  const match =
    /<script type="application\/json" id="page-config"[^>]*>([^<]*)<\/script>/.exec(
      html,
    );
  expect(match).not.toBeNull();
  return JSON.parse(match[1]);
}

describe("admin shell", () => {
  it("inlines the console bundle and its styles under the response nonce", async () => {
    const { res, html } = await page("/admin");
    const csp = res.headers.get("content-security-policy");
    const nonce = /'nonce-([^']+)'/.exec(csp)[1];
    expect(csp).toContain(`style-src 'nonce-${nonce}'`);
    expect(html).toContain(`<style nonce="${nonce}" data-app="admin">`);
    expect(html).toContain(appCss.trim());
    expect(html).toContain(appScript.trim());
    // Theme boot, page config and the bundle: every script carries the nonce.
    // (Counted at line starts: the bundle itself mentions `<script>`.)
    const scripts = [...html.matchAll(/^\s*<script\b([^>]*)>/gm)];
    expect(scripts).toHaveLength(3);
    for (const [, attrs] of scripts)
      expect(attrs).toContain(`nonce="${nonce}"`);
    expect(html).toContain('localStorage.getItem("pv-theme")');
    expect(html).toContain('id="root"');
    expect(pageConfig(html)).toEqual({ view: "console" });
  });

  it("renders the callback page from the same bundle", async () => {
    const { html } = await page("/admin/callback");
    expect(pageConfig(html)).toEqual({ view: "callback" });
    expect(html).toContain("<title>正在登录…</title>");
    expect(html).toContain(appScript.trim());
  });

  it("builds the console from Rakko Design primitives only", () => {
    // The vendor styles of the primitives the console renders are in the bundle.
    for (const selector of [
      ".rk-tabs__indicator",
      ".rk-segment",
      ".rk-switch",
      ".rk-dialog",
      ".rk-select__popup",
      ".rk-snackbar",
    ]) {
      expect(appCss).toContain(selector);
    }
  });
});

/** The validation message `fn` throws. */
function messageOf(fn) {
  try {
    fn();
  } catch (error) {
    return error.message;
  }
  throw new Error("expected a validation error");
}

describe("admin console gate errors", () => {
  it("maps every gate validation message to the field it is about", () => {
    const config = readConfig({ ALLOWED_ORIGINS: ORIGIN });
    const cases = [
      [() => validateGateHost("gated.test:8080", config), "host"],
      [() => validateGateHost("https://gated.test", config), "host"],
      [() => validateGateHost("verify.rakko.cn", config), "host"],
      [() => validateUpstream(42, "gated.test"), "upstream"],
      [() => validateUpstream("not a url", "gated.test"), "upstream"],
      [() => validateUpstream("http://origin.test", "gated.test"), "upstream"],
      [
        () => validateUpstream("https://origin.test/app", "gated.test"),
        "upstream",
      ],
      [() => validateUpstream("https://gated.test", "gated.test"), "upstream"],
      [() => validateExemptPaths("/static/"), "exemptPaths"],
      [() => validateExemptPaths(["static"]), "exemptPaths"],
      [
        () => validateExemptPaths([`/${"a".repeat(MAX_EXEMPT_PATH_LENGTH)}`]),
        "exemptPaths",
      ],
      [() => validateExemptPaths(["/a/../b"]), "exemptPaths"],
      [() => validateExemptPaths(["/a b"]), "exemptPaths"],
      [() => validateExemptPaths(["/"]), "exemptPaths"],
      [() => validateExemptPaths(["/__gate/x"]), "exemptPaths"],
      [
        () =>
          validateExemptPaths(
            Array.from({ length: MAX_EXEMPT_PATHS + 1 }, (_, i) => `/p${i}`),
          ),
        "exemptPaths",
      ],
    ];
    for (const [fn, field] of cases) {
      const message = messageOf(fn);
      expect([message, gateErrorRule(message)?.[1] ?? null]).toEqual([
        message,
        field,
      ]);
      expect(describeGateError({ status: 400, message }, true).field).toBe(
        field,
      );
    }
    // gate-api.js's own limit message.
    expect(gateErrorRule(`at most ${MAX_GATE_HOSTS} gate hosts`)?.[1]).toBe(
      "host",
    );
  });

  it("puts the upstream path error on the upstream field, not the exempt paths", () => {
    const message = messageOf(() =>
      validateUpstream("https://origin.test/app", "gated.test"),
    );
    const rule = gateErrorRule(message);
    expect(rule[1]).toBe("upstream");
    expect(rule[2]).toBe("源站地址不能包含路径、查询参数或片段。");
  });

  it("tells a duplicate host from a host defined by the deployment", () => {
    const conflict = { status: 409, message: "gate host already exists" };
    expect(describeGateError(conflict, true)).toEqual({
      text: "该域名已存在于后台或部署配置中。（原始信息：gate host already exists）",
      field: "host",
      detail: "该域名已存在于后台或部署配置中。",
    });
    expect(
      describeGateError({ status: 409, message: "HTTP 409" }, false),
    ).toEqual({
      text: "该域名由部署配置定义，无法在后台修改。",
      field: null,
      detail: "该域名由部署配置定义，无法在后台修改。",
    });
    expect(
      describeGateError({ status: 404, message: "HTTP 404" }, false).text,
    ).toBe("该域名不存在，可能已被删除。");
  });

  it("shows only the Chinese explanation under the field it is about", () => {
    const message = messageOf(() =>
      validateUpstream("http://o.test", "g.test"),
    );
    const { text, field, detail } = describeGateError(
      { status: 400, message },
      true,
    );
    expect(field).toBe("upstream");
    expect(detail).toBe("源站地址必须使用 https:// 协议。");
    expect(text).toBe(`${detail}（原始信息：${message}）`);
  });

  it("explains HTTP and network failures in Chinese", () => {
    expect(describeError({ status: null, message: "Failed to fetch" })).toBe(
      "网络连接异常，请稍后重试。（原始信息：Failed to fetch）",
    );
    expect(describeError({ status: 429, message: "HTTP 429" })).toBe(
      "请求过于频繁，请稍后重试。",
    );
    expect(describeError({ status: 503, message: "HTTP 503" })).toBe(
      "服务内部错误，请稍后重试。",
    );
    expect(
      describeError(
        { status: 400, message: "invalid range" },
        { 400: "统计查询参数无效。" },
      ),
    ).toBe("统计查询参数无效。（原始信息：invalid range）");
    expect(loginErrorText("not_an_admin")).toBe(
      "该 Priestess 账号没有后台访问权限。",
    );
    expect(loginErrorText("weird")).toBe("登录失败：weird");
    expect(loginErrorText(null)).toBe("");
  });
});

describe("admin console site errors", () => {
  it("maps every site validation message to a Chinese explanation and its field", () => {
    const cases = [
      [() => validateName(""), "name"],
      [() => validateName("x".repeat(81)), "name"],
      [() => validateOrigins("https://a.test"), "origins"],
      [() => validateOrigins(["not a url"]), "origins"],
      [() => validateOrigins(["https://a.test/app"]), "origins"],
      [() => validateOrigins(["http://a.test"]), "origins"],
      [
        () =>
          validateOrigins(
            Array.from(
              { length: MAX_ORIGINS + 1 },
              (_, i) => `https://a${i}.test`,
            ),
          ),
        "origins",
      ],
      [
        () => validateSettings({ challengeDifficulty: 99 }),
        "challengeDifficulty",
      ],
      [() => validateSettings({ challengeCount: 0 }), "challengeCount"],
      [() => validateSettings({ tokenTtlMs: 1 }), "tokenTtlMinutes"],
    ];
    for (const [fn, field] of cases) {
      const message = messageOf(fn);
      const described = describeSiteError({ status: 400, message });
      expect([message, described.field]).toEqual([message, field]);
      expect(described.text).not.toContain("原始信息");
      expect(described.text).toMatch(/。$/);
    }
    // admin/api.js's own messages.
    expect(
      describeSiteError({
        status: 400,
        message: "at least one origin is required",
      }),
    ).toEqual({ text: "至少需要填写一个允许的域名。", field: "origins" });
    expect(
      describeSiteError({ status: 400, message: "at most 200 sites" }),
    ).toEqual({
      text: "站点数量已达上限，请先删除不再使用的站点。",
      field: null,
    });
    expect(SITE_SETTING_RANGES.challengeDifficulty).toEqual([1, 16]);
  });

  it("reads 404 in Chinese and falls back to the general text with the original", () => {
    expect(
      siteFailureText("disable", { status: 404, message: "site not found" }),
    ).toBe("停用失败：该站点不存在，可能已被删除。");
    expect(siteFailureText("rotate", { status: 500, message: "boom" })).toBe(
      "轮换失败：服务内部错误，请稍后重试。（原始信息：boom）",
    );
    expect(
      siteFailureText("load", { status: null, message: "Failed to fetch" }),
    ).toBe(
      "站点列表加载失败：网络连接异常，请稍后重试。（原始信息：Failed to fetch）",
    );
    expect(
      siteFailureText("delete", { status: 400, message: "something new" }),
    ).toBe("删除失败：提交的内容未通过校验。（原始信息：something new）");
  });
});

describe("admin console statistics", () => {
  const data = {
    from: "2026-11-05T18:00:00.000Z",
    to: "2026-11-06T18:00:00.000Z",
    generatedAt: "2026-11-06T17:42:00.000Z",
  };

  it("reads the period in the API's tz and says local time when it matches", () => {
    expect(periodText({ ...data, tz: 660 }, 660)).toBe(
      "统计区间：11月6日 05:00 至 11月7日 05:00（本地时间），更新于 11月7日 04:42。",
    );
    expect(periodText({ ...data, tz: 0 }, 0)).toBe(
      "统计区间：11月5日 18:00 至 11月6日 18:00（本地时间），更新于 11月6日 17:42。",
    );
  });

  it("names the rounded offset when the browser is in a half-hour zone", () => {
    // UTC+5:45 is rounded to UTC+6 by the API.
    expect(periodText({ ...data, tz: 360 }, 345)).toBe(
      "统计区间：11月6日 00:00 至 11月7日 00:00（按 UTC+6 统计），更新于 11月6日 23:42。",
    );
    expect(periodText({ ...data, tz: -240 }, -210)).toBe(
      "统计区间：11月5日 14:00 至 11月6日 14:00（按 UTC-4 统计），更新于 11月6日 13:42。",
    );
  });

  it("names day buckets in the API's offset", () => {
    // The 18:00Z bucket is 7 November in UTC+6.
    expect(bucketText("2026-11-06T18:00:00.000Z", "day", false, 360)).toBe(
      "11/7",
    );
    expect(bucketText("2026-11-06T18:00:00.000Z", "day", true, 360)).toBe(
      "11月7日",
    );
  });

  it("computes the pass rate and the empty state", () => {
    expect(passRate({ redeem_ok: 55, redeem_fail: 34 })).toBe("61.8%");
    expect(passRate({ redeem_ok: 0, redeem_fail: 0 })).toBe("—");
    expect(isEmpty({ challenge_issued: 0, rate_limited: 0 })).toBe(true);
    expect(isEmpty({ challenge_issued: 0, rate_limited: 3 })).toBe(false);
  });

  it("states how rate limiting is counted and how the pass rate is defined", () => {
    const totals = Object.fromEntries(
      [
        "challenge_issued",
        "redeem_ok",
        "redeem_fail",
        "siteverify_ok",
        "siteverify_fail",
        "gate_shown",
        "gate_pass",
        "gate_pass_fail",
        "rate_limited",
      ].map((name) => [name, 1200]),
    );
    const byLabel = Object.fromEntries(
      metrics(totals).map((m) => [m.label, m]),
    );
    expect(byLabel.触发限流).toEqual({
      label: "触发限流",
      value: "1,200",
      hint: "按 1/10 抽样估算",
    });
    expect(byLabel.通过率.hint).toBe("验证通过 ÷（验证通过 + 验证失败）");
    expect(byLabel.通过率.value).toBe("50.0%");
    expect(byLabel.发出挑战.hint).toBe("其中提高难度 0 次");
    const raised = metrics(totals, {
      challenge_issued: { datacenter: 1000, "warp+burst": 234 },
    });
    expect(raised[0]).toEqual({
      label: "发出挑战",
      value: "1,200",
      hint: "其中提高难度 1,234 次",
    });
  });

  it("lists the raised-difficulty reasons that occurred, in a fixed order", () => {
    expect(raisedCount(undefined)).toBe(0);
    expect(riskRows({})).toEqual([]);
    const reasons = {
      challenge_issued: {
        "warp+burst": 1,
        burst: 4,
        datacenter: 2,
        future: 1,
        warp: 0,
      },
    };
    expect(raisedCount(reasons)).toBe(8);
    expect(riskRows(reasons)).toEqual([
      { reason: "datacenter", label: "机房网络", count: 2 },
      { reason: "burst", label: "短时间频繁请求", count: 4 },
      { reason: "warp+burst", label: "Cloudflare WARP 且频繁请求", count: 1 },
      { reason: "future", label: "future", count: 1 },
    ]);
    expect(
      riskRows({
        challenge_issued: { warp: 1, "datacenter+burst": 1 },
      }).map((row) => row.label),
    ).toEqual(["Cloudflare WARP", "机房网络且频繁请求"]);
  });

  it("labels failure and rate-limit reasons, most frequent first", () => {
    const sections = reasonSections({
      redeem_fail: { expired: 3, invalid_solution: 9, mystery: 1 },
      siteverify_fail: {},
      rate_limited: { siteverify: 2, challenge: 6 },
    });
    expect(sections.map((s) => s.title)).toEqual([
      "验证失败（共 13 次）",
      "触发限流（共 8 次）",
    ]);
    expect(sections[0].rows.map((r) => [r.label, r.count, r.share])).toEqual([
      ["计算结果无效", "9", "69.2%"],
      ["挑战已过期", "3", "23.1%"],
      ["mystery", "1", "7.7%"],
    ]);
    expect(sections[1].rows.map((r) => r.label)).toEqual([
      "获取挑战",
      "服务端核验",
    ]);
  });

  it("offers every site, and keeps a selected site that has no rows", () => {
    const rows = [
      { site: "abc", label: "Blog", kind: "site" },
      { site: "gate:gated.test", label: "gated.test", kind: "gate" },
      { site: "default", label: "default", kind: "default" },
    ];
    expect(siteOptions(rows, "gone").map((o) => o.label)).toEqual([
      "全部站点",
      "Blog（站点）",
      "gated.test（验证网关）",
      "default（旧接口）",
      "gone",
    ]);
  });

  it("keeps the fixed notes", () => {
    expect(STATS_NOTES.footnote).toBe(
      "统计数据仅为按小时汇总的计数，不包含任何访客个人信息。",
    );
    expect(STATS_NOTES.empty).toBe("所选时间范围内没有记录。");
  });
});

describe("admin console sites", () => {
  const DEFAULTS = {
    challengeDifficulty: 4,
    challengeCount: 50,
    challengeSize: 32,
    hashwxDifficulty: 150000,
    tokenTtlMs: 1200000,
    blockAutomatedBrowsers: false,
  };

  it("round-trips the site form and sends only the changed settings", () => {
    const site = {
      siteKey: "0123456789",
      name: "Blog",
      origins: ["https://a.test", "https://b.test"],
      enabled: true,
      settings: { challengeDifficulty: 5, tokenTtlMs: 600000 },
    };
    const form = siteForm(site, DEFAULTS);
    expect(form).toEqual({
      name: "Blog",
      origins: "https://a.test\nhttps://b.test",
      challengeDifficulty: "5",
      challengeCount: "",
      hashwxDifficulty: "",
      tokenTtlMinutes: "10",
      blockAutomatedBrowsers: false,
    });
    expect(
      siteBody(
        { ...form, origins: " https://a.test \n\nhttps://c.test " },
        site,
        DEFAULTS,
      ),
    ).toEqual({
      name: "Blog",
      origins: ["https://a.test", "https://c.test"],
      settings: { challengeDifficulty: 5, tokenTtlMs: 600000 },
    });
    expect(
      siteBody(
        {
          ...form,
          challengeDifficulty: "",
          hashwxDifficulty: "300000",
          tokenTtlMinutes: "15",
          blockAutomatedBrowsers: true,
        },
        site,
        DEFAULTS,
      ).settings,
    ).toEqual({
      challengeDifficulty: null,
      hashwxDifficulty: "300000",
      tokenTtlMs: 900000,
      blockAutomatedBrowsers: true,
    });
  });

  it("keeps hidden and unchanged settings exactly as stored", () => {
    const site = {
      siteKey: "0123456789",
      name: "Blog",
      origins: ["https://a.test"],
      enabled: true,
      // challengeSize has no field at all; 15 s is not a whole minute.
      settings: {
        challengeSize: 64,
        tokenTtlMs: 15000,
        blockAutomatedBrowsers: false,
      },
    };
    const form = siteForm(site, DEFAULTS);
    expect(form.tokenTtlMinutes).toBe("0.25");
    expect(
      siteBody({ ...form, name: "Renamed" }, site, DEFAULTS).settings,
    ).toEqual(site.settings);
    // A new site sends nothing the admin left empty.
    expect(siteBody(siteForm(null, DEFAULTS), null, DEFAULTS).settings).toEqual(
      {},
    );
    // Unticking back to the default drops the override instead of storing it.
    const ticked = { ...site, settings: { blockAutomatedBrowsers: true } };
    expect(
      siteBody(
        { ...siteForm(ticked, DEFAULTS), blockAutomatedBrowsers: false },
        ticked,
        DEFAULTS,
      ).settings,
    ).toEqual({ blockAutomatedBrowsers: null });
  });

  it("rejects a token lifetime that is not a number in range, keeping empty as the default", () => {
    const form = siteForm(null, DEFAULTS);
    for (const value of ["", "  ", "20", "0.25", "1440", "5."]) {
      expect(siteFormError({ ...form, tokenTtlMinutes: value }), value).toBeNull();
    }
    for (const value of ["abc", "1e3", "-5", "0", "0.001", "1441", "1,5"]) {
      expect(siteFormError({ ...form, tokenTtlMinutes: value }), value).toEqual({
        field: "tokenTtlMinutes",
        text: expect.stringContaining("留空表示沿用全局默认值"),
      });
    }
  });

  it("describes settings for the protocol in effect", () => {
    const settings = {
      challengeDifficulty: 5,
      hashwxDifficulty: 300000,
      tokenTtlMs: 600000,
    };
    expect(describeSettings(settings, "hashwx")).toBe(
      "SHA-256 难度 5（当前协议下不生效） · HashWX 难度 300000 · token 有效期 10 分钟",
    );
    expect(describeSettings(settings, "legacy")).toBe(
      "SHA-256 难度 5 · HashWX 难度 300000（当前协议下不生效） · token 有效期 10 分钟",
    );
    expect(powKinds("legacy")).toEqual({ sha256: true, hashwx: false });
    expect(powKinds("hashwx")).toEqual({ sha256: false, hashwx: true });
    expect(powKinds("sha256-pow,hashwx")).toEqual({
      sha256: true,
      hashwx: true,
    });
    expect(powKinds("")).toEqual({ sha256: false, hashwx: false });
    expect(protocolNote("hashwx")).toBe(
      "当前工作量证明为 HashWX，SHA-256 相关设置不适用，因此不予显示。",
    );
  });

  it("writes the integration snippets for this origin", () => {
    const { frontend, backend } = snippets(ORIGIN, "0123456789");
    expect(frontend).toContain(`<script src="${ORIGIN}/widget.js"></script>`);
    expect(frontend).toContain(`data-cap-api-endpoint="${ORIGIN}/0123456789/"`);
    expect(backend).toContain(`"${ORIGIN}/0123456789/siteverify"`);
  });
});

describe("admin console gate", () => {
  it("sends the host only when creating, lowercased", () => {
    const form = {
      host: " Blog.Example.COM ",
      upstream: " https://origin.test ",
      exemptPaths: "/api/webhook\n\n  /static/ \n",
      enabled: false,
    };
    expect(gateBody(form, true)).toEqual({
      host: "blog.example.com",
      upstream: "https://origin.test",
      exemptPaths: ["/api/webhook", "/static/"],
      enabled: false,
    });
    expect(gateBody(form, false)).not.toHaveProperty("host");
    expect(gateForm(null).enabled).toBe(true);
  });

  it("titles the dialog by what can be done with the host", () => {
    const host = { host: "a.test", source: "admin" };
    expect(gateDialogTitle(null)).toBe("添加域名");
    expect(gateDialogTitle(host)).toBe("编辑域名");
    expect(gateDialogTitle({ ...host, source: "config" })).toBe("查看域名");
    expect(GATE_COPY.notes).toEqual([
      "仅当该域名已通过 Worker 路由指向本服务时，网关设置才会生效。",
      "修改将在 60 秒内生效。",
    ]);
    expect(GATE_COPY.readOnly).toBe(
      "该域名由部署配置定义，需修改部署配置并重新部署。",
    );
  });
});

describe("admin callback", () => {
  function fakeFetch(status, body) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push([url, init]);
      return new Response(JSON.stringify(body), { status });
    };
    return { calls, fetchImpl };
  }

  it("posts the login code as JSON and goes to the console", async () => {
    const { calls, fetchImpl } = fakeFetch(200, { ok: true });
    expect(await finishSignIn("#login_code=abc&state=xyz", fetchImpl)).toBe(
      "/admin",
    );
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe("/admin/api/session");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ login_code: "abc", state: "xyz" });
  });

  it("goes back to /admin with the error instead of signing in again", async () => {
    const denied = fakeFetch(403, { error: "not_an_admin" });
    expect(await finishSignIn("#login_code=abc", denied.fetchImpl)).toBe(
      "/admin?error=not_an_admin",
    );
    expect(await finishSignIn("#auth_error=access_denied")).toBe(
      "/admin?error=access_denied",
    );
    expect(await finishSignIn("")).toBe("/admin?error=missing_login_code");
    const offline = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await finishSignIn("#login_code=abc", offline)).toBe(
      doneUrl("network_error"),
    );
  });
});
