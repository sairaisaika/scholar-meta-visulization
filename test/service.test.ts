/**
 * 宿主门面（createEvidenceService）——替宿主守住的规则：
 *   ① 防滥用闸：没出现在公开文章里的标签不去问外部源（not_queried），也不花额度；
 *   ② 「没问成」不缓存（下次还会去问），「查无」照实缓存；同一个键的并发请求只打一次外部源；
 *   ③ 编辑绑定压过机器命中；否决 ⇒ no_match 且不再去问；exact_only 策略进 needs_review；
 *   ④ 主题级只汇总编辑绑定的标签；
 *   ⑤ 计数读口：外部格子被缓存，站内层每次现算；没配外部源 ⇒ not_configured；
 *   ⑥ 绑定候选：按名字 + 按引用两路证据；编辑确认前先向外部源核实主题存在；
 *   ⑦ 宿主的数据源 / 缓存抛错不让读图崩：回 unavailable 或照常取数。
 */
import { createEvidenceService, createMemoryBindingStore, createMemoryCache, createMemoryOnsiteSource } from '../src/service'
import type { EvidenceCache, ExternalEvidenceSource, ExternalLevel } from '../src/service'
import type { EvidenceCountsData, EvidenceRecord, EvidenceTopic } from '../src/types'
import { createCuratedBinding } from '../src/tags'

const NOW = new Date('2026-09-29T00:00:00Z')
const topic = (level: ExternalLevel, id: string, name: string, parent: string | null = null): EvidenceTopic => ({
  id: `openalex:${id}`, source: 'openalex', external_id: id, level, display_name: name, description: null, parent_id: parent, works_count: 1000,
})
const work = (id: string): EvidenceRecord => ({
  id: `openalex:${id}`, source: 'openalex', external_id: id, title: id, year: 2020, authors: [], doi: null, url: null, topic_ids: [],
  study_type: null, publication_type: 'article', self_reported_claim: null, direction: null, effect: null, cited_by_count: 10,
  is_retracted: false, is_open_access: true, provenance: { source_label: 'OpenAlex', license: 'CC0 1.0', retrieved_at: '2026-09-20T00:00:00Z' },
})

function fakeExternal(over: Partial<ExternalEvidenceSource> = {}) {
  const calls: string[] = []
  const src: ExternalEvidenceSource = {
    id: 'openalex',
    async suggestTopics(tag, limit) {
      calls.push(`suggest:${tag}:${limit}`)
      if (tag.toLowerCase() === 'adhd') return [
        { topic_id: 'openalex:T10537', display_name: 'Attention Deficit Hyperactivity Disorder', works_count: 110442 },
        { topic_id: 'openalex:T999', display_name: 'ADHD', works_count: 10 },
      ].slice(0, limit)
      if (tag === 'Sleep') return [{ topic_id: 'openalex:T200', display_name: 'Sleep', works_count: 500 }]
      return []
    },
    async nodeBundle(level, id) {
      calls.push(`bundle:${level}:${id}`)
      if (level === 'topic' && id.startsWith('T')) {
        return { node: topic('topic', id, id === 'T10537' ? 'Attention Deficit Hyperactivity Disorder' : `Topic ${id}`, 'openalex:2738'),
          ancestors: [topic('subfield', '2738', 'Psychiatry and Mental health', 'openalex:27')], siblings: [topic('topic', 'T1', 'Sibling')] }
      }
      if (level === 'subfield') return { node: topic('subfield', id, 'Psychiatry and Mental health', 'openalex:27'), ancestors: [topic('field', '27', 'Medicine')], siblings: [] }
      return null
    },
    async sampleWorks(level, id, limit) { calls.push(`sample:${level}:${id}:${limit}`); return [work('W1'), work('W2')] },
    async counts(level, id, scope, name) {
      calls.push(`counts:${level}:${id}:${scope}:${name}`)
      return { node: { id: `openalex:${id}`, level, display_name: name ?? id }, scope, total: 10, other_scope_total: 20, series: [], overlap: null, availability: {} } as unknown as EvidenceCountsData
    },
    async topicsForDois(dois) {
      calls.push(`dois:${dois.length}`)
      return dois.map((doi, i) => ({ doi, topic: i < 3 ? { topic_id: 'openalex:T777', display_name: 'Cited topic', works_count: null } : { topic_id: 'openalex:T10537', display_name: 'Attention Deficit Hyperactivity Disorder', works_count: null } }))
    },
    ...over,
  }
  return { src, calls }
}

