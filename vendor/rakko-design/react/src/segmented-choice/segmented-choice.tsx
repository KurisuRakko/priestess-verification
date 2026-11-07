import { RadioGroup } from '@base-ui/react/radio-group'
import type { RadioGroupProps } from '@base-ui/react/radio-group'
import { Radio } from '@base-ui/react/radio'
import type { RadioRootProps } from '@base-ui/react/radio'
import { useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../cx'
import { reducedMotionQuery } from '../motion-dom'
import { SPRINGS, springEasing } from '../spring'

/** 分组必须携带可访问名称：aria-label 或 aria-labelledby 二选一。 */
type RadioGroupAria =
  | { 'aria-label': string }
  | { 'aria-labelledby': string }

export type SegmentedChoiceRootProps = Omit<
  RadioGroupProps<string>,
  'className'
> &
  RadioGroupAria & {
    className?: string
    /**
     * 排列方向。`vertical` 时分段纵向堆叠，滑块按选中项的 offsetTop / offsetHeight 定位与滑动，
     * 并在分组上标 aria-orientation="vertical"；上 / 下方向键移动并选中（左 / 右仍按 WAI-ARIA
     * radio group 的约定前后移动）。
     * @default 'horizontal'
     */
    orientation?: 'horizontal' | 'vertical'
  }

/**
 * 把滑块放到当前选中项下面。slide 为真且滑块已经在某一项下时，用 snappy 弹簧从它此刻的位置
 * （可能是上一段还没播完的中途）滑过去：先读当前的 translate / 尺寸，再撤掉旧动画，不堆叠；
 * 只动 translate 与主轴尺寸（横排 width，竖排 height）。尺寸直接取选中项的实测值，圆角不会被拉伸。
 * 减弱动态效果、首次放置、尺寸变化时直接到位。没有选中项时藏起来。
 */
function placeThumb(thumb: HTMLElement, slide: boolean): void {
  const root = thumb.parentElement
  const item = root?.querySelector<HTMLElement>(':scope > .rk-segment[data-checked]')
  if (!item) {
    delete thumb.dataset.ready
    for (const animation of thumb.getAnimations?.() ?? []) animation.cancel()
    return
  }
  const vertical = root?.getAttribute('aria-orientation') === 'vertical'
  const size = vertical ? 'height' : 'width'
  const crossSize = vertical ? 'width' : 'height'
  const translate = vertical ? `0 ${item.offsetTop}px` : `${item.offsetLeft}px 0`
  const length = `${vertical ? item.offsetHeight : item.offsetWidth}px`
  const wasPlaced = thumb.dataset.ready !== undefined
  // 换了方向：另一条轴上留下的尺寸要清掉，并且直接到位不滑
  const axisChanged = thumb.style[crossSize] !== ''
  if (wasPlaced && !axisChanged && thumb.style.translate === translate && thumb.style[size] === length) return
  const style = getComputedStyle(thumb)
  const from: Keyframe = { translate: style.translate, [size]: style[size] }
  for (const animation of thumb.getAnimations?.() ?? []) animation.cancel()
  thumb.style.translate = translate
  thumb.style[size] = length
  thumb.style[crossSize] = ''
  thumb.dataset.ready = ''
  if (!slide || !wasPlaced || axisChanged || typeof thumb.animate !== 'function' || reducedMotionQuery()?.matches) return
  const { easing, durationMs } = springEasing(SPRINGS.snappy)
  thumb.animate([from, { translate, [size]: length }], { duration: durationMs, easing })
}

/**
 * 互斥分段选择：radiogroup / radio 语义（Base UI 保留隐藏原生 input 供表单提交），
 * 方向键在分段间移动并选中（motion.md）。选中底色是一块滑块，换选中项时用 snappy 弹簧
 * 滑过去（与 Tabs / SideNav 指示条同一条曲线），选中项的字色照常切换。
 * orientation="vertical" 时纵向堆叠，滑块沿纵轴滑动，动效与禁用过渡同横排。
 */
function SegmentedChoiceRoot({
  className,
  children,
  onValueChange,
  orientation = 'horizontal',
  ...props
}: SegmentedChoiceRootProps) {
  const thumbRef = useRef<HTMLSpanElement>(null)
  // 非受控时选中值在 Base UI 内部，本组件不会重渲染：每次 onValueChange 记一笔，触发下面的 layout effect
  const [changes, setChanges] = useState(0)

  useLayoutEffect(() => {
    const thumb = thumbRef.current
    if (thumb) placeThumb(thumb, true)
  }, [props.value, changes, orientation])

  // 容器或分段尺寸变了（窄屏、字体加载、换语言）：直接重新对齐，不滑
  useLayoutEffect(() => {
    const thumb = thumbRef.current
    const root = thumb?.parentElement
    if (!thumb || !root || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => placeThumb(thumb, false))
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  return (
    <RadioGroup
      {...props}
      aria-orientation={orientation === 'vertical' ? 'vertical' : undefined}
      onValueChange={(value, details) => {
        setChanges((count) => count + 1)
        onValueChange?.(value, details)
      }}
      className={cx('rk-segments', className)}
    >
      <span ref={thumbRef} className="rk-segments__thumb" aria-hidden="true" />
      {children}
    </RadioGroup>
  )
}

export interface SegmentedChoiceItemProps
  extends Omit<RadioRootProps<string>, 'className'> {
  className?: string
}

function SegmentedChoiceItem({
  className,
  children,
  ...props
}: SegmentedChoiceItemProps) {
  return (
    <Radio.Root {...props} data-ripple className={cx('rk-segment', className)}>
      {children}
    </Radio.Root>
  )
}

export const SegmentedChoice = {
  Root: SegmentedChoiceRoot,
  Item: SegmentedChoiceItem,
}
