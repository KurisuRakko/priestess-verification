import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import type { ComponentProps, CSSProperties } from 'react'
import { cx } from '../cx.js'

export interface TabsListProps
  extends Omit<ComponentProps<typeof BaseTabs.List>, 'className'> {
  className?: string
}

/**
 * 契约约定（motion.md）：方向键移动即切换当前 tab，故默认 activateOnFocus=true
 * （Base UI 默认 false，手工激活模式）；调用方传 false 可切回。
 */
function TabsList({
  activateOnFocus = true,
  className,
  ...props
}: TabsListProps) {
  return (
    <BaseTabs.List
      {...props}
      activateOnFocus={activateOnFocus}
      className={cx('rk-tabs', className)}
    />
  )
}

export interface TabsTabProps
  extends Omit<ComponentProps<typeof BaseTabs.Tab>, 'className'> {
  className?: string
}

function TabsTab({ className, ...props }: TabsTabProps) {
  return (
    <BaseTabs.Tab {...props} data-ripple className={cx('rk-tab', className)} />
  )
}

export interface TabsIndicatorProps
  extends Omit<ComponentProps<typeof BaseTabs.Indicator>, 'className'> {
  className?: string
}

/**
 * 指示条画在固定的基准尺寸上（CSS 里横向 100px 宽 / 竖向 100px 高），用 scale 缩放到当前 tab 的尺寸，
 * 这样切换时只过渡 translate / scale（合成层），不动 width / height。Base UI 只给带 px 的长度变量，
 * CSS 里没法除出无单位的比例，所以这里按测得的尺寸算好写成 --rk-tabs-indicator-scale-x / -y。
 */
const TABS_INDICATOR_BASE_PX = 100

function indicatorScale(
  state: BaseTabs.Indicator.State,
): CSSProperties | undefined {
  const size = state.activeTabSize
  if (size === null) return undefined
  return {
    '--rk-tabs-indicator-scale-x': size.width / TABS_INDICATOR_BASE_PX,
    '--rk-tabs-indicator-scale-y': size.height / TABS_INDICATOR_BASE_PX,
  } as CSSProperties
}

function TabsIndicator({ className, style, ...props }: TabsIndicatorProps) {
  return (
    <BaseTabs.Indicator
      {...props}
      className={cx('rk-tabs__indicator', className)}
      style={(state) => ({
        ...indicatorScale(state),
        ...(typeof style === 'function' ? style(state) : style),
      })}
    />
  )
}

export interface TabsPanelProps
  extends Omit<ComponentProps<typeof BaseTabs.Panel>, 'className'> {
  className?: string
}

function TabsPanel({ className, ...props }: TabsPanelProps) {
  return (
    <BaseTabs.Panel {...props} className={cx('rk-tabpanel', className)} />
  )
}

export const Tabs = {
  Root: BaseTabs.Root,
  List: TabsList,
  Tab: TabsTab,
  Indicator: TabsIndicator,
  Panel: TabsPanel,
}
