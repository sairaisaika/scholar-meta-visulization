/**
 * 服务层接社区导出（0.6.0）：
 *   ① 设置 `community.apply` 缺省 off ⇒ 图谱与 0.5.0 完全一样（不碰社区端口）；
 *   ② `tags_and_records` ⇒ 社区作品作为 `source: 'community'` 的记录并进标签级图谱，带研究设计与抄录的效应；
 *      与外部示例同一篇（DOI 相同）时留社区记录、丢外部示例；来源脚注分开印；
 *   ③ 主题级同样并入（按编辑绑定的标签键）；
 *   ④ 社区端口抛错 ⇒ unavailable（不拿一半数据凑图）。
 */
import { createEvidenceService, createMemoryBindingStore, createMemoryOnsiteSource } from '../src/service'
import type { ExternalEvidenceSource } from '../src/service'
import { createCuratedBinding } from '../src/tags'
import { createCommunityPorts, readCommunityExport, DEFAULT_COMMUNITY_POLICY } from '../src/community'
import type { EvidenceCommunityExport, EvidenceCommunityWork, EvidenceRecord, EvidenceTopic } from '../src/types'
import { EVIDENCE_CONTRACT_VERSION } from '../src/types'

const AT = '2026-10-31T00:00:00Z'
const topic: EvidenceTopic = { id: 'openalex:T1', source: 'openalex', external_id: 'T1', level: 'topic', display_name: 'ADHD', description: null, parent_id: null, works_count: 100 }
const ext = (id: string, doi: string | null): EvidenceRecord => ({
  id, source: 'openalex', external_id: id.split(':')[1]!, title: id, year: 2020, authors: [], doi, url: null, topic_ids: ['openalex:T1'], study_type: null, publication_type: 'article',
  self_reported_claim: null, direction: null, effect: null, cited_by_count: 5, is_retracted: false, is_open_access: null, provenance: { source_label: 'OpenAlex', license: 'CC0', retrieved_at: AT },
})
const external: ExternalEvidenceSource = {
  id: 'openalex',
  async suggestTopics() { return [{ topic_id: 'openalex:T1', display_name: 'ADHD', works_count: 100 }] },
  async nodeBundle() { return { node: topic, ancestors: [], siblings: [] } },
  async sampleWorks() { return [ext('openalex:W1', '10.1016/j.jad.2020.01.001'), ext('openalex:W2', '10.1/other')] },
}
const decision = (subject: string, kind: 'tag' | 'facet' | 'row', value: string | null, verification: 'double' | null) => ({
  work_id: 'doi:10.1016/j.jad.2020.01.001', subject, kind, state: 'accepted' as const, decided_by: 'contributor' as const, support: { contributor: { add: 2, remove: 0 } },
  quorum: { n: 2, add: 2, remove: 0, unsure: 0, challengers: 0, challenged: false, share: 1, ci_low: 0.549, ci_high: 1, z: 1.2816, threshold: 0.5, confidence: 0.8, min_independent: 2 },
  verification, re_extractions: verification ? 1 : 0, effective_id: null, value, issues: [], last_changed: AT, reasons: [],
})
const work: EvidenceCommunityWork = {
  work_id: 'doi:10.1016/j.jad.2020.01.001', aliases: ['openalex:W1'],
  card: { id: 'openalex:W1', doi: '10.1016/j.jad.2020.01.001', pmid: null, title: 'Community-annotated trial', year: 2020, authors: ['A'], venue: null, publication_type: 'article', topics: [], keywords: [], mesh: [], abstract: null, language: 'en', cited_by_count: 5, is_open_access: false, oa_url: null, is_retracted: false },
  tags: [{ tag_key: 'adhd', label: 'ADHD', state: 'present', decided_by: 'contributor', support: { contributor: { add: 2, remove: 0 } }, last_changed: AT, request_id: null }],
  pending: [],
  facets: { design: { value: 'rct', decision: decision('facet:design', 'facet', 'rct', null), locators: ['Methods'] } },
  rows: [{
    row_id: 'o1',
    input: { kind: 'row', context: { row_id: 'o1', outcome: 'ADHD-RS', comparison: 'mph vs placebo', population: 'adults', timepoint: '8 weeks', unit: 'pts', analysis: 'unadjusted', kind: 'continuous', locator: 'Table 2' },
      effect: { metric: 'smd', value: -0.42, ci_low: -0.71, ci_high: -0.13, n: 212, p_value: 0.004, higher_is_better: false }, direction: null },
    decision: decision('row:o1', 'row', null, 'double'),
  }],
  unsure: 0, updated_at: AT,
}
const manifest = {
  contract: EVIDENCE_CONTRACT_VERSION, export_version: 1, generated_at: AT, source_commit: null, label: 'Community annotations', license: 'CC0-1.0', repository: 'https://example.org/r',
  policy: DEFAULT_COMMUNITY_POLICY, facet_vocab: {}, concepts_version: '1', maintainers: [], shards: [], counts: { works: 1, assertions: 0, contributors: 0, accepted: 0, pending: 0, disputed: 0, frames: 0 },
}
const exp = (readCommunityExport(manifest, [[work]]) as { ok: true; value: EvidenceCommunityExport }).value
const onsite = createMemoryOnsiteSource([{ id: 1, title: 'Site article', tags: ['ADHD'], study_design: 'cohort', is_public: true }])
const bindings = createMemoryBindingStore([createCuratedBinding({ tag: 'adhd', topic: { id: 'openalex:T1', display_name: 'ADHD' }, by: 'ed', at: AT })!])
const make = (apply: 'off' | 'tags_only' | 'tags_and_records', community = createCommunityPorts(exp).articles) =>
  createEvidenceService({ onsite, external, bindings, community, cache: null, settings: { 'community.apply': apply }, now: () => new Date(AT), log: () => {} })

