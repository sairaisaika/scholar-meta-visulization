import { createEvidenceClient, createEvidenceResultClient } from '../src/client'
import type { EvidenceClientResult } from '../src/client'
import { createEvidenceHandler } from '../src/http'
import { createEvidenceService, createMemoryOnsiteSource } from '../src/service'

const methods = ['getTagMap', 'getNodeMap', 'getCounts', 'getTagCounts', 'getTagGraph'] as const
const args = ['sleep', 'topic', 'T1'] as const
const fetchResponse = (status: number, body: unknown, headers?: HeadersInit) =>
  (async () => new Response(JSON.stringify(body), { status, headers })) as typeof globalThis.fetch

// 使用真实内存服务/handler 产生受 guard 接受的数据，不复制庞大响应 fixture。
const service = createEvidenceService({ now: () => new Date('2026-10-17T00:00:00Z'), onsite: createMemoryOnsiteSource([{ id: '1', title: 'Sleep study', tags: ['sleep'], year: 2024 }]) })
const handler = createEvidenceHandler(service)
const viaHandler = (async (url: string) => handler(new Request(`https://host.test${url}`))) as unknown as typeof globalThis.fetch

async function callAll(fetch: typeof globalThis.fetch): Promise<EvidenceClientResult<unknown>[]> {
  const api = createEvidenceResultClient({ fetch })
  return Promise.all([api.getTagMap(args[0]), api.getNodeMap(args[1], args[2]), api.getCounts(args[1], args[2]), api.getTagCounts(args[0]), api.getTagGraph()])
}

