import { useLayoutEffect, useRef } from 'react'
import { cx } from '../cx'
import { MOTION } from '../motion'
import { SPRINGS, prefersReducedMotion, springEasing } from '../spring'

export interface NumberRollProps {
  /** 已经格式化好的字符串，例如 "$12,480.32"、"+1.24%"、"−0.42%" */
  value: string
  className?: string
}

/** 相邻两位开始滚动的间隔（毫秒）。 */
const STAGGER_MS = 35
/** 错峰最多几档：第 3 位及更高的位一起动，位数再多最后一位也不会晚太久。 */
const STAGGER_STEPS = 3
/** 一个格子里最多同时留几个正在滚出的旧数字；再多时最老的那个直接播完（它早已淡得差不多了）。 */
const MAX_LEAVING = 3

/** "−" (U+2212) 也当负号；解析不了就当 0（只用来判断滚动方向）。 */
function numeric(value: string): number {
  const parsed = Number(value.replace(/−/g, '-').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

/** 第 order 个变化的位（从个位数起）的错峰延迟。 */
function staggerDelay(order: number): number {
  return Math.min(order, STAGGER_STEPS - 1) * STAGGER_MS
}

/**
 * 滚动数字：值变化时每一位数字单独上下滚动换成新值（变大往上滚、变小往下滚），
 * 从个位开始依次错开 35ms（最多 3 档），曲线是 smooth 弹簧。没变的位不动；位数变化时按右对齐，
 * 新增的位宽度从 0 展开、数字滚进来，少掉的位宽度收起、数字滚出去。
 *
 * 格子里的数字由本组件直接操作 DOM，React 只渲染格子本身（按「从右数第几位」做 key）。
 * 读屏读隐藏的完整文本，不读逐位格子。reduced-motion 下直接换字，不滚动。
 */
export function NumberRoll({ value, className }: NumberRollProps) {
  const root = useRef<HTMLSpanElement>(null)
  const previous = useRef(value)
  // 上一次提交后 React 渲染的逐位节点；首次挂载前是 null（首帧不做进场）
  const cellsBefore = useRef<Element[] | null>(null)
  const chars = Array.from(value)

  useLayoutEffect(() => {
    const el = root.current
    if (el === null) return
    const old = previous.current
    previous.current = value
    const dir = numeric(value) >= numeric(old) ? 1 : -1
    const before = cellsBefore.current
    const now = Array.from(el.children).filter((child) => child.hasAttribute('data-k'))
    cellsBefore.current = now
    const animate = before !== null && !prefersReducedMotion() && typeof el.animate === 'function'
    const timing = springEasing(SPRINGS.smooth)

    if (animate) {
      // 少掉的位：React 已经把节点删了，挂回最左边当残影，宽度收起后自己删
      const kept = new Set(now)
      let anchor = el.children[0]
      for (const node of before) {
        if (kept.has(node)) continue
        leave(anchor, node as HTMLElement, dir, timing)
        anchor = node
      }
    }

    const added = new Set(animate ? now.filter((node) => !before.includes(node)) : [])
    const cells = Array.from(el.querySelectorAll<HTMLElement>('[data-r]')).sort(
      (a, b) => Number(a.dataset.r) - Number(b.dataset.r),
    )
    let order = 0
    for (const cell of cells) {
      const want = chars[chars.length - 1 - Number(cell.dataset.r)] ?? ''
      const has = cell.dataset.d
      cell.dataset.d = want
      if (has === want) continue
      if (added.has(cell)) {
        // 新增的位：宽度从 0 展开，数字从下（或上）滚进来
        roll(cell, want, dir, staggerDelay(order), timing)
        grow(cell, staggerDelay(order), timing)
        order += 1
        continue
      }
      if (has === undefined || !animate) {
        const span = document.createElement('span')
        span.textContent = want
        cell.replaceChildren(span)
        continue
      }
      roll(cell, want, dir, staggerDelay(order), timing)
      order += 1
    }
    // 新增的符号（千分位逗号、正负号、百分号）：宽度展开 + 淡入
    for (const node of added) {
      if (node.hasAttribute('data-r')) continue
      const span = node as HTMLElement
      grow(span, 0, timing)
      span.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION.durationEnterMs, easing: MOTION.easeStandard })
    }
  })

  return (
    <span ref={root} className={cx('rk-number-roll', className)}>
      <span className="rk-number-roll__text">{value}</span>
      {chars.map((char, index) => {
        const r = chars.length - 1 - index
        return /[0-9]/.test(char) ? (
          // data-c：格子还空着时（SSR、首帧前）由 CSS ::before 显示这一位，不会整串不可见
          <span key={`d${r}`} className="rk-number-roll__digit" data-k="" data-r={r} data-c={char} aria-hidden="true" />
        ) : (
          <span key={`c${r}-${char}`} data-k="" aria-hidden="true">
            {char}
          </span>
        )
      })}
    </span>
  )
}

