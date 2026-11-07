/**
 * 列表的空状态 / 出错提示（移植自 RakkoNotes lists/EmptyState）：挂上时淡入；与列表互换时走 useSwapPresence——
 * 删掉最后一行后，列表剩下的内容淡出、空状态再淡入；有了第一条时空状态先淡出（略收）、列表再淡入。
 * 列表上方的说明文字（「最近删除」的保留期提示这类）也可以用它，出现 / 消失一样不硬切。
 */
import { useRef } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { cx } from '../cx'
import { useMergedRefs } from '../merge-refs'
import { useSwapPresence } from '../swap-text/swap-text'

export interface EmptyStateProps extends Omit<ComponentProps<'p'>, 'title'> {
  /**
   * default：列表空状态的版式（离顶 --rk-empty-state-offset / 28vh、16px、neutral-7、居中）；
   * none：只留挂上淡入与互换的淡出，版式全由 className 给（列表上方的小号说明文字这类）。@default 'default'
   */
  layout?: 'default' | 'none'
  /** 主文案上方的图标（40px、neutral-6，尺寸可用 --rk-empty-state-icon-size 改）；自动 aria-hidden，名称来自文字。 */
  icon?: ReactNode
  /** 主文案（「无备忘录」「无结果」）：title-20、font-medium、neutral-9。与 HTML title 属性同名，这里是可见文字。 */
  title?: ReactNode
  /** 次要说明（这里会出现什么 / 下一步怎么做）：copy-14、neutral-7。 */
  description?: ReactNode
}

/**
 * 不传 icon / title / description 时与以前完全一样：children 直接放进 <p>。
 * 传了任一项时挂 rk-empty-state--slotted，按「图标 → 主文案 → 说明 → children」竖排居中；
 * 外壳仍是 <p>，槽位都是 span（只放行内内容），children 跟在说明后面。
 */
export function EmptyState({ layout = 'default', icon, title, description, className, children, ref, ...rest }: EmptyStateProps) {
  const own = useRef<HTMLParagraphElement>(null)
  useSwapPresence(own)
  const slotted = icon != null || title != null || description != null
  return (
    <p
      ref={useMergedRefs(own, ref)}
      className={cx(
        'rk-empty-state',
        layout === 'default' && 'rk-empty-state--layout',
        slotted && 'rk-empty-state--slotted',
        className,
      )}
      {...rest}
    >
      {slotted ? (
        <>
          {icon != null ? (
            <span className="rk-empty-state__icon" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          {title != null ? <span className="rk-empty-state__title">{title}</span> : null}
          {description != null ? <span className="rk-empty-state__description">{description}</span> : null}
          {children}
        </>
      ) : (
        children
      )}
    </p>
  )
}
