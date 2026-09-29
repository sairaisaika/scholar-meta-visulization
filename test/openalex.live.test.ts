/**
 * OpenAlex 真实 API 冒烟测试——**缺省跳过**，`OPENALEX_LIVE=1 pnpm jest test/openalex.live.test.ts` 才跑（要能出网）。
 * 用来核对只按文档实现、用模拟响应测过的形状：子领域 / 领域 / 大类实体、按 DOI 的 OR 过滤、两维 group_by 的交叉表。
 * 花费约 20 credits（一次全量计数约 17；其余大多 0）。有 OPENALEX_API_KEY 就带上（只进请求头）。
 */
import { createOpenAlexClient, fetchEvidenceCounts } from '../src/openalex'

const live = process.env.OPENALEX_LIVE === '1'
const suite = live ? describe : describe.skip

suite('OpenAlex 真实 API（OPENALEX_LIVE=1 才跑）', () => {
  jest.setTimeout(120_000)
  const client = createOpenAlexClient({ apiKey: () => process.env.OPENALEX_API_KEY, log: (m, d) => console.warn(m, d) })

  it('自动补全：adhd 有候选', async () => {
    const r = await client.suggestTopicsForTag('adhd', 3)
    expect(r).not.toBeNull()
    expect(r!.length).toBeGreaterThan(0)
    expect(r![0].external_id).toMatch(/^T\d+$/)
  })
  it('主题 T10537：上级链是 子领域 → 领域 → 大类', async () => {
    const b = await client.fetchNodeBundle('topic', 'T10537')
    expect(b?.ancestors.map((a) => a.level)).toEqual(['subfield', 'field', 'domain'])
    expect(b?.siblings.length).toBeGreaterThan(0)
  })
  it.each([
    ['subfield', '2738', ['field', 'domain']],
    ['field', '27', ['domain']],
    ['domain', '4', []],
  ] as const)('%s %s：实体形状与上级链', async (level, id, chain) => {
    const b = await client.fetchNodeBundle(level, id)
    expect(b).not.toBeNull()
    expect(b!.node.level).toBe(level)
    expect(b!.ancestors.map((a) => a.level)).toEqual([...chain])
    expect(b!.siblings.length).toBeGreaterThan(0)
  })
  it('按节点取示例（子领域）', async () => {
    const r = await client.fetchWorksForNode('subfield', '2738', 5)
    expect(r?.length).toBeGreaterThan(0)
  })
  it('按 DOI 的 OR 过滤：两篇已知文献都能对回主主题', async () => {
    const r = await client.fetchPrimaryTopicsForDois(['10.1136/bmj.n71', '10.1371/journal.pone.0010068'])
    expect(r).not.toBeNull()
    expect(r!.map((x) => x.doi).sort()).toEqual(['10.1136/bmj.n71', '10.1371/journal.pone.0010068'])
    expect(r!.every((x) => x.topic !== null)).toBe(true)
  })
  it('全量计数装配：各维度到齐，缺口图有交叉表，UpSet 有两两交集', async () => {
    const c = await fetchEvidenceCounts(client, 'topic', 'T10537', 'primary_topic', { display_name: 'ADHD' })
    expect(c).not.toBeNull()
    expect(c!.total).toBeGreaterThan(1000)
    expect(c!.series.map((s) => s.dimension).sort()).toEqual(
      ['country', 'global_south', 'institution_type', 'language', 'oa_status', 'publication_type', 'publication_year', 'retracted', 'subfield'])
    const inst = c!.series.find((s) => s.dimension === 'institution_type')!
    expect(inst.cross?.length).toBe(inst.cells.length)
    expect(c!.overlap?.pairs.length).toBeGreaterThan(0)
    const south = c!.series.find((s) => s.dimension === 'global_south')!
    expect(south.cells.map((x) => x.key)).toEqual(['true', 'false'])
  })
})
