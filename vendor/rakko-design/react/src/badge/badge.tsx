import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../cx'

export type BadgeTone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger'
export type BadgeSize = 'sm' | 'md'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** 语义色，默认 neutral；danger 取 --color-error。 */
  tone?: BadgeTone
  /** sm 用于顶栏副标题行等紧凑处，默认 md。 */
  size?: BadgeSize
  /** 文字前的小图标，装饰性（aria-hidden）。 */
  icon?: ReactNode
  children?: ReactNode
}

/**
 * 标签：不可交互的小标记（「只读分享」「测试环境」）。
 * 纯 span，不进 Tab 顺序；淡底 + 语义色字，字色向 neutral-10 混合以在浅深两主题都满足对比度。
 */
export function Badge({ tone = 'neutral', size = 'md', icon, className, children, ...props }: BadgeProps) {
  return (
    <span
      {...props}
      data-tone={tone}
      data-size={size}
      className={cx('rk-badge', className)}
    >
      {icon != null && (
        <span className="rk-badge__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </span>
  )
}
