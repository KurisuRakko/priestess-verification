import { useEffect, useId, useRef, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../cx'
import { prefersReducedMotion } from '../spring'

export interface PageScrollbarProps {
  /** 轨道上方留白（px），通常传 TopBar 高度让滚动条从顶栏下方开始；默认 0 */
  insetTop?: number
  /** 轨道下方留白（px），例如 BottomNav 高度；默认 0 */
  insetBottom?: number
  className?: string
}

/** 挂在 <html> 上的属性：CSS 据此隐藏原生页面滚动条；拖动期间值为 'dragging'。 */
export const PAGE_SCROLLBAR_ATTR = 'data-rk-page-scrollbar'
/** 拇指最短长度（px）：内容再长也留得住手指和光标。 */
export const PAGE_SCROLLBAR_MIN_THUMB = 32
/** 停止滚动后多久淡出（ms）。 */
export const PAGE_SCROLLBAR_HIDE_DELAY_MS = 900

export interface ScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export interface ThumbGeometry {
  /** 拇指长度（px） */
  size: number
  /** 拇指相对轨道顶部的位移（px） */
  offset: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 内容比视口高出 1px 以上才算可滚动（亚像素取整不算）。 */
export function isPageScrollable(metrics: ScrollMetrics): boolean {
  return metrics.scrollHeight > metrics.clientHeight + 1
}

/** 拇指长度 = max(32px, 视口 / 内容 × 轨道长)，位置按滚动比例落在剩余行程里。 */
export function thumbGeometry(metrics: ScrollMetrics, trackLength: number): ThumbGeometry {
  const track = Math.max(0, trackLength)
  const ratio = metrics.scrollHeight > 0 ? metrics.clientHeight / metrics.scrollHeight : 1
  const size = Math.min(track, Math.max(PAGE_SCROLLBAR_MIN_THUMB, ratio * track))
  const maxScroll = metrics.scrollHeight - metrics.clientHeight
  const travel = track - size
  const progress = maxScroll > 0 ? clamp(metrics.scrollTop / maxScroll, 0, 1) : 0
  return { size, offset: progress * travel }
}

/** 拖动换算：拇指顶端相对轨道的位移 → 页面 scrollTop（越界夹到首尾）。 */
export function thumbOffsetToScrollTop(
  offset: number,
  metrics: ScrollMetrics,
  trackLength: number,
  thumbSize: number,
): number {
  const travel = trackLength - thumbSize
  const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
  if (travel <= 0) return 0
  return clamp(offset / travel, 0, 1) * maxScroll
}

/** 点轨道空白处翻一屏：reduced-motion 下即时跳转，否则平滑滚动。 */
export function pageScrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'instant' : 'smooth'
}

// 页面滚动的是谁：通常是 document.scrollingElement（<html>）；页面把 html 锁死、
// 让 body 自己 overflow 滚动时，换成 body。
function resolveScroller(): HTMLElement {
  const root = (document.scrollingElement as HTMLElement | null) ?? document.documentElement
  const body = document.body
  if (body !== null && body !== root && !isPageScrollable(readMetrics(root))) {
    const overflowY = getComputedStyle(body).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && isPageScrollable(readMetrics(body))) {
      return body
    }
  }
  return root
}

function readMetrics(element: HTMLElement): ScrollMetrics {
  return {
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }
}

function scrollPage(scroller: HTMLElement, top: number, behavior: ScrollBehavior): void {
  const options: ScrollToOptions = { top, behavior }
  if (scroller === document.scrollingElement || scroller === document.documentElement) {
    window.scrollTo(options)
  } else {
    scroller.scrollTo(options)
  }
}

