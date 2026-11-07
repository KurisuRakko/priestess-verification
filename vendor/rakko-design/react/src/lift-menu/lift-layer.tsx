/**
 * LiftMenu 的浮起层：压暗的底 + 浮起源的克隆（portal 到 body）。移植自 RakkoNotes 的 ContextMenu（RowLift）
 * 与长按图片的 ImageMenu——Rakko 定的样板，参数逐值照搬：
 *
 *   打开：克隆从源此刻的位置（长按时缩到 .97 的样子，或上一次还没落地的克隆此刻的位置）FLIP 弹簧浮起
 *   （snappy，略放大到 1.03、阴影），压暗的底淡入；原物藏起（只是 visibility，位置照旧占着）。
 *   关闭：克隆从当前姿态（动画中途也一样，可打断）弹回原物的位置、阴影与底淡出；进了落地阈值（LANDING_THRESHOLD_PX）
 *   就放回原物、藏起克隆、通知落地，弹簧尾巴播完再卸掉浮起层。
 *   原物不在了 / 滚出视口：row 原地淡出，media 以中心缩到 .9 并淡出。
 *
 * 三套参数（variant）：
 *   - row（默认，列表行）：浮起位置下方放不下菜单而上方放得下时不动（定位器把菜单翻到上方），两边都放不下才把行往上挪；
 *     阴影与底走 enter / exit 时长 + 标准缓动。
 *   - media（图片这类整块媒体）：菜单总放在下方，太高的源缩小预览、保证「源 + 菜单」一起放得下；
 *     底 240ms ease-out 淡入、260ms 淡出，阴影跟着弹簧时长。
 *   - card（文件卡片这类正文里的块，RakkoNotes liftMotion.ts）：浮起同 media（预览最矮 48px）；飞回 300ms 缓动而不是弹簧，
 *     飞不回去时以左上角缩到 .9 并淡出（200ms），减弱动效时进场也淡入。
 *
 * 复合菜单（长按图片 / 文件卡片）还可以：自带预览内容（preview，代替 DOM 克隆）、自己藏起源（hide，可叠加计数）、
 * 指定飞回的位置（settledRect）；交接（handedOff：看图 / 裁剪 / 预览从克隆此刻的位置接手，克隆当场让位）、
 * 源正被拿掉（removing：原地缩小 / 淡出，不飞回一个正在消失的位置）。
 *
 * 为什么 portal 到 body：列表所在的栏可能有 transform / will-change（合成层），那会成为 fixed 的包含块。
 * 全屏层不用 touch-action: none（WebKit 卸载后残留、锁死页面滚动），滚动 / 捏合由 blockTouchScroll 用 JS 拦。
 */