describe('服务层接社区导出', () => {
  it('① 缺省 off：图谱里没有社区记录，外部示例原样', async () => {
    const r = await make('off').getTagMap('ADHD')
    expect(r.ok && r.data.records.map((x) => x.source)).toEqual(['onsite', 'openalex', 'openalex'])
    const t = await make('tags_only').getTagMap('ADHD')
    expect(t.ok && t.data.records.map((x) => x.source)).toEqual(['onsite', 'openalex', 'openalex'])
  })
  it('② tags_and_records：社区记录并入，同 DOI 的外部示例被替掉；研究设计与效应来自社区抄录；来源脚注分开', async () => {
    const r = await make('tags_and_records').getTagMap('ADHD')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.records.map((x) => [x.source, x.id])).toEqual([
      ['onsite', 'onsite:1'], ['community', 'community:doi:10.1016/j.jad.2020.01.001'], ['openalex', 'openalex:W2'],
    ])
    const c = r.data.records[1]!
    expect(c).toMatchObject({ study_type: 'rct', effect: { metric: 'smd', value: -0.42, ci_low: -0.71 }, direction: 'favours', doi: 'https://doi.org/10.1016/j.jad.2020.01.001', tags: ['ADHD'] })
    expect(c.provenance).toEqual({ source_label: 'Community annotations', license: 'CC0-1.0', retrieved_at: new Date(AT).toISOString() })
    expect(r.data.sources.map((s) => s.source_label).sort()).toEqual(['Community annotations', 'On-site articles', 'OpenAlex'])
    expect(r.data.view.kind).toBe('forest') // 社区抄的那一行有点估计与区间
  })
  it('③ 主题级：按编辑绑定的标签键并入社区记录', async () => {
    const r = await make('tags_and_records').getNodeMap('topic', 'T1')
    expect(r.ok && r.data.records.map((x) => x.source)).toEqual(['onsite', 'community', 'openalex'])
  })
  it('④ 社区端口抛错 ⇒ unavailable；没配社区端口时设置无效', async () => {
    const broken = { label: 'x', license: 'CC0-1.0', async listArticles(): Promise<readonly unknown[]> { throw new Error('offline') } }
    const r = await make('tags_and_records', broken).getTagMap('ADHD')
    expect(r).toEqual({ ok: false, error: 'unavailable' })
    const none = createEvidenceService({ onsite, external, bindings, cache: null, settings: { 'community.apply': 'tags_and_records' }, now: () => new Date(AT), log: () => {} })
    const n = await none.getTagMap('ADHD')
    expect(n.ok && n.data.records.map((x) => x.source)).toEqual(['onsite', 'openalex', 'openalex'])
  })
})