// 多个实例共用 <html> 上的一个属性：引用计数，最先挂载的那个生效，其余渲染 null。
const instances: string[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function register(id: string): void {
  instances.push(id)
  if (instances.length === 1) document.documentElement.setAttribute(PAGE_SCROLLBAR_ATTR, '')
  emit()
}

function unregister(id: string): void {
  const index = instances.indexOf(id)
  if (index === -1) return
  instances.splice(index, 1)
  if (instances.length === 0) document.documentElement.removeAttribute(PAGE_SCROLLBAR_ATTR)
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getActive = (): string | null => instances[0] ?? null
const getServerActive = (): string | null => null

/**
 * rk-page-scrollbar：页面级自定义滚动条，替代浏览器原生的页面滚动条。
 * 挂载期间给 <html> 加 data-rk-page-scrollbar 隐藏原生滚动条（html 与 body 都盖住），
 * 视口右缘画一条 fixed 轨道和圆角拇指：滚动时淡入、停 900ms 淡出，悬停 / 拖动常显。
 * 纯装饰（aria-hidden、不可聚焦），键盘与辅助技术照常滚动原生页面。
 * SSR 与首帧渲染 null，挂载后经 portal 落到 body，避开祖先 transform 让 fixed 失效。
 */
export function PageScrollbar({ insetTop = 0, insetBottom = 0, className }: PageScrollbarProps) {
  const id = useId()
  const active = useSyncExternalStore(subscribe, getActive, getServerActive) === id
  const track = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLDivElement>(null)

  useEffect(() => {
    register(id)
    return () => unregister(id)
  }, [id])

  useEffect(() => {
    const trackEl = track.current
    const thumbEl = thumb.current
    if (!active || trackEl === null || thumbEl === null) return

    let frame = 0
    let hideTimer: ReturnType<typeof setTimeout> | undefined
    let trackLength = 0
    let lastSize = -1
    let geometry: ThumbGeometry | null = null
    let dragging = false
    let grabOffset = 0

    // rAF 内只读一次滚动度量、写一次 transform；高度只在内容或轨道变化时改。
    const update = (): void => {
      frame = 0
      const metrics = readMetrics(resolveScroller())
      const scrollable = isPageScrollable(metrics)
      trackEl.toggleAttribute('data-scrollable', scrollable)
      if (!scrollable) {
        geometry = null
        return
      }
      geometry = thumbGeometry(metrics, trackLength)
      if (geometry.size !== lastSize) {
        lastSize = geometry.size
        thumbEl.style.height = `${geometry.size}px`
      }
      thumbEl.style.transform = `translateY(${geometry.offset}px)`
    }
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(update)
    }
    const measure = (): void => {
      trackLength = trackEl.clientHeight
      schedule()
    }
    const reveal = (): void => {
      trackEl.setAttribute('data-active', '')
      clearTimeout(hideTimer)
      hideTimer = setTimeout(() => {
        if (!dragging) trackEl.removeAttribute('data-active')
      }, PAGE_SCROLLBAR_HIDE_DELAY_MS)
    }
    // 键盘（PageUp/Down、空格、方向键）与辅助技术滚动同样触发 scroll，一并淡入。
    const onScroll = (): void => {
      schedule()
      reveal()
    }

    const onThumbPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      dragging = true
      grabOffset = event.clientY - thumbEl.getBoundingClientRect().top
      trackEl.setAttribute('data-dragging', '')
      document.documentElement.setAttribute(PAGE_SCROLLBAR_ATTR, 'dragging')
      try {
        thumbEl.setPointerCapture(event.pointerId)
      } catch {
        // 指针已经没了
      }
      reveal()
    }
    const onThumbPointerMove = (event: PointerEvent): void => {
      if (!dragging || geometry === null) return
      const scroller = resolveScroller()
      const offset = event.clientY - trackEl.getBoundingClientRect().top - grabOffset
      const top = thumbOffsetToScrollTop(offset, readMetrics(scroller), trackLength, geometry.size)
      scrollPage(scroller, top, 'instant')
    }
    const endDrag = (): void => {
      if (!dragging) return
      dragging = false
      trackEl.removeAttribute('data-dragging')
      if (instances.length > 0) document.documentElement.setAttribute(PAGE_SCROLLBAR_ATTR, '')
      reveal()
    }
    // 点轨道空白处：朝点击方向翻一屏。
    const onTrackPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || event.target !== trackEl) return
      event.preventDefault()
      const scroller = resolveScroller()
      const metrics = readMetrics(scroller)
      const thumbTop = thumbEl.getBoundingClientRect().top
      const direction = event.clientY < thumbTop ? -1 : 1
      scrollPage(scroller, metrics.scrollTop + direction * metrics.clientHeight, pageScrollBehavior())
      reveal()
    }

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(document.documentElement)
    observer?.observe(document.body)
    observer?.observe(trackEl)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', onScroll, { passive: true })
    document.body.addEventListener('scroll', onScroll, { passive: true })
    trackEl.addEventListener('pointerdown', onTrackPointerDown)
    thumbEl.addEventListener('pointerdown', onThumbPointerDown)
    thumbEl.addEventListener('pointermove', onThumbPointerMove)
    thumbEl.addEventListener('pointerup', endDrag)
    thumbEl.addEventListener('pointercancel', endDrag)
    thumbEl.addEventListener('lostpointercapture', endDrag)
    measure()

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(hideTimer)
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', onScroll)
      document.body.removeEventListener('scroll', onScroll)
      trackEl.removeEventListener('pointerdown', onTrackPointerDown)
      thumbEl.removeEventListener('pointerdown', onThumbPointerDown)
      thumbEl.removeEventListener('pointermove', onThumbPointerMove)
      thumbEl.removeEventListener('pointerup', endDrag)
      thumbEl.removeEventListener('pointercancel', endDrag)
      thumbEl.removeEventListener('lostpointercapture', endDrag)
      if (dragging && instances.length > 0) {
        document.documentElement.setAttribute(PAGE_SCROLLBAR_ATTR, '')
      }
    }
  }, [active])

  if (!active) return null

  return createPortal(
    <div
      ref={track}
      aria-hidden="true"
      className={cx('rk-page-scrollbar', className)}
      style={
        {
          '--rk-page-scrollbar-inset-top': `${insetTop}px`,
          '--rk-page-scrollbar-inset-bottom': `${insetBottom}px`,
        } as CSSProperties
      }
    >
      <div ref={thumb} className="rk-page-scrollbar__thumb" />
    </div>,
    document.body,
  )
}
