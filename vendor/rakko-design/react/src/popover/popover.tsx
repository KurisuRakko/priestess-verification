import { Popover as BasePopover } from '@base-ui/react/popover'
import type { ComponentProps } from 'react'
import { cx } from '../cx'

type PopoverPositionerProps = ComponentProps<typeof BasePopover.Positioner>

export interface PopoverPopupProps
  extends Omit<ComponentProps<typeof BasePopover.Popup>, 'className'> {
  className?: string
  /** 浮层位于锚点的哪一侧，转给 Positioner。不传沿用 Base UI 默认（bottom）。 */
  side?: PopoverPositionerProps['side']
  /** 浮层沿该侧的对齐方式，转给 Positioner。不传沿用 Base UI 默认（center）。 */
  align?: PopoverPositionerProps['align']
  /**
   * 浮层与锚点的间距（px，或按方位计算的函数），转给 Positioner。
   * @default 8
   */
  sideOffset?: PopoverPositionerProps['sideOffset']
  /** 沿对齐轴的偏移，转给 Positioner。不传沿用 Base UI 默认（0）。 */
  alignOffset?: PopoverPositionerProps['alignOffset']
  /** 放不下时如何避让（翻转、平移），转给 Positioner。不传沿用 Base UI 默认。 */
  collisionAvoidance?: PopoverPositionerProps['collisionAvoidance']
  /**
   * 宽度策略：
   * - `auto`（默认）：随内容收缩，默认 max-width 为 360px（且不超过视口）；
   * - `content`：按内容自然宽度展开，只受视口限制——放取色器这类有自身宽度的内容时
   *   不会被默认上限截掉。
   * @default 'auto'
   */
  width?: 'auto' | 'content'
}

/**
 * 组合 Portal > Positioner(sideOffset 8) > Popup：视觉类落在 Popup 上。
 * side / align / sideOffset / alignOffset / collisionAvoidance 转给 Positioner，其余给 Popup。
 */
function PopoverPopup({
  className,
  width = 'auto',
  side,
  align,
  sideOffset = 8,
  alignOffset,
  collisionAvoidance,
  children,
  ...props
}: PopoverPopupProps) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionAvoidance={collisionAvoidance}
        className="rk-popover__positioner"
      >
        <BasePopover.Popup
          {...props}
          className={cx('rk-popover', className)}
          data-width={width === 'content' ? 'content' : undefined}
          data-glass="panel"
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  )
}

export interface PopoverTitleProps
  extends Omit<ComponentProps<typeof BasePopover.Title>, 'className'> {
  className?: string
}

function PopoverTitle({ className, ...props }: PopoverTitleProps) {
  return (
    <BasePopover.Title {...props} className={cx('rk-popover__title', className)} />
  )
}

export interface PopoverDescriptionProps
  extends Omit<ComponentProps<typeof BasePopover.Description>, 'className'> {
  className?: string
}

function PopoverDescription({ className, ...props }: PopoverDescriptionProps) {
  return (
    <BasePopover.Description
      {...props}
      className={cx('rk-popover__description', className)}
    />
  )
}

export interface PopoverCloseProps
  extends Omit<ComponentProps<typeof BasePopover.Close>, 'className'> {
  className?: string
}

/** 无默认视觉；配合 <Button render={<Popover.Close />} /> 或自行加类。 */
function PopoverClose({ className, ...props }: PopoverCloseProps) {
  return <BasePopover.Close {...props} className={className} />
}

export const Popover = {
  Root: BasePopover.Root,
  Trigger: BasePopover.Trigger,
  Popup: PopoverPopup,
  Title: PopoverTitle,
  Description: PopoverDescription,
  Close: PopoverClose,
}
