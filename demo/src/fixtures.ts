/**
 * 演示用的虚构研究：六个场景，各落在证据阶梯的一级上。数值是编的，只为演示判据，不代表任何真实研究。
 * 每个场景写明引擎应当给出的结论（`expect`），test/demo.test.ts 逐条核对：引擎的判据一改，演示对不上就红。
 */
import type {
  EvidenceDirection, EvidenceDowngradeReason, EvidencePoolingReason, EvidenceRecord, EvidenceSelfReportedClaim, EvidenceStudyDesign,
  EvidenceViewKind,
} from '../../src/types'

export const SCENARIO_IDS = ['pooled', 'mixed', 'estimates', 'albatross', 'direction', 'claims'] as const
export type ScenarioId = (typeof SCENARIO_IDS)[number]

export interface Scenario {
  id: ScenarioId
  records: EvidenceRecord[]
  expect: { kind: EvidenceViewKind; downgrade: EvidenceDowngradeReason | null; pooling: EvidencePoolingReason }
}

interface Row {
  key: string
  design: EvidenceStudyDesign
  direction?: EvidenceDirection
  claim?: EvidenceSelfReportedClaim
  /** 标准化均数差（SMD）；只有 p 与样本量的研究不给 */
  value?: number
  lo?: number
  hi?: number
  n?: number
  p?: number
}

const record = (scenario: ScenarioId, r: Row): EvidenceRecord => {
  const hasEffect = r.value !== undefined || r.n !== undefined || r.p !== undefined
  return {
    id: `onsite:demo-${scenario}-${r.key}`, source: 'onsite', external_id: `demo-${scenario}-${r.key}`,
    title: r.key, year: null, authors: [], doi: null, url: null, topic_ids: [],
    study_type: r.design, publication_type: null, self_reported_claim: r.claim ?? null, direction: r.direction ?? null,
    // 只有 p 与样本量、没有点估计：value 记 NaN（与引擎自己的测试同一个写法）
    effect: hasEffect
      ? { metric: 'smd', value: r.value ?? NaN, ci_low: r.lo ?? null, ci_high: r.hi ?? null, n: r.n ?? null, higher_is_better: true, p_value: r.p ?? null }
      : null,
    cited_by_count: null, is_retracted: false, is_open_access: null,
    provenance: { source_label: 'demo', license: 'CC0', retrieved_at: '2026-01-01T00:00:00Z' },
  }
}

const trials: Row[] = [
  { key: 'A', design: 'rct', direction: 'favours', value: 0.62, lo: 0.30, hi: 0.94, n: 160 },
  { key: 'B', design: 'rct', direction: 'favours', value: 0.10, lo: -0.19, hi: 0.39, n: 180 },
  { key: 'C', design: 'rct', direction: 'favours', value: 0.55, lo: 0.18, hi: 0.92, n: 120 },
  { key: 'D', design: 'rct', direction: 'favours', value: 0.28, lo: 0.00, hi: 0.56, n: 190 },
  { key: 'E', design: 'rct', direction: 'favours', value: 0.05, lo: -0.33, hi: 0.43, n: 110 },
]

const rows: Record<ScenarioId, Row[]> = {
  pooled: trials,
  // 同样的数，但 C、E 是队列研究：随机与非随机不合并，不画菱形
  mixed: trials.map((t) => (t.key === 'C' || t.key === 'E' ? { ...t, design: 'cohort' } : t)),
  estimates: [
    { key: 'A', design: 'rct', direction: 'favours', value: 0.35, n: 140 },
    { key: 'B', design: 'rct', direction: 'favours', value: 0.12, n: 200 },
    { key: 'C', design: 'rct', direction: 'favours', value: 0.48, n: 90 },
    { key: 'D', design: 'rct', direction: 'favours', value: 0.22, n: 160 },
    { key: 'E', design: 'rct', direction: 'against', value: -0.05, n: 120 },
    { key: 'F', design: 'rct', direction: 'favours', value: 0.30, n: 110 },
  ],
  albatross: [
    { key: 'A', design: 'rct', direction: 'favours', n: 240, p: 0.004 },
    { key: 'B', design: 'cohort', direction: 'favours', n: 120, p: 0.03 },
    { key: 'C', design: 'cohort', direction: 'against', n: 60, p: 0.45 },
    { key: 'D', design: 'rct', direction: 'favours', n: 80, p: 0.12 },
    { key: 'E', design: 'cohort', direction: 'favours', n: 420, p: 0.0008 },
    { key: 'F', design: 'cross_sectional', direction: 'against', n: 45, p: 0.6 },
    { key: 'G', design: 'rct', direction: 'favours', n: 150, p: 0.07 },
  ],
  direction: [
    { key: 'A', design: 'rct', direction: 'favours' },
    { key: 'B', design: 'rct', direction: 'favours' },
    { key: 'C', design: 'cohort', direction: 'favours' },
    { key: 'D', design: 'cohort', direction: 'unclear' },
    { key: 'E', design: 'cohort', direction: 'favours' },
    { key: 'F', design: 'cross_sectional', direction: 'against' },
    { key: 'G', design: 'cross_sectional', direction: 'favours' },
    { key: 'H', design: 'case_series', direction: 'unclear' },
  ],
  claims: [
    { key: 'A', design: 'cross_sectional', claim: 'significant' },
    { key: 'B', design: 'cross_sectional', claim: 'significant' },
    { key: 'C', design: 'cohort', claim: 'non_significant' },
    { key: 'D', design: 'cross_sectional', claim: 'significant' },
    { key: 'E', design: 'cohort', claim: 'significant' },
    { key: 'F', design: 'case_series', claim: 'non_significant' },
  ],
}

const expectations: Record<ScenarioId, Scenario['expect']> = {
  pooled: { kind: 'forest', downgrade: null, pooling: 'ok' },
  mixed: { kind: 'forest', downgrade: null, pooling: 'mixed_designs' },
  estimates: { kind: 'estimates', downgrade: 'no_variance', pooling: 'no_variance' },
  albatross: { kind: 'albatross', downgrade: 'no_effect_sizes', pooling: 'not_applicable' },
  direction: { kind: 'direction', downgrade: 'no_p_or_n', pooling: 'not_applicable' },
  claims: { kind: 'gap_map', downgrade: 'no_direction', pooling: 'not_applicable' },
}

export const SCENARIOS: readonly Scenario[] = SCENARIO_IDS.map((id) => ({
  id, records: rows[id].map((r) => record(id, r)), expect: expectations[id],
}))
