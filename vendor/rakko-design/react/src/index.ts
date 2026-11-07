// @rakko/react 公共入口：Base UI 行为 + Rakko 视觉的 React primitives。
export { Button, IconButton } from './button/button.js'
export type {
  ButtonProps,
  ButtonVariant,
  IconButtonProps,
  IconButtonVariant,
} from './button/button.js'
export { Tooltip } from './tooltip/tooltip.js'
export type {
  TooltipPopupProps,
  TooltipProviderProps,
} from './tooltip/tooltip.js'
export { Switch } from './switch/switch.js'
export type { SwitchRootProps, SwitchThumbProps } from './switch/switch.js'
export { Slider } from './slider/slider.js'
export type { SliderProps } from './slider/slider.js'
export { Tabs } from './tabs/tabs.js'
export type {
  TabsIndicatorProps,
  TabsListProps,
  TabsPanelProps,
  TabsTabProps,
} from './tabs/tabs.js'
export { Dialog } from './dialog/dialog.js'
export type {
  DialogCloseProps,
  DialogDescriptionProps,
  DialogPopupProps,
  DialogTitleProps,
} from './dialog/dialog.js'
export { Menu } from './menu/menu.js'
export type {
  MenuGroupLabelProps,
  MenuGroupProps,
  MenuItemProps,
  MenuPopupProps,
  MenuSeparatorProps,
  MenuSubmenuPopupProps,
  MenuSubmenuTriggerProps,
} from './menu/menu.js'
export { ContextMenu } from './context-menu/context-menu.js'
export type { ContextMenuPopupProps } from './context-menu/context-menu.js'
export { FilterChip } from './filter-chip/filter-chip.js'
export type { FilterChipProps } from './filter-chip/filter-chip.js'
export { Badge } from './badge/badge.js'
export type { BadgeProps, BadgeSize, BadgeTone } from './badge/badge.js'
export { SegmentedChoice } from './segmented-choice/segmented-choice.js'
export type {
  SegmentedChoiceItemProps,
  SegmentedChoiceRootProps,
} from './segmented-choice/segmented-choice.js'
export { Checkbox } from './checkbox/checkbox.js'
export type {
  CheckboxIndicatorProps,
  CheckboxRootProps,
} from './checkbox/checkbox.js'
export { Select } from './select/select.js'
export type {
  SelectGroupLabelProps,
  SelectIconProps,
  SelectItemIndicatorProps,
  SelectItemProps,
  SelectItemTextProps,
  SelectPopupProps,
  SelectSeparatorProps,
  SelectTriggerProps,
  SelectValueProps,
} from './select/select.js'
export { Popover } from './popover/popover.js'
export type {
  PopoverCloseProps,
  PopoverDescriptionProps,
  PopoverPopupProps,
  PopoverTitleProps,
} from './popover/popover.js'
export { Progress } from './progress/progress.js'
export type {
  ProgressIndicatorProps,
  ProgressLabelProps,
  ProgressRootProps,
  ProgressTrackProps,
  ProgressValueProps,
} from './progress/progress.js'
export { ProgressRing } from './progress-ring/progress-ring.js'
export type { ProgressRingProps } from './progress-ring/progress-ring.js'
export { BAR_CHART_TONE_COLOR, BarChart } from './bar-chart/bar-chart.js'
export type {
  BarChartDatum,
  BarChartExtraItem,
  BarChartProps,
  BarChartSeries,
  BarChartTone,
} from './bar-chart/bar-chart.js'
export { Snackbar, useSnackbar } from './snackbar/snackbar.js'
export type {
  SnackbarActionProps,
  SnackbarCloseProps,
  SnackbarProviderProps,
  SnackbarRootProps,
  SnackbarTitleProps,
  SnackbarViewportProps,
} from './snackbar/snackbar.js'
export { Field } from './field/field.js'
export type {
  FieldControlProps,
  FieldDescriptionProps,
  FieldErrorProps,
  FieldLabelProps,
  FieldRootProps,
} from './field/field.js'
export { CopyButton } from './copy-button/copy-button.js'
export type { CopyButtonProps } from './copy-button/copy-button.js'
export { Sheet } from './sheet/sheet.js'
export type {
  SheetCloseProps,
  SheetDescriptionProps,
  SheetHandleProps,
  SheetPopupProps,
  SheetRootProps,
  SheetTitleProps,
} from './sheet/sheet.js'
export { TopBar } from './top-bar/top-bar.js'
export type {
  TopBarActionsProps,
  TopBarReveal,
  TopBarRootProps,
  TopBarTitleProps,
} from './top-bar/top-bar.js'
export { NavigationBar, NAVIGATION_BAR_HEIGHT } from './navigation-bar/navigation-bar.js'
export type {
  NavigationBarBackProps,
  NavigationBarProps,
  NavigationBarTitleDisplay,
} from './navigation-bar/navigation-bar.js'
export { BottomToolbar, BOTTOM_TOOLBAR_HEIGHT } from './bottom-toolbar/bottom-toolbar.js'
export type { BottomToolbarProps } from './bottom-toolbar/bottom-toolbar.js'
export { BottomNav } from './bottom-nav/bottom-nav.js'
export type {
  BottomNavItemProps,
  BottomNavRootProps,
} from './bottom-nav/bottom-nav.js'
export { SideNav } from './side-nav/side-nav.js'
export type {
  SideNavItemProps,
  SideNavProviderProps,
  SideNavRootProps,
  SideNavToggleLabels,
  SideNavToggleProps,
} from './side-nav/side-nav.js'
export { List } from './list/list.js'
export type { ListGroupProps, ListRowProps } from './list/list.js'
export { Table } from './table/table.js'
export type {
  TableAlign,
  TableCellProps,
  TableDensity,
  TableGroupRowProps,
  TableHeaderCellProps,
  TableLayout,
  TableRootProps,
  TableRowProps,
  TableSectionProps,
} from './table/table.js'
export { SwipeRow, closeSwipeRows, SWIPE_ACTION_WIDTH } from './swipe-row/swipe-row.js'
export type {
  SwipeAction,
  SwipeActionTone,
  SwipeRowProps,
} from './swipe-row/swipe-row.js'
export { SearchField } from './search-field/search-field.js'
export type { SearchFieldProps } from './search-field/search-field.js'
export { Avatar, avatarInitial } from './avatar/avatar.js'
export type { AvatarProps, AvatarSize } from './avatar/avatar.js'
export { Skeleton } from './skeleton/skeleton.js'
export type { SkeletonProps, SkeletonVariant } from './skeleton/skeleton.js'
export {
  dismissKeyboard,
  installViewportTracking,
  useKeyboardInset,
} from './viewport/viewport.js'
export { NavigationStack } from './navigation-stack/navigation-stack.js'
export type { NavigationStackProps } from './navigation-stack/navigation-stack.js'
export { createMemoryNavigation } from './navigation-stack/memory.js'
export type {
  MemoryNavigation,
  MemoryNavigationOptions,
} from './navigation-stack/memory.js'
export {
  createBrowserNavigation,
  NAV_POP_TIMEOUT_MS,
} from './navigation-stack/browser.js'
export type {
  BrowserNavigation,
  BrowserNavigationOptions,
  LinkProps,
  NavigateOptions,
} from './navigation-stack/browser.js'
export { NAV_READY_TIMEOUT_MS } from './navigation-stack/engine.js'
export type { NavigationEntry } from './navigation-stack/engine.js'
export {
  useNavigationLayer,
  useNavigationReady,
} from './navigation-stack/layers.js'
export type {
  NavigationLayer,
  NavigationLayerState,
} from './navigation-stack/layers.js'
export type { NavigationDirection } from './navigation-stack/transition.js'
export { NAV_WATCHDOG_MARGIN_MS } from './navigation-stack/transition.js'
export {
  NAV_COMPLETE_VELOCITY,
  NAV_DECIDE_DISTANCE,
  NAV_EDGE_WIDTH,
  NAV_PROJECTION_MS,
  NAV_VELOCITY_WINDOW_MS,
} from './navigation-stack/gesture.js'
export type { EdgeSwipeBackMode } from './navigation-stack/gesture.js'
export { pushOverlayEntry } from './navigation-stack/overlay-entry.js'
export type { OverlayEntryRelease } from './navigation-stack/overlay-entry.js'
export { useSlotCrossfade } from './slot-crossfade/slot-crossfade.js'
export { AnimatedList } from './animated-list/animated-list.js'
export type { AnimatedListProps } from './animated-list/animated-list.js'
export { flipLayoutKey } from './animated-list/flip-layout.js'
// FLIP 的 WAAPI 动画 id：消费方自己的行组件（同 SwipeRow）开始收拢时要停掉 AnimatedList 的出现动画，不必写死字符串
export { FLIP_APPEAR_ID, FLIP_FADE_ID, FLIP_MOVE_ID, cancelFlipAppear } from './animated-list/flip-ids.js'
export type { FlipLayoutGroup } from './animated-list/flip-layout.js'
export { SortableList, SORTABLE_LIST_LABELS } from './sortable-list/sortable-list.js'
export type {
  SortableListGroup,
  SortableListLabels,
  SortableListProps,
  SortableMove,
  SortableTransferTone,
} from './sortable-list/sortable-list.js'
export { ColorPicker, COLOR_PICKER_LABELS } from './color-picker/color-picker.js'
export type { ColorPickerLabels, ColorPickerProps, ColorPickerTab } from './color-picker/color-picker.js'
export {
  COLOR_PICKER_COLUMNS,
  COLOR_PICKER_PALETTE,
  hexToHsv,
  hsvToHex,
  normalizeHex,
} from './color-picker/color.js'
export type { Hsv } from './color-picker/color.js'
export { LiftMenu, useContextAction } from './lift-menu/lift-menu.js'
// 全屏浮层 / 拖柄挡住底层滚动与捏合，代替 touch-action: none（WebKit 卸载后残留会锁死平移）
export { blockTouchScroll } from './touch-block.js'
export type {
  LiftMenuAnchor,
  LiftMenuHandle,
  LiftMenuItemProps,
  LiftMenuProps,
  LiftMenuSubmenuPopupProps,
  LiftMenuSubmenuTriggerProps,
  LiftVariant,
} from './lift-menu/lift-menu.js'
export { PageScrollbar } from './page-scrollbar/page-scrollbar.js'
export type { PageScrollbarProps } from './page-scrollbar/page-scrollbar.js'
export { useRippleFeedback } from './use-ripple-feedback.js'
export {
  MOTION,
  SNACKBAR_TIMEOUT_MS,
  COPY_FEEDBACK_MS,
} from './motion.js'
export {
  THEME_STORAGE_KEY,
  installTheme,
  setTheme,
  themeBootScript,
  useTheme,
} from './theme/theme.js'
export type {
  ResolvedTheme,
  ThemePreference,
  ThemeState,
  UseThemeResult,
} from './theme/theme.js'
export { NumberRoll } from './number-roll/number-roll.js'
export type { NumberRollProps } from './number-roll/number-roll.js'
export { MorphSheet } from './morph-sheet/morph-sheet.js'
export type { MorphSheetProps } from './morph-sheet/morph-sheet.js'
export { installPressFeedback } from './press/press.js'
export { usePressFeedback } from './press/use-press-feedback.js'
export {
  SPRINGS,
  SpringValue,
  prefersReducedMotion,
  projectMomentum,
  rubberBand,
  pageSpringEasing,
  springCurve,
  springEasing,
} from './spring.js'
export type {
  SpringCurveOptions,
  SpringEasing,
  SpringName,
  SpringSpec,
} from './spring.js'
export { SwapText, useSwapPresence, useSwapText } from './swap-text/swap-text.js'
export type { SwapTextMode, SwapTextProps } from './swap-text/swap-text.js'
export { RemovalCountContext, useRemoval, useRemovalCount } from './swap-text/use-removal.js'
export type { Removal } from './swap-text/use-removal.js'
export { EmptyState } from './empty-state/empty-state.js'
export type { EmptyStateProps } from './empty-state/empty-state.js'
export { Collapsible } from './collapsible/collapsible.js'
export type {
  CollapsibleContentProps,
  CollapsibleRootProps,
  CollapsibleTriggerProps,
} from './collapsible/collapsible.js'
export { SELECTION_SLIDE_SELECTOR, useSelectionSlide } from './selection-slide/selection-slide.js'
export type { SelectionSlideOptions } from './selection-slide/selection-slide.js'
export { SMOOTH_SCROLL_SPRING, smoothScrollTo } from './smooth-scroll/smooth-scroll.js'
export type { SmoothScrollHandle, SmoothScrollOptions } from './smooth-scroll/smooth-scroll.js'
export {
  overflowIds,
  sameIds,
  toolbarWidth,
  useToolbarOverflow,
} from './toolbar-overflow/toolbar-overflow.js'
export type {
  ToolbarGaps,
  ToolbarItem,
  ToolbarLayout,
  ToolbarSegment,
} from './toolbar-overflow/toolbar-overflow.js'
