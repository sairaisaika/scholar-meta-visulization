/**
 * 阶梯各级的图（SVG）。颜色全走 CSS 变量（明暗两套），标记细、网格淡、每个标记可悬停与键盘聚焦，旁边都有表格可看原始数。
 * 只画引擎允许画的东西：没有方差不画区间、不允许汇总不画菱形、只有自报显著性时不画任何显著与不显著的对比。
 */
import type { EvidenceDirection, EvidencePooling, EvidenceRecord } from '../../src/types'
import type { EvidenceMessageCatalog } from '../../src/messages'
import { studentTCdf, Z_95 } from '../../src/stats'
import type { DemoText } from './i18n'
import { h, niceTicks, s, scale, withTip } from './dom'

export interface ChartCtx {
  t: DemoText
  m: EvidenceMessageCatalog
  /** 两位小数 */
  num: (x: number) => string
  /** 图的实际显示宽度（CSS 像素）：按这个宽度排版，一比一显示，手机上字不会被缩小 */
  width: number
}

/** 排版参数：宽屏留一栏写研究名与设计，窄屏只写研究名 */
const layout = (ctx: ChartCtx) => {
  const W = Math.round(Math.max(320, Math.min(760, ctx.width)))
  const wide = W >= 560
  const labelW = wide ? 200 : 88
  return { W, wide, labelW, plotL: labelW + (wide ? 14 : 8), plotR: W - 16 }
}
const design = (ctx: ChartCtx, r: EvidenceRecord) =>
  r.study_type ? (ctx.m.studyDesign as Record<string, string>)[r.study_type] ?? r.study_type : ''

const svgRoot = (W: number, height: number, label: string) =>
  s('svg', { viewBox: `0 0 ${W} ${height}`, width: W, height, role: 'img', 'aria-label': label, class: 'chart' })

/** 效应量横轴：刻度、零线、两侧「偏向谁」 */
function effectAxis(svg: SVGSVGElement, ctx: ChartCtx, x: (v: number) => number, ticks: number[], top: number, axisY: number) {
  svg.append(s('line', { x1: x(0), x2: x(0), y1: top - 8, y2: axisY, class: 'baseline' }))
  svg.append(s('line', { x1: x(ticks[0]), x2: x(ticks[ticks.length - 1]), y1: axisY, y2: axisY, class: 'axis' }))
  for (const v of ticks) {
    svg.append(s('line', { x1: x(v), x2: x(v), y1: axisY, y2: axisY + 4, class: 'axis' }))
    svg.append(s('text', { x: x(v), y: axisY + 17, 'text-anchor': 'middle', class: 'tick' }, [ctx.num(v).replace(/\.?0+$/, '') || '0']))
  }
  svg.append(s('text', { x: x(0) - 8, y: axisY + 36, 'text-anchor': 'end', class: 'note' }, [ctx.t.favoursLeft]))
  svg.append(s('text', { x: x(0) + 8, y: axisY + 36, 'text-anchor': 'start', class: 'note' }, [ctx.t.favoursRight]))
  svg.append(s('text', { x: (x(ticks[0]) + x(ticks[ticks.length - 1])) / 2, y: axisY + 56, 'text-anchor': 'middle', class: 'axis-title' }, [ctx.m.metric.smd]))
}

const ROW_H = 38

function rowLabel(svg: SVGSVGElement, ctx: ChartCtx, r: EvidenceRecord, y: number) {
  const { wide } = layout(ctx)
  svg.append(s('text', { x: 0, y: wide ? y - 2 : y + 4, class: 'row-label' }, [ctx.t.study(r.title)]))
  if (wide) svg.append(s('text', { x: 0, y: y + 13, class: 'row-sub' }, [design(ctx, r)]))
}

function domainFor(ctx: ChartCtx, values: number[]) {
  const { plotL, plotR, wide } = layout(ctx)
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const pad = (hi - lo) * 0.08
  const ticks = niceTicks(lo - pad, hi + pad, wide ? 6 : 4)
  return { ticks, x: scale(ticks[0], ticks[ticks.length - 1], plotL, plotR) }
}

