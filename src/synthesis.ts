/**
 * 编辑侧的多结局证据表。EvidenceRecord 是一个数值观察，不假定一行等于一项独立研究。
 * 宿主先按报告/结局拆行并用 intakeArticle 验形，再提供人工核对的语义上下文。
 * 缺上下文仍可列证据；只有语义与独立性闸均通过才调用现有数值合成。
 */
import type { EvidenceConcept, EvidenceFacetId, EvidenceFrame, EvidenceFrameChange, EvidenceRecord, EvidencePooling, EvidenceViewDecision } from './types'
import { EVIDENCE_FACET_IDS } from './types'
import { assessPooling, pickEvidenceView, poolEvidence } from './ladder'
import { intakeArticle, type OnsiteIntakeOptions } from './onsite'

export interface SynthesisContext {
  record_id: string
  report_id: string
  study_id: string
  /** 同一参与者群/共享对照/重复报告必须用同一键；不是 DOI 或行 ID 的替代品。 */
  dependence_id: string
  outcome: string
  population: string
  comparison: string
  timepoint: string
  unit: string
  /** 例如 adjusted:model-A / unadjusted；调整变量不同不得默认同组。 */
  analysis: string
  kind: 'continuous' | 'binary' | 'ordinal' | 'rate' | 'survival' | 'correlation' | 'qualitative' | 'composite' | 'metadata'
  /** 原文页码/表格/段落定位；不保存未经许可的全文。 */
  locator: string
  /** 宿主审核事实，不是本引擎的身份验证或质量保证。 */
  reviewed: boolean
  /** 仅对普通独立个体分析设 true；聚类/交叉/共享对照在外部正确处理后另行设计接入。 */
  independence_verified: boolean
  components?: readonly { label: string; value: number | null; unit: string; weight?: number | null }[]
  formula?: string
  /**
   * 0.6.0：语境解析到的受控概念（`resolveConcepts`，导出时做）。有 id 的分面在分面键里用 id 代替原文——
   * 两个标注者措辞稍异的行因此同框；没有 id 的行键与以前逐字相同。
   */
  concept_ids?: Partial<Record<EvidenceFacetId, string>>
  /** 0.6.0：原文的时点写法（`timepoint` 可能已被归一） */
  timepoint_raw?: string
}

export interface SynthesisTable {
  rows: Array<{ record: EvidenceRecord; context: SynthesisContext | null; issues: string[] }>
  facets: Array<{ key: string; record_ids: string[]; view: EvidenceViewDecision; blockers: string[]; pooling: EvidencePooling | null }>
  counts: { reports: number; studies: number; observations: number; unidentified: number }
  /** 永不把不相关结局压成一个“总体疗效/质量分”。 */
  overall: null
}

const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 1000
const kinds = ['continuous', 'binary', 'ordinal', 'rate', 'survival', 'correlation', 'qualitative', 'composite', 'metadata']
const fields = ['record_id', 'report_id', 'study_id', 'dependence_id', 'outcome', 'population', 'comparison', 'timepoint', 'unit', 'analysis', 'locator'] as const
const validContext = (c: SynthesisContext) => fields.every(k => text(c[k])) && kinds.includes(c.kind)
  && typeof c.reviewed === 'boolean' && typeof c.independence_verified === 'boolean'
  && (c.formula === undefined || text(c.formula))
  && (c.components === undefined || (Array.isArray(c.components) && c.components.every(x => x && text(x.label) && text(x.unit)
    && (x.value === null || (typeof x.value === 'number' && Number.isFinite(x.value)))
    && (x.weight === undefined || x.weight === null || (typeof x.weight === 'number' && Number.isFinite(x.weight))))))

