/**
 * 站内层——宿主自己的「学术文章」怎么进引擎、怎么被数、标签之间怎么连（纯函数、零 IO）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 【生产端】宿主把自己的文章行映射成 `OnsiteArticle`（字段全是可选的，有什么给什么），交给 `intakeArticle`：
 *   · 每个字段先验形再进记录：写反的置信区间、不含点估计的区间、≤0 的比值、p = 0……都会被清掉，并回一条
 *     `EvidenceIntakeIssue` 说清楚动作（整条丢 / 清字段 / 改写 / 只标记）——这些问题可以原样回给作者看（`presentIntakeIssues`）。
 *   · 为什么这么严：阶梯（ladder.ts）按字段**有没有**决定画到哪一级，一个坏区间就能把整张图从证据缺口图抬成森林图。
 *   · 方向（direction）与点估计矛盾时，方向改为 `unclear`、「数值大＝好」清空：两者谁错了引擎判断不了，就都不拿来画「偏向谁」。
 *   · 自报显著性与 95% 区间矛盾（说显著但区间跨过无效应值，或反之）只做标记：显著性本来就只是标注，不进合成。
 * 【消费端】`countOnsite` / `crossOnsite` / `buildTagGraph` / `countOnsiteLayer` 把记录变成格子与图，
 *   每组格子自带分母口径、是否互斥、图注限定（`onsite_self_selected`：站内文章是作者自选的，不代表领域全貌）。
 *
 * 共现图的量：支持度（原始共现数）、Jaccard（Jaccard 1912）、lift（观察 / 独立期望，Brin et al. 1997）；
 * 布局建议用关联强度而不是 Jaccard / 余弦（van Eck & Waltman 2009, *JASIST* 60(8):1635–1651）。
 */
import type {
  EvidenceCaveat, EvidenceChartAvailability, EvidenceCountProvenance, EvidenceCountSeries, EvidenceDenominatorKind,
  EvidenceDirection, EvidenceEdge, EvidenceEffect, EvidenceIntakeIssue, EvidenceOnsiteCounts, EvidenceRecord,
  EvidenceSelfReportedClaim, EvidenceStudyDesign, EvidenceTagEdge, EvidenceTagGraph, EvidenceTagNode, OnsiteDimensionId,
} from './types'
import { EVIDENCE_DIRECTIONS, EVIDENCE_SELF_REPORTED_CLAIMS, EVIDENCE_STUDY_DESIGNS, ONSITE_DIMENSION_IDS } from './types'
import { EFFECT_METRICS, directionFromEffect, intervalExcludesNull, isEffectMetric } from './effects'
import { groupTags, normalizeTag, recordTagKeys, TAG_MAX_LENGTH } from './tags'
import { chartAvailabilityFor, chartShapeOf } from './charts'
import { normalizeDoi } from './doi'

// ── 输入形状 ─────────────────────────────────────────────────────────────────

/** 作者申报的效应量（数字可以是字符串：很多数据库驱动把 numeric 列读成字符串）。 */
export interface OnsiteArticleEffect {
  metric?: unknown
  value?: unknown
  ci_low?: unknown
  ci_high?: unknown
  n?: unknown
  p_value?: unknown
  higher_is_better?: unknown
}

/**
 * 宿主的一篇学术类文章（各家文章表的最小公约数）。除 `id` / `title` 外全部可选——有什么给什么，
 * 给得越全，阶梯能诚实画到的级别越高。**只传公开文章**；`is_public: false` 的会被丢掉（防御）。
 */