import { useLayoutEffect, useRef } from 'react'
import type { CSSProperties, ReactNode, SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { MOTION } from '../motion'
import {
  boxTransform,
  boxVisible,
  currentTransform,
  reducedMotionQuery,
  rootTimeMs,
  rootToken,
  viewportSize,
} from '../motion-dom'
import type { Box } from '../motion-dom'
import { SPRINGS, springEasing } from '../spring'
import { blockTouchScroll } from '../touch-block'

export type LiftVariant = 'row' | 'media' | 'card'

/** 屏幕边距；菜单与浮起物的间距（与 Menu 定位器的 sideOffset 一致）。 */
const MARGIN = 12
const GAP = 6
const LIFT_SCALE = 1.03
/** media：预览最少留这么高（px），再矮就让菜单盖一点。 */
const MEDIA_MIN_HEIGHT = 80
/** media 退场：飞不回去时以中心缩到这个比例。 */
const MEDIA_SHRINK = 0.9
/** media 退场的缓动与时长（RakkoNotes ImageMenu）。 */
const MEDIA_EASE = 'cubic-bezier(0.2, 0, 0, 1)'
const MEDIA_SCRIM_ENTER = { duration: 240, easing: 'ease-out' }
const MEDIA_SCRIM_EXIT_MS = 260
const MEDIA_FADE_OUT_MS = 200
const MEDIA_REDUCED_PREVIEW_MS = 150
const MEDIA_REDUCED_SCRIM_MS = 200
/** media 交接给看图 / 裁剪器后，压暗晚这么久（ms）再淡：它们的底先盖上来，过渡中不露出没压暗的正文。 */
const MEDIA_HANDOFF_SCRIM_DELAY = 120
/** card（RakkoNotes liftMotion.ts）：预览最少留这么高（px）；飞回的时长与缓动；飞不回去时缩小淡出的时长。 */
const CARD_MIN_HEIGHT = 48
const CARD_RETURN = { duration: 300, easing: MEDIA_EASE }
const CARD_SHRINK_MS = 200
/**
 * 飞回的克隆四边与归处都差在这么多 px 以内（位移与缩放差都折成边的偏差）就算落地：弹簧剩下的尾巴肉眼看不见，
 * afterLanding 的动作不干等它播完（row 约 200ms 就进阈值，整条弹簧要约 470ms）。
 */
export const LANDING_THRESHOLD_PX = 0.5

/** 浮起期间藏起原物（只是 visibility，位置照旧占着）。 */
export const LIFT_SOURCE_ATTR = 'data-rk-lift-source'
const LAYER_CLASS = 'rk-lift-menu__layer'

/** 复合菜单对浮起的定制（都可选；不传就是默认的 DOM 克隆 + data-rk-lift-source 藏起 + 按 variant 找归处）。 */
export interface LiftOptions {
  /** 预览内容（如一张新的 <img>），代替源的 DOM 克隆；铺满预览框（源的布局尺寸）。 */
  preview?: ReactNode
  /** 自己藏起源（可叠加计数，交给看图器后它也藏着），返回放回的函数；传了就不加 data-rk-lift-source。 */
  hide?: () => () => void
  /** 关闭时克隆飞回的位置（视口坐标，如图片改了大小后落定的矩形）；null = 飞不回去。 */
  settledRect?: () => Box | null
}

export interface Lift extends LiftOptions {
  id: number
  /** 浮起源（长按的表面）：浮起期间藏起，量它的位置当起点 / 归处。 */
  source: HTMLElement
  /** 被克隆的元素：源是 SwipeRow 内容层时克隆整行根（行的样式选择器照样命中），其余就是源本身。 */
  target: HTMLElement
  /** 起飞时的视觉位置。 */
  from: Box
  /** 源的布局尺寸：克隆按这个尺寸排版（不改宽度，文字换行与原物一致），浮起靠 scale。 */
  size: { width: number; height: number }
  /** 浮起后的位置（视觉矩形）。 */
  rest: Box
  /** 压暗从多少开始（上一次的底还没淡完时接着它）。 */
  scrimFrom: number
  variant: LiftVariant
  /** 浮起位置按这个菜单高度留的空间。 */
  menuHeight: number
  /** 源处的 --rk-list-bg：克隆离开了列表容器，底色跟着带过去。 */
  listBg: string
  /**
   * media / card：源自己的圆角（px，读 computed border-radius；0 或读不到为 null，退回 CSS 的 --rk-lift-radius）。
   * 克隆按布局尺寸排版、靠 scale 放缩，所以圆角写成「源圆角 ÷ 此刻缩放」，看上去始终与源一致（radiusAt）。
   */
  radius: number | null
  /** 打开后才定下的退场方式（同一次浮起的各个副本共用）：handedOff 交接、removing 源正被拿掉。 */
  flags: { handedOff: boolean; removing: boolean }
}

let liftSeq = 0

function reduced(): boolean {
  return reducedMotionQuery()?.matches ?? false
}

/** snappy 弹簧（读 :root token，读不到用同参的 springEasing）。 */
function snappy(): { duration: number; easing: string } {
  const fallback = springEasing(SPRINGS.snappy)
  return {
    duration: rootTimeMs('--motion-spring-snappy-duration', fallback.durationMs),
    easing: rootToken('--motion-spring-snappy') || fallback.easing,
  }
}

/** enter / exit 时长 + 标准缓动（透明度用）。 */
function fade(kind: 'enter' | 'exit'): { duration: number; easing: string } {
  const fallback = kind === 'enter' ? MOTION.durationEnterMs : MOTION.durationExitMs
  return {
    duration: rootTimeMs(`--motion-duration-${kind}`, fallback),
    easing: rootToken('--motion-ease-standard') || MOTION.easeStandard,
  }
}

/** 上一次还没落地的浮起层（关闭途中又打开同一个源时从它此刻的位置起飞）。 */
export function findLayer(lift: Lift | null): { preview: Element; scrim: Element } | null {
  if (!lift) return null
  const layer = document.querySelector(`.${LAYER_CLASS}[data-lift-id="${lift.id}"]`)
  const preview = layer?.querySelector('.rk-lift-menu__preview')
  const scrim = layer?.querySelector('.rk-lift-menu__scrim')
  return preview && scrim ? { preview, scrim } : null
}

/**
 * 量一次浮起：起点、布局尺寸、浮起位置。menuHeight 是菜单高度的估算，浮起位置据此给菜单留空间。
 * previous：上一次的浮起层还没落地（关闭途中又长按同一个源），从克隆此刻的位置起飞、压暗接着它的透明度。
 */
export function measureLift(
  source: HTMLElement,
  variant: LiftVariant,
  menuHeight: number,
  previous: { preview: Element; scrim: Element } | null,
  options: LiftOptions = {},
): Lift {
  const target = source.classList.contains('rk-swipe-row__content')
    ? (source.closest<HTMLElement>('.rk-swipe-row') ?? source)
    : source
  const size = { width: source.offsetWidth || 1, height: source.offsetHeight || 1 }
  const from: Box = (previous ? previous.preview : source).getBoundingClientRect()
  const rest = restFor(variant, from, size, menuHeight)
  const scrimFrom = previous ? Number(getComputedStyle(previous.scrim).opacity) || 0 : 0
  const sourceStyle = getComputedStyle(source)
  const listBg = sourceStyle.getPropertyValue('--rk-list-bg').trim()
  // row 浮起时故意加圆角（--rk-lift-radius），不跟源；media / card 跟源自己的圆角
  const radius = variant === 'row' ? null : Number.parseFloat(sourceStyle.borderTopLeftRadius) || null
  const { preview, hide, settledRect } = options
  return {
    id: ++liftSeq,
    source,
    target,
    from,
    size,
    rest,
    scrimFrom,
    variant,
    menuHeight,
    listBg,
    radius,
    preview,
    hide,
    settledRect,
    flags: { handedOff: false, removing: false },
  }
}

/** 按菜单的真实高度重新定浮起位置（同一次浮起，id 与起点不变）：只在第一帧画出来之前用。 */
export function relift(lift: Lift, menuHeight: number): Lift {
  return { ...lift, menuHeight, rest: restFor(lift.variant, lift.from, lift.size, menuHeight) }
}

/**
 * 克隆排版尺寸下的圆角，使它放到 box（视觉矩形）时看上去等于源的圆角：横纵缩放可能不同，写成椭圆圆角。
 * 源没有圆角（radius 为 null）时返回 null，用 CSS 的 --rk-lift-radius。
 */
export function radiusAt(lift: Lift, box: Box): string | null {
  if (lift.radius === null) return null
  const rx = lift.radius / (box.width / lift.size.width || 1)
  const ry = lift.radius / (box.height / lift.size.height || 1)
  return `${rx}px / ${ry}px`
}

function restFor(variant: LiftVariant, from: Box, size: { width: number; height: number }, menuHeight: number): Box {
  const vp = viewportSize()
  if (variant === 'row') return rowRest(from, size, menuHeight, vp)
  return mediaRest(from, menuHeight, vp, variant === 'card' ? CARD_MIN_HEIGHT : MEDIA_MIN_HEIGHT)
}

/**
 * row：略放大，水平不出屏；菜单（按估算高度）下方放得下就留在原处，下方放不下而上方放得下也不动
 * （定位器会把菜单翻到上方），两边都放不下才把行往上挪，给下方的菜单让位。
 */
function rowRest(
  from: Box,
  size: { width: number; height: number },
  menuHeight: number,
  vp: { width: number; height: number },
): Box {
  const scale = Math.min(LIFT_SCALE, (vp.width - MARGIN * 2) / size.width)
  const width = size.width * scale
  const height = size.height * scale
  const left = Math.min(Math.max(from.left + (from.width - width) / 2, MARGIN), vp.width - MARGIN - width)
  let top = from.top + (from.height - height) / 2
  const below = vp.height - MARGIN - (top + height + GAP)
  const above = top - GAP - MARGIN
  if (below < menuHeight && above < menuHeight) top = vp.height - MARGIN - menuHeight - GAP - height
  top = Math.max(MARGIN, Math.min(top, vp.height - MARGIN - height))
  return { left, top, width, height }
}

/** media / card：放大一点，必要时缩小 / 挪动，菜单总在下方，「源 + 菜单」一起放得下（预览最矮 minHeight）。 */
function mediaRest(from: Box, menuHeight: number, vp: { width: number; height: number }, minHeight: number): Box {
  const room = vp.height - menuHeight - GAP - MARGIN * 2
  const scale = Math.min(LIFT_SCALE, (vp.width - MARGIN * 2) / from.width, Math.max(minHeight, room) / from.height)
  const width = from.width * scale
  const height = from.height * scale
  const left = Math.min(Math.max(from.left + (from.width - width) / 2, MARGIN), vp.width - MARGIN - width)
  const maxTop = vp.height - MARGIN - menuHeight - GAP - height
  const top = Math.max(MARGIN, Math.min(from.top + (from.height - height) / 2, maxTop))
  return { left, top, width, height }
}

/**
 * 原物的归处。调用方给了 settledRect 就用它；否则不在文档里 / 没有尺寸时为 null。
 *   - row：布局位置（去掉长按缩放：飞回的是它松开后的样子）；
 *   - card：此刻的视觉矩形（长按的缩放等菜单收完、放回原物时才撤，飞回的是缩着的样子）；
 *   - media：落定后的位置——原物还在过渡（刚在菜单里改了大小）时，把源与父元素上的动画临时拨到终点量一下再拨回，
 *     克隆直接飞向终点，和原物同时落定。同步完成，中间不会画出来。
 */
function homeBox(lift: Lift): Box | null {
  if (lift.settledRect) return lift.settledRect()
  const { source } = lift
  if (!source.isConnected || source.offsetWidth === 0) return null
  if (lift.variant === 'card') return source.getBoundingClientRect()
  if (lift.variant === 'media') {
    const owners = [source, source.parentElement].filter((el): el is HTMLElement => el !== null)
    const anims = owners.flatMap((el) => (typeof el.getAnimations === 'function' ? el.getAnimations() : []))
    const saved = anims.map((anim) => anim.currentTime)
    for (const anim of anims) {
      const end = anim.effect?.getComputedTiming().endTime
      if (typeof end === 'number' && Number.isFinite(end)) anim.currentTime = end
    }
    const rect = source.getBoundingClientRect()
    anims.forEach((anim, i) => {
      anim.currentTime = saved[i] ?? null
    })
    return rect
  }
  const rect = source.getBoundingClientRect()
  const width = source.offsetWidth
  const height = source.offsetHeight
  return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height }
}

