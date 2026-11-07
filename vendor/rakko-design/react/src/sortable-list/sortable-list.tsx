/**
 * 可拖拽排序的分组列表（iOS「编辑」态 / GoodNotes「自定义工具栏」）：多个 List.Group，行首红色 − / 绿色 + 把这一行移到另一组，
 * 行尾 ≡ 拖柄拖动排序，组内、跨组都行。数据由调用方持有（受控），一切移动都经 onMove 交给调用方。
 *
 * 交互细节参照 SortableJS（MIT，2013 起）与 react-beautiful-dnd（Apache-2.0）/ dnd-kit（MIT）的做法，代码是按本仓库的 FLIP / 弹簧重写的，没有搬它们的源码：
 *   - 只有拖柄能拖（handle 模式）：行的其余部分照常点击、滚动。pointer 事件统一处理鼠标、触摸、笔；拖柄用 blockTouchScroll 拦住页面滚动。
 *   - 拖起的是浮起层里的克隆（dnd-kit 的 DragOverlay）：挂在 body 上、fixed 定位，跟手、放大 1.03 + 阴影，不被卡片的 overflow 裁掉。
 *     原行留在原处折叠成 0 高（拖柄还在 DOM 里，触摸序列与焦点都不断），落点处放一个等高的空位（placeholder）。
 *   - 其余行让位：FLIP，只动 transform（WAAPI + springEasing(SPRINGS.smooth)）；卡片高度变化（行移入 / 移出）用同一条弹簧补间，
 *     后面的分组跟着布局走，不跳。连续换位时从当前视觉位置接着走（可打断）。
 *   - 换位判据：浮起物的中线越过邻行中线（react-beautiful-dnd 的中心判定），换完之后要退回同一条中线才会换回去，不抖。
 *   - 松手：浮起物用数值弹簧（SpringValue，保留松手速度）追到行的最终位置，同时缩回、阴影退去，落定后换回真行。落定前再按住可以接着拖。
 *   - 跨组移动（拖过去、点 − / +）：行在新组里先隐身，浮起的克隆从原位置飞过去（共享元素），途中 − / + 图标交叉淡化，落定后换回真行。
 *   - 靠近滚动容器上下边缘自动滚动，越靠边越快。
 *   - 键盘（dnd-kit 的 KeyboardSensor 约定）：拖柄可聚焦，Space / Enter 拿起，↑↓ 移动（到组边界跨组），Space / Enter 放下，Esc 取消；
 *     aria-live 播报拿起、位置、放下、取消。
 *   - 减弱动态效果：没有位移动画（让位、落位、飞行都直接到位），浮起物原地淡出、真行淡入。
 *
 * 用类组件：getSnapshotBeforeUpdate 能在 React 改 DOM 之前量旧位置（同 AnimatedList）。
 */
import { Component, createRef } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { cx } from '../cx'
import { List } from '../list/list'
import { MOTION } from '../motion'
import { reducedMotionQuery } from '../motion-dom'
import { SPRINGS, SpringValue, springEasing } from '../spring'
import type { SpringSpec } from '../spring'
import { blockTouchScroll } from '../touch-block'

/* ------------------------------------------------------------------ 公共类型 */

export type SortableTransferTone = 'remove' | 'add'

export interface SortableListGroup<T> {
  /** 组的标识（列表内唯一），onMove 里的 fromGroup / toGroup 就是它。 */
  id: string
  /** 组标题（卡片上方小号字），同 List.Group 的 header。 */
  header?: ReactNode
  /** 卡片下方说明。 */
  footer?: ReactNode
  /** 读屏播报用的组名；header 是纯文本时可省。 */
  label?: string
  items: readonly T[]
  /** 行首 − / + 按钮：点一下把该行移到 to 组的末尾。tone 决定红色 −（remove）还是绿色 +（add）。不给就没有这个按钮。 */
  transfer?: { to: string; tone: SortableTransferTone }
}

/** 一次移动：fromIndex 是在原组里的下标；toIndex 是把它从原组拿掉之后，在目标组里的下标（同组时即 arrayMove 的目标下标）。 */
export interface SortableMove {
  key: string
  fromGroup: string
  fromIndex: number
  toGroup: string
  toIndex: number
}

export interface SortableListLabels {
  /** 拖柄的可访问名称。 */
  handle: (item: string) => string
  /** 拖柄的 aria-roledescription。 */
  roleDescription: string
  /** 拖柄的操作说明（aria-describedby）。 */
  instructions: string
  /** − / + 按钮的可访问名称。 */
  transfer: (item: string, toGroup: string) => string
  pickedUp: (item: string, group: string, position: number, total: number) => string
  moved: (item: string, group: string, position: number, total: number) => string
  dropped: (item: string, group: string, position: number, total: number) => string
  cancelled: (item: string, group: string, position: number, total: number) => string
  transferred: (item: string, group: string) => string
}

export const SORTABLE_LIST_LABELS: SortableListLabels = {
  handle: (item) => `排序：${item}`,
  roleDescription: '可拖动排序',
  instructions: '按空格或回车拿起，用上下方向键移动，再按空格或回车放下，按 Esc 取消。',
  transfer: (item, toGroup) => `把「${item}」移到「${toGroup}」`,
  pickedUp: (item, group, position, total) => `已拿起「${item}」，在「${group}」第 ${position} 项，共 ${total} 项。`,
  moved: (item, group, position, total) => `「${item}」移到「${group}」第 ${position} 项，共 ${total} 项。`,
  dropped: (item, group, position, total) => `已放下「${item}」，在「${group}」第 ${position} 项，共 ${total} 项。`,
  cancelled: (item, group, position, total) => `已取消，「${item}」回到「${group}」第 ${position} 项，共 ${total} 项。`,
  transferred: (item, group) => `「${item}」已移到「${group}」。`,
}