export interface OnsiteArticle {
  id: string | number
  title: string
  /** 作者打的标签，原文 */
  tags?: readonly string[] | null
  year?: number | null
  /** 发表时间（ISO 串或 Date）；没给 year 时从这里取年份 */
  published_at?: string | Date | null
  /** 公开署名（宿主决定显示什么；别放邮箱等联系方式） */
  authors?: readonly string[] | null
  /** 文章的公开地址（只接受 http / https） */
  url?: string | null
  doi?: string | null
  /** 研究设计，取值见 `EVIDENCE_STUDY_DESIGNS` */
  study_design?: string | null
  /** 出版物形态（article / review / commentary…），自由文本，不是研究设计 */
  publication_type?: string | null
  /** 作者自报结果类型：significant / non_significant / mixed / not_applicable */
  claim?: string | null
  /** 作者申报的效应方向：favours / against / unclear / not_applicable */
  direction?: string | null
  effect?: OnsiteArticleEffect | null
  /** 参考文献（DOI 字符串或 `{ doi }`）；用来按引用关系给标签推荐主题（见 service 的 suggestBindings） */
  references?: ReadonlyArray<string | { doi?: string | null }> | null
  is_public?: boolean | null
  is_retracted?: boolean | null
}

export interface OnsiteIntakeOptions {
  /** 脚注里的来源名（宿主的站名 / 栏目名） */
  source_label?: string
  /** 站内文章的许可（如 `CC BY 4.0`） */
  license?: string
  /** ISO 时间串；缺省取当前时间 */
  retrieved_at?: string
  /** 每篇最多保留几个标签 */
  maxTags?: number
  /** 年份上限（缺省＝今年 + 1） */
  maxYear?: number
}

export interface IntakeResult {
  record: EvidenceRecord | null
  issues: EvidenceIntakeIssue[]
  /** 归一化后的参考文献 DOI（小写、不带前缀），去重 */
  references: string[]
}

export const ONSITE_DEFAULT_LABEL = 'On-site articles'
export const ONSITE_DEFAULT_LICENSE = 'unspecified'
export const ONSITE_MAX_TAGS = 30

// ── 小工具 ───────────────────────────────────────────────────────────────────

/** 数字或数字样的字符串 → 有限数；其余 null。 */
function toNumber(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null
  if (typeof x === 'string' && /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i.test(x)) {
    const n = Number(x)
    return Number.isFinite(n) ? n : null
  }
  return null
}
const present = (x: unknown) => x !== undefined && x !== null && !(typeof x === 'string' && x.trim() === '')

export { normalizeDoi } from './doi'

// http(s)://主机[:端口][路径 / 查询 / 片段]；主机里不许有 `@`（`https://真站@钓鱼站` 这种）与空白、控制字符
const HTTP_URL = /^https?:\/\/[^\s/?#@:\\]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/i
const CONTROL = /[\u0000-\u001f\u007f]/

/**
 * 只接受 http / https 的绝对地址（`javascript:`、`data:` 这类会被当成链接渲染的一律拒绝）。
 * 用正则而不是 `new URL`：React Native 的 URL 实现不全，移动端也要能跑。
 */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null
  const s = raw.trim()
  return HTTP_URL.test(s) && !CONTROL.test(s) ? s : null
}

const inVocab = <T extends string>(vocab: readonly T[], x: unknown): T | null => {
  if (typeof x !== 'string') return null
  const v = x.trim().toLowerCase()
  return (vocab as readonly string[]).includes(v) ? (v as T) : null
}

// ── 入库验形 ──────────────────────────────────────────────────────────────────