/** 克隆根上要去掉的状态：FLIP、按压 / 长按 / 展开 / 拖动 / 收拢标记。 */
const ROOT_ATTRS = [
  'data-rk-flip-key',
  'data-rk-flip-collapse',
  'data-holding',
  'data-pressed',
  'data-open',
  'data-dragging',
  'data-armed',
  'data-settling',
  'data-removing',
  'data-swiped-out',
]
/** 克隆里所有节点上要去掉的：长按标记、可聚焦、可拖、id。 */
const NODE_ATTRS = ['data-context-id', 'data-context-action', 'tabindex', 'draggable', 'id', LIFT_SOURCE_ATTR]
const NODE_SELECTOR = NODE_ATTRS.map((name) => `[${name}]`).join(', ')

/** 浮起源的静态拷贝：去掉 FLIP / 长按 / 按压标记、SwipeRow 两侧按钮、可聚焦与 id，不可交互。 */
function cloneTarget(lift: Lift): HTMLElement {
  const clone = lift.target.cloneNode(true) as HTMLElement
  for (const name of ROOT_ATTRS) clone.removeAttribute(name)
  if (lift.target !== lift.source) {
    clone.style.setProperty('--rk-swipe-x', '0px')
    for (const el of clone.querySelectorAll('.rk-swipe-row__actions')) el.remove()
  }
  for (const el of [clone, ...clone.querySelectorAll(NODE_SELECTOR)]) {
    for (const name of NODE_ATTRS) el.removeAttribute(name)
  }
  // 铺满预览框（预览框就是源的布局尺寸）：离开原来的布局上下文，外边距与尺寸规则不再适用
  Object.assign(clone.style, { width: '100%', height: '100%', margin: '0', boxSizing: 'border-box' })
  return clone
}