export interface SortableListProps<T> {
  groups: readonly SortableListGroup<T>[]
  /** 行的稳定标识（全列表唯一）。 */
  getKey: (item: T) => string
  /** 行的纯文本名：读屏播报、按钮名称都用它。 */
  getLabel: (item: T) => string
  /** 行的主内容；不给就显示 getLabel 的文字。 */
  renderItem?: (item: T) => ReactNode
  /** 行首图标位（在 − / + 按钮之后）。 */
  renderLeading?: (item: T) => ReactNode
  /** 用户完成一次移动（松手、键盘放下、点 − / +）时调用；调用方据此更新 groups。没变位置不调。 */
  onMove: (move: SortableMove) => void
  labels?: Partial<SortableListLabels>
  className?: string
}

/* ------------------------------------------------------------------ 常量 */

/** 浮起时的放大比例（与 LiftMenu 的 LIFT_SCALE 一致）。 */
const LIFT_SCALE = 1.03
/** 落位追踪用的弹簧：比 smooth 稍快，跟手感强一些；跨组飞行用 smooth。 */
const DROP_SPRING: SpringSpec = { response: 0.38, damping: 0.86 }
/** 自动滚动：离边缘多近开始滚（px），最快每帧滚多少（px）。 */
const AUTOSCROLL_EDGE = 56
const AUTOSCROLL_MAX = 16
/** 空位的 data-rk-sortable-key：行 key 不会以 NUL 开头。 */
const PLACEHOLDER_KEY = '\u0000placeholder'
const KEY_ATTR = 'data-rk-sortable-key'
const GROUP_ATTR = 'data-rk-sortable-group'
/** 浮起层的 WAAPI 动画 id（落定前按住时停掉）。 */
const FLOAT_LIFT_ID = 'rk-sortable-lift'

/* ------------------------------------------------------------------ 内部类型 */

interface DragState {
  key: string
  fromGroup: string
  fromIndex: number
  overGroup: string
  /** 在 overGroup 里、不计被拖行的下标。 */
  overIndex: number
  /** 被拖行的高度：空位与它等高。 */
  height: number
  mode: 'pointer' | 'keyboard'
}

interface SortableListState {
  drag: DragState | null
  /** 等浮起物落定的行：内容隐身（占位不变），落定后显示。 */
  landing: ReadonlySet<string>
  announcement: string
}

interface MeasuredRow {
  group: string
  /** 相对所在卡片顶边的视觉 top（含进行中的位移）。 */
  top: number
}

interface LayoutSnapshot {
  rows: Map<string, MeasuredRow>
  /** 卡片的视觉高度（含进行中的高度补间）。 */
  cards: Map<string, number>
}

/**
 * 浮起物：body 上 fixed 定位的克隆。位置由两个 SpringValue 驱动（拖动中直接 jump 跟手），
 * 有锚点时每帧把弹簧目标对准锚点（锚点会随卡片补间、页面滚动移动），追上且停稳即落定。
 */
interface Floater {
  key: string
  el: HTMLElement
  lift: HTMLElement
  x: SpringValue
  y: SpringValue
  anchor: (() => HTMLElement | null) | null
  onLand: (() => void) | null
  frame: number
  /** 至少等到这个时刻（performance.now）再落定：缩回的过渡要走完。 */
  landAfter: number
}

/* ------------------------------------------------------------------ 小工具 */

function reduced(): boolean {
  return reducedMotionQuery()?.matches ?? false
}

function canAnimate(el: Element): boolean {
  return typeof (el as HTMLElement).animate === 'function'
}

/** 克隆里去掉身份与可交互标记，变成静态拷贝。 */
function neutralize(node: HTMLElement): void {
  for (const el of [node, ...node.querySelectorAll<HTMLElement>('*')]) {
    el.removeAttribute('id')
    el.removeAttribute(KEY_ATTR)
    el.removeAttribute('tabindex')
    el.removeAttribute('aria-describedby')
  }
  node.setAttribute('aria-hidden', 'true')
  node.inert = true
}

