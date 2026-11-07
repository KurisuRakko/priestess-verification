import { Progress as BaseProgress } from '@base-ui/react/progress'
import { createContext, useContext } from 'react'
import type { CSSProperties, ComponentProps } from 'react'
import { cx } from '../cx'

/**
 * 填充比例（0–1）；indeterminate 为 null。算法照 Base UI ProgressRoot：
 * 非有限值视为 indeterminate，(value - min) / (max - min) 夹到 0–1，NaN（min === max）按 0。
 */
export function progressFraction(
  value: number | null | undefined,
  min = 0,
  max = 100,
): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const raw = (value - min) / (max - min)
  return Number.isNaN(raw) ? 0 : Math.min(1, Math.max(0, raw))
}

const ProgressFractionContext = createContext<number | null>(null)

export interface ProgressRootProps
  extends Omit<ComponentProps<typeof BaseProgress.Root>, 'className'> {
  className?: string
}

/**
 * rk-progress：只用于可检测的真实进度，value 必须是 0–100 或 null（indeterminate）；
 * 不做装饰用途（motion.md / components.md）。
 */
function ProgressRoot({ className, ...props }: ProgressRootProps) {
  return (
    <ProgressFractionContext.Provider
      value={progressFraction(props.value, props.min, props.max)}
    >
      <BaseProgress.Root {...props} className={cx('rk-progress', className)} />
    </ProgressFractionContext.Provider>
  )
}

export interface ProgressLabelProps
  extends Omit<ComponentProps<typeof BaseProgress.Label>, 'className'> {
  className?: string
}

function ProgressLabel({ className, ...props }: ProgressLabelProps) {
  return (
    <BaseProgress.Label {...props} className={cx('rk-progress__label', className)} />
  )
}

export interface ProgressValueProps
  extends Omit<ComponentProps<typeof BaseProgress.Value>, 'className'> {
  className?: string
}

function ProgressValue({ className, ...props }: ProgressValueProps) {
  return (
    <BaseProgress.Value
      {...props}
      className={cx('rk-progress__value', className)}
    />
  )
}

export interface ProgressTrackProps
  extends Omit<ComponentProps<typeof BaseProgress.Track>, 'className'> {
  className?: string
}

function ProgressTrack({ className, ...props }: ProgressTrackProps) {
  return (
    <BaseProgress.Track {...props} className={cx('rk-progress__track', className)} />
  )
}

export interface ProgressIndicatorProps
  extends Omit<ComponentProps<typeof BaseProgress.Indicator>, 'className'> {
  className?: string
}

/**
 * Base UI 把填充比例内联写成 width（布局属性，每次更新都要重排）。这里改成撑满轨道、
 * 用 --rk-progress-scale 驱动 transform: scaleX（progress.css），过渡只走合成。
 * indeterminate 不写变量，保持 Base UI 原样；调用方的 style 叠在最后。
 */
function ProgressIndicator({ className, style, ...props }: ProgressIndicatorProps) {
  const fraction = useContext(ProgressFractionContext)
  const scaleStyle =
    fraction == null
      ? undefined
      : ({ width: '100%', '--rk-progress-scale': fraction } as CSSProperties)
  return (
    <BaseProgress.Indicator
      {...props}
      style={
        scaleStyle === undefined
          ? style
          : typeof style === 'function'
            ? (state) => ({ ...scaleStyle, ...style(state) })
            : { ...scaleStyle, ...style }
      }
      className={cx('rk-progress__indicator', className)}
    />
  )
}

export const Progress = {
  Root: ProgressRoot,
  Label: ProgressLabel,
  Value: ProgressValue,
  Track: ProgressTrack,
  Indicator: ProgressIndicator,
}