function intakeEffect(raw: unknown, issues: EvidenceIntakeIssue[]): EvidenceEffect | null {
  if (!present(raw)) return null
  if (typeof raw !== 'object') { issues.push({ code: 'unknown_metric', field: 'effect', action: 'field_cleared' }); return null }
  const e = raw as OnsiteArticleEffect
  if (!isEffectMetric(e.metric)) { issues.push({ code: 'unknown_metric', field: 'effect.metric', action: 'field_cleared' }); return null }
  const spec = EFFECT_METRICS[e.metric]
  const value = toNumber(e.value)
  if (value === null) { issues.push({ code: 'effect_not_finite', field: 'effect.value', action: 'field_cleared' }); return null }
  const outOfDomain = spec.nullValue === 1 ? 'ratio_not_positive' as const : 'value_out_of_range' as const
  if (!spec.inDomain(value)) { issues.push({ code: outOfDomain, field: 'effect.value', action: 'field_cleared' }); return null }

  let ci_low: number | null = null
  let ci_high: number | null = null
  const hasLo = present(e.ci_low)
  const hasHi = present(e.ci_high)
  if (hasLo || hasHi) {
    const lo = toNumber(e.ci_low)
    const hi = toNumber(e.ci_high)
    if (lo === null || hi === null) issues.push({ code: 'ci_incomplete', field: 'effect.ci', action: 'field_cleared' })
    else if (!spec.inDomain(lo) || !spec.inDomain(hi)) issues.push({ code: outOfDomain, field: 'effect.ci', action: 'field_cleared' })
    else if (lo >= hi) issues.push({ code: 'ci_inverted', field: 'effect.ci', action: 'field_cleared' })
    else if (value < lo || value > hi) issues.push({ code: 'ci_excludes_estimate', field: 'effect.ci', action: 'field_cleared' })
    else { ci_low = lo; ci_high = hi }
  }

  let n: number | null = null
  if (present(e.n)) {
    const x = toNumber(e.n)
    if (x !== null && Number.isInteger(x) && x > 0) n = x
    else issues.push({ code: 'n_invalid', field: 'effect.n', action: 'field_cleared' })
  }
  let p_value: number | null = null
  if (present(e.p_value)) {
    const x = toNumber(e.p_value)
    if (x !== null && x > 0 && x <= 1) p_value = x
    else issues.push({ code: 'p_invalid', field: 'effect.p_value', action: 'field_cleared' })
  }
  const higher_is_better = typeof e.higher_is_better === 'boolean' ? e.higher_is_better : null
  return { metric: e.metric, value, ci_low, ci_high, n, higher_is_better, p_value }
}

/**
 * 一篇站内文章 → 一条 `EvidenceRecord`（或 null）+ 问题清单。**从不抛**：宿主的一行脏数据不该让整页读图崩掉。
 */
