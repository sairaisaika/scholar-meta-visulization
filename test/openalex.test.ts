/**
 * OpenAlex 适配器：
 *   ① 429 退避：按 Retry-After 等一下再试；连续 429 超过上限仍如实失败（null，不当成「零」）；其他非 2xx 不重试；
 *   ② 标签解析三态：网络错误 / 非 2xx / 形状不对都是 `error`，**不是**「查无」；空结果才是 `no_match`；
 *   ③ key 只走 `Authorization: Bearer` 头：不进 URL、不进日志；没配不带；可以传函数现取；
 *   ④ 注入的 fetch / baseUrl 生效；
 *   ⑤ 四级节点 bundle：实体先、同级列表后；祖先从近到远带 parent_id；兄弟去掉自己、带 works_count、不读实体自带的 siblings[]；
 *      id 形状不对不出网；列表失败回残缺 bundle 不回 null；同父超过 200 个翻页（实测 subfield 3312 有 224 个 topic），不足一页不翻。
 */
import { createOpenAlexClient } from '../src/openalex'

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body })
const tooMany = () => res(429, {}, { 'retry-after': '0.01' })
const grouped = { meta: { count: 10 }, group_by: [{ key: 'article', key_display_name: 'article', count: 10 }] }
const asFetch = (f: jest.Mock) => f as unknown as typeof fetch

