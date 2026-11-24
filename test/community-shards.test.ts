/**
 * 宿主分片存储（0.6.3）：
 *   refreshCommunityShards —— ① 首次全量，索引可原样存成 JSON；② 没变 ⇒ unchanged、零下载、零写入；③ 改一篇 ⇒ 只下载那一片，
 *     旧键进 retired、再下一次刷新才删；④ 删一片 / 加一片；⑤ 只换附带文件或清单元信息 ⇒ updated、不下载分片；
 *     ⑥ 任何一步不成（哈希不符 / 坏 JSON / 作品数不符 / counts 不符 / 路径不安全 / 附带文件 500 …）⇒ failed，读到的仍是上一版完整数据；
 *     ⑦ 写分片中途端口抛错 ⇒ store_error，读到的仍是上一版，下次刷新清掉 pending 并成功；⑧ 内容改回旧哈希（A→B→A）不丢数据；
 *     ⑨ 清理不删生效键，删不掉不致命；⑩ 同次下载的跨片重复 ⇒ incomplete；⑪ 宿主函数抛错 ⇒ host_error；⑫ 残缺索引当没有。
 *   readCommunityShards —— ⑬ 按标签只读相关分片；读不到如实报；与没变的分片重复时去重并记数。
 *   mergeCommunityRecordsFromShards —— ⑭ 与整份快照路径逐字段相同；⑮ community.apply 关着或没有标签 ⇒ 不读存储；读不成 ⇒ ok: false。
 */
import { createHash } from 'node:crypto'
import {
  DEFAULT_COMMUNITY_POLICY, createMemoryShardStore, mergeCommunityRecords, mergeCommunityRecordsFromShards, readCommunityShards,
  refreshCommunityExport, refreshCommunityShards,
} from '../src/community'
import type { CommunityShardIndex, CommunityShardStore } from '../src/community'
import { normalizeTag } from '../src/tags'
import type { EvidenceCommunityWork, EvidenceRecord } from '../src/types'
import { EVIDENCE_CONTRACT_VERSION } from '../src/types'

const AT = '2026-11-23T00:00:00Z'
const LATER = '2026-11-24T00:00:00Z'
const BASE = 'https://example.org/export/v1'
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

const decision = (workId: string, subject: string, kind: 'tag' | 'facet' | 'row', value: string | null, verification: 'single' | 'double' | null) => ({
  work_id: workId, subject, kind, state: 'accepted' as const, decided_by: 'contributor' as const, support: { contributor: { add: 2, remove: 0 } },
  quorum: { n: 2, add: 2, remove: 0, unsure: 0, challengers: 0, challenged: false, share: 1, ci_low: 0.549, ci_high: 1, z: 1.2816, threshold: 0.5, confidence: 0.8, min_independent: 2 },
  verification, re_extractions: verification === 'double' ? 1 : 0, effective_id: null, value, issues: [], last_changed: AT, reasons: [],
})
const tag = (label: string, state: 'present' | 'absent' = 'present') =>
  ({ tag_key: normalizeTag(label)!, label, state, decided_by: 'contributor' as const, support: { contributor: { add: 2, remove: 0 } }, last_changed: AT, request_id: null })
/** 一篇只有标签的作品 */
const mk = (n: number, tags: string[], title = `Work ${n}`): EvidenceCommunityWork => ({
  work_id: `doi:10.1000/w${n}`, aliases: [`openalex:W${n}`],
  card: {
    id: `openalex:W${n}`, doi: `10.1000/w${n}`, pmid: null, title, year: 2020, authors: ['A'], venue: null, publication_type: 'article', topics: [], keywords: [], mesh: [],
    abstract: null, language: 'en', cited_by_count: 5, is_open_access: false, oa_url: null, is_retracted: false,
  },
  tags: tags.map((t) => tag(t)), pending: [], facets: {}, rows: [], unsure: 0, updated_at: AT,
})
/** 一篇带研究设计与一行结果的作品 */
const withRow = (n: number, tags: string[], verification: 'single' | 'double'): EvidenceCommunityWork => {
  const w = mk(n, tags)
  return {
    ...w,
    facets: { design: { value: 'rct', decision: decision(w.work_id, 'facet:design', 'facet', 'rct', null), locators: ['Methods'] } },
    rows: [{
      row_id: 'o1',
      input: { kind: 'row', context: { row_id: 'o1', outcome: 'ADHD-RS', comparison: 'mph vs placebo', population: 'adults', timepoint: '8 weeks', unit: 'pts', analysis: 'unadjusted', kind: 'continuous', locator: 'Table 2' },
        effect: { metric: 'smd', value: -0.42, ci_low: -0.71, ci_high: -0.13, n: 212, p_value: 0.004, higher_is_better: false }, direction: null },
      decision: decision(w.work_id, 'row:o1', 'row', null, verification),
    }],
  }
}

type Shards = Record<string, EvidenceCommunityWork[]>
interface PublishOptions { contract?: string; extras?: Record<string, string>; manifestPatch?: (m: Record<string, unknown>) => void; generated_at?: string; label?: string }
/** 一份导出站点：路径 → 文本；`publish` 整份换成新的一版；记下每次被取的路径 */
function site(initial: Shards, opts: PublishOptions = {}) {
  const files = new Map<string, string>()
  const hits: string[] = []
  const publish = (shards: Shards, o: PublishOptions = {}) => {
    files.clear()
    const listed = Object.entries(shards).map(([path, list]) => {
      const body = list.map((w) => JSON.stringify(w)).join('\n') + '\n'
      files.set(path, body)
      return { path, bytes: body.length, sha256: sha(body), works: list.length }
    })
    const manifest: Record<string, unknown> = {
      contract: o.contract ?? EVIDENCE_CONTRACT_VERSION, export_version: 1, generated_at: o.generated_at ?? AT, source_commit: null, label: o.label ?? 'Community annotations',
      license: 'CC0-1.0', repository: 'https://example.org/r', policy: DEFAULT_COMMUNITY_POLICY, facet_vocab: {}, concepts_version: '1', maintainers: [], shards: listed,
      counts: { works: Object.values(shards).flat().length, assertions: 0, contributors: 0, accepted: 0, pending: 0, disputed: 0, frames: 0 },
    }
    o.manifestPatch?.(manifest)
    files.set('manifest.json', JSON.stringify(manifest))
    for (const [k, v] of Object.entries(o.extras ?? { 'bindings.json': '[]', 'concepts.json': '[]', 'frames.json': '[]' })) files.set(k, v)
  }
  publish(initial, opts)
  const s = {
    files, hits, publish,
    get: async (url: string) => {
      const path = url.slice(BASE.length + 1)
      hits.push(path)
      const body = files.get(path)
      return { status: body === undefined ? 404 : 200, async text() { return body ?? '' } }
    },
    key: (path: string) => `${path}@${sha(files.get(path)!)}`,
    shardHits: () => hits.filter((p) => p.endsWith('.jsonl')),
  }
  return s
}