/** 森林图：逐项效应与 95% 置信区间；允许汇总时画菱形与预测区间（方块面积按随机效应权重）。 */
export function forestChart(records: readonly EvidenceRecord[], pooling: EvidencePooling, ctx: ChartCtx): SVGSVGElement {
  const rows = records.filter((r) => r.effect && Number.isFinite(r.effect.value) && r.effect.ci_low != null && r.effect.ci_high != null)
  const est = pooling.allowed ? pooling.estimate ?? null : null
  const values = rows.flatMap((r) => [r.effect!.ci_low!, r.effect!.ci_high!])
  if (est) values.push(est.pi_low, est.pi_high)
  const { W, plotL, plotR } = layout(ctx)
  const { ticks, x } = domainFor(ctx, values)
  const top = 22
  const pooledY = top + rows.length * ROW_H + 14
  const axisY = (est ? pooledY + ROW_H / 2 : top + rows.length * ROW_H) + 4
  const svg = svgRoot(W, axisY + 66, ctx.m.view.forest)

  // 方块面积 ∝ 随机效应权重 1/(se² + τ²)；不汇总时一样大
  const se = (r: EvidenceRecord) => (r.effect!.ci_high! - r.effect!.ci_low!) / (2 * Z_95)
  const weights = rows.map((r) => (est ? 1 / (se(r) ** 2 + est.tau2) : 1))
  const wMax = Math.max(...weights)

  rows.forEach((r, i) => {
    const y = top + i * ROW_H + ROW_H / 2
    const e = r.effect!
    const side = est ? 7 + 9 * Math.sqrt(weights[i] / wMax) : 11
    const g = s('g', { class: 'hit' }, [
      s('rect', { x: 0, y: y - ROW_H / 2, width: layout(ctx).W, height: ROW_H, class: 'hit-area' }),
      s('line', { x1: x(e.ci_low!), x2: x(e.ci_high!), y1: y, y2: y, class: 'ci' }),
      s('rect', { x: x(e.value) - side / 2, y: y - side / 2, width: side, height: side, class: 'mark ring' }),
    ])
    withTip(g, () => ({
      value: ctx.t.interval(ctx.num(e.value), ctx.num(e.ci_low!), ctx.num(e.ci_high!)),
      label: `${ctx.t.study(r.title)} · ${design(ctx, r)} · N = ${e.n ?? '—'}`,
    }))
    svg.append(g)
    rowLabel(svg, ctx, r, y)
  })

  if (est) {
    svg.append(s('line', { x1: plotL, x2: plotR, y1: pooledY - 12, y2: pooledY - 12, class: 'grid' }))
    const y = pooledY + ROW_H / 2 - 6
    const g = s('g', { class: 'hit' }, [
      s('rect', { x: 0, y: y - ROW_H / 2, width: layout(ctx).W, height: ROW_H, class: 'hit-area' }),
      s('line', { x1: x(est.pi_low), x2: x(est.pi_high), y1: y, y2: y, class: 'pi' }),
      s('polygon', {
        points: `${x(est.ci_low)},${y} ${x(est.estimate)},${y - 9} ${x(est.ci_high)},${y} ${x(est.estimate)},${y + 9}`,
        class: 'mark ring',
      }),
    ])
    withTip(g, () => ({
      value: ctx.t.interval(ctx.num(est.estimate), ctx.num(est.ci_low), ctx.num(est.ci_high)),
      label: `${ctx.t.pooledRow} · k = ${est.k} · I² = ${Math.round(est.i2 * 100)}%`,
    }))
    svg.append(g)
    svg.append(s('text', { x: 0, y: y + 4, class: 'row-label strong' }, [ctx.t.pooledRow]))
  }
  effectAxis(svg, ctx, x, ticks, top, axisY)
  return svg
}

/** 分位数（第 7 型，线性插值） */
const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo)
}

