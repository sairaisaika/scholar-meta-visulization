/**
 * 消费端——把引擎下发的数据变成「可以直接画」的视图模型（纯函数、零 IO、零框架；浏览器里跑）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么消费端也要在引擎里】诚实规则最容易在最后一公里丢掉：前端拿到格子，顺手用「全部桶的和」当分母、
 * 给 3 篇文章印一个 66.7%、把多标签维画成饼图、忘了印图注。这里把这些规则钉死：
 *   · 百分比**只**用格子声明的分母算，永远不用桶和；
 *   · 每个百分比带 Wilson 95% 区间；分母 < 30 时不给百分比，只给计数（`reliability`）；
 *   · 多标签维标出 `sum_exceeds_denominator`，前端据此禁止 100% 堆叠；
 *   · 图注限定（caveats）、分母口径、缺失数、出处脚注都作为**字段**给出——组件只管排版。
 * 所有文字来自 messages.ts 的词典；宿主可以传自己的词典（`{ messages }`）支持更多语言。
 * 视图模型只含字符串和数字，React / Vue / Svelte / 原生 DOM / Vega-Lite 都能直接吃。
 */
import type {
  EvidenceSampleGate,
  EvidenceSettingGroup, EvidenceSettingIssue, EvidenceSettingKey, EvidenceSettings,
  EvidenceContributionIssue, EvidenceTagChangeRequest, EvidenceWorkTag, EvidenceWorkTagState,
  EvidenceBindingQueueItem, EvidenceBindingSuggestion, EvidenceCaveat, EvidenceChartAvailability, EvidenceChartBlocker, EvidenceChartKind,
  EvidenceCountSeries, EvidenceCountsData, EvidenceDimensionId, EvidenceExternalMatch, EvidenceIntakeIssue, EvidenceMapData,
  EvidenceEffectMetric, EvidenceOnsiteCounts, EvidencePooling, EvidenceProvenance, EvidenceTagBinding, EvidenceTagGraph, EvidenceViewDecision,
  EvidenceViewKind, OnsiteDimensionId, EvidenceCertainty, EvidenceCertaintyLevel, EvidenceRecord, EvidenceRiskOfBias,
  EvidenceScaleLevel, EvidenceVenue,
} from './types'
import { groupTags, normalizeTag } from './tags'
import { robBand, summarizeRiskOfBias } from './appraisal'
import type { EvidenceRobBand } from './appraisal'
import { EVIDENCE_DIMENSIONS } from './dimensions'
import { ONSITE_DIMENSIONS, SMALL_CORPUS } from './onsite'
import { shareReliability, wilsonInterval } from './stats'
import type { Interval, ShareReliability } from './stats'
import { formatMessage, getMessages } from './messages'
import { EVIDENCE_SETTINGS } from './settings'
import type { TagSuggestionView } from './tagging'
import type { BindingBadge, EvidenceMessageCatalog } from './messages'

export interface PresentOptions {
  /** BCP 47 语言标签：决定数字格式、国家 / 语言名（Intl.DisplayNames）与内置词典（zh* → 中文，其余英文） */
  locale?: string
  /** 宿主自己的词典（覆盖内置词典） */
  messages?: EvidenceMessageCatalog
}

interface Ctx {
  locale: string
  m: EvidenceMessageCatalog
  int: (n: number) => string
  pct: (x: number) => string
  num: (x: number) => string
  /** 固定小数位（一句话里的几个数位数一致） */
  fixed: (x: number, decimals: number) => string
}

// Intl 对象构造很贵：按语言与选项缓存（语言来自宿主代码，个数有限；超过上限整个清掉，防止被塞爆）
const INTL_CACHE_MAX = 64
const numberFormats = new Map<string, Intl.NumberFormat>()
/** 没有 Intl 的运行环境（关掉 Intl 的 Hermes 等）用的最小格式化：整数、一位小数的百分比、三位有效数字、固定小数位。 */
const plainFormat = (o: Intl.NumberFormatOptions) => ({
  format: (n: number) => (o.style === 'percent' ? `${(n * 100).toFixed(1).replace(/\.0$/, '')}%`
    : o.maximumSignificantDigits ? String(Number(n.toPrecision(o.maximumSignificantDigits)))
      : o.minimumFractionDigits !== undefined ? n.toFixed(o.minimumFractionDigits) : String(Math.round(n))),
}) as Intl.NumberFormat
const numberFormat = (locale: string, o: Intl.NumberFormatOptions): Intl.NumberFormat => {
  const k = `${locale}|${JSON.stringify(o)}`
  let f = numberFormats.get(k)
  if (!f) {
    if (typeof Intl === 'undefined' || typeof Intl.NumberFormat !== 'function') f = plainFormat(o)
    else { try { f = new Intl.NumberFormat(locale, o) } catch { f = new Intl.NumberFormat('en', o) } }
    if (numberFormats.size >= INTL_CACHE_MAX) numberFormats.clear()
    numberFormats.set(k, f)
  }
  return f
}

/** 负号用真正的减号（U+2212），不用连字符：连字符在区间「a 至 -b」里容易读成破折号，屏幕阅读器也不读成「负」。 */
const minus = (s: string) => s.replace(/-/g, '\u2212')

function context(o: PresentOptions = {}): Ctx {
  const locale = o.locale ?? 'en'
  const int = numberFormat(locale, { maximumFractionDigits: 0 })
  const pct = numberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
  const num = numberFormat(locale, { maximumSignificantDigits: 3 })
  return {
    locale, m: o.messages ?? getMessages(locale), int: (n) => int.format(n), pct: (x) => minus(pct.format(x)), num: (x) => minus(num.format(x)),
    fixed: (x, d) => minus(numberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(x)),
  }
}

/** 这几种量的常规写法至少两位小数（比值、标准化效应量、相关系数、患病率）；原单位的均数差与 other 按区间宽度定，可以少到 0 位。 */
const AT_LEAST_TWO_DECIMALS: ReadonlySet<EvidenceEffectMetric> = new Set(['smd', 'hedges_g', 'cohens_d', 'or', 'rr', 'hr', 'r', 'prevalence'])

/**
 * 一句汇总里点估计与各区间用的小数位：同一句话里位数不齐，读者会把位数差当成精度差（「0.949 至 2.08」）。
 * 按 95% 置信区间的宽度取，让宽度至少显出两位有效数字；比值等量至少 2 位（见上）；最多 4 位。区间不是有限正宽度 ⇒ 2 位。
 */