const articles = [
  { id: 1, title: 'A', tags: ['ADHD', 'sleep'], year: 2024, study_design: 'rct', references: ['10.1000/a', '10.1000/b', '10.1000/c', '10.1000/d'] },
  { id: 2, title: 'B', tags: ['adhd'], year: 2023, study_design: 'cohort', claim: 'significant' },
  { id: 3, title: 'C', tags: ['Sleep'], year: 2023 },
  { id: 4, title: 'Hidden', tags: ['ADHD'], is_public: false },
]

const make = (over: Parameters<typeof createEvidenceService>[0] extends infer O ? Partial<O> : never = {}) => {
  const ext = fakeExternal()
  const bindings = createMemoryBindingStore()
  const cache = createMemoryCache()
  const log = jest.fn()
  const service = createEvidenceService({
    onsite: createMemoryOnsiteSource(articles), external: ext.src, bindings, cache, now: () => NOW, log,
    onsiteLabel: 'Site', onsiteLicense: 'CC BY 4.0', ...over,
  })
  return { service, ext, bindings, cache, log }
}

describe('标签级研究图谱', () => {
  it('机器命中（first_hit）：站内 + 外部示例，绑定带出处，公开文章以外的不进', async () => {
    const { service, ext } = make()
    const r = await service.getTagMap('ＡＤＨＤ')
    if (!r.ok) throw new Error(r.error)
    const m = r.data
    expect(m.level).toBe('tag')
    expect(m.focus).toMatchObject({ id: 'onsite:adhd', display_name: 'ADHD', parent_id: 'openalex:T10537', works_count: 2 })
    expect(m.records.map((x) => x.id)).toEqual(['onsite:1', 'onsite:2', 'openalex:W1', 'openalex:W2'])
    expect(m.binding).toMatchObject({ kind: 'machine', confidence: 'first_hit', topic_id: 'openalex:T10537' })
    expect(m.external_match).toBe('matched')
    expect(m.onsite_only).toBe(false)
    expect(m.parent?.display_name).toBe('Attention Deficit Hyperactivity Disorder')
    expect(m.view.kind).toBe('gap_map')
    expect(m.sources.map((s) => s.source_label)).toEqual(['Site', 'OpenAlex'])
    // 标签原样去问：发的是最常见的原文写法 'ADHD'，不是归一后的键
    expect(ext.calls[0]).toBe('suggest:ADHD:1')
  })
  it('① 防滥用闸：没出现在公开文章里的标签不出网', async () => {
    const { service, ext } = make()
    const r = await service.getTagMap('some random thing')
    expect(r.ok && r.data.external_match).toBe('not_queried')
    expect(r.ok && r.data.onsite_only).toBe(true)
    expect(ext.calls).toEqual([])
    const open = make({ externalGate: 'any' })
    await open.service.getTagMap('some random thing')
    expect(open.ext.calls).toEqual(['suggest:some random thing:1'])
  })
  it('② 「没问成」不缓存、下次再问；「查无」缓存；并发合并', async () => {
    let fail = true
    const ext = fakeExternal({ async suggestTopics() { ext.calls.push('suggest'); return fail ? null : [] } })
    const service = createEvidenceService({ onsite: createMemoryOnsiteSource(articles), external: ext.src, now: () => NOW, log: jest.fn() })
    const first = await service.getTagMap('sleep')
    expect(first.ok && first.data.external_match).toBe('unavailable')
    fail = false
    const second = await service.getTagMap('sleep')
    expect(second.ok && second.data.external_match).toBe('no_match')
    await service.getTagMap('sleep')
    expect(ext.calls.filter((c) => c === 'suggest')).toHaveLength(2) // 第三次命中「查无」缓存
    const c = make()
    await Promise.all([c.service.getTagMap('adhd'), c.service.getTagMap('ADHD'), c.service.getTagMap('#adhd')])
    expect(c.ext.calls.filter((x) => x.startsWith('suggest'))).toHaveLength(1)
    expect(c.ext.calls.filter((x) => x.startsWith('sample'))).toHaveLength(1)
  })
  it('③ 编辑绑定压过机器；否决 ⇒ no_match 且不出网；同主题的其他编辑标签作兄弟', async () => {
    const { service, ext, bindings } = make()
    await bindings.put(createCuratedBinding({ tag: 'ADHD', topic: { id: 'openalex:T999', display_name: 'ADHD' }, by: 'ed', at: NOW.toISOString() })!)
    await bindings.put(createCuratedBinding({ tag: '注意力缺陷', topic: { id: 'openalex:T999', display_name: 'ADHD' }, by: 'ed', at: NOW.toISOString() })!)
    const r = await service.getTagMap('adhd')
    if (!r.ok) throw new Error(r.error)
    expect(r.data.binding?.kind).toBe('curated')
    expect(r.data.parent?.external_id).toBe('T999')
    expect(r.data.siblings.map((s) => s.external_id)).toEqual(['注意力缺陷'])
    expect(ext.calls.some((c) => c.startsWith('suggest'))).toBe(false)
    await bindings.put(createCuratedBinding({ tag: 'sleep', topic: null, by: 'ed', at: NOW.toISOString() })!)
    const rej = await service.getTagMap('sleep')
    expect(rej.ok && rej.data.external_match).toBe('no_match')
    expect(rej.ok && rej.data.binding?.kind).toBe('rejected')
    expect(ext.calls.some((c) => c.startsWith('suggest:Sleep'))).toBe(false)
  })
  it('③ exact_only：非同名命中进 needs_review，不显示外部文献；off：只认编辑绑定', async () => {
    const strict = make({ machineBinding: 'exact_only' })
    const r = await strict.service.getTagMap('adhd')
    expect(r.ok && [r.data.external_match, r.data.binding, r.data.records.length]).toEqual(['needs_review', null, 2])
    const exact = await strict.service.getTagMap('sleep')
    expect(exact.ok && exact.data.binding?.confidence).toBe('exact')
    const off = make({ machineBinding: 'off' })
    const o = await off.service.getTagMap('adhd')
    expect(o.ok && o.data.external_match).toBe('not_queried')
    expect(off.ext.calls).toEqual([])
  })
  it('没配外部源：只有站内，not_queried', async () => {
    const service = createEvidenceService({ onsite: createMemoryOnsiteSource(articles), now: () => NOW })
    const r = await service.getTagMap('adhd')
    expect(r.ok && [r.data.external_match, r.data.onsite_only, r.data.records.length]).toEqual(['not_queried', true, 2])
  })
  it('非法标签 ⇒ invalid_input', async () => {
    const { service } = make()
    expect(await service.getTagMap('   ')).toEqual({ ok: false, error: 'invalid_input' })
  })
})