/** 点估计图：只有点，没有区间与菱形；标出中位数与四分位距（Cochrane 12.2.1.1）。 */
export function estimatesChart(records: readonly EvidenceRecord[], ctx: ChartCtx): { svg: SVGSVGElement; note: string } {
  const rows = records.filter((r) => r.effect && Number.isFinite(r.effect.value))
  const vals = rows.map((r) => r.effect!.value).sort((a, b) => a - b)
  const med = quantile(vals, 0.5)
  const q1 = quantile(vals, 0.25)
  const q3 = quantile(vals, 0.75)
  const { W } = layout(ctx)
  const { ticks, x } = domainFor(ctx, vals)
  const top = 30
  const axisY = top + rows.length * ROW_H + 4
  const svg = svgRoot(W, axisY + 66, ctx.m.view.estimates)
  svg.append(s('rect', { x: x(q1), y: top - 8, width: Math.max(1, x(q3) - x(q1)), height: axisY - top + 8, class: 'wash' }))
  svg.append(s('line', { x1: x(med), x2: x(med), y1: top - 12, y2: axisY, class: 'median' }))
  svg.append(s('text', { x: x(med), y: top - 16, 'text-anchor': 'middle', class: 'note' }, [ctx.t.median]))
  rows.forEach((r, i) => {
    const y = top + i * ROW_H + ROW_H / 2
    const e = r.effect!
    const g = s('g', { class: 'hit' }, [
      s('rect', { x: 0, y: y - ROW_H / 2, width: layout(ctx).W, height: ROW_H, class: 'hit-area' }),
      s('circle', { cx: x(e.value), cy: y, r: 5, class: 'mark ring' }),
    ])
    withTip(g, () => ({ value: ctx.num(e.value), label: `${ctx.t.study(r.title)} · ${design(ctx, r)} · N = ${e.n ?? '—'}` }))
    svg.append(g)
    rowLabel(svg, ctx, r, y)
  })
  effectAxis(svg, ctx, x, ticks, top, axisY)
  return { svg, note: ctx.t.estimatesNote(ctx.num(med), ctx.num(q1), ctx.num(q3)) }
}

const poleClass = (d: EvidenceDirection | null) => (d === 'favours' ? 'pole-favours' : d === 'against' ? 'pole-against' : 'pole-unclear')

/** 两组比较、两组等大时，SMD 为 d、总样本 N 对应的双侧 p（t = d·√N / 2，自由度 N − 2）。等效应线用它画。 */
const pFor = (d: number, n: number) => 2 * (1 - studentTCdf((d * Math.sqrt(n)) / 2, n - 2))

/**
 * 信天翁图（Harrison et al. 2017）：横轴 p 值（中间 p = 1，往两侧越来越小，左不利、右偏向），纵轴样本量（对数），叠等效应线。
 * 横轴标题较长，放在图下面的 HTML 里（能折行）。
 */
export function albatrossChart(records: readonly EvidenceRecord[], ctx: ChartCtx): HTMLElement {
  const pts = records.filter((r) => r.effect?.p_value && r.effect.n && (r.direction === 'favours' || r.direction === 'against'))
  const { W, wide } = layout(ctx)
  const L = wide ? 70 : 44
  const R = W - (wide ? 30 : 14)
  const T = 34
  const B = wide ? 330 : 280
  const X = 3.2 // −log10(p) 的显示上限（p ≈ 0.0006）
  const x = scale(-X, X, L, R)
  const y = scale(Math.log10(20), Math.log10(1000), B, T)
  const svg = svgRoot(W, B + 26, ctx.m.view.albatross)
  for (const n of [20, 50, 100, 200, 500, 1000]) {
    svg.append(s('line', { x1: L, x2: R, y1: y(Math.log10(n)), y2: y(Math.log10(n)), class: 'grid' }))
    svg.append(s('text', { x: L - 8, y: y(Math.log10(n)) + 4, 'text-anchor': 'end', class: 'tick' }, [String(n)]))
  }
  svg.append(s('text', { x: 0, y: T - 16, 'text-anchor': 'start', class: 'axis-title' }, [ctx.t.nAxis]))
  // 等效应线：d = 0.2 / 0.5 / 0.8，左右对称；只在右侧标名字
  for (const d of [0.2, 0.5, 0.8]) {
    const line: Array<[number, number]> = []
    for (let i = 0; i <= 80; i++) {
      const n = 20 * 50 ** (i / 80)
      const lp = -Math.log10(pFor(d, n))
      if (!Number.isFinite(lp) || lp > X) break
      line.push([lp, n])
    }
    for (const sign of [1, -1]) {
      svg.append(s('polyline', { points: line.map(([lp, n]) => `${x(sign * lp)},${y(Math.log10(n))}`).join(' '), class: 'contour' }))
    }
    // 名字标在线离开绘图区的地方：顶到上沿的标在上沿外面，从右边出去的标在出口下方（不压数据点）
    const [lp, n] = line[line.length - 1]
    const exitsTop = n > 999
    svg.append(s('text', exitsTop
      ? { x: x(lp), y: T - 4, 'text-anchor': 'middle', class: 'note halo' }
      : { x: R - 2, y: y(Math.log10(n)) + 16, 'text-anchor': 'end', class: 'note halo' }, [`d = ${d}`]))
  }
  svg.append(s('line', { x1: x(0), x2: x(0), y1: T, y2: B, class: 'baseline' }))
  svg.append(s('line', { x1: L, x2: R, y1: B, y2: B, class: 'axis' }))
  const pTicks: Array<[number, string]> = wide ? [[0, '1'], [Math.log10(20), '0.05'], [2, '0.01'], [3, '0.001']] : [[0, '1'], [Math.log10(20), '0.05'], [3, '0.001']]
  for (const [lp, label] of pTicks) {
    for (const sign of lp === 0 ? [1] : [-1, 1]) {
      svg.append(s('line', { x1: x(sign * lp), x2: x(sign * lp), y1: B, y2: B + 4, class: 'axis' }))
      svg.append(s('text', { x: x(sign * lp), y: B + 17, 'text-anchor': 'middle', class: 'tick' }, [label]))
    }
  }
  for (const r of pts) {
    const e = r.effect!
    const sign = r.direction === 'favours' ? 1 : -1
    const cx = x(sign * Math.min(X, -Math.log10(e.p_value!)))
    const cy = y(Math.log10(e.n!))
    const g = s('g', { class: 'hit' }, [
      s('circle', { cx, cy, r: 14, class: 'hit-area' }),
      s('circle', { cx, cy, r: 5.5, class: `ring ${poleClass(r.direction)}` }),
    ])
    withTip(g, () => ({
      value: `p = ${e.p_value} · N = ${e.n}`,
      label: `${ctx.t.study(r.title)} · ${ctx.m.direction[r.direction!]} · ${design(ctx, r)}`,
    }))
    svg.append(g)
  }
  return h('div', {}, [svg, h('p', { class: 'axis-caption' }, [ctx.t.pAxis])])
}

