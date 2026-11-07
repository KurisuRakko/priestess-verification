// 弹簧动效：参数沿用 SwiftUI 的 spring(response, dampingFraction)。
//  - response：无阻尼时振荡一个周期的秒数（越小越快）
//  - damping：阻尼比，1 = 临界阻尼（不回弹），< 1 会过冲
//
// 四档预设与 design-system/src/tokens.css 的 --motion-spring-* 一一对应，
// 由 src/spring.test.ts 锁定：token 里的 linear() 串必须等于 springEasing(SPRINGS.x) 的输出。
//
// 两种曲线、两个积分器：
//  - springEasing：固定预设，simulate（240Hz）积分，20–60 个等分点、三位小数，按参数缓存；token 由它生成，不能改。
//  - springCurve：松手现算（初速度每次都不同），逐值照搬 RakkoNotes 的 1ms 积分器，按帧采样、四位小数、不缓存，可以 clamp。

export interface SpringSpec {
  response: number
  damping: number
}

export const SPRINGS = {
  /** 按压、开关这类小反馈：快、不回弹 */
  snappy: { response: 0.3, damping: 1 },
  /** 默认空间动效：进场、切页、数字滚动，带一点点过冲 */
  smooth: { response: 0.5, damping: 0.86 },
  /** 大面积表面：卡片展开成 sheet、背景退后；慢、不回弹 */
  gentle: { response: 0.85, damping: 1 },
  /** 导航栈的页面推入 / 返回：临界阻尼，不能过冲（否则页面会越过左缘露出底色） */
  page: { response: 0.35, damping: 1 },
} as const satisfies Record<string, SpringSpec>

export type SpringName = keyof typeof SPRINGS

export interface SpringEasing {
  /** CSS `linear()` 缓动函数，可直接给 transition / animation / WAAPI */
  easing: string
  /** 弹簧落定所需毫秒数（整数） */
  durationMs: number
}

const cache = new Map<string, SpringEasing>()

/** 积分步长：240Hz，points 里相邻两点相隔一步。 */
const SIM_HZ = 240

/**
 * 从 0 积分到 1（质量 1、半隐式欧拉）；v0 是按「总位移」归一化的初速度（1/s），正值朝向终点。
 * 落定（|x - 1| < 0.001 且 |v| < 0.02）或到 maxSeconds 为止；seconds 是实际积分时长。
 */
function simulate(spec: SpringSpec, v0: number, maxSeconds = 4): { points: number[]; seconds: number } {
  const omega = (2 * Math.PI) / spec.response
  const k = omega * omega
  const c = 2 * spec.damping * omega
  const dt = 1 / SIM_HZ
  let x = 0
  let v = v0
  let t = 0
  const points: number[] = [0]
  while (t < maxSeconds) {
    const a = -k * (x - 1) - c * v
    v += a * dt
    x += v * dt
    t += dt
    points.push(x)
    if (t > 0.05 && Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.02) break
  }
  return { points, seconds: t }
}