describe('节点级与计数', () => {
  it('④ 主题级只汇总编辑绑定的标签（机器匹配的不汇总）', async () => {
    const { service, bindings } = make()
    await service.getTagMap('adhd') // 机器命中 T10537，但不入绑定表
    const before = await service.getNodeMap('topic', 'T10537')
    expect(before.ok && before.data.records.filter((r) => r.source === 'onsite')).toEqual([])
    await bindings.put(createCuratedBinding({ tag: 'adhd', topic: { id: 'openalex:T10537', display_name: 'x' }, by: 'ed', at: NOW.toISOString() })!)
    const after = await service.getNodeMap('topic', 'T10537')
    if (!after.ok) throw new Error(after.error)
    expect(after.data.records.filter((r) => r.source === 'onsite').map((r) => r.id)).toEqual(['onsite:1', 'onsite:2'])
    expect(after.data.parent?.level).toBe('subfield')
    expect(after.data.siblings.map((s) => s.external_id)).toEqual(['T1'])
  })
  it('节点 id 验形；没配外部源 ⇒ not_configured；外部源取不到 ⇒ unavailable；allowNode 拦截', async () => {
    const { service } = make()
    expect(await service.getNodeMap('topic', '10537')).toEqual({ ok: false, error: 'invalid_input' })
    expect(await service.getNodeMap('field', '27')).toEqual({ ok: false, error: 'unavailable' })
    const none = createEvidenceService({ onsite: createMemoryOnsiteSource([]) })
    expect(await none.getNodeMap('topic', 'T1')).toEqual({ ok: false, error: 'not_configured' })
    const gated = make({ allowNode: (level) => level !== 'subfield' })
    expect(await gated.service.getNodeMap('subfield', '2738')).toEqual({ ok: false, error: 'not_found' })
  })
  it('⑤ 计数：外部格子缓存，站内层现算', async () => {
    const { service, ext, bindings } = make()
    await bindings.put(createCuratedBinding({ tag: 'adhd', topic: { id: 'openalex:T10537', display_name: 'x' }, by: 'ed', at: NOW.toISOString() })!)
    const a = await service.getCounts('topic', 'T10537')
    const b = await service.getCounts('topic', 'T10537')
    if (!a.ok || !b.ok) throw new Error('counts')
    expect(ext.calls.filter((c) => c.startsWith('counts'))).toEqual(['counts:topic:T10537:primary_topic:Attention Deficit Hyperactivity Disorder'])
    expect(a.data.onsite?.total).toBe(2)
    expect(a.data.onsite?.scope).toEqual({ level: 'topic', id: 'openalex:T10537', display_name: 'Attention Deficit Hyperactivity Disorder', tag_keys: ['adhd'] })
    expect(await service.getCounts('topic', 'T10537', 'nope' as never)).toEqual({ ok: false, error: 'invalid_input' })
  })
  it('标签的站内层与全站共现图（节点只标人工绑定的主题）', async () => {
    const { service, bindings } = make()
    const tc = await service.getTagCounts('adhd')
    if (!tc.ok) throw new Error(tc.error)
    expect(tc.data.total).toBe(2)
    expect(tc.data.scope).toEqual({ level: 'tag', id: 'onsite:adhd', display_name: 'ADHD', tag_keys: ['adhd'] })
    await bindings.put(createCuratedBinding({ tag: 'sleep', topic: { id: 'openalex:T200', display_name: 'Sleep' }, by: 'ed', at: NOW.toISOString() })!)
    const g = await service.getTagGraph({ minSupport: 1 })
    if (!g.ok) throw new Error(g.error)
    expect(g.data.records).toBe(3)
    expect(Object.fromEntries(g.data.nodes.map((n) => [n.key, n.topic_id]))).toEqual({ adhd: null, sleep: 'openalex:T200' })
    expect(await service.getTagGraph({ focus: '   ' })).toEqual({ ok: false, error: 'invalid_input' })
  })
})

