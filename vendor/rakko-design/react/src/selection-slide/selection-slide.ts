/**
 * 选中高亮在行间滑动（移植自 RakkoNotes desktop/selectionSlide）：像一颗药丸从旧行滑到新行。只用 WAAPI，不给行加 class / 属性。
 *
 * 约定：选中行的高亮画在 background-image 上（如 `background-image: linear-gradient(c, c)`），不画在 background-color 上
 * （按下 / 悬停的底色反馈照旧在 background-color）。这里在两行上各放一段动画，让同一颗「虚拟药丸」从旧行此刻的位置
 * 弹簧（snappy）走到新行：新行的高亮从偏移处移回原位，旧行临时画上同一张高亮、向新行方向移出去；背景图按行裁切，
 * 接缝处两段正好接上。两段同一条曲线、偏移都是药丸位置的线性函数，任何一帧都对得上。
 *
 * 可打断：连按 ↑ / ↓ 时从药丸此刻的位置（旧行的布局位置 + 它正在播的偏移）接着走，旧动画直接撤掉，不堆叠。
 * 离得远（跨了好几行，中间的行不画高亮，一路滑过去像闪现）时只滑最后一段：药丸从新行旁边一行高的地方进来，
 * 旧行的高亮朝同一方向滑出同样的距离。旧行已经不在了（换了视图）、减弱动态效果时直接换。
 *
 * 新选中的行还没挂载（如新建记录的那一刻）时，旧行先留着同一张高亮，最多等 WAIT_FRAMES 帧：新行出现了就照常滑过去；
 * 等不到就把旧行的高亮按 --motion-duration-state / --motion-ease-standard 收起（背景图不能插值透明度，用高度收到 0），
 * 不再硬切。等待中 selectedKey 又变了照样打断。
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { reducedMotionQuery, rootTimeMs, rootToken } from '../motion-dom'
import { SPRINGS, springEasing } from '../spring'

/** 默认怎么在容器里找选中的元素。 */
export const SELECTION_SLIDE_SELECTOR = '[aria-selected="true"], [aria-current]:not([aria-current="false"])'

export interface SelectionSlideOptions {
  /** 在容器里找选中元素：CSS 选择器，或自己找的函数。@default SELECTION_SLIDE_SELECTOR */
  selected?: string | ((container: HTMLElement) => HTMLElement | null)
  /**
   * 选中元素 → 画高亮（background-image）的那个元素。高亮画在子元素上时用，
   * 例如 SwipeRow：`(row) => row.querySelector('.rk-swipe-row__content')`。@default 选中元素本身
   */
  surface?: (selected: HTMLElement) => HTMLElement | null
}

/** 新行还没出现时最多等几帧。 */
export const SELECTION_SLIDE_WAIT_FRAMES = 3

interface SlideState {
  /** 上一次选中的高亮面。 */
  row: HTMLElement | null
  /** 上一次选中时高亮的背景图，新行还没出现时旧行临时画它。 */
  image: string | null
  animations: Animation[]
  /** 正在等新行的 requestAnimationFrame id。 */
  wait: number | null
}

/** 背景图此刻的纵向偏移（px）；没有在播就是 0。 */
function offsetOf(el: HTMLElement): number {
  const value = parseFloat(getComputedStyle(el).backgroundPositionY)
  return Number.isFinite(value) ? value : 0
}

function clear(slide: SlideState): void {
  if (slide.wait !== null) {
    cancelAnimationFrame(slide.wait)
    slide.wait = null
  }
  for (const animation of slide.animations) animation.cancel()
  slide.animations = []
}

