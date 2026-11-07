/**
 * 换值不硬切（移植自 RakkoNotes 的 lists/SwapText、desktop/FadeText 与 lists/hooks 里的 useSwapText / useSwapFade）：
 *
 *   - useSwapText(ref, value)：元素里的文字换了（重命名后的标题、计数、按钮文字）——旧文字的拷贝留在原位淡出，
 *     新文字随后淡入，两段不重叠。拷贝插在元素旁边、按它的 offsetParent 绝对定位，跟着元素一起移动。
 *   - useSwapPresence(ref)：元素整个出现 / 消失与别的内容互换（空状态 ↔ 列表）——卸载时原位留一份拷贝淡出并略收，
 *     同一次提交里挂上的元素等它淡完再淡入（任何一帧只有一层文字）。页面首次渲染、整页卸载不受影响。
 *   - <SwapText value>：包一层 span 的现成组件。mode='sequence'（默认）走 useSwapText；
 *     mode='crossfade' 是两份叠在同一个格子里同时交叉淡化（宽度取两者较宽的，换字过程中不跳；第一次出现也淡入）。
 *
 * 节奏（swap-timing.ts，与 AnimatedList 交叉淡化共用）：旧内容淡出 = --motion-duration-exit × 0.6，淡出进行到 60% 时
 * 新内容用减速曲线淡入（文字换值 --motion-duration-state，整块互换 --motion-duration-enter）；连着换时从当前亮度接着走，
 * 不从 0 / 1 起跳（planSwap）。消失时的略收用 snappy 弹簧。减弱动态效果时直接换。
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { cx } from '../cx'
import { MOTION } from '../motion'
import { reducedMotionQuery } from '../motion-dom'
import { SPRINGS, springEasing } from '../spring'
import {
  SWAP_EASE_ENTER,
  opacityOf,
  planSwap,
  resumeMs,
  swapEnterDelay,
  swapFadeMs,
} from './swap-timing'

// 节奏常量在 swap-timing.ts（与 AnimatedList 的交叉淡化共用），这里转出给测试和调用方对照
export { SWAP_EASE_ENTER, SWAP_ENTER_AT, SWAP_FADE_RATIO } from './swap-timing'
/** 被替换的内容（useSwapPresence 的卸载拷贝）淡出时收到多大。 */
export const SWAP_SHRINK = 0.96

/** 拷贝上去掉的属性：不被 AnimatedList 量到、不被长按菜单命中、id 不重复。 */
const SCRUB_ATTRS = [
  'id',
  'data-rk-flip-key',
  'data-rk-flip-root',
  'data-rk-flip-collapse',
  'data-context-id',
  'data-context-action',
]

function reduced(): boolean {
  return reducedMotionQuery()?.matches ?? false
}

function canAnimate(el: Element): boolean {
  return typeof el.animate === 'function'
}

/** 把拷贝做成不可交互、读屏不读、里面的 CSS 进场动画不重播的静态快照，摆在 box 处。 */
function dressGhost(ghost: HTMLElement, box: { top: number; left: number; width: number; height?: number }): void {
  for (const node of [ghost, ...ghost.querySelectorAll<HTMLElement>('*')]) {
    for (const name of SCRUB_ATTRS) node.removeAttribute(name)
  }
  ghost.classList.add('rk-swap-ghost')
  ghost.dataset.rkSwapGhost = ''
  ghost.setAttribute('aria-hidden', 'true')
  ghost.inert = true
  Object.assign(ghost.style, {
    position: 'absolute',
    top: `${box.top}px`,
    left: `${box.left}px`,
    width: `${box.width}px`,
    ...(box.height === undefined ? {} : { height: `${box.height}px` }),
    boxSizing: 'border-box',
    margin: '0',
    pointerEvents: 'none',
  })
}

function fadeOutGhost(ghost: HTMLElement, from = 1): void {
  const done = () => ghost.remove()
  ghost
    .animate({ opacity: [from, 0] }, { duration: swapFadeMs(), easing: MOTION.easeStandard, fill: 'forwards' })
    .finished.then(done, done)
}

/** 新内容淡入。文字换值用状态时长（一行字，短而轻）；整块互换（空状态）用进场时长。 */
function fadeInAfterGhost(el: HTMLElement, duration: number = MOTION.durationEnterMs): Animation {
  return el.animate(
    { opacity: [0, 1] },
    { duration, delay: swapEnterDelay(), easing: SWAP_EASE_ENTER, fill: 'backwards' },
  )
}

/* ------------------------------------------------------------------ 出现 / 消失互换 */

/** 这一次提交里刚有元素留下了淡出的拷贝：同一次提交里挂上的元素据此等它淡完再淡入。 */
let ghostPending = false

