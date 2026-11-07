/**
 * 长按 / 右键的浮起菜单（iOS 上下文菜单的 React 层），移植自 RakkoNotes 的 ContextMenu 与长按图片的 ImageMenu。
 * 叫 LiftMenu 是因为 ContextMenu 已是 Base UI ContextMenu 的包装（Root / Trigger 组合式，#25）；这里是受控的 anchor 式 API。
 *
 * 手势用 design-system 的 context-action 运行时（长按 500ms、移动超 10px 取消、右键、去重、触觉反馈、
 * iOS 抬手 click 抑制都在里面）：useContextAction(rootRef, onOpen) 在容器上装一次委托，
 * 可长按的表面带 data-context-action（SwipeRow 经 ...rest 透传到滑动层）。
 *
 * 呈现：两种视口都在按点 / 浮起的源旁开菜单（docs/2026-10-18-list-motion.md 修订了「紧凑视口升 Sheet」）。
 *   - anchor 不为 null 就是打开。anchor.source 是浮起源：传了就压暗背景、源的克隆从原位弹簧浮起，
 *     菜单贴着浮起的克隆（下方放不下翻到上方）；关闭时克隆飞回、落地后放回原物（lift-layer.tsx，
 *     docs/2026-10-24-lift-menu.md）。鼠标右键（anchor.pointer）源照样浮起，菜单留在鼠标处。
 *     不传 source 就是按点处的纯锚点菜单。
 *   - 定位用 Positioner 的虚拟锚点（浮起位置的矩形，或按点处零尺寸的矩形），碰撞时 Base UI 自动翻转、收边。
 *   - 关闭动画期间保留最后的 anchor 与 children：调用方此时往往已经把数据清空。
 *   - 打开时收起展开着的 SwipeRow。
 *
 * 菜单项的动作默认推迟到菜单收起后执行（iOS 先收菜单、再弹对话框的节奏）：「收起」= exit 淡出走完或整个关闭动画结束，
 * 先到先算（缩放弹簧的尾巴肉眼已看不见，动作不干等它）。afterLanding 的动作（会挪走 / 拿掉浮起源：删除、置顶换组）
 * 等克隆落回原位再执行，接上行的收拢 / 重排动画，不先闪回原样。immediate 的动作在点按里同步执行
 * （读写剪贴板、分享要在用户手势里发起）。
 *
 * 复合菜单（RakkoNotes 的长按图片 / 文件卡片）用的口子，默认都不开，行菜单的行为不变：
 *   - anchor.preview / hide / settledRect：自带预览内容、自己（计数地）藏起源、指定飞回的位置；
 *   - menuHeight：菜单高度（浮起位置据此留空间）不靠数菜单项估，用调用方给的值或量真实高度（'measure'）；
 *   - liftRef：handOff() 拿克隆此刻的矩形交给看图 / 预览器、克隆当场让位；remove() 标记源正被拿掉，克隆原地缩小；
 *   - keepFocus：开合不挪焦点（编辑器里键盘不收），菜单项在触摸抬起 / click 时执行（RakkoNotes EditorMenu）；
 *   - Submenu*：二级菜单，菜单项的推迟执行、样式与一级相同。
 *
 * 打开那一刻的手势还没结束（触摸长按时手指还按着）。抬手后 iOS Safari / 触屏模拟会把这次触摸补成
 * mousedown → mouseup → click：Menu 的「点外部关闭」在 mousedown 上就生效，刚弹出的菜单会被这次抬手关掉；
 * 抬手处恰好落在菜单项上时，补来的 click 还会激活它。所以打开后、下一次 pointerdown 之前：
 * 「点外部」的关闭请求不理，弹层里 detail > 0 的 click 不执行（键盘与读屏的 click detail 为 0，照常执行）；
 * 这条在弹层（含二级菜单）的捕获阶段拦，自定义的 Menu.Item / Menu.Group（如图片菜单顶部的大小一行）同样受保护。
 * 只管本组件的菜单，不在全窗口吞事件（context-action.md：只拦触发表面）。
 */
