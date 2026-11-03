/**
 * 宿主插件层（0.6.1）：
 *   refreshCommunityExport —— ① 首次取回 ⇒ updated，快照可原样存成 JSON；② 再拉没变 ⇒ unchanged、不下载分片；
 *     ③ 只换了附带文件 ⇒ updated、复用上一份作品；④ 任何一步不成（取不到 / 抛错 / 哈希不符 / 坏 JSON / 路径不安全 / 契约不符 / 作品数对不上）
 *     ⇒ failed 且原样交回上一份（含宿主函数抛错、清单 counts 对不上、附带文件不是数组、残缺快照）；⑤ 附带文件 404 当没有。
 *   mergeCommunityRecords —— ⑥ 缺省 off 与没有快照 ⇒ 外部示例原样；⑦ tags_and_records ⇒ 站内标签换成引擎键后取社区作品、
 *     与外部示例同 DOI 的去掉、出处是导出来源名与快照取数时间；⑧ minVerification 管数字进不进记录。
 */
import { createHash } from 'node:crypto'
import { DEFAULT_COMMUNITY_POLICY, mergeCommunityRecords, refreshCommunityExport } from '../src/community'
import type { CommunityExportSnapshot } from '../src/community'
import type { EvidenceCommunityWork, EvidenceRecord } from '../src/types'
import { EVIDENCE_CONTRACT_VERSION } from '../src/types'

const AT = '2026-11-03T00:00:00Z'
const BASE = 'https://example.org/export/v1'
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

const decision = (workId: string, subject: string, kind: 'tag' | 'facet' | 'row', value: string | null, verification: 'single' | 'double' | null) => ({
  work_id: workId, subject, kind, state: 'accepted' as const, decided_by: 'contributor' as const, support: { contributor: { add: 2, remove: 0 } },
  quorum: { n: 2, add: 2, remove: 0, unsure: 0, challengers: 0, challenged: false, share: 1, ci_low: 0.549, ci_high: 1, z: 1.2816, threshold: 0.5, confidence: 0.8, min_independent: 2 },
  verification, re_extractions: verification === 'double' ? 1 : 0, effective_id: null, value, issues: [], last_changed: AT, reasons: [],
})
const card = (doi: string, id: string, title: string) => ({
  id, doi, pmid: null, title, year: 2020, authors: ['A'], venue: null, publication_type: 'article', topics: [], keywords: [], mesh: [], abstract: null,
  language: 'en', cited_by_count: 5, is_open_access: false, oa_url: null, is_retracted: false,
})
const tag = (key: string, label: string) => ({ tag_key: key, label, state: 'present' as const, decided_by: 'contributor' as const, support: { contributor: { add: 2, remove: 0 } }, last_changed: AT, request_id: null })
const W1 = 'doi:10.1016/j.jad.2020.01.001'
const work1 = (verification: 'single' | 'double'): EvidenceCommunityWork => ({
  work_id: W1, aliases: ['openalex:W1'], card: card('10.1016/j.jad.2020.01.001', 'openalex:W1', 'Community-annotated trial'),
  tags: [tag('adhd', 'ADHD'), tag('sleep hygiene', 'Sleep hygiene')], pending: [],
  facets: { design: { value: 'rct', decision: decision(W1, 'facet:design', 'facet', 'rct', null), locators: ['Methods'] } },
  rows: [{
    row_id: 'o1',
    input: { kind: 'row', context: { row_id: 'o1', outcome: 'ADHD-RS', comparison: 'mph vs placebo', population: 'adults', timepoint: '8 weeks', unit: 'pts', analysis: 'unadjusted', kind: 'continuous', locator: 'Table 2' },
      effect: { metric: 'smd', value: -0.42, ci_low: -0.71, ci_high: -0.13, n: 212, p_value: 0.004, higher_is_better: false }, direction: null },
    decision: decision(W1, 'row:o1', 'row', null, verification),
  }],
  unsure: 0, updated_at: AT,
})
const W2 = 'doi:10.1000/second'
const work2: EvidenceCommunityWork = {
  work_id: W2, aliases: [], card: card('10.1000/second', 'openalex:W9', 'Second'), tags: [tag('insomnia', 'Insomnia')], pending: [], facets: {}, rows: [], unsure: 0, updated_at: AT,
}