export function intakeArticle(article: unknown, opts: OnsiteIntakeOptions = {}): IntakeResult {
  const issues: EvidenceIntakeIssue[] = []
  const dropped = (code: EvidenceIntakeIssue['code'], field: string): IntakeResult =>
    ({ record: null, issues: [...issues, { code, field, action: 'record_dropped' }], references: [] })
  if (!article || typeof article !== 'object') return dropped('missing_id', 'id')
  const a = article as Record<string, unknown>

  const idRaw = typeof a.id === 'number' && Number.isFinite(a.id) ? String(a.id) : typeof a.id === 'string' ? a.id.trim() : ''
  if (idRaw.length === 0 || idRaw.length > 128) return dropped('missing_id', 'id')
  const title = typeof a.title === 'string' ? a.title.trim() : ''
  if (title.length === 0 || title.length > 1000) return dropped('missing_title', 'title')
  if (a.is_public === false) return dropped('not_public', 'is_public')
  if (a.is_retracted === true) return dropped('retracted', 'is_retracted')

  // 年份：显式 year 优先，其次 published_at
  const maxYear = opts.maxYear ?? new Date().getUTCFullYear() + 1
  let year: number | null = null
  if (present(a.year)) {
    const y = toNumber(a.year)
    if (y !== null && Number.isInteger(y) && y >= 1000 && y <= maxYear) year = y
    else issues.push({ code: 'invalid_year', field: 'year', action: 'field_cleared' })
  } else if (present(a.published_at)) {
    const d = a.published_at instanceof Date ? a.published_at : typeof a.published_at === 'string' ? new Date(a.published_at) : null
    const y = d && !Number.isNaN(d.getTime()) ? d.getUTCFullYear() : null
    if (y !== null && y >= 1000 && y <= maxYear) year = y
    else issues.push({ code: 'invalid_year', field: 'published_at', action: 'field_cleared' })
  }

  let url: string | null = null
  if (present(a.url)) {
    url = safeHttpUrl(a.url)
    if (!url) issues.push({ code: 'invalid_url', field: 'url', action: 'field_cleared' })
  }
  let doi: string | null = null
  if (present(a.doi)) {
    const d = normalizeDoi(a.doi)
    if (d) doi = `https://doi.org/${d}`
    else issues.push({ code: 'invalid_doi', field: 'doi', action: 'field_cleared' })
  }

  // 标签：原文去首尾空白保留；归一后重复的只留第一个写法；空的、太长的丢掉
  const maxTags = opts.maxTags ?? ONSITE_MAX_TAGS
  const tags: string[] = []
  const seen = new Set<string>()
  let badTag = false
  let tooMany = false
  for (const raw of Array.isArray(a.tags) ? a.tags : []) {
    const key = normalizeTag(raw)
    if (!key || typeof raw !== 'string' || raw.trim().length > TAG_MAX_LENGTH * 2) { badTag = true; continue }
    if (seen.has(key)) continue
    if (tags.length >= maxTags) { tooMany = true; continue }
    seen.add(key)
    tags.push(raw.trim())
  }
  if (badTag) issues.push({ code: 'tag_invalid', field: 'tags', action: 'field_cleared' })
  if (tooMany) issues.push({ code: 'too_many_tags', field: 'tags', action: 'value_adjusted' })

  const authors = (Array.isArray(a.authors) ? a.authors : [])
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0 && x.length <= 200)
    .slice(0, 20)

  let study_type: EvidenceStudyDesign | null = null
  if (present(a.study_design)) {
    study_type = inVocab(EVIDENCE_STUDY_DESIGNS, a.study_design)
    if (!study_type) issues.push({ code: 'unknown_study_design', field: 'study_design', action: 'field_cleared' })
  }
  const pubType = typeof a.publication_type === 'string' && a.publication_type.trim().length > 0 && a.publication_type.trim().length <= 40
    ? a.publication_type.trim().toLowerCase()
    : null

  let claim: EvidenceSelfReportedClaim | null = null
  if (present(a.claim)) {
    claim = inVocab(EVIDENCE_SELF_REPORTED_CLAIMS, a.claim)
    if (!claim) issues.push({ code: 'unknown_claim', field: 'claim', action: 'field_cleared' })
  }
  let direction: EvidenceDirection | null = null
  if (present(a.direction)) {
    direction = inVocab(EVIDENCE_DIRECTIONS, a.direction)
    if (!direction) issues.push({ code: 'unknown_direction', field: 'direction', action: 'field_cleared' })
  }

  const effect = intakeEffect(a.effect, issues)
  if (effect) {
    const derived = directionFromEffect(effect)
    if ((direction === 'favours' || direction === 'against') && (derived === 'favours' || derived === 'against') && derived !== direction) {
      issues.push({ code: 'direction_conflicts_effect', field: 'direction', action: 'value_adjusted' })
      direction = 'unclear'
      effect.higher_is_better = null
    } else if (direction === null && derived !== null) {
      direction = derived
    }
    const excludes = intervalExcludesNull(effect)
    if (excludes !== null) {
      if ((claim === 'significant' && !excludes) || (claim === 'non_significant' && excludes)) {
        issues.push({ code: 'claim_conflicts_ci', field: 'claim', action: 'flagged' })
      }
      const p = effect.p_value
      if (p != null && ((p <= 0.04 && !excludes) || (p >= 0.06 && excludes))) {
        issues.push({ code: 'p_conflicts_ci', field: 'effect.p_value', action: 'flagged' })
      }
    }
  }

  const references: string[] = []
  const refSeen = new Set<string>()
  for (const ref of Array.isArray(a.references) ? a.references : []) {
    const d = normalizeDoi(typeof ref === 'string' ? ref : ref && typeof ref === 'object' ? (ref as { doi?: unknown }).doi : null)
    if (d && !refSeen.has(d)) { refSeen.add(d); references.push(d) }
    if (references.length >= 500) break
  }

  const record: EvidenceRecord = {
    id: `onsite:${idRaw}`,
    source: 'onsite',
    external_id: idRaw,
    title,
    year,
    authors,
    doi,
    url: url ?? doi,
    topic_ids: [],
    study_type,
    publication_type: pubType,
    self_reported_claim: claim,
    direction,
    effect,
    cited_by_count: null,
    is_retracted: false,
    is_open_access: null,
    provenance: {
      source_label: opts.source_label ?? ONSITE_DEFAULT_LABEL,
      license: opts.license ?? ONSITE_DEFAULT_LICENSE,
      retrieved_at: opts.retrieved_at ?? new Date().toISOString(),
    },
    tags,
  }
  return { record, issues, references }
}