export function effectDecimals(metric: EvidenceEffectMetric, ciLow: number, ciHigh: number): number {
  const width = ciHigh - ciLow
  const floor = AT_LEAST_TWO_DECIMALS.has(metric) ? 2 : 0
  if (!Number.isFinite(width) || width <= 0) return Math.max(2, floor)
  return Math.min(4, Math.max(floor, 1 - Math.floor(Math.log10(width))))
}

const isoDate = (s: string) => (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s)

const displayNames = new Map<string, Intl.DisplayNames | null>()
function displayName(locale: string, type: 'region' | 'language', code: string): string | null {
  const k = `${locale}|${type}`
  let dn = displayNames.get(k)
  if (dn === undefined) {
    try { dn = new Intl.DisplayNames([locale], { type, fallback: 'none' }) } catch { dn = null }
    if (displayNames.size >= INTL_CACHE_MAX) displayNames.clear()
    displayNames.set(k, dn)
  }
  if (!dn) return null
  try { return dn.of(code) ?? null } catch { return null }
}

export interface CaveatView { key: EvidenceCaveat; text: string }
const caveatViews = (keys: readonly EvidenceCaveat[], c: Ctx): CaveatView[] =>
  [...new Set(keys)].map((key) => ({ key, text: c.m.caveat[key] }))

/** 一条出处脚注。 */
export function formatProvenance(p: EvidenceProvenance, opts: PresentOptions = {}): string {
  const c = context(opts)
  return formatMessage(c.m.text.footnote, { source: p.source_label, license: p.license, date: isoDate(p.retrieved_at) })
}

// ── 格子 ────────────────────────────────────────────────────────────────────

export interface SeriesRowView {
  key: string
  label: string
  count: number
  count_text: string
  /** 占分母的比例；分母 < 30 或分母为 0 时为 null（只印计数） */
  share: number | null
  share_text: string | null
  /** Wilson 95% 区间（与 share 同时有无） */
  ci: Interval | null
  reliability: ShareReliability
  /** 暂定值（最近 1–2 年）：画虚线 / 空心 */
  provisional: boolean
}

export interface SeriesView {
  dimension: string
  /** 第二维（缺口图的列） */
  by: string | null
  layer: 'external' | 'onsite'
  title: string
  partition: boolean
  /** 多标签维：桶和会超过分母 ⇒ 前端**禁止**饼图与 100% 堆叠 */
  sum_exceeds_denominator: boolean
  rows: SeriesRowView[]
  /** 两维交叉（行与 rows 同序），标签已解析；只有计数 */
  cross: Array<Array<{ key: string; label: string; count: number }>> | null
  /** 每一行里没落进任何列的（站内缺口图＝没申报研究设计的） */
  cross_unassigned: number[] | null
  denominator: { kind: string; value: number; text: string }
  unknown_text: string | null
  multi_label_text: string | null
  caveats: CaveatView[]
  footnote: string
  query_text: string
  /** 接入方样本门（站内层给了 `sampleGates` 的维度才有；原样转交，文案由接入方按自己的门写） */
  sample_gate: EvidenceSampleGate | null
}

function bucketLabel(dim: string, key: string, fallback: string, layer: 'external' | 'onsite', c: Ctx): string {
  const m = c.m
  if (dim === 'study_type') return (m.studyDesign as Record<string, string>)[key] ?? fallback
  if (dim === 'self_reported_claim') return (m.claim as Record<string, string>)[key] ?? fallback
  if (layer === 'onsite') {
    if (dim === 'publication_type') return m.bucket.publication_type?.[key] ?? fallback
    return fallback
  }
  const spec = EVIDENCE_DIMENSIONS[dim as EvidenceDimensionId]
  if (!spec) return fallback
  if (spec.labels === 'dict') return m.bucket[spec.id]?.[key] ?? fallback
  if (spec.labels === 'intl-region') return /^[A-Za-z]{2}$/.test(key) ? displayName(c.locale, 'region', key.toUpperCase()) ?? fallback : fallback
  if (spec.labels === 'intl-language') return /^[A-Za-z]{2,3}$/.test(key) ? displayName(c.locale, 'language', key.toLowerCase()) ?? fallback : fallback
  return fallback
}

/** 一组格子 → 可以直接画的行（百分比只用声明的分母）。 */
export function presentSeries(series: EvidenceCountSeries<string>, opts: PresentOptions & { layer?: 'external' | 'onsite' } = {}): SeriesView {
  const c = context(opts)
  const layer = opts.layer ?? (series.provenance.query.startsWith('onsite:') ? 'onsite' : 'external')
  const denom = series.denominator.value
  const rows: SeriesRowView[] = series.cells.map((cell) => {
    const reliability: ShareReliability = denom > 0 && cell.count <= denom ? shareReliability(cell.count, denom) : 'insufficient_n'
    const ci = reliability !== 'insufficient_n' ? wilsonInterval(cell.count, denom) : null
    const share = ci ? cell.count / denom : null
    return {
      key: cell.key,
      label: bucketLabel(series.dimension, cell.key, cell.label, layer, c),
      count: cell.count,
      count_text: c.int(cell.count),
      share,
      share_text: share === null ? null : c.pct(share),
      ci,
      reliability,
      provisional: !!cell.provisional,
    }
  })
  const registry = layer === 'onsite'
    ? ONSITE_DIMENSIONS[series.dimension as OnsiteDimensionId]?.caveats
    : EVIDENCE_DIMENSIONS[series.dimension as EvidenceDimensionId]?.caveats
  const keys: EvidenceCaveat[] = [...(series.caveats ?? registry ?? [])]
  if (series.cells.some((x) => x.provisional)) keys.push('recent_years_lag')
  if (!series.partition) keys.push('multi_label')
  const by = series.by ?? null
  const cross = series.cross && by
    ? series.cross.map((row) => row.map((x) => ({ key: x.key, label: bucketLabel(by, x.key, x.label, layer, c), count: x.count })))
    : null
  return {
    dimension: series.dimension,
    by,
    layer,
    title: (c.m.dimension as Record<string, string>)[series.dimension] ?? series.dimension,
    partition: series.partition,
    sum_exceeds_denominator: !series.partition,
    rows,
    cross,
    cross_unassigned: cross ? cross.map((row, i) => Math.max(0, series.cells[i].count - row.reduce((a, x) => a + x.count, 0))) : null,
    denominator: { kind: series.denominator.kind, value: denom, text: formatMessage(c.m.denominator[series.denominator.kind], { n: c.int(denom) }) },
    unknown_text: series.unknown ? formatMessage(c.m.text.unknown, { n: c.int(series.unknown) }) : null,
    multi_label_text: series.partition ? null : formatMessage(c.m.text.multi_label_sum, { n: c.int(denom) }),
    caveats: caveatViews(keys, c),
    footnote: formatMessage(c.m.text.footnote, {
      source: series.provenance.source_label, license: series.provenance.license, date: isoDate(series.provenance.retrieved_at),
    }),
    query_text: formatMessage(c.m.text.query, { query: series.provenance.query }),
    sample_gate: series.sample_gate ?? null,
  }
}

