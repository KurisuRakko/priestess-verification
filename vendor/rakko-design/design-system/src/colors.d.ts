export type RakkoColorName =
  | 'accent'
  | 'neutral1'
  | 'neutral2'
  | 'neutral3'
  | 'neutral4'
  | 'neutral5'
  | 'neutral6'
  | 'neutral7'
  | 'neutral8'
  | 'neutral9'
  | 'neutral10'
  | 'paper'
  | 'border'
  | 'info'
  | 'success'
  | 'warning'
  | 'error'

export type RakkoColorScheme = Readonly<Record<RakkoColorName, string>>

export declare const rakkoColors: {
  readonly light: RakkoColorScheme
  readonly dark: RakkoColorScheme
}