import {
  Children,
  Fragment,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import type {
  ComponentProps,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  Ref,
  RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { installContextAction } from '@rakko/design-system/context-action'
import type { ContextActionAnchor } from '@rakko/design-system/context-action'
import { cx } from '../cx'
import { MOTION } from '../motion'
import { rootTimeMs } from '../motion-dom'
import type { Box } from '../motion-dom'
import { Menu } from '../menu/menu'
import type { MenuItemProps, MenuPopupProps, MenuSubmenuPopupProps, MenuSubmenuTriggerProps } from '../menu/menu'
import { closeSwipeRows } from '../swipe-row/swipe-row'
import { LiftLayer, findLayer, measureLift, relift } from './lift-layer'
import type { Lift, LiftOptions, LiftVariant } from './lift-layer'

export type { LiftVariant } from './lift-layer'

/**
 * 长按 / 右键的落点（视口坐标），以及可选的浮起源。preview / hide / settledRect（LiftOptions）是复合菜单的定制，
 * 只在传了 source 时生效：自带预览内容、自己（计数地）藏起源、指定飞回的位置（如图片改了大小后落定的矩形）。
 */
export interface LiftMenuAnchor extends ContextActionAnchor, LiftOptions {
  /**
   * 浮起源（通常就是 useContextAction 收到的表面）：传了就压暗背景、把它的克隆浮起来，菜单贴着克隆；
   * 不传就是按点处的锚点菜单。SwipeRow 的内容层会连整行一起克隆（两侧按钮除外）。
   */
  source?: HTMLElement | null
  /** 鼠标右键打开（useContextAction 会填）：源照样浮起，菜单留在鼠标处。 */
  pointer?: boolean
}

/**
 * 在 rootRef 内安装长按 / 右键委托（installContextAction 的 React 包装），卸载时自动拆掉。
 * onOpen 收到命中的表面元素（带 data-context-action 的那个）与落点；业务数据挂在表面的 data-* 上。
 * 落点带 pointer：最近一次按下是鼠标（右键）时为 true。要浮起就把表面作为 source 传给 LiftMenu：
 * `setMenu({ ...anchor, source: surface })`。
 */
export function useContextAction(
  rootRef: RefObject<HTMLElement | null>,
  onOpen: (surface: HTMLElement, anchor: LiftMenuAnchor) => void,
): void {
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    // 运行时不告诉我们是长按还是右键：自己记下最近一次按下的指针类型
    let lastPointerType = ''
    const onPointerDown = (event: PointerEvent) => {
      lastPointerType = event.pointerType
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    const uninstall = installContextAction({
      root,
      onOpen: (surface, anchor) => onOpenRef.current(surface, { ...anchor, pointer: lastPointerType === 'mouse' }),
    })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      uninstall()
    }
  }, [rootRef])
}

/** 菜单高度的估算（浮起位置据此给菜单留空间）：每项（含分隔线）41px + 上下内边距 8px。 */
const ITEM_HEIGHT = 41
const MENU_PADDING = 8

/** 菜单项个数（Fragment 展开），估算菜单高度用。 */
function countItems(children: ReactNode): number {
  let count = 0
  Children.forEach(children, (child) => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) count += countItems(child.props.children)
    else if (child) count += 1
  })
  return count
}

/** 按矩形（浮起位置，或按点处零尺寸）给 Positioner 的虚拟锚点。 */
function boxAnchor({ left, top, width, height }: Box) {
  const right = left + width
  const bottom = top + height
  return {
    getBoundingClientRect: () =>
      ({ x: left, y: top, top, left, right, bottom, width, height, toJSON: () => ({ left, top }) }) as DOMRect,
  }
}

/**
 * 推迟执行：菜单开始收起（closing）后 exit 时长到点、或关闭动画结束（closed），先到先算。
 */
function useAfterMenuClose() {
  const pending = useRef<(() => void) | null>(null)
  const timer = useRef(0)
  return useMemo(() => {
    const flush = () => {
      window.clearTimeout(timer.current)
      const action = pending.current
      pending.current = null
      action?.()
    }
    return {
      defer: (action: () => void) => {
        pending.current = action
      },
      closing: () => {
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(flush, rootTimeMs('--motion-duration-exit', MOTION.durationExitMs))
      },
      closed: flush,
    }
  }, [])
}

