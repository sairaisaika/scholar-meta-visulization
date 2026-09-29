/**
 * 研究脚手架的**图种注册表 + 可用性判据**。
 * ─────────────────────────────────────────────────────────────────────────────
 * 「这张表就是产品本身」：**画不了的图不藏起来，列在菜单里灰着，并写明差哪个字段**。
 * 纯函数、零 IO 零 React。判据只看数据的**形状**（互斥吗、有几个桶、有没有交叉表 / 重叠计数），不看数值大小。
 *
 * 与 ladder.ts 的分工：那边回答「这批**记录**能诚实画到证据阶梯哪一级」（森林图要效应量…）；
 * 这边回答「这组**格子**能画哪些图」。森林 / 信天翁 / 收获 / 阳性率四张是**记录级**的图：
 *   · 只给格子（外部计数）时它们恒灰，写明差什么——外部四源实测都不带方向、精确 p、效应量；
 *   · 同时给了记录（`records`，比如站内文章申报了效应量）时，按**阶梯同一套判据**决定能不能画（0.2.0 起）——
 *     森林图与阶梯的 forest 级同判、信天翁与 albatross 级同判、收获图与 direction 级同判，两边不会说出矛盾的话。
 * 判据写在**形状**（`ChartShape`）上，与维度无关：接入方自己的维度按 `chartAvailabilityFor(shape)` 判，不必冒充已有维度。
 * `needs_more_onsite` 两个来源：格子来自站内文章且篇数不到引擎的比例门槛（只挡读占比的四张）；接入方自己的样本门 `sampleOk: false`（挡主题图与清单以外的全部）。
 * 两种都排在形状上的原因之后。
 */
import type {
  EvidenceChartAvailability, EvidenceChartBlocker, EvidenceChartKind, EvidenceCountSeries, EvidenceDimensionId,
  EvidenceOverlap, EvidenceRecord, EvidenceViewKind, OnsiteDimensionId,
} from './types'
import { EVIDENCE_CHART_KINDS } from './types'
import { EGM_PAIR } from './dimensions'
import { EVIDENCE_VIEWS } from './ladder'
import { MIN_N_FOR_SHARE } from './stats'

/** 判据要看的那点形状（服务端装配时与前端都能构出来）。 */
export interface ChartContext {
  dimension: EvidenceDimensionId | OnsiteDimensionId
  series: EvidenceCountSeries<string> | undefined
  overlap: EvidenceOverlap<string> | null
  /** 有没有 EGM 那张交叉表 */
  hasCross: boolean
  /** 这张交叉表是哪两维（缺省＝外部的 机构部门 × 年份；站内层是 标签 × 研究设计） */
  egmPair?: { rows: string; cols: string }
  /** 记录级的四张图要看的记录（缺省＝只有格子，四张恒灰） */
  records?: readonly EvidenceRecord[]
}

/** 洛伦兹 / 树图至少几个桶才有形状；饼图最多几个桶还读得出来。 */
const MIN_BUCKETS_FOR_SHAPE = 5
const MAX_PIE_SLICES = 8
/** 阳性率至少要几篇作者自报了结果类型的文章：与「比例能不能印」同一个门槛（stats.ts，NCHS 2017 改编）。 */
export const MIN_CLAIMS_FOR_POSITIVE_RATE = MIN_N_FOR_SHARE

/**
 * 判据真正看的**形状**，与维度无关：接入方自己的维度（比如站内的「研究类型」）只要说清形状，就能用同一套判据，
 * 不必冒充某个已有维度。`chartAvailability(ctx)` 就是 `chartAvailabilityFor(chartShapeOf(ctx))`。
 */
export interface ChartShape {
  /** 桶是不是互斥划分（一篇只进一个桶，桶和＝分母） */
  partition: boolean
  /** 有值（计数 > 0）的桶数 */
  buckets: number
  /** 这一维是年份（时间序列只对年份画） */
  isYear: boolean
  /** 这一维在一张交叉表里（证据与缺口图） */
  hasCross: boolean
  /** 有这一维自己的重叠计数（UpSet） */
  hasOverlap: boolean
  /**
   * 接入方自己的样本门（比如「作者自报结果类型不到 N 篇不画」这类产品规则）：给了 `false` ⇒ 除主题图与清单外，
   * 形状上能画的图一律回 `needs_more_onsite`（形状上本来就画不了的，照报形状上的原因）。门槛由接入方定。
   */
  sampleOk?: boolean | undefined
  /** 格子是站内文章数出来的：给篇数（这一维的分母）。少于引擎的比例门槛时，读占比的四张图（饼、华夫、树图、洛伦兹）回 `needs_more_onsite` */
  onsite_n?: number | undefined
  /** 记录级四张图要看的记录；不给＝只有格子，四张恒灰 */
  records?: readonly EvidenceRecord[] | undefined
}

/** 站内文章至少几篇，读占比的图才画：与「比例能不能印」同一个门槛（stats.ts，NCHS 2017 改编）。 */
export const MIN_ONSITE_FOR_SHARE_CHARTS = MIN_N_FOR_SHARE

type Rule = (s: ChartShape) => EvidenceChartBlocker | null

