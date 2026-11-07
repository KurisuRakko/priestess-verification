import { Slider as BaseSlider } from '@base-ui/react/slider'
import type { SliderRootProps } from '@base-ui/react/slider'
import { cx } from '../cx.js'

export interface SliderProps
  extends Omit<
    SliderRootProps<number>,
    | 'className'
    | 'children'
    | 'orientation'
    | 'value'
    | 'defaultValue'
    | 'onValueChange'
    | 'onValueCommitted'
  > {
  /** 可访问名称，同时作为可见标签。 */
  label: string
  /** 受控值（单值）。 */
  value?: number
  /** 非受控初始值。 */
  defaultValue?: number
  /** 拖动 / 键盘微调时实时调用。 */
  onValueChange?: (value: number) => void
  /** 一次操作结束（松手、键盘松键）时调用。 */
  onValueCommitted?: (value: number) => void
  /** 当前值的显示文本，同时写进 aria-valuetext；默认 String(value)。 */
  formatValue?: (value: number) => string
  /** 是否在标签行右侧显示当前值。@default true */
  showValue?: boolean
  className?: string
}

/**
 * 单值滑块：Base UI Slider 提供 role="slider" 的原生 range input、方向键 / Home / End /
 * Shift 大步进与指针拖动；这里加 Rakko 的轨道、拇指与 44px 触摸热区。
 * 深浅主题都只走 token：轨道 neutral-3、已选段 accent、拇指纸色 + 边框。
 */
export function Slider({
  label,
  value,
  defaultValue,
  onValueChange,
  onValueCommitted,
  formatValue = String,
  showValue = true,
  className,
  ...props
}: SliderProps) {
  return (
    <BaseSlider.Root
      {...props}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => onValueChange?.(next)}
      onValueCommitted={(next) => onValueCommitted?.(next)}
      className={cx('rk-slider', className)}
    >
      <div className="rk-slider__header">
        <BaseSlider.Label className="rk-slider__label">{label}</BaseSlider.Label>
        {showValue ? (
          <BaseSlider.Value className="rk-slider__value">
            {(_formatted, values) => formatValue(values[0] ?? 0)}
          </BaseSlider.Value>
        ) : null}
      </div>
      <BaseSlider.Control className="rk-slider__control">
        <BaseSlider.Track className="rk-slider__track">
          <BaseSlider.Indicator className="rk-slider__indicator" />
        </BaseSlider.Track>
        <BaseSlider.Thumb
          className="rk-slider__thumb"
          getAriaLabel={() => label}
          getAriaValueText={(_formatted, next) => formatValue(next)}
        />
      </BaseSlider.Control>
    </BaseSlider.Root>
  )
}
