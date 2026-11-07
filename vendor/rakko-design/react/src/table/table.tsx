import { Children, createContext, isValidElement, useContext, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentProps, ReactElement, ReactNode } from 'react'
import { cx } from '../cx'
import { useMergedRefs } from '../merge-refs'

export type TableAlign = 'start' | 'center' | 'end'
export type TableDensity = 'comfortable' | 'compact'
export type TableLayout = 'scroll' | 'stack'

type TableSection = 'header' | 'body' | 'footer'

interface TableContextValue {
  /** stack 布局且容器窄于 stackBelow：行渲染成卡片，单元格补 ARIA 角色、显示 label。 */
  stacked: boolean
  /** 列数：量自表格里非分组行的单元格 colSpan 之和的最大值，GroupRow 默认跨满它。 */
  columns: number
}

const TableContext = createContext<TableContextValue>({ stacked: false, columns: 1 })
const SectionContext = createContext<TableSection>('body')

/** 分组标题行的标记属性：量列数时跳过它（它自己就是跨满全部列的那一格）。 */
const GROUP_ROW_ATTR = 'data-rk-table-group'

export interface TableRootProps extends Omit<ComponentProps<'table'>, 'children'> {
  /** 表格标题，渲染为 <caption>，同时是表格的可访问名称；没有可见标题时改传 aria-label。 */
  caption?: ReactNode
  /** caption 只给读屏，视觉隐藏。 */
  captionHidden?: boolean
  /** 行高与内边距：comfortable 单元格 12px × 16px，compact 6px × 12px。@default 'comfortable' */
  density?: TableDensity
  /**
   * scroll：始终是表格，列放不下时在外层容器里横向滚动；
   * stack：容器宽度小于 stackBelow 时每行变成一张「字段名 — 值」卡片。@default 'scroll'
   */
  layout?: TableLayout
  /** stack 生效的容器宽度阈值（px，不含）。只在 layout="stack" 时有意义。@default 560 */
  stackBelow?: number
  children: ReactNode
}

/** 列数：所有非分组行里单元格 colSpan 之和的最大值，至少 1。 */
function countColumns(table: HTMLTableElement): number {
  let max = 0
  for (const row of Array.from(table.rows)) {
    if (row.hasAttribute(GROUP_ROW_ATTR)) continue
    let sum = 0
    for (const cell of Array.from(row.cells)) sum += cell.colSpan || 1
    if (sum > max) max = sum
  }
  return Math.max(max, 1)
}

/**
 * 首帧的列数估计：Root 的直接子元素里有 Table.Header > Table.Row > 单元格时，按 JSX 静态数出 colSpan 之和；
 * 表头包在自定义组件里、单元格由组件生成等数不出来的情况返回 1，由挂载后的 DOM 测量纠正。
 * 只为避免首帧（含服务端渲染）GroupRow 先跨 1 列再跳满的闪烁。
 */
function staticColumns(children: ReactNode): number {
  let max = 0
  for (const section of Children.toArray(children)) {
    if (!isValidElement(section) || section.type !== TableHeader) continue
    for (const row of Children.toArray((section as ReactElement<TableSectionProps>).props.children)) {
      if (!isValidElement(row) || row.type !== TableRow) continue
      let sum = 0
      for (const cell of Children.toArray((row as ReactElement<TableRowProps>).props.children)) {
        if (!isValidElement(cell) || (cell.type !== TableHeaderCell && cell.type !== TableCell)) continue
        sum += (cell as ReactElement<{ colSpan?: number }>).props.colSpan || 1
      }
      if (sum > max) max = sum
    }
  }
  return Math.max(max, 1)
}

/**
 * 表格根：外层 div.rk-table 是横向滚动容器（页面本身不溢出），里面是语义化 <table>。
 * className / style 落在外层容器上（尺寸、外边距这类布局属性）；ref、aria-*、id 等其余属性落在 <table> 上。
 * 外层容器在内容横向溢出时才变成可聚焦的 region（键盘可滚动），不溢出时不多一个 Tab 停靠点。
 */
