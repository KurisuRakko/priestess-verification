import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";
import {
  MAX_EXEMPT_PATH_LENGTH,
  MAX_EXEMPT_PATHS,
  MAX_GATE_HOSTS,
  validateExemptPaths,
  validateGateHost,
  validateUpstream,
} from "../src/gate-hosts.js";

const ORIGIN = "https://verify.rakko.cn";

async function consolePage() {
  const res = await SELF.fetch(`${ORIGIN}/admin`, { redirect: "manual" });
  expect(res.status).toBe(200);
  return res.text();
}

/** The inlined console script (the last nonce'd <script> on the page). */
function clientScript(html) {
  const scripts = [
    ...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g),
  ];
  return scripts.at(-1)[1];
}

describe("admin console layout", () => {
  it("has the sites, statistics and gate tabs wired to their panels", async () => {
    const html = await consolePage();
    for (const view of ["sites", "stats", "gate"]) {
      expect(html).toContain(`id="tab-${view}"`);
      expect(html).toContain(`aria-controls="view-${view}"`);
      expect(html).toContain(`id="view-${view}"`);
    }
    expect(html).toContain('role="tablist"');
  });

  it("states the fixed statistics and gate notices", async () => {
    const html = await consolePage();
    expect(html).toContain(
      "统计数据仅为按小时汇总的计数，不包含任何访客个人信息。",
    );
    expect(html).toContain("所选时间范围内没有记录。");
    expect(html).toContain(
      "仅当该域名已通过 Worker 路由指向本服务时，网关设置才会生效。",
    );
    expect(html).toContain("修改将在 60 秒内生效。");
    expect(html).toContain("该域名由部署配置定义，需修改部署配置并重新部署。");
  });

  it("inlines the vendor tabs, segmented choice and switch styles", async () => {
    const html = await consolePage();
    for (const selector of [
      ".rk-tabs__indicator",
      ".rk-segment",
      ".rk-switch__thumb",
    ]) {
      expect(html).toContain(selector);
    }
  });

  it("calls the stats and gate APIs and never writes API strings as HTML", async () => {
    const script = clientScript(await consolePage());
    expect(script).toContain("/stats?");
    expect(script).toContain('api("/gate"');
    expect(script).toContain("getTimezoneOffset");
    expect(script).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
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

/** `GATE_ERROR_RULES` from the console script, the way the browser reads it. */
function gateErrorRules(script) {
  const match = /const GATE_ERROR_RULES = (\[[\s\S]*?\n {2}\]);/.exec(script);
  expect(match).not.toBeNull();
  return JSON.parse(match[1].replace(/,(\s*\])/g, "$1"));
}

function gateErrorField(rules, message) {
  const lower = message.toLowerCase();
  return rules.find(([needle]) => lower.includes(needle))?.[1] ?? null;
}

describe("admin console gate errors", () => {
  it("maps every gate validation message to the field it is about", async () => {
    const rules = gateErrorRules(clientScript(await consolePage()));
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
      expect([message, gateErrorField(rules, message)]).toEqual([
        message,
        field,
      ]);
    }
    // gate-api.js's own limit message.
    expect(gateErrorField(rules, `at most ${MAX_GATE_HOSTS} gate hosts`)).toBe(
      "host",
    );
  });

  it("puts the upstream path error on the upstream field, not the exempt paths", async () => {
    const rules = gateErrorRules(clientScript(await consolePage()));
    const message = messageOf(() =>
      validateUpstream("https://origin.test/app", "gated.test"),
    );
    const rule = rules.find(([needle]) =>
      message.toLowerCase().includes(needle),
    );
    expect(rule[1]).toBe("upstream");
    expect(rule[2]).toBe("源站地址不能包含路径、查询参数或片段。");
  });
});

/** `periodText` and its helpers from the console script, run as the browser would. */
function periodTextFn(script) {
  const pick = (re) => {
    const match = re.exec(script);
    expect(match).not.toBeNull();
    return match[0];
  };
  const source = [
    pick(/const pad2 = .*;/),
    pick(/function offsetText\(tz\) \{[\s\S]*?\n {2}\}/),
    pick(/function zonedText\(iso, tz\) \{[\s\S]*?\n {2}\}/),
    pick(/function periodText\(data, browserTz\) \{[\s\S]*?\n {2}\}/),
  ].join("\n");
  return new Function(`${source}\nreturn periodText;`)();
}

describe("admin console statistics period", () => {
  const data = {
    from: "2026-11-05T18:00:00.000Z",
    to: "2026-11-06T18:00:00.000Z",
    generatedAt: "2026-11-06T17:42:00.000Z",
  };

  it("reads the period in the API's tz and says local time when it matches", async () => {
    const periodText = periodTextFn(clientScript(await consolePage()));
    expect(periodText({ ...data, tz: 660 }, 660)).toBe(
      "统计区间：11月6日 05:00 至 11月7日 05:00（本地时间），更新于 11月7日 04:42。",
    );
    expect(periodText({ ...data, tz: 0 }, 0)).toBe(
      "统计区间：11月5日 18:00 至 11月6日 18:00（本地时间），更新于 11月6日 17:42。",
    );
  });

  it("names the rounded offset when the browser is in a half-hour zone", async () => {
    const periodText = periodTextFn(clientScript(await consolePage()));
    // UTC+5:45 is rounded to UTC+6 by the API.
    expect(periodText({ ...data, tz: 360 }, 345)).toBe(
      "统计区间：11月6日 00:00 至 11月7日 00:00（按 UTC+6 统计），更新于 11月6日 23:42。",
    );
    expect(periodText({ ...data, tz: -240 }, -210)).toBe(
      "统计区间：11月5日 14:00 至 11月6日 14:00（按 UTC-4 统计），更新于 11月6日 13:42。",
    );
  });
});
