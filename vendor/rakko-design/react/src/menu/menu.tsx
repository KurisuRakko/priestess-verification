import { Menu as BaseMenu } from '@base-ui/react/menu'
import type { ComponentProps, ReactNode } from 'react'
import { cx } from '../cx.js'

export interface MenuPopupProps
  extends Omit<ComponentProps<typeof BaseMenu.Popup>, 'className'> {
  className?: string
  /**
   * 定位锚点，转给 Positioner；不传就锚在 Trigger 上。
   * 可以是虚拟元素（只需 getBoundingClientRect），LiftMenu 用它锚在长按 / 右键的落点。
   */
  anchor?: ComponentProps<typeof BaseMenu.Positioner>['anchor']
  /** 面板位于锚点的哪一侧，转给 Positioner。不传沿用 Base UI 默认（顶层菜单为 bottom）。 */
  side?: ComponentProps<typeof BaseMenu.Positioner>['side']
  /** 面板沿该侧的对齐方式，转给 Positioner。不传沿用 Base UI 默认（顶层菜单为 center）。 */
  align?: ComponentProps<typeof BaseMenu.Positioner>['align']
  /**
   * 面板与锚点的间距，转给 Positioner。
   * @default 6
   */
  sideOffset?: ComponentProps<typeof BaseMenu.Positioner>['sideOffset']
  /** 沿对齐轴的偏移，转给 Positioner。不传沿用 Base UI 默认（0）。 */
  alignOffset?: ComponentProps<typeof BaseMenu.Positioner>['alignOffset']
  /** 放不下时如何避让，转给 Positioner。不传沿用 Base UI 默认。 */
  collisionAvoidance?: ComponentProps<typeof BaseMenu.Positioner>['collisionAvoidance']
}

/**
 * 组合 Portal > Positioner(sideOffset 6) > Popup：视觉类 rk-menu 落在 Popup 上。
 * anchor 与 side / align / sideOffset / alignOffset / collisionAvoidance 转给 Positioner。
 */
function MenuPopup({
  className,
  anchor,
  side,
  align,
  sideOffset = 6,
  alignOffset,
  collisionAvoidance,
  children,
  ...props
}: MenuPopupProps) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionAvoidance={collisionAvoidance}
        anchor={anchor}
        className="rk-menu__positioner"
      >
        <BaseMenu.Popup
          {...props}
          className={cx('rk-menu', className)}
          data-glass="panel"
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  )
}

export interface MenuItemProps
  extends Omit<ComponentProps<typeof BaseMenu.Item>, 'className'> {
  className?: string
  /**
   * 前置图标：固定宽度的左侧列。同一个菜单里只要有一项带 icon，其他三列项的图标列
   * 也统一预留，没带 icon 的项文字不会往回缩（列宽由 CSS :has() 控制）。
   */
  icon?: ReactNode
  /**
   * 行尾附件：右侧的值、对勾或自绘 chevron。为空的项不占尾部列。
   */
  trailing?: ReactNode
  /**
   * 内容布局：不传时保持 #34 之前的写法——children 原样直出；传了 icon 或 trailing
   * 才切到图标 / 标签 / 附件三列。显式 'standard' 强制三列；'custom' 仍把 children
   * 原样交给 Base UI，供 LiftMenu.Item 这类自带排布的复合菜单项使用，此时 icon / trailing 不生效。
   * @default undefined
   */
  layout?: 'standard' | 'custom'
  /**
   * 视觉变体：danger 用于删除这类破坏性动作（error 色文字 + error 色高亮层），
   * 禁用时仍沿用 data-disabled 的降透明度。
   * @default 'default'
   */
  variant?: 'default' | 'danger'
}

/** Item / SubmenuTrigger 共用的三列内容：图标列、标签列、行尾附件列。 */
function MenuRow({
  icon,
  trailing,
  children,
}: {
  icon?: ReactNode
  trailing?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <span className="rk-menu__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="rk-menu__label">{children}</span>
      <span className="rk-menu__trailing">{trailing}</span>
    </>
  )
}

/**
 * 内容路径：custom 与老写法都让 children 原样直出；只有显式 standard 或传了 icon /
 * trailing 时才进三列 grid。两个入口共用这一处判断，避免结构分叉。
 */
function menuContentMode(
  layout: MenuItemProps['layout'],
  icon: ReactNode,
  trailing: ReactNode,
): 'legacy' | 'row' | 'custom' {
  if (layout === 'custom') return 'custom'
  if (layout === 'standard' || icon != null || trailing != null) return 'row'
  return 'legacy'
}

function MenuItem({
  className,
  variant = 'default',
  layout,
  icon,
  trailing,
  children,
  ...props
}: MenuItemProps) {
  const mode = menuContentMode(layout, icon, trailing)
  return (
    <BaseMenu.Item
      {...props}
      data-ripple
      className={cx(
        'rk-menu__item',
        mode === 'row' && 'rk-menu__item--row',
        variant === 'danger' && 'rk-menu__item--danger',
        className,
      )}
    >
      {mode === 'row' ? (
        <MenuRow icon={icon} trailing={trailing}>
          {children}
        </MenuRow>
      ) : (
        children
      )}
    </BaseMenu.Item>
  )
}