interface ItemContext {
  /** 打开菜单的手势还没结束（打开后还没见到新的 pointerdown）。 */
  releasePending: RefObject<boolean>
  /** 推迟执行；afterLanding：等浮起的克隆落回原位。 */
  defer: (action: () => void, afterLanding: boolean) => void
  /** 不抢焦点模式：菜单项自己处理按下与执行，跳过 Base UI 的 click 处理。 */
  keepFocus: boolean
  /** 关菜单（keepFocus 的菜单项自己关，不经 Base UI）。 */
  close: () => void
  /** 二级菜单登记（LiftMenu.SubmenuRoot 挂上时）：有二级菜单时根上补一个隐形 Trigger，返回注销函数。 */
  registerSubmenu: () => () => void
}

const LiftMenuContext = createContext<ItemContext | null>(null)

/** 打开菜单那次触摸抬手补来的 click（落在弹层 / 菜单项上）：在捕获阶段拦下，不算选择。 */
function useReleaseGuard() {
  const context = useContext(LiftMenuContext)
  return (event: ReactMouseEvent<HTMLDivElement>) => {
    if (context?.releasePending.current && event.detail > 0) event.stopPropagation()
  }
}

/** liftRef 拿到的句柄：只在打开着（或正在关）的这一次浮起上生效，没有浮起时什么也不做。 */
export interface LiftMenuHandle {
  /**
   * 交接：看图 / 裁剪 / 预览器要从克隆此刻的位置接手。返回克隆此刻的视口矩形（没有浮起时 null），
   * 克隆当场透明；退场不再飞回——media 压暗晚 120ms 再淡，card 飞回照播但看不见。在菜单项的点按里调。
   */
  handOff(): DOMRect | null
  /** 源正被拿掉（删除，源还在文档里做收起动画）：退场不飞回，原地缩小淡出（row 原地淡出）。在菜单项的点按里调。 */
  remove(): void
}

export interface LiftMenuProps extends Omit<MenuPopupProps, 'anchor' | 'children'> {
  /** 落点（与可选的浮起源）；null = 关闭。 */
  anchor: LiftMenuAnchor | null
  /** 用户要求关闭（点外部、Esc、选了菜单项）。调用方把 anchor 设回 null。 */
  onClose: () => void
  /**
   * 浮起的参数组：row（列表行，菜单可翻到上方）或 media（图片这类整块媒体：菜单总在下方，太高的源缩小预览；
   * 菜单从 .85 而不是 .6 长出来，压暗的进退时长不同）。只在传了 anchor.source 时生效。@default 'row'
   */
  liftVariant?: LiftVariant
  /**
   * 菜单高度（px），浮起位置据此给菜单留空间。不传按菜单项个数估（每项含分隔线 41px + 8px）；
   * 菜单里有自定义的行（如图片菜单顶部 66px 的大小一行）时传调用方自己的值，或 'measure'：
   * 弹层挂上后按真实高度重定浮起位置（第一帧画出来之前；来不及就沿用估算，菜单交给定位器翻转）。
   */
  menuHeight?: number | 'measure'
  /**
   * 不抢焦点（编辑器里用：开合都不挪焦点，iOS 不收键盘）：非 modal、悬停不高亮、弹层不取焦点也不还焦点，
   * 按下菜单项 / 压暗层不让编辑器失焦；菜单项在触摸抬起时（鼠标在 click 时）执行，执行时机照旧
   * （immediate / 默认推迟 / afterLanding）。键盘导航随之不可用（焦点不在菜单里）。
   * 用的是 Menu.Popup 的 initialFocus（Base UI ≥ 1.9，@rakko/react 已依赖 ^1.9.0）。@default false
   */
  keepFocus?: boolean
  /** 浮起的句柄：handOff()（交给看图 / 预览器）、remove()（源正被拿掉）。 */
  liftRef?: Ref<LiftMenuHandle>
  /** 菜单的无障碍名称（「备忘录操作」）。 */
  'aria-label': string
  children: ReactNode
}

/** 不挪焦点：Menu.Popup 的 initialFocus / finalFocus（Base UI ≥ 1.9）。 */
const NO_FOCUS_MOVE = { initialFocus: false, finalFocus: false } as const