/** 设计 → 柱高（收获图用柱高表示研究设计的强弱，Ogilvie et al. 2008） */
const tier = (d: string | null) => (d === 'rct' ? 3 : d === 'non_randomised_controlled' || d === 'cohort' || d === 'case_control' ? 2 : 1)

/**
 * 收获图：按方向分三栏，每项研究一根柱，柱高表示设计。只按方向计数，不按显著性计数。
 * 组名放在图下面的 HTML 里（能折行），与三栏对齐。
 */
export function harvestChart(records: readonly EvidenceRecord[], ctx: ChartCtx): HTMLElement {
  const { W, wide } = layout(ctx)
  const groups: EvidenceDirection[] = ['favours', 'unclear', 'against']
  const by = groups.map((d) => records.filter((r) => r.direction === d))
  const bw = wide ? 22 : 16
  const gap = wide ? 8 : 5
  const groupGap = wide ? 24 : 10
  const unit = 34
  const base = 24 + unit * 3
  // 三栏等宽（至少放得下这一栏的柱子），组名在栏下居中
  const bars = by.map((rs) => Math.max(1, rs.length) * (bw + gap) - gap)
  const even = (W - 16 - groupGap * (groups.length - 1)) / groups.length
  const widths = bars.map((b) => Math.max(b, Math.min(even, 200)))
  const left = (W - (widths.reduce((a, b) => a + b, 0) + groupGap * (groups.length - 1))) / 2
  let cursor = left
  const svg = svgRoot(W, base + 22, ctx.m.view.direction)
  svg.append(s('line', { x1: 8, x2: W - 8, y1: base, y2: base, class: 'axis' }))
  groups.forEach((d, gi) => {
    const start = cursor + (widths[gi] - bars[gi]) / 2
    by[gi].forEach((r, i) => {
      const x0 = start + i * (bw + gap)
      const hgt = unit * tier(r.study_type)
      const top = base - hgt
      const path = `M${x0},${base} L${x0},${top + 4} Q${x0},${top} ${x0 + 4},${top} L${x0 + bw - 4},${top} Q${x0 + bw},${top} ${x0 + bw},${top + 4} L${x0 + bw},${base} Z`
      const g = s('g', { class: 'hit' }, [
        s('rect', { x: x0 - gap / 2, y: 20, width: bw + gap, height: base - 20, class: 'hit-area' }),
        s('path', { d: path, class: poleClass(d) }),
      ])
      withTip(g, () => ({ value: ctx.m.direction[d], label: `${ctx.t.study(r.title)} · ${design(ctx, r)}` }))
      svg.append(g)
      svg.append(s('text', { x: x0 + bw / 2, y: base + 15, 'text-anchor': 'middle', class: 'tick' }, [r.title]))
    })
    cursor += widths[gi] + groupGap
  })
  const cols = [`${Math.max(0, left)}px`, ...widths.flatMap((w, i) => (i === 0 ? [`${w}px`] : [`${groupGap}px`, `${w}px`]))]
  const names = h('div', { class: 'group-names', style: `grid-template-columns: ${cols.join(' ')}` }, [
    h('span', {}),
    ...groups.flatMap((d, gi) => {
      const name = h('span', {}, [ctx.t.counted(ctx.m.direction[d], by[gi].length)])
      return gi === 0 ? [name] : [h('span', {}), name]
    }),
  ])
  return h('div', { class: 'harvest' }, [svg, names])
}