interface LiftLayerProps {
  lift: Lift
  open: boolean
  onLanded: (lift: Lift) => void
  /**
   * 落地（关闭时先于 onLanded）：飞回的克隆进了 LANDING_THRESHOLD_PX、其余退场动画也播完（不飞回的退场就是全部播完）。
   * 此刻原物已放回、克隆藏起，浮起层还挂着让弹簧尾巴播完再 onLanded。
   */
  onTouchdown?: (lift: Lift) => void
  /** 第一帧画出来了（之后不再按菜单真实高度重定浮起位置）。 */
  onPainted?: (id: number) => void
  /** 不抢焦点（LiftMenu keepFocus）：按下压暗层不让编辑器失焦。 */
  keepFocus?: boolean
}

/** 按下时阻止默认行为：焦点留在编辑器里，iOS 不收键盘。 */
const preventFocus = (event: SyntheticEvent) => event.preventDefault()

export function LiftLayer({ lift, open, onLanded, onTouchdown, onPainted, keepFocus = false }: LiftLayerProps) {
  const previewRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const shadowRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const enterAnims = useRef<Animation[]>([])
  const releaseRef = useRef<(() => void) | null>(null)
  const onLandedRef = useRef(onLanded)
  onLandedRef.current = onLanded
  const onTouchdownRef = useRef(onTouchdown)
  onTouchdownRef.current = onTouchdown
  const onPaintedRef = useRef(onPainted)
  onPaintedRef.current = onPainted

  const rest = boxTransform(lift.rest, lift.rest, lift.size)

  // 打开（每次浮起一次，按真实高度重定位置时不重做）：放克隆、藏原物
  useLayoutEffect(() => {
    if (!lift.preview) bodyRef.current?.replaceChildren(cloneTarget(lift))
    let release: (() => void) | null = null
    if (lift.hide) {
      release = lift.hide()
    } else {
      lift.source.setAttribute(LIFT_SOURCE_ATTR, '')
      release = () => lift.source.removeAttribute(LIFT_SOURCE_ATTR)
    }
    releaseRef.current = () => {
      releaseRef.current = null
      release?.()
      release = null
    }
    const frame = requestAnimationFrame(() => onPaintedRef.current?.(lift.id))
    return () => {
      cancelAnimationFrame(frame)
      releaseRef.current?.()
    }
    // 同一次浮起（id 不变）只做一次；lift 的其余字段此时与 id 一一对应
  }, [lift.id])

  // 克隆从起点弹簧浮起，阴影与底淡入；按真实高度重定了浮起位置（第一帧之前）就从头再来
  useLayoutEffect(() => {
    const preview = previewRef.current
    const scrim = scrimRef.current
    const shadow = shadowRef.current
    if (preview && scrim && shadow && typeof preview.animate === 'function' && reduced()) {
      // card（liftMotion）减弱动效时也淡入；row / media 直接出现
      if (lift.variant === 'card') {
        enterAnims.current = [
          preview.animate([{ opacity: 0 }, { opacity: 1 }], MEDIA_REDUCED_PREVIEW_MS),
          scrim.animate([{ opacity: 0 }, { opacity: 1 }], MEDIA_REDUCED_SCRIM_MS),
        ]
      }
    } else if (preview && scrim && shadow && typeof preview.animate === 'function') {
      const spring = snappy()
      const flight = preview.animate(
        [{ transform: boxTransform(lift.from, lift.rest, lift.size) }, { transform: rest }],
        spring,
      )
      if (lift.variant !== 'row') {
        enterAnims.current = [
          flight,
          ...radiusFlight(lift, [shadow, bodyRef.current], lift.from, lift.rest, spring),
          shadow.animate([{ opacity: 0 }, { opacity: 1 }], spring.duration),
          scrim.animate([{ opacity: lift.scrimFrom }, { opacity: 1 }], MEDIA_SCRIM_ENTER),
        ]
      } else {
        const enter = fade('enter')
        enterAnims.current = [
          flight,
          shadow.animate([{ opacity: 0 }, { opacity: 1 }], enter),
          scrim.animate([{ opacity: lift.scrimFrom }, { opacity: 1 }], enter),
        ]
      }
    }
    return () => {
      for (const anim of enterAnims.current) anim.cancel()
      enterAnims.current = []
    }
    // rest 由 lift 算出
  }, [lift])

  // 关闭：从此刻的姿态飞回（或原地淡出）。克隆进了落地阈值、其余动画也播完就放回原物、藏起克隆、通知落地
  // （原物与克隆差不到 LANDING_THRESHOLD_PX，换过去看不出跳变）；弹簧全部播完再通知卸载
  useLayoutEffect(() => {
    if (open) return
    const preview = previewRef.current
    const scrim = scrimRef.current
    const shadow = shadowRef.current
    let touched = false
    const touchdown = () => {
      if (touched) return
      touched = true
      releaseRef.current?.()
      if (preview) preview.style.visibility = 'hidden'
      onTouchdownRef.current?.(lift)
    }
    const land = () => {
      touchdown()
      onLandedRef.current(lift)
    }
    if (!preview || !scrim || !shadow || typeof preview.animate !== 'function') {
      land()
      return
    }
    // 从此刻的姿态接着走：先读下进场动画当前的值，再停掉它
    const from = currentTransform(preview)
    const scrimOpacity = getComputedStyle(scrim).opacity || '1'
    const shadowOpacity = getComputedStyle(shadow).opacity || '1'
    // 克隆此刻的视觉矩形（停掉进场动画之前读）：圆角从它换算的值接着走
    const boxNow: Box = preview.getBoundingClientRect()
    for (const anim of enterAnims.current) anim.cancel()
    enterAnims.current = []

    // 交接：克隆当场让位（handOff 时已经设过，这里兜底）
    if (lift.flags.handedOff) preview.style.opacity = '0'
    const exit = lift.variant === 'media' ? mediaExit : lift.variant === 'card' ? cardExit : rowExit
    const { anims, home } = exit(lift, preview, scrim, shadow, from, scrimOpacity, shadowOpacity)
    // 飞回时圆角跟着缩放走（落地时看上去等于源的圆角），与飞回同一条曲线；判落地时和飞回算一组
    const flights = home
      ? [home.flight, ...radiusFlight(lift, [shadow, bodyRef.current], boxNow, home.to, { ...home.timing, fill: 'forwards' })]
      : []
    anims.push(...flights.slice(1))
    let done = false
    let frame = 0
    if (home) {
      // 克隆此刻的矩形贴近归处、底与阴影也已淡完才算落地：不然换回原物时它们会被截断
      const watch = () => {
        frame = 0
        if (done || touched) return
        const othersDone = anims.every((anim) => flights.includes(anim) || anim.playState === 'finished')
        if (othersDone && nearBox(preview.getBoundingClientRect(), home.to)) touchdown()
        else frame = requestAnimationFrame(watch)
      }
      frame = requestAnimationFrame(watch)
    }
    Promise.all(anims.map((anim) => anim.finished)).then(
      () => {
        done = true
        land()
      },
      () => {},
    )
    return () => {
      if (frame) cancelAnimationFrame(frame)
      if (!done) for (const anim of anims) anim.cancel()
    }
  }, [open, lift])

  const restRadius = radiusAt(lift, lift.rest)
  const style = {
    left: lift.rest.left,
    top: lift.rest.top,
    width: lift.size.width,
    height: lift.size.height,
    transform: rest,
    ...(lift.listBg ? { '--rk-list-bg': lift.listBg } : null),
    ...(restRadius ? { '--rk-lift-radius': restRadius } : null),
  } as CSSProperties

  return createPortal(
    <div
      ref={blockTouchScroll}
      className={LAYER_CLASS}
      aria-hidden="true"
      data-variant={lift.variant}
      data-closing={open ? undefined : ''}
      data-lift-id={lift.id}
      {...(keepFocus ? { onPointerDown: preventFocus, onMouseDown: preventFocus } : null)}
    >
      <div ref={scrimRef} className="rk-lift-menu__scrim" />
      <div ref={previewRef} className="rk-lift-menu__preview" style={style}>
        <div ref={shadowRef} className="rk-lift-menu__shadow" />
        <div ref={bodyRef} className="rk-lift-menu__clone" inert>
          {lift.preview}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** 退场的全部动画；克隆飞回原物时带上飞回的那条与归处（据此判落地）。 */
interface Exit {
  anims: Animation[]
  home?: { flight: Animation; to: Box; timing: { duration: number; easing: string } }
}

/**
 * 圆角随缩放过渡（media / card 且源有圆角时）：从 from（起点 / 打断时克隆此刻的视觉矩形）换算的圆角走到 to 的，
 * 与飞回 / 浮起同时长同曲线，任何时刻看上去都约等于源的圆角。
 */
function radiusFlight(
  lift: Lift,
  els: (HTMLElement | null)[],
  from: Box,
  to: Box,
  timing: KeyframeAnimationOptions,
): Animation[] {
  const start = radiusAt(lift, from)
  const end = radiusAt(lift, to)
  if (start === null || end === null) return []
  return els.flatMap((el) => (el ? [el.animate([{ borderRadius: start }, { borderRadius: end }], timing)] : []))
}

/** 两个矩形的四边都差在 LANDING_THRESHOLD_PX 以内。 */
function nearBox(rect: Box, to: Box): boolean {
  return (
    Math.abs(rect.left - to.left) <= LANDING_THRESHOLD_PX &&
    Math.abs(rect.top - to.top) <= LANDING_THRESHOLD_PX &&
    Math.abs(rect.left + rect.width - (to.left + to.width)) <= LANDING_THRESHOLD_PX &&
    Math.abs(rect.top + rect.height - (to.top + to.height)) <= LANDING_THRESHOLD_PX
  )
}

/**
 * row 退场：飞回布局位置，阴影与底按 exit 时长淡出；没处可回（源正被拿掉、或减弱动效）就原地淡出；
 * 交接了只淡出底。
 */
function rowExit(
  lift: Lift,
  preview: HTMLElement,
  scrim: HTMLElement,
  shadow: HTMLElement,
  from: string,
  scrimOpacity: string,
  shadowOpacity: string,
): Exit {
  const out = { ...fade('exit'), fill: 'forwards' as const }
  const anims = [scrim.animate([{ opacity: scrimOpacity }, { opacity: 0 }], out)]
  if (lift.flags.handedOff) return { anims }
  const back = lift.flags.removing ? null : homeBox(lift)
  if (reduced() || !back || !boxVisible(back)) {
    anims.push(preview.animate([{ transform: from, opacity: 1 }, { transform: from, opacity: 0 }], out))
    return { anims }
  }
  const spring = snappy()
  const flight = preview.animate([{ transform: from }, { transform: boxTransform(back, lift.rest, lift.size) }], {
    ...spring,
    fill: 'forwards',
  })
  anims.push(flight, shadow.animate([{ opacity: shadowOpacity }, { opacity: 0 }], out))
  return { anims, home: { flight, to: back, timing: spring } }
}

/**
 * media 退场：飞回用和浮起同一条 snappy 弹簧（临界阻尼、不过冲），进退手感一致；
 * 没处可回（原物滚出视口 / 已经不在 / 正被拿掉）以中心缩到 .9 并淡出。减弱动效时只淡出。
 * 交接了（看图 / 裁剪器接手）：克隆不动（已经透明），压暗晚 120ms 再淡，和它们淡入的底交叉过渡。
 */
function mediaExit(
  lift: Lift,
  preview: HTMLElement,
  scrim: HTMLElement,
  shadow: HTMLElement,
  from: string,
  scrimOpacity: string,
  shadowOpacity: string,
): Exit {
  const { handedOff, removing } = lift.flags
  if (reduced()) {
    const scrimOut = scrim.animate([{ opacity: scrimOpacity }, { opacity: 0 }], {
      duration: MEDIA_REDUCED_SCRIM_MS,
      fill: 'forwards',
    })
    if (handedOff) return { anims: [scrimOut] }
    return {
      anims: [
        preview.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MEDIA_REDUCED_PREVIEW_MS, fill: 'forwards' }),
        scrimOut,
      ],
    }
  }
  const spring = snappy()
  const anims: Animation[] = []
  let home: Exit['home']
  const back = homeBox(lift)
  if (handedOff) {
    // 克隆已经透明，不飞
  } else if (back && boxVisible(back) && !removing) {
    const flight = preview.animate([{ transform: from }, { transform: boxTransform(back, lift.rest, lift.size) }], {
      ...spring,
      fill: 'forwards',
    })
    anims.push(
      flight,
      shadow.animate([{ opacity: shadowOpacity }, { opacity: 0 }], { duration: spring.duration, fill: 'forwards' }),
    )
    home = { flight, to: back, timing: spring }
  } else {
    const { left, top, width, height } = lift.rest
    const inset = (1 - MEDIA_SHRINK) / 2
    const shrunk: Box = {
      left: left + width * inset,
      top: top + height * inset,
      width: width * MEDIA_SHRINK,
      height: height * MEDIA_SHRINK,
    }
    anims.push(
      preview.animate([{ transform: from }, { transform: boxTransform(shrunk, lift.rest, lift.size) }], {
        ...spring,
        fill: 'forwards',
      }),
      preview.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: MEDIA_FADE_OUT_MS,
        easing: MEDIA_EASE,
        fill: 'forwards',
      }),
    )
  }
  anims.push(
    scrim.animate([{ opacity: scrimOpacity }, { opacity: 0 }], {
      duration: MEDIA_SCRIM_EXIT_MS,
      delay: handedOff ? MEDIA_HANDOFF_SCRIM_DELAY : 0,
      easing: MEDIA_EASE,
      fill: 'forwards',
    }),
  )
  return { anims, home }
}