// ── 图种菜单 ─────────────────────────────────────────────────────────────────

export interface ChartMenuItem {
  kind: EvidenceChartKind
  label: string
  available: boolean
  blocker: EvidenceChartBlocker | null
  /** 画不了时的一句说明（菜单里灰着显示） */
  reason: string | null
}

/** 图种可用性 → 菜单项（画不了的不藏，灰着并写明差什么）。 */
export function presentChartMenu(availability: readonly EvidenceChartAvailability[], opts: PresentOptions = {}): ChartMenuItem[] {
  const c = context(opts)
  return availability.map((a) => ({
    kind: a.kind, label: c.m.chart[a.kind], available: a.available, blocker: a.blocker, reason: a.blocker ? c.m.blocker[a.blocker] : null,
  }))
}

// ── 视图阶梯 ─────────────────────────────────────────────────────────────────

export interface ViewSummary {
  kind: EvidenceViewKind
  title: string
  usable_text: string
  /** 为什么不是更高一级；已是最高级为 null */
  why_not_higher: string | null
  pooling_allowed: boolean
  pooling_text: string | null
  /** 汇总估计的一句话（有汇总时） */
  estimate_text: string | null
  /** 去掉偏倚风险高的研究之后的那一句（敏感性分析；主分析能汇总、且有高风险研究时才有） */
  sensitivity_text: string | null
}

function pooledText(c: Ctx, e: NonNullable<EvidencePooling['estimate']>): string {
  const d = effectDecimals(e.metric, e.ci_low, e.ci_high)
  const f = (x: number) => c.fixed(x, d)
  return formatMessage(c.m.text.pooled, {
    metric: c.m.metric[e.metric], k: c.int(e.k), estimate: f(e.estimate), ci_low: f(e.ci_low), ci_high: f(e.ci_high),
    pi_low: f(e.pi_low), pi_high: f(e.pi_high), i2: c.pct(e.i2),
  })
}

/** 敏感性分析那一句：去掉了几项、剩几项、结果（能汇总给数，与主分析同一个小数位；不能汇总给理由）。 */
function sensitivityText(c: Ctx, pooling: EvidencePooling): string | null {
  const s = pooling.allowed ? pooling.sensitivity ?? null : null
  if (!s || s.excluded <= 0) return null
  const main = pooling.estimate ?? null
  let result = c.m.pooling[s.reason]
  if (s.allowed && s.estimate) {
    const d = main ? effectDecimals(main.metric, main.ci_low, main.ci_high) : effectDecimals(s.estimate.metric, s.estimate.ci_low, s.estimate.ci_high)
    result = formatMessage(c.m.text.pooled_short, { estimate: c.fixed(s.estimate.estimate, d), ci_low: c.fixed(s.estimate.ci_low, d), ci_high: c.fixed(s.estimate.ci_high, d) })
  }
  return formatMessage(c.m.text.sensitivity, { excluded: c.int(s.excluded), k: c.int(Math.max(0, pooling.studies - s.excluded)), result })
}

export function presentView(decision: EvidenceViewDecision, pooling?: EvidencePooling | null, opts: PresentOptions = {}): ViewSummary {
  const c = context(opts)
  const e = pooling?.estimate ?? null
  return {
    kind: decision.kind,
    title: c.m.view[decision.kind],
    usable_text: formatMessage(c.m.text.usable, { usable: c.int(decision.usable), total: c.int(decision.total) }),
    why_not_higher: decision.downgrade_reason ? c.m.downgrade[decision.downgrade_reason] : null,
    pooling_allowed: !!pooling?.allowed,
    pooling_text: pooling ? c.m.pooling[pooling.reason] : null,
    estimate_text: e ? pooledText(c, e) : null,
    sensitivity_text: pooling ? sensitivityText(c, pooling) : null,
  }
}

// ── 偏倚风险与证据确定性（0.3.0）────────────────────────────────────────────────

export interface RiskOfBiasView {
  assessed: boolean
  /** 跨工具对齐的风险档（取颜色用）；没评过为 null */
  band: EvidenceRobBand | null
  /** 「RoB 2：有一些担忧」；没评过是「未评估偏倚风险」 */
  label: string
  /** 「评定：本站编辑」；没评过为 null */
  source_text: string | null
}

/** 一项研究的偏倚风险：图上那一格（颜色按 band，文字永远是工具自己的判断）。没评过不等于低风险。 */
export function presentRiskOfBias(rob: EvidenceRiskOfBias | null | undefined, opts: PresentOptions = {}): RiskOfBiasView {
  const c = context(opts)
  const band = robBand(rob)
  if (!rob || !band) return { assessed: false, band: null, label: c.m.text.rob_not_assessed, source_text: null }
  return {
    assessed: true, band,
    label: formatMessage(c.m.text.rob_record, { tool: c.m.rob.tool[rob.tool], judgement: c.m.rob.judgement[rob.overall] }),
    source_text: formatMessage(c.m.text.rob_source, { source: rob.source }),
  }
}

export interface RiskOfBiasSummaryView {
  total: number
  assessed: number
  by_band: Record<EvidenceRobBand, number>
  /** 「偏倚风险（RoB 2）：低风险 3 · 有担忧 1 · 高风险 1」；一项都没评过为 null */
  text: string | null
  /** 「2 项没有评估」；全评过（或一项都没有）为 null */
  missing_text: string | null
}

export function presentRiskOfBiasSummary(records: readonly EvidenceRecord[], opts: PresentOptions = {}): RiskOfBiasSummaryView {
  const c = context(opts)
  const s = summarizeRiskOfBias(records)
  const parts = (Object.keys(s.by_band) as EvidenceRobBand[]).filter((b) => s.by_band[b] > 0).map((b) => `${c.m.rob.band[b]} ${c.int(s.by_band[b])}`)
  const missing = s.total - s.assessed
  return {
    total: s.total, assessed: s.assessed, by_band: s.by_band,
    text: s.assessed > 0
      ? formatMessage(c.m.text.rob_summary, { tools: s.tools.map((t) => c.m.rob.tool[t]).join(c.m.text.list_sep), parts: parts.join(c.m.text.parts_sep) })
      : null,
    missing_text: s.assessed > 0 && missing > 0 ? formatMessage(c.m.text.rob_missing, { n: c.int(missing) }) : null,
  }
}

