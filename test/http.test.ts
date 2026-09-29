/**
 * 读口与客户端（端到端：客户端的 fetch 直接接到 handler 上，不起服务器）：
 *   ① 四个读口的状态码与响应头：成功可缓存，失败 no-store；503 带 Retry-After；
 *   ② 参数验形：越界 / 形状不对 ⇒ 400，且不回显输入；非 GET/HEAD ⇒ 405；未知路由 ⇒ 404；
 *   ③ 客户端：类型化结果；非 2xx / 形状不对 / 网络错 ⇒ null（绝不当成空数据）。
 */
import { createEvidenceHandler, EVIDENCE_ROUTES } from '../src/http'
import { createEvidenceClient, EVIDENCE_CLIENT_ROUTES } from '../src/client'
import { createEvidenceService, createMemoryBindingStore, createMemoryOnsiteSource } from '../src/service'
import type { EvidenceService, ExternalEvidenceSource } from '../src/service'

const articles = [
  { id: 1, title: 'A', tags: ['ADHD', 'sleep'], year: 2024 },
  { id: 2, title: 'B', tags: ['adhd', 'Sleep'], year: 2023 },
]
const external: ExternalEvidenceSource = {
  id: 'openalex',
  suggestTopics: async () => [{ topic_id: 'openalex:T10537', display_name: 'ADHD', works_count: 1 }],
  nodeBundle: async (level, id) => ({
    node: { id: `openalex:${id}`, source: 'openalex', external_id: id, level, display_name: 'ADHD', description: null, parent_id: null, works_count: 1 },
    ancestors: [], siblings: [],
  }),
  sampleWorks: async () => [],
}
const service = createEvidenceService({ onsite: createMemoryOnsiteSource(articles), external, bindings: createMemoryBindingStore(), log: () => {} })
const handler = createEvidenceHandler(service, { basePath: '/api/evidence', log: () => {} })
const call = (path: string, init?: RequestInit) => handler(new Request(`https://site.example${path}`, init))

describe('读口', () => {
  it('① 标签图谱：200 + JSON + 可缓存', async () => {
    const res = await call('/api/evidence/map?tag=ADHD')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, stale-while-revalidate=86400')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const body = await res.json()
    expect(body.focus.display_name).toBe('ADHD')
    expect(body.external_match).toBe('matched')
  })
  it('① 节点图谱、站内层、共现图', async () => {
    expect((await call('/api/evidence/map?level=topic&id=T10537')).status).toBe(200)
    const tc = await (await call('/api/evidence/tags/counts?tag=adhd')).json()
    expect(tc.total).toBe(2)
    const g = await (await call('/api/evidence/tags/graph?min_support=2')).json()
    expect(g.edges).toEqual([expect.objectContaining({ a: 'adhd', b: 'sleep', count: 2 })])
  })
  it('① 没配计数源 ⇒ 501；服务不可用 ⇒ 503 + Retry-After + no-store', async () => {
    const res = await call('/api/evidence/counts?level=topic&id=T10537')
    expect([res.status, await res.json()]).toEqual([501, { error: 'not_configured' }])
    const down: EvidenceService = { ...service, getTagMap: async () => ({ ok: false, error: 'unavailable' }) }
    const r = await createEvidenceHandler(down)(new Request('https://x/api/evidence/map?tag=a'))
    expect(r.status).toBe(503)
    expect(r.headers.get('retry-after')).toBe('60')
    expect(r.headers.get('cache-control')).toBe('no-store')
  })
  it.each([
    '/api/evidence/map', '/api/evidence/map?tag=', `/api/evidence/map?tag=${'x'.repeat(201)}`, '/api/evidence/map?level=topic&id=T1;drop',
    '/api/evidence/map?level=galaxy&id=1', '/api/evidence/counts?level=topic&id=T1&scope=everything', '/api/evidence/tags/graph?min_support=0',
    '/api/evidence/tags/graph?max_nodes=9999', '/api/evidence/tags/graph?min_support=abc', '/api/evidence/tags/counts',
  ])('② %s ⇒ 400，不回显输入', async (path) => {
    const res = await call(path)
    expect(res.status).toBe(400)
    expect(await res.text()).toBe('{"error":"invalid_input"}')
  })
  it('② 方法与路由', async () => {
    const post = await call('/api/evidence/map?tag=a', { method: 'POST', body: 'x' })
    expect([post.status, post.headers.get('allow')]).toEqual([405, 'GET, HEAD'])
    expect((await call('/api/evidence/nope')).status).toBe(404)
    expect((await call('/elsewhere/map?tag=a')).status).toBe(404)
    const head = await call('/api/evidence/map?tag=ADHD', { method: 'HEAD' })
    expect([head.status, await head.text()]).toEqual([200, ''])
  })
  it('服务抛错 ⇒ 500，不带细节', async () => {
    const boom: EvidenceService = { ...service, getTagGraph: async () => { throw new Error('secret detail') } }
    const log = jest.fn()
    const r = await createEvidenceHandler(boom, { log })(new Request('https://x/api/evidence/tags/graph'))
    expect([r.status, await r.text()]).toEqual([500, '{"error":"internal"}'])
    expect(log).toHaveBeenCalledWith('[evidence.http] handler failed', { route: '/tags/graph', error: 'secret detail' })
  })
})

describe('客户端', () => {
  const viaHandler = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(new Request(typeof input === 'string' ? `https://site.example${input}` : input, init))) as typeof fetch
  const client = createEvidenceClient({ baseUrl: '/api/evidence', fetch: viaHandler })

  it('③ 与服务端同一份路由', () => {
    expect(EVIDENCE_CLIENT_ROUTES).toEqual(EVIDENCE_ROUTES)
  })
  it('③ 端到端：类型化结果', async () => {
    const map = await client.getTagMap('ADHD')
    expect(map?.focus?.external_id).toBe('adhd')
    expect((await client.getNodeMap('topic', 'T10537'))?.level).toBe('topic')
    expect((await client.getTagCounts('sleep'))?.total).toBe(2)
    expect((await client.getTagGraph({ minSupport: 1, focus: 'adhd' }))?.focus).toBe('adhd')
  })
  it('③ 失败一律 null：非 2xx、形状不对、网络错', async () => {
    expect(await client.getCounts('topic', 'T10537')).toBeNull() // 501
    const html = createEvidenceClient({ fetch: (async () => new Response('<html>', { status: 200 })) as typeof fetch })
    expect(await html.getTagMap('a')).toBeNull()
    const wrong = createEvidenceClient({ fetch: (async () => new Response(JSON.stringify({ level: 'tag' }), { status: 200 })) as typeof fetch })
    expect(await wrong.getTagMap('a')).toBeNull()
    const offline = createEvidenceClient({ fetch: (async () => { throw new TypeError('offline') }) as typeof fetch })
    expect(await offline.getTagGraph()).toBeNull()
  })
  it('查询串编码；空参数不带', async () => {
    const seen: string[] = []
    const spy = createEvidenceClient({ baseUrl: '/x/', fetch: (async (u: string) => { seen.push(u); return new Response('{}', { status: 404 }) }) as unknown as typeof fetch })
    await spy.getTagMap('焦虑 & 睡眠')
    await spy.getTagGraph({ focus: null, minSupport: 3 })
    expect(seen).toEqual([`/x/map?tag=${encodeURIComponent('焦虑 & 睡眠')}`, '/x/tags/graph?min_support=3'])
  })
})
