/**
 * 取色器：画笔颜色槽的「编辑颜色」「添加颜色」，通常放在 Popover 里。值是 '#rrggbb'（受控）。
 *
 * 两个分页，用 SegmentedChoice（radiogroup，满宽两项等分）切换；各项 aria-controls 指向对应面板（role="group"，以分段文案命名）：
 *   - 预设：色板网格（radiogroup，方向键在格子间移动并选中），点一下即 onChange + onCommit。
 *   - 自定义：饱和度 / 明度方块 + 色相滑条 + 十六进制输入 + 当前色预览。
 *     方块与滑条的拖动参照 react-colorful（MIT）的交互：按下就跳到按点并开始拖，指针捕获在控件上，
 *     拖到控件外也照常（坐标夹在边界内）；松手 onCommit。两者都是 role="slider"，方向键微调、Shift 加大步长。
 *     触摸按住拖动不带动页面：blockTouchScroll（同拖柄）。
 *
 * 分页切换不硬切：两个面板叠在同一格里（keepMounted），切换时交叉淡化；容器高度量当前面板，
 * 用 smooth 弹簧过渡到新高度，不再为等高留出另一个分页的空白。内容变高变矮也由 ResizeObserver 跟。
 * 宽度跟随容器（色块按 columns 自适应）。点按跳位时滑块用短过渡滑过去，拖动中直接跟手；预览色同理。
 * 内部保存 HSV（灰色、黑色没有色相 / 饱和度，只存十六进制会让滑条跳回红色），只有外部 value 真变了才从 value 重算。
 */
import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { cx } from '../cx'
import { Field } from '../field/field'
import { SegmentedChoice } from '../segmented-choice/segmented-choice'
import { blockTouchScroll } from '../touch-block'
import { COLOR_PICKER_COLUMNS, COLOR_PICKER_PALETTE, hexToHsv, hsvToHex, normalizeHex, relativeLuminance } from './color'
import type { Hsv } from './color'

export type ColorPickerTab = 'preset' | 'custom'

export interface ColorPickerLabels {
  /** 分页条的可访问名称。 */
  tabs: string
  preset: string
  custom: string
  /** 色板网格的可访问名称。 */
  palette: string
  swatch: (hex: string) => string
  saturation: string
  saturationValue: (saturation: number, brightness: number) => string
  hue: string
  hueValue: (hue: number) => string
  hex: string
  preview: string
}

export const COLOR_PICKER_LABELS: ColorPickerLabels = {
  tabs: '取色方式',
  preset: '预设',
  custom: '自定义',
  palette: '预设颜色',
  swatch: (hex) => `颜色 ${hex.toUpperCase()}`,
  saturation: '饱和度与明度',
  saturationValue: (saturation, brightness) => `饱和度 ${saturation}%，明度 ${brightness}%`,
  hue: '色相',
  hueValue: (hue) => `${hue} 度`,
  hex: '十六进制',
  preview: '当前颜色',
}

export interface ColorPickerProps {
  /** 当前颜色 '#rrggbb'。 */
  value: string
  /** 拖动、键盘微调、输入合法十六进制时实时调用。 */
  onChange: (value: string) => void
  /** 一次操作结束（松手、点色板、键盘松键、输入框回车 / 失焦）时调用。 */
  onCommit?: (value: string) => void
  /** 色板，默认 COLOR_PICKER_PALETTE（6 × 5）。 */
  palette?: readonly string[]
  /** 色板列数，默认 6。 */
  columns?: number
  /** 初始分页（非受控）。@default 'preset' */
  defaultTab?: ColorPickerTab
  labels?: Partial<ColorPickerLabels>
  className?: string
}

/** 方向键步长；按住 Shift 时的步长。 */
const STEP = 1
const STEP_LARGE = 10

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 指针在元素里的相对位置（0–1，夹在边界内）。 */
function ratioIn(el: HTMLElement, event: { clientX: number; clientY: number }): { x: number; y: number } {
  const rect = el.getBoundingClientRect()
  return {
    x: rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0,
    y: rect.height > 0 ? clamp((event.clientY - rect.top) / rect.height, 0, 1) : 0,
  }
}

/** 方块 / 滑条共用的拖动：按下即跳位并捕获指针，移动跟手，松手提交。 */
function useDragSurface(onRatio: (x: number, y: number) => void, onEnd: () => void) {
  const [dragging, setDragging] = useState(false)
  const active = useRef<number | null>(null)
  return {
    dragging,
    handlers: {
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        event.preventDefault()
        const el = event.currentTarget
        el.focus({ preventScroll: true })
        try {
          el.setPointerCapture(event.pointerId)
        } catch {
          // 合成事件没有活动指针
        }
        active.current = event.pointerId
        const { x, y } = ratioIn(el, event)
        onRatio(x, y)
      },
      onPointerMove(event: ReactPointerEvent<HTMLElement>) {
        if (active.current !== event.pointerId) return
        // 第一次移动才进入「拖动中」：按下那一下的跳位仍有过渡
        if (!dragging) setDragging(true)
        const { x, y } = ratioIn(event.currentTarget, event)
        onRatio(x, y)
      },
      onPointerUp(event: ReactPointerEvent<HTMLElement>) {
        if (active.current !== event.pointerId) return
        active.current = null
        setDragging(false)
        onEnd()
      },
      onPointerCancel(event: ReactPointerEvent<HTMLElement>) {
        if (active.current !== event.pointerId) return
        active.current = null
        setDragging(false)
        onEnd()
      },
    },
  }
}