function LiftMenuRoot({
  anchor,
  onClose,
  liftVariant = 'row',
  menuHeight,
  keepFocus = false,
  liftRef,
  className,
  children,
  ref: popupRefProp,
  onClickCapture,
  ...props
}: LiftMenuProps) {
  const open = anchor !== null
  // 关闭动画期间锚点和菜单内容都还要保持原样（调用方此时往往已经把数据清空）
  const last = useRef<{ anchor: LiftMenuAnchor; children: ReactNode }>({ anchor: { x: 0, y: 0 }, children: null })
  if (anchor) last.current = { anchor, children }
  const shown = last.current.anchor

  // 每次打开（anchor 换了）量一次浮起位置；上一次的克隆还没落地（关闭途中又长按同一个源）就从克隆此刻的位置起飞
  const liftFor = useRef<{ anchor: LiftMenuAnchor | null; lift: Lift | null }>({ anchor: null, lift: null })
  if (anchor && liftFor.current.anchor !== anchor) {
    const prevLift = liftFor.current.lift
    const previous = prevLift && prevLift.source === anchor.source ? findLayer(prevLift) : null
    const source = anchor.source
    const height = typeof menuHeight === 'number' ? menuHeight : MENU_PADDING + countItems(children) * ITEM_HEIGHT
    liftFor.current = {
      anchor,
      lift: source?.isConnected
        ? measureLift(source, liftVariant, height, previous, {
            preview: anchor.preview,
            hide: anchor.hide,
            settledRect: anchor.settledRect,
          })
        : null,
    }
  }
  const lift = liftFor.current.lift
  const liftId = lift?.id

  // menuHeight 'measure'：弹层挂上（或打开着又换了一次浮起）时量真实高度，第一帧画出来之前重定浮起位置
  const popupRef = useRef<HTMLDivElement | null>(null)
  const paintedId = useRef(0)
  const measureRef = useRef(menuHeight === 'measure')
  measureRef.current = menuHeight === 'measure'
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const remeasure = useCallback(() => {
    const current = liftFor.current.lift
    const popup = popupRef.current
    if (!measureRef.current || !current || !popup || paintedId.current === current.id) return
    const real = popup.offsetHeight
    if (!real || Math.abs(real - current.menuHeight) < 0.5) return
    liftFor.current.lift = relift(current, real)
    rerender()
  }, [])
  const popupRefPropRef = useRef(popupRefProp)
  popupRefPropRef.current = popupRefProp
  const setPopupRef = useCallback(
    (node: HTMLDivElement | null) => {
      popupRef.current = node
      const outer = popupRefPropRef.current
      if (typeof outer === 'function') outer(node)
      else if (outer) outer.current = node
      if (node) remeasure()
    },
    [remeasure],
  )
  useLayoutEffect(() => {
    if (liftId !== undefined) remeasure()
  }, [liftId, remeasure])
  const onPainted = useCallback((id: number) => {
    paintedId.current = Math.max(paintedId.current, id)
  }, [])

  useImperativeHandle(
    liftRef,
    () => ({
      handOff: () => {
        const current = liftFor.current.lift
        const layer = current ? findLayer(current) : null
        if (!current || !layer) return null
        current.flags.handedOff = true
        const preview = layer.preview as HTMLElement
        const rect = preview.getBoundingClientRect()
        preview.style.opacity = '0'
        return rect
      },
      remove: () => {
        const current = liftFor.current.lift
        if (current) current.flags.removing = true
      },
    }),
    [],
  )

  // afterLanding 的动作等克隆落地（进了 LANDING_THRESHOLD_PX）再执行；弹簧尾巴播完才卸掉浮起层
  const [landed, setLanded] = useState<Lift | null>(null)
  const touchedDown = useRef<Lift | null>(null)
  const settled = useRef(true)
  const late = useRef<(() => void) | null>(null)
  settled.current = !lift || landed === lift || touchedDown.current === lift

  // 换了一次新的浮起（上一次没落地就又打开）：上一次挂着的动作立即执行，不丢
  useLayoutEffect(() => {
    const action = late.current
    late.current = null
    action?.()
  }, [liftId])

  const runAfterLanding = useCallback((action: () => void) => {
    if (settled.current) action()
    else late.current = action
  }, [])

  const onTouchdown = useCallback((which: Lift) => {
    touchedDown.current = which
    settled.current = true
    const action = late.current
    late.current = null
    action?.()
  }, [])

  const onLanded = useCallback((which: Lift) => {
    setLanded(which)
  }, [])

  const after = useAfterMenuClose()
  const releasePending = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  // 二级菜单要根菜单在 Base UI 的浮层树里有节点 id，而这个 id 由 Trigger 登记：没有 Trigger 时展开二级会被当成
  // 「兄弟菜单打开」把根菜单关掉、焦点也进不了二级。所以菜单里有二级时补一个隐形 Trigger（不可见、不接事件、不可聚焦）
  const [submenus, setSubmenus] = useState(0)
  const registerSubmenu = useCallback(() => {
    setSubmenus((n) => n + 1)
    return () => setSubmenus((n) => n - 1)
  }, [])
  // 有 Trigger 时 Base UI 关闭后把焦点还给它；没有时还给打开前的焦点。补了 Trigger 也照没有时的办：记下打开前的焦点
  const focusBefore = useRef<HTMLElement | null>(null)
  const context = useMemo<ItemContext>(
    () => ({
      releasePending,
      defer: (action, afterLanding) => after.defer(afterLanding ? () => runAfterLanding(action) : action),
      keepFocus,
      close: () => {
        after.closing()
        onCloseRef.current()
      },
      registerSubmenu,
    }),
    [after, runAfterLanding, keepFocus, registerSubmenu],
  )
  const guardRelease = (event: ReactMouseEvent<HTMLDivElement>) => {
    onClickCapture?.(event as Parameters<NonNullable<typeof onClickCapture>>[0])
    if (releasePending.current && event.detail > 0) event.stopPropagation()
  }

  // 每次打开（含打开状态下换了落点）：收起 SwipeRow，并等打开它的那次手势结束
  useLayoutEffect(() => {
    if (!anchor) return
    closeSwipeRows()
    // Base UI 在之后的微任务里才把焦点移进弹层：此刻还是打开前的焦点（打开状态下换落点时已经在弹层里，不更新）
    const active = document.activeElement
    if (!(active instanceof Node && popupRef.current?.contains(active))) {
      focusBefore.current = active instanceof HTMLElement && active !== document.body ? active : null
    }
    releasePending.current = true
    const onPointerDown = () => {
      releasePending.current = false
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [anchor])

  // 右键：菜单在鼠标处；长按：贴着浮起的源；没有源：按点
  const box: Box = lift && !shown.pointer ? lift.rest : { left: shown.x, top: shown.y, width: 0, height: 0 }
  const { left, top, width, height } = box
  const virtual = useMemo(() => boxAnchor({ left, top, width, height }), [left, top, width, height])
  const variant = lift?.variant

  return (
    <LiftMenuContext.Provider value={context}>
      <Menu.Root
        open={open}
        {...(keepFocus ? { modal: false, highlightItemOnHover: false } : null)}
        onOpenChange={(next, details) => {
          if (next) return
          if (details.reason === 'outside-press' && releasePending.current) {
            details.cancel()
            return
          }
          after.closing()
          onClose()
        }}
        onOpenChangeComplete={(next) => {
          if (!next) after.closed()
        }}
      >
        {submenus > 0
          ? createPortal(
              // Base UI 会把弹层的 aria-labelledby 指向它：带上菜单的无障碍名称，弹层的名字不变
              <Menu.Trigger
                className="rk-lift-menu__trigger"
                tabIndex={-1}
                aria-hidden="true"
                aria-label={props['aria-label']}
              />,
              document.body,
            )
          : null}
        {lift && landed !== lift ? (
          <LiftLayer
            key={lift.id}
            lift={lift}
            open={open}
            onLanded={onLanded}
            onTouchdown={onTouchdown}
            onPainted={onPainted}
            keepFocus={keepFocus}
          />
        ) : null}
        <Menu.Popup
          {...(submenus > 0 ? { finalFocus: () => (focusBefore.current?.isConnected ? focusBefore.current : false) } : null)}
          {...(keepFocus ? NO_FOCUS_MOVE : null)}
          {...props}
          ref={setPopupRef}
          anchor={virtual}
          className={cx('rk-lift-menu', className)}
          data-lift-variant={variant}
          onClickCapture={guardRelease}
        >
          {anchor ? children : last.current.children}
        </Menu.Popup>
      </Menu.Root>
    </LiftMenuContext.Provider>
  )
}

export interface LiftMenuItemProps extends MenuItemProps {
  /** 行尾图标（iOS 上下文菜单的排布：文字在左、图标在右）。 */
  icon?: ReactNode
  /** 勾选状态（文字样式、排序方式这类）：true 时在文字前画勾；传了就是 menuitemcheckbox。 */
  checked?: boolean
  /**
   * 在点按里同步执行，不等菜单收起：读写剪贴板、分享要在用户手势里发起（Safari 要求）。
   * 也可以在 onClick 里调 event.preventBaseUIHandler() 让菜单不关。@default false
   */
  immediate?: boolean
  /**
   * 动作会挪走 / 拿掉浮起源（删除、恢复、置顶换组）：等克隆落回原位再执行，接上行的收拢 / 重排动画。
   * 没有浮起时与默认相同。@default false
   */
  afterLanding?: boolean
  // 危险项沿用 Menu.Item 的 variant="danger"（rk-menu__item--danger：错误色文字与高亮层），不另设一套
}

const CHECK_ICON = (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** keepFocus 的触摸点按：抬手后这么久（ms）内的 click 是补发的，不再执行（RakkoNotes table/tap.ts）。 */
const TAP_CLICK_IGNORE_MS = 600

type ItemClickEvent = Parameters<NonNullable<MenuItemProps['onClick']>>[0]

/**
 * keepFocus 的菜单项按下：preventDefault 不抢焦点。按下被 preventDefault 后部分 WebKit 不再给触摸合成 click，
 * 所以触摸（touch / pen）在 pointerup 执行（抬起点还在这一项上才算），之后约 600ms 的 click 忽略；鼠标仍走 click。
 */
function useKeepFocusTap(run: (event: ItemClickEvent) => void) {
  const pressed = useRef<number | null>(null)
  const ignoreClickUntil = useRef(0)
  return {
    handlers: {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        event.preventDefault()
        pressed.current = event.pointerType === 'mouse' ? null : event.pointerId
      },
      onMouseDown: (event: ReactMouseEvent<HTMLElement>) => event.preventDefault(),
      onPointerCancel: () => {
        pressed.current = null
      },
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
        if (event.pointerType === 'mouse' || pressed.current !== event.pointerId) return
        pressed.current = null
        // 触摸有隐式捕获，target 恒为按下的元素：按抬起点实际所在的元素判断是否移出
        const hit = document.elementFromPoint(event.clientX, event.clientY)
        if (!hit || !event.currentTarget.contains(hit)) return
        ignoreClickUntil.current = Date.now() + TAP_CLICK_IGNORE_MS
        // onClick 收到的是这次 pointerup（PointerEvent 也是 MouseEvent）；它不经 Base UI，preventBaseUIHandler 是空操作
        run(Object.assign(event, { preventBaseUIHandler: () => {}, baseUIHandlerPrevented: false }) as unknown as ItemClickEvent)
      },
    },
    /** false：这次 click 是触摸点按的补发，忽略。 */
    shouldHandleClick: () => Date.now() >= ignoreClickUntil.current,
  }
}

function LiftMenuItem({
  icon,
  checked,
  immediate = false,
  afterLanding = false,
  className,
  children,
  onClick,
  onPointerDown,
  onMouseDown,
  onPointerUp,
  onPointerCancel,
  ...props
}: LiftMenuItemProps) {
  const context = useContext(LiftMenuContext)
  const checkable = checked !== undefined
  const keepFocus = context?.keepFocus ?? false

  /** 执行：immediate 在这里同步，其余推迟到菜单收起 / 克隆落地。 */
  const select = (event: ItemClickEvent) => {
    if (!onClick) return
    if (immediate || !context) onClick(event)
    else context.defer(() => onClick(event), afterLanding)
  }
  // keepFocus：自己关菜单再执行（同 RakkoNotes EditorMenuItem 的顺序），不经 Base UI（它会把焦点移到菜单项上）
  const tap = useKeepFocusTap((event) => {
    if (props.disabled) return
    if (!immediate) select(event)
    context?.close()
    if (immediate) select(event)
  })
  const chain =
    <E,>(own: ((event: E) => void) | undefined, user: ((event: E) => void) | undefined) =>
    (event: E) => {
      user?.(event)
      own?.(event)
    }

  return (
    <Menu.Item
      {...(checkable ? { role: 'menuitemcheckbox', 'aria-checked': checked } : null)}
      {...props}
      layout="custom"
      className={cx('rk-lift-menu__item', className)}
      data-checked={checked ? '' : undefined}
      onPointerDown={chain(keepFocus ? tap.handlers.onPointerDown : undefined, onPointerDown)}
      onMouseDown={chain(keepFocus ? tap.handlers.onMouseDown : undefined, onMouseDown)}
      onPointerUp={chain(keepFocus ? tap.handlers.onPointerUp : undefined, onPointerUp)}
      onPointerCancel={chain(keepFocus ? tap.handlers.onPointerCancel : undefined, onPointerCancel)}
      onClick={(event) => {
        if (keepFocus) {
          event.preventBaseUIHandler()
          if (!tap.shouldHandleClick()) return
          if (!immediate) select(event)
          context?.close()
          if (immediate) select(event)
          return
        }
        select(event)
      }}
    >
      {checked ? <span className="rk-lift-menu__check">{CHECK_ICON}</span> : null}
      <span className="rk-lift-menu__label">{children}</span>
      {icon != null ? (
        <span className="rk-lift-menu__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
    </Menu.Item>
  )
}

export type LiftMenuSubmenuRootProps = ComponentProps<typeof Menu.SubmenuRoot>

/** 二级菜单的根（Base UI 的 Menu.SubmenuRoot）：挂上时向 LiftMenu 登记，见 LiftMenuRoot 里的隐形 Trigger。 */
function LiftMenuSubmenuRoot(props: LiftMenuSubmenuRootProps) {
  const register = useContext(LiftMenuContext)?.registerSubmenu
  useLayoutEffect(() => register?.(), [register])
  return <Menu.SubmenuRoot {...props} />
}

export interface LiftMenuSubmenuTriggerProps extends MenuSubmenuTriggerProps {}

/**
 * 二级菜单的入口：排布与 LiftMenu.Item 相同（文字在左、行尾 ›），悬停 / → / Enter 展开，← 收回（Base UI）。
 */
function LiftMenuSubmenuTrigger({ className, ...props }: LiftMenuSubmenuTriggerProps) {
  return <Menu.SubmenuTrigger {...props} className={cx('rk-lift-menu__item', 'rk-lift-menu__submenu-trigger', className)} />
}

export interface LiftMenuSubmenuPopupProps extends MenuSubmenuPopupProps {}

/**
 * 二级菜单面板：外观同一级（圆角、最小宽度、焦点框），从入口那一侧淡入 / 缩放长出（rk-menu--submenu，不吃一级的 .6 弹出）。
 * 里面放 LiftMenu.Item：推迟执行、立即执行、afterLanding 都与一级相同（选中时整棵菜单收起）。
 */
function LiftMenuSubmenuPopup({ className, onClickCapture, ...props }: LiftMenuSubmenuPopupProps) {
  const guard = useReleaseGuard()
  return (
    <Menu.SubmenuPopup
      {...props}
      className={cx('rk-lift-menu__submenu', className)}
      onClickCapture={(event) => {
        onClickCapture?.(event)
        guard(event)
      }}
    />
  )
}

export const LiftMenu = Object.assign(LiftMenuRoot, {
  Item: LiftMenuItem,
  Separator: Menu.Separator,
  Group: Menu.Group,
  GroupLabel: Menu.GroupLabel,
  SubmenuRoot: LiftMenuSubmenuRoot,
  SubmenuTrigger: LiftMenuSubmenuTrigger,
  SubmenuPopup: LiftMenuSubmenuPopup,
})
