/**
 * OpenAlex 真实 API 冒烟测试——**缺省跳过**，`OPENALEX_LIVE=1 pnpm jest test/openalex.live.test.ts` 才跑（要能出网）。
 * 用来核对只按文档实现、用模拟响应测过的形状：子领域 / 领域 / 大类实体、按 DOI 的 OR 过滤、两维 group_by 的交叉表；
 * 0.4.0 起还有往里一层的列表、作品的发表来源 / 开放获取地址 / 主题 / 引用。
 * 花费约 25 credits（一次全量计数约 17；其余大多 0 或 1）。有 OPENALEX_API_KEY 就带上（只进请求头）。
 * GitHub 上由 `.github/workflows/live.yml` 跑（手动触发，或改了适配器时）。
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
  it.each([
    ['domain', '4', 'field'],
    ['field', '27', 'subfield'],
    ['subfield', '2738', 'topic'],
  ] as const)('往里一层：%s %s 的下一级是 %s，按篇数从多到少，parent_id 指回本节点', async (level, id, child) => {
    const r = await client.fetchNodeChildren(level, id)
    expect(r).not.toBeNull()
    expect(r!.partial).toBeUndefined()
    expect(r!.children.length).toBeGreaterThan(1)
    expect(r!.children.every((c) => c.level === child && c.parent_id === `openalex:${id}`)).toBe(true)
    const counts = r!.children.map((c) => c.works_count ?? -1)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
  })
  it('作品细节：发表来源、开放获取地址只放 http(s)、自己挂的主题、引用只连同一批里的', async () => {
    const r = await client.fetchWorksForNode('subfield', '2738', 25)
    expect(r?.length).toBeGreaterThan(10)
    const recs = r!
    const ids = new Set(recs.map((x) => x.id))
    expect(recs.filter((x) => x.venue).length).toBeGreaterThan(recs.length / 2)
    expect(recs.every((x) => !x.venue || (/^openalex:S\d+$/.test(x.venue.id) && x.venue.name.length > 0))).toBe(true)
    expect(recs.some((x) => x.venue?.type === 'journal')).toBe(true)
    expect(recs.every((x) => x.oa_url === null || x.oa_url === undefined || /^https?:\/\//.test(x.oa_url))).toBe(true)
    expect(recs.some((x) => typeof x.oa_url === 'string')).toBe(true)
    expect(recs.every((x) => (x.topics?.length ?? 0) > 0 && x.topics!.every((t) => /^openalex:T\d+$/.test(t.id)))).toBe(true)
    // 被引最多的 25 篇里至少有一篇引用了另一篇（量表类经典互相引用）——这说明 referenced_works 真的取回来了
    expect(recs.some((x) => (x.cites?.length ?? 0) > 0)).toBe(true)
    expect(recs.every((x) => (x.cites ?? []).every((c) => ids.has(c) && c !== x.id))).toBe(true)
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