/** GRADE 的符号写法：实心圈的个数就是等级。 */
const CERTAINTY_SYMBOL: Record<EvidenceCertaintyLevel, string> = { high: '⊕⊕⊕⊕', moderate: '⊕⊕⊕◯', low: '⊕⊕◯◯', very_low: '⊕◯◯◯' }

export interface CertaintyView {
  level: EvidenceCertaintyLevel
  /** 「低」 */
  label: string
  /** 「⊕⊕◯◯」 */
  symbol: string
  /** 「证据确定性（GRADE）：低——结局「焦虑症状」；评定：某篇系统综述」 */
  text: string
  /** 这一档的标准含义（Balshem 2011） */
  meaning: string
  /** 「因偏倚风险、不精确降级」；没写理由为 null */
  reasons_text: string | null
  url: string | null
}

/** 一条证据确定性评级：等级、结局、谁评的、为什么——引擎只转述，一个字也不替人评。 */
export function presentCertainty(cert: EvidenceCertainty, opts: PresentOptions = {}): CertaintyView {
  const c = context(opts)
  const list = (xs: readonly string[]) => xs.join(c.m.text.list_sep)
  const reasons = [
    cert.rated_down_for?.length ? formatMessage(c.m.text.certainty_down, { list: list(cert.rated_down_for.map((d) => c.m.certainty.down[d])) }) : null,
    cert.rated_up_for?.length ? formatMessage(c.m.text.certainty_up, { list: list(cert.rated_up_for.map((u) => c.m.certainty.up[u])) }) : null,
  ].filter((x): x is string => x !== null)
  return {
    level: cert.level,
    label: c.m.certainty.level[cert.level],
    symbol: CERTAINTY_SYMBOL[cert.level],
    text: formatMessage(c.m.text.certainty, { level: c.m.certainty.level[cert.level], outcome: cert.outcome, source: cert.source }),
    meaning: c.m.certainty.meaning[cert.level],
    reasons_text: reasons.length > 0 ? reasons.join(c.m.text.clause_sep) : null,
    url: cert.url ?? null,
  }
}

// ── 标签绑定 ─────────────────────────────────────────────────────────────────

export interface BindingView {
  badge: BindingBadge
  text: string
  /** 外部层状态的一句话 */
  status_text: string | null
  /** 机器绑定时必须印的限定 */
  caveat: CaveatView | null
}

export function bindingBadge(binding: EvidenceTagBinding | null | undefined): BindingBadge {
  if (!binding) return 'none'
  if (binding.kind === 'curated') return 'curated'
  if (binding.kind === 'rejected') return 'rejected'
  return binding.confidence === 'exact' ? 'machine_exact' : 'machine_first_hit'
}

export function presentBinding(binding: EvidenceTagBinding | null | undefined, externalMatch?: EvidenceExternalMatch, opts: PresentOptions = {}): BindingView {
  const c = context(opts)
  const badge = bindingBadge(binding)
  return {
    badge,
    text: formatMessage(c.m.binding[badge], { topic: binding?.topic_name ?? '' }),
    status_text: externalMatch ? c.m.external[externalMatch] : null,
    caveat: badge === 'machine_exact' || badge === 'machine_first_hit' ? { key: 'machine_binding', text: c.m.caveat.machine_binding } : null,
  }
}

export interface BindingSuggestionView {
  topic_id: string
  display_name: string
  name_text: string
  rank_text: string | null
  cited_text: string | null
  works_count_text: string | null
}

/** 给编辑看的绑定候选（两路证据分开写，不合成一个分数）。 */
export function presentBindingSuggestions(suggestions: readonly EvidenceBindingSuggestion[], opts: PresentOptions = {}): BindingSuggestionView[] {
  const c = context(opts)
  return suggestions.map((s) => ({
    topic_id: s.topic_id,
    display_name: s.display_name,
    name_text: s.name_match === 'exact' ? c.m.text.name_exact : s.name_match === 'contains' ? c.m.text.name_contains : c.m.text.name_none,
    rank_text: s.rank === null ? null : formatMessage(c.m.text.autocomplete_rank, { rank: s.rank + 1 }),
    cited_text: s.cited
      ? formatMessage(c.m.text.cited_evidence, {
        works: c.int(s.cited.works), in_topic: c.int(s.cited.in_topic), share: c.pct(s.cited.share),
        ci_low: c.pct(s.cited.ci_low), ci_high: c.pct(s.cited.ci_high),
      })
      : null,
    works_count_text: s.works_count === null ? null : c.int(s.works_count),
  }))
}

export interface BindingQueueRowView {
  tag_key: string
  label: string
  articles: number
  articles_text: string
  /** 读者现在看到的是什么：机器绑定（同名 / 第一条）还是没有绑定 */
  badge: BindingBadge
  status_text: string
  candidate_text: string | null
}

/** 编辑的待办队列 → 一行一个标签：多少篇文章、读者现在看到什么、机器给的候选。 */
export function presentBindingQueue(items: readonly EvidenceBindingQueueItem[], opts: PresentOptions = {}): BindingQueueRowView[] {
  const c = context(opts)
  return items.map((it) => ({
    tag_key: it.tag_key,
    label: it.label,
    articles: it.articles,
    articles_text: formatMessage(c.m.text.queue_articles, { n: c.int(it.articles) }),
    badge: bindingBadge(it.binding),
    status_text: c.m.external[it.external_match],
    candidate_text: it.candidate ? formatMessage(c.m.text.queue_candidate, { topic: it.candidate.display_name }) : null,
  }))
}

// ── 研究图谱 ─────────────────────────────────────────────────────────────────

export interface EvidenceMapView {
  title: string
  level_text: string
  binding: BindingView | null
  /** 必须显眼地告诉读者的几句话（外部层状态、只有站内） */
  notices: string[]
  onsite_count: number
  external_count: number
  counts_text: string[]
  /** 记录之间的边各几条（没接边时为 null：UI 只画点不画线） */
  edges: { cites: number; shares_tag: number } | null
  view: ViewSummary
  /** 这批记录的偏倚风险概况（0.3.0） */
  risk_of_bias: RiskOfBiasSummaryView
  /** 证据确定性评级（0.3.0；没接或没有为空数组，没取到时 notices 里有一句） */
  certainty: CertaintyView[]
  /** 往里一层（0.4.0；服务端没下发时为 null） */
  children: NodeChildrenView | null
  caveats: CaveatView[]
  footnotes: string[]
}

