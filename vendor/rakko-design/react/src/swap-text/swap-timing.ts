// 换内容时「旧的淡出 → 新的淡入」的节奏与打断规则（内部模块，不从 index 导出）：
// SwapText（useSwapText / useSwapPresence / crossfade）与 AnimatedList 的 resetKey 交叉淡化共用，两边不各抄一份常量。

import { MOTION } from '../motion'

/** 旧内容淡出时长占 --motion-duration-exit 的比例。 */
export const SWAP_FADE_RATIO = 0.6
/**
 * 新内容在旧拷贝淡出进行到这个比例时开始淡入（此时旧内容只剩一成左右）。等旧的完全淡完再起步，
 * 中间会有几帧什么都没有，加上淡入曲线起步慢，看着像卡了一下。
 */
export const SWAP_ENTER_AT = 0.6
/** 新内容淡入用减速曲线：一起步就看得见，尾巴收得柔（标准曲线起步太慢，前 30ms 几乎是空白）。 */
export const SWAP_EASE_ENTER = MOTION.easeDecelerate
/**
 * 换值时旧内容低于这个不透明度，说明上一次换值的淡入还没播完（连按）：不留拷贝，新内容从此刻的亮度接着淡到 1。
 * 否则连按时每一下都是「旧的淡出 → 新的淡入」，一直忽明忽暗、读不出来。
 */
export const SWAP_SETTLED_OPACITY = 0.95
/** 低于这个不透明度算「还没露面」（还在等进场）。 */
const SWAP_HIDDEN_OPACITY = 0.01

/** 旧内容淡出的时长。 */
export function swapFadeMs(): number {
  return Math.round(MOTION.durationExitMs * SWAP_FADE_RATIO)
}

/** 新内容淡入前的等待：旧拷贝淡到一成左右就起步。 */
export function swapEnterDelay(): number {
  return Math.round(swapFadeMs() * SWAP_ENTER_AT)
}

/** 元素此刻的不透明度（含正在播的动画）；读不到（没有样式引擎）按 1。 */
export function opacityOf(el: Element): number {
  const value = Number.parseFloat(getComputedStyle(el).opacity)
  return Number.isFinite(value) ? value : 1
}

/** 从 from 接着淡到 1：时长按剩下的比例缩短。 */
export function resumeMs(duration: number, from: number): number {
  return Math.round(duration * (1 - from))
}

/**
 * 换值时怎么接：
 *   - swap：旧内容已经稳定，完整走一遍「旧的留拷贝淡出、新的 swapEnterDelay 后淡入」；
 *   - wait：上一次换值的新内容还在等进场（不透明度 0、进场时刻没到），上一次的旧拷贝还在淡出——
 *     不再留拷贝，新内容顶替它，按原定时刻进场（delay 为剩下的等待），不和那份旧拷贝提前叠在一起；
 *   - resume：上一次的淡入播到一半，不留拷贝，新内容从 from 接着淡到 1，不等待；还在淡出的旧拷贝调用方摘掉。
 * enterAt 是上一次排定的进场时刻（performance.now() 的时基），没有排过为 0。
 */
export type SwapPlan = { kind: 'swap' } | { kind: 'wait'; delay: number } | { kind: 'resume'; from: number }

export function planSwap(opacity: number, enterAt: number, now: number = performance.now()): SwapPlan {
  if (opacity >= SWAP_SETTLED_OPACITY) return { kind: 'swap' }
  if (opacity < SWAP_HIDDEN_OPACITY && enterAt > now) return { kind: 'wait', delay: Math.round(enterAt - now) }
  return { kind: 'resume', from: Math.max(0, opacity) }
}