/** 选中换到了 next（高亮已经在 DOM 上）：从上一次选中的行滑过来。 */
function slideTo(slide: SlideState, next: HTMLElement): void {
  const prev = slide.row
  slide.row = next
  const current = getComputedStyle(next).backgroundImage
  slide.image = current && current !== 'none' ? current : null
  if (!prev || prev === next || !prev.isConnected || typeof next.animate !== 'function' || reducedMotionQuery()?.matches) {
    clear(slide)
    return
  }
  // 先读药丸此刻在哪（旧行的布局位置 + 正在播的偏移），再撤掉旧动画
  const prevOffset = slide.animations.length > 0 ? offsetOf(prev) : 0
  const prevTop = prev.getBoundingClientRect().top
  const nextTop = next.getBoundingClientRect().top
  // 行高也在撤动画之前读：撤掉动画会弄脏样式，之后再读布局就得再算一遍（背景动画不影响布局，读到的值一样）
  const reach = Math.max(next.offsetHeight, 1)
  clear(slide)
  let from = prevTop + prevOffset - nextTop
  if (Math.abs(from) < 1) return
  // 不相邻（跨了好几行）时只滑最后一行高：从新行旁边一行的位置进来，旧行也只滑出这么远。
  // 相邻的不截（连按时上一段还没走完，药丸可能比一行略远，照实际位置走）
  let prevTo = nextTop - prevTop
  if (Math.abs(prevTo) > reach * 1.5) {
    const sign = Math.sign(from)
    from = sign * reach
    prevTo = prevOffset - sign * reach
  }

  const image = getComputedStyle(next).backgroundImage
  if (!image || image === 'none') return
  const { easing, durationMs } = springEasing(SPRINGS.snappy)
  const timing: KeyframeAnimationOptions = { duration: durationMs, easing }
  const frame = (y: number): Keyframe => ({ backgroundPosition: `0 ${y}px`, backgroundRepeat: 'no-repeat' })
  slide.animations = [
    next.animate([frame(from), frame(0)], timing),
    prev.animate(
      [
        { ...frame(prevOffset), backgroundImage: image },
        { ...frame(prevTo), backgroundImage: image },
      ],
      timing,
    ),
  ]
}

/**
 * 选中换了但新行还没出现：旧行临时画上原来的高亮，逐帧找新行；找到就从旧行滑过去，
 * 等满 WAIT_FRAMES 帧还没有就把旧行高亮收起，之后不再从它接着滑。
 */
function awaitTarget(slide: SlideState, find: () => HTMLElement | null): void {
  const prev = slide.row
  const image = slide.image
  if (
    !prev ||
    !image ||
    !prev.isConnected ||
    typeof prev.animate !== 'function' ||
    typeof requestAnimationFrame !== 'function' ||
    reducedMotionQuery()?.matches
  ) {
    clear(slide)
    slide.row = null
    return
  }
  const prevOffset = slide.animations.length > 0 ? offsetOf(prev) : 0
  clear(slide)
  const durationMs = rootTimeMs('--motion-duration-state', 160)
  const easing = rootToken('--motion-ease-standard') || 'ease'
  const held = (size: string): Keyframe => ({
    backgroundImage: image,
    backgroundPosition: `0 ${prevOffset}px`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: size,
  })
  // 等待期间高亮原样留着；直到确认等不到才开始收起
  const hold = prev.animate([held('100% 100%'), held('100% 100%')], { duration: Infinity })
  slide.animations = [hold]
  let frames = 0
  const tick = () => {
    slide.wait = null
    const next = find()
    if (next) {
      slideTo(slide, next)
      return
    }
    if (++frames < SELECTION_SLIDE_WAIT_FRAMES) {
      slide.wait = requestAnimationFrame(tick)
      return
    }
    hold.cancel()
    slide.row = null
    slide.animations = [
      prev.animate([held('100% 100%'), held('100% 0%')], { duration: durationMs, easing, fill: 'none' }),
    ]
  }
  slide.wait = requestAnimationFrame(tick)
}

/**
 * selectedKey 变了就让高亮从上一次选中的行滑到新选中的行。在 layout effect 里找新行（此时高亮已经在 DOM 上）；
 * 首次挂载只记下当前行，不动。找不到选中元素时等几帧（见 awaitTarget），等不到旧高亮收起。
 */
export function useSelectionSlide(
  containerRef: RefObject<HTMLElement | null>,
  selectedKey: unknown,
  options: SelectionSlideOptions = {},
): void {
  const [slide] = useState<SlideState>(() => ({ row: null, image: null, animations: [], wait: null }))
  // options 常是每次渲染新建的字面量：放进 ref，不当成 effect 依赖（只有 selectedKey 变了才滑）
  const optionsRef = useRef(options)
  useLayoutEffect(() => {
    optionsRef.current = options
  })

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const find = (): HTMLElement | null => {
      const { selected = SELECTION_SLIDE_SELECTOR, surface } = optionsRef.current
      const el = typeof selected === 'string' ? container.querySelector<HTMLElement>(selected) : selected(container)
      return el && surface ? surface(el) : el
    }
    const target = find()
    if (target) slideTo(slide, target)
    else awaitTarget(slide, find)
  }, [containerRef, selectedKey, slide])

  useLayoutEffect(() => () => clear(slide), [slide])
}