function TableRoot({
  caption,
  captionHidden = false,
  density = 'comfortable',
  layout = 'scroll',
  stackBelow = 560,
  className,
  style,
  ref,
  children,
  ...props
}: TableRootProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const captionId = useId()
  const [width, setWidth] = useState(0)
  const [columns, setColumns] = useState(() => staticColumns(children))
  const [overflowing, setOverflowing] = useState(false)

  // Root 每次渲染后重量溢出；结果没变时 setState 不触发更新。
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    setOverflowing(wrapper.scrollWidth > wrapper.clientWidth)
  })

  // 列数：挂载时量一次，之后由 MutationObserver 跟踪表格内行 / 单元格的增删与 colspan 变化。
  // 不依赖 Root 重渲染：表头或行放在自带 state / memo 的子组件里、只有子组件重渲染时，GroupRow 也会跟着更新。
  // GroupRow 自己的 colspan 变化也会触发回调，但它不参与计数，结果不变，不会循环。
  useLayoutEffect(() => {
    const table = tableRef.current
    if (!table) return
    const update = () => setColumns(countColumns(table))
    update()
    if (typeof MutationObserver !== 'function') return
    const observer = new MutationObserver(update)
    observer.observe(table, { subtree: true, childList: true, attributes: true, attributeFilter: ['colspan'] })
    return () => observer.disconnect()
  }, [])

  // 容器宽度：首次用 clientWidth 估算，之后跟 ResizeObserver。宽度为 0（未布局 / display: none）按未知处理，不切 stack。
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    const table = tableRef.current
    if (!wrapper || !table) return
    const update = () => {
      setWidth(wrapper.clientWidth)
      setOverflowing(wrapper.scrollWidth > wrapper.clientWidth)
    }
    update()
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(update)
    observer.observe(wrapper)
    // 表格自身变宽（列内容变长）时容器尺寸不变，单独观察它才能及时更新溢出状态。
    observer.observe(table)
    return () => observer.disconnect()
  }, [])

  const stacked = layout === 'stack' && width > 0 && width < stackBelow
  const ariaLabel = props['aria-label']
  const ariaLabelledBy = props['aria-labelledby'] ?? (caption != null ? captionId : undefined)
  // 溢出时外层是可聚焦的滚动区域：有名称才给 region 角色（无名 region 对读屏无意义）。
  const regionNamed = ariaLabel != null || ariaLabelledBy != null

  return (
    <div
      ref={wrapperRef}
      className={cx('rk-table', className)}
      style={style}
      data-layout={layout}
      data-density={density}
      data-stacked={stacked ? '' : undefined}
      data-overflowing={overflowing ? '' : undefined}
      tabIndex={overflowing ? 0 : undefined}
      role={overflowing && regionNamed ? 'region' : undefined}
      aria-label={overflowing ? ariaLabel : undefined}
      aria-labelledby={overflowing && ariaLabel == null ? ariaLabelledBy : undefined}
    >
      <table
        {...props}
        ref={useMergedRefs(tableRef, ref)}
        className="rk-table__table"
        role={stacked ? 'table' : undefined}
      >
        {caption != null ? (
          <caption
            id={captionId}
            className="rk-table__caption"
            data-hidden={captionHidden ? '' : undefined}
          >
            {caption}
          </caption>
        ) : null}
        <TableContext.Provider value={{ stacked, columns }}>{children}</TableContext.Provider>
      </table>
    </div>
  )
}

export type TableSectionProps = ComponentProps<'tbody'>

/** thead / tbody / tfoot：stack 布局下 display 改成 block，显式补 rowgroup 角色保住表格语义。 */
function useSectionRole() {
  return useContext(TableContext).stacked ? 'rowgroup' : undefined
}

function TableHeader({ className, ...props }: TableSectionProps) {
  return (
    <SectionContext.Provider value="header">
      <thead role={useSectionRole()} {...props} className={cx('rk-table__header', className)} />
    </SectionContext.Provider>
  )
}

function TableBody({ className, ...props }: TableSectionProps) {
  return (
    <SectionContext.Provider value="body">
      <tbody role={useSectionRole()} {...props} className={cx('rk-table__body', className)} />
    </SectionContext.Provider>
  )
}

function TableFooter({ className, ...props }: TableSectionProps) {
  return (
    <SectionContext.Provider value="footer">
      <tfoot role={useSectionRole()} {...props} className={cx('rk-table__footer', className)} />
    </SectionContext.Provider>
  )
}

