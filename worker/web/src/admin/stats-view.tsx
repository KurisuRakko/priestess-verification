import {
  Button,
  EmptyState,
  Field,
  List,
  NumberRoll,
  SegmentedChoice,
  Select,
  Skeleton,
} from "@rakko/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, isUnauthenticated } from "./api";
import { describeError } from "./errors";
import { RefreshIcon, SelectArrowIcon } from "./icons";
import type { Range, StatsData } from "./stats";
import {
  ALL_SITES,
  GATE_COUNTS,
  PERIOD_PLACEHOLDER,
  RANGES,
  SITEVERIFY_COUNTS,
  STATS_NOTES,
  browserOffset,
  fmt,
  isEmpty,
  metrics,
  periodText,
  riskRows,
  siteOptions,
  statsQuery,
} from "./stats";
import { BySiteTable, ReasonsTable, TrendChart } from "./tables";
import { Notice, PageHead } from "./ui";

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="pv-panel" aria-labelledby={id}>
      <h2 className="pv-panel__title" id={id}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Counts({
  title,
  items,
  totals,
}: {
  title: string;
  items: ReadonlyArray<readonly [keyof StatsData["totals"], string]>;
  totals: StatsData["totals"];
}) {
  return (
    <List.Group header={title} className="pv-counts">
      {items.map(([event, label]) => (
        <List.Row
          key={event}
          detail={<NumberRoll value={fmt(totals[event])} />}
        >
          {label}
        </List.Row>
      ))}
    </List.Group>
  );
}

/** 提高难度: challenges issued with a raised difficulty, by reason. */
function RiskCounts({ reasons }: { reasons: StatsData["reasons"] }) {
  const rows = riskRows(reasons);
  return (
    <List.Group header="提高难度" className="pv-counts">
      {rows.length ? (
        rows.map((row) => (
          <List.Row
            key={row.reason}
            detail={<NumberRoll value={fmt(row.count)} />}
          >
            {row.label}
          </List.Row>
        ))
      ) : (
        <List.Row>{STATS_NOTES.riskEmpty}</List.Row>
      )}
    </List.Group>
  );
}

function Detail({ data }: { data: StatsData }) {
  return (
    <div className="pv-stats-detail">
      <Section id="stats-chart-title" title="验证结果趋势">
        <TrendChart data={data} />
      </Section>
      <Section id="stats-reasons-title" title="失败原因">
        <ReasonsTable data={data} />
      </Section>
      <div className="pv-pair">
        <Counts
          title="服务端核验"
          items={SITEVERIFY_COUNTS}
          totals={data.totals}
        />
        <Counts title="验证网关" items={GATE_COUNTS} totals={data.totals} />
        <RiskCounts reasons={data.reasons} />
      </div>
      <Section id="stats-sites-title" title="各站点">
        <BySiteTable data={data} />
      </Section>
    </div>
  );
}

/** 统计: hourly counts for a period, overall or for one site. */
export function StatsView({ active }: { active: boolean }) {
  const [range, setRange] = useState<Range>("24h");
  const [site, setSite] = useState(ALL_SITES);
  const [data, setData] = useState<StatsData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setBusy(true);
    try {
      const next = await api<StatsData>(statsQuery(range, site));
      if (mine !== seq.current) return;
      setError("");
      setData(next);
    } catch (failure) {
      if (mine !== seq.current || isUnauthenticated(failure)) return;
      setError(
        `统计数据加载失败：${describeError(failure as Error, { 400: "统计查询参数无效。" })}`,
      );
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }, [range, site]);

  // Loaded each time the tab is shown, and on every filter change.
  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const options = siteOptions(data?.bySite ?? [], site);
  const empty = data ? isEmpty(data.totals) : false;

  return (
    <>
      <PageHead
        title="统计"
        lede={
          data ? periodText(data, browserOffset(data.to)) : PERIOD_PLACEHOLDER
        }
        action={
          <Button icon={<RefreshIcon />} onClick={() => load()}>
            刷新
          </Button>
        }
      />
      <div className="pv-toolbar">
        <SegmentedChoice.Root
          aria-label="时间范围"
          className="pv-range"
          value={range}
          onValueChange={(value) => setRange(value as Range)}
        >
          {RANGES.map(([value, label]) => (
            <SegmentedChoice.Item key={value} value={value}>
              {label}
            </SegmentedChoice.Item>
          ))}
        </SegmentedChoice.Root>
        <Field.Root className="pv-toolbar__site">
          <Field.Label>站点</Field.Label>
          <Select.Root
            items={options}
            value={site}
            onValueChange={(value) =>
              setSite((value as string | null) ?? ALL_SITES)
            }
          >
            <Select.Trigger className="pv-select">
              <Select.Value />
              <Select.Icon>
                <SelectArrowIcon />
              </Select.Icon>
            </Select.Trigger>
            <Select.Popup>
              {options.map((option) => (
                <Select.Item key={option.value} value={option.value}>
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator />
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Root>
        </Field.Root>
      </div>
      <Notice>{error}</Notice>
      {data ? (
        <div className="pv-stats" aria-busy={busy}>
          <ul className="pv-metrics" aria-label="主要指标">
            {metrics(data.totals, data.reasons).map((metric) => (
              <li className="pv-metric" key={metric.label}>
                <span className="pv-metric__label">{metric.label}</span>
                <span className="pv-metric__value">
                  <NumberRoll value={metric.value} />
                </span>
                {metric.hint ? (
                  <span className="pv-metric__hint">{metric.hint}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {empty ? (
            <EmptyState className="pv-empty" layout="none">
              {STATS_NOTES.empty}
            </EmptyState>
          ) : (
            <Detail data={data} />
          )}
        </div>
      ) : busy && !error ? (
        <ul className="pv-metrics" aria-busy="true" aria-label="主要指标">
          {[0, 1, 2, 3, 4].map((slot) => (
            <li className="pv-metric" key={slot}>
              <Skeleton lines={2} />
            </li>
          ))}
        </ul>
      ) : null}
      <p className="pv-footnote">{STATS_NOTES.footnote}</p>
    </>
  );
}