/** 记录里满足阶梯某一级要求的条数够不够（与 pickEvidenceView 同一套 accepts / minRecords）。 */
const ladderSupports = (records: readonly EvidenceRecord[] | undefined, kind: EvidenceViewKind): boolean => {
  if (!records) return false
  const spec = EVIDENCE_VIEWS.find((v) => v.kind === kind)
  if (!spec) return false
  return records.filter(spec.accepts).length >= Math.max(1, spec.minRecords)
}
const claimCount = (records: readonly EvidenceRecord[]) =>
  records.filter((r) => r.self_reported_claim === 'significant' || r.self_reported_claim === 'non_significant' || r.self_reported_claim === 'mixed').length

/** 读占比的图：形状先过关，再看站内篇数够不够（形状上的毛病更根本，先报它）。 */
const shareChart = (s: ChartShape, structural: EvidenceChartBlocker | null): EvidenceChartBlocker | null =>
  structural ?? (s.onsite_n !== undefined && !(s.onsite_n >= MIN_ONSITE_FOR_SHARE_CHARTS) ? 'needs_more_onsite' : null)
/** 主题图与清单不依赖维度，也不受样本门影响 */
const UNGATED: ReadonlySet<EvidenceChartKind> = new Set<EvidenceChartKind>(['nodes', 'list'])

/**
 * 每种图的判据。**加一种图 = 加一行**，不动任何调用方的控制流。
 * 各图种「它答什么 / 不答什么」见 docs/charts.md，这里只留判据。
 */
const EVIDENCE_CHARTS: Record<EvidenceChartKind, Rule> = {
  nodes: () => null,                                          // 主题关系图（缩放阶梯上的球），不依赖维度
  list: () => null,                                           // 下钻：被引最多的 25 篇——示例，不代表全体
  bar: (s) => (s.buckets > 0 ? null : 'too_few_buckets'),
  timeseries: (s) => (s.isYear ? null : 'needs_year'),
  waffle: (s) => shareChart(s, s.partition ? (s.buckets > 0 ? null : 'too_few_buckets') : 'needs_partition'),
  treemap: (s) => shareChart(s, !s.partition ? 'needs_partition' : s.buckets < 3 ? 'too_few_buckets' : null),
  upset: (s) => (s.hasOverlap ? null : 'needs_overlap'),
  lorenz: (s) => shareChart(s, !s.partition ? 'needs_partition' : s.buckets < MIN_BUCKETS_FOR_SHAPE ? 'too_few_buckets' : null),
  egm: (s) => (s.hasCross ? null : 'needs_cross'),
  pie: (s) => shareChart(s, !s.partition ? 'needs_partition' : s.buckets > MAX_PIE_SLICES ? 'too_many_buckets' : s.buckets > 0 ? null : 'too_few_buckets'),
  // 记录级四张：没给记录时恒灰（外部四源实测没有方向 / 精确 p / 效应量）；给了记录按阶梯同一套判据
  positive_rate: (s) => (s.records && claimCount(s.records) >= MIN_CLAIMS_FOR_POSITIVE_RATE ? null : 'needs_onsite_significance'),
  harvest: (s) => (ladderSupports(s.records, 'direction') ? null : 'needs_direction'),
  albatross: (s) => (ladderSupports(s.records, 'albatross') ? null : 'needs_exact_p'),
  forest: (s) => (ladderSupports(s.records, 'forest') ? null : 'needs_effect_size'),
}

/** 维度上下文 → 形状。 */
export function chartShapeOf(c: ChartContext): ChartShape {
  const pair = c.egmPair ?? EGM_PAIR
  const shape: ChartShape = {
    partition: !!c.series?.partition,
    buckets: c.series?.cells.filter((x) => x.count > 0).length ?? 0,
    isYear: c.dimension === 'publication_year',
    hasCross: c.hasCross && (c.dimension === pair.rows || c.dimension === pair.cols),
    hasOverlap: !!c.overlap && c.overlap.dimension === c.dimension,
  }
  if (c.records) shape.records = c.records
  return shape
}

/** 按形状判全部图种的可用性（顺序＝契约里的图种顺序）。 */
export function chartAvailabilityFor(shape: ChartShape): EvidenceChartAvailability[] {
  return EVIDENCE_CHART_KINDS.map((kind) => {
    const structural = EVIDENCE_CHARTS[kind](shape)
    const blocker = structural ?? (shape.sampleOk === false && !UNGATED.has(kind) ? 'needs_more_onsite' : null)
    return { kind, available: blocker === null, blocker }
  })
}

/** 某个维度下全部图种的可用性（顺序＝契约里的图种顺序）。薄包装：`chartAvailabilityFor(chartShapeOf(c))`。 */
export function chartAvailability(c: ChartContext): EvidenceChartAvailability[] {
  return chartAvailabilityFor(chartShapeOf(c))
}

/** 注册表与契约值域同源。 */
export function chartsMatchContract(): boolean {
  return JSON.stringify(Object.keys(EVIDENCE_CHARTS).sort()) === JSON.stringify([...EVIDENCE_CHART_KINDS].sort())
}
