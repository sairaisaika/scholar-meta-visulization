/**
 * 作品引用识别：DOI（裸 / 前缀 / doi.org 链接 / 嵌在出版社链接里）、OpenAlex（编号 / 链接）、PubMed（编号 / 链接）、
 * 认不出编号的链接、标题；作品键与 `normalizeWorkId` 同一套写法，可反解。
 */
import { parseWorkRef, workKeyOf, workRefOfKey } from '../src/workref'
import { normalizeWorkId } from '../src/tagging'

describe('parseWorkRef', () => {
  it.each([
    ['10.1136/bmj.l4898', 'doi', '10.1136/bmj.l4898'],
    ['DOI: 10.1136/BMJ.L4898', 'doi', '10.1136/bmj.l4898'],
    ['https://doi.org/10.1136/bmj.l4898', 'doi', '10.1136/bmj.l4898'],
    ['http://dx.doi.org/10.1136/bmj.l4898', 'doi', '10.1136/bmj.l4898'],
    ['https://www.example-publisher.org/doi/10.1000/ABC-123?utm=x', 'doi', '10.1000/abc-123'],
    ['https://journals.example.org/article?doi=10.1000%2Fxyz.1', 'doi', '10.1000/xyz.1'],
    ['W2741809807', 'openalex', 'W2741809807'],
    ['https://openalex.org/W2741809807', 'openalex', 'W2741809807'],
    ['https://api.openalex.org/works/w2741809807', 'openalex', 'W2741809807'],
    ['openalex:W123', 'openalex', 'W123'],
    ['31462531', 'pmid', '31462531'],
    ['pmid:31462531', 'pmid', '31462531'],
    ['https://pubmed.ncbi.nlm.nih.gov/31462531/', 'pmid', '31462531'],
    ['https://www.ncbi.nlm.nih.gov/pubmed/31462531', 'pmid', '31462531'],
    ['https://example.org/some/article-page', 'url', 'https://example.org/some/article-page'],
    ['Cognitive behavioural  therapy for insomnia: a meta-analysis', 'title', 'Cognitive behavioural therapy for insomnia: a meta-analysis'],
    ['失眠的认知行为治疗', 'title', '失眠的认知行为治疗'],
  ])('%j → %s %s', (raw, kind, value) => expect(parseWorkRef(raw)).toEqual({ kind, value }))

  it('空、太短、非字符串、超长、非 http 链接 ⇒ null 或标题', () => {
    expect(parseWorkRef('')).toBeNull()
    expect(parseWorkRef('   ')).toBeNull()
    expect(parseWorkRef('ab')).toBeNull()
    expect(parseWorkRef(42)).toBeNull()
    expect(parseWorkRef('x'.repeat(2049))).toBeNull()
    expect(parseWorkRef('javascript:alert(1)')).toEqual({ kind: 'title', value: 'javascript:alert(1)' })
  })
  it('标题截到 500 字符', () => {
    expect(parseWorkRef('t'.repeat(600))!.value).toHaveLength(500)
  })
})

describe('workKeyOf / workRefOfKey', () => {
  it('三种编号给出作品键，与 normalizeWorkId 一致；链接与标题没有键', () => {
    expect(workKeyOf(parseWorkRef('https://doi.org/10.1136/BMJ.l4898'))).toBe(normalizeWorkId('https://doi.org/10.1136/BMJ.l4898'))
    expect(workKeyOf(parseWorkRef('https://openalex.org/W2741809807'))).toBe(normalizeWorkId('https://openalex.org/W2741809807'))
    expect(workKeyOf(parseWorkRef('PMID: 31462531'))).toBe('pmid:31462531')
    expect(workKeyOf(parseWorkRef('https://example.org/x'))).toBeNull()
    expect(workKeyOf(parseWorkRef('Some title here'))).toBeNull()
    expect(workKeyOf(null)).toBeNull()
  })
  it('作品键可以反解；不是三种之一 ⇒ null', () => {
    expect(workRefOfKey('doi:10.1136/bmj.l4898')).toEqual({ kind: 'doi', value: '10.1136/bmj.l4898' })
    expect(workRefOfKey('openalex:W12345')).toEqual({ kind: 'openalex', value: 'W12345' })
    expect(workRefOfKey('pmid:42')).toEqual({ kind: 'pmid', value: '42' })
    expect(workRefOfKey('onsite:42')).toBeNull()
    expect(workRefOfKey('doi:not-a-doi')).toBeNull()
    expect(workRefOfKey(7)).toBeNull()
  })
})