export function presentEvidenceMap(map: EvidenceMapData, opts: PresentOptions = {}): EvidenceMapView {
  const c = context(opts)
  const onsite = map.records.filter((r) => r.source === 'onsite').length
  const external = map.records.length - onsite
  const binding = map.level === 'tag' ? presentBinding(map.binding ?? null, map.external_match, opts) : null
  const notices: string[] = []
  if (map.external_match && map.external_match !== 'matched') notices.push(c.m.external[map.external_match])
  if (map.onsite_only) notices.push(c.m.text.onsite_only)
  if (map.certainty === null) notices.push(c.m.text.certainty_unavailable)
  if (map.onsite_pending) notices.push(formatMessage(c.m.text.onsite_pending, { n: c.int(map.onsite_pending) }))
  const keys: EvidenceCaveat[] = []
  if (binding?.caveat) keys.push('machine_binding')
  if (external > 0) keys.push('sample_not_population')
  if (onsite > 0) keys.push('onsite_self_selected', 'self_reported')
  if (map.records.length > 0 && map.records.length < SMALL_CORPUS) keys.push('small_corpus')
  const edges = map.edges
    ? { cites: map.edges.filter((e) => e.kind === 'cites').length, shares_tag: map.edges.filter((e) => e.kind === 'shares_tag').length }
    : null
  if (edges && edges.shares_tag > 0) keys.push('cooccurrence_not_citation')
  const counts_text = [formatMessage(c.m.text.onsite_count, { n: c.int(onsite) })]
  if (external > 0) counts_text.push(formatMessage(c.m.text.sample, { n: c.int(external) }))
  return {
    title: map.focus?.display_name ?? '',
    level_text: c.m.scale[map.level],
    binding,
    notices,
    onsite_count: onsite,
    external_count: external,
    counts_text,
    edges,
    view: presentView(map.view, map.pooling, opts),
    risk_of_bias: presentRiskOfBiasSummary(map.records, opts),
    certainty: (map.certainty ?? []).map((x) => presentCertainty(x, opts)),
    children: presentNodeChildren(map, opts),
    caveats: caveatViews(keys, c),
    footnotes: map.sources.map((p) => formatProvenance(p, opts)),
  }
}

// ── 下钻（0.4.0）：往里一层、作品清单、这批作品还挂着什么 ─────────────────────────────

/** 往里一层是哪一级：大类 → 领域 → 子领域 → 主题 → 站内标签 */
const CHILD_SCALE: Record<EvidenceScaleLevel, EvidenceScaleLevel | null> = { domain: 'field', field: 'subfield', subfield: 'topic', topic: 'tag', tag: null }

export interface NodeChildRowView {
  /** 节点 id：外部树上的拿去 `getNodeMap(level, external_id)`，站内标签拿去 `getTagMap` */
  id: string
  external_id: string
  level: EvidenceScaleLevel
  label: string
  /** 外部树：全库篇数；站内标签：带这个标签的站内文章数；不知道为 null */
  count: number | null
  count_text: string | null
  /** 相对这一层最大的那个，∈ [0, 1]：只给横条长度比大小——一篇可以同时在几个子节点下，**不是**占比；没有篇数为 null */
  size: number | null
}

export interface NodeChildrenView {
  /** 往里一层是什么（「子领域」「标签」…） */
  level_text: string
  /** 「往里一层：子领域（12 个）」 */
  title: string
  rows: NodeChildRowView[]
  /** 只列出了一部分 / 这次没取到 / 往里没有（各一句）；正常为 null */
  notice: string | null
  caveats: CaveatView[]
}

/**
 * 往里一层 → 一行一个子节点（按篇数从多到少，与服务端同序）。服务端没下发（旧服务端、没接、标签级）⇒ null。
 * 一篇作品可以同时挂在几个子节点下：各项相加会超过本节点的篇数，所以只给相对长度、不给占比（图注 `multi_label`）。
 */
export function presentNodeChildren(map: EvidenceMapData, opts: PresentOptions = {}): NodeChildrenView | null {
  if (map.children === undefined) return null
  const c = context(opts)
  const childLevel = CHILD_SCALE[map.level] ?? 'tag'
  const list = map.children ?? []
  const max = Math.max(0, ...list.map((x) => x.works_count ?? 0))
  const rows: NodeChildRowView[] = list.map((x) => ({
    id: x.id,
    external_id: x.external_id,
    level: x.level,
    label: x.display_name,
    count: x.works_count,
    count_text: x.works_count === null ? null
      : formatMessage(x.level === 'tag' ? c.m.text.onsite_count : c.m.text.node_works, { n: c.int(x.works_count) }),
    size: x.works_count === null ? null : max > 0 ? x.works_count / max : 0,
  }))
  const notice = map.children === null ? c.m.text.children_unavailable
    : map.children_partial ? formatMessage(c.m.text.children_partial, { n: c.int(rows.length) })
      : rows.length === 0 ? (childLevel === 'tag' ? c.m.text.children_no_tags : c.m.text.children_none)
        : null
  return {
    level_text: c.m.scale[childLevel],
    title: formatMessage(c.m.text.children_title, { level: c.m.scale[childLevel], n: c.int(rows.length) }),
    rows,
    notice,
    caveats: rows.length > 1 ? caveatViews(['multi_label'], c) : [],
  }
}

/** 焦点之外：作品清单与「还挂着什么」都不重复列焦点自己（标签级的焦点还包括它绑到的主题；主题级还包括往里一层的标签） */
function focusOf(map: EvidenceMapData): { topics: Set<string>; tagKeys: Set<string> } {
  const topics = new Set<string>()
  const tagKeys = new Set<string>()
  if (map.focus) {
    if (map.level === 'tag') tagKeys.add(map.focus.external_id)
    else topics.add(map.focus.id)
  }
  if (map.level === 'tag' && map.binding?.topic_id) topics.add(map.binding.topic_id)
  for (const ch of map.children ?? []) if (ch.level === 'tag') tagKeys.add(ch.external_id)
  return { topics, tagKeys }
}

function venueText(v: EvidenceVenue, c: Ctx): string {
  const type = v.type ? c.m.venueType[v.type] ?? v.type : null
  const name = type ? formatMessage(c.m.text.venue_with_type, { name: v.name, type }) : v.name
  return v.is_oa ? [name, c.m.text.venue_oa].join(c.m.text.parts_sep) : name
}