/** 包一层内存存储：记下每次端口调用，可以让某一次调用抛错 */
function watched() {
  const inner = createMemoryShardStore()
  const calls: string[] = []
  const w = {
    inner, calls,
    failWhen: null as ((op: string, key: string | null) => boolean) | null,
    writes: () => calls.filter((c) => !c.startsWith('read')),
    store: null as unknown as CommunityShardStore,
  }
  const run = <T>(op: string, key: string | null, f: () => Promise<T>) => {
    calls.push(key === null ? op : `${op} ${key}`)
    if (w.failWhen?.(op, key)) throw new Error(`${op} failed`)
    return f()
  }
  w.store = {
    readIndex: async () => run('readIndex', null, () => inner.readIndex()),
    writeIndex: async (index) => run('writeIndex', null, () => inner.writeIndex(index)),
    readShard: async (key) => run('readShard', key, () => inner.readShard(key)),
    writeShard: async (key, works) => run('writeShard', key, () => inner.writeShard(key, works)),
    deleteShard: async (key) => run('deleteShard', key, () => inner.deleteShard(key)),
  }
  return w
}

const refresh = (s: ReturnType<typeof site>, store: CommunityShardStore, at = AT) =>
  refreshCommunityShards({ base: `${BASE}/`, get: s.get, sha256: sha, store, now: () => new Date(at) })
const ALL = ['ADHD', 'Insomnia', 'Sleep hygiene', 'Anxiety', 'Diet']
/** 存储里现在读得到的全部作品键（按标签全读一遍） */
const ids = async (store: CommunityShardStore) => {
  const r = await readCommunityShards(store, { tags: ALL })
  return r.ok ? r.works.map((w) => w.work_id) : r.reason
}
const id = (n: number) => `doi:10.1000/w${n}`

const A = 'works/00.jsonl'
const B = 'works/01.jsonl'
const C = 'works/02.jsonl'
/** 三片：00 是 ADHD 与睡眠卫生，01 是失眠，02 是焦虑 */
const v1 = (): Shards => ({ [A]: [withRow(1, ['ADHD', 'Sleep hygiene'], 'double'), mk(2, ['ADHD'])], [B]: [mk(3, ['Insomnia'])], [C]: [mk(4, ['Anxiety']), mk(5, ['Anxiety', 'ADHD'])] })