/** 新数字从下（或上）滚进来，旧数字同时滚出去；旧的播完就删。 */
function roll(cell: HTMLElement, to: string, dir: 1 | -1, delay: number, spring: { easing: string; durationMs: number }): void {
  // 上上次及更早还在滚出的旧数字还看得见，不能硬删：让它们快速淡出，滚完或淡完自己删；
  // 数量超过上限时最老的那个直接播完（这时它已经淡了一阵、又在往格子外走）
  const leaving = Array.from(cell.children).slice(0, -1) as HTMLElement[]
  for (const node of leaving) {
    if (node.dataset.fading !== undefined) continue
    node.dataset.fading = ''
    const fade = node.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: MOTION.durationExitMs,
      easing: MOTION.easeStandard,
      fill: 'forwards',
    })
    fade.onfinish = () => node.remove()
  }
  if (leaving.length >= MAX_LEAVING) {
    for (const animation of animationsOf(leaving[0])) animation.finish()
    leaving[0].remove()
  }

  const old = cell.lastElementChild as HTMLElement | null
  const next = document.createElement('span')
  next.textContent = to
  cell.append(next)
  const timing = { duration: spring.durationMs, easing: spring.easing, delay }
  if (old !== null) {
    // 上一次的新数字可能还没滚到位：从它当前的位置接着滚出去，不要跳回原位；
    // fill: both 让它在错峰等待期间停在当前位置，不先弹回 0
    const current = getComputedStyle(old).translate
    for (const animation of animationsOf(old)) animation.cancel()
    const out = old.animate([{ translate: current === 'none' || current === '' ? '0 0' : current }, { translate: `0 ${-dir * 100}%` }], {
      ...timing,
      fill: 'both',
    })
    out.onfinish = () => old.remove()
  }
  next.animate([{ translate: `0 ${dir * 100}%` }, { translate: '0 0' }], { ...timing, fill: 'backwards' })
}

/** 新增的位宽度从 0 展开（只在动画期间裁掉溢出，播完还原）。 */
function grow(node: HTMLElement, delay: number, spring: { easing: string; durationMs: number }): void {
  const width = node.getBoundingClientRect().width
  if (width <= 0) return
  node.style.overflow = 'hidden'
  const animation = node.animate([{ width: '0px' }, { width: `${width}px` }], {
    duration: spring.durationMs,
    easing: spring.easing,
    delay,
    fill: 'backwards',
  })
  const restore = () => node.style.removeProperty('overflow')
  animation.onfinish = restore
  animation.oncancel = restore
}

/**
 * 少掉的位：把 React 删掉的节点按原顺序挂回最左边（anchor 之后）当残影（不再带 data-r / data-k，不参与下次比对），
 * 数字滚出去、符号淡出，同时宽度收起，收完删掉。
 */
function leave(anchor: Element, node: HTMLElement, dir: 1 | -1, spring: { easing: string; durationMs: number }): void {
  node.removeAttribute('data-r')
  node.removeAttribute('data-k')
  anchor.after(node)
  const width = node.getBoundingClientRect().width
  const timing = { duration: spring.durationMs, easing: spring.easing, fill: 'forwards' as const }
  const digit = node.classList.contains('rk-number-roll__digit') ? (node.lastElementChild as HTMLElement | null) : null
  if (digit !== null) {
    for (const animation of animationsOf(digit)) animation.cancel()
    digit.animate([{ translate: '0 0' }, { translate: `0 ${-dir * 100}%` }], timing)
  } else {
    node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MOTION.durationExitMs, easing: MOTION.easeStandard, fill: 'forwards' })
  }
  node.style.overflow = 'hidden'
  const collapse = node.animate([{ width: `${width}px` }, { width: '0px' }], timing)
  collapse.onfinish = () => node.remove()
  collapse.oncancel = () => node.remove()
}

function animationsOf(el: Element): Animation[] {
  return typeof el.getAnimations === 'function' ? el.getAnimations() : []
}