/** 一份导出站点：路径 → 文本；记下每次被取的路径 */
function site(works: EvidenceCommunityWork[][], opts: { contract?: string; extras?: Record<string, string>; manifestPatch?: (m: Record<string, unknown>) => void } = {}) {
  const files = new Map<string, string>()
  const shards = works.map((list, i) => {
    const path = `works/${String(i).padStart(2, '0')}.jsonl`
    const body = list.map((w) => JSON.stringify(w)).join('\n') + '\n'
    files.set(path, body)
    return { path, bytes: body.length, sha256: sha(body), works: list.length }
  })
  const manifest: Record<string, unknown> = {
    contract: opts.contract ?? EVIDENCE_CONTRACT_VERSION, export_version: 1, generated_at: AT, source_commit: null, label: 'Community annotations', license: 'CC0-1.0',
    repository: 'https://example.org/r', policy: DEFAULT_COMMUNITY_POLICY, facet_vocab: {}, concepts_version: '1', maintainers: [], shards,
    counts: { works: works.flat().length, assertions: 0, contributors: 0, accepted: 0, pending: 0, disputed: 0, frames: 0 },
  }
  opts.manifestPatch?.(manifest)
  files.set('manifest.json', JSON.stringify(manifest))
  for (const [k, v] of Object.entries(opts.extras ?? { 'bindings.json': '[]', 'concepts.json': '[]', 'frames.json': '[]' })) files.set(k, v)
  const hits: string[] = []
  const get = async (url: string) => {
    const path = url.slice(BASE.length + 1)
    hits.push(path)
    const body = files.get(path)
    return { status: body === undefined ? 404 : 200, async text() { return body ?? '' } }
  }
  return { files, hits, get }
}
const refresh = (s: ReturnType<typeof site>, previous: CommunityExportSnapshot | null = null) =>
  refreshCommunityExport({ base: `${BASE}/`, get: s.get, sha256: sha, previous, now: () => new Date(AT) })