/** 已有结构化提取/人工录入的收口；不从标题/摘要猜测效应量。每行只覆盖 effect/direction。 */
export function intakeOutcomeRows(article: unknown, outcomes: readonly unknown[], opts: OnsiteIntakeOptions = {}) {
  const fixed = { ...opts, retrieved_at: opts.retrieved_at ?? new Date().toISOString() }
  const base = intakeArticle(article, fixed)
  const records: EvidenceRecord[] = []
  const contexts: SynthesisContext[] = []
  const issues: Array<{ row: number | null; codes: string[] }> = []
  if (!base.record) return { records, contexts, issues: [{ row: null, codes: base.issues.map(i => i.code) }] }
  if (outcomes.length > 500) return { records, contexts, issues: [{ row: null, codes: ['too_many_outcomes'] }] }
  if (outcomes.length === 0) return { records: [base.record], contexts, issues }
  const counts = new Map<string, number>()
  for (const raw of outcomes) {
    const id = raw && typeof raw === 'object' ? (raw as { id?: unknown }).id : null
    if (typeof id === 'string') counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  outcomes.forEach((raw, index) => {
    const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    if (typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(row.id) || counts.get(row.id)! > 1) {
      issues.push({ row: index, codes: ['invalid_or_duplicate_outcome_id'] })
      return
    }
    const result = intakeArticle({ ...(article as object), id: `${base.record!.external_id}/${row.id}`, effect: row.effect ?? null, direction: row.direction ?? null }, fixed)
    if (result.issues.length) issues.push({ row: index, codes: result.issues.map(i => i.code) })
    if (!result.record) return
    records.push(result.record)
    const c = row.context && typeof row.context === 'object'
      ? { ...row.context, record_id: result.record.id, report_id: base.record!.id } as SynthesisContext : null
    if (c && validContext(c)) contexts.push(c)
    else issues.push({ row: index, codes: ['missing_or_invalid_context'] })
  })
  return { records, contexts, issues }
}

/**
 * 分面键（0.6.0 抽出来导出）：结局、人群、比较、时点、单位、分析口径、数据类型、研究设计、度量、方向。
 * 语境解析到概念时（`concept_ids`）用概念 id 代替那一项的原文，其余照原文；没有语境的行各自成组。
 */
export function synthesisFrameKey(context: SynthesisContext | null, record: EvidenceRecord): string {
  if (!context) return JSON.stringify(['unclassified', record.id])
  const c = context.concept_ids ?? {}
  return JSON.stringify([
    c.outcome ?? context.outcome, c.population ?? context.population, c.comparison ?? context.comparison, c.timepoint ?? context.timepoint,
    context.unit, context.analysis, context.kind, record.study_type, record.effect?.metric, record.effect?.higher_is_better,
  ])
}

/**
 * 纯表格/分面视图模型，未增加 HTTP 路由。records 先走 intakeArticle/guards；本函数不做全文 NLP。
 * 使用精确的人工编码分组，标签同名/度量同名都不足以证明可比。
 */
export function buildSynthesisTable(records: readonly EvidenceRecord[], contexts: readonly SynthesisContext[] = []): SynthesisTable {
  const contextMap = new Map<string, SynthesisContext>()
  const contextDuplicates = new Set<string>()
  for (const c of contexts) {
    if (contextMap.has(c.record_id)) contextDuplicates.add(c.record_id)
    contextMap.set(c.record_id, c)
  }
  const frequencies = new Map<string, number>()
  for (const r of records) frequencies.set(r.id, (frequencies.get(r.id) ?? 0) + 1)
  const rows = records.map(record => {
    const raw = contextMap.get(record.id)
    const context = raw && validContext(raw) ? raw : null
    const issues: string[] = []
    if (!context) issues.push('missing_or_invalid_context')
    if (contextDuplicates.has(record.id)) issues.push('duplicate_context')
    if (frequencies.get(record.id)! > 1) issues.push('duplicate_record')
    if (context && !context.reviewed) issues.push('unreviewed')
    if (context && !context.independence_verified) issues.push('dependence_unverified')
    if (context && ['qualitative', 'composite', 'metadata'].includes(context.kind)) issues.push('not_poolable_kind')
    if (!record.study_type || !['rct', 'non_randomised_controlled', 'cohort', 'case_control', 'cross_sectional'].includes(record.study_type)) issues.push('unsupported_design')
    if (record.is_retracted) issues.push('retracted')
    if (!record.effect) issues.push('missing_effect')
    if (record.effect?.metric === 'other') issues.push('unknown_metric')
    if (context && record.effect) {
      const metrics: Record<string, readonly string[]> = { continuous: ['md', 'smd', 'hedges_g', 'cohens_d'], binary: ['or', 'rr'], ordinal: ['md', 'smd', 'hedges_g', 'cohens_d', 'or'], rate: [], survival: ['hr'], correlation: ['r'] }
      if (!metrics[context.kind]?.includes(record.effect.metric)) issues.push('unsupported_kind_metric')
    }
    return { record, context, issues }
  })
  const groups = new Map<string, typeof rows>()
  rows.forEach(row => {
    const key = synthesisFrameKey(row.context, row.record)
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  })
  const facets = [...groups].map(([key, group]) => {
    const blockers = new Set(group.flatMap(row => row.issues))
    const studies = group.map(row => row.context?.study_id).filter(text)
    const dependence = group.map(row => row.context?.dependence_id).filter(text)
    if (new Set(studies).size < studies.length || new Set(dependence).size < dependence.length) blockers.add('dependent_observations')
    const rs = group.map(row => row.record)
    const decision = assessPooling(rs)
    if (!decision.allowed) blockers.add(decision.reason)
    return { key, record_ids: rs.map(r => r.id), view: pickEvidenceView(rs), blockers: [...blockers], pooling: blockers.size === 0 ? poolEvidence(rs) : null }
  })
  return {
    rows, facets,
    counts: { reports: new Set(rows.map(r => r.context?.report_id).filter(text)).size, studies: new Set(rows.map(r => r.context?.study_id).filter(text)).size,
      observations: rows.length, unidentified: rows.filter(r => !r.context).length },
    overall: null,
  }
}

// ── frame：有方法学意义的「组合」（0.6.0）────────────────────────────────────────────

/** 把一张表的分面整理成 frame 列表（有语境的分面才算 frame；各自成组的无语境行不算）。 */
export function summarizeFrames(
  table: SynthesisTable,
  meta: { topicsOf?: (recordId: string) => readonly string[]; tagsOf?: (recordId: string) => readonly string[]; concepts?: readonly EvidenceConcept[]; locale?: string } = {},
): EvidenceFrame[] {
  const byRecord = new Map(table.rows.map((r) => [r.record.id, r]))
  const conceptLabel = (id: string): string | null => {
    const c = meta.concepts?.find((x) => x.id === id)
    if (!c) return null
    const lang = (meta.locale ?? 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'
    return c.label[lang] ?? c.label.en ?? Object.values(c.label)[0] ?? null
  }
  const out: EvidenceFrame[] = []
  for (const f of table.facets) {
    const rows = f.record_ids.map((id) => byRecord.get(id)).filter((r): r is NonNullable<typeof r> => !!r)
    const first = rows.find((r) => r.context)
    if (!first?.context) continue
    const c = first.context
    const ids = c.concept_ids ?? {}
    const facets: EvidenceFrame['facets'] = {
      outcome: ids.outcome ?? c.outcome, population: ids.population ?? c.population, comparison: ids.comparison ?? c.comparison,
      timepoint: ids.timepoint ?? c.timepoint, unit: c.unit, analysis: c.analysis, kind: c.kind,
    }
    if (ids.intervention) facets.intervention = ids.intervention
    const labels: NonNullable<EvidenceFrame['concept_labels']> = {}
    for (const facet of EVIDENCE_FACET_IDS) {
      const id = ids[facet]
      const label = id ? conceptLabel(id) : null
      if (label) labels[facet] = label
    }
    const records = rows.map((r) => r.record)
    const topics = new Set<string>()
    const tags = new Set<string>()
    for (const r of records) {
      for (const t of meta.topicsOf?.(r.id) ?? r.topic_ids) topics.add(t)
      for (const t of meta.tagsOf?.(r.id) ?? []) tags.add(t)
    }
    out.push({
      key: f.key,
      facets,
      ...(Object.keys(labels).length > 0 ? { concept_labels: labels } : {}),
      study_type: records[0]?.study_type ?? null,
      metric: records[0]?.effect?.metric ?? null,
      higher_is_better: records[0]?.effect?.higher_is_better ?? null,
      record_ids: [...f.record_ids],
      works: new Set(rows.map((r) => r.context?.report_id ?? r.record.id)).size,
      studies: new Set(rows.map((r) => r.context?.study_id ?? r.record.id)).size,
      view: f.view,
      pooling: f.pooling,
      blockers: [...f.blockers].sort(),
      topic_ids: [...topics].sort(),
      tag_keys: [...tags].sort(),
    })
  }
  return out.sort((a, b) => b.record_ids.length - a.record_ids.length || (a.key < b.key ? -1 : 1))
}

/** 「加上这篇之后」：逐 frame 列出前后的变化（新 frame、级别变了、能不能汇总变了、条数变了、阻止原因变了）。 */
export function previewFrameChange(before: readonly EvidenceFrame[], after: readonly EvidenceFrame[]): EvidenceFrameChange[] {
  const prev = new Map(before.map((f) => [f.key, f]))
  const out: EvidenceFrameChange[] = []
  for (const f of after) {
    const b = prev.get(f.key) ?? null
    const changed: EvidenceFrameChange['changed'] = []
    if (!b || b.view.kind !== f.view.kind) changed.push('view')
    if (!b || (b.pooling?.allowed ?? false) !== (f.pooling?.allowed ?? false)) changed.push('pooling')
    if (!b || b.record_ids.length !== f.record_ids.length) changed.push('count')
    if (!b || b.blockers.join('|') !== f.blockers.join('|')) changed.push('blockers')
    out.push({ key: f.key, before: b, after: f, changed })
  }
  return out
}
