import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type {
  FocusEvent,
  HTMLAttributes,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import { cx } from '../cx'

export type BarChartTone = 'accent' | 'success' | 'danger' | 'warning' | 'neutral'

export interface BarChartSeries {
  /** 对应 datum.values 的键。 */
  key: string
  /** 图例、提示框与桶的可访问名称里的系列名。 */
  label: string
  /** 语义色，默认 accent；danger 取 --color-error，neutral 取 --color-neutral-6。 */
  tone?: BarChartTone
}

export interface BarChartDatum {
  /** 桶的稳定标识（React key）。 */
  key: string
  /** 横轴标签，也是提示框的默认标题。 */
  label: string
  /** 各系列数值；缺失、负数与非有限值按 0 处理。 */
  values: Record<string, number>
}

export interface BarChartExtraItem {
  label: ReactNode
  value: ReactNode
}

export interface BarChartProps<D extends BarChartDatum = BarChartDatum>
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'aria-label'> {
  /** 每项一个桶，按显示顺序排列。 */
  data: readonly D[]
  /** 系列按顺序自下而上堆叠（或从左到右并排），图例同序。 */
  series: readonly BarChartSeries[]
  /** 默认 true；false 时同一桶内各系列并排。 */
  stacked?: boolean
  /** 绘图区高度（px），默认 200；不含横轴标签。 */
  height?: number
  /** 图表整体名称，落在可聚焦的图表区域上。 */
  'aria-label': string
  /** 数值格式化（提示框、纵轴刻度、桶的可访问名称），默认 toLocaleString()。 */
  formatValue?: (value: number) => string
  /** 提示框标题，默认 datum.label。 */
  tooltipTitle?: (datum: D) => ReactNode
  /** 提示框在系列数值之后追加的行，例如「通过率 61.8%」。 */
  tooltipExtra?: (datum: D) => BarChartExtraItem[]
  /** 横轴最多显示的标签数，默认 8；首尾两桶始终保留，宽度不够时进一步抽稀。 */
  maxXLabels?: number
}

/** tone → 语义色 token。图例色块、柱子、提示框色块共用这一张表。 */
export const BAR_CHART_TONE_COLOR: Record<BarChartTone, string> = {
  accent: 'var(--color-accent)',
  success: 'var(--color-success)',
  danger: 'var(--color-error)',
  warning: 'var(--color-warning)',
  // n-5 只作描边，对纸面不足 3:1；柱子是图形对象，取 n-6
  neutral: 'var(--color-neutral-6)',
}

// 几何常量（px）。字号与 bar-chart.css 的 11px 轴标签同步，用于估算标签宽度。
const AXIS_FONT_PX = 11
const PLOT_TOP = 8 // 顶部留白：最上一条刻度标签以网格线为中线，不能被裁掉
const X_AXIS_HEIGHT = 22
const Y_LABEL_GAP = 8
const RIGHT_PAD = 4
const MAX_BAR_WIDTH = 40
const MAX_GROUP_SERIES_WIDTH = 16
const FALLBACK_WIDTH = 640 // 首次测量前（SSR、jsdom）的宽度

function safeValue(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function roundFloat(value: number): number {
  return Number(value.toPrecision(12))
}

export interface BarChartTicks {
  /** 自 0 起的刻度值，3～5 个。 */
  ticks: number[]
  /** 纵轴上限 = 最后一个刻度。 */
  max: number
}

/**
 * 「好看」的纵轴刻度：0 起，步长取 {1, 2, 2.5, 5} × 10^n 中最小的、能让 max 落在 4 格以内的那个，
 * 至少 2 格（3 条线）。integerOnly（数据全是整数）时步长也必须是整数，避免计数出现 0.5。
 * max ≤ 0（全 0 或空数据）按整数 1 处理，仍得到 0、1、2 三条线。
 */
export function niceTicks(max: number, integerOnly = true): BarChartTicks {
  const top = Number.isFinite(max) && max > 0 ? max : 1
  const intOnly = integerOnly || !(max > 0)
  let exponent = Math.floor(Math.log10(top / 4))
  if (intOnly) exponent = Math.max(exponent, 0)
  let step = 0
  for (let e = exponent; step === 0; e += 1) {
    for (const m of [1, 2, 2.5, 5]) {
      const candidate = roundFloat(m * 10 ** e)
      if (intOnly && !Number.isInteger(candidate)) continue
      if (Math.ceil(roundFloat(top / candidate)) <= 4) {
        step = candidate
        break
      }
    }
  }
  const count = Math.max(2, Math.ceil(roundFloat(top / step)))
  const ticks = Array.from({ length: count + 1 }, (_, i) => roundFloat(i * step))
  return { ticks, max: ticks[ticks.length - 1] }
}

/** 估算一行轴标签的宽度：CJK 与全角字符按 1em，其余按 0.62em（tabular 数字约 0.6em）。 */
export function estimateLabelWidth(text: string, fontPx = AXIS_FONT_PX): number {
  let width = 0
  for (const ch of text) {
    width += (ch.codePointAt(0) ?? 0) >= 0x2e80 ? fontPx : fontPx * 0.62
  }
  return width
}

/**
 * 横轴标签抽稀：首尾两个桶的标签始终保留（时间序列里最新一桶最重要），中间按等步长自第 0 个起取，
 * 总数不超过 min(maxLabels, 宽度放得下的个数)。slotsAvailable 由调用方按绘图区宽度 / 最长标签宽度算出，
 * 据此得到相邻标签的最小间距（以桶计）；离末桶不足 1.5 倍间距的中间标签让给末桶
 * （末桶标签会被夹回绘图区内，向左最多偏移约半个标签宽）。只放得下一个时只留末桶。返回要显示标签的桶下标。
 */
export function pickLabelIndices(
  count: number,
  maxLabels: number,
  slotsAvailable = Number.POSITIVE_INFINITY,
): number[] {
  if (count <= 0) return []
  const limit = Math.max(1, Math.min(count, Math.floor(maxLabels), Math.floor(slotsAvailable)))
  if (limit >= count) return Array.from({ length: count }, (_, i) => i)
  if (limit < 2) return [count - 1]
  const last = count - 1
  const minGap = Number.isFinite(slotsAvailable) ? Math.max(1, Math.ceil(count / slotsAvailable)) : 1
  const step = Math.max(minGap, Math.ceil(last / (limit - 1)))
  const tailGap = Math.max(1, Math.ceil(minGap * 1.5))
  const indices = [0]
  for (let i = step; last - i >= tailGap; i += step) indices.push(i)
  indices.push(last)
  return indices
}

/** 桶内各系列的数值（已清洗）与堆叠总量。 */
function bucketValues(datum: BarChartDatum, series: readonly BarChartSeries[]) {
  const values = series.map((s) => safeValue(datum.values[s.key]))
  return { values, total: values.reduce((sum, v) => sum + v, 0) }
}

function defaultFormat(value: number): string {
  return value.toLocaleString()
}

/**
 * 测量容器宽度：首帧前同步读一次 clientWidth，之后由 ResizeObserver 的 contentRect 跟随。
 * 两者都是布局尺寸，不含祖先 transform / scale：getBoundingClientRect 会把 Dialog 入场的 scale(1.08)
 * 算进去，而 transform 结束后 ResizeObserver 不会再触发，SVG 就一直比容器宽。
 */
function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(Math.floor(el.clientWidth))
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry) setWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/**
 * rk-bar-chart：纯 SVG 柱状图（不依赖图表库），默认堆叠。
 * 绘图区宽度跟随容器（ResizeObserver），像素几何在 React 里算好再画，文字不随缩放变形。
 * SVG 绝对定位、容器只给高度：SVG 的像素宽不参与容器的固有尺寸，否则 grid / flex 子项会被撑宽。
 * 交互：悬停桶或键盘聚焦时，复用 Base UI Tooltip 的定位（受控 open + anchor 指向当前桶的柱顶）
 * 与 rk-tooltip 的外观显示提示。键盘用 roving tabindex：每个桶是一个可聚焦的 role="img"，整张图只有一个
 * Tab 停靠点，左右方向键 / Home / End 在桶之间移动焦点；桶的可访问名称是「标题：系列 值，…，附加项 值」，
 * 读屏在浏览模式下也能用虚拟光标逐桶读到，不依赖 aria-live。
 * 不内置表格视图：需要「以表格查看」时由消费方与 Table 组合。
 */
export function BarChart<D extends BarChartDatum = BarChartDatum>({
  data,
  series,
  stacked = true,
  height = 200,
  'aria-label': ariaLabel,
  formatValue = defaultFormat,
  tooltipTitle,
  tooltipExtra,
  maxXLabels = 8,
  className,
  ...props
}: BarChartProps<D>) {
  const [plotRef, measuredWidth] = useContainerWidth()
  const rootRef = useRef<HTMLDivElement>(null)
  const anchorRefs = useRef<Array<SVGRectElement | null>>([])
  const bucketRefs = useRef<Array<SVGGElement | null>>([])
  const idBase = useId()
  // active：显示提示的桶（悬停或聚焦）；hidden：Escape 收起提示但保留当前桶；
  // tabStop：roving tabindex 的停靠桶，焦点离开后仍记住，再次 Tab 进来回到这里。
  const [active, setActive] = useState<number | null>(null)
  const [hidden, setHidden] = useState(false)
  const [tabStop, setTabStop] = useState(0)
  const focusedRef = useRef(false)

  const count = data.length
  const activeIndex = active != null && active < count ? active : null
  const rovingIndex = Math.min(tabStop, Math.max(0, count - 1))

  // 触屏点按后 pointerleave 紧跟 pointerup，不能靠它收起；改为点到图表外时收起。
  useEffect(() => {
    if (activeIndex == null) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      if (!focusedRef.current) setActive(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [activeIndex])

  // ---- 刻度与几何 ----
  const buckets = data.map((d) => bucketValues(d, series))
  const peak = buckets.reduce(
    (m, b) => Math.max(m, stacked ? b.total : Math.max(0, ...b.values)),
    0,
  )
  const integerOnly = buckets.every((b) => b.values.every(Number.isInteger))
  const { ticks, max: domainMax } = niceTicks(peak, integerOnly)
  const tickLabels = ticks.map((t) => formatValue(t))

  const width = measuredWidth > 0 ? measuredWidth : FALLBACK_WIDTH
  const gutter = Math.ceil(Math.max(...tickLabels.map((t) => estimateLabelWidth(t)))) + Y_LABEL_GAP
  const plotLeft = gutter
  const plotWidth = Math.max(1, width - gutter - RIGHT_PAD)
  const svgHeight = PLOT_TOP + height + X_AXIS_HEIGHT
  const baseline = PLOT_TOP + height
  const yOf = (value: number) => baseline - (value / domainMax) * height
  const slot = count > 0 ? plotWidth / count : plotWidth

  const barWidth = Math.max(1, Math.min(slot * 0.7, MAX_BAR_WIDTH))
  const groupSeriesWidth =
    series.length > 0
      ? Math.max(1, Math.min((slot * 0.8) / series.length, MAX_GROUP_SERIES_WIDTH))
      : 0

  const longestLabel = data.reduce((m, d) => Math.max(m, estimateLabelWidth(d.label)), 0)
  const labelIndices = new Set(
    pickLabelIndices(count, maxXLabels, plotWidth / (longestLabel + 12)),
  )

  // ---- 交互 ----
  const showBucket = (index: number) => {
    setActive(index)
    setHidden(false)
  }

  const focusBucket = (index: number) => {
    bucketRefs.current[Math.min(Math.max(index, 0), count - 1)]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return
    let handled = true
    switch (event.key) {
      case 'ArrowRight':
        focusBucket(rovingIndex + 1)
        break
      case 'ArrowLeft':
        focusBucket(rovingIndex - 1)
        break
      case 'Home':
        focusBucket(0)
        break
      case 'End':
        focusBucket(count - 1)
        break
      case 'Escape':
        handled = !hidden && activeIndex != null
        setHidden(true)
        break
      default:
        handled = false
    }
    if (handled) event.preventDefault()
  }

  const onBucketFocus = (index: number) => {
    focusedRef.current = true
    setTabStop(index)
    showBucket(index)
  }

  // 焦点在桶之间移动时 relatedTarget 仍在绘图区内，不收起；离开整张图才收起。
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    focusedRef.current = false
    setActive(null)
  }

  const onPointerLeave = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'touch' || focusedRef.current) return
    setActive(null)
  }

  // ---- 提示内容（提示框与桶的可访问名称同源） ----
  const titleOf = (d: D): ReactNode => (tooltipTitle ? tooltipTitle(d) : d.label)
  const extraOf = (d: D): BarChartExtraItem[] => (tooltipExtra ? tooltipExtra(d) : [])

  const tooltipDatum = activeIndex != null ? data[activeIndex] : null
  const tooltipOpen = tooltipDatum != null && !hidden

  return (
    <div {...props} ref={rootRef} className={cx('rk-bar-chart', className)}>
      {series.length > 0 && (
        <ul className="rk-bar-chart__legend">
          {series.map((s) => (
            <li key={s.key} className="rk-bar-chart__legend-item">
              <span
                className="rk-bar-chart__swatch"
                style={{ background: BAR_CHART_TONE_COLOR[s.tone ?? 'accent'] }}
                aria-hidden="true"
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      <div
        ref={plotRef}
        className="rk-bar-chart__plot"
        style={{ height: svgHeight }}
        role="group"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      >
        <svg
          className="rk-bar-chart__svg"
          width={width}
          height={svgHeight}
          role="presentation"
          focusable="false"
          onPointerLeave={onPointerLeave}
        >
          <g className="rk-bar-chart__grid" aria-hidden="true">
            {ticks.map((tick, i) => {
              const y = Math.round(yOf(tick)) + 0.5
              return (
                <Fragment key={tick}>
                  <line
                    className={i === 0 ? 'rk-bar-chart__baseline' : 'rk-bar-chart__gridline'}
                    x1={plotLeft}
                    x2={plotLeft + plotWidth}
                    y1={y}
                    y2={y}
                  />
                  <text
                    className="rk-bar-chart__tick"
                    x={plotLeft - Y_LABEL_GAP}
                    y={y}
                    textAnchor="end"
                    dominantBaseline="middle"
                  >
                    {tickLabels[i]}
                  </text>
                </Fragment>
              )
            })}
          </g>

          {data.map((d, i) => {
            const { values, total } = buckets[i]
            const x0 = plotLeft + i * slot
            const center = x0 + slot / 2
            const top = yOf(stacked ? total : Math.max(0, ...values))
            const anchorWidth = stacked ? barWidth : groupSeriesWidth * series.length
            let acc = 0
            const label = labelIndices.has(i) ? d.label : null
            const half = estimateLabelWidth(d.label) / 2
            return (
              <g
                key={d.key}
                ref={(el) => {
                  bucketRefs.current[i] = el
                }}
                className="rk-bar-chart__bucket"
                role="img"
                aria-labelledby={`${idBase}-${i}`}
                tabIndex={i === rovingIndex ? 0 : -1}
                data-index={i}
                data-active={i === activeIndex ? '' : undefined}
                onFocus={() => onBucketFocus(i)}
              >
                <rect
                  className="rk-bar-chart__band"
                  x={x0}
                  y={PLOT_TOP}
                  width={slot}
                  height={height}
                />
                {series.map((s, si) => {
                  const v = values[si]
                  if (v <= 0) return null
                  let x: number
                  let y: number
                  let w: number
                  if (stacked) {
                    x = center - barWidth / 2
                    y = yOf(acc + v)
                    w = barWidth
                    acc += v
                  } else {
                    x = center - (groupSeriesWidth * series.length) / 2 + si * groupSeriesWidth
                    y = yOf(v)
                    w = groupSeriesWidth
                  }
                  return (
                    <rect
                      key={s.key}
                      className="rk-bar-chart__bar"
                      data-series={s.key}
                      data-tone={s.tone ?? 'accent'}
                      x={x}
                      y={y}
                      width={w}
                      height={stacked ? yOf(acc - v) - y : baseline - y}
                      style={{ fill: BAR_CHART_TONE_COLOR[s.tone ?? 'accent'] }}
                    />
                  )
                })}
                {/* 提示框锚点：柱顶到基线，至少 1px（全 0 时贴在基线上）。 */}
                <rect
                  ref={(el) => {
                    anchorRefs.current[i] = el
                  }}
                  className="rk-bar-chart__anchor"
                  x={center - anchorWidth / 2}
                  y={Math.min(top, baseline - 1)}
                  width={anchorWidth}
                  height={Math.max(1, baseline - top)}
                />
                <rect
                  className="rk-bar-chart__hit"
                  x={x0}
                  y={0}
                  width={slot}
                  height={svgHeight}
                  onPointerEnter={() => showBucket(i)}
                  onPointerDown={() => showBucket(i)}
                />
                {/* 键盘焦点环：画在列内侧，SVG 子元素的 outline 各浏览器表现不一 */}
                <rect
                  className="rk-bar-chart__focus"
                  x={x0 + 1}
                  y={PLOT_TOP + 1}
                  width={Math.max(0, slot - 2)}
                  height={Math.max(0, height - 2)}
                  rx={2}
                />
                {label != null && (
                  <text
                    className="rk-bar-chart__tick rk-bar-chart__x-label"
                    x={Math.min(Math.max(center, half), width - half)}
                    y={baseline + X_AXIS_HEIGHT / 2 + 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* 各桶的可访问名称（aria-labelledby 可引用 hidden 节点）：与提示框同源，tooltipExtra 可返回 ReactNode */}
      <div hidden>
        {data.map((d, i) => (
          <span key={d.key} id={`${idBase}-${i}`}>
            <BarChartSummary
              title={titleOf(d)}
              series={series}
              values={buckets[i].values}
              extra={extraOf(d)}
              formatValue={formatValue}
            />
          </span>
        ))}
      </div>

      <BaseTooltip.Root open={tooltipOpen} onOpenChange={(open) => !open && setHidden(true)}>
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner
            anchor={activeIndex != null ? anchorRefs.current[activeIndex] : null}
            side="top"
            sideOffset={8}
            className="rk-tooltip__positioner"
          >
            <BaseTooltip.Popup className="rk-tooltip rk-bar-chart__tooltip" aria-hidden="true">
              {tooltipDatum != null && (
                <>
                  <div className="rk-bar-chart__tooltip-title">{titleOf(tooltipDatum)}</div>
                  <dl className="rk-bar-chart__tooltip-rows">
                    {series.map((s, si) => (
                      <div key={s.key} className="rk-bar-chart__tooltip-row">
                        <dt>
                          <span
                            className="rk-bar-chart__swatch"
                            style={{ background: BAR_CHART_TONE_COLOR[s.tone ?? 'accent'] }}
                          />
                          {s.label}
                        </dt>
                        <dd>{formatValue(buckets[activeIndex!].values[si])}</dd>
                      </div>
                    ))}
                    {extraOf(tooltipDatum).map((item, ei) => (
                      <div
                        key={`extra-${ei}`}
                        className="rk-bar-chart__tooltip-row"
                        data-extra=""
                      >
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </div>
  )
}

/** 桶的可访问名称：「标题：系列 值，系列 值，附加项 值」。 */
function BarChartSummary({
  title,
  series,
  values,
  extra,
  formatValue,
}: {
  title: ReactNode
  series: readonly BarChartSeries[]
  values: number[]
  extra: BarChartExtraItem[]
  formatValue: (value: number) => string
}) {
  const parts: ReactNode[] = [
    ...series.map((s, i) => `${s.label} ${formatValue(values[i])}`),
    ...extra.map((item, i) => (
      <Fragment key={`extra-${i}`}>
        {item.label} {item.value}
      </Fragment>
    )),
  ]
  return (
    <>
      {title}：
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && '，'}
          {part}
        </Fragment>
      ))}
    </>
  )
}