describe('refreshCommunityShards', () => {
  it('① 首次全量：updated，每片一个按内容寻址的键，索引存成 JSON 再读回不变', async () => {
    const s = site(v1())
    const w = watched()
    const r = await refresh(s, w.store)
    expect(r).toEqual({ status: 'updated', reason: null, path: null, issues: [], shards: { downloaded: 3, reused: 0, removed: 0 }, cleaned: 0, cleanup_failed: 0 })
    expect(w.inner.keys()).toEqual([s.key(A), s.key(B), s.key(C)])
    const index = (await w.inner.readIndex())!
    expect(index).toMatchObject({ base: BASE, fetched_at: new Date(AT).toISOString(), pending: [], retired: [] })
    expect(index.shards).toEqual({
      [A]: { key: s.key(A), sha256: sha(s.files.get(A)!), works: 2, tags: ['adhd', 'sleep hygiene'] },
      [B]: { key: s.key(B), sha256: sha(s.files.get(B)!), works: 1, tags: ['insomnia'] },
      [C]: { key: s.key(C), sha256: sha(s.files.get(C)!), works: 2, tags: ['adhd', 'anxiety'] },
    })
    expect(index.manifest.counts.works).toBe(5)
    expect(index.extras).toEqual({ bindings: { sha256: sha('[]'), value: [] }, concepts: { sha256: sha('[]'), value: [] }, frames: { sha256: sha('[]'), value: [] } })
    expect(JSON.parse(JSON.stringify(index))).toEqual(index)
    expect(await ids(w.store)).toEqual([1, 2, 3, 4, 5].map(id))
    // 顺序是语义的一部分：先记 pending，再写分片，最后才换索引
    expect(w.writes()).toEqual(['writeIndex', `writeShard ${s.key(A)}`, `writeShard ${s.key(B)}`, `writeShard ${s.key(C)}`, 'writeIndex'])
  })

  it('② 再拉没变：unchanged，一片都不下载，存储一个字都不写', async () => {
    const s = site(v1())
    const w = watched()
    await refresh(s, w.store)
    const before = await w.inner.readIndex()
    s.hits.length = 0
    w.calls.length = 0
    const r = await refresh(s, w.store, LATER)
    expect(r).toMatchObject({ status: 'unchanged', reason: null, shards: { downloaded: 0, reused: 3, removed: 0 }, cleaned: 0 })
    expect(s.hits).toEqual(['manifest.json', 'bindings.json', 'concepts.json', 'frames.json'])
    expect(w.calls).toEqual(['readIndex'])
    expect(await w.inner.readIndex()).toEqual(before)
    // 只有生成时间、来源提交、计数变了：内容没变，还是 unchanged
    s.publish(v1(), { generated_at: LATER, manifestPatch: (m) => { m.source_commit = 'abc'; (m.counts as { assertions: number }).assertions = 9 } })
    expect((await refresh(s, w.store, LATER)).status).toBe('unchanged')
    expect((await w.inner.readIndex())!.fetched_at).toBe(new Date(AT).toISOString())
  })

  it('③ 改一篇：只下载那一片；旧键进 retired、还读得到，再下一次刷新才删', async () => {
    const s = site(v1())
    const w = watched()
    await refresh(s, w.store)
    const oldKey = s.key(B)
    const v2 = { ...v1(), [B]: [mk(3, ['Insomnia', 'Diet'])] }
    s.publish(v2)
    s.hits.length = 0
    const r = await refresh(s, w.store, LATER)
    expect(r).toMatchObject({ status: 'updated', shards: { downloaded: 1, reused: 2, removed: 0 }, cleaned: 0 })
    expect(s.shardHits()).toEqual([B])
    const index = (await w.inner.readIndex())!
    expect(index.fetched_at).toBe(new Date(LATER).toISOString())
    expect(index.shards[B]).toEqual({ key: s.key(B), sha256: sha(s.files.get(B)!), works: 1, tags: ['diet', 'insomnia'] })
    expect(index.retired).toEqual([oldKey])
    expect(index.pending).toEqual([])
    expect(await w.inner.readShard(oldKey)).not.toBeNull() // 正在读旧版的请求还读得到
    expect(w.inner.keys()).toHaveLength(4)
    // 下一次刷新（内容没再变）：开头把退下来的键删掉，索引里的清单清空
    const next = await refresh(s, w.store, LATER)
    expect(next).toMatchObject({ status: 'unchanged', cleaned: 1, cleanup_failed: 0 })
    expect(await w.inner.readShard(oldKey)).toBeNull()
    expect(w.inner.keys()).toEqual([s.key(A), s.key(B), s.key(C)].sort())
    expect((await w.inner.readIndex())!.retired).toEqual([])
    expect(await ids(w.store)).toEqual([1, 2, 3, 4, 5].map(id))
  })

  it('④ 删一片、加一片：只下载新加的，被删的那片的键退下来', async () => {
    const s = site(v1())
    const w = watched()
    await refresh(s, w.store)
    const gone = s.key(C)
    const D = 'works/03.jsonl'
    const base = v1()
    s.publish({ [A]: base[A]!, [B]: base[B]!, [D]: [mk(6, ['Diet'])] })
    s.hits.length = 0
    const r = await refresh(s, w.store, LATER)
    expect(r).toMatchObject({ status: 'updated', shards: { downloaded: 1, reused: 2, removed: 1 } })
    expect(s.shardHits()).toEqual([D])
    const index = (await w.inner.readIndex())!
    expect(Object.keys(index.shards)).toEqual([A, B, D])
    expect(index.retired).toEqual([gone])
    expect(await ids(w.store)).toEqual([1, 2, 3, 6].map(id))
    // 只删不加：一片都不下载
    s.publish({ [A]: base[A]! })
    s.hits.length = 0
    const only = await refresh(s, w.store, LATER)
    expect(only).toMatchObject({ status: 'updated', shards: { downloaded: 0, reused: 1, removed: 2 }, cleaned: 1 })
    expect(s.shardHits()).toEqual([])
    expect(await ids(w.store)).toEqual([1, 2].map(id))
    // 全删光：空导出是一份真的空导出（不是「还没有」）
    s.publish({})
    expect(await refresh(s, w.store, LATER)).toMatchObject({ status: 'updated', shards: { downloaded: 0, reused: 0, removed: 1 } })
    expect(await readCommunityShards(w.store, { tags: ALL })).toMatchObject({ ok: true, works: [], shards_read: 0 })
  })

  it('⑤ 只换了附带文件或清单元信息：updated，分片不重下', async () => {
    const s = site(v1())
    const w = watched()
    await refresh(s, w.store)
    s.files.set('frames.json', JSON.stringify([{ key: 'k', record_ids: [] }, { broken: true }]))
    s.hits.length = 0
    const r = await refresh(s, w.store, LATER)
    expect(r).toMatchObject({ status: 'updated', shards: { downloaded: 0, reused: 3, removed: 0 } })
    expect(s.shardHits()).toEqual([])
    const index = (await w.inner.readIndex())!
    expect(index.extras.frames).toEqual({ sha256: sha(s.files.get('frames.json')!), value: [{ key: 'k', record_ids: [] }] })
    expect(index.fetched_at).toBe(new Date(LATER).toISOString())
    expect(index.retired).toEqual([])
    // 附带文件 404 当没有
    s.files.delete('frames.json')
    expect((await refresh(s, w.store, LATER)).status).toBe('updated')
    expect((await w.inner.readIndex())!.extras.frames).toEqual({ sha256: null, value: [] })
    // 来源名变了：也是内容变了
    s.publish(v1(), { label: 'Renamed', extras: { 'bindings.json': '[]', 'concepts.json': '[]' } })
    s.hits.length = 0
    expect(await refresh(s, w.store, LATER)).toMatchObject({ status: 'updated', shards: { downloaded: 0, reused: 3 } })
    expect((await w.inner.readIndex())!.manifest.label).toBe('Renamed')
  })

  it('⑥ 任何一步不成 ⇒ failed，存储一个字都没写，读到的仍是上一版完整数据', async () => {
    const good = site(v1())
    const w = watched()
    await refresh(good, w.store)
    const before = await w.inner.readIndex()
    const keys = w.inner.keys()
    const changed = (): Shards => ({ ...v1(), [B]: [mk(3, ['Insomnia', 'Diet'])], [C]: [mk(4, ['Diet'])] })
    const patchShard = (i: number, f: (sh: { path: string; works: number; sha256: string }) => void) => (m: Record<string, unknown>) => f((m.shards as Array<{ path: string; works: number; sha256: string }>)[i]!)
    const cases: Array<[string, ReturnType<typeof site>, string, string | null]> = []
    const noManifest = site(changed()); noManifest.files.delete('manifest.json')
    cases.push(['清单取不到', noManifest, 'unreachable', 'manifest.json'])
    const badManifest = site(changed()); badManifest.files.set('manifest.json', '{oops')
    cases.push(['清单坏 JSON', badManifest, 'bad_json', 'manifest.json'])
    const noShard = site(changed()); noShard.files.delete(C)
    cases.push(['分片取不到', noShard, 'unreachable', C])
    const badHash = site(changed()); badHash.files.set(B, badHash.files.get(B)! + ' ')
    cases.push(['分片哈希不符', badHash, 'hash_mismatch', B])
    const badLine = site(changed(), { manifestPatch: patchShard(1, (sh) => { sh.sha256 = sha('{not json\n') }) }); badLine.files.set(B, '{not json\n')
    cases.push(['分片坏 JSON', badLine, 'bad_json', B])
    cases.push(['这一片的作品数不符', site(changed(), { manifestPatch: (m) => { patchShard(1, (sh) => { sh.works = 2 })(m); (m.counts as { works: number }).works = 5 } }), 'incomplete', B])
    cases.push(['counts.works 不符', site(changed(), { manifestPatch: (m) => { (m.counts as { works: number }).works = 7 } }), 'incomplete', 'manifest.json'])
    cases.push(['路径往上跳', site(changed(), { manifestPatch: patchShard(1, (sh) => { sh.path = '../secret.jsonl' }) }), 'bad_path', '../secret.jsonl'])
    cases.push(['绝对路径', site(changed(), { manifestPatch: patchShard(1, (sh) => { sh.path = '/etc/x' }) }), 'bad_path', '/etc/x'])
    cases.push(['带协议', site(changed(), { manifestPatch: patchShard(1, (sh) => { sh.path = 'https://evil.example/x' }) }), 'bad_path', 'https://evil.example/x'])
    cases.push(['同一个路径列了两次', site(changed(), { manifestPatch: (m) => { const l = m.shards as unknown[]; l.push(l[0]) } }), 'bad_export', A])
    cases.push(['契约主次版本不符', site(changed(), { contract: '9.9.0' }), 'bad_export', 'manifest.json'])
    cases.push(['附带文件不是数组', site(changed(), { extras: { 'bindings.json': JSON.stringify({ bindings: [] }) } }), 'bad_export', 'bindings.json'])
    cases.push(['附带文件坏 JSON', site(changed(), { extras: { 'concepts.json': '[' } }), 'bad_json', 'concepts.json'])
    const extra500 = site(changed()); const get500 = extra500.get
    extra500.get = async (u: string) => (u.endsWith('/concepts.json') ? { status: 500, async text() { return '' } } : get500(u))
    cases.push(['附带文件 500', extra500, 'unreachable', 'concepts.json'])
    const offline = site(changed()); offline.get = async () => { throw new Error('offline') }
    cases.push(['取数函数抛错', offline, 'unreachable', 'manifest.json'])
    // 哈希没变而清单说的作品数变了：这一片对不上
    cases.push(['没变的分片作品数对不上', site(v1(), { manifestPatch: (m) => { patchShard(0, (sh) => { sh.works = 3 })(m); (m.counts as { works: number }).works = 6 } }), 'incomplete', A])
    for (const [name, s, reason, path] of cases) {
      w.calls.length = 0
      const r = await refresh(s, w.store, LATER)
      expect({ name, status: r.status, reason: r.reason, path: r.path }).toEqual({ name, status: 'failed', reason, path })
      expect([name, w.writes()]).toEqual([name, []])
      expect(await w.inner.readIndex()).toEqual(before)
      expect(w.inner.keys()).toEqual(keys)
      expect(await ids(w.store)).toEqual([1, 2, 3, 4, 5].map(id))
    }
  })

  it('⑦ 写分片中途端口抛错 ⇒ store_error；读到的仍是上一版；下次刷新清掉 pending 并成功', async () => {
    const s = site(v1())
    const w = watched()
    await refresh(s, w.store)
    const v2: Shards = { ...v1(), [B]: [mk(3, ['Insomnia', 'Diet'])], [C]: [mk(4, ['Diet']), mk(7, ['Diet'])] }
    const oldB = s.key(B)
    const oldC = s.key(C)
    s.publish(v2)
    let shardWrites = 0
    w.failWhen = (op) => op === 'writeShard' && ++shardWrites === 2 // 第一片写进去了，第二片抛
    const r = await refresh(s, w.store, LATER)
    expect(r).toMatchObject({ status: 'failed', reason: 'store_error', path: C, shards: { downloaded: 2, reused: 1 } })
    const stuck = (await w.inner.readIndex())!
    expect(stuck.pending).toEqual([s.key(B), s.key(C)])
    expect(stuck.shards[B]!.key).toBe(oldB) // 生效清单没动
    expect(stuck.fetched_at).toBe(new Date(AT).toISOString())
    expect(await ids(w.store)).toEqual([1, 2, 3, 4, 5].map(id))
    expect(w.inner.keys()).toContain(s.key(B)) // 写到一半留下的
    // 存储好了：开头先把写到一半的删掉，再整个做完
    w.failWhen = null
    w.calls.length = 0
    const again = await refresh(s, w.store, LATER)
    expect(again).toMatchObject({ status: 'updated', reason: null, cleaned: 2, cleanup_failed: 0, shards: { downloaded: 2, reused: 1, removed: 0 } })
    expect(w.calls.slice(0, 4)).toEqual(['readIndex', `deleteShard ${s.key(B)}`, `deleteShard ${s.key(C)}`, 'writeIndex'])
    const done = (await w.inner.readIndex())!
    expect(done.pending).toEqual([])
    expect(done.retired.sort()).toEqual([oldB, oldC].sort())
    expect(await ids(w.store)).toEqual([1, 2, 3, 4, 7].map(id))
    await refresh(s, w.store, LATER)
    expect(w.inner.keys()).toEqual([s.key(A), s.key(B), s.key(C)].sort())
  })

  it('⑦b 首次刷新写到一半：读的人看到「还没有」而不是「空的」；最后换索引时抛错、读索引抛错也一样不动上一版', async () => {
    const s = site(v1())
    const w = watched()
    w.failWhen = (op, key) => op === 'writeShard' && key === s.key(B)
    expect(await refresh(s, w.store)).toMatchObject({ status: 'failed', reason: 'store_error', path: B })
    expect(await readCommunityShards(w.store, { tags: ALL })).toEqual({ ok: false, reason: 'no_index', path: null })
    expect(w.inner.keys()).toEqual([s.key(A)])
    w.failWhen = null
    expect(await refresh(s, w.store)).toMatchObject({ status: 'updated', cleaned: 3, shards: { downloaded: 3 } })
    expect(await ids(w.store)).toEqual([1, 2, 3, 4, 5].map(id))
    expect((await w.inner.readIndex())!.pending).toEqual([])

    // 最后换索引那一下抛错：上一版原样；新写的键记在 pending 里，下次清掉重来
    s.publish({ ...v1(), [B]: [mk(3, ['Diet'])] })
    let indexWrites = 0
    w.failWhen = (op) => op === 'writeIndex' && ++indexWrites === 2
    expect(await refresh(s, w.store, LATER)).toMatchObject({ status: 'failed', reason: 'store_error', path: null })
    expect(await ids(w.store)).toEqual([1, 2, 3, 4, 5].map(id))
    expect((await w.inner.readIndex())!.pending).toEqual([s.key(B)])
    // 读索引抛错：什么都不做
    w.failWhen = (op) => op === 'readIndex'
    w.calls.length = 0
    const hitsBeforeReadFailure = [...s.hits]
    expect(await refresh(s, w.store, LATER)).toMatchObject({ status: 'failed', reason: 'store_error' })
    expect(w.calls).toEqual(['readIndex'])
    expect(s.hits).toEqual(hitsBeforeReadFailure) // 没去拉任何文件
    w.failWhen = null
    expect(await refresh(s, w.store, LATER)).toMatchObject({ status: 'updated', cleaned: 1 })
    expect(await ids(w.store)).toEqual([1, 2, 3, 4, 5].map(id))
  })

  it('⑧ 内容改回旧哈希（A→B→A）不丢数据', async () => {
    const s = site(v1())
    const w = watched()
    await refresh(s, w.store)
    const keyA = s.key(B)
    s.publish({ ...v1(), [B]: [mk(3, ['Diet'])] })
    await refresh(s, w.store, LATER)
    const keyB = s.key(B)
    expect((await w.inner.readIndex())!.retired).toEqual([keyA])
    s.publish(v1())
    expect(s.key(B)).toBe(keyA)
    s.hits.length = 0
    w.calls.length = 0
    const r = await refresh(s, w.store, LATER)
    // 旧键还在 retired 里：开头先删，之后重新下载、重新写一遍
    expect(r).toMatchObject({ status: 'updated', cleaned: 1, shards: { downloaded: 1, reused: 2 } })
    expect(w.calls.indexOf(`deleteShard ${keyA}`)).toBeLessThan(w.calls.indexOf(`writeShard ${keyA}`))
    expect(s.shardHits()).toEqual([B])
    const index = (await w.inner.readIndex())!
    expect(index.shards[B]!.key).toBe(keyA)
    expect(index.retired).toEqual([keyB])
    expect(await ids(w.store)).toEqual([1, 2, 3, 4, 5].map(id))
    expect((await readCommunityShards(w.store, { tags: ['Insomnia'] }))).toMatchObject({ ok: true, shards_read: 1 })
    await refresh(s, w.store, LATER)
    expect(w.inner.keys()).toEqual([s.key(A), s.key(B), s.key(C)].sort())
    expect(await ids(w.store)).toEqual([1, 2, 3, 4, 5].map(id))
  })

  it('⑨ 清理不删生效键；删不掉不致命，留到下次', async () => {
    const s = site(v1())
    const w = watched()
    await refresh(s, w.store)
    // 待清理清单里混进了生效的键（比如上次删不掉又被重新启用）：不删
    const index = (await w.inner.readIndex())!
    await w.inner.writeShard('works/09.jsonl@dead', [])
    await w.inner.writeIndex({ ...index, pending: [s.key(A), 'works/09.jsonl@dead'], retired: [s.key(C), 'works/08.jsonl@gone'] })
    w.calls.length = 0
    const r = await refresh(s, w.store, LATER)
    expect(r).toMatchObject({ status: 'unchanged', cleaned: 2, cleanup_failed: 0 })
    expect(w.calls.filter((c) => c.startsWith('deleteShard'))).toEqual(['deleteShard works/09.jsonl@dead', 'deleteShard works/08.jsonl@gone'])
    expect(w.inner.keys()).toEqual([s.key(A), s.key(B), s.key(C)].sort())
    expect(await w.inner.readIndex()).toEqual(index)
    expect(await ids(w.store)).toEqual([1, 2, 3, 4, 5].map(id))

    // 删不掉：记数、键留在清单里；这次刷新照常做完
    const oldB = s.key(B)
    s.publish({ ...v1(), [B]: [mk(3, ['Diet'])] })
    await refresh(s, w.store, LATER)
    s.publish({ ...v1(), [B]: [mk(3, ['Diet', 'Anxiety'])] })
    const midB = (await w.inner.readIndex())!.shards[B]!.key
    w.failWhen = (op) => op === 'deleteShard'
    const stubborn = await refresh(s, w.store, LATER)
    expect(stubborn).toMatchObject({ status: 'updated', cleaned: 0, cleanup_failed: 1 })
    expect((await w.inner.readIndex())!.retired.sort()).toEqual([oldB, midB].sort())
    w.failWhen = null
    expect(await refresh(s, w.store, LATER)).toMatchObject({ status: 'unchanged', cleaned: 2, cleanup_failed: 0 })
    expect(w.inner.keys()).toEqual([s.key(A), s.key(B), s.key(C)].sort())
    expect((await w.inner.readIndex())!).toMatchObject({ pending: [], retired: [] })
  })

  it('⑩ 同一次下载的分片之间有同一篇 ⇒ incomplete；片内重复、整片读不出作品也是', async () => {
    const w = watched()
    const cross = site({ [A]: [mk(1, ['ADHD'])], [B]: [mk(2, ['Insomnia']), { ...mk(1, ['Insomnia']), work_id: 'doi:10.1000/W1' }] })
    const r = await refresh(cross, w.store)
    expect(r).toMatchObject({ status: 'failed', reason: 'incomplete', path: B })
    expect(r.issues).toEqual([{ code: 'duplicate_work', path: 'shards[1]' }])
    expect(w.writes()).toEqual([])
    const within = await refresh(site({ [A]: [mk(1, ['ADHD']), mk(1, ['ADHD'])] }), w.store)
    expect(within).toMatchObject({ status: 'failed', reason: 'incomplete', path: A, issues: [{ code: 'duplicate_work', path: 'shards[0][1]' }] })
    const junk = await refresh(site({ [A]: [mk(1, ['ADHD'])], [B]: [{ nope: true } as unknown as EvidenceCommunityWork] }), w.store)
    expect(junk).toMatchObject({ status: 'failed', reason: 'incomplete', path: B, issues: [{ code: 'bad_work', path: 'shards[1][0]' }] })
    expect(await readCommunityShards(w.store, { tags: ALL })).toMatchObject({ ok: false, reason: 'no_index' })
  })

  it('⑪ 宿主传进来的函数抛错 ⇒ host_error，不留写到一半的东西', async () => {
    const s = site(v1())
    const w = watched()
    await refresh(s, w.store)
    const before = await w.inner.readIndex()
    s.publish({ ...v1(), [B]: [mk(3, ['Diet'])] })
    w.calls.length = 0
    const throwsHash = await refreshCommunityShards({ base: BASE, get: s.get, sha256: () => { throw new Error('no crypto') }, store: w.store })
    expect(throwsHash).toMatchObject({ status: 'failed', reason: 'host_error', path: null })
    const throwsNow = await refreshCommunityShards({ base: BASE, get: s.get, sha256: sha, store: w.store, now: () => { throw new Error('clock') } })
    expect(throwsNow).toMatchObject({ status: 'failed', reason: 'host_error', shards: { downloaded: 1, reused: 2 } })
    expect(w.writes()).toEqual([])
    expect(await w.inner.readIndex()).toEqual(before)
    expect(await ids(w.store)).toEqual([1, 2, 3, 4, 5].map(id))
    // 哈希函数是异步的也行
    expect(await refreshCommunityShards({ base: BASE, get: s.get, sha256: async (t) => sha(t).toUpperCase(), store: w.store, now: () => new Date(LATER) })).toMatchObject({ status: 'updated' })
  })

  it('⑫ 索引读回形状残缺：当没有，整份重拉；换了导出根也整份重拉', async () => {
    const s = site(v1())
    const w = watched()
    await refresh(s, w.store)
    const good = (await w.inner.readIndex())!
    for (const broken of [{ ...good, shards: undefined }, { ...good, manifest: null }, { ...good, extras: { bindings: good.extras.bindings } }, { ...good, shards: { [A]: good.shards[A] } }, 'nonsense', []]) {
      await w.inner.writeIndex(broken as unknown as CommunityShardIndex)
      expect(await readCommunityShards(w.store, { tags: ALL })).toEqual({ ok: false, reason: 'no_index', path: null })
      s.hits.length = 0
      expect(await refresh(s, w.store, LATER)).toMatchObject({ status: 'updated', shards: { downloaded: 3, reused: 0 } })
      expect(await ids(w.store)).toEqual([1, 2, 3, 4, 5].map(id))
    }
    // pending / retired 缺了不妨碍用（只是没有东西可清）
    await w.inner.writeIndex({ ...good, pending: undefined, retired: 'x' } as unknown as CommunityShardIndex)
    expect(await refresh(s, w.store, LATER)).toMatchObject({ status: 'unchanged', cleaned: 0 })
    expect(await ids(w.store)).toEqual([1, 2, 3, 4, 5].map(id))
    // 换了导出根：不复用，整份重下；同路径同哈希的键内容相同，原地重写，不进 retired
    const moved = await refreshCommunityShards({ base: `${BASE}/`, get: s.get, sha256: sha, store: w.store, now: () => new Date(LATER) })
    expect(moved.status).toBe('unchanged')
    const other = 'https://mirror.example.org/export/v1'
    const elsewhere = await refreshCommunityShards({ base: other, get: (u) => s.get(u.replace(other, BASE)), sha256: sha, store: w.store, now: () => new Date(LATER) })
    expect(elsewhere).toMatchObject({ status: 'updated', shards: { downloaded: 3, reused: 0, removed: 0 } })
    expect(await w.inner.readIndex()).toMatchObject({ base: other, pending: [], retired: [] })
    expect(await ids(w.store)).toEqual([1, 2, 3, 4, 5].map(id))
  })
})

