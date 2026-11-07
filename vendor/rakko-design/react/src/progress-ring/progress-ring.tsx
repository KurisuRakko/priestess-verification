import { Progress as BaseProgress } from '@base-ui/react/progress'
import type { CSSProperties, ComponentProps, ReactNode } from 'react'
import { cx } from '../cx'
import { progressFraction } from '../progress/progress'

export interface ProgressRingProps
  extends Omit<ComponentProps<typeof BaseProgress.Root>, 'className' | 'children'> {
  className?: string
  /** 外径（px），默认 48。 */
  size?: number
  /** 圆环粗细（px），默认 4，与线性 Progress 的轨道同粗。 */
  thickness?: number
  /** 圆心内容（百分比、页数等），不参与无障碍名称；调用方需另给 aria-label / aria-labelledby。 */
  children?: ReactNode
}

/**
 * rk-progress-ring：圆环进度，与 Progress 同一语义（Base UI Progress.Root：role="progressbar"、
 * aria-valuemin/max/now、data-indeterminate）。只表达可检测的真实进度；value=null 为不确定型。
 * 填充比例与线性 Progress 同算法（progressFraction），写进 --rk-progress-ring-fraction，
 * 由 stroke-dashoffset 画出：SVG 圆用 pathLength=1，弧长直接等于比例，与外径无关。
 */
export function ProgressRing({
  className,
  size = 48,
  thickness = 4,
  style,
  children,
  ...props
}: ProgressRingProps) {
  const fraction = progressFraction(props.value, props.min, props.max)
  const radius = (size - thickness) / 2
  const ringStyle = {
    '--rk-progress-ring-size': `${size}px`,
    ...(fraction == null ? null : { '--rk-progress-ring-fraction': fraction }),
  } as CSSProperties
  return (
    <BaseProgress.Root
      {...props}
      style={
        typeof style === 'function'
          ? (state) => ({ ...ringStyle, ...style(state) })
          : { ...ringStyle, ...style }
      }
      className={cx('rk-progress-ring', className)}
    >
      <svg
        className="rk-progress-ring__svg"
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        aria-hidden="true"
        focusable="false"
      >
        <circle
          className="rk-progress-ring__track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={thickness}
        />
        <circle
          className="rk-progress-ring__indicator"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={thickness}
          pathLength={1}
        />
      </svg>
      {children != null && <span className="rk-progress-ring__label">{children}</span>}
    </BaseProgress.Root>
  )
}