describe('结果式客户端', () => {
  it('五方法保持真实 handler 成功与缺配置语义；旧客户端仍只有 data/null', async () => {
    const api = createEvidenceResultClient({ fetch: viaHandler })
    expect(methods.every((method) => typeof api[method] === 'function')).toBe(true)
    const invalid = await callAll(fetchResponse(200, {}))
    expect(invalid.every((r) => !r.ok && r.error === 'invalid_response' && r.status === 200)).toBe(true)
    const results = await callAll(viaHandler)
    expect(results.map((r) => r.ok)).toEqual([true, false, false, true, true])
    expect(results[1]).toEqual({ ok: false, error: 'not_configured', status: 501, retryAfterSeconds: null })
    for (const result of [results[0], results[3], results[4]]) expect(result).toMatchObject({ ok: true, status: 200 })
    const old = createEvidenceClient({ fetch: viaHandler })
    const rich = await api.getTagCounts('sleep')
    expect(rich.ok && await old.getTagCounts('sleep')).toEqual(rich.ok ? rich.data : false)
    expect(await old.getCounts('topic', 'T1')).toBeNull()
  })

  it.each([[400, 'invalid_input'], [404, 'not_found'], [405, 'method_not_allowed'], [500, 'internal'], [501, 'not_configured'], [503, 'unavailable']] as const)(
    '只保留与 HTTP %i 对应的已知代码 %s', async (status, error) => {
      const results = await callAll(fetchResponse(status, { error }))
      expect(results.every((r) => !r.ok && r.error === error && r.status === status)).toBe(true)
    },
  )

  it('旧工厂遇到非成功状态不读取正文，避免诊断改造拖慢原失败路径', async () => {
    const json = jest.fn(async () => { throw new Error('body must not be read by legacy client') })
    const fetch = (async () => ({ ok: false, status: 503, headers: new Headers(), json })) as unknown as typeof globalThis.fetch
    expect(await createEvidenceClient({ fetch }).getTagGraph()).toBeNull()
    expect(json).not.toHaveBeenCalled()
    expect(await createEvidenceResultClient({ fetch }).getTagGraph()).toMatchObject({ ok: false, error: 'http_error', status: 503 })
    expect(json).toHaveBeenCalledTimes(1)
  })

  it('未知/不匹配的错误和 HTML 响应保留状态但不反射服务器内容', async () => {
    for (const [status, body] of [[502, { error: 'secret_stack' }], [503, { error: 'not_found' }], [401, { error: 'internal' }]] as const) {
      const result = await createEvidenceResultClient({ fetch: fetchResponse(status, body) }).getTagGraph()
      expect(result).toEqual({ ok: false, error: 'http_error', status, retryAfterSeconds: null })
      expect(JSON.stringify(result)).not.toContain('secret_stack')
    }
    const fetch = (async () => new Response('<html>upstream</html>', { status: 502 })) as typeof globalThis.fetch
    expect(await createEvidenceResultClient({ fetch }).getTagGraph()).toEqual({ ok: false, error: 'http_error', status: 502, retryAfterSeconds: null })
  })

  it('网络失败、成功状态的坏 JSON 与 guard 失败分别报告，不自动重试', async () => {
    const fetch = jest.fn(async () => { throw new TypeError('private details') }) as unknown as jest.MockedFunction<typeof globalThis.fetch>
    const result = await createEvidenceResultClient({ fetch }).getTagGraph()
    expect(result).toEqual({ ok: false, error: 'network', status: null, retryAfterSeconds: null })
    expect(fetch).toHaveBeenCalledTimes(1)
    for (const body of ['<html>', '{}', 'null']) {
      const badFetch = (async () => new Response(body, { status: 200 })) as typeof globalThis.fetch
      expect(await createEvidenceResultClient({ fetch: badFetch }).getTagGraph()).toEqual({ ok: false, error: 'invalid_response', status: 200, retryAfterSeconds: null })
      expect(await createEvidenceClient({ fetch: badFetch }).getTagGraph()).toBeNull()
    }
  })

  it.each(['0', '60', ' 120 '])('保留 Retry-After 秒数 %s', async (value) => {
    expect(await createEvidenceResultClient({ fetch: fetchResponse(503, { error: 'unavailable' }, { 'retry-after': value }) }).getTagGraph())
      .toMatchObject({ error: 'unavailable', retryAfterSeconds: Number(value) })
  })

  it('HTTP 日期相对接收时钟；过期为零，非法/负数/小数/溢出不补猜', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 17, 0, 0, 0))
    try {
      for (const [value, expected] of [['Sat, 17 Oct 2026 00:01:00 GMT', 60], ['Fri, 16 Oct 2026 23:59:00 GMT', 0], ['-1', null], ['1.5', null], ['garbage', null], ['99999999999999999999999999', null]] as const) {
        const result = await createEvidenceResultClient({ fetch: fetchResponse(503, { error: 'unavailable' }, { 'retry-after': value }) }).getTagGraph()
        expect(result).toMatchObject({ retryAfterSeconds: expected })
      }
    } finally { clock.mockRestore() }
  })

  it('真实不可用服务通过 503/error/60 秒传到 SDK，旧调用仍为 null', async () => {
    const broken = createEvidenceHandler(createEvidenceService({ onsite: { listArticles: async () => { throw new Error('not public') } }, log: () => {} }))
    const fetch = (async (url: string) => broken(new Request(`https://host.test${url}`))) as unknown as typeof globalThis.fetch
    expect(await createEvidenceResultClient({ fetch }).getTagCounts('sleep')).toEqual({ ok: false, error: 'unavailable', status: 503, retryAfterSeconds: 60 })
    expect(await createEvidenceClient({ fetch }).getTagCounts('sleep')).toBeNull()
  })

  it('同一路由编码一次；非法 Unicode 返回 invalid_input，不发请求', async () => {
    const seen: Array<[string, RequestInit | undefined]> = []
    const fetch = (async (url: string, init?: RequestInit) => { seen.push([url, init]); return new Response('{}', { status: 404 }) }) as unknown as typeof globalThis.fetch
    const api = createEvidenceResultClient({ baseUrl: '/x/', fetch, headers: { 'x-host': 'yes' } })
    await api.getTagMap('睡眠 & 焦虑')
    await api.getTagGraph({ focus: null, minSupport: 3 })
    expect(seen.map(([url]) => url)).toEqual([`/x/map?tag=${encodeURIComponent('睡眠 & 焦虑')}`, '/x/tags/graph?min_support=3'])
    expect(seen[0]![1]?.headers).toEqual({ accept: 'application/json', 'x-host': 'yes' })
    expect(await api.getTagMap('\ud800')).toEqual({ ok: false, error: 'invalid_input', status: null, retryAfterSeconds: null })
    expect(seen).toHaveLength(2)
  })
})
