/**
 * Verification gate hosts: what `/admin/api/gate` returns, the edit form ↔
 * request body, and the page's fixed copy. Pure (unit-tested in
 * test/admin-ui.test.js).
 */

export interface GateHost {
  host: string;
  upstream: string;
  exemptPaths: string[];
  enabled: boolean;
  /** `config`: GATE_UPSTREAMS in the deployment, read-only here. */
  source: "admin" | "config";
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GateForm {
  host: string;
  upstream: string;
  exemptPaths: string;
  enabled: boolean;
}

export function gateForm(host: GateHost | null): GateForm {
  return {
    host: host?.host ?? "",
    upstream: host?.upstream ?? "",
    exemptPaths: (host?.exemptPaths ?? []).join("\n"),
    enabled: host ? host.enabled : true,
  };
}

/** The PATCH body; POST adds the lowercased `host`. */
export function gateBody(form: GateForm, creating: boolean) {
  const body: {
    host?: string;
    upstream: string;
    exemptPaths: string[];
    enabled: boolean;
  } = {
    upstream: form.upstream.trim(),
    exemptPaths: form.exemptPaths
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    enabled: form.enabled,
  };
  if (creating) body.host = form.host.trim().toLowerCase();
  return body;
}

export function isReadOnly(host: GateHost | null): boolean {
  return host?.source === "config";
}

export function gateDialogTitle(host: GateHost | null): string {
  if (!host) return "添加域名";
  return isReadOnly(host) ? "查看域名" : "编辑域名";
}

export function sourceLabel(host: GateHost): string {
  return isReadOnly(host) ? "部署配置" : "后台添加";
}

export const GATE_COPY = {
  lede: "为整站启用验证页：访客须先完成验证，方可访问源站。",
  notes: [
    "仅当该域名已通过 Worker 路由指向本服务时，网关设置才会生效。",
    "修改将在 60 秒内生效。",
  ],
  empty: "暂无网关域名。",
  readOnly: "该域名由部署配置定义，需修改部署配置并重新部署。",
  hostHint: "小写主机名，不含协议与端口。创建后不可修改。",
  upstreamHint: "以 https:// 开头的源站地址，不含路径。",
  exemptHint:
    "每行一条，最多 50 条。以 / 结尾的条目按前缀匹配；其余条目匹配该路径本身及其下级路径（如 /api 同时匹配 /api/v1）。命中的请求无需验证，直接转发至源站。",
  enabledHint: "停用后，该域名的所有请求将直接转发至源站，不再要求验证。",
  added: "已添加，设置将在 60 秒内生效。",
  saved: "已保存，修改将在 60 秒内生效。",
  deleted: "已删除。",
} as const;

export function deleteGateText(host: GateHost): string {
  return `删除 ${host.host} 的网关设置后无法恢复，修改将在 60 秒内生效。`;
}
