/**
 * Statistics: the `/admin/api/stats` response, its labels, and every number
 * and time the page derives from it. Pure functions (unit-tested in
 * test/admin-ui.test.js); the page (stats-view.tsx) only lays them out.
 */

export const EVENT_LABELS = {
  challenge_issued: "发出挑战",
  redeem_ok: "验证通过",
  redeem_fail: "验证失败",
  siteverify_ok: "服务端核验成功",
  siteverify_fail: "服务端核验失败",
  gate_shown: "显示验证页",
  gate_pass: "发放通行凭证",
  gate_pass_fail: "通行凭证发放失败",
  rate_limited: "触发限流",
} as const;

export type EventName = keyof typeof EVENT_LABELS;
export const EVENTS = Object.keys(EVENT_LABELS) as EventName[];

export type Counts = Record<EventName, number>;

export type Range = "24h" | "7d" | "30d";
export const RANGES: ReadonlyArray<readonly [Range, string]> = [
  ["24h", "24 小时"],
  ["7d", "7 天"],
  ["30d", "30 天"],
];

export type ReasonGroup =
  | "redeem_fail"
  | "siteverify_fail"
  | "gate_pass_fail"
  | "rate_limited";

export interface SiteRow extends Counts {
  site: string;
  label: string;
  kind: string;
}

export interface StatsData {
  range: Range;
  bucket: "hour" | "day";
  /** The offset the API used (minutes east of UTC, rounded to a whole hour). */
  tz: number;
  from: string;
  to: string;
  generatedAt: string;
  site: string | null;
  totals: Counts;
  reasons: Partial<Record<ReasonGroup, Record<string, number>>>;
  series: Array<Counts & { t: string }>;
  bySite: SiteRow[];
}

const REASON_LABELS: Readonly<Record<string, string>> = {
  invalid_solution: "计算结果无效",
  expired: "挑战已过期",
  already_redeemed: "重复提交",
  instr_blocked: "环境检测未通过",
  instr_timeout: "环境检测超时",
  invalid_token: "挑战令牌无效",
  bad_request: "请求格式错误",
  internal: "服务内部错误",
  other: "其他",
  invalid_secret: "密钥错误",
  token_not_found: "令牌不存在",
  token_expired: "令牌已过期",
};

const RATE_LIMIT_LABELS: Readonly<Record<string, string>> = {
  challenge: "获取挑战",
  redeem: "提交结果",
  gate_pass: "网关放行",
  siteverify: "服务端核验",
};

export const KIND_LABELS: Readonly<Record<string, string>> = {
  site: "站点",
  gate: "验证网关",
  default: "旧接口",
};

export const REASON_GROUPS: readonly ReasonGroup[] = [
  "redeem_fail",
  "siteverify_fail",
  "gate_pass_fail",
  "rate_limited",
];

export function reasonLabel(group: ReasonGroup, reason: string): string {
  const labels = group === "rate_limited" ? RATE_LIMIT_LABELS : REASON_LABELS;
  return labels[reason] || reason || "未注明";
}

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] || kind;
}

const numberFormat = new Intl.NumberFormat("zh-CN");
export const fmt = (n: number | undefined | null): string =>
  numberFormat.format(n || 0);
const pad2 = (n: number) => String(n).padStart(2, "0");

export function percent(part: number, total: number): string {
  return total ? `${((part / total) * 100).toFixed(1)}%` : "—";
}

/** 验证通过 ÷（验证通过 + 验证失败）, or "—" when neither happened. */
export function passRate(row: Partial<Counts>): string {
  const ok = row.redeem_ok || 0;
  return percent(ok, ok + (row.redeem_fail || 0));
}

/** No event of any kind in the period. */
export function isEmpty(totals: Partial<Counts>): boolean {
  return EVENTS.every((name) => !totals[name]);
}