export type TableRowProps = ComponentProps<'tr'>

/** 普通行：默认不可点、无悬停高亮；需要操作时把 Button 放进单元格。 */
function TableRow({ className, ...props }: TableRowProps) {
  const { stacked } = useContext(TableContext)
  return <tr role={stacked ? 'row' : undefined} {...props} className={cx('rk-table__row', className)} />
}

export interface TableHeaderCellProps extends Omit<ComponentProps<'th'>, 'align'> {
  /** 水平对齐；numeric 时默认 end。 */
  align?: TableAlign
  /** 数字列：等宽数字（tabular-nums），默认右对齐。表头与该列单元格都要传，才能对齐到同一条边。 */
  numeric?: boolean
}

/**
 * 表头单元格：在 Header 里是列标题（scope="col"），在 Body / Footer 里是行标题（scope="row"）。
 * stack 布局下 Header 视觉隐藏（读屏仍可读到），Body 里的行标题成为卡片标题。
 */
function TableHeaderCell({ align, numeric = false, className, ...props }: TableHeaderCellProps) {
  const { stacked } = useContext(TableContext)
  const section = useContext(SectionContext)
  const inHeader = section === 'header'
  return (
    <th
      scope={inHeader ? 'col' : 'row'}
      role={stacked ? (inHeader ? 'columnheader' : 'rowheader') : undefined}
      {...props}
      className={cx('rk-table__header-cell', className)}
      data-align={align ?? (numeric ? 'end' : undefined)}
      data-numeric={numeric ? '' : undefined}
    />
  )
}

export interface TableCellProps extends Omit<ComponentProps<'td'>, 'align'> {
  /** stack 布局时显示在值前面的字段名（通常与该列表头同文）；scroll 布局不显示。对读屏隐藏，列关系由表头提供。 */
  label?: ReactNode
  /** 水平对齐；numeric 时默认 end。stack 布局下有 label 的单元格值一律靠行尾。 */
  align?: TableAlign
  /** 数字：等宽数字（tabular-nums），默认右对齐。 */
  numeric?: boolean
}

function TableCell({ label, align, numeric = false, className, children, ...props }: TableCellProps) {
  const { stacked } = useContext(TableContext)
  const labelled = stacked && label != null
  return (
    <td
      role={stacked ? 'cell' : undefined}
      {...props}
      className={cx('rk-table__cell', className)}
      data-align={align ?? (numeric ? 'end' : undefined)}
      data-numeric={numeric ? '' : undefined}
      data-labelled={labelled ? '' : undefined}
    >
      {labelled ? (
        <>
          <span className="rk-table__label" aria-hidden="true">
            {label}
          </span>
          <span className="rk-table__value">{children}</span>
        </>
      ) : (
        children
      )}
    </td>
  )
}

export interface TableGroupRowProps extends Omit<ComponentProps<'tr'>, 'children'> {
  /** 分组标题文字。 */
  children: ReactNode
  /** 跨列数；默认自动跨满所有列（按表格实际列数）。 */
  colSpan?: number
}

/**
 * 跨满所有列的分组标题行：<tr><th scope="rowgroup" colSpan=列数>。
 * 读屏要把标题关联到组内单元格时，每组放进单独的 Table.Body。
 */
function TableGroupRow({ colSpan, className, children, ...props }: TableGroupRowProps) {
  const { stacked, columns } = useContext(TableContext)
  return (
    <tr
      role={stacked ? 'row' : undefined}
      {...props}
      {...{ [GROUP_ROW_ATTR]: '' }}
      className={cx('rk-table__group-row', className)}
    >
      <th
        scope="rowgroup"
        role={stacked ? 'rowheader' : undefined}
        colSpan={colSpan ?? columns}
        className="rk-table__group-cell"
      >
        {children}
      </th>
    </tr>
  )
}

export const Table = {
  Root: TableRoot,
  Header: TableHeader,
  Body: TableBody,
  Footer: TableFooter,
  Row: TableRow,
  HeaderCell: TableHeaderCell,
  Cell: TableCell,
  GroupRow: TableGroupRow,
}