/** 卸载前在原位留一份静态拷贝淡出；拷贝插在原父元素里，父元素一起被卸掉时跟着走。 */
function leavePresenceGhost(el: HTMLElement): void {
  if (!el.isConnected || !el.parentElement || el.offsetWidth === 0 || !canAnimate(el) || reduced()) return
  // 正在淡入 / 淡出到一半的从此刻的不透明度接着淡；读不到（没有样式引擎）按 1
  const opacity = opacityOf(el)
  if (!(opacity > 0.01)) return
  const ghost = el.cloneNode(true) as HTMLElement
  dressGhost(ghost, { top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth })
  el.after(ghost)
  ghostPending = true
  queueMicrotask(() => {
    ghostPending = false
  })
  fadeOutGhost(ghost, opacity)
  // 淡出的同时略收（snappy 弹簧）：让位给接替它的内容，不是原地消失
  const { easing, durationMs } = springEasing(SPRINGS.snappy)
  ghost.animate({ scale: [1, SWAP_SHRINK] }, { duration: durationMs, easing, fill: 'forwards' })
}

/**
 * 元素与别的内容互换时不硬切（删掉最后一行后空状态出现、新建第一条后空状态让位）：
 * 卸载时原位留一份拷贝淡出并略收；挂载时若同一次提交里刚有元素淡出，等它淡完再淡入。
 * 拷贝带 data-rk-swap-ghost 与 .rk-swap-ghost。
 */
export function useSwapPresence(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (ghostPending && canAnimate(el) && !reduced()) fadeInAfterGhost(el)
    return () => leavePresenceGhost(el)
  }, [ref])
}

/* ------------------------------------------------------------------ 文字换了 */

interface TextSnapshot {
  clone: HTMLElement
  top: number
  left: number
  width: number
  height: number
  /** 拍下时的不透明度：连按时上一次的新字可能还在淡入，拷贝从这里接着淡，不从 1 闪出来。 */
  opacity: number
  /** 拍下时只占一行：拷贝不许折行（offsetWidth 取整，可能比文字实际宽度窄零点几像素）。 */
  singleLine: boolean
}

/**
 * 元素里的文字换了不硬切：旧文字的拷贝留在原位淡出，新文字随后淡入。
 * value 是「内容」的标识（不含搜索高亮这类不算换内容的变化）；首次挂载不动。
 * 渲染时（React 改 DOM 之前）拍下旧内容，layout effect 里插拷贝、起动画。
 */
export function useSwapText(ref: RefObject<HTMLElement | null>, value: string): void {
  const prev = useRef(value)
  const snapshot = useRef<TextSnapshot | null>(null)
  const fadeIn = useRef<Animation | null>(null)
  /** 上一次换值留下的旧字拷贝（可能还在淡出）。 */
  const ghostRef = useRef<HTMLElement | null>(null)
  /** 上一次排定的新字进场时刻（performance.now() 时基），没排过为 0。 */
  const enterAt = useRef(0)
  // 渲染期读 DOM 是有意的：这是 React 把旧文字换掉之前最后一次能拍到它的时机
  const el = ref.current
  if (prev.current !== value && el && !snapshot.current && el.isConnected) {
    snapshot.current = {
      clone: el.cloneNode(true) as HTMLElement,
      top: el.offsetTop,
      left: el.offsetLeft,
      width: el.offsetWidth,
      height: el.offsetHeight,
      opacity: opacityOf(el),
      singleLine: el.getClientRects().length <= 1,
    }
  }
  useLayoutEffect(() => {
    if (prev.current === value) return
    prev.current = value
    const snap = snapshot.current
    snapshot.current = null
    const node = ref.current
    if (!node || !snap || !node.isConnected || snap.width === 0 || !canAnimate(node) || reduced()) return
    fadeIn.current?.cancel()
    const plan = planSwap(snap.opacity, enterAt.current)
    if (plan.kind === 'wait') {
      // 上一次的新字还没露面、旧字拷贝还在淡出：新字顶替它、按原定时刻进场，不提前和那份旧拷贝叠出一个过时的字
      fadeIn.current = node.animate(
        { opacity: [0, 1] },
        { duration: MOTION.durationStateMs, delay: plan.delay, easing: SWAP_EASE_ENTER, fill: 'backwards' },
      )
      return
    }
    if (plan.kind === 'resume') {
      // 连按：上一次的新字还在淡入。不留拷贝，新字从此刻的亮度接着淡到 1——只会越来越清楚，不会再暗下去；
      // 上一次还在淡出的旧拷贝（此时只剩一两成）直接摘掉，不和新字叠在一起
      ghostRef.current?.remove()
      ghostRef.current = null
      enterAt.current = 0
      fadeIn.current = node.animate(
        { opacity: [plan.from, 1] },
        { duration: resumeMs(MOTION.durationStateMs, plan.from), easing: SWAP_EASE_ENTER, fill: 'backwards' },
      )
      return
    }
    const ghost = snap.clone
    dressGhost(ghost, snap)
    if (snap.singleLine) ghost.style.whiteSpace = 'nowrap'
    node.after(ghost)
    fadeOutGhost(ghost)
    ghostRef.current = ghost
    enterAt.current = performance.now() + swapEnterDelay()
    fadeIn.current = fadeInAfterGhost(node, MOTION.durationStateMs)
  }, [ref, value])
}

/* ------------------------------------------------------------------ 组件 */

export type SwapTextMode = 'sequence' | 'crossfade'