describe('编辑与作者', () => {
  it('⑥ 绑定候选：引用证据排前，名字证据与名次保留', async () => {
    const { service, ext } = make()
    const r = await service.suggestBindings('adhd', { limit: 2 })
    if (!r.ok) throw new Error(r.error)
    expect(ext.calls).toContain('dois:4')
    expect(r.data.map((s) => [s.topic_id, s.rank, s.name_match, s.cited?.in_topic ?? null])).toEqual([
      ['openalex:T777', null, 'none', 3],
      ['openalex:T10537', 0, 'none', 1],
      ['openalex:T999', 1, 'exact', 0],
    ])
    expect(r.data[0].cited).toMatchObject({ works: 4, share: 0.75 })
  })
  it('⑥ 编辑确认：先核实主题存在，显示名取外部源的', async () => {
    const { service, bindings } = make()
    const r = await service.curate({ tag: 'ADHD', topic_id: 'openalex:T10537', by: 'editor-7' })
    if (!r.ok) throw new Error(r.error)
    expect(r.data).toMatchObject({ tag_key: 'adhd', kind: 'curated', topic_name: 'Attention Deficit Hyperactivity Disorder', bound_by: 'editor-7' })
    expect((await bindings.get('adhd'))?.topic_id).toBe('openalex:T10537')
    expect(await service.curate({ tag: 'adhd', topic_id: 'openalex:X1', by: null })).toEqual({ ok: false, error: 'invalid_input' })
    const noStore = createEvidenceService({ onsite: createMemoryOnsiteSource([]) })
    expect(await noStore.curate({ tag: 'a', topic_id: null, by: null })).toEqual({ ok: false, error: 'not_configured' })
  })
  it('作者入库反馈', () => {
    const { service } = make()
    const r = service.intake({ id: 'x', title: 'T', effect: { metric: 'or', value: -1 } })
    expect(r.issues.map((i) => i.code)).toEqual(['ratio_not_positive'])
    expect(r.record?.provenance).toEqual({ source_label: 'Site', license: 'CC BY 4.0', retrieved_at: NOW.toISOString() })
  })
})

