/**
 * The console's tables and its one chart, on Rakko Design's Table and
 * BarChart: the statistics trend (with a table view), failure reasons,
 * per-site counts, and the gate host list.
 */
import {
  BarChart,
  Badge,
  Button,
  Collapsible,
  EmptyState,
  Table,
} from "@rakko/react";
import { useState } from "react";

import type { GateHost } from "./gate";
import { isReadOnly, sourceLabel } from "./gate";
import { ChevronIcon } from "./icons";
import type { StatsData } from "./stats";
import {
  STATS_NOTES,
  bucketHeader,
  bucketText,
  chartLabel,
  fmt,
  kindLabel,
  passRate,
  reasonSections,
} from "./stats";

/** 验证结果趋势: stacked 验证通过 / 验证失败 per bucket, plus a table view. */
export function TrendChart({ data }: { data: StatsData }) {
  const [asTable, setAsTable] = useState(false);
  const label = (iso: string, long: boolean) =>
    bucketText(iso, data.bucket, long, data.tz);
  return (
    <>
      <BarChart
        aria-label={chartLabel(data)}
        data={data.series.map((row) => ({
          key: row.t,
          label: label(row.t, false),
          values: { ok: row.redeem_ok, fail: row.redeem_fail },
        }))}
        series={[
          { key: "ok", label: "验证通过", tone: "success" },
          { key: "fail", label: "验证失败", tone: "danger" },
        ]}
        formatValue={fmt}
        tooltipTitle={(datum) => label(datum.key, true)}
        tooltipExtra={(datum) => [
          {
            label: "通过率",
            value: passRate({
              redeem_ok: datum.values.ok,
              redeem_fail: datum.values.fail,
            }),
          },
        ]}
      />
      <p className="pv-hint">{STATS_NOTES.chartHint}</p>
      <Collapsible.Root open={asTable} onOpenChange={setAsTable} className="pv-advanced">
        <Collapsible.Trigger>
          <span>以表格查看</span>
          <span className="pv-advanced__mark" aria-hidden="true">
            <ChevronIcon />
          </span>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Table.Root aria-label="验证结果趋势" density="compact">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{bucketHeader(data.bucket)}</Table.HeaderCell>
                <Table.HeaderCell numeric>验证通过</Table.HeaderCell>
                <Table.HeaderCell numeric>验证失败</Table.HeaderCell>
                <Table.HeaderCell numeric>通过率</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.series.map((row) => (
                <Table.Row key={row.t}>
                  <Table.Cell>{label(row.t, true)}</Table.Cell>
                  <Table.Cell numeric>{fmt(row.redeem_ok)}</Table.Cell>
                  <Table.Cell numeric>{fmt(row.redeem_fail)}</Table.Cell>
                  <Table.Cell numeric>{passRate(row)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Collapsible.Content>
      </Collapsible.Root>
    </>
  );
}

/** 失败原因: one group row per kind of failure, reasons most frequent first. */
export function ReasonsTable({ data }: { data: StatsData }) {
  const sections = reasonSections(data.reasons);
  if (!sections.length) {
    return <p className="pv-hint">{STATS_NOTES.reasonsEmpty}</p>;
  }
  return (
    <Table.Root aria-label="失败原因">
      <Table.Header>
        <Table.Row>
          <Table.HeaderCell>原因</Table.HeaderCell>
          <Table.HeaderCell numeric>次数</Table.HeaderCell>
          <Table.HeaderCell numeric>占比</Table.HeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {sections.flatMap((section) => [
          <Table.GroupRow key={section.group}>{section.title}</Table.GroupRow>,
          ...section.rows.map((row) => (
            <Table.Row key={`${section.group}:${row.reason}`}>
              <Table.Cell>{row.label}</Table.Cell>
              <Table.Cell numeric>{row.count}</Table.Cell>
              <Table.Cell numeric>{row.share}</Table.Cell>
            </Table.Row>
          )),
        ])}
      </Table.Body>
    </Table.Root>
  );
}

/** 各站点: every site's counts in the period (stacks into cards when narrow). */
export function BySiteTable({ data }: { data: StatsData }) {
  const rows = data.bySite || [];
  if (!rows.length) {
    return (
      <EmptyState layout="none" className="pv-empty">
        {STATS_NOTES.bySiteEmpty}
      </EmptyState>
    );
  }
  return (
    <Table.Root aria-label="各站点" layout="stack">
      <Table.Header>
        <Table.Row>
          <Table.HeaderCell>站点</Table.HeaderCell>
          <Table.HeaderCell>类型</Table.HeaderCell>
          <Table.HeaderCell numeric>发出挑战</Table.HeaderCell>
          <Table.HeaderCell numeric>验证通过</Table.HeaderCell>
          <Table.HeaderCell numeric>验证失败</Table.HeaderCell>
          <Table.HeaderCell numeric>通过率</Table.HeaderCell>
          <Table.HeaderCell numeric>触发限流</Table.HeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((row) => (
          <Table.Row key={row.site}>
            <Table.Cell label="站点">{row.label}</Table.Cell>
            <Table.Cell label="类型">{kindLabel(row.kind)}</Table.Cell>
            <Table.Cell label="发出挑战" numeric>
              {fmt(row.challenge_issued)}
            </Table.Cell>
            <Table.Cell label="验证通过" numeric>
              {fmt(row.redeem_ok)}
            </Table.Cell>
            <Table.Cell label="验证失败" numeric>
              {fmt(row.redeem_fail)}
            </Table.Cell>
            <Table.Cell label="通过率" numeric>
              {passRate(row)}
            </Table.Cell>
            <Table.Cell label="触发限流" numeric>
              {fmt(row.rate_limited)}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}

/** 验证网关: the gate hosts, stacked into cards on narrow screens. */
export function GateTable({
  hosts,
  onOpen,
  onDelete,
}: {
  hosts: GateHost[];
  onOpen: (host: GateHost) => void;
  onDelete: (host: GateHost) => void;
}) {
  return (
    <Table.Root aria-label="网关域名" layout="stack">
      <Table.Header>
        <Table.Row>
          <Table.HeaderCell>域名</Table.HeaderCell>
          <Table.HeaderCell>源站地址</Table.HeaderCell>
          <Table.HeaderCell>状态</Table.HeaderCell>
          <Table.HeaderCell numeric>放行路径</Table.HeaderCell>
          <Table.HeaderCell>来源</Table.HeaderCell>
          <Table.HeaderCell align="end">
            <span className="pv-visually-hidden">操作</span>
          </Table.HeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {hosts.map((host) => (
          <Table.Row key={host.host}>
            <Table.Cell label="域名">
              <span className="pv-mono">{host.host}</span>
            </Table.Cell>
            <Table.Cell label="源站地址">
              <span className="pv-mono">{host.upstream}</span>
            </Table.Cell>
            <Table.Cell label="状态">
              <Badge tone={host.enabled ? "success" : "neutral"} size="sm">
                {host.enabled ? "已启用" : "已停用"}
              </Badge>
            </Table.Cell>
            <Table.Cell label="放行路径" numeric>
              {fmt(host.exemptPaths?.length)}
            </Table.Cell>
            <Table.Cell label="来源">{sourceLabel(host)}</Table.Cell>
            <Table.Cell align="end">
              <div className="pv-row-actions">
                {isReadOnly(host) ? (
                  <Button onClick={() => onOpen(host)}>查看</Button>
                ) : (
                  <>
                    <Button onClick={() => onOpen(host)}>编辑</Button>
                    <Button variant="danger" onClick={() => onDelete(host)}>
                      删除
                    </Button>
                  </>
                )}
              </div>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