/** 把弹簧展开成 CSS `linear()`；结果按参数缓存。 */
export function springEasing(spec: SpringSpec, velocity = 0): SpringEasing {
  const key = `${spec.response}|${spec.damping}|${velocity.toFixed(2)}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const { points, seconds } = simulate(spec, velocity)
  const samples = Math.min(60, Math.max(20, Math.round(seconds * 40)))
  const stops: string[] = []
  for (let i = 0; i <= samples; i += 1) {
    const index = Math.round((i / samples) * (points.length - 1))
    stops.push(String(Math.round((points[index] ?? 1) * 1000) / 1000))
  }
  stops[0] = '0'
  stops[stops.length - 1] = '1'
  const solved = { easing: `linear(${stops.join(', ')})`, durationMs: Math.round(seconds * 1000) }
  cache.set(key, solved)
  return solved
}

export interface SpringCurveOptions extends Partial<SpringSpec> {
  /** 初速度，单位「进度 / 秒」：像素速度 ÷ 总位移，正值朝向终点。 */
  velocity?: number
  /** 不许越过终点（收起、回到 0 时用：越过去会露出另一侧的内容）。 */
  clamp?: boolean
}

/** springCurve 的采样间隔（ms）：一帧（60fps）。 */
const CURVE_STEP_MS = 1000 / 60
/** springCurve 的最长时长（ms）：初速度再大也不拖尾。 */
const CURVE_MAX_MS = 1200

/**
 * 带初速度的弹簧曲线（松手收尾用：导航右滑 settle、看图甩动、FLIP 接续）。
 * 逐值照搬 RakkoNotes `lists/motion.ts` 的 springCurve（Rakko 认可的手感）：自己的积分器——1ms 一步的半隐式欧拉，
 * 每过一帧（16.67ms）取一点，取点时 |x| < 0.001 且 |v| < 0.05 才算落定，最长 1.2s（到时直接落到 1），四位小数、不缓存、可 clamp。
 * 不与 springEasing 共用 simulate（240Hz、落定阈值 |v| < 0.02）：那边生成 token，不能动；这边换步长会让过冲变小、时长变长
 * （初速度 40 时过冲 1.24 对 1.31），见 docs/2026-10-24-lift-swipe-gaps.md。
 * 甩得快的起步陡、收尾短，慢慢拖的从静止起步。默认 response 0.42、damping 1（RakkoNotes 原值）。
 */
export function springCurve({
  response = 0.42,
  damping = 1,
  velocity = 0,
  clamp = false,
}: SpringCurveOptions = {}): SpringEasing {
  const stiffness = ((2 * Math.PI) / response) ** 2
  const friction = (4 * Math.PI * damping) / response
  // x：离终点的剩余距离（1 → 0）；v：x 的速度，与进度速度反号
  let x = 1
  let v = -velocity
  const stops = [0]
  const dt = 1 / 1000
  let t = 0
  let next = CURVE_STEP_MS
  while (t < CURVE_MAX_MS) {
    v += (-stiffness * x - friction * v) * dt
    x += v * dt
    t += 1
    if (t >= next) {
      const p = 1 - x
      stops.push(Math.round((clamp ? Math.min(p, 1) : p) * 10000) / 10000)
      next += CURVE_STEP_MS
      if (Math.abs(x) < 0.001 && Math.abs(v) < 0.05) break
    }
  }
  stops[stops.length - 1] = 1
  return { easing: `linear(${stops.join(', ')})`, durationMs: Math.round((stops.length - 1) * CURVE_STEP_MS) }
}

/** 导航页弹簧的取点段数：照 RakkoNotes a4d14f0 的 --rn-spring-nav（24 段）。 */
const PAGE_SEGMENTS = 24
/** 落定阈值：离终点不到 0.001 即算落定（response 0.35 时是 515ms）。 */
const PAGE_SETTLE = 0.001

let pageCache: SpringEasing | null = null

/**
 * 导航栈推入 / 返回（含浏览器前进后退）的位移曲线，也是 --motion-spring-page token 的来源。
 * 与 RakkoNotes 的 --rn-spring-nav 逐字一致：SPRINGS.page（response 0.35、临界阻尼）的解析解 x(t) = 1 − (1 + ωt)e^(−ωt)，
 * 离终点不到 0.001 的那一毫秒为时长（515ms），等分 24 段、三位小数。
 * 不用 springEasing(SPRINGS.page)（240Hz 数值积分、550ms）：同参数下它前 150ms 跑得更快（50ms 处约多 8.6px）、晚 35ms 落定。
 * 其余三档预设（snappy / smooth / gentle）的 token 仍由 springEasing 生成。
 */
export function pageSpringEasing(): SpringEasing {
  if (pageCache) return pageCache
  const omega = (2 * Math.PI) / SPRINGS.page.response
  const x = (ms: number) => 1 - (1 + (omega * ms) / 1000) * Math.exp((-omega * ms) / 1000)
  let durationMs = 0
  while (1 - x(durationMs) >= PAGE_SETTLE) durationMs += 1
  const stops = ['0']
  for (let i = 1; i < PAGE_SEGMENTS; i += 1) stops.push(String(Math.round(x((i / PAGE_SEGMENTS) * durationMs) * 1000) / 1000))
  stops.push('1')
  pageCache = { easing: `linear(${stops.join(', ')})`, durationMs }
  return pageCache
}

/** 苹果的橡皮筋公式：越拉越沉，位移永远到不了 dimension。 */
export function rubberBand(offset: number, dimension: number, coefficient = 0.55): number {
  const sign = Math.sign(offset)
  const x = Math.abs(offset)
  return sign * (1 - 1 / ((x * coefficient) / dimension + 1)) * dimension
}

/** 松手后按速度（px/s）预测还会滑多远（UIScrollView 的 decelerationRate.normal）。 */
export function projectMomentum(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate)
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * 手势用的数值弹簧（rAF 驱动）：set() 改目标时**保留当前速度**，
 * 中途改主意会顺着惯性拐弯，而不是从头重播。reduced-motion 下直接跳到目标。
 */
export class SpringValue {
  value: number
  velocity = 0
  target: number
  spec: SpringSpec
  private frame = 0
  private last = 0
  private readonly onChange: (value: number, velocity: number) => void

  constructor(initial: number, spec: SpringSpec, onChange: (value: number, velocity: number) => void) {
    this.value = initial
    this.target = initial
    this.spec = spec
    this.onChange = onChange
  }

  /** 直接定位（拖动中）：停掉弹簧，速度由调用方给。 */
  jump(value: number, velocity = 0): void {
    this.stop()
    this.value = value
    this.target = value
    this.velocity = velocity
    this.onChange(value, velocity)
  }

  set(target: number, velocity?: number): void {
    this.target = target
    if (velocity !== undefined) this.velocity = velocity
    if (prefersReducedMotion()) {
      this.jump(target)
      return
    }
    if (this.frame === 0) {
      this.last = performance.now()
      this.frame = requestAnimationFrame(this.tick)
    }
  }

  stop(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  private readonly tick = (now: number): void => {
    const elapsed = Math.min(0.064, (now - this.last) / 1000)
    this.last = now
    const omega = (2 * Math.PI) / this.spec.response
    const k = omega * omega
    const c = 2 * this.spec.damping * omega
    const steps = Math.max(1, Math.ceil(elapsed * 240))
    const dt = elapsed / steps
    for (let i = 0; i < steps; i += 1) {
      const a = -k * (this.value - this.target) - c * this.velocity
      this.velocity += a * dt
      this.value += this.velocity * dt
    }
    if (Math.abs(this.value - this.target) < 0.0005 && Math.abs(this.velocity) < 0.005) {
      this.value = this.target
      this.velocity = 0
      this.frame = 0
      this.onChange(this.value, 0)
      return
    }
    this.onChange(this.value, this.velocity)
    this.frame = requestAnimationFrame(this.tick)
  }
}