/** 一批文章入库；只把有问题的文章列进 `issues`。 */
export function intakeArticles(articles: readonly unknown[], opts: OnsiteIntakeOptions = {}) {
  const retrieved_at = opts.retrieved_at ?? new Date().toISOString()
  const records: EvidenceRecord[] = []
  const references = new Map<string, string[]>()
  const issues: Array<{ article_id: string | null; issues: EvidenceIntakeIssue[] }> = []
  for (const a of articles) {
    const r = intakeArticle(a, { ...opts, retrieved_at })
    if (r.record) {
      records.push(r.record)
      if (r.references.length > 0) references.set(r.record.id, r.references)
    }
    if (r.issues.length > 0) {
      const id = a && typeof a === 'object' ? (a as { id?: unknown }).id : null
      issues.push({ article_id: typeof id === 'string' || typeof id === 'number' ? String(id) : null, issues: r.issues })
    }
  }
  return { records, references, issues }
}

// ── 站内维度注册表 ─────────────────────────────────────────────────────────────

/** 站内记录少于这个数时，所有站内图都印 `small_corpus`（与比例门槛同一个数）。 */
export const SMALL_CORPUS = 30

export interface OnsiteDimensionSpec {
  id: OnsiteDimensionId
  partition: boolean
  denominator: EvidenceDenominatorKind
  caveats: readonly EvidenceCaveat[]
  /** 桶名怎么来：`dict` 前端按 key 查词典 · `tag` 标签别名组的显示名 · `source` 原值 */
  labels: 'dict' | 'tag' | 'source'
  /** 从一条记录取桶键；互斥维回 [键] 或 null（没有值），多标签维回数组 */
  keys: (r: EvidenceRecord) => string[] | null
}

export const ONSITE_DIMENSIONS: Record<OnsiteDimensionId, OnsiteDimensionSpec> = {
  publication_year: {
    id: 'publication_year', partition: true, denominator: 'works_with_value', caveats: ['onsite_self_selected'], labels: 'source',
    keys: (r) => (r.year != null ? [String(r.year)] : null),
  },
  publication_type: {
    id: 'publication_type', partition: true, denominator: 'works_with_value', caveats: ['onsite_self_selected', 'not_study_design'], labels: 'dict',
    keys: (r) => (r.publication_type ? [r.publication_type] : null),
  },
  study_type: {
    id: 'study_type', partition: true, denominator: 'works_with_value', caveats: ['onsite_self_selected', 'self_reported'], labels: 'dict',
    keys: (r) => (r.study_type ? [r.study_type] : null),
  },
  tag: {
    id: 'tag', partition: false, denominator: 'works_in_scope', caveats: ['onsite_self_selected', 'multi_label', 'cooccurrence_not_citation'], labels: 'tag',
    keys: (r) => recordTagKeys(r),
  },
  self_reported_claim: {
    id: 'self_reported_claim', partition: true, denominator: 'works_with_value',
    caveats: ['onsite_self_selected', 'self_reported', 'positive_rate_not_efficacy'], labels: 'dict',
    keys: (r) => (r.self_reported_claim ? [r.self_reported_claim] : null),
  },
}

/** 站内的证据与缺口图：行＝标签，列＝研究设计（「哪些话题有哪些设计的研究，哪里是空白」，Snilstveit et al. 2016）。 */
export const ONSITE_EGM_PAIR = { rows: 'tag', cols: 'study_type' } as const satisfies { rows: OnsiteDimensionId; cols: OnsiteDimensionId }

export interface OnsiteCountOptions {
  /** 不计入的标签键（焦点标签自己：否则它恒等于总数，是筛选的产物不是发现） */
  excludeKeys?: readonly string[] | undefined
  source_label?: string | undefined
  license?: string | undefined
  retrieved_at?: string | undefined
}

