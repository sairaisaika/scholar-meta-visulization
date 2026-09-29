/**
 * 读者筛选——钉五件：
 *   ① 只看站内：外部记录、上级、兄弟都去掉；`onsite_only` / `external_match` 不动（那是外部层接没接上，不是读者的选择）；
 *   ② 只看开放获取：外部记录 `is_open_access !== true`（含 null）去掉，站内记录一律保留；
 *   ③ 两个开关叠加 = 交集；
 *   ④ 边随记录走：两端都还在（或一端是焦点）才留；没有 edges 字段就不凭空造一个；
 *   ⑤ 纯函数：入参逐字节不变、返回新对象；视图结论与汇总判定按筛后记录重算。
 */
import { applyEvidenceFilters } from '../src/filters'
import type { EvidenceMapData, EvidenceRecord, EvidenceTopic } from '../src/types'

const topic = (id: string, level: EvidenceTopic['level']): EvidenceTopic => ({
  id: `openalex:${id}`, source: 'openalex', external_id: id, level, display_name: id, description: null, parent_id: null, works_count: null,
})
const rec = (id: string, over: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  id, source: 'openalex', external_id: id.split(':')[1], title: id, year: 2024, authors: [], doi: null, url: null,
  topic_ids: ['openalex:T1'], study_type: null, self_reported_claim: null, direction: null, effect: null,
  cited_by_count: null, is_retracted: false, is_open_access: null,
  provenance: { source_label: 'OpenAlex', license: 'CC0', retrieved_at: '2026-09-28T00:00:00Z' },
  ...over,
})
const data = (): EvidenceMapData => ({
  level: 'topic',
  focus: topic('T1', 'topic'),
  parent: topic('2738', 'subfield'),
  siblings: [topic('T2', 'topic')],
  records: [
    rec('onsite:a1', { source: 'onsite', is_open_access: null }),
    rec('openalex:W1', { is_open_access: true }),
    rec('openalex:W2', { is_open_access: false }),
    rec('openalex:W3', { is_open_access: null }),
  ],
  view: { kind: 'gap_map', usable: 4, total: 4, downgrade_reason: 'no_direction' },
  pooling: { allowed: false, reason: 'not_applicable', studies: 0 },
  sources: [],
  onsite_only: false,
  external_match: 'matched',
  edges: [
    { from: 'onsite:a1', to: 'openalex:W1', kind: 'cites' },
    { from: 'openalex:W2', to: 'openalex:W3', kind: 'cites' },
    { from: 'onsite:a1', to: 'openalex:T1', kind: 'shares_tag' }, // 一端是焦点
    { from: 'openalex:W1', to: 'openalex:W2', kind: 'shares_tag' },
  ],
})
const ids = (rs: readonly { id: string }[]) => rs.map((r) => r.id)
const edgeKeys = (d: EvidenceMapData) => (d.edges ?? []).map((e) => `${e.from}>${e.to}`)
const OFF = { onlyOnsite: false, onlyOa: false }

describe('applyEvidenceFilters', () => {
  it('两个开关都关 ⇒ 记录、树、边原样（但已是新对象）', () => {
    const d = data()
    const out = applyEvidenceFilters(d, OFF)
    expect(out).not.toBe(d)
    expect(ids(out.records)).toEqual(ids(d.records))
    expect(out.parent).toEqual(d.parent)
    expect(out.siblings).toEqual(d.siblings)
    expect(edgeKeys(out)).toEqual(edgeKeys(d))
  })

  it('① 只看站内：外部记录去掉，上级 null、兄弟 []，onsite_only / external_match 不动', () => {
    const out = applyEvidenceFilters(data(), { onlyOnsite: true, onlyOa: false })
    expect(ids(out.records)).toEqual(['onsite:a1'])
    expect(out.parent).toBeNull()
    expect(out.siblings).toEqual([])
    expect(out.focus?.id).toBe('openalex:T1')
    expect(out.onsite_only).toBe(false)
    expect(out.external_match).toBe('matched')
  })

  it('约定：只看站内时 sources 原样保留（脚注仍列出这次查过的全部来源，筛选只是读者的视角）', () => {
    const sources = [
      { source_label: 'On-site articles', license: 'CC BY 4.0', retrieved_at: '2026-09-29T00:00:00Z' },
      { source_label: 'OpenAlex', license: 'CC0 1.0', retrieved_at: '2026-09-29T00:00:00Z' },
    ]
    const out = applyEvidenceFilters({ ...data(), sources }, { onlyOnsite: true, onlyOa: true })
    expect(out.sources).toEqual(sources)
  })

  it('② 只看开放获取：外部记录 false / null 去掉，站内（is_open_access null）保留；树不动', () => {
    const d = data()
    const out = applyEvidenceFilters(d, { onlyOnsite: false, onlyOa: true })
    expect(ids(out.records)).toEqual(['onsite:a1', 'openalex:W1'])
    expect(out.parent).toEqual(d.parent)
    expect(out.siblings).toEqual(d.siblings)
  })

  it('③ 叠加 = 交集', () => {
    const out = applyEvidenceFilters(data(), { onlyOnsite: true, onlyOa: true })
    expect(ids(out.records)).toEqual(['onsite:a1'])
    expect(out.parent).toBeNull()
  })

  it('④ 边随记录走：两端都在（或一端是焦点）才留', () => {
    expect(edgeKeys(applyEvidenceFilters(data(), { onlyOnsite: false, onlyOa: true })))
      .toEqual(['onsite:a1>openalex:W1', 'onsite:a1>openalex:T1'])
    expect(edgeKeys(applyEvidenceFilters(data(), { onlyOnsite: true, onlyOa: false })))
      .toEqual(['onsite:a1>openalex:T1'])
  })

  it('④ 没有 edges 字段 ⇒ 不凭空造（旧服务端不下发时 UI 只画点）', () => {
    const { edges: _drop, ...noEdges } = data()
    void _drop
    const out = applyEvidenceFilters(noEdges, { onlyOnsite: false, onlyOa: true })
    expect('edges' in out).toBe(false)
  })

  it('⑤ 纯函数：入参逐字节不变；返回的记录 / 边数组是新数组', () => {
    const d = data()
    const before = JSON.stringify(d)
    const out = applyEvidenceFilters(d, { onlyOnsite: true, onlyOa: true })
    expect(JSON.stringify(d)).toBe(before)
    expect(out.records).not.toBe(d.records)
    expect(out.edges).not.toBe(d.edges)
    expect(out.siblings).not.toBe(d.siblings)
  })

  it('⑤ 视图结论与汇总判定按筛后记录重算', () => {
    const d = data()
    d.records.push(rec('openalex:W4', {
      is_open_access: true,
      effect: { metric: 'smd', value: -0.4, ci_low: -0.6, ci_high: -0.2, n: 100, higher_is_better: false },
    }))
    // 筛前：有一条带效应量 + CI 的外部记录 ⇒ forest；只看站内后它被筛掉 ⇒ gap_map，且 total 跟着记录数走
    expect(applyEvidenceFilters(d, OFF).view).toEqual({ kind: 'forest', usable: 1, total: 5, downgrade_reason: null })
    const onsite = applyEvidenceFilters(d, { onlyOnsite: true, onlyOa: false })
    expect(onsite.view).toEqual({ kind: 'gap_map', usable: 1, total: 1, downgrade_reason: 'no_direction' })
    expect(onsite.pooling).toEqual({ allowed: false, reason: 'not_applicable', studies: 0, estimate: null })
  })
})
