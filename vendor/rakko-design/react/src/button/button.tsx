import { Button as UIButton } from '@base-ui/react/button'
import type { ButtonProps as UIButtonProps } from '@base-ui/react/button'
import type { ReactNode } from 'react'
import { cx } from '../cx.js'

/**
 * plain：iOS 导航栏 / 工具栏里的按钮——强调色文字、无底无框、命中区 44×44；
 * 按下变淡并轻轻缩小（不下沉）；同常规按钮带 ripple 墨点、hover 状态层与禁用透明度（RakkoNotes 的
 * ToolbarButton 建在 IconButton / ghost Button 上，本来就有）。其余五种是 Rakko 的常规按钮，
 * 其中 filled 是实心强调色底 + 纸色文字的确认动作，primary 保持原来的淡色描边外观；
 * filled-danger 是 filled 的危险版（实心 error 底 + 纸色文字），用于确认框里「删除」这类不可撤销的确认动作，
 * danger 仍是淡色描边。
 */
export type ButtonVariant = 'filled' | 'filled-danger' | 'primary' | 'secondary' | 'ghost' | 'danger' | 'plain'

export interface ButtonProps
  extends Omit<UIButtonProps, 'className' | 'variant'> {
  /** 视觉变体，默认 secondary（与 showcase .btn 默认一致）。 */
  variant?: ButtonVariant
  /** 加粗一档，用于「完成」这类确认动作（plain 400 → 500，其余 500 → 600）。 */
  emphasized?: boolean
  /** 文字前的图标（返回键的左 chevron 等）；图标自己 aria-hidden，名称来自文字。 */
  icon?: ReactNode
  className?: string
}

/**
 * Rakko 按钮：Base UI Button 行为 + data-ripple 状态层（含 plain）。
 * 有 icon 或 plain 时文字包一层 .rk-button__label，过长单行省略。
 * ref 作为普通 prop 透传（React 19）。
 */
export function Button({
  variant = 'secondary',
  emphasized,
  icon,
  className,
  children,
  ...props
}: ButtonProps) {
  const plain = variant === 'plain'
  const wrap = plain || icon != null
  return (
    <UIButton
      {...props}
      data-ripple
      data-emphasized={emphasized ? '' : undefined}
      data-has-icon={icon != null ? '' : undefined}
      className={cx('rk-button', `rk-button--${variant}`, className)}
    >
      {wrap ? (
        <>
          {icon}
          {children != null && children !== false ? <span className="rk-button__label">{children as ReactNode}</span> : null}
        </>
      ) : (
        children
      )}
    </UIButton>
  )
}

/** default：Rakko 的方形描边图标按钮；plain：iOS 栏里的强调色图标按钮（见 ButtonVariant）。 */
export type IconButtonVariant = 'default' | 'plain'

export interface IconButtonProps
  extends Omit<UIButtonProps, 'className' | 'aria-label' | 'pressed' | 'variant'> {
  /** 图标按钮必须携带可访问名称。 */
  'aria-label': string
  /** 视觉变体，默认 default。 */
  variant?: IconButtonVariant
  /** 切换型按钮状态，映射到 aria-pressed。 */
  pressed?: boolean
  className?: string
}

/**
 * Rakko 图标按钮：方形、中心 ripple；切换状态时用 aria-pressed 提供额外线索。
 * plain 变体 44×44、强调色，同样带中心 ripple。
 */
export function IconButton({
  'aria-label': ariaLabel,
  pressed,
  variant = 'default',
  className,
  ...props
}: IconButtonProps) {
  const plain = variant === 'plain'
  return (
    <UIButton
      {...props}
      aria-label={ariaLabel}
      data-ripple
      data-ripple-centered
      aria-pressed={pressed === undefined ? undefined : pressed ? 'true' : 'false'}
      className={cx('rk-icon-button', plain && 'rk-icon-button--plain', className)}
    />
  )
}