/** 证据与缺口：只数有没有研究、多少、什么设计（单一系列，数值标在柱端）。 */
export function gapChart(records: readonly EvidenceRecord[], ctx: ChartCtx): SVGSVGElement {
  const counts = new Map<string, number>()
  for (const r of records) counts.set(r.study_type ?? 'other', (counts.get(r.study_type ?? 'other') ?? 0) + 1)
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const max = Math.max(...rows.map(([, n]) => n))
  const { W, wide } = layout(ctx)
  const barX = wide ? 200 : 120
  const x = scale(0, max, 0, W - barX - 40)
  const top = 8
  const svg = svgRoot(W, top + rows.length * 34 + 8, ctx.t.countByDesign)
  rows.forEach(([d, n], i) => {
    const y = top + i * 34
    const w = x(n)
    const g = s('g', { class: 'hit' }, [
      s('rect', { x: 0, y, width: W, height: 34, class: 'hit-area' }),
      s('path', { d: `M${barX},${y + 6} L${barX + w - 4},${y + 6} Q${barX + w},${y + 6} ${barX + w},${y + 10} L${barX + w},${y + 24} Q${barX + w},${y + 28} ${barX + w - 4},${y + 28} L${barX},${y + 28} Z`, class: 'mark' }),
    ])
    const label = (ctx.m.studyDesign as Record<string, string>)[d] ?? d
    withTip(g, () => ({ value: String(n), label }))
    svg.append(g)
    svg.append(s('text', { x: 0, y: y + 21, class: 'row-label' }, [label]))
    svg.append(s('text', { x: barX + w + 8, y: y + 21, class: 'value' }, [String(n)]))
  })
  return svg
}

/** 原始记录的表格（每张图的无障碍替身） */
export function recordsTable(records: readonly EvidenceRecord[], ctx: ChartCtx): HTMLTableElement {
  const c = ctx.t.columns
  const dash = '—'
  const head = h('tr', {}, [c.study, c.design, c.direction, c.effect, c.ci, c.p, c.n, c.claim].map((x) => h('th', { scope: 'col' }, [x])))
  const body = records.map((r) => {
    const e = r.effect
    const v = e && Number.isFinite(e.value) ? ctx.num(e.value) : dash
    const ci = e && e.ci_low != null && e.ci_high != null ? `${ctx.num(e.ci_low)} – ${ctx.num(e.ci_high)}` : dash
    return h('tr', {}, [
      h('th', { scope: 'row' }, [ctx.t.study(r.title)]),
      h('td', {}, [design(ctx, r)]),
      h('td', {}, [r.direction ? ctx.m.direction[r.direction] : dash]),
      h('td', { class: 'num' }, [v]),
      h('td', { class: 'num' }, [ci]),
      h('td', { class: 'num' }, [e?.p_value != null ? String(e.p_value) : dash]),
      h('td', { class: 'num' }, [e?.n != null ? String(e.n) : dash]),
      h('td', {}, [r.self_reported_claim ? ctx.m.claim[r.self_reported_claim] : dash]),
    ])
  })
  return h('table', {}, [h('thead', {}, [head]), h('tbody', {}, body)])
}