describe('refreshCommunityExport', () => {
  it('① 首次取回：updated，作品齐，快照存成 JSON 再读回不变', async () => {
    const s = site([[work1('double')], [work2]])
    const r = await refresh(s)
    expect(r).toMatchObject({ status: 'updated', reason: null, path: null })
    expect(r.snapshot!.base).toBe(BASE)
    expect(r.snapshot!.fetched_at).toBe(new Date(AT).toISOString())
    expect(r.snapshot!.export.works.map((w) => w.work_id)).toEqual([W1, W2])
    expect(Object.keys(r.snapshot!.shards)).toEqual(['works/00.jsonl', 'works/01.jsonl'])
    expect(JSON.parse(JSON.stringify(r.snapshot))).toEqual(r.snapshot)
  })

  it('② 再拉没变：unchanged，交回同一份快照，不下载分片', async () => {
    const s = site([[work1('double')], [work2]])
    const first = (await refresh(s)).snapshot!
    s.hits.length = 0
    const r = await refresh(s, first)
    expect(r.status).toBe('unchanged')
    expect(r.snapshot).toBe(first)
    expect(s.hits.some((p) => p.startsWith('works/'))).toBe(false)
  })

  it('③ 只换了附带文件：updated，分片不重下，作品沿用上一份', async () => {
    const s = site([[work1('double')], [work2]])
    const first = (await refresh(s)).snapshot!
    s.files.set('frames.json', JSON.stringify([{ key: 'k', record_ids: [] }]))
    s.hits.length = 0
    const r = await refresh(s, first)
    expect(r.status).toBe('updated')
    expect(s.hits.some((p) => p.startsWith('works/'))).toBe(false)
    expect(r.snapshot!.export.works).toEqual(first.export.works)
    expect(r.snapshot!.extras.frames).not.toBe(first.extras.frames)
  })

  it('④ 任何一步不成 ⇒ failed，原样交回上一份', async () => {
    const good = (await refresh(site([[work1('double')]]))).snapshot!
    const cases: Array<[string, ReturnType<typeof site>, string, string | null]> = []
    const noManifest = site([[work1('double')]]); noManifest.files.delete('manifest.json')
    cases.push(['清单取不到', noManifest, 'unreachable', 'manifest.json'])
    const badHash = site([[work2]]); badHash.files.set('works/00.jsonl', badHash.files.get('works/00.jsonl')! + ' ')
    cases.push(['分片哈希不符', badHash, 'hash_mismatch', 'works/00.jsonl'])
    const badLine = site([[work2]]); { const t = '{not json\n'; badLine.files.set('works/00.jsonl', t); const m = JSON.parse(badLine.files.get('manifest.json')!); m.shards[0].sha256 = sha(t); badLine.files.set('manifest.json', JSON.stringify(m)) }
    cases.push(['分片坏 JSON', badLine, 'bad_json', 'works/00.jsonl'])
    cases.push(['路径往上跳', site([[work2]], { manifestPatch: (m) => { (m.shards as Array<{ path: string }>)[0]!.path = '../secret.jsonl' } }), 'bad_path', '../secret.jsonl'])
    cases.push(['绝对路径', site([[work2]], { manifestPatch: (m) => { (m.shards as Array<{ path: string }>)[0]!.path = '/etc/x' } }), 'bad_path', '/etc/x'])
    cases.push(['带协议', site([[work2]], { manifestPatch: (m) => { (m.shards as Array<{ path: string }>)[0]!.path = 'https://evil.example/x' } }), 'bad_path', 'https://evil.example/x'])
    cases.push(['契约主次版本不符', site([[work2]], { contract: '9.9.0' }), 'bad_export', 'manifest.json'])
    cases.push(['作品数对不上', site([[work2]], { manifestPatch: (m) => { (m.shards as Array<{ works: number }>)[0]!.works = 2 } }), 'incomplete', null])
    const extra500 = site([[work2]]); const get500 = extra500.get
    extra500.get = async (u: string) => (u.endsWith('/concepts.json') ? { status: 500, async text() { return '' } } : get500(u))
    cases.push(['附带文件 500', extra500, 'unreachable', 'concepts.json'])
    for (const [name, s, reason, path] of cases) {
      const r = await refresh(s, good)
      expect({ name, status: r.status, reason: r.reason, path: r.path }).toEqual({ name, status: 'failed', reason, path })
      expect(r.snapshot).toBe(good)
    }
    const throws = await refreshCommunityExport({ base: BASE, get: async () => { throw new Error('offline') }, sha256: sha, previous: null })
    expect(throws).toMatchObject({ status: 'failed', reason: 'unreachable', snapshot: null })
  })

  it('④b 评审补充：宿主函数抛错、清单 counts 对不上、附带文件不是数组、存储读回的残缺快照', async () => {
    const good = (await refresh(site([[work1('double')]]))).snapshot!
    const s1 = site([[work2]])
    const throwsHash = await refreshCommunityExport({ base: BASE, get: s1.get, sha256: () => { throw new Error('no crypto') }, previous: good })
    expect(throwsHash).toMatchObject({ status: 'failed', reason: 'host_error', snapshot: good })
    const throwsNow = await refreshCommunityExport({ base: BASE, get: s1.get, sha256: sha, previous: null, now: () => { throw new Error('clock') } })
    expect(throwsNow).toMatchObject({ status: 'failed', reason: 'host_error', snapshot: null })
    const empty = await refresh(site([], { manifestPatch: (m) => { (m.counts as { works: number }).works = 2 } }), good)
    expect(empty).toMatchObject({ status: 'failed', reason: 'incomplete' })
    expect(empty.snapshot).toBe(good)
    const wrongShape = await refresh(site([[work2]], { extras: { 'bindings.json': JSON.stringify({ bindings: [] }) } }), good)
    expect(wrongShape).toMatchObject({ status: 'failed', reason: 'bad_export', path: 'bindings.json' })
    const broken = { ...good, shards: undefined } as unknown as CommunityExportSnapshot
    const fromBroken = await refresh(site([[work2]]), broken)
    expect(fromBroken.status).toBe('updated')        // 残缺快照不复用，整份重拉
    const failBroken = await refresh(site([[work2]], { contract: '9.9.0' }), broken)
    expect(failBroken.snapshot).toBe(broken)          // 失败时仍原样交回
  })

  it('⑤ 附带文件 404 当没有', async () => {
    const r = await refresh(site([[work2]], { extras: {} }))
    expect(r.status).toBe('updated')
    expect(r.snapshot!.extras).toEqual({ bindings: null, concepts: null, frames: null })
  })
})