const onsiteProvenance = (query: string, o: OnsiteCountOptions): EvidenceCountProvenance => ({
  source_label: o.source_label ?? ONSITE_DEFAULT_LABEL,
  license: o.license ?? ONSITE_DEFAULT_LICENSE,
  query,
  retrieved_at: o.retrieved_at ?? new Date().toISOString(),
  credits: 0,
})

const withSmallCorpus = (caveats: readonly EvidenceCaveat[], n: number): EvidenceCaveat[] =>
  n < SMALL_CORPUS ? [...caveats, 'small_corpus'] : [...caveats]

/** 按一个站内维度数格子。`count = 0` 的桶不出现（站内维度没有「查过是零」的固定桶）。 */
export function countOnsite(records: readonly EvidenceRecord[], dimension: OnsiteDimensionId, opts: OnsiteCountOptions = {}): EvidenceCountSeries<OnsiteDimensionId> {
  const spec = ONSITE_DIMENSIONS[dimension]
  const exclude = new Set(opts.excludeKeys ?? [])
  const counts = new Map<string, number>()
  let unknown = 0
  for (const r of records) {
    const keys = spec.keys(r)
    if (keys === null) { unknown++; continue }
    for (const k of new Set(keys)) if (!exclude.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const labels = spec.labels === 'tag' ? new Map(groupTags(records).map((g) => [g.key, g.label])) : null
  const cells = [...counts.entries()].map(([key, count]) => ({ key, label: labels?.get(key) ?? key, count }))
  if (dimension === 'publication_year') cells.sort((a, b) => Number(a.key) - Number(b.key))
  else cells.sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1))
  const withValue = records.length - unknown
  return {
    dimension,
    cells,
    denominator: spec.partition ? { kind: spec.denominator, value: withValue } : { kind: spec.denominator, value: records.length },
    partition: spec.partition,
    unknown: spec.partition ? unknown : null,
    provenance: onsiteProvenance(`onsite:group_by=${dimension}`, opts),
    caveats: withSmallCorpus(spec.caveats, records.length),
  }
}

/**
 * 站内证据与缺口图：标签（行，取前 `topRows` 个）× 研究设计（列）。
 * 行的 `count` 是带这个标签的全部记录；`cross` 只数申报了设计的——两者之差就是「没申报设计」的，前端照实画出来。
 */
export function crossOnsite(records: readonly EvidenceRecord[], opts: OnsiteCountOptions & { topRows?: number } = {}): EvidenceCountSeries<OnsiteDimensionId> {
  const rows = countOnsite(records, 'tag', opts)
  const top = rows.cells.slice(0, opts.topRows ?? 12)
  // 每条记录的标签键只算一次（行 × 记录的循环里反复归一会很贵）
  const designed = records.filter((r) => r.study_type).map((r) => ({ design: r.study_type!, keys: new Set(recordTagKeys(r)) }))
  const cross = top.map((row) => {
    const byDesign = new Map<string, number>()
    for (const r of designed) {
      if (!r.keys.has(row.key)) continue
      byDesign.set(r.design, (byDesign.get(r.design) ?? 0) + 1)
    }
    return EVIDENCE_STUDY_DESIGNS.filter((d) => byDesign.has(d)).map((d) => ({ key: d, label: d, count: byDesign.get(d)! }))
  })
  return {
    ...rows,
    by: 'study_type',
    cells: top,
    cross,
    provenance: onsiteProvenance('onsite:group_by=tag,study_type', opts),
    caveats: withSmallCorpus(['onsite_self_selected', 'self_reported', 'multi_label'], records.length),
  }
}

// ── 标签共现图 ─────────────────────────────────────────────────────────────────

export interface TagGraphOptions extends OnsiteCountOptions {
  /** 支持度门槛（标签与边都要 ≥ 它）；缺省 2——只出现过一次的共现是噪声 */
  minSupport?: number
  /** 最多画几个标签 */
  maxNodes?: number
  /** 以这个标签键为中心画邻域图（只看带它的记录）；缺省画全站 */
  focus?: string | null
  /** 每条记录最多取几个标签参与配对（防止一条记录几百个标签把图撑爆） */
  maxTagsPerRecord?: number
}

