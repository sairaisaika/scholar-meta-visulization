import { createOpenAlexClient } from '../src/openalex'

const page = (key: string | boolean | number, next: unknown = null) => ({ meta: { count: 9, next_cursor: next }, group_by: [{ key, count: 2 }] })
const response = (j: unknown, status = 200) => ({ ok: status === 200, status, headers: new Headers({ 'x-ratelimit-credits-used': '1' }), json: async () => j })
const client = (f: jest.Mock) => createOpenAlexClient({ fetch: f as unknown as typeof fetch, log: jest.fn() })

describe('OpenAlex grouped completeness', () => {
  it.each([-111, '-111.0'])('normalizes the documented numeric unknown sentinel %s', async key => {
    const f = jest.fn().mockResolvedValue(response(page(key)))
    expect((await client(f).groupByWorks('x', 'publication_year'))?.groups[0].key).toBe('unknown')
  })
  it('follows encoded cursor, sums actual credits, normalizes boolean/numeric keys', async () => {
    const f = jest.fn().mockResolvedValueOnce(response(page(true, 'a+/='))).mockResolvedValueOnce(response(page(2024)))
    const r = await client(f).groupByWorks('x', 'type')
    expect(r?.groups.map(g => g.key)).toEqual(['true', '2024'])
    expect(r?.credits).toBe(2)
    expect(f.mock.calls[1][0]).toContain('&cursor=a%2B%2F%3D')
  })
  it.each(['failed', 'repeat', 'duplicate', 'drift'])('refuses incomplete %s pages', async kind => {
    const f = jest.fn().mockResolvedValueOnce(response(page('a', 'next')))
    f.mockResolvedValueOnce(kind === 'failed' ? response({}, 503) : response(kind === 'drift'
      ? { ...page('b'), meta: { count: 10, next_cursor: null } }
      : page(kind === 'duplicate' ? 'a' : 'b', kind === 'repeat' ? 'next' : null)))
    expect(await client(f).groupByWorks('x', 'type')).toBeNull()
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('a full page without a completion cursor is not declared complete', async () => {
    const f = jest.fn().mockResolvedValue(response({ meta: { count: 300 }, group_by: Array.from({ length: 200 }, (_, i) => ({ key: String(i), count: 1 })) }))
    expect(await client(f).groupByWorks('x', 'type')).toBeNull()
  })
  it('caps pagination at 20 requests', async () => {
    let i = 0
    const f = jest.fn(async () => response(page(String(i++), `cursor${i}`)))
    expect(await client(f).groupByWorks('x', 'type')).toBeNull()
    expect(f).toHaveBeenCalledTimes(20)
  })
})