describe('mergeCommunityRecords', () => {
  const ext = (id: string, doi: string | null): EvidenceRecord => ({
    id, source: 'openalex', external_id: id.split(':')[1]!, title: id, year: 2020, authors: [], doi, url: null, topic_ids: [], study_type: null, publication_type: 'article',
    self_reported_claim: null, direction: null, effect: null, cited_by_count: 5, is_retracted: false, is_open_access: null, provenance: { source_label: 'OpenAlex', license: 'CC0', retrieved_at: AT },
  })
  const external = [ext('openalex:W1', 'https://doi.org/10.1016/J.JAD.2020.01.001'), ext('openalex:W2', '10.1/other')]
  const snap = async (v: 'single' | 'double') => (await refresh(site([[work1(v)], [work2]]))).snapshot!

  it('⑥ 缺省 off、没有快照或没有标签 ⇒ 社区为空，外部示例原样', async () => {
    const s = await snap('double')
    expect(mergeCommunityRecords(s, { tags: ['ADHD'], external })).toEqual({ community: [], external })
    expect(mergeCommunityRecords(null, { tags: ['ADHD'], external, settings: { 'community.apply': 'tags_and_records' } })).toEqual({ community: [], external })
    expect(mergeCommunityRecords(s, { tags: ['  '], external, settings: { 'community.apply': 'tags_and_records' } })).toEqual({ community: [], external })
  })

  it('⑦ tags_and_records：站内写法换成引擎键；同 DOI 的外部示例去掉；出处是来源名与快照取数时间', async () => {
    const s = await snap('double')
    const r = mergeCommunityRecords(s, { tags: ['#Sleep-Hygiene'], external, settings: { 'community.apply': 'tags_and_records', 'unknown.key': 1 } })
    expect(r.community.map((x) => [x.source, x.id])).toEqual([['community', `community:${W1}`]])
    expect(r.external.map((x) => x.id)).toEqual(['openalex:W2'])
    expect(r.community[0]!.provenance).toEqual({ source_label: 'Community annotations', license: 'CC0-1.0', retrieved_at: s.fetched_at })
    expect(r.community[0]).toMatchObject({ study_type: 'rct', effect: { metric: 'smd', value: -0.42 } })
  })

  it('⑦b 标签显示名与键不同也取得到（按导出里的 tag_key 挑，不再按显示名二次过滤）', async () => {
    const odd: EvidenceCommunityWork = { ...work2, tags: [tag('insomnia', 'Trouble sleeping')] }
    const s = (await refresh(site([[odd]]))).snapshot!
    const r = mergeCommunityRecords(s, { tags: ['Insomnia'], external: [], settings: { 'community.apply': 'tags_and_records' } })
    expect(r.community.map((x) => x.id)).toEqual([`community:${W2}`])
  })

  it('⑧ minVerification：一人抄的数字缺省不进记录，设成 single 才进', async () => {
    const s = await snap('single')
    const strict = mergeCommunityRecords(s, { tags: ['adhd'], external: [], settings: { 'community.apply': 'tags_and_records' } })
    expect(strict.community[0]!.effect).toBeNull()
    const loose = mergeCommunityRecords(s, { tags: ['adhd'], external: [], settings: { 'community.apply': 'tags_and_records', 'community.minVerification': 'single' } })
    expect(loose.community[0]!.effect).toMatchObject({ metric: 'smd', value: -0.42 })
  })
})
