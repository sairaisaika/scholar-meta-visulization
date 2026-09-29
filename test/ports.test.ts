/**
 * 内存端口：LRU + TTL 缓存（取出的是副本，调用方改了不污染缓存）、绑定表、按标签键过滤的文章源。
 */
import { createMemoryCache, createMemoryBindingStore, createMemoryOnsiteSource } from '../src/ports'
import { createCuratedBinding } from '../src/tags'

describe('内存缓存', () => {
  it('TTL 过期、LRU 淘汰、取出的是副本', async () => {
    let t = 0
    const c = createMemoryCache({ maxEntries: 2, now: () => t })
    await c.set('a', { v: 1 }, 10)
    await c.set('b', { v: 2 }, 10)
    expect(await c.get('a')).toEqual({ v: 1 }) // a 变成最近用过
    await c.set('c', { v: 3 }, 10)            // 淘汰最久没用的 b
    expect(await c.get('b')).toBeUndefined()
    const got = (await c.get('a')) as { v: number }
    got.v = 99
    expect(await c.get('a')).toEqual({ v: 1 })
    t = 10_001
    expect(await c.get('a')).toBeUndefined()
    expect(c.size()).toBe(1)
  })
})

describe('内存绑定表与文章源', () => {
  it('按主题列绑定；按归一后的标签键过滤；不公开的不给', async () => {
    const at = '2026-09-29T00:00:00Z'
    const s = createMemoryBindingStore([createCuratedBinding({ tag: 'A', topic: { id: 'openalex:T1', display_name: 'x' }, by: null, at })!])
    await s.put(createCuratedBinding({ tag: 'b', topic: { id: 'openalex:T1', display_name: 'x' }, by: null, at })!)
    expect((await s.listByTopic('openalex:T1')).map((b) => b.tag_key)).toEqual(['a', 'b'])
    expect([...(await s.getMany!(['a', 'zzz'])).keys()]).toEqual(['a'])
    const src = createMemoryOnsiteSource(async () => [
      { id: 1, title: 'x', tags: ['ＡＤＨＤ'] }, { id: 2, title: 'y', tags: ['sleep'] }, { id: 3, title: 'z', tags: ['adhd'], is_public: false },
    ])
    expect((await src.listArticles({ tagKeys: ['adhd'] })).map((a) => (a as { id: number }).id)).toEqual([1])
    expect(await src.listArticles({})).toHaveLength(2)
  })
})
