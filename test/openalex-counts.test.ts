/**
 * OpenAlex 0.2.0 新增：
 *   ① 全量计数装配：分母按维度声明、二值维只信真桶、布尔 key 归一且「真」固定在前、年份暂定、缺口图交叉表、UpSet 两两交集、并发 ≤ 4；
 *      诚实分母取不到 ⇒ 那一维缺席（不拿总数顶替）；全部失败 ⇒ null；
 *   ② 缩放包的 partial 标记（缩放包本身的行为由 openalex.test.ts 钉）、按节点取示例；
 *   ③ 候选主题、按 DOI 批量取主主题（每 50 个一批，任何一批失败 ⇒ null）；
 *   ④ 每日 credit 预算：花完后收费请求不出网，免费请求照常；onCredits 只给数字；
 *   ⑤ createOpenAlexSource 把客户端包成外部源端口。
 */
import { createOpenAlexClient, createOpenAlexSource, fetchEvidenceCounts, isFreeOpenAlexPath } from '../src/openalex'

const res = (status: number, body: unknown, credits = 0) =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers({ 'x-ratelimit-credits-used': String(credits) }), json: async () => body })
const asFetch = (f: (url: string) => unknown) => jest.fn(async (url: string) => f(url)) as unknown as typeof fetch

const GROUPS: Record<string, unknown[]> = {
  publication_year: [{ key: '2023', count: 40 }, { key: '2026', count: 5 }, { key: '2024', count: 30 }, { key: '2025', count: 20 }],
  'authorships.institutions.type': [
    { key: 'education', count: 70 }, { key: 'healthcare', count: 30 }, { key: 'company', count: 10 }, { key: 'government', count: 5 }, { key: 'nonprofit', count: 3 },
  ],
  'authorships.institutions.is_global_south': [{ key: 'true', count: 12 }, { key: 'false', count: 78 }],
  'authorships.countries': [
    { key: 'https://openalex.org/countries/US', key_display_name: 'United States', count: 40 },
    { key: 'https://openalex.org/countries/CN', key_display_name: 'China', count: 30 },
  ],
  language: [{ key: 'en', count: 90 }, { key: 'zh', count: 5 }],
  'open_access.oa_status': [{ key: 'gold', count: 30 }, { key: 'closed', count: 60 }, { key: 'green', count: 10 }],
  type: [{ key: 'article', count: 80 }, { key: 'review', count: 15 }],
  is_retracted: [{ key: '0', count: 99 }, { key: '1', count: 1 }],
  'topics.subfield.id': [{ key: 'https://openalex.org/subfields/2738', key_display_name: 'Psychiatry and Mental health', count: 100 }],
  'authorships.institutions.type,publication_year': [
    { key: 'education', count: 70, groups: [{ key: '2025', count: 40 }, { key: '2024', count: 30 }] },
    { key: 'healthcare', count: 30, groups: [{ key: '2023', count: 30 }] },
  ],
}

function router(opts: { fail?: (url: string) => boolean } = {}) {
  let inFlight = 0
  let maxInFlight = 0
  const f = jest.fn(async (url: string) => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((r) => setTimeout(r, 1))
    inFlight--
    if (opts.fail?.(url)) return res(500, {})
    const u = new URL(url)
    const filter = u.searchParams.get('filter') ?? ''
    const groupBy = u.searchParams.get('group_by')
    if (!groupBy) {
      if (filter.includes('authorships.institutions.id:!null')) return res(200, { meta: { count: 60 }, results: [] }, 1)
      if (filter.includes('authorships.countries:!null')) return res(200, { meta: { count: 80 }, results: [] }, 1)
      if (filter.startsWith('topics.id:')) return res(200, { meta: { count: 150 }, results: [] }, 1)
      return res(404, {})
    }
    const m = /authorships\.institutions\.type:([a-z]+)/.exec(filter)
    if (m) {
      const other = (GROUPS['authorships.institutions.type'] as Array<{ key: string; count: number }>)
      return res(200, { meta: { count: 70 }, group_by: other.map((g) => ({ ...g, count: g.key === m[1] ? g.count : Math.floor(g.count / 3) })) }, 1)
    }
    return res(200, { meta: { count: 100 }, group_by: GROUPS[groupBy] }, 1)
  })
  return { f, max: () => maxInFlight }
}
const NOW = new Date('2026-09-29T00:00:00Z')

