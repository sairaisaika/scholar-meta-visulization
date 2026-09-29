/**
 * 研究脚手架的**维度注册表**（当前按 OpenAlex 的字段声明）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 纯声明，零 IO 零 React。
 * 每个维度声明它**是什么形状**，而不是让画图的人去猜：
 *   · `partition`：互斥划分（每篇至多一个桶）。多标签维的桶和可以大于分母 ⇒ **禁饼图、禁 100% 堆叠**（charts.ts 据此灰掉）；
 *   · `denominator`：分母由维度自己声明——拿总数当分母会把「没有数据」算成某一桶（全球南方那条就是这么低估的，见下）；
 *   · `multiDimOk`：能不能进 OpenAlex 的多维 group_by（`topics.field.id`、`is_retracted` 实测 400）；
 *   · `caveats`：图注里必须印的那几句（键的值域在契约 `EVIDENCE_CAVEATS`；作为数据字段下发，不做组件属性——属性会被下一个开发者删掉）。
 *
 * 【全球南方的分母（2026-09-23 实测）】ADHD 主题 110,442 篇：`is_global_south:true` 10,968；
 * 原始 false 桶 99,474 里混着 40,073 篇**完全没有机构数据**的作品。若改用「有机构」70,369 作分母是 15.6%，
 * 但再往下查：其中 10,065 篇的机构**没有 OpenAlex id、也就没有国家**——南北根本判不了（`is_global_south:true` 的作品
 * 100% 有机构 id，实测交叉为 0）。所以诚实的分母是「至少一个**可识别**机构」＝ 60,304 ⇒ **18.2%**。
 * 这里取的就是这个；「非南方」桶＝分母 − 南方，不用原始 false 桶。
 */
import type { EvidenceCaveat, EvidenceCountScope, EvidenceDenominatorKind, EvidenceDimensionId, EvidenceScaleLevel } from './types'
import { EVIDENCE_DIMENSION_IDS } from './types'

export interface EvidenceDimensionSpec {
  id: EvidenceDimensionId
  /** OpenAlex 的 group_by 键 */
  groupBy: string
  partition: boolean
  multiDimOk: boolean
  denominator: EvidenceDenominatorKind
  /** 二值维：只信「真」那一桶；「假」＝ 分母 − 真（原始假桶混着未知，见头注） */
  binaryTrueOnly?: boolean
  /** 布尔维：桶 key 归一成 `true` / `false`（OpenAlex 对 `is_retracted` 回的是 `1` / `0`，对全球南方回的是 `true` / `false`，2026-09-23 实测） */
  boolean?: true
  caveats: readonly EvidenceCaveat[]
  /** 桶的显示名怎么来：词典（封闭小词表；词典里没有的新值回落到源给的原文）· 浏览器 Intl.DisplayNames（国家 / 语言码，多语言免手抄）· 源给的原文 */
  labels: 'dict' | 'intl-region' | 'intl-language' | 'source'
}

export const EVIDENCE_DIMENSIONS: Record<EvidenceDimensionId, EvidenceDimensionSpec> = {
  publication_year: { id: 'publication_year', groupBy: 'publication_year', partition: true, multiDimOk: true, denominator: 'works_with_value', caveats: ['recent_years_lag'], labels: 'source' },
  institution_type: { id: 'institution_type', groupBy: 'authorships.institutions.type', partition: false, multiDimOk: true, denominator: 'works_with_identified_institution', caveats: ['producer_not_population', 'multi_label'], labels: 'dict' },
  global_south: { id: 'global_south', groupBy: 'authorships.institutions.is_global_south', partition: true, multiDimOk: true, denominator: 'works_with_identified_institution', binaryTrueOnly: true, boolean: true, caveats: ['producer_not_population', 'unknown_excluded'], labels: 'dict' },
  country: { id: 'country', groupBy: 'authorships.countries', partition: false, multiDimOk: true, denominator: 'works_with_country', caveats: ['producer_not_population', 'multi_label'], labels: 'intl-region' },
  language: { id: 'language', groupBy: 'language', partition: true, multiDimOk: true, denominator: 'works_with_value', caveats: [], labels: 'intl-language' },
  oa_status: { id: 'oa_status', groupBy: 'open_access.oa_status', partition: true, multiDimOk: true, denominator: 'works_with_value', caveats: ['oa_nominal'], labels: 'dict' },
  publication_type: { id: 'publication_type', groupBy: 'type', partition: true, multiDimOk: true, denominator: 'works_with_value', caveats: ['not_study_design'], labels: 'dict' },
  retracted: { id: 'retracted', groupBy: 'is_retracted', partition: true, multiDimOk: false, denominator: 'works_with_value', boolean: true, caveats: ['retraction_lower_bound'], labels: 'dict' },
  subfield: { id: 'subfield', groupBy: 'topics.subfield.id', partition: false, multiDimOk: true, denominator: 'works_in_scope', caveats: ['cooccurrence_not_citation', 'multi_label', 'focus_diagonal'], labels: 'source' },
}

/** 分母要另查的那两种（各 1 credit；其余分母从桶和或总数直接得出）。过滤串逐字实测过。 */
export const DENOMINATOR_FILTERS: Partial<Record<EvidenceDenominatorKind, string>> = {
  works_with_identified_institution: 'authorships.institutions.id:!null',
  works_with_country: 'authorships.countries:!null',
}

/** 证据与缺口图的交叉对：目前只有这一对（两维都能进多维 group_by，实测 1 credit 拿全表）。行＝机构部门，列＝年份。 */
export const EGM_PAIR = { rows: 'institution_type', cols: 'publication_year' } as const satisfies { rows: EvidenceDimensionId; cols: EvidenceDimensionId }

/** UpSet（包含式两两交集）只对机构部门做：取最大的几个集合，每多一个集合 1 credit。 */
export const OVERLAP_DIMENSION: EvidenceDimensionId = 'institution_type'
export const OVERLAP_TOP_SETS = 4

/**
 * 节点 × 口径 → OpenAlex 过滤串。tag 级没有节点（先解析成主题）⇒ null；id 形状不对 ⇒ null（不拼进查询）。
 * 上级三级的 id 是纯数字（subfield 2738 / field 27 / domain 4），与主题的 `T…` 分开验形。
 */
export function scopeFilter(level: EvidenceScaleLevel, externalId: string, scope: EvidenceCountScope): string | null {
  const base = scope === 'primary_topic' ? 'primary_topic' : 'topics'
  if (level === 'topic') return /^T\d+$/.test(externalId) ? `${base}.id:${externalId}` : null
  if (level === 'subfield' || level === 'field' || level === 'domain') return /^\d+$/.test(externalId) ? `${base}.${level}.id:${externalId}` : null
  return null
}

/** group_by 的桶 key 有两种形：裸值（`education`）与实体 URL（`https://openalex.org/countries/US`）——统一取尾段。 */
export function bucketKey(raw: string): string {
  const tail = raw.split('/').pop()
  return tail && tail.length > 0 ? tail : raw
}

/** 注册表与契约值域同源（加维度只改一边会在测试里红）。 */
export function dimensionsMatchContract(): boolean {
  const keys = Object.keys(EVIDENCE_DIMENSIONS).sort()
  return JSON.stringify(keys) === JSON.stringify([...EVIDENCE_DIMENSION_IDS].sort())
}
