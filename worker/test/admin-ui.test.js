import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://verify.rakko.cn";

async function consolePage() {
  const res = await SELF.fetch(`${ORIGIN}/admin`, { redirect: "manual" });
  expect(res.status).toBe(200);
  return res.text();
}

/** The inlined console script (the last nonce'd <script> on the page). */
function clientScript(html) {
  const scripts = [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)];
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
    expect(html).toContain("统计数据仅为按小时汇总的计数，不包含任何访客个人信息。");
    expect(html).toContain("所选时间范围内没有记录。");
    expect(html).toContain(
      "仅当该域名已通过 Worker 路由指向本服务时，网关设置才会生效。",
    );
    expect(html).toContain("修改将在 60 秒内生效。");
    expect(html).toContain("该域名由部署配置定义，需修改部署配置并重新部署。");
  });

  it("inlines the vendor tabs, segmented choice and switch styles", async () => {
    const html = await consolePage();
    for (const selector of [".rk-tabs__indicator", ".rk-segment", ".rk-switch__thumb"]) {
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