export const TAG_GRAPH_DEFAULTS = { minSupport: 2, maxNodes: 60, maxTagsPerRecord: ONSITE_MAX_TAGS } as const

/** 站内标签共现图：节点＝标签（别名组），边＝两个标签同时出现在几篇文章上。折叠了多少如实回报。 */
export function buildTagGraph(records: readonly EvidenceRecord[], opts: TagGraphOptions = {}): EvidenceTagGraph {
  const minSupport = Math.max(1, Math.floor(opts.minSupport ?? TAG_GRAPH_DEFAULTS.minSupport))
  const maxNodes = Math.max(1, Math.floor(opts.maxNodes ?? TAG_GRAPH_DEFAULTS.maxNodes))
  const perRecord = Math.max(2, Math.floor(opts.maxTagsPerRecord ?? TAG_GRAPH_DEFAULTS.maxTagsPerRecord))
  const focus = opts.focus ? normalizeTag(opts.focus) : null
  const pool = focus ? records.filter((r) => recordTagKeys(r).includes(focus)) : records
  const n = pool.length

  const count = new Map<string, number>()
  const pair = new Map<string, number>()
  for (const r of pool) {
    const keys = recordTagKeys(r).slice(0, perRecord)
    if (focus && !keys.includes(focus)) keys[keys.length - 1] = focus
    for (const k of keys) count.set(k, (count.get(k) ?? 0) + 1)
    const sorted = [...keys].sort()
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const id = `${sorted[i]}\u0000${sorted[j]}`
        pair.set(id, (pair.get(id) ?? 0) + 1)
      }
    }
  }
  const labels = new Map(groupTags(pool).map((g) => [g.key, g.label]))
  const eligible = [...count.entries()]
    .filter(([k, c]) => c >= minSupport || k === focus)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  let kept = eligible.slice(0, maxNodes)
  if (focus && !kept.some(([k]) => k === focus) && count.has(focus)) kept = [[focus, count.get(focus)!], ...kept.slice(0, maxNodes - 1)]
  const keptSet = new Set(kept.map(([k]) => k))
  const nodes: EvidenceTagNode[] = kept.map(([key, c]) => ({ key, label: labels.get(key) ?? key, count: c, topic_id: null }))

  const edges: EvidenceTagEdge[] = []
  for (const [id, c] of pair) {
    if (c < minSupport) continue
    const [a, b] = id.split('\u0000')
    if (!keptSet.has(a) || !keptSet.has(b)) continue
    const ca = count.get(a)!
    const cb = count.get(b)!
    edges.push({ a, b, count: c, jaccard: c / (ca + cb - c), lift: (c * n) / (ca * cb) })
  }
  edges.sort((x, y) => y.count - x.count || y.lift - x.lift || (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : 1))

  return {
    focus,
    nodes,
    edges,
    min_support: minSupport,
    collapsed: { tags: count.size - nodes.length, edges: pair.size - edges.length },
    records: n,
    caveats: withSmallCorpus(['onsite_self_selected', 'cooccurrence_not_citation'], n),
    provenance: onsiteProvenance(`onsite:tag_cooccurrence?min_support=${minSupport}${focus ? '&focus=' + encodeURIComponent(focus) : ''}`, opts),
  }
}

// ── 记录之间的边（EvidenceEdge 的生产端）──────────────────────────────────────────────

export interface RecordEdgeOptions {
  /** 不算进「同标签」的标签键（焦点标签：人人都有，连出来是一张没有信息的完全图） */
  focusKeys?: readonly string[]
  /** 两篇站内文章至少共有几个（焦点以外的）标签才连同标签边；缺省 1 */
  minSharedTags?: number
  /** 同标签边最多几条（按共有标签数从多到少取）；引用边不设上限。缺省 200 */
  maxSharedTagEdges?: number
}

/**
 * 这批记录之间的边：
 *   · `cites`：站内文章在参考文献里申报的 DOI，对上了这批记录里另一条记录的 DOI（站内文章或外部示例都算）；
 *   · `shares_tag`：两篇站内文章除焦点标签外还共有标签——是**共现**，不是引用、不是合作（图注 `cooccurrence_not_citation`）。
 * `references` 是 intake 给出的「记录 id → 归一化 DOI 列表」。边按确定的次序输出，同一对只出一条。
 */