export function ColorPicker({
  value,
  onChange,
  onCommit,
  palette = COLOR_PICKER_PALETTE,
  columns = COLOR_PICKER_COLUMNS,
  defaultTab = 'preset',
  labels: labelOverrides,
  className,
}: ColorPickerProps) {
  const labels = { ...COLOR_PICKER_LABELS, ...labelOverrides }
  const current = normalizeHex(value) ?? '#000000'
  const [tab, setTab] = useState<ColorPickerTab>(defaultTab)
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(current))
  // 最近一次与 hsv 对齐的十六进制：外部 value 与它不同才重算 HSV（自己发出去的值回来时不重算，免得取整抖动）
  const [synced, setSynced] = useState(current)
  if (synced !== current) {
    setSynced(current)
    setHsv(hexToHsv(current, hsv.h))
  }
  const latest = useRef(current)
  latest.current = current

  const emit = (next: Hsv) => {
    const hex = hsvToHex(next)
    setHsv(next)
    setSynced(hex)
    latest.current = hex
    if (hex !== current) onChange(hex)
  }
  const commit = () => onCommit?.(latest.current)

  const square = useDragSurface(
    (x, y) => emit({ h: hsv.h, s: x * 100, v: (1 - y) * 100 }),
    commit,
  )
  const hue = useDragSurface((x) => emit({ ...hsv, h: x * 360 }), commit)

  const onSquareKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? STEP_LARGE : STEP
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }
    const d = delta[event.key]
    if (!d) return
    event.preventDefault()
    emit({ h: hsv.h, s: clamp(Math.round(hsv.s) + d[0], 0, 100), v: clamp(Math.round(hsv.v) + d[1], 0, 100) })
  }

  const onHueKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? STEP_LARGE : STEP
    let h: number | null = null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') h = Math.round(hsv.h) - step
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') h = Math.round(hsv.h) + step
    else if (event.key === 'Home') h = 0
    else if (event.key === 'End') h = 360
    if (h === null) return
    event.preventDefault()
    emit({ ...hsv, h: clamp(h, 0, 360) })
  }

  const onSliderKeyUp = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') commit()
  }

  /* -------------------------------------------------------------- 十六进制输入 */

  const [draft, setDraft] = useState<string | null>(null)
  const applyDraft = (text: string, final: boolean) => {
    const normalized = normalizeHex(text)
    // 打字途中只认 6 位：'#abc' 可能还没打完
    if (!normalized || (!final && text.replace('#', '').trim().length !== 6)) return false
    if (normalized !== current) {
      setHsv(hexToHsv(normalized, hsv.h))
      setSynced(normalized)
      latest.current = normalized
      onChange(normalized)
    }
    return true
  }
  const finishDraft = () => {
    if (draft === null) return
    if (applyDraft(draft, true)) commit()
    setDraft(null)
  }

  /* -------------------------------------------------------------- 色板 */

  const selectedIndex = palette.findIndex((color) => normalizeHex(color) === current)
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([])
  const pick = (index: number) => {
    const color = normalizeHex(palette[index] ?? '')
    if (!color) return
    setHsv(hexToHsv(color, hsv.h))
    setSynced(color)
    latest.current = color
    if (color !== current) onChange(color)
    onCommit?.(color)
  }
  const onSwatchKey = (index: number, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
    }
    let next: number | null = null
    if (event.key in moves) next = index + moves[event.key]!
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = palette.length - 1
    if (next === null) return
    event.preventDefault()
    if (next < 0 || next >= palette.length) return
    swatchRefs.current[next]?.focus()
    pick(next)
  }

  /* -------------------------------------------------------------- 分页高度 */

  // 两个面板叠放，容器高度取当前分页的实测值：预设页不再为和自定义页等高留空白，
  // 切页时高度走 smooth 弹簧（CSS transition），内容高度变化由 ResizeObserver 跟上。
  const panelBodies = useRef<Record<ColorPickerTab, HTMLDivElement | null>>({
    preset: null,
    custom: null,
  })
  const [panelHeight, setPanelHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const body = panelBodies.current[tab]
    if (!body) return
    const sync = () => setPanelHeight(body.offsetHeight)
    sync()
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(sync)
    observer.observe(body)
    return () => observer.disconnect()
  }, [tab])

  // 两个面板都常驻（交叉淡化）；不活动的标 data-hidden + inert，读屏与 Tab 序都跳过它
  const baseId = useId()
  const panelId = (which: ColorPickerTab) => `${baseId}-panel-${which}`
  const panelProps = (which: ColorPickerTab) => ({
    id: panelId(which),
    role: 'group',
    'aria-label': labels[which],
    className: 'rk-color-picker__panel',
    'data-hidden': tab === which ? undefined : '',
    inert: tab !== which,
  })

  const hueColor = `hsl(${Math.round(hsv.h)} 100% 50%)`
  const s = Math.round(hsv.s)
  const v = Math.round(hsv.v)

  return (
    <div
      className={cx('rk-color-picker', className)}
      style={{ '--rk-color-picker-value': current, '--rk-color-picker-hue': hueColor } as CSSProperties}
      data-dragging={square.dragging || hue.dragging ? '' : undefined}
    >
      <SegmentedChoice.Root
        value={tab}
        onValueChange={(next) => setTab(next as ColorPickerTab)}
        aria-label={labels.tabs}
        className="rk-color-picker__tabs"
      >
        <SegmentedChoice.Item value="preset" aria-controls={panelId('preset')}>
          {labels.preset}
        </SegmentedChoice.Item>
        <SegmentedChoice.Item value="custom" aria-controls={panelId('custom')}>
          {labels.custom}
        </SegmentedChoice.Item>
      </SegmentedChoice.Root>
        <div
          className="rk-color-picker__panels"
          data-measured={panelHeight === null ? undefined : ''}
          style={panelHeight === null ? undefined : { height: panelHeight }}
        >
          <div {...panelProps('preset')}>
            <div
              ref={(el) => {
                panelBodies.current.preset = el
              }}
              className="rk-color-picker__panel-body"
              data-panel="preset"
            >
              <div
                className="rk-color-picker__grid"
                role="radiogroup"
                aria-label={labels.palette}
                style={{ '--rk-color-picker-columns': columns } as CSSProperties}
              >
                {palette.map((color, index) => {
                  const hex = normalizeHex(color) ?? color
                  const checked = index === selectedIndex
                  const focusable = checked || (selectedIndex < 0 && index === 0)
                  return (
                    <button
                      key={`${hex}-${index}`}
                      ref={(el) => {
                        swatchRefs.current[index] = el
                      }}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      aria-label={labels.swatch(hex)}
                      tabIndex={focusable ? 0 : -1}
                      className="rk-color-picker__swatch"
                      data-light={relativeLuminance(hex) > 0.8 ? '' : undefined}
                      style={{ '--rk-color-picker-swatch': hex } as CSSProperties}
                      onClick={() => pick(index)}
                      onKeyDown={(event) => onSwatchKey(index, event)}
                    />
                  )
                })}
              </div>
            </div>
          </div>
          <div {...panelProps('custom')}>
            <div
              ref={(el) => {
                panelBodies.current.custom = el
              }}
              className="rk-color-picker__panel-body"
              data-panel="custom"
            >
              <div className="rk-color-picker__custom">
                <div
                  ref={blockTouchScroll}
                  className="rk-color-picker__square"
                  role="slider"
                  tabIndex={0}
                  aria-label={labels.saturation}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={s}
                  aria-valuetext={labels.saturationValue(s, v)}
                  data-dragging={square.dragging ? '' : undefined}
                  onKeyDown={onSquareKey}
                  onKeyUp={onSliderKeyUp}
                  {...square.handlers}
                >
                  <span className="rk-color-picker__thumb" style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }} />
                </div>
                <div
                  ref={blockTouchScroll}
                  className="rk-color-picker__hue"
                  role="slider"
                  tabIndex={0}
                  aria-label={labels.hue}
                  aria-orientation="horizontal"
                  aria-valuemin={0}
                  aria-valuemax={360}
                  aria-valuenow={Math.round(hsv.h)}
                  aria-valuetext={labels.hueValue(Math.round(hsv.h))}
                  data-dragging={hue.dragging ? '' : undefined}
                  onKeyDown={onHueKey}
                  onKeyUp={onSliderKeyUp}
                  {...hue.handlers}
                >
                  <span className="rk-color-picker__thumb rk-color-picker__thumb--hue" style={{ left: `${(hsv.h / 360) * 100}%` }} />
                </div>
                <div className="rk-color-picker__footer">
                  <span className="rk-color-picker__preview" role="img" aria-label={`${labels.preview} ${current.toUpperCase()}`} />
                  <Field.Root className="rk-color-picker__hex">
                    <Field.Label className="rk-color-picker__hex-label">
                      {labels.hex}
                    </Field.Label>
                    <Field.Control
                      value={draft ?? current.toUpperCase()}
                      spellCheck={false}
                      autoComplete="off"
                      autoCapitalize="characters"
                      maxLength={7}
                      onChange={(event) => {
                        const text = (event.target as HTMLInputElement).value
                        setDraft(text)
                        applyDraft(text, false)
                      }}
                      onFocus={(event) => (event.target as HTMLInputElement).select()}
                      onBlur={finishDraft}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          finishDraft()
                        } else if (event.key === 'Escape' && draft !== null) {
                          event.preventDefault()
                          setDraft(null)
                        }
                      }}
                    />
                  </Field.Root>
                </div>
              </div>
            </div>
          </div>
        </div>
    </div>
  )
}
