import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from 'react'
import { cx } from '../cx.js'

interface CollapsibleContextValue {
  open: boolean
  disabled: boolean
  triggerId: string
  contentId: string
  toggle: () => void
}

const CollapsibleContext = createContext<CollapsibleContextValue | null>(null)

function useCollapsibleContext(part: string): CollapsibleContextValue {
  const context = useContext(CollapsibleContext)
  if (!context) {
    throw new Error(`${part} 必须放在 Collapsible.Root 里`)
  }
  return context
}

export interface CollapsibleRootProps {
  /** 受控展开状态。 */
  open?: boolean
  /** 非受控初始状态。@default false */
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  className?: string
  children?: ReactNode
}

/**
 * 可折叠区域：Trigger 是原生 button（aria-expanded / aria-controls），Content 始终挂载，
 * 高度由实测内容高度写 inline style。展开 / 收起与内容变高变矮都走 smooth 弹簧；
 * 首次挂载不播动画，减弱动态效果时降到 1ms。
 */
function CollapsibleRoot({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  className,
  children,
}: CollapsibleRootProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = controlledOpen ?? uncontrolledOpen
  const triggerId = useId()
  const contentId = `${triggerId}-content`

  const toggle = useCallback(() => {
    if (disabled) return
    const next = !open
    if (controlledOpen === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }, [controlledOpen, disabled, onOpenChange, open])

  return (
    <div
      className={cx('rk-collapsible', className)}
      data-open={open ? '' : undefined}
      data-disabled={disabled ? '' : undefined}
    >
      <CollapsibleContext.Provider
        value={{ open, disabled, triggerId, contentId, toggle }}
      >
        {children}
      </CollapsibleContext.Provider>
    </div>
  )
}

export interface CollapsibleTriggerProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'id'> {
  className?: string
  children?: ReactNode
}

function CollapsibleTrigger({
  className,
  children,
  onClick,
  ...props
}: CollapsibleTriggerProps) {
  const { open, disabled, triggerId, contentId, toggle } = useCollapsibleContext(
    'Collapsible.Trigger',
  )
  return (
    <button
      {...props}
      type="button"
      id={triggerId}
      aria-expanded={open}
      aria-controls={contentId}
      disabled={disabled}
      className={cx('rk-collapsible__trigger', className)}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) toggle()
      }}
    >
      {children}
    </button>
  )
}

export interface CollapsibleContentProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'children' | 'id'> {
  className?: string
  children?: ReactNode
}

function CollapsibleContent({
  className,
  children,
  style,
  ...props
}: CollapsibleContentProps) {
  const { open, triggerId, contentId } = useCollapsibleContext(
    'Collapsible.Content',
  )
  const innerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(open ? null : 0)
  const [ready, setReady] = useState(false)

  // 高度跟内容走：展开时量内层自然高度，收起时归零；内容在展开状态下变高变矮由 ResizeObserver 跟上。
  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    const sync = () => setHeight(open ? inner.offsetHeight : 0)
    sync()
    if (!open || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(sync)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [open])

  // 首次挂载直接到位（尤其 defaultOpen），从下一次高度变化起才交给弹簧。
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      {...props}
      id={contentId}
      role="region"
      aria-labelledby={triggerId}
      aria-hidden={open ? undefined : true}
      inert={!open}
      data-open={open ? '' : undefined}
      data-ready={ready ? '' : undefined}
      className={cx('rk-collapsible__content', className)}
      style={{ ...style, height: height === null ? undefined : height }}
    >
      <div ref={innerRef} className="rk-collapsible__content-inner">
        {children}
      </div>
    </div>
  )
}

export const Collapsible = {
  Root: CollapsibleRoot,
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
}