export interface SwapTextProps {
  value: string
  /**
   * 'sequence'：旧字拷贝原位淡出、新字随后淡入（两段不重叠），不改元素自身布局；
   * 'crossfade'：两份叠在同一格子里同时交叉淡化（--motion-duration-state），单行省略号，宽度取较宽者、换字时不跳。
   * @default 'sequence'
   */
  mode?: SwapTextMode
  /**
   * crossfade 是否按正常文本折行：为 true 时新旧两份都不截断、不省略，格子高度取较高者。
   * 只对 crossfade 生效——sequence 只有一份文字，本来就随容器折行，旧字拷贝也按拍下的折行摆放。
   * @default false
   */
  wrap?: boolean
  className?: string
}

/** 一段会变的文字（标题、计数、按钮文字）：换了不硬切。 */
export function SwapText({ value, mode = 'sequence', wrap = false, className }: SwapTextProps) {
  return mode === 'crossfade' ? (
    <CrossfadeText value={value} wrap={wrap} className={className} />
  ) : (
    <SequenceText value={value} className={className} />
  )
}

function SequenceText({ value, className }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useSwapText(ref, value)
  return (
    <span ref={ref} className={cx('rk-swap-text', className)}>
      {value}
    </span>
  )
}

/** crossfade 的新字这一段淡入从哪里起步：换值时记下，layout effect 里起动画。 */
interface CrossfadeEntry {
  /** 0 = 完整淡入；> 0 = 上一段淡入没播完，从这个亮度接着淡。 */
  from: number
  n: number
}

/**
 * 新旧两份叠在同一个格子里同时淡化（WAAPI，--motion-duration-state、标准曲线）。
 * 新字那一格是同一个元素，换值时读它此刻的不透明度：
 *   - 已经稳定：旧字作为一份 aria-hidden 的拷贝从此刻亮度淡到 0，新字从 0 淡入（连着换只留最近一份旧字，空串不画）；
 *   - 上一段淡入没播完（连点）：不再出旧字拷贝，新字从此刻的亮度接着淡到 1，不从 0 / 1 起跳；正在淡出的那份旧字照常淡完。
 * 旧字淡完就摘掉。减弱动态效果或没有 WAAPI 时直接换字，不画旧字。
 * wrap 时挂 .rk-swap-text--wrap：两份都按正常文本折行，格子高度由 CSS grid 取较高的一份。
 */
function CrossfadeText({ value, wrap, className }: { value: string; wrap?: boolean; className?: string }) {
  const inRef = useRef<HTMLSpanElement>(null)
  const outRef = useRef<HTMLSpanElement>(null)
  const fadeIn = useRef<Animation | null>(null)
  const [shown, setShown] = useState(value)
  const [entry, setEntry] = useState<CrossfadeEntry>({ from: 0, n: 0 })
  const [leaving, setLeaving] = useState<{ text: string; id: number; from: number } | null>(null)
  if (shown !== value) {
    // 渲染期读 DOM 是有意的：新字那一格还没换内容，读到的是旧字此刻（含进行中动画）的亮度
    const el = inRef.current
    const animated = el !== null && canAnimate(el) && !reduced()
    const opacity = animated ? opacityOf(el) : 1
    const plan = planSwap(opacity, 0)
    setShown(value)
    if (!animated) {
      setLeaving(null)
    } else if (plan.kind === 'swap') {
      setLeaving(shown === '' ? null : { text: shown, id: (leaving?.id ?? 0) + 1, from: opacity })
      setEntry({ from: 0, n: entry.n + 1 })
    } else {
      setEntry({ from: plan.kind === 'resume' ? plan.from : 0, n: entry.n + 1 })
    }
  }

  // 新字淡入：首次出现也淡入；换值时先撤掉上一段
  useLayoutEffect(() => {
    const el = inRef.current
    fadeIn.current?.cancel()
    fadeIn.current = null
    if (!el || !canAnimate(el) || reduced()) return
    const { from } = entry
    fadeIn.current = el.animate(
      { opacity: [from, 1] },
      { duration: resumeMs(MOTION.durationStateMs, from), easing: MOTION.easeStandard, fill: 'backwards' },
    )
  }, [entry])

  // 旧字淡出，淡完摘掉
  const leavingId = leaving?.id
  const leavingFrom = leaving?.from
  useLayoutEffect(() => {
    const el = outRef.current
    if (leavingId === undefined || leavingFrom === undefined || !el) return
    const done = () => setLeaving((current) => (current?.id === leavingId ? null : current))
    const fade = el.animate(
      { opacity: [leavingFrom, 0] },
      { duration: MOTION.durationStateMs, easing: MOTION.easeStandard, fill: 'forwards' },
    )
    fade.finished.then(done, () => {})
    return () => fade.cancel()
  }, [leavingId, leavingFrom])

  return (
    <span className={cx('rk-swap-text', 'rk-swap-text--crossfade', wrap && 'rk-swap-text--wrap', className)}>
      <span ref={inRef} className="rk-swap-text__in">
        {value}
      </span>
      {leaving ? (
        <span key={`out-${leaving.id}`} ref={outRef} className="rk-swap-text__out" aria-hidden="true">
          {leaving.text}
        </span>
      ) : null}
    </span>
  )
}