export interface WorkRowView {
  id: string
  layer: 'onsite' | 'external'
  title: string
  /** 原文页：站内文章的链接、外部作品的 DOI 或落地页 */
  url: string | null
  year_text: string | null
  /** 前三位作者，多了加「等」；没有为 null */
  authors_text: string | null
  /** 「Journal One（期刊）· 全刊开放获取」；站内文章与没有来源的为 null */
  venue_text: string | null
  venue_id: string | null
  /**
   * 能读到全文的地址：外部作品＝开放获取的最佳版本（只放 http(s)），站内文章＝它自己的链接；
   * 外部作品没有已知的开放版本为 null——**不等于**读不到（可能在付费墙后，或有没收录的版本）。
   */
  read_url: string | null
  /** true 可免费读 · false 没有已知的免费版本 · null 不清楚（站内文章为 true：就在站内） */
  open: boolean | null
  /** 「可免费阅读」「没有已知的免费版本」「在本站阅读」… */
  access_text: string
  /** 这篇还挂着的别的主题（不含焦点），id 可以直接拿去打开那个节点 */
  other_topics: Array<{ id: string; label: string }>
  /** 站内文章还挂着的别的标签（原文，不含焦点与往里一层的那些） */
  other_tags: string[]
  /** 在这批里：引用了几篇、被几篇引用（只数同一次下发里的） */
  cites: number
  cited_by: number
  links_text: string | null
  /** 外部源给的全库被引数（只做排序参考，**不是**效应） */
  citations_text: string | null
  risk_of_bias: RiskOfBiasView
}

/**
 * 一个节点（或标签）里的作品清单：标题、作者、年份、发在哪、能不能免费读、还挂着哪些别的主题 / 标签、
 * 在这批里引用了谁、被谁引用。顺序与 `map.records` 相同（站内在前，外部按被引从多到少）。
 */
export function presentWorks(map: EvidenceMapData, opts: PresentOptions = {}): WorkRowView[] {
  const c = context(opts)
  const focus = focusOf(map)
  const out = new Map<string, number>()
  const inn = new Map<string, number>()
  for (const e of map.edges ?? []) {
    if (e.kind !== 'cites') continue
    out.set(e.from, (out.get(e.from) ?? 0) + 1)
    inn.set(e.to, (inn.get(e.to) ?? 0) + 1)
  }
  return map.records.map((r) => {
    const onsite = r.source === 'onsite'
    const authors = r.authors.slice(0, 3).join(c.m.text.list_sep)
    const cites = out.get(r.id) ?? 0
    const citedBy = inn.get(r.id) ?? 0
    const links = [
      cites > 0 ? formatMessage(c.m.text.work_cites, { n: c.int(cites) }) : null,
      citedBy > 0 ? formatMessage(c.m.text.work_cited_by, { n: c.int(citedBy) }) : null,
    ].filter((x): x is string => x !== null)
    const seenTags = new Set<string>()
    const otherTags: string[] = []
    for (const raw of r.tags ?? []) {
      const k = normalizeTag(raw)
      if (!k || focus.tagKeys.has(k) || seenTags.has(k)) continue
      seenTags.add(k)
      otherTags.push(raw.trim())
    }
    const open = onsite ? true : r.oa_url ? true : r.is_open_access
    return {
      id: r.id,
      layer: onsite ? 'onsite' : 'external',
      title: r.title,
      url: r.url,
      year_text: r.year === null ? null : String(r.year),
      authors_text: r.authors.length === 0 ? null : r.authors.length > 3 ? formatMessage(c.m.text.authors_more, { list: authors }) : authors,
      venue_text: r.venue ? venueText(r.venue, c) : null,
      venue_id: r.venue?.id ?? null,
      read_url: onsite ? r.url : r.oa_url ?? null,
      open,
      access_text: onsite ? formatMessage(c.m.text.work_read_onsite, { source: r.provenance.source_label })
        : open === true ? c.m.text.work_free : open === false ? c.m.text.work_not_free : c.m.text.work_access_unknown,
      other_topics: (r.topics ?? []).filter((t) => !focus.topics.has(t.id)).map((t) => ({ id: t.id, label: t.display_name })),
      other_tags: otherTags,
      cites,
      cited_by: citedBy,
      links_text: links.length > 0 ? links.join(c.m.text.parts_sep) : null,
      citations_text: onsite || r.cited_by_count === null ? null : formatMessage(c.m.text.work_citations, { n: c.int(r.cited_by_count) }),
      risk_of_bias: presentRiskOfBias(r.risk_of_bias, opts),
    }
  })
}

export interface FacetRowView {
  id: string
  label: string
  count: number
  /** 「3 / 25 篇」：在哪一批里数的见 `base_text` */
  count_text: string
}

export interface FacetView {
  rows: FacetRowView[]
  /** 没列出来的还有几个 */
  more: number
  more_text: string | null
  /** 在哪一批里数的（「在被引最多的 25 篇外部作品里」「在 12 篇站内文章里」）；这一批是空的为 null */
  base_text: string | null
}

export interface RecordFacetsView {
  /** 外部作品还挂着的别的主题（不含焦点），id 可以直接拿去打开那个节点 */
  topics: FacetView
  /** 站内文章还挂着的别的标签（不含焦点与往里一层的那些），id 是归一后的标签键 */
  tags: FacetView
  /** 外部作品发在哪些期刊 / 来源（按主要发表位置） */
  venues: FacetView
  caveats: CaveatView[]
}

/**
 * 这批作品还挂着什么：别的主题、别的站内标签、发在哪些期刊。**只在这批里数**——外部的是被引最多的那几篇示例，
 * 不代表这个节点的全体（图注 `sample_not_population`）；一篇可以挂好几个主题，各项相加会超过篇数（`multi_label`）。
 */