/**
 * card 退场（RakkoNotes liftMotion.ts）：300ms 缓动飞回此刻的位置，阴影同时长淡出；没处可回（卡片已删 / 滚出视口）
 * 以左上角缩到 .9 并淡出（200ms）；底 260ms 淡出。减弱动效时预览 150ms、底 200ms 淡出。
 * 交接了（预览框接手）：克隆已经透明，飞回照播但看不见，压暗照常淡出。
 */
function cardExit(
  lift: Lift,
  preview: HTMLElement,
  scrim: HTMLElement,
  shadow: HTMLElement,
  from: string,
  scrimOpacity: string,
  shadowOpacity: string,
): Exit {
  if (reduced()) {
    const fadeOut = [{ opacity: 1 }, { opacity: 0 }]
    return {
      anims: [
        preview.animate(fadeOut, { duration: MEDIA_REDUCED_PREVIEW_MS, fill: 'forwards' }),
        scrim.animate(fadeOut, { duration: MEDIA_REDUCED_SCRIM_MS, fill: 'forwards' }),
      ],
    }
  }
  const anims: Animation[] = []
  let home: Exit['home']
  const back = lift.flags.removing ? null : homeBox(lift)
  if (back && boxVisible(back)) {
    const flight = preview.animate([{ transform: from }, { transform: boxTransform(back, lift.rest, lift.size) }], {
      ...CARD_RETURN,
      fill: 'forwards',
    })
    // 交接了克隆本来就看不见，源由接手的一方藏着：不提前判落地
    if (!lift.flags.handedOff) home = { flight, to: back, timing: CARD_RETURN }
    anims.push(
      flight,
      shadow.animate([{ opacity: shadowOpacity }, { opacity: 0 }], { duration: CARD_RETURN.duration, fill: 'forwards' }),
    )
  } else {
    const { left, top, width, height } = lift.rest
    const shrunk: Box = { left, top, width: width * MEDIA_SHRINK, height: height * MEDIA_SHRINK }
    anims.push(
      preview.animate(
        [
          { opacity: 1, transform: from },
          { opacity: 0, transform: boxTransform(shrunk, lift.rest, lift.size) },
        ],
        { duration: CARD_SHRINK_MS, easing: MEDIA_EASE, fill: 'forwards' },
      ),
    )
  }
  anims.push(
    scrim.animate([{ opacity: scrimOpacity }, { opacity: 0 }], {
      duration: MEDIA_SCRIM_EXIT_MS,
      easing: MEDIA_EASE,
      fill: 'forwards',
    }),
  )
  return { anims, home }
}