export function buildRecordEdges(
  records: readonly EvidenceRecord[], references: ReadonlyMap<string, readonly string[]>, opts: RecordEdgeOptions = {},
): EvidenceEdge[] {
  const byDoi = new Map<string, string[]>()
  for (const r of records) {
    const d = normalizeDoi(r.doi)
    if (!d) continue
    const list = byDoi.get(d) ?? []
    list.push(r.id)
    byDoi.set(d, list)
  }
  const edges: EvidenceEdge[] = []
  const seen = new Set<string>()
  for (const r of records) {
    for (const d of references.get(r.id) ?? []) {
      for (const to of byDoi.get(d) ?? []) {
        const id = `${r.id}\u0000${to}\u0000cites`
        if (to === r.id || seen.has(id)) continue
        seen.add(id)
        edges.push({ from: r.id, to, kind: 'cites' })
      }
    }
  }
  const focus = new Set(opts.focusKeys ?? [])
  const minShared = Math.max(1, opts.minSharedTags ?? 1)
  const onsite = records
    .filter((r) => r.source === 'onsite')
    .map((r) => ({ id: r.id, keys: new Set(recordTagKeys(r).filter((k) => !focus.has(k))) }))
    .filter((r) => r.keys.size > 0)
  const shared: Array<{ a: string; b: string; n: number }> = []
  for (let i = 0; i < onsite.length; i++) {
    for (let j = i + 1; j < onsite.length; j++) {
      let n = 0
      for (const k of onsite[i].keys) if (onsite[j].keys.has(k)) n++
      if (n >= minShared) {
        const [a, b] = onsite[i].id < onsite[j].id ? [onsite[i].id, onsite[j].id] : [onsite[j].id, onsite[i].id]
        shared.push({ a, b, n })
      }
    }
  }
  shared.sort((x, y) => y.n - x.n || (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : 1))
  for (const e of shared.slice(0, Math.max(0, opts.maxSharedTagEdges ?? 200))) edges.push({ from: e.a, to: e.b, kind: 'shares_tag' })
  return edges
}

// ── 站内层（给一个标签或一个主题下的标签组装全部站内格子）─────────────────────────────

export function countOnsiteLayer(records: readonly EvidenceRecord[], input: {
  scope: EvidenceOnsiteCounts['scope']
  graph?: TagGraphOptions | false
} & OnsiteCountOptions): EvidenceOnsiteCounts {
  const base: OnsiteCountOptions = {
    source_label: input.source_label, license: input.license, retrieved_at: input.retrieved_at ?? new Date().toISOString(),
  }
  const exclude = input.excludeKeys ?? (input.scope.level === 'tag' ? input.scope.tag_keys : [])
  const series = ONSITE_DIMENSION_IDS.map((d) =>
    d === 'tag' ? crossOnsite(records, { ...base, excludeKeys: exclude }) : countOnsite(records, d, base))
  const availability = Object.fromEntries(series.map((s) => [s.dimension, chartAvailabilityFor({
    ...chartShapeOf({ dimension: s.dimension, series: s, overlap: null, hasCross: !!s.cross, egmPair: ONSITE_EGM_PAIR, records }),
    onsite_n: records.length,
  })])) as Record<OnsiteDimensionId, EvidenceChartAvailability[]>
  const tag_graph = input.graph === false ? null : buildTagGraph(records, {
    ...base, ...(input.graph ?? {}), focus: input.scope.level === 'tag' ? input.scope.tag_keys[0] ?? null : null,
  })
  return { scope: input.scope, total: records.length, series, availability, tag_graph }
}

/** 注册表与契约值域同源。 */
export function onsiteDimensionsMatchContract(): boolean {
  return JSON.stringify(Object.keys(ONSITE_DIMENSIONS).sort()) === JSON.stringify([...ONSITE_DIMENSION_IDS].sort())
}