export function presentRecordFacets(map: EvidenceMapData, opts: PresentOptions & { limit?: number } = {}): RecordFacetsView {
  const c = context(opts)
  const limit = Math.max(1, Math.min(opts.limit ?? 10, 50))
  const focus = focusOf(map)
  const external = map.records.filter((r) => r.source !== 'onsite')
  const onsite = map.records.filter((r) => r.source === 'onsite')
  const facet = (counts: Map<string, { label: string; n: number }>, total: number, base: string | null): FacetView => {
    const all = [...counts.entries()]
      .map(([id, v]) => ({ id, label: v.label, count: v.n }))
      .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
    const more = Math.max(0, all.length - limit)
    return {
      rows: all.slice(0, limit).map((x) => ({ ...x, count_text: formatMessage(c.m.text.facet_count, { count: c.int(x.count), total: c.int(total) }) })),
      more,
      more_text: more > 0 ? formatMessage(c.m.text.facet_more, { n: c.int(more) }) : null,
      base_text: total > 0 ? base : null,
    }
  }
  const bump = (m: Map<string, { label: string; n: number }>, id: string, label: string) => {
    const cur = m.get(id)
    if (cur) cur.n++
    else m.set(id, { label, n: 1 })
  }
  const topics = new Map<string, { label: string; n: number }>()
  const venues = new Map<string, { label: string; n: number }>()
  for (const r of external) {
    for (const t of new Map((r.topics ?? []).map((t) => [t.id, t])).values()) if (!focus.topics.has(t.id)) bump(topics, t.id, t.display_name)
    if (r.venue) bump(venues, r.venue.id, r.venue.name)
  }
  // 站内标签：按别名组数篇数，显示名取最常见的原文写法（与标签层同一个归组）
  const tags = new Map(groupTags(onsite).filter((g) => !focus.tagKeys.has(g.key)).map((g) => [g.key, { label: g.label, n: g.count }]))
  const sampleBase = formatMessage(c.m.text.facet_sample, { n: c.int(external.length) })
  const onsiteBase = formatMessage(c.m.text.facet_onsite, { n: c.int(onsite.length) })
  const keys: EvidenceCaveat[] = []
  if (topics.size + venues.size > 0) keys.push('sample_not_population')
  if (topics.size + tags.size > 0) keys.push('multi_label')
  if (venues.size > 0) keys.push('primary_location_only')
  return {
    topics: facet(topics, external.length, sampleBase),
    tags: facet(tags, onsite.length, onsiteBase),
    venues: facet(venues, external.length, sampleBase),
    caveats: caveatViews(keys, c),
  }
}

// ── 标签共现图 ────────────────────────────────────────────────────────────────

export interface TagGraphView {
  focus: string | null
  /** size ∈ (0, 1]：按面积与计数成比例（√），前端乘自己的最大半径 */
  nodes: Array<{ key: string; label: string; count: number; size: number; topic_id: string | null }>
  /**
   * strength ∈ (0, 1]：关联强度（lift）相对最大值，给力导向布局当弹簧强度（van Eck & Waltman 2009）；
   * width ∈ (0, 1]：原始共现数相对最大值，给线宽。两个量不要互换。
   */
  edges: Array<{ a: string; b: string; count: number; lift: number; jaccard: number; strength: number; width: number }>
  caption: string[]
  caveats: CaveatView[]
  footnote: string
}

export function presentTagGraph(graph: EvidenceTagGraph, opts: PresentOptions = {}): TagGraphView {
  const c = context(opts)
  const maxCount = Math.max(1, ...graph.nodes.map((n) => n.count))
  const maxLift = Math.max(Number.EPSILON, ...graph.edges.map((e) => e.lift))
  const maxEdge = Math.max(1, ...graph.edges.map((e) => e.count))
  const caption = [formatMessage(c.m.text.graph_threshold, { min: graph.min_support, records: c.int(graph.records) })]
  if (graph.collapsed.tags > 0 || graph.collapsed.edges > 0) {
    caption.push(formatMessage(c.m.text.graph_collapsed, { tags: c.int(graph.collapsed.tags), edges: c.int(graph.collapsed.edges) }))
  }
  if (graph.pending) caption.push(formatMessage(c.m.text.onsite_pending, { n: c.int(graph.pending) }))
  return {
    focus: graph.focus,
    nodes: graph.nodes.map((n) => ({ ...n, size: Math.sqrt(n.count / maxCount) })),
    edges: graph.edges.map((e) => ({ ...e, strength: e.lift / maxLift, width: e.count / maxEdge })),
    caption,
    caveats: caveatViews(graph.caveats, c),
    footnote: formatMessage(c.m.text.footnote, {
      source: graph.provenance.source_label, license: graph.provenance.license, date: isoDate(graph.provenance.retrieved_at),
    }),
  }
}

// ── 计数读口 ─────────────────────────────────────────────────────────────────

export interface OnsiteCountsView {
  title: string
  total_text: string
  /** 「另有 3 篇站内文章在等审阅」：开了审阅门槛且有在等的才有，否则 null（0.4.0） */
  pending_text: string | null
  series: SeriesView[]
  charts: Record<string, ChartMenuItem[]>
  graph: TagGraphView | null
}

export function presentOnsiteCounts(layer: EvidenceOnsiteCounts, opts: PresentOptions = {}): OnsiteCountsView {
  const c = context(opts)
  return {
    title: layer.scope.display_name,
    total_text: formatMessage(c.m.text.onsite_count, { n: c.int(layer.total) }),
    pending_text: layer.pending ? formatMessage(c.m.text.onsite_pending, { n: c.int(layer.pending) }) : null,
    series: layer.series.map((s) => presentSeries(s, { ...opts, layer: 'onsite' })),
    // 只给下发了格子的维度出菜单（站内层可以只要部分维度；availability 本身覆盖全部维度）
    charts: Object.fromEntries(Object.entries(layer.availability)
      .filter(([dim]) => layer.series.some((s) => s.dimension === dim))
      .map(([dim, a]) => [dim, presentChartMenu(a, opts)])),
    graph: layer.tag_graph ? presentTagGraph(layer.tag_graph, opts) : null,
  }
}

export interface CountsView {
  title: string
  scope_text: string
  other_scope_text: string | null
  series: SeriesView[]
  charts: Record<string, ChartMenuItem[]>
  onsite: OnsiteCountsView | null
}

export function presentCounts(counts: EvidenceCountsData, opts: PresentOptions = {}): CountsView {
  const c = context(opts)
  return {
    title: counts.node.display_name,
    scope_text: formatMessage(counts.scope === 'primary_topic' ? c.m.text.scope_primary : c.m.text.scope_topics, { total: c.int(counts.total) }),
    other_scope_text: counts.other_scope_total === null ? null : formatMessage(c.m.text.scope_other, { n: c.int(counts.other_scope_total) }),
    series: counts.series.map((s) => presentSeries(s, { ...opts, layer: 'external' })),
    charts: Object.fromEntries(Object.entries(counts.availability).map(([dim, a]) => [dim, presentChartMenu(a, opts)])),
    onsite: counts.onsite ? presentOnsiteCounts(counts.onsite, opts) : null,
  }
}

