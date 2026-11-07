// 取色器的颜色换算与默认色板（不碰 DOM，便于单测）。
// HSV ↔ RGB 是教科书公式（与 react-colorful、Chromium 取色器同一套），这里按本仓库风格重写。

/** 色相 0–360，饱和度 / 明度 0–100。 */
export interface Hsv {
  h: number
  s: number
  v: number
}

/**
 * 默认色板：6 列 × 5 行，排法参照 GoodNotes 的预设色（第一行黑白灰，之后按「鲜艳 / 深 / 浅 / 补充」各一行，列按色相）。
 * 这是笔迹颜色，与界面主题无关，所以是常量而不是 CSS token。
 */
export const COLOR_PICKER_PALETTE: readonly string[] = [
  '#000000', '#4a4a4a', '#808080', '#b4b4b4', '#dcdcdc', '#ffffff',
  '#e5372f', '#f68c1e', '#f8d23a', '#3eae49', '#2f80ed', '#8e44c9',
  '#a3201c', '#c25b0c', '#c79a0a', '#1f7a35', '#1a4fa8', '#5b2a8c',
  '#f4a1a0', '#fbc48c', '#fbe9a0', '#a8dcae', '#9cc4f6', '#cfaee8',
  '#ec6ba5', '#8b5a3c', '#22a39f', '#2fb8d6', '#3f4fb8', '#a6c23a',
]

/** 色板默认列数。 */
export const COLOR_PICKER_COLUMNS = 6

const HEX6 = /^#?([\da-f]{6})$/i
const HEX3 = /^#?([\da-f]{3})$/i

/** 把 '#abc' / 'abc' / '#AABBCC' / 'aabbcc' 规整成 '#aabbcc'；不认识返回 null。 */
export function normalizeHex(input: string): string | null {
  const text = input.trim()
  const six = HEX6.exec(text)
  if (six) return `#${six[1]!.toLowerCase()}`
  const three = HEX3.exec(text)
  if (three) {
    const [r, g, b] = three[1]!.toLowerCase()
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function hexToRgb(hex: string): [number, number, number] {
  const normalized = normalizeHex(hex) ?? '#000000'
  const n = Number.parseInt(normalized.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, '0')).join('')}`
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const sat = clamp(s, 0, 100) / 100
  const val = clamp(v, 0, 100) / 100
  const hue = (((h % 360) + 360) % 360) / 60
  const f = (n: number) => {
    const k = (n + hue) % 6
    return val - val * sat * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return rgbToHex(f(5) * 255, f(3) * 255, f(1) * 255)
}

/** fallbackHue：灰色（饱和度 0）没有色相，沿用调用方当前的色相，滑条不会跳回红色。 */
export function hexToHsv(hex: string, fallbackHue = 0): Hsv {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = fallbackHue
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 }
}

/** 相对亮度（WCAG），选中标记 / 描边据此选深浅。 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