export interface MenuSeparatorProps
  extends Omit<ComponentProps<typeof BaseMenu.Separator>, 'className'> {
  className?: string
}

function MenuSeparator({ className, ...props }: MenuSeparatorProps) {
  return (
    <BaseMenu.Separator
      {...props}
      className={cx('rk-menu__separator', className)}
    />
  )
}

export interface MenuGroupProps
  extends Omit<ComponentProps<typeof BaseMenu.Group>, 'className'> {
  className?: string
}

function MenuGroup({ className, ...props }: MenuGroupProps) {
  return <BaseMenu.Group {...props} className={className} />
}

export interface MenuGroupLabelProps
  extends Omit<ComponentProps<typeof BaseMenu.GroupLabel>, 'className'> {
  className?: string
}

function MenuGroupLabel({ className, ...props }: MenuGroupLabelProps) {
  return (
    <BaseMenu.GroupLabel
      {...props}
      className={cx('rk-menu__group-label', className)}
    />
  )
}

export interface MenuSubmenuTriggerProps
  extends Omit<ComponentProps<typeof BaseMenu.SubmenuTrigger>, 'className'> {
  className?: string
  /** 前置图标，行为同 MenuItem.icon。 */
  icon?: ReactNode
  /**
   * 行尾附件。提供时不再自动追加 ›（例如用在行的值或对勾上）；不提供时保留默认 ›。
   */
  trailing?: ReactNode
}

/**
 * 子菜单的入口项：外观与 Item 相同（rk-menu__item），默认行尾带 ›；
 * 子菜单打开期间 Base UI 给它挂 data-popup-open，高亮层保持不灭。
 * 悬停打开（openOnHover 默认 true）、ArrowRight / Enter 打开、ArrowLeft 收回都由 Base UI 负责。
 * 传了 icon / trailing 才切三列 grid；都没传时沿用 #34 之前的 label + › flex 行。
 * 传了 trailing 就以调用方的附件为准，不再强制加 ›。
 */
function MenuSubmenuTrigger({
  className,
  children,
  icon,
  trailing,
  ...props
}: MenuSubmenuTriggerProps) {
  const mode = menuContentMode(undefined, icon, trailing)
  return (
    <BaseMenu.SubmenuTrigger
      {...props}
      data-ripple
      className={cx(
        'rk-menu__item',
        'rk-menu__submenu-trigger',
        mode === 'row' && 'rk-menu__item--row',
        className,
      )}
    >
      {mode === 'row' ? (
        <MenuRow icon={icon} trailing={trailing ?? <ChevronGlyph />}>
          {children}
        </MenuRow>
      ) : (
        <>
          <span className="rk-menu__submenu-label">{children}</span>
          <ChevronGlyph />
        </>
      )}
    </BaseMenu.SubmenuTrigger>
  )
}

/** 行尾 ›（chevron.right）；RTL 下由 CSS 镜像。 */
function ChevronGlyph() {
  return (
    <svg
      className="rk-menu__submenu-chevron"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

export interface MenuSubmenuPopupProps
  extends Omit<ComponentProps<typeof BaseMenu.Popup>, 'className'> {
  className?: string
  /**
   * 纸色实心底。不传时按内容自动：含新三列行（rk-menu__item--row）的子菜单用实心底，
   * 避免窄屏盖住父菜单时透出下层文字；老写法子菜单保持 data-glass="panel" 的玻璃底。
   * true / false 可显式覆盖自动判断。
   * @default undefined
   */
  solid?: boolean
}

/**
 * 子菜单面板：Portal > Positioner > Popup，视觉同 rk-menu，另加 rk-menu--submenu（只淡入、不位移）。
 * Positioner 用 Base UI 嵌套菜单的默认：side inline-end、align start，放不下时翻到另一侧；
 * alignOffset -4 抵掉面板 4px 内边距，让子菜单首项与 trigger 同一水平线。
 */
function MenuSubmenuPopup({
  className,
  solid,
  children,
  ...props
}: MenuSubmenuPopupProps) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        sideOffset={2}
        alignOffset={-4}
        className="rk-menu__positioner"
      >
        <BaseMenu.Popup
          {...props}
          className={cx('rk-menu', 'rk-menu--submenu', className)}
          data-glass="panel"
          data-solid={solid === undefined ? undefined : solid ? 'true' : 'false'}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  )
}

export const Menu = {
  Root: BaseMenu.Root,
  Trigger: BaseMenu.Trigger,
  Popup: MenuPopup,
  Item: MenuItem,
  Separator: MenuSeparator,
  Group: MenuGroup,
  GroupLabel: MenuGroupLabel,
  SubmenuRoot: BaseMenu.SubmenuRoot,
  SubmenuTrigger: MenuSubmenuTrigger,
  SubmenuPopup: MenuSubmenuPopup,
}