describe('① 全量计数装配', () => {
  it('分母、二值维、布尔 key、年份暂定、交叉表、UpSet、出处', async () => {
    const r = router()
    const client = createOpenAlexClient({ fetch: r.f as unknown as typeof fetch, log: () => {} })
    const c = (await fetchEvidenceCounts(client, 'topic', 'T10537', 'primary_topic', { display_name: 'ADHD', now: NOW }))!
    expect(c.node).toEqual({ id: 'openalex:T10537', level: 'topic', display_name: 'ADHD' })
    expect([c.total, c.other_scope_total]).toEqual([100, 150])
    const s = Object.fromEntries(c.series.map((x) => [x.dimension, x]))

    const year = s.publication_year
    expect(year.cells.map((x) => [x.key, x.count, !!x.provisional])).toEqual([['2023', 40, false], ['2024', 30, false], ['2025', 20, true], ['2026', 5, true]])
    expect([year.denominator, year.unknown]).toEqual([{ kind: 'works_with_value', value: 95 }, 5])

    const south = s.global_south
    expect(south.cells).toEqual([{ key: 'true', label: 'true', count: 12 }, { key: 'false', label: 'false', count: 48 }]) // 假＝分母 − 真，不是原始 78
    expect([south.denominator, south.unknown, south.provenance.credits]).toEqual([{ kind: 'works_with_identified_institution', value: 60 }, 40, 2])

    expect(s.retracted.cells.map((x) => [x.key, x.count])).toEqual([['true', 1], ['false', 99]]) // 布尔维固定「真」在前
    expect(s.country.cells.map((x) => [x.key, x.label])).toEqual([['US', 'United States'], ['CN', 'China']])
    expect([s.country.denominator.value, s.country.partition, s.country.unknown]).toEqual([80, false, null])
    expect(s.subfield.cells[0].key).toBe('2738')
    expect(s.oa_status.caveats).toEqual(['oa_nominal'])

    const inst = s.institution_type
    expect(inst.by).toBe('publication_year')
    expect(inst.cross![0].map((x) => [x.key, x.count, !!x.provisional])).toEqual([['2024', 30, false], ['2025', 40, true]])
    expect(inst.cross![1]).toEqual([{ key: '2023', label: '2023', count: 30 }])
    expect(inst.cross!.length).toBe(inst.cells.length)

    expect(c.overlap!.sets.map((x) => x.key)).toEqual(['education', 'healthcare', 'company', 'government'])
    expect(c.overlap!.pairs).toHaveLength(6) // C(4,2)，两边都查到也只记一次
    expect(c.overlap!.pairs[0]).toEqual({ a: 'education', b: 'healthcare', count: 10 })
    expect(c.overlap!.provenance.credits).toBe(4)

    const avail = (dim: keyof typeof c.availability, kind: string) => c.availability[dim].find((a) => a.kind === kind)!.blocker
    expect([avail('institution_type', 'egm'), avail('publication_year', 'egm'), avail('language', 'egm')]).toEqual([null, null, 'needs_cross'])
    expect([avail('institution_type', 'upset'), avail('country', 'upset')]).toEqual([null, 'needs_overlap'])
    expect(r.max()).toBeLessThanOrEqual(4)
  })
  it('诚实分母取不到 ⇒ 那一维缺席，不拿总数顶替；其余照常', async () => {
    const r = router({ fail: (u) => decodeURIComponent(u).includes('authorships.institutions.id:!null') })
    const c = (await fetchEvidenceCounts(createOpenAlexClient({ fetch: r.f as unknown as typeof fetch, log: () => {} }), 'topic', 'T1', 'primary_topic', { now: NOW }))!
    const dims = c.series.map((x) => x.dimension)
    expect(dims).not.toContain('global_south')
    expect(dims).not.toContain('institution_type')
    expect(dims).toContain('country')
    expect(c.overlap).toBeNull()
  })
  it('机构部门没有任何可用的桶 ⇒ UpSet 为 null，不崩（其余维度照常下发）', async () => {
    const saved = GROUPS['authorships.institutions.type']
    GROUPS['authorships.institutions.type'] = [{ key: 'unknown', count: 100 }]
    try {
      const r = router()
      const c = (await fetchEvidenceCounts(createOpenAlexClient({ fetch: r.f as unknown as typeof fetch, log: () => {} }), 'topic', 'T1', 'primary_topic', { now: NOW }))!
      expect(c.overlap).toBeNull()
      expect(c.series.find((x) => x.dimension === 'institution_type')!.cells).toEqual([])
      expect(c.series.length).toBe(9)
    } finally {
      GROUPS['authorships.institutions.type'] = saved
    }
  })
  it('全部失败 ⇒ null；节点 id 形状不对 ⇒ null 且不出网', async () => {
    const r = router({ fail: () => true })
    expect(await fetchEvidenceCounts(createOpenAlexClient({ fetch: r.f as unknown as typeof fetch, log: () => {} }), 'topic', 'T1', 'topics')).toBeNull()
    const f = jest.fn()
    expect(await fetchEvidenceCounts(createOpenAlexClient({ fetch: f as unknown as typeof fetch }), 'topic', 'T1,type:x', 'topics')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})

describe('② 缩放包与示例', () => {
  it('兄弟列表没拿全 ⇒ partial: true（服务层据此不写长缓存）；拿全了不带这个字段', async () => {
    const entity = { id: 'https://openalex.org/fields/27', display_name: 'Medicine', domain: { id: 'https://openalex.org/domains/4', display_name: 'Health Sciences' } }
    let n = 0
    const failList = asFetch(() => (++n === 1 ? res(200, entity) : res(500, {})))
    const partial = await createOpenAlexClient({ fetch: failList, log: () => {} }).fetchNodeBundle('field', '27')
    expect(partial?.partial).toBe(true)
    let m = 0
    const okList = asFetch(() => (++m === 1 ? res(200, entity) : res(200, { meta: { count: 1 }, results: [{ id: 'https://openalex.org/fields/32', display_name: 'Psychology', works_count: 3 }] })))
    const full = await createOpenAlexClient({ fetch: okList }).fetchNodeBundle('field', '27')
    expect(full && 'partial' in full).toBe(false)
    expect(full?.siblings.map((x) => x.external_id)).toEqual(['32'])
  })
  it('按节点取示例：主主题过滤、排除撤稿', async () => {
    const urls: string[] = []
    const f = asFetch((u) => { urls.push(u); return res(200, { results: [{ id: 'https://openalex.org/W1', title: 'x', publication_year: 2020, type: 'article' }] }, 1) })
    const recs = (await createOpenAlexClient({ fetch: f }).fetchWorksForNode('subfield', '2738', 10))!
    expect(urls[0]).toContain('filter=primary_topic.subfield.id:2738,is_retracted:false')
    expect(urls[0]).toContain('per_page=10')
    expect(recs[0]).toMatchObject({ id: 'openalex:W1', study_type: null, publication_type: 'article', effect: null, topic_ids: ['openalex:2738'] })
  })
})

describe('③ 候选主题与 DOI', () => {
  it('候选：null＝没问成，[]＝没有', async () => {
    const c = (body: unknown, status = 200) => createOpenAlexClient({ fetch: asFetch(() => res(status, body)), log: () => {} })
    expect(await c({ results: [{ id: 'https://openalex.org/T1', display_name: 'A', works_count: 3 }, { id: 'https://openalex.org/T2', display_name: 'B' }] }).suggestTopicsForTag('a', 5))
      .toEqual([{ external_id: 'T1', display_name: 'A', works_count: 3 }, { external_id: 'T2', display_name: 'B', works_count: null }])
    expect(await c({ results: [] }).suggestTopicsForTag('a')).toEqual([])
    expect(await c({}, 503).suggestTopicsForTag('a')).toBeNull()
  })
  it('DOI：每 50 个一批、URL 编码、结果按 DOI 对回；任何一批失败 ⇒ null', async () => {
    const dois = Array.from({ length: 60 }, (_, i) => `10.1000/x${i}`)
    const urls: string[] = []
    const f = asFetch((u) => {
      urls.push(u)
      const list = decodeURIComponent(new URL(u).searchParams.get('filter')!).replace(/^doi:/, '').split('|')
      return res(200, { results: list.map((d, i) => ({ id: `https://openalex.org/W${i}`, doi: d.toUpperCase().replace('HTTPS://DOI.ORG/', 'https://doi.org/'), primary_topic: i % 2 ? null : { id: 'https://openalex.org/T5', display_name: 'T5' } })) }, 1)
    })
    const out = (await createOpenAlexClient({ fetch: f }).fetchPrimaryTopicsForDois([...dois, 'not-a-doi', '10.1000/x0']))!
    expect(urls).toHaveLength(2)
    expect(urls[0]).not.toContain('|') // 编码过
    expect(out).toHaveLength(60)
    expect(out[0]).toEqual({ doi: '10.1000/x0', topic: { external_id: 'T5', display_name: 'T5', works_count: null } })
    expect(out[1].topic).toBeNull()
    let n = 0
    const flaky = asFetch(() => (++n === 2 ? res(500, {}) : res(200, { results: [] }, 1)))
    expect(await createOpenAlexClient({ fetch: flaky, log: () => {} }).fetchPrimaryTopicsForDois(dois)).toBeNull()
  })
})

describe('④ 每日预算', () => {
  it('花完后收费请求不出网，免费请求照常；onCredits 只收数字', async () => {
    const onCredits = jest.fn()
    const log = jest.fn()
    const f = jest.fn(async (url: string) => (url.includes('/autocomplete/')
      ? res(200, { results: [] }, 0)
      : res(200, { meta: { count: 1 }, group_by: [] }, 1)))
    const c = createOpenAlexClient({ fetch: f as unknown as typeof fetch, dailyCreditBudget: 2, onCredits, log })
    expect(await c.groupByWorks('primary_topic.id:T1', 'type')).not.toBeNull()
    expect(await c.groupByWorks('primary_topic.id:T1', 'language')).not.toBeNull()
    expect(c.creditsSpentToday()).toBe(2)
    expect(await c.groupByWorks('primary_topic.id:T1', 'publication_year')).toBeNull()
    expect(f).toHaveBeenCalledTimes(2)
    expect(await c.resolveTopicForTag('adhd')).toEqual({ kind: 'no_match' }) // 自动补全 0 credit，照常
    expect(f).toHaveBeenCalledTimes(3)
    expect(onCredits.mock.calls).toEqual([[1], [1]])
    expect(log).toHaveBeenCalledWith('[evidence.openalex] daily credit budget exhausted', { budget: 2 })
  })
  it('免费路径判定', () => {
    expect(isFreeOpenAlexPath('/autocomplete/topics?q=a')).toBe(true)
    expect(isFreeOpenAlexPath('/topics/T1')).toBe(true)
    expect(isFreeOpenAlexPath('/subfields/2738')).toBe(false) // 上级三级实体各 1 credit（2026-09-28 实测）
    expect(isFreeOpenAlexPath('/topics?filter=subfield.id:2738')).toBe(false)
    expect(isFreeOpenAlexPath('/works?filter=x')).toBe(false)
    expect(isFreeOpenAlexPath('/topics/T1?select=id')).toBe(false)
  })
})

describe('⑤ 外部源端口', () => {
  it('包一层：主题 id 带源前缀；null 原样传出', async () => {
    const src = createOpenAlexSource({ fetch: asFetch(() => res(200, { results: [{ id: 'https://openalex.org/T9', display_name: 'X' }] })) })
    expect(src.id).toBe('openalex')
    expect(await src.suggestTopics('x', 3)).toEqual([{ topic_id: 'openalex:T9', display_name: 'X', works_count: null }])
    const down = createOpenAlexSource({ fetch: asFetch(() => res(500, {})), log: () => {} })
    expect(await down.suggestTopics('x', 3)).toBeNull()
    expect(await down.topicsForDois!(['10.1000/a'])).toBeNull()
  })
})