describe('readCommunityShards', () => {
  it('⑬ 按标签只读相关分片（写法先归一）；返回的是这些分片里的全部作品', async () => {
    const s = site(v1())
    const w = watched()
    await refresh(s, w.store)
    w.calls.length = 0
    const r = await readCommunityShards(w.store, { tags: ['#Sleep-Hygiene', 'sleep_hygiene'] })
    expect(r).toMatchObject({ ok: true, shards_read: 1, duplicates: 0 })
    expect(w.calls).toEqual(['readIndex', `readShard ${s.key(A)}`])
    expect(r.ok && r.works.map((x) => x.work_id)).toEqual([1, 2].map(id)) // 第 2 篇没有这个标签：真正的过滤在合并函数里
    w.calls.length = 0
    const adhd = await readCommunityShards(w.store, { tags: ['ＡＤＨＤ'] })
    expect(w.calls).toEqual(['readIndex', `readShard ${s.key(A)}`, `readShard ${s.key(C)}`])
    expect(adhd.ok && adhd.works.map((x) => x.work_id)).toEqual([1, 2, 4, 5].map(id))
    w.calls.length = 0
    expect(await readCommunityShards(w.store, { tags: ['Unknown', '  '] })).toMatchObject({ ok: true, works: [], shards_read: 0 })
    expect(await readCommunityShards(w.store, { tags: [] })).toMatchObject({ ok: true, works: [], shards_read: 0 })
    expect(w.calls).toEqual(['readIndex', 'readIndex'])
  })

  it('⑬b 标签清单不分状态（是超集）：「没有」的标签也算出现过', async () => {
    const w = watched()
    const odd = mk(1, ['ADHD'])
    await refresh(site({ [A]: [{ ...odd, tags: [...odd.tags, tag('Diet', 'absent')] }] }), w.store)
    expect((await w.inner.readIndex())!.shards[A]!.tags).toEqual(['adhd', 'diet'])
    expect(await readCommunityShards(w.store, { tags: ['diet'] })).toMatchObject({ ok: true, shards_read: 1 })
  })

  it('⑬c 读不到如实报：没有索引、分片不见了、条数对不上、端口抛错', async () => {
    const s = site(v1())
    const w = watched()
    expect(await readCommunityShards(w.store, { tags: ALL })).toEqual({ ok: false, reason: 'no_index', path: null })
    await refresh(s, w.store)
    await w.inner.deleteShard(s.key(B))
    expect(await readCommunityShards(w.store, { tags: ['Insomnia'] })).toEqual({ ok: false, reason: 'missing_shard', path: B })
    expect(await readCommunityShards(w.store, { tags: ['Anxiety'] })).toMatchObject({ ok: true, shards_read: 1 }) // 别的分片照常读
    await w.inner.writeShard(s.key(B), [])
    expect(await readCommunityShards(w.store, { tags: ['Insomnia'] })).toEqual({ ok: false, reason: 'missing_shard', path: B })
    await w.inner.writeShard(s.key(B), [null as unknown as EvidenceCommunityWork])
    expect(await readCommunityShards(w.store, { tags: ['Insomnia'] })).toEqual({ ok: false, reason: 'missing_shard', path: B })
    w.failWhen = (op) => op === 'readShard'
    expect(await readCommunityShards(w.store, { tags: ['Anxiety'] })).toEqual({ ok: false, reason: 'store_error', path: C })
    w.failWhen = (op) => op === 'readIndex'
    expect(await readCommunityShards(w.store, { tags: ['Anxiety'] })).toEqual({ ok: false, reason: 'store_error', path: null })
  })

  it('⑬d 新下载的分片与没变的分片有同一篇：刷新看不到，读取时只留先读到的一条并记数', async () => {
    const s = site(v1())
    const w = watched()
    await refresh(s, w.store)
    s.publish({ ...v1(), [B]: [mk(3, ['Insomnia']), mk(2, ['Insomnia'])] }) // 第 2 篇在没变的 00 片里已经有了
    expect(await refresh(s, w.store, LATER)).toMatchObject({ status: 'updated', shards: { downloaded: 1, reused: 2 } })
    const r = await readCommunityShards(w.store, { tags: ['ADHD', 'Insomnia'] })
    expect(r).toMatchObject({ ok: true, shards_read: 3, duplicates: 1 })
    expect(r.ok && r.works.map((x) => [x.work_id, x.tags.map((t) => t.tag_key)])).toEqual([
      [id(1), ['adhd', 'sleep hygiene']], [id(2), ['adhd']], [id(3), ['insomnia']], [id(4), ['anxiety']], [id(5), ['anxiety', 'adhd']],
    ])
  })
})