function dayText(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function clockText(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * Bucket names: axis ticks are short (`long` false), tooltips and tables
 * spell it out. Hour buckets are named in the browser's local time (with
 * minutes, so a half-hour zone reads 10:30–11:30). Day buckets follow the
 * API's day boundaries, which use `tz` rounded to a whole hour: in UTC+5:30 a
 * "day" starts at 23:30 local time the evening before, so its date is read in
 * that rounded offset rather than from the local clock.
 */
export function bucketText(
  iso: string,
  bucket: StatsData["bucket"],
  long: boolean,
  tz: number,
): string {
  if (bucket !== "hour") {
    const d = new Date(Date.parse(iso) + (tz || 0) * 60_000);
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    return long ? `${month}月${day}日` : `${month}/${day}`;
  }
  const start = new Date(iso);
  if (!long) return clockText(start);
  const end = new Date(start.getTime() + 3_600_000);
  return `${dayText(start)} ${clockText(start)}–${clockText(end)}`;
}

/** "UTC+6", "UTC-4", "UTC+5:30", "UTC". */
export function offsetText(tz: number): string {
  if (!tz) return "UTC";
  const abs = Math.abs(tz);
  const minutes = abs % 60;
  const hours = (abs - minutes) / 60;
  return `UTC${tz < 0 ? "-" : "+"}${hours}${minutes ? `:${pad2(minutes)}` : ""}`;
}

export function zonedText(iso: string, tz: number): string {
  const d = new Date(Date.parse(iso) + (tz || 0) * 60_000);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * The period line, read in the API's own offset `data.tz` like the day
 * buckets, so it names the same instants the counts cover. When that differs
 * from the browser's offset (a half-hour zone) the offset used is stated;
 * otherwise the times are simply the local ones.
 */
export function periodText(
  data: Pick<StatsData, "tz" | "from" | "to" | "generatedAt">,
  browserTz: number,
): string {
  const tz = data.tz || 0;
  const zone = tz === browserTz ? "本地时间" : `按 ${offsetText(tz)} 统计`;
  return `统计区间：${zonedText(data.from, tz)} 至 ${zonedText(data.to, tz)}（${zone}），更新于 ${zonedText(data.generatedAt, tz)}。`;
}

export const PERIOD_PLACEHOLDER = "按时间段汇总的挑战、验证与网关计数。";

/** The browser's offset at `iso` (minutes east of UTC), as the API takes it. */
export function browserOffset(iso?: string): number {
  return -(iso ? new Date(iso) : new Date()).getTimezoneOffset();
}

export function statsQuery(range: Range, site: string): string {
  const query = new URLSearchParams({
    range,
    tz: String(browserOffset()),
  });
  if (site) query.set("site", site);
  return `/stats?${query}`;
}

export interface Metric {
  label: string;
  value: string;
  hint: string;
}

/** The five headline numbers. 触发限流 is sampled at 1 in 10 (stats.js). */
export function metrics(totals: Counts): Metric[] {
  return [
    { label: "发出挑战", value: fmt(totals.challenge_issued), hint: "" },
    { label: "验证通过", value: fmt(totals.redeem_ok), hint: "" },
    { label: "验证失败", value: fmt(totals.redeem_fail), hint: "" },
    {
      label: "通过率",
      value: passRate(totals),
      hint: "验证通过 ÷（验证通过 + 验证失败）",
    },
    {
      label: "触发限流",
      value: fmt(totals.rate_limited),
      hint: "按 1/10 抽样估算",
    },
  ];
}

export const SITEVERIFY_COUNTS: ReadonlyArray<readonly [EventName, string]> = [
  ["siteverify_ok", "成功"],
  ["siteverify_fail", "失败"],
];

export const GATE_COUNTS: ReadonlyArray<readonly [EventName, string]> = [
  ["gate_shown", "显示验证页"],
  ["gate_pass", "发放通行凭证"],
  ["gate_pass_fail", "发放失败"],
];

export interface ReasonRow {
  reason: string;
  label: string;
  count: string;
  share: string;
}

export interface ReasonSection {
  group: ReasonGroup;
  /** "验证失败（共 187 次）" */
  title: string;
  rows: ReasonRow[];
}

/** Failure and rate-limit reasons, by group, most frequent first. */
export function reasonSections(
  reasons: StatsData["reasons"] | undefined,
): ReasonSection[] {
  const sections: ReasonSection[] = [];
  for (const group of REASON_GROUPS) {
    const entries = Object.entries(reasons?.[group] || {})
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    if (!entries.length) continue;
    const total = entries.reduce((sum, [, n]) => sum + n, 0);
    sections.push({
      group,
      title: `${EVENT_LABELS[group]}（共 ${fmt(total)} 次）`,
      rows: entries.map(([reason, n]) => ({
        reason,
        label: reasonLabel(group, reason),
        count: fmt(n),
        share: percent(n, total),
      })),
    });
  }
  return sections;
}

export const ALL_SITES = "";

export interface SiteOption {
  value: string;
  label: string;
}

/**
 * The site filter: 全部站点, then every row of `bySite` ("名称（类型）"); a
 * selected site missing from the list stays selectable under its own key.
 */
export function siteOptions(rows: SiteRow[], selected: string): SiteOption[] {
  const options: SiteOption[] = [{ value: ALL_SITES, label: "全部站点" }];
  for (const row of rows) {
    options.push({ value: row.site, label: `${row.label}（${kindLabel(row.kind)}）` });
  }
  if (selected && !rows.some((row) => row.site === selected)) {
    options.push({ value: selected, label: selected });
  }
  return options;
}

/** The chart's accessible name. */
export function chartLabel(data: StatsData): string {
  return `验证结果趋势图，共 ${data.series.length} 个时段，验证通过合计 ${fmt(data.totals.redeem_ok)} 次，验证失败合计 ${fmt(data.totals.redeem_fail)} 次。`;
}

/** The first column header of a per-bucket table. */
export function bucketHeader(bucket: StatsData["bucket"]): string {
  return bucket === "hour" ? "时段（本地时间）" : "日期（本地时间）";
}

export const STATS_NOTES = {
  empty: "所选时间范围内没有记录。",
  reasonsEmpty: "所选时间范围内没有失败或限流记录。",
  bySiteEmpty: "暂无站点数据。",
  chartHint:
    "将指针悬停于柱上，或聚焦图表后使用左右方向键，可查看各时段的数值。",
  footnote: "统计数据仅为按小时汇总的计数，不包含任何访客个人信息。",
} as const;