describe('OpenAlex · 429 退避', () => {
  const log = jest.fn()
  it('429 一次后成功 ⇒ 拿到结果，共打两次', async () => {
    const f = jest.fn().mockResolvedValueOnce(tooMany()).mockResolvedValueOnce(res(200, grouped, { 'x-ratelimit-credits-used': '1' }))
    const r = await createOpenAlexClient({ fetch: asFetch(f), log }).groupByWorks('primary_topic.id:T1', 'type')
    expect(r?.total).toBe(10)
    expect(r?.credits).toBe(1)
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('连续 429 超过重试上限 ⇒ null，共打三次', async () => {
    const f = jest.fn().mockResolvedValue(tooMany())
    expect(await createOpenAlexClient({ fetch: asFetch(f), log }).groupByWorks('primary_topic.id:T1', 'type')).toBeNull()
    expect(f).toHaveBeenCalledTimes(3)
  })
  it('其他非 2xx（如 400）不重试', async () => {
    const f = jest.fn().mockResolvedValue(res(400, {}))
    expect(await createOpenAlexClient({ fetch: asFetch(f), log }).groupByWorks('primary_topic.id:T1', 'type')).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('OpenAlex · 标签解析三态', () => {
  const log = jest.fn()
  const client = (f: jest.Mock) => createOpenAlexClient({ fetch: asFetch(f), log })
  it('出错 ≠ 查无', async () => {
    expect(await client(jest.fn().mockRejectedValue(new Error('ECONNRESET'))).resolveTopicForTag('adhd')).toEqual({ kind: 'error' })
    expect(await client(jest.fn().mockResolvedValue(res(503, {}))).resolveTopicForTag('adhd')).toEqual({ kind: 'error' })
    expect(await client(jest.fn().mockResolvedValue(res(200, { results: 'nope' }))).resolveTopicForTag('adhd')).toEqual({ kind: 'error' })
    expect(await client(jest.fn().mockResolvedValue(res(200, { results: [] }))).resolveTopicForTag('焦虑')).toEqual({ kind: 'no_match' })
    expect(await client(jest.fn().mockResolvedValue(res(200, { results: [{ id: 'https://openalex.org/T10537', display_name: 'ADHD', works_count: 9 }] })))
      .resolveTopicForTag('adhd')).toEqual({ kind: 'matched', external_id: 'T10537', display_name: 'ADHD', works_count: 9 })
  })
  it('空白标签不出网', async () => {
    const f = jest.fn()
    expect(await client(f).resolveTopicForTag('   ')).toEqual({ kind: 'no_match' })
    expect(f).not.toHaveBeenCalled()
  })
  it('标签原样去问（不翻译、不改写），只做 URL 编码', async () => {
    const f = jest.fn().mockResolvedValue(res(200, { results: [] }))
    await client(f).resolveTopicForTag('焦虑')
    expect(f.mock.calls[0][0]).toBe(`https://api.openalex.org/autocomplete/topics?q=${encodeURIComponent('焦虑')}`)
  })
})

describe('OpenAlex · API key', () => {
  it('没配不带 Authorization', async () => {
    const f = jest.fn().mockResolvedValue(res(200, { results: [] }))
    await createOpenAlexClient({ fetch: asFetch(f) }).resolveTopicForTag('adhd')
    expect((f.mock.calls[0][1] as { headers: Record<string, string> }).headers.authorization).toBeUndefined()
  })
  it('配了只进请求头：不进 URL、不进日志（含失败日志）；函数形式每次现取', async () => {
    const log = jest.fn()
    let key = 'sk-test-123'
    const f = jest.fn().mockResolvedValueOnce(res(200, { results: [] })).mockResolvedValueOnce(res(500, {})).mockResolvedValueOnce(res(200, { results: [] }))
    const c = createOpenAlexClient({ fetch: asFetch(f), log, apiKey: () => key })
    await c.resolveTopicForTag('adhd')
    await c.groupByWorks('primary_topic.id:T1', 'type')
    key = 'sk-rotated'
    await c.resolveTopicForTag('adhd')
    const calls = f.mock.calls as Array<[string, { headers: Record<string, string> }]>
    expect(calls[0][1].headers.authorization).toBe('Bearer sk-test-123')
    expect(calls[2][1].headers.authorization).toBe('Bearer sk-rotated')
    for (const [url] of calls) { expect(url).not.toContain('sk-'); expect(url).not.toMatch(/api_key=/) }
    expect(log).toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls)).not.toContain('sk-')
  })
  it('baseUrl 可换（去掉结尾斜杠）', async () => {
    const f = jest.fn().mockResolvedValue(res(200, { results: [] }))
    await createOpenAlexClient({ fetch: asFetch(f), baseUrl: 'https://mirror.example.org/' }).resolveTopicForTag('adhd')
    expect(f.mock.calls[0][0]).toMatch(/^https:\/\/mirror\.example\.org\/autocomplete\/topics\?q=adhd$/)
  })
})

describe('OpenAlex · fetchNodeBundle（四级节点：实体 + 同父兄弟列表）', () => {
  const SEL = 'select=id,display_name,works_count&per_page=200'
  const field27 = { id: 'https://openalex.org/fields/27', display_name: 'Medicine' }
  const domain4 = { id: 'https://openalex.org/domains/4', display_name: 'Health Sciences' }
  const urls = (f: jest.Mock) => f.mock.calls.map((c) => c[0] as string)
  const brief = (t: { level: string; id: string; parent_id: string | null }) => [t.level, t.id, t.parent_id]

  it('subfield：祖先 [field, domain]；兄弟走 /subfields?filter=field.id 列表，去掉自己、带 works_count、parent_id 指向 field', async () => {
    const f = jest.fn()
      .mockResolvedValueOnce(res(200, {
        id: 'https://openalex.org/subfields/2738', display_name: 'Psychiatry and Mental health', description: 'desc', works_count: 4321,
        field: field27, domain: domain4,
        // 实体自带的 siblings[] 在 subfield 级是「全部 252 个 subfield」而非同父兄弟——必须不读
        siblings: [{ id: 'https://openalex.org/subfields/1101', display_name: 'Decoy from another field' }],
      }))
      .mockResolvedValueOnce(res(200, { results: [
        { id: 'https://openalex.org/subfields/2738', display_name: 'Psychiatry and Mental health', works_count: 4321 },
        { id: 'https://openalex.org/subfields/2739', display_name: 'Neurology', works_count: 123 },
      ] }))
    const b = await createOpenAlexClient({ fetch: asFetch(f), log: jest.fn() }).fetchNodeBundle('subfield', '2738')
    expect(urls(f)).toEqual(['https://api.openalex.org/subfields/2738', `https://api.openalex.org/subfields?filter=field.id:27&${SEL}`])
    expect(b?.node).toEqual({
      id: 'openalex:2738', source: 'openalex', external_id: '2738', level: 'subfield',
      display_name: 'Psychiatry and Mental health', description: 'desc', parent_id: 'openalex:27', works_count: 4321,
    })
    expect(b?.ancestors.map(brief)).toEqual([['field', 'openalex:27', 'openalex:4'], ['domain', 'openalex:4', null]])
    expect(b?.siblings).toEqual([expect.objectContaining({
      id: 'openalex:2739', level: 'subfield', display_name: 'Neurology', works_count: 123, parent_id: 'openalex:27',
    })])
    expect(b?.siblings.map((s) => s.id)).not.toContain('openalex:1101')
  })

  it('field：祖先只有 domain；兄弟走 /fields?filter=domain.id', async () => {
    const f = jest.fn()
      .mockResolvedValueOnce(res(200, { id: 'https://openalex.org/fields/27', display_name: 'Medicine', works_count: 99, domain: domain4 }))
      .mockResolvedValueOnce(res(200, { results: [
        { id: 'https://openalex.org/fields/27', display_name: 'Medicine', works_count: 99 },
        { id: 'https://openalex.org/fields/32', display_name: 'Psychology', works_count: 42 },
      ] }))
    const b = await createOpenAlexClient({ fetch: asFetch(f), log: jest.fn() }).fetchNodeBundle('field', '27')
    expect(urls(f)).toEqual(['https://api.openalex.org/fields/27', `https://api.openalex.org/fields?filter=domain.id:4&${SEL}`])
    expect(brief(b!.node)).toEqual(['field', 'openalex:27', 'openalex:4'])
    expect(b?.ancestors.map(brief)).toEqual([['domain', 'openalex:4', null]])
    expect(b?.siblings.map((s) => [s.id, s.works_count, s.parent_id])).toEqual([['openalex:32', 42, 'openalex:4']])
  })

  it('domain：没有祖先、parent_id 为 null；兄弟 = /domains 全部（去掉自己）', async () => {
    const f = jest.fn()
      .mockResolvedValueOnce(res(200, { id: 'https://openalex.org/domains/4', display_name: 'Health Sciences', works_count: 7 }))
      .mockResolvedValueOnce(res(200, { results: [
        { id: 'https://openalex.org/domains/1', display_name: 'Life Sciences', works_count: 1 },
        { id: 'https://openalex.org/domains/4', display_name: 'Health Sciences', works_count: 7 },
        { id: 'https://openalex.org/domains/2', display_name: 'Social Sciences', works_count: 2 },
      ] }))
    const b = await createOpenAlexClient({ fetch: asFetch(f), log: jest.fn() }).fetchNodeBundle('domain', '4')
    expect(urls(f)).toEqual(['https://api.openalex.org/domains/4', `https://api.openalex.org/domains?${SEL}`])
    expect(brief(b!.node)).toEqual(['domain', 'openalex:4', null])
    expect(b?.ancestors).toEqual([])
    // 约定：兄弟按 works_count 从多到少，不管外部源列表的缺省顺序
    expect(b?.siblings.map((s) => [s.id, s.works_count, s.parent_id])).toEqual([['openalex:2', 2, null], ['openalex:1', 1, null]])
  })
  it('约定：兄弟按 works_count 从多到少；没有篇数的排最后；同数按 id', async () => {
    const f = jest.fn()
      .mockResolvedValueOnce(res(200, { id: 'https://openalex.org/domains/4', display_name: 'Health Sciences', works_count: 7 }))
      .mockResolvedValueOnce(res(200, { results: [
        { id: 'https://openalex.org/domains/3', display_name: 'C', works_count: null },
        { id: 'https://openalex.org/domains/2', display_name: 'B', works_count: 5 },
        { id: 'https://openalex.org/domains/1', display_name: 'A', works_count: 5 },
        { id: 'https://openalex.org/domains/5', display_name: 'E', works_count: 9 },
      ] }))
    const b = await createOpenAlexClient({ fetch: asFetch(f), log: jest.fn() }).fetchNodeBundle('domain', '4')
    expect(b?.siblings.map((s) => s.id)).toEqual(['openalex:5', 'openalex:1', 'openalex:2', 'openalex:3'])
  })

  it('topic：三级祖先；兄弟走 /topics?filter=subfield.id 而不是实体自带的 siblings[]；fetchTopicBundle 是同一条路的薄包装', async () => {
    const topicEntity = {
      id: 'https://openalex.org/T10537', display_name: 'ADHD', works_count: 110442,
      subfield: { id: 'https://openalex.org/subfields/2738', display_name: 'Psychiatry and Mental health' }, field: field27, domain: domain4,
      siblings: [{ id: 'https://openalex.org/T99999', display_name: 'Inline decoy' }],
    }
    const topicList = { results: [
      { id: 'https://openalex.org/T10537', display_name: 'ADHD', works_count: 110442 },
      { id: 'https://openalex.org/T10001', display_name: 'Autism', works_count: 88 },
    ] }
    const f = jest.fn().mockResolvedValueOnce(res(200, topicEntity)).mockResolvedValueOnce(res(200, topicList))
    const b = await createOpenAlexClient({ fetch: asFetch(f), log: jest.fn() }).fetchNodeBundle('topic', 'T10537')
    expect(urls(f)).toEqual(['https://api.openalex.org/topics/T10537', `https://api.openalex.org/topics?filter=subfield.id:2738&${SEL}`])
    expect(brief(b!.node)).toEqual(['topic', 'openalex:T10537', 'openalex:2738'])
    expect(b?.ancestors.map(brief)).toEqual([
      ['subfield', 'openalex:2738', 'openalex:27'], ['field', 'openalex:27', 'openalex:4'], ['domain', 'openalex:4', null],
    ])
    expect(b?.siblings.map((s) => [s.id, s.works_count, s.parent_id])).toEqual([['openalex:T10001', 88, 'openalex:2738']])

    const g = jest.fn().mockResolvedValueOnce(res(200, topicEntity)).mockResolvedValueOnce(res(200, topicList))
    const t = await createOpenAlexClient({ fetch: asFetch(g), log: jest.fn() }).fetchTopicBundle('T10537')
    expect(g).toHaveBeenCalledTimes(2)
    expect(t?.topic).toEqual(b?.node)
    expect(t?.ancestors).toEqual(b?.ancestors)
    // 兄弟来自列表（带 works_count），不是实体内联的那一份
    expect(t?.siblings.map((s) => [s.id, s.works_count])).toEqual([['openalex:T10001', 88]])
  })

  it('id 形状不对 ⇒ null，且不出网（主题 T…，上级三级纯数字）', async () => {
    const f = jest.fn()
    const c = createOpenAlexClient({ fetch: asFetch(f), log: jest.fn() })
    expect(await c.fetchNodeBundle('topic', '2738')).toBeNull()
    expect(await c.fetchNodeBundle('subfield', 'T10537')).toBeNull()
    expect(await c.fetchNodeBundle('field', 'abc')).toBeNull()
    expect(await c.fetchNodeBundle('domain', '')).toBeNull()
    expect(await c.fetchNodeBundle('subfield', '27/../works')).toBeNull()
    expect(await c.fetchTopicBundle('2738')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('实体拿到、列表 500 ⇒ 残缺 bundle（siblings []）而不是 null，并记一条日志', async () => {
    const log = jest.fn()
    const f = jest.fn()
      .mockResolvedValueOnce(res(200, { id: 'https://openalex.org/subfields/2738', display_name: 'Psychiatry and Mental health', field: field27, domain: domain4 }))
      .mockResolvedValueOnce(res(500, {}))
    const b = await createOpenAlexClient({ fetch: asFetch(f), log }).fetchNodeBundle('subfield', '2738')
    expect(b).not.toBeNull()
    expect(b?.node.id).toBe('openalex:2738')
    expect(b?.ancestors).toHaveLength(2)
    expect(b?.siblings).toEqual([])
    expect(log.mock.calls.some(([m]) => String(m).includes('partial bundle'))).toBe(true)
  })

  it('实体 404 / 形状不对 ⇒ null，不再去打列表', async () => {
    const f = jest.fn().mockResolvedValueOnce(res(404, {}))
    expect(await createOpenAlexClient({ fetch: asFetch(f), log: jest.fn() }).fetchNodeBundle('field', '27')).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
    const g = jest.fn().mockResolvedValueOnce(res(200, { display_name: 'no id' }))
    expect(await createOpenAlexClient({ fetch: asFetch(g), log: jest.fn() }).fetchNodeBundle('field', '27')).toBeNull()
    expect(g).toHaveBeenCalledTimes(1)
  })

  // 2026-09-28 `/topics?group_by=subfield.id` 核对：subfield 3312 有 224 个 topic，超过 per_page 上限 200——只打一页会悄悄少 24 个兄弟
  const sub3312 = { id: 'https://openalex.org/subfields/3312', display_name: 'Sociology and Political Science' }
  const topicPage = (from: number, to: number) => ({
    meta: { count: 224 },
    results: Array.from({ length: to - from + 1 }, (_, i) => ({ id: `https://openalex.org/T${from + i}`, display_name: `t${from + i}`, works_count: 1 })),
  })

  it('同父超过 200 个 ⇒ 第二页显式 &page=2，兄弟拼齐（224 − 自己 = 223）', async () => {
    const f = jest.fn()
      .mockResolvedValueOnce(res(200, { id: 'https://openalex.org/T1', display_name: 't1', subfield: sub3312, field: field27, domain: domain4 }))
      .mockResolvedValueOnce(res(200, topicPage(1, 200)))
      .mockResolvedValueOnce(res(200, topicPage(201, 224)))
    const b = await createOpenAlexClient({ fetch: asFetch(f), log: jest.fn() }).fetchNodeBundle('topic', 'T1')
    expect(urls(f)).toEqual([
      'https://api.openalex.org/topics/T1',
      `https://api.openalex.org/topics?filter=subfield.id:3312&${SEL}`,
      `https://api.openalex.org/topics?filter=subfield.id:3312&${SEL}&page=2`,
    ])
    expect(b?.siblings).toHaveLength(223)
    expect(b?.siblings.map((s) => s.id)).not.toContain('openalex:T1')
    expect(b?.siblings.find((s) => s.id === 'openalex:T224')).toEqual(expect.objectContaining({ parent_id: 'openalex:3312', works_count: 1 }))
  })

  it('第二页没拿到 ⇒ 第一页的兄弟照留（残缺 bundle）并记日志；不足一页时不翻页', async () => {
    const log = jest.fn()
    const f = jest.fn()
      .mockResolvedValueOnce(res(200, { id: 'https://openalex.org/T1', display_name: 't1', subfield: sub3312, field: field27, domain: domain4 }))
      .mockResolvedValueOnce(res(200, topicPage(1, 200)))
      .mockResolvedValueOnce(res(500, {}))
    const b = await createOpenAlexClient({ fetch: asFetch(f), log }).fetchNodeBundle('topic', 'T1')
    expect(f).toHaveBeenCalledTimes(3)
    expect(b?.siblings).toHaveLength(199)
    expect(log.mock.calls.some(([m, d]) => String(m).includes('partial bundle') && (d as { page?: number }).page === 2)).toBe(true)

    // meta.count 说只有 16 个 ⇒ 一页收工，不打第二页
    const g = jest.fn()
      .mockResolvedValueOnce(res(200, { id: 'https://openalex.org/T10537', display_name: 'ADHD', subfield: { id: 'https://openalex.org/subfields/2738', display_name: 'Psychiatry and Mental health' }, field: field27, domain: domain4 }))
      .mockResolvedValueOnce(res(200, { meta: { count: 16 }, results: topicPage(1, 16).results }))
    const t = await createOpenAlexClient({ fetch: asFetch(g), log: jest.fn() }).fetchNodeBundle('topic', 'T10537')
    expect(g).toHaveBeenCalledTimes(2)
    expect(t?.siblings).toHaveLength(16)
  })
})