describe('mergeCommunityRecordsFromShards', () => {
  const ext = (rid: string, doi: string | null): EvidenceRecord => ({
    id: rid, source: 'openalex', external_id: rid.split(':')[1]!, title: rid, year: 2020, authors: [], doi, url: null, topic_ids: [], study_type: null, publication_type: 'article',
    self_reported_claim: null, direction: null, effect: null, cited_by_count: 5, is_retracted: false, is_open_access: null, provenance: { source_label: 'OpenAlex', license: 'CC0', retrieved_at: AT },
  })
  const external = [ext('openalex:W1', 'https://doi.org/10.1000/W1'), ext('openalex:W5', null), ext('openalex:W99', '10.1/other')]
  const retracted = (): EvidenceCommunityWork => { const x = mk(8, ['ADHD']); return { ...x, card: { ...x.card!, is_retracted: true } } }
  const corpus = (): Shards => ({
    [A]: [withRow(1, ['ADHD', 'Sleep hygiene'], 'double'), mk(2, ['ADHD'])],
    [B]: [mk(3, ['Insomnia']), withRow(6, ['Insomnia', 'ADHD'], 'single')],
    [C]: [mk(4, ['Anxiety']), mk(5, ['Anxiety', 'ADHD']), retracted()],
  })
  const on = { 'community.apply': 'tags_and_records' }

  it('⑭ 与整份快照路径逐字段相同', async () => {
    const s = site(corpus(), { extras: { 'bindings.json': JSON.stringify([{ tag_key: 'adhd', topic_id: 'T1', topic_name: 'ADHD', kind: 'curated', bound_at: AT, bound_by: 'ed' }]), 'concepts.json': '[]' } })
    const w = watched()
    expect((await refresh(s, w.store)).status).toBe('updated')
    const snapshot = (await refreshCommunityExport({ base: BASE, get: s.get, sha256: sha, previous: null, now: () => new Date(AT) })).snapshot!
    const inputs = [
      { tags: ['ADHD'], external, settings: on },
      { tags: ['#Sleep-Hygiene'], external, settings: on },
      { tags: ['Insomnia', 'anxiety', 'ADHD'], external, settings: { ...on, 'community.minVerification': 'single' } },
      { tags: ['Insomnia'], external: [], settings: { ...on, 'unknown.key': 1 } },
      { tags: ['Nothing here'], external, settings: on },
    ]
    for (const input of inputs) {
      w.calls.length = 0
      const fromShards = await mergeCommunityRecordsFromShards(w.store, input)
      expect(fromShards).toMatchObject({ ok: true, reason: null })
      expect({ community: fromShards.community, external: fromShards.external }).toEqual(mergeCommunityRecords(snapshot, input))
    }
    // 不是空对空：真的出了记录，同一篇的外部示例去掉了，出处是来源名与索引的取数时间
    const adhd = await mergeCommunityRecordsFromShards(w.store, inputs[0]!)
    expect(adhd.community.map((x) => x.id)).toEqual([1, 2, 6, 5].map((n) => `community:${id(n)}`))
    expect(adhd.external.map((x) => x.id)).toEqual(['openalex:W5', 'openalex:W99']) // 同 DOI 的那条去掉了
    expect(adhd.community[0]).toMatchObject({ source: 'community', study_type: 'rct', effect: { metric: 'smd', value: -0.42 }, provenance: { source_label: 'Community annotations', license: 'CC0-1.0', retrieved_at: new Date(AT).toISOString() } })
    // 只读了含这个标签的分片
    w.calls.length = 0
    await mergeCommunityRecordsFromShards(w.store, inputs[1]!)
    expect(w.calls).toEqual(['readIndex', `readShard ${s.key(A)}`])
  })

  it('⑭b 增量刷新之后仍与整份快照路径相同', async () => {
    const s = site(corpus())
    const w = watched()
    await refresh(s, w.store)
    let snapshot = (await refreshCommunityExport({ base: BASE, get: s.get, sha256: sha, previous: null, now: () => new Date(AT) })).snapshot!
    s.publish({ ...corpus(), [B]: [mk(3, ['Insomnia', 'ADHD']), withRow(6, ['Insomnia'], 'double')], 'works/03.jsonl': [mk(9, ['ADHD'])] })
    expect(await refresh(s, w.store, LATER)).toMatchObject({ status: 'updated', shards: { downloaded: 2, reused: 2 } })
    snapshot = (await refreshCommunityExport({ base: BASE, get: s.get, sha256: sha, previous: snapshot, now: () => new Date(LATER) })).snapshot!
    for (const tags of [['ADHD'], ['Insomnia'], ['Anxiety', 'Sleep hygiene']]) {
      const input = { tags, external, settings: on }
      const r = await mergeCommunityRecordsFromShards(w.store, input)
      expect({ community: r.community, external: r.external }).toEqual(mergeCommunityRecords(snapshot, input))
      expect(r.community.length).toBeGreaterThan(0)
    }
  })

  it('⑮ community.apply 关着或没有标签 ⇒ 不读存储；读不成 ⇒ 社区为空、外部示例原样、ok: false', async () => {
    const s = site(corpus())
    const w = watched()
    await refresh(s, w.store)
    w.calls.length = 0
    expect(await mergeCommunityRecordsFromShards(w.store, { tags: ['ADHD'], external })).toEqual({ community: [], external, ok: true, reason: null })
    expect(await mergeCommunityRecordsFromShards(w.store, { tags: ['ADHD'], external, settings: { 'community.apply': 'tags_only' } })).toEqual({ community: [], external, ok: true, reason: null })
    expect(await mergeCommunityRecordsFromShards(w.store, { tags: ['  '], external, settings: on })).toEqual({ community: [], external, ok: true, reason: null })
    expect(w.calls).toEqual([])
    await w.inner.deleteShard(s.key(B))
    expect(await mergeCommunityRecordsFromShards(w.store, { tags: ['Insomnia'], external, settings: on })).toEqual({ community: [], external, ok: false, reason: 'missing_shard' })
    w.failWhen = (op) => op === 'readShard'
    expect(await mergeCommunityRecordsFromShards(w.store, { tags: ['ADHD'], external, settings: on })).toEqual({ community: [], external, ok: false, reason: 'store_error' })
    const empty = createMemoryShardStore()
    const never = await mergeCommunityRecordsFromShards(empty, { tags: ['ADHD'], external, settings: on })
    expect(never).toEqual({ community: [], external, ok: false, reason: 'no_index' })
    expect(never.external).not.toBe(external)
  })

  it('⑯ 标签键只归一一次：两条路对同一个站内标签写法给出同一个结果（`#` 开头的写法归一不幂等）', async () => {
    // 导出里的标签键是 `#a`（把站内写法 `# #a` 归一一次得到的）；再归一一次会变成 `a`，就对不上了
    const odd = (): EvidenceCommunityWork => { const x = withRow(7, ['ADHD'], 'double'); return { ...x, tags: x.tags.map((t) => ({ ...t, tag_key: '#a' })) } }
    const s = site({ [A]: [odd()] })
    const w = watched()
    expect((await refresh(s, w.store)).status).toBe('updated')
    const whole = await refreshCommunityExport({ base: BASE, get: s.get, sha256: sha, now: () => new Date(AT) })
    const input = { tags: ['# #a'], external: [], settings: on }
    const a = mergeCommunityRecords(whole.snapshot, input)
    const b = await mergeCommunityRecordsFromShards(w.store, input)
    expect(a.community).toHaveLength(1)
    expect(b).toEqual({ ...a, ok: true, reason: null })
  })

  it('⑰ 从不抛：存储读回的作品缺字段、参数形状不对 ⇒ 当没读成（ok: false），不让装配图的地方崩', async () => {
    const s = site(corpus())
    const w = watched()
    await refresh(s, w.store)
    // 有人绕过引擎改了存储里的值：作品缺 rows / facets
    await w.inner.writeShard(s.key(A), [{ work_id: id(1), tags: [{ tag_key: 'adhd', state: 'present' }] }, { work_id: id(2), tags: [null] }] as never)
    await expect(mergeCommunityRecordsFromShards(w.store, { tags: ['ADHD'], external, settings: on })).resolves.toEqual({ community: [], external, ok: false, reason: 'store_error' })
    await expect(mergeCommunityRecordsFromShards(w.store, { tags: 'ADHD', external, settings: on } as never)).resolves.toMatchObject({ community: [], ok: false })
    await expect(mergeCommunityRecordsFromShards(w.store, null as never)).resolves.toEqual({ community: [], external: [], ok: false, reason: 'store_error' })
    await expect(readCommunityShards(w.store, undefined as never)).resolves.toMatchObject({ ok: true, works: [], shards_read: 0 })
    await expect(readCommunityShards(w.store, { tags: 'x' } as never)).resolves.toMatchObject({ ok: true, works: [] })
  })
})

describe('refreshCommunityShards：索引坏了', () => {
  it('⑱ 索引在但形状不可用：当没有来刷，它里面还认得出的分片键下一次刷新被清掉，不永远留着', async () => {
    const s = site(v1())
    const w = watched()
    await refresh(s, w.store)
    const good = (await w.inner.readIndex())!
    // 清单被弄丢了（形状不可用），分片键还认得出；再放一个不在新清单里的旧键
    await w.inner.writeShard('works/zz.jsonl@old', [])
    await w.inner.writeIndex({ ...good, manifest: null as never, shards: { ...good.shards, 'works/zz.jsonl': { key: 'works/zz.jsonl@old', sha256: 'old', works: 0, tags: [] } } })
    expect((await readCommunityShards(w.store, { tags: ALL })).ok).toBe(false)
    const r = await refresh(s, w.store, LATER)
    expect(r).toMatchObject({ status: 'updated', shards: { downloaded: 3, reused: 0 } })
    expect(await ids(w.store)).toEqual([1, 2, 3, 4, 5].map(id))
    expect(w.inner.keys()).toEqual([s.key(A), s.key(B), s.key(C)]) // 旧键 works/zz.jsonl@old 已清掉；同名的三片重新写过
  })
})
