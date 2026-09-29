/**
 * DOI 小件：站内与外部同一套归一；放不进 OR 过滤的 DOI 识别出来；
 * 抽样确定性且与出版社前缀无关（按字典序截断会只留下前缀小的几家）。
 */
import { normalizeDoi, isFilterSafeDoi, fnv1a, sampleDois } from '../src/doi'

describe('DOI', () => {
  it('归一与过滤安全', () => {
    expect(normalizeDoi('https://dx.doi.org/10.1000/ABC')).toBe('10.1000/abc')
    expect(normalizeDoi('10.1/x')).toBeNull()
    expect(isFilterSafeDoi('10.1000/a,b')).toBe(false)
    expect(isFilterSafeDoi('10.1000/a|b')).toBe(false)
    expect(isFilterSafeDoi('10.1000/(ab)-c;d')).toBe(true)
  })
  it('FNV-1a 已知值', () => {
    expect(fnv1a('')).toBe(0x811c9dc5)
    expect(fnv1a('a')).toBe(0xe40c292c)
    expect(fnv1a('foobar')).toBe(0xbf9cf968)
  })
  it('抽样：不超过上限、确定性、跨出版社', () => {
    const prefixes = ['10.1001', '10.1016', '10.1037', '10.1093', '10.1371']
    const dois = prefixes.flatMap((p) => Array.from({ length: 120 }, (_, i) => `${p}/x${i}`))
    const a = sampleDois(dois, 200)
    const b = sampleDois([...dois].reverse(), 200)
    expect(a).toHaveLength(200)
    expect(a).toEqual(b)
    const perPrefix = prefixes.map((p) => a.filter((d) => d.startsWith(p)).length)
    for (const n of perPrefix) expect(n).toBeGreaterThan(25) // 期望各 40；按字典序截断会是 [120, 80, 0, 0, 0]
    expect(sampleDois(['10.1000/b', '10.1000/a', '10.1000/a'], 10)).toEqual(['10.1000/a', '10.1000/b'])
  })
})