/** 竖向可滚动的最近祖先；没有就用文档滚动。 */
function scrollParent(el: HTMLElement): HTMLElement {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

function MinusGlyph() {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M2.5 6h7" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

function PlusGlyph() {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M2.5 6h7M6 2.5v7" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}

/** ≡ 拖柄（iOS line.3.horizontal）。 */
function HandleGlyph() {
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M3.5 6.5h13M3.5 10h13M3.5 13.5h13" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  )
}

let idSeed = 0

/* ------------------------------------------------------------------ 组件 */

export class SortableList<T> extends Component<SortableListProps<T>, SortableListState> {
  state: SortableListState = { drag: null, landing: new Set(), announcement: '' }

  private root = createRef<HTMLDivElement>()
  private instructionsId = `rk-sortable-instructions-${(idSeed += 1)}`
  private floaters = new Map<string, Floater>()
  /** 自己起的让位 / 卡片补间动画：下次重排先停掉再量。 */
  private moves = new Map<HTMLElement, Animation>()
  /** 提交之后要开始追锚点的浮起物（key → 落定回调；null = 只跟随不落定，键盘拖动中）。 */
  private pendingSettle = new Map<string, (() => void) | null>()
  /** 提交后要给飞行物叠上新样子（− 变 +）的行。 */
  private pendingSwap: string | null = null
  /** 减弱动态效果下移动 / 放下的行：提交后淡入。 */
  private pendingFade: string | null = null
  /** 提交之后要把焦点放回这一行的哪个控件。 */
  private refocus: { key: string; part: 'handle' | 'transfer' } | null = null
  /** 指针拖动的运行时数据。 */
  private pointer: {
    id: number
    handle: HTMLElement
    grabY: number
    left: number
    y: number
    samples: { t: number; y: number }[]
    scroller: HTMLElement
    frame: number
  } | null = null

  private labels(): SortableListLabels {
    return { ...SORTABLE_LIST_LABELS, ...this.props.labels }
  }

  /* ---------------------------------------------------------------- 数据查询 */

  private groupById(id: string): SortableListGroup<T> | undefined {
    return this.props.groups.find((group) => group.id === id)
  }

  private groupLabel(id: string): string {
    const group = this.groupById(id)
    if (!group) return id
    if (group.label !== undefined) return group.label
    return typeof group.header === 'string' ? group.header : id
  }

  private locate(key: string): { group: SortableListGroup<T>; index: number; item: T } | null {
    for (const group of this.props.groups) {
      const index = group.items.findIndex((item) => this.props.getKey(item) === key)
      if (index >= 0) return { group, index, item: group.items[index]! }
    }
    return null
  }

  private itemLabel(key: string): string {
    const found = this.locate(key)
    return found ? this.props.getLabel(found.item) : key
  }

  /** 拖动中某组不计被拖行的行数。 */
  private countWithout(groupId: string, key: string): number {
    const group = this.groupById(groupId)
    if (!group) return 0
    return group.items.filter((item) => this.props.getKey(item) !== key).length
  }

  /** 布局签名：哪些行、什么顺序、空位在哪、哪一行折叠。没变就不量不动。 */
  private signature(props: SortableListProps<T>, drag: DragState | null): string {
    return JSON.stringify([
      props.groups.map((group) => [group.id, group.items.map(props.getKey)]),
      drag ? [drag.key, drag.overGroup, drag.overIndex, drag.height] : null,
    ])
  }

  /* ---------------------------------------------------------------- DOM 查询 */

  private rowElements(): HTMLElement[] {
    const root = this.root.current
    return root ? Array.from(root.querySelectorAll<HTMLElement>(`[${KEY_ATTR}]`)) : []
  }

  private rowElement(key: string): HTMLElement | null {
    return this.rowElements().find((el) => el.getAttribute(KEY_ATTR) === key) ?? null
  }

  private cardElements(): Map<string, HTMLElement> {
    const result = new Map<string, HTMLElement>()
    const root = this.root.current
    if (!root) return result
    for (const section of root.querySelectorAll<HTMLElement>(`[${GROUP_ATTR}]`)) {
      const card = section.querySelector<HTMLElement>('.rk-list-group__card')
      if (card) result.set(section.getAttribute(GROUP_ATTR) ?? '', card)
    }
    return result
  }

  private groupOfRow(row: HTMLElement): string {
    return row.closest(`[${GROUP_ATTR}]`)?.getAttribute(GROUP_ATTR) ?? ''
  }

  /** 行（相对所在卡片）与卡片的位置；getBoundingClientRect 含进行中的动画，即视觉位置（先停掉动画再量就是布局位置）。 */
  private measure(): LayoutSnapshot {
    const cards = this.cardElements()
    const cardTops = new Map<string, number>()
    const result: LayoutSnapshot = { rows: new Map(), cards: new Map() }
    for (const [id, card] of cards) {
      const rect = card.getBoundingClientRect()
      cardTops.set(id, rect.top)
      result.cards.set(id, rect.height)
    }
    for (const row of this.rowElements()) {
      const group = this.groupOfRow(row)
      result.rows.set(row.getAttribute(KEY_ATTR) ?? '', {
        group,
        top: row.getBoundingClientRect().top - (cardTops.get(group) ?? 0),
      })
    }
    return result
  }

  /* ---------------------------------------------------------------- 生命周期 */

  getSnapshotBeforeUpdate(prevProps: Readonly<SortableListProps<T>>, prevState: Readonly<SortableListState>): LayoutSnapshot | null {
    if (this.signature(prevProps, prevState.drag) === this.signature(this.props, this.state.drag)) return null
    const root = this.root.current
    if (!root || !canAnimate(root) || reduced()) return null
    return this.measure()
  }

  componentDidUpdate(_prevProps: Readonly<SortableListProps<T>>, _prevState: Readonly<SortableListState>, snapshot: LayoutSnapshot | null): void {
    if (snapshot) this.flip(snapshot)
    this.afterCommit()
    for (const [key, onLand] of this.pendingSettle) {
      const floater = this.floaters.get(key)
      if (!floater) continue
      const anchorKey = onLand ? key : PLACEHOLDER_KEY
      this.follow(floater, () => this.rowElement(anchorKey), onLand)
    }
    this.pendingSettle.clear()
    const drag = this.state.drag
    if (drag?.mode === 'keyboard') {
      // 键盘移动到视口外：空位滚进来（浮起物每帧对准空位，跟着一起走）
      const placeholder = this.rowElement(PLACEHOLDER_KEY)
      placeholder?.scrollIntoView?.({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' })
      // React 挪动兄弟节点时可能带走焦点：拖动中焦点始终留在被拖行的拖柄上
      const handle = this.rowElement(drag.key)?.querySelector<HTMLElement>('.rk-sortable-list__handle')
      if (handle && document.activeElement !== handle) handle.focus({ preventScroll: true })
    }
    if (this.refocus) {
      const { key, part } = this.refocus
      this.refocus = null
      const row = this.rowElement(key)
      const target = row?.querySelector<HTMLElement>(part === 'handle' ? '.rk-sortable-list__handle' : '.rk-sortable-list__transfer')
      if (target && document.activeElement !== target) target.focus({ preventScroll: true })
    }
  }

  componentWillUnmount(): void {
    this.endPointer()
    for (const floater of this.floaters.values()) this.removeFloater(floater)
    this.floaters.clear()
  }

  /* ---------------------------------------------------------------- FLIP */

  private flip(before: LayoutSnapshot): void {
    for (const anim of this.moves.values()) anim.cancel()
    this.moves.clear()
    const after = this.measure()
    const { easing, durationMs: duration } = springEasing(SPRINGS.smooth)
    const drag = this.state.drag

    // 行：同组里换了位置的从旧视觉位置弹回来；被拖的原行（折叠）、空位、等落定的行（隐身）不动
    for (const row of this.rowElements()) {
      const key = row.getAttribute(KEY_ATTR) ?? ''
      if (key === PLACEHOLDER_KEY || key === drag?.key || this.state.landing.has(key)) continue
      const prev = before.rows.get(key)
      const next = after.rows.get(key)
      if (!prev || !next || prev.group !== next.group) continue
      const dy = prev.top - next.top
      if (Math.abs(dy) < 0.5) continue
      this.track(row, row.animate({ transform: [`translateY(${dy}px)`, 'none'] }, { duration, easing }))
    }

    // 卡片：行移入 / 移出时高度弹过去（overflow: hidden 裁住多出来的部分），后面的分组跟着布局走
    for (const [id, card] of this.cardElements()) {
      const prev = before.cards.get(id)
      const next = after.cards.get(id)
      if (prev === undefined || next === undefined || Math.abs(prev - next) < 0.5) continue
      this.track(card, card.animate({ height: [`${prev}px`, `${next}px`] }, { duration, easing }))
    }
  }

  private track(el: HTMLElement, anim: Animation): void {
    this.moves.set(el, anim)
    const settle = () => {
      if (this.moves.get(el) === anim) this.moves.delete(el)
    }
    anim.finished.then(settle, settle)
  }

  /* ---------------------------------------------------------------- 浮起物 */

  /** 在 rect 处放一份 sources 的克隆（多份时叠放，后面的从 0 透明度起，供交叉淡化）。 */
  private createFloater(key: string, rect: DOMRect, sources: HTMLElement[], spring: SpringSpec): Floater {
    const el = document.createElement('div')
    el.className = 'rk-sortable-list__float'
    const lift = document.createElement('div')
    lift.className = 'rk-sortable-list__lift'
    const shadow = document.createElement('div')
    shadow.className = 'rk-sortable-list__shadow'
    lift.appendChild(shadow)
    el.appendChild(lift)
    const root = this.root.current
    const style = root ? getComputedStyle(root) : null
    const listBg = sources[0] ? getComputedStyle(sources[0]).getPropertyValue('--rk-list-bg').trim() : ''
    Object.assign(el.style, {
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      color: style?.color ?? '',
      fontFamily: style?.fontFamily ?? '',
    })
    if (listBg) el.style.setProperty('--rk-list-bg', listBg)
    sources.forEach((source, index) => {
      const clone = source.cloneNode(true) as HTMLElement
      neutralize(clone)
      clone.removeAttribute('data-dragging')
      clone.removeAttribute('data-landing')
      clone.classList.add('rk-sortable-list__clone')
      if (index > 0) clone.dataset.next = ''
      lift.appendChild(clone)
    })
    document.body.appendChild(el)
    const apply = () => {
      el.style.transform = `translate(${floater.x.value}px, ${floater.y.value}px)`
    }
    const floater: Floater = {
      key,
      el,
      lift,
      x: new SpringValue(rect.left, spring, apply),
      y: new SpringValue(rect.top, spring, apply),
      anchor: null,
      onLand: null,
      frame: 0,
      landAfter: 0,
    }
    apply()
    this.floaters.set(key, floater)
    return floater
  }

  private removeFloater(floater: Floater): void {
    floater.x.stop()
    floater.y.stop()
    if (floater.frame) cancelAnimationFrame(floater.frame)
    floater.frame = 0
    floater.el.remove()
    if (this.floaters.get(floater.key) === floater) this.floaters.delete(floater.key)
  }

  /** 每帧把弹簧目标对准锚点；onLand 不为空时追上且停稳就落定。 */
  private follow(floater: Floater, anchor: () => HTMLElement | null, onLand: (() => void) | null): void {
    floater.anchor = anchor
    floater.onLand = onLand
    if (floater.frame) cancelAnimationFrame(floater.frame)
    const tick = () => {
      floater.frame = 0
      const target = floater.anchor?.()
      if (!target) {
        // 锚点没了（行被调用方删掉）：原地淡出
        this.fadeOutFloater(floater)
        floater.onLand?.()
        return
      }
      const rect = target.getBoundingClientRect()
      if (floater.x.target !== rect.left) floater.x.set(rect.left)
      if (floater.y.target !== rect.top) floater.y.set(rect.top)
      const settled =
        Math.abs(floater.x.value - rect.left) < 0.5 &&
        Math.abs(floater.y.value - rect.top) < 0.5 &&
        Math.abs(floater.x.velocity) < 1 &&
        Math.abs(floater.y.velocity) < 1 &&
        performance.now() >= floater.landAfter
      if (settled && floater.onLand) {
        const land = floater.onLand
        floater.onLand = null
        this.removeFloater(floater)
        land()
        return
      }
      floater.frame = requestAnimationFrame(tick)
    }
    floater.frame = requestAnimationFrame(tick)
  }

  /** 减弱动态效果 / 锚点丢失：浮起物原地淡出后摘掉。 */
  private fadeOutFloater(floater: Floater): void {
    floater.x.stop()
    floater.y.stop()
    if (floater.frame) cancelAnimationFrame(floater.frame)
    floater.frame = 0
    if (this.floaters.get(floater.key) === floater) this.floaters.delete(floater.key)
    floater.el.dataset.leaving = ''
    if (!canAnimate(floater.el)) {
      floater.el.remove()
      return
    }
    const fade = floater.el.animate({ opacity: [1, 0] }, { duration: MOTION.durationExitMs, easing: MOTION.easeStandard, fill: 'forwards' })
    const done = () => floater.el.remove()
    fade.finished.then(done, done)
  }

  /** 浮起 / 放下的视觉：放大与阴影走 CSS 过渡（snappy 弹簧）。 */
  private setLifted(floater: Floater, lifted: boolean): void {
    if (lifted) floater.el.dataset.lifted = ''
    else delete floater.el.dataset.lifted
  }

  /** 行落定：真行显示出来（与摘掉浮起物同一帧），减弱动态效果时淡入。 */
  private reveal(key: string, fade: boolean): void {
    flushSync(() => {
      this.setState((state) => {
        if (!state.landing.has(key)) return null
        const landing = new Set(state.landing)
        landing.delete(key)
        return { landing }
      })
    })
    if (!fade) return
    const row = this.rowElement(key)
    if (row && canAnimate(row)) {
      for (const child of row.children) {
        ;(child as HTMLElement).animate({ opacity: [0, 1] }, { duration: MOTION.durationEnterMs, easing: MOTION.easeDecelerate })
      }
    }
  }

  /** 已有同一行的浮起物（还在飞 / 落位）：接过来从它当前的位置继续，不跳。 */
  private takeFloater(key: string): Floater | null {
    const floater = this.floaters.get(key)
    if (!floater) return null
    floater.anchor = null
    floater.onLand = null
    if (floater.frame) cancelAnimationFrame(floater.frame)
    floater.frame = 0
    for (const anim of floater.lift.getAnimations?.({ subtree: true }) ?? []) {
      if (anim.id === FLOAT_LIFT_ID) anim.cancel()
    }
    for (const clone of floater.lift.querySelectorAll<HTMLElement>('[data-next]')) clone.remove()
    return floater
  }

  /* ---------------------------------------------------------------- 拿起 / 移动 / 放下 */

  private pickUp(key: string, mode: DragState['mode']): Floater | null {
    if (this.state.drag) return null
    const found = this.locate(key)
    const row = this.rowElement(key)
    if (!found || !row) return null
    const rect = row.getBoundingClientRect()
    let floater = this.takeFloater(key)
    if (floater) {
      floater.x.spec = DROP_SPRING
      floater.y.spec = DROP_SPRING
    } else {
      floater = this.createFloater(key, rect, [row], DROP_SPRING)
    }
    this.setLifted(floater, true)
    const labels = this.labels()
    const groupId = found.group.id
    const total = found.group.items.length
    this.setState((state) => {
      const landing = new Set(state.landing)
      landing.delete(key)
      return {
        landing,
        drag: {
          key,
          fromGroup: groupId,
          fromIndex: found.index,
          overGroup: groupId,
          overIndex: found.index,
          height: rect.height,
          mode,
        },
        announcement: labels.pickedUp(this.props.getLabel(found.item), this.groupLabel(groupId), found.index + 1, total),
      }
    })
    return floater
  }

  private moveOver(overGroup: string, overIndex: number): void {
    const drag = this.state.drag
    if (!drag || (drag.overGroup === overGroup && drag.overIndex === overIndex)) return
    const labels = this.labels()
    const total = this.countWithout(overGroup, drag.key) + 1
    if (drag.mode === 'keyboard') this.pendingSettle.set(drag.key, null)
    this.setState({
      drag: { ...drag, overGroup, overIndex },
      announcement: labels.moved(this.itemLabel(drag.key), this.groupLabel(overGroup), overIndex + 1, total),
    })
  }

  /** 放下（commit）或取消：通知调用方，浮起物追到行的最终位置后换回真行。 */
  private drop(commit: boolean, velocityY = 0): void {
    const drag = this.state.drag
    if (!drag) return
    this.endPointer()
    const labels = this.labels()
    const toGroup = commit ? drag.overGroup : drag.fromGroup
    const toIndex = commit ? drag.overIndex : drag.fromIndex
    const changed = toGroup !== drag.fromGroup || toIndex !== drag.fromIndex
    const item = this.itemLabel(drag.key)
    const total = changed && toGroup !== drag.fromGroup ? this.countWithout(toGroup, drag.key) + 1 : this.countWithout(drag.fromGroup, drag.key) + 1
    const announce = commit ? labels.dropped : labels.cancelled
    const floater = this.floaters.get(drag.key)
    const quiet = reduced()
    if (floater) {
      this.setLifted(floater, false)
      floater.x.spec = DROP_SPRING
      floater.y.spec = DROP_SPRING
      floater.y.velocity = velocityY
      floater.landAfter = performance.now() + (quiet ? 0 : springEasing(SPRINGS.snappy).durationMs * 0.8)
    }
    if (drag.mode === 'keyboard') this.refocus = { key: drag.key, part: 'handle' }
    if (floater && quiet) {
      this.fadeOutFloater(floater)
      this.setState({ drag: null, announcement: announce(item, this.groupLabel(toGroup), toIndex + 1, total) })
      if (changed) this.props.onMove({ key: drag.key, fromGroup: drag.fromGroup, fromIndex: drag.fromIndex, toGroup, toIndex })
      this.pendingFade = drag.key
      return
    }
    if (floater) this.pendingSettle.set(drag.key, () => this.reveal(drag.key, false))
    this.setState((state) => ({
      drag: null,
      landing: floater ? new Set(state.landing).add(drag.key) : state.landing,
      announcement: announce(item, this.groupLabel(toGroup), toIndex + 1, total),
    }))
    if (changed) this.props.onMove({ key: drag.key, fromGroup: drag.fromGroup, fromIndex: drag.fromIndex, toGroup, toIndex })
  }

  /* ---------------------------------------------------------------- − / + */

  private transfer(key: string): void {
    if (this.state.drag) return
    const found = this.locate(key)
    const to = found?.group.transfer?.to
    const target = to !== undefined ? this.groupById(to) : undefined
    const row = this.rowElement(key)
    if (!found || !target || !row) return
    const labels = this.labels()
    const move: SortableMove = { key, fromGroup: found.group.id, fromIndex: found.index, toGroup: target.id, toIndex: target.items.length }
    const quiet = reduced() || !canAnimate(row)
    const rect = row.getBoundingClientRect()
    // 飞行：同一行还在飞（连点）就接过来；否则从原位放一份克隆
    let floater = this.takeFloater(key)
    if (!floater) floater = this.createFloater(key, rect, [row], SPRINGS.smooth)
    floater.x.spec = SPRINGS.smooth
    floater.y.spec = SPRINGS.smooth
    this.refocus = document.activeElement && row.contains(document.activeElement) ? { key, part: 'transfer' } : null
    if (quiet) {
      this.fadeOutFloater(floater)
      this.pendingFade = key
    } else {
      this.pendingSettle.set(key, () => this.reveal(key, false))
      this.pendingSwap = key
    }
    this.setState((state) => ({
      landing: quiet ? state.landing : new Set(state.landing).add(key),
      announcement: labels.transferred(this.props.getLabel(found.item), this.groupLabel(target.id)),
    }))
    this.props.onMove(move)
  }

  /** 提交后的收尾：飞行物叠上新行的克隆做交叉淡化；减弱动态效果时真行淡入。 */
  private afterCommit(): void {
    if (this.pendingSwap !== null) {
      const key = this.pendingSwap
      this.pendingSwap = null
      const floater = this.floaters.get(key)
      const row = this.rowElement(key)
      if (floater && row) {
        const clone = row.cloneNode(true) as HTMLElement
        neutralize(clone)
        clone.removeAttribute('data-landing')
        clone.classList.add('rk-sortable-list__clone')
        clone.dataset.next = ''
        floater.lift.appendChild(clone)
        const { easing, durationMs } = springEasing(SPRINGS.smooth)
        if (canAnimate(clone)) {
          clone.animate({ opacity: [0, 1] }, { duration: durationMs * 0.6, easing: MOTION.easeStandard, fill: 'forwards', id: FLOAT_LIFT_ID })
          // 飞行途中微微浮起再落下（共享元素的「拿起 → 放下」）
          floater.lift.animate(
            [
              { scale: '1', offset: 0 },
              { scale: String(LIFT_SCALE), offset: 0.35 },
              { scale: '1', offset: 1 },
            ],
            { duration: durationMs, easing, id: FLOAT_LIFT_ID },
          )
          floater.lift.querySelector('.rk-sortable-list__shadow')?.animate(
            { opacity: [0, 1, 0], offset: [0, 0.35, 1] },
            { duration: durationMs, easing: MOTION.easeStandard, id: FLOAT_LIFT_ID },
          )
        }
        floater.el.dataset.flying = ''
        floater.landAfter = performance.now() + durationMs * 0.8
      }
    }
    if (this.pendingFade !== null) {
      const key = this.pendingFade
      this.pendingFade = null
      const row = this.rowElement(key)
      if (row && canAnimate(row)) {
        for (const child of row.children) {
          ;(child as HTMLElement).animate({ opacity: [0, 1] }, { duration: MOTION.durationEnterMs, easing: MOTION.easeDecelerate })
        }
      }
    }
  }

  /* ---------------------------------------------------------------- 指针 */

  private onHandlePointerDown(key: string, event: ReactPointerEvent<HTMLButtonElement>): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (this.state.drag) return
    const handle = event.currentTarget
    const row = this.rowElement(key)
    if (!row) return
    event.preventDefault()
    // 落定途中的同一行：从浮起物现在的位置接着拖
    const existing = this.floaters.get(key)
    const rect = existing ? existing.el.getBoundingClientRect() : row.getBoundingClientRect()
    const floater = this.pickUp(key, 'pointer')
    if (!floater) return
    const top = existing ? floater.y.value : rect.top
    const left = existing ? floater.x.value : rect.left
    floater.x.jump(left)
    floater.y.jump(top)
    try {
      handle.setPointerCapture(event.pointerId)
    } catch {
      // 合成事件（测试）没有活动指针：不捕获也能工作，监听挂在 window 上
    }
    this.pointer = {
      id: event.pointerId,
      handle,
      grabY: event.clientY - top,
      left: row.getBoundingClientRect().left,
      y: event.clientY,
      samples: [{ t: performance.now(), y: event.clientY }],
      scroller: scrollParent(this.root.current ?? row),
      frame: 0,
    }
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerCancel)
    window.addEventListener('keydown', this.onWindowKeyDown, true)
    this.pointer.frame = requestAnimationFrame(this.autoScroll)
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const pointer = this.pointer
    if (!pointer || event.pointerId !== pointer.id) return
    pointer.y = event.clientY
    const now = performance.now()
    pointer.samples.push({ t: now, y: event.clientY })
    while (pointer.samples.length > 2 && now - pointer.samples[0]!.t > 100) pointer.samples.shift()
    this.followPointer()
  }

  /** 浮起物跟手（只跟竖向，横向锁在列表里），并按它的中线算落点。 */
  private followPointer(): void {
    const pointer = this.pointer
    const drag = this.state.drag
    if (!pointer || !drag) return
    const floater = this.floaters.get(drag.key)
    const top = pointer.y - pointer.grabY
    floater?.x.jump(pointer.left)
    floater?.y.jump(top)
    const target = this.targetAt(top + drag.height / 2, drag.key)
    if (target) this.moveOver(target.group, target.index)
  }

  /** 竖坐标 y（视口）落在哪一组的第几位（不计被拖行）：用各行的布局中线（不含让位动画）比较。 */
  private targetAt(y: number, dragKey: string): { group: string; index: number } | null {
    const cards = this.cardElements()
    let best: { id: string; card: HTMLElement; distance: number } | null = null
    for (const [id, card] of cards) {
      const rect = card.getBoundingClientRect()
      const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
      if (!best || distance < best.distance) best = { id, card, distance }
    }
    if (!best) return null
    const cardTop = best.card.getBoundingClientRect().top
    let index = 0
    for (const row of best.card.querySelectorAll<HTMLElement>(`:scope > [${KEY_ATTR}]`)) {
      const key = row.getAttribute(KEY_ATTR)
      if (key === PLACEHOLDER_KEY || key === dragKey) continue
      if (cardTop + row.offsetTop + row.offsetHeight / 2 < y) index += 1
    }
    return { group: best.id, index }
  }

  private readonly autoScroll = (): void => {
    const pointer = this.pointer
    if (!pointer) return
    const { scroller } = pointer
    const doc = scroller === document.scrollingElement || scroller === document.documentElement
    const top = doc ? 0 : scroller.getBoundingClientRect().top
    const bottom = doc ? window.innerHeight : scroller.getBoundingClientRect().bottom
    let delta = 0
    if (pointer.y < top + AUTOSCROLL_EDGE) delta = -AUTOSCROLL_MAX * ((top + AUTOSCROLL_EDGE - pointer.y) / AUTOSCROLL_EDGE) ** 2
    else if (pointer.y > bottom - AUTOSCROLL_EDGE) delta = AUTOSCROLL_MAX * ((pointer.y - (bottom - AUTOSCROLL_EDGE)) / AUTOSCROLL_EDGE) ** 2
    if (delta !== 0) {
      const before = scroller.scrollTop
      scroller.scrollTop = before + Math.max(-AUTOSCROLL_MAX, Math.min(AUTOSCROLL_MAX, delta))
      if (scroller.scrollTop !== before) this.followPointer()
    }
    pointer.frame = requestAnimationFrame(this.autoScroll)
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    const pointer = this.pointer
    if (!pointer || event.pointerId !== pointer.id) return
    const first = pointer.samples[0]
    const last = pointer.samples[pointer.samples.length - 1]
    const dt = first && last ? (last.t - first.t) / 1000 : 0
    const velocity = first && last && dt > 0 ? (last.y - first.y) / dt : 0
    this.drop(true, velocity)
  }

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (this.pointer && event.pointerId === this.pointer.id) this.drop(false)
  }

  private readonly onWindowKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.pointer) return
    event.preventDefault()
    event.stopPropagation()
    this.drop(false)
  }

  private endPointer(): void {
    const pointer = this.pointer
    if (!pointer) return
    this.pointer = null
    if (pointer.frame) cancelAnimationFrame(pointer.frame)
    try {
      if (pointer.handle.hasPointerCapture?.(pointer.id)) pointer.handle.releasePointerCapture(pointer.id)
    } catch {
      // 指针已经不在了
    }
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerCancel)
    window.removeEventListener('keydown', this.onWindowKeyDown, true)
  }

  /* ---------------------------------------------------------------- 键盘 */

  private onHandleKeyDown(key: string, event: ReactKeyboardEvent<HTMLButtonElement>): void {
    const drag = this.state.drag
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      if (event.repeat) return
      if (!drag) {
        const floater = this.pickUp(key, 'keyboard')
        if (floater) {
          // 键盘拿起：浮起物原地放大，之后跟着空位走
          this.pendingSettle.set(key, null)
        }
      } else if (drag.key === key && drag.mode === 'keyboard') {
        this.drop(true)
      }
      return
    }
    if (!drag || drag.key !== key || drag.mode !== 'keyboard') return
    if (event.key === 'Escape') {
      event.preventDefault()
      this.drop(false)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const step = event.key === 'ArrowUp' ? -1 : 1
      const groups = this.props.groups
      const g = groups.findIndex((group) => group.id === drag.overGroup)
      const count = this.countWithout(drag.overGroup, drag.key)
      let next: { group: string; index: number } | null = null
      if (step < 0 && drag.overIndex > 0) next = { group: drag.overGroup, index: drag.overIndex - 1 }
      else if (step > 0 && drag.overIndex < count) next = { group: drag.overGroup, index: drag.overIndex + 1 }
      else if (step < 0 && g > 0) {
        const prev = groups[g - 1]!
        next = { group: prev.id, index: this.countWithout(prev.id, drag.key) }
      } else if (step > 0 && g >= 0 && g < groups.length - 1) next = { group: groups[g + 1]!.id, index: 0 }
      if (next) this.moveOver(next.group, next.index)
    }
  }

  private onHandleBlur(key: string): void {
    const drag = this.state.drag
    if (drag && drag.key === key && drag.mode === 'keyboard') this.drop(false)
  }

  /* ---------------------------------------------------------------- 渲染 */

  private renderRow(group: SortableListGroup<T>, item: T, dragging: boolean): ReactNode {
    const { getKey, getLabel, renderItem, renderLeading } = this.props
    const labels = this.labels()
    const key = getKey(item)
    const label = getLabel(item)
    const leading = renderLeading?.(item)
    const transfer = group.transfer
    const content = renderItem ? renderItem(item) : label
    const singleLine = typeof content === 'string' || typeof content === 'number'
    return (
      <div
        key={key}
        className="rk-list-row rk-sortable-list__row"
        role="listitem"
        {...{ [KEY_ATTR]: key }}
        data-transfer={transfer ? '' : undefined}
        data-leading={leading != null ? '' : undefined}
        data-dragging={dragging ? '' : undefined}
        data-landing={this.state.landing.has(key) ? '' : undefined}
      >
        {transfer ? (
          <button
            type="button"
            className="rk-sortable-list__transfer"
            data-tone={transfer.tone}
            aria-label={labels.transfer(label, this.groupLabel(transfer.to))}
            onClick={() => this.transfer(key)}
          >
            {transfer.tone === 'remove' ? <MinusGlyph /> : <PlusGlyph />}
          </button>
        ) : null}
        {leading != null ? <span className="rk-list-row__leading">{leading}</span> : null}
        <span className="rk-list-row__body" data-single-line={singleLine ? '' : undefined}>
          {content}
        </span>
        <button
          type="button"
          ref={blockTouchScroll}
          className="rk-sortable-list__handle"
          aria-label={labels.handle(label)}
          aria-roledescription={labels.roleDescription}
          aria-describedby={this.instructionsId}
          aria-pressed={dragging ? true : undefined}
          onPointerDown={(event) => this.onHandlePointerDown(key, event)}
          onKeyDown={(event) => this.onHandleKeyDown(key, event)}
          onBlur={() => this.onHandleBlur(key)}
          onContextMenu={(event) => event.preventDefault()}
        >
          <HandleGlyph />
        </button>
      </div>
    )
  }

  private renderGroup(group: SortableListGroup<T>): ReactNode {
    const drag = this.state.drag
    const rows: ReactNode[] = []
    const placeholder = (
      <div
        key={PLACEHOLDER_KEY}
        className="rk-list-row rk-sortable-list__placeholder"
        aria-hidden="true"
        {...{ [KEY_ATTR]: PLACEHOLDER_KEY }}
        style={{ height: drag?.height } as CSSProperties}
      />
    )
    let n = 0
    for (const item of group.items) {
      const key = this.props.getKey(item)
      if (drag && key === drag.key) {
        rows.push(this.renderRow(group, item, true))
        continue
      }
      if (drag && drag.overGroup === group.id && drag.overIndex === n) rows.push(placeholder)
      rows.push(this.renderRow(group, item, false))
      n += 1
    }
    if (drag && drag.overGroup === group.id && drag.overIndex === n) rows.push(placeholder)
    return (
      <List.Group key={group.id} header={group.header} footer={group.footer} {...{ [GROUP_ATTR]: group.id }}>
        {rows}
      </List.Group>
    )
  }

  render() {
    const labels = this.labels()
    return (
      <div ref={this.root} className={cx('rk-sortable-list', this.props.className)} data-dragging={this.state.drag ? '' : undefined}>
        {this.props.groups.map((group) => this.renderGroup(group))}
        <p id={this.instructionsId} className="rk-sortable-list__sr" hidden>
          {labels.instructions}
        </p>
        <div className="rk-sortable-list__sr" aria-live="assertive" aria-atomic="true">
          {this.state.announcement}
        </div>
      </div>
    )
  }
}