describe('⑦ 宿主端口出错', () => {
  it('文章源抛错 ⇒ unavailable（不是空图）；日志不含读者信息', async () => {
    const log = jest.fn()
    const service = createEvidenceService({ onsite: { listArticles: async () => { throw new Error('db down') } }, log })
    expect(await service.getTagMap('adhd')).toEqual({ ok: false, error: 'unavailable' })
    expect(log).toHaveBeenCalledWith('[evidence.service] failed', { error: 'db down' })
  })
  it('缓存抛错 ⇒ 照常取数', async () => {
    const broken: EvidenceCache = { get: async () => { throw new Error('kv') }, set: async () => { throw new Error('kv') } }
    const { service } = make({ cache: broken })
    const r = await service.getTagMap('adhd')
    expect(r.ok && r.data.external_match).toBe('matched')
  })

describe('审查修复', () => {
  it('共现图不进宿主缓存（它的键来自读者输入，不许挤掉花了外部额度的条目）', async () => {
    const cache = createMemoryCache()
    const { service } = make({ cache })
    await service.getTagMap('adhd')
    const before = cache.size()
    for (let i = 1; i <= 20; i++) await service.getTagGraph({ minSupport: 1, maxNodes: i })
    expect(cache.size()).toBe(before)
  })
  it('编辑改绑定后，任何一张共现图立刻反映（包括带参数的、以别的标签为中心的）', async () => {
    const { service } = make()
    const q = { focus: 'sleep', minSupport: 1 }
    const before = await service.getTagGraph(q)
    expect(before.ok && before.data.nodes.find((n) => n.key === 'adhd')!.topic_id).toBeNull()
    await service.curate({ tag: 'adhd', topic_id: 'openalex:T10537', by: 'ed' })
    const after = await service.getTagGraph(q)
    expect(after.ok && after.data.nodes.find((n) => n.key === 'adhd')!.topic_id).toBe('openalex:T10537')
  })
  it('引用太多时按确定性伪随机抽样，且只查一次', async () => {
    const many = Array.from({ length: 300 }, (_, i) => `10.${1001 + (i % 5)}/r${i}`)
    const ext = fakeExternal()
    const service = createEvidenceService({
      onsite: createMemoryOnsiteSource([{ id: 1, title: 'A', tags: ['adhd'], references: many }]), external: ext.src, maxReferenceDois: 100, log: () => {},
    })
    await service.suggestBindings('adhd')
    await service.suggestBindings('adhd')
    expect(ext.calls.filter((c) => c.startsWith('dois'))).toEqual(['dois:100'])
  })
})
})

describe('编辑待办队列', () => {
  it('只列还没有编辑结论的标签，按文章数排；带读者现在看到的状态与机器候选', async () => {
    const { service, bindings, ext } = make({ machineBinding: 'exact_only' })
    await bindings.put(createCuratedBinding({ tag: 'sleep', topic: null, by: 'ed', at: NOW.toISOString() })!) // 已否决：不进队列
    const r = await service.bindingQueue()
    if (!r.ok) throw new Error(r.error)
    expect(r.data).toEqual([{
      tag_key: 'adhd', label: 'ADHD', articles: 2, external_match: 'needs_review', binding: null,
      candidate: { topic_id: 'openalex:T10537', display_name: 'Attention Deficit Hyperactivity Disorder' },
    }])
    await service.bindingQueue()
    expect(ext.calls.filter((c) => c.startsWith('suggest'))).toHaveLength(1) // 自动补全结果缓存
    const noStore = createEvidenceService({ onsite: createMemoryOnsiteSource(articles) })
    expect(await noStore.bindingQueue()).toEqual({ ok: false, error: 'not_configured' })
  })
  it('first_hit 策略：读者看到的是机器绑定；minArticles 过滤长尾', async () => {
    const { service } = make()
    const r = await service.bindingQueue({ minArticles: 2 })
    expect(r.ok && r.data.map((x) => [x.tag_key, x.external_match, x.binding?.confidence])).toEqual([['adhd', 'matched', 'first_hit'], ['sleep', 'matched', 'exact']])
    expect(await service.bindingQueue({ minArticles: 3 })).toEqual({ ok: true, data: [] })
  })
})

describe('残缺缩放包', () => {
  it('兄弟没取全的缩放包照常用，但不写长缓存（下次还会去取）', async () => {
    let calls = 0
    const ext = fakeExternal({
      async nodeBundle(level, id) {
        calls++
        return { node: topic(level, id, 'X', null), ancestors: [], siblings: [], partial: true }
      },
    })
    const service = createEvidenceService({ onsite: createMemoryOnsiteSource([]), external: ext.src, log: () => {} })
    expect((await service.getNodeMap('field', '27')).ok).toBe(true)
    expect((await service.getNodeMap('field', '27')).ok).toBe(true)
    expect(calls).toBe(2)
  })
})

describe('图谱里的边', () => {
  it('标签图谱带上记录之间的边：站内文章引用的外部示例、共有别的标签的站内文章', async () => {
    const withRefs = [
      { id: 1, title: 'A', tags: ['adhd', 'sleep'], references: ['10.1000/w1'] },
      { id: 2, title: 'B', tags: ['adhd', 'sleep'] },
    ]
    const ext = fakeExternal({ async sampleWorks() { return [{ ...work('W1'), doi: 'https://doi.org/10.1000/W1' }] } })
    const service = createEvidenceService({ onsite: createMemoryOnsiteSource(withRefs), external: ext.src, log: () => {} })
    const r = await service.getTagMap('adhd')
    expect(r.ok && r.data.edges).toEqual([
      { from: 'onsite:1', to: 'openalex:W1', kind: 'cites' },
      { from: 'onsite:1', to: 'onsite:2', kind: 'shares_tag' },
    ])
  })
})