// ── 入库问题（给作者看）────────────────────────────────────────────────────────

export function presentIntakeIssues(issues: readonly EvidenceIntakeIssue[], opts: PresentOptions = {}) {
  const c = context(opts)
  return issues.map((i) => ({ ...i, text: c.m.intake[i.code] }))
}

// ── 插件设置页（后台）────────────────────────────────────────────────────────────

export interface SettingFieldView {
  key: EvidenceSettingKey
  label: string
  help: string
  type: 'enum' | 'integer' | 'boolean' | 'string'
  value: string | number | boolean
  default: string | number | boolean
  /** 与缺省值不同（后台可以显示「恢复缺省」） */
  changed: boolean
  options: Array<{ value: string; label: string }> | null
  min: number | null
  max: number | null
  max_length: number | null
  unit_text: string | null
  apply_text: string
  scope: 'server' | 'public'
  since: string
  /** 这个键上次保存时的问题（值不合法被退回缺省值等） */
  issue_text: string | null
}

export interface SettingsFormView {
  groups: Array<{ group: EvidenceSettingGroup; title: string; fields: SettingFieldView[] }>
  /** 当前版本认不出的键（多半来自更新版本的清单）：升级后自动生效 */
  unknown: Array<{ key: string; text: string }>
}

/** 设置页：按注册表逐项生成表单字段（新版本加的设置项升级后自动出现在这里）。 */
export function presentSettingsForm(values: EvidenceSettings, issues: readonly EvidenceSettingIssue[] = [], opts: PresentOptions = {}): SettingsFormView {
  const c = context(opts)
  const issueFor = new Map(issues.map((i) => [i.key, i.code]))
  const groups = new Map<EvidenceSettingGroup, SettingFieldView[]>()
  for (const d of EVIDENCE_SETTINGS) {
    const text = c.m.setting[d.key]
    const code = issueFor.get(d.key)
    const field: SettingFieldView = {
      key: d.key,
      label: text.label,
      help: text.help,
      type: d.type,
      value: values[d.key],
      default: d.default,
      changed: values[d.key] !== d.default,
      options: d.options ? d.options.map((o) => ({ value: o, label: text.options?.[o] ?? o })) : null,
      min: d.min ?? null,
      max: d.max ?? null,
      max_length: d.maxLength ?? null,
      unit_text: d.unit ? c.m.settingUnit[d.unit] : null,
      apply_text: c.m.settingApply[d.apply],
      scope: d.scope,
      since: d.since,
      issue_text: code ? c.m.settingIssue[code] : null,
    }
    const list = groups.get(d.group) ?? []
    list.push(field)
    groups.set(d.group, list)
  }
  return {
    groups: [...groups.entries()].map(([group, fields]) => ({ group, title: c.m.settingGroup[group], fields })),
    unknown: issues.filter((i) => i.code === 'unknown_key').map((i) => ({ key: i.key, text: c.m.settingIssue.unknown_key })),
  }
}

// ── 打标签与标签账本（后台 / 贡献者界面）──────────────────────────────────────────────

/** 模型给的建议（写进账本之前给人看）。 */
export function presentTagSuggestions(suggestions: readonly TagSuggestionView[], opts: PresentOptions = {}) {
  const c = context(opts)
  return suggestions.map((s) => ({
    tag_key: s.tag_key,
    label: s.label,
    confidence_text: s.confidence === null ? null : formatMessage(c.m.text.suggestion_confidence, { value: c.pct(s.confidence) }),
    rationale: s.rationale,
  }))
}

export interface WorkTagRowView {
  tag_key: string
  label: string
  state: EvidenceWorkTagState
  /** 只有 present 进统计 */
  counted: boolean
  /** 这个结论是修改申请审核通过后定的（同级不能直接推翻） */
  reviewed: boolean
  text: string
  /** 各级立场，比如「编辑 +2 / −0 · 模型 +1 / −1」 */
  support_text: string
}

/** 一篇论文的生效标签（有争议的排前面，方便审核）。 */
export function presentWorkTags(tags: readonly EvidenceWorkTag[], opts: PresentOptions = {}): WorkTagRowView[] {
  const c = context(opts)
  const order: Record<EvidenceWorkTagState, number> = { disputed: 0, present: 1, absent: 2 }
  return [...tags].sort((a, b) => order[a.state] - order[b.state] || (a.tag_key < b.tag_key ? -1 : 1)).map((t) => ({
    tag_key: t.tag_key,
    label: t.label,
    state: t.state,
    counted: t.state === 'present',
    reviewed: !!t.request_id,
    text: formatMessage(t.request_id ? c.m.text.work_tag_reviewed : c.m.text.work_tag_decided, { state: c.m.workTagState[t.state], tier: c.m.trustTier[t.decided_by] }),
    support_text: Object.entries(t.support)
      .map(([tier, s]) => `${c.m.trustTier[tier as keyof typeof c.m.trustTier]} +${s!.add} / −${s!.remove}`)
      .join(' · '),
  }))
}

const joinList = (items: readonly string[], c: Ctx) => items.join(c.locale.startsWith('zh') ? '、' : ', ')

/** 修改申请列表（审核界面）。人只给 id 与层级，显示名由接入方按 id 查。 */
export function presentChangeRequests(requests: readonly EvidenceTagChangeRequest[], opts: PresentOptions = {}) {
  const c = context(opts)
  return requests.map((r) => ({
    id: r.id,
    work_id: r.work_id,
    status: r.status,
    status_text: c.m.requestStatus[r.status],
    requester_id: r.by.id,
    requester_tier_text: c.m.trustTier[r.by.tier],
    changes_text: formatMessage(c.m.text.request_changes, {
      add: joinList(r.changes.filter((x) => x.op === 'add').map((x) => x.tag_label), c) || '—',
      remove: joinList(r.changes.filter((x) => x.op === 'remove').map((x) => x.tag_label), c) || '—',
    }),
    reason: r.reason,
    created_at: isoDate(r.created_at),
    reviewer_id: r.decided_by?.id ?? null,
    decided_at: r.decided_at ? isoDate(r.decided_at) : null,
    decision_note: r.decision_note,
  }))
}

/** 交换包的问题（回给贡献者看）。 */
export function presentContributionIssues(issues: readonly EvidenceContributionIssue[], opts: PresentOptions = {}) {
  const c = context(opts)
  return issues.map((i) => ({ ...i, text: c.m.contributionIssue[i.code] }))
}
