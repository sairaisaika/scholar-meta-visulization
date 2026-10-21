import { buildSynthesisTable, intakeOutcomeRows, type SynthesisContext } from '../src/synthesis'
import { intakeArticle } from '../src/onsite'
import type { EvidenceRecord } from '../src/types'

const record = (id: string): EvidenceRecord => intakeArticle({ id, title: `Report ${id}`, study_design: 'rct', effect: { metric: 'md', value: 2, ci_low: 1, ci_high: 3, n: 80, higher_is_better: true } }, { retrieved_at: '2026-10-21T00:00:00Z' }).record!
const context = (id: string, over: Partial<SynthesisContext> = {}): SynthesisContext => ({ record_id: `onsite:${id}`, report_id: `report:${id}`, study_id: `study:${id}`, dependence_id: `participants:${id}`, outcome: 'function', population: 'adults', comparison: 'A-v-B', timepoint: '12-weeks', unit: 'scale-points', analysis: 'unadjusted', kind: 'continuous', locator: 'Table 2, row 1', reviewed: true, independence_verified: true, ...over })
const ids = ['a', 'b', 'c', 'd', 'e']

describe('multi-outcome synthesis table', () => {
  it('structured multi-outcome intake retains report identity, source and separate values', () => {
    const result = intakeOutcomeRows({ id: 'article', title: 'Two outcomes', study_design: 'rct' }, [
      { id: 'benefit', effect: record('x').effect, context: context('x') },
      { id: 'harm', effect: { ...record('x').effect!, value: 3 }, context: context('x', { outcome: 'harm' }) },
    ])
    const table = buildSynthesisTable(result.records, result.contexts)
    expect(result.records.map(r => r.effect?.value)).toEqual([2, 3])
    expect(table.counts).toEqual({ reports: 1, studies: 1, observations: 2, unidentified: 0 })
    expect(table.rows.map(r => r.context?.report_id)).toEqual(['onsite:article', 'onsite:article'])
  })
  it.each([{ is_public: false }, { is_retracted: true }])('outcome rows cannot bypass article intake gate %j', gate => {
    expect(intakeOutcomeRows({ id: 'private', title: 'Hidden', ...gate }, [{ id: 'a', effect: record('x').effect, is_public: true }]).records).toEqual([])
  })
  it('duplicate row IDs are rejected together; missing numeric extraction is never copied from the article', () => {
    const article = { id: 'report', title: 'A', effect: record('x').effect }
    expect(intakeOutcomeRows(article, [{ id: 'a' }, { id: 'a' }]).records).toEqual([])
    expect(intakeOutcomeRows(article, [{ id: 'b' }]).records[0].effect).toBeNull()
    expect(intakeOutcomeRows(article, []).records).toHaveLength(1)
  })
  it('verified comparable independent rows pass the existing numeric gate; no overall score', () => {
    const r = buildSynthesisTable(ids.map(record), ids.map(id => context(id)))
    expect(r.facets).toHaveLength(1)
    expect(r.facets[0].blockers).toEqual([])
    expect(r.facets[0].pooling?.allowed).toBe(true)
    expect(r.facets[0].pooling?.estimate?.k).toBe(5)
    expect(r.overall).toBeNull()
    expect(r.counts).toEqual({ reports: 5, studies: 5, observations: 5, unidentified: 0 })
  })
  it.each(['outcome', 'population', 'comparison', 'timepoint', 'unit', 'analysis'] as const)('%s differs: separate facets, never one pooled diamond', field => {
    const cs = ids.map(id => context(id))
    cs[4][field] = 'different'
    const r = buildSynthesisTable(ids.map(record), cs)
    expect(r.facets).toHaveLength(2)
    expect(r.facets.every(f => f.pooling === null)).toBe(true)
  })
  it.each(['study_id', 'dependence_id'] as const)('shared %s blocks independent-study pooling', field => {
    const cs = ids.map(id => context(id))
    cs[4][field] = cs[0][field]
    const r = buildSynthesisTable(ids.map(record), cs)
    expect(r.facets[0].blockers).toContain('dependent_observations')
    expect(r.facets[0].pooling).toBeNull()
  })
  it.each(['reviewed', 'independence_verified'] as const)('false %s cannot be rescued by a valid effect and large N', field => {
    const r = buildSynthesisTable(ids.map(record), ids.map(id => context(id, { [field]: false })))
    expect(r.facets[0].pooling).toBeNull()
  })
  it('no context or locator preserves the evidence row but cannot claim studies or pool', () => {
    const r = buildSynthesisTable([record('a'), record('b')], [context('a', { locator: '' })])
    expect(r.counts).toEqual({ observations: 2, reports: 0, studies: 0, unidentified: 2 })
    expect(r.rows.every(row => row.issues.includes('missing_or_invalid_context'))).toBe(true)
    expect(r.facets.every(f => f.pooling === null)).toBe(true)
  })
  it('one report, one study, two outcomes: two rows, two facets, one study', () => {
    const r = buildSynthesisTable([record('a'), record('b')], [context('a'), context('b', { report_id: 'report:a', study_id: 'study:a', dependence_id: 'participants:a', outcome: 'harm' })])
    expect(r.counts).toEqual({ observations: 2, reports: 1, studies: 1, unidentified: 0 })
    expect(r.facets).toHaveLength(2)
  })
  it.each(['qualitative', 'composite', 'metadata', 'rate'] as const)('%s is retained and does not produce a spurious meta estimate', kind => {
    const cs = ids.map(id => context(id, { kind, components: [{ label: 'benefit', value: 2, unit: 'points', weight: 0.5 }, { label: 'cost', value: 10, unit: 'USD' }], formula: 'declared formula, not executed' }))
    const r = buildSynthesisTable(ids.map(record), cs)
    expect(r.rows[0].context?.components).toHaveLength(2)
    expect(r.facets[0].pooling).toBeNull()
    expect(r.overall).toBeNull()
  })
  it('duplicates are visible and cannot silently add weight', () => {
    const r = buildSynthesisTable([record('a'), record('a')], [context('a'), context('a')])
    expect(r.rows[0].issues).toEqual(expect.arrayContaining(['duplicate_record', 'duplicate_context']))
    expect(r.facets[0].pooling).toBeNull()
  })
  it('a metadata-only row is not silently dropped from an apparently eligible group', () => {
    const rs = ids.map(record)
    rs[4].effect = null
    const r = buildSynthesisTable(rs, ids.map(id => context(id)))
    expect(r.rows[4].issues).toContain('missing_effect')
    expect(r.facets.every(f => f.pooling === null)).toBe(true)
  })
  it('unknown/review designs cannot qualify just because five numeric effects exist', () => {
    for (const design of [null, 'systematic_review', 'meta_analysis', 'mixed_methods']) {
      const rs = ids.map(id => ({ ...record(id), study_type: design }))
      const r = buildSynthesisTable(rs, ids.map(id => context(id)))
      expect(r.facets[0].blockers).toContain('unsupported_design')
      expect(r.facets[0].pooling).toBeNull()
    }
  })
})
