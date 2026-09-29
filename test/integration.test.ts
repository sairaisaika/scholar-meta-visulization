/**
 * docs/integration.md 的接法原样跑一遍（去掉 React）：宿主的「数据库」与「KV」是桩，
 * 其余全是真的——服务、外部源端口（假的 OpenAlex fetch）、读口、客户端、视图模型、编辑绑定、作者反馈。
 * 公开 API 与文档一旦走样，这里先红。
 */
import { createEvidenceService } from '../src/service'
import { createOpenAlexSource } from '../src/openalex'
import { createEvidenceHandler } from '../src/http'
import { createEvidenceClient } from '../src/client'
import { normalizeTag, presentEvidenceMap, presentTagGraph, presentBindingSuggestions, presentIntakeIssues, presentOnsiteCounts } from '../src/index'
import type { EvidenceTagBinding } from '../src/types'

// ── 宿主的桩 ──
const articles = [
  { id: 'a1', title: 'Sleep and ADHD in adolescents', tags: ['ADHD', 'Sleep'], year: 2024, study_design: 'cohort', claim: 'significant',
    effect: { metric: 'or', value: 1.8, ci_low: 1.2, ci_high: 2.7, n: 420, higher_is_better: false }, references: ['10.1000/r1', '10.1000/r2'] },
  { id: 'a2', title: 'Mindfulness for adult ADHD', tags: ['adhd', 'mindfulness'], year: 2025, study_design: 'rct', claim: 'non_significant' },
  { id: 'a3', title: 'Draft', tags: ['ADHD'], is_public: false },
]
const db = {
  publicArticles: async ({ tagKeys }: { tagKeys?: readonly string[] }) => articles.filter((a) => a.is_public !== false
    && (!tagKeys || a.tags.some((t) => tagKeys.includes(normalizeTag(t)!)))),
  bindings: new Map<string, EvidenceTagBinding>(),
}
const kvStore = new Map<string, unknown>()
const kv = { get: async (k: string) => kvStore.get(k), set: async (k: string, v: unknown) => { kvStore.set(k, v) }, del: async (k: string) => { kvStore.delete(k) } }

// ── 假的 OpenAlex（按路径回形状，与真实 API 同形）──
const openalexFetch = (async (url: string) => {
  const u = new URL(url)
  const ok = (body: unknown, credits = 0) => ({ ok: true, status: 200, headers: new Headers({ 'x-ratelimit-credits-used': String(credits) }), json: async () => body })
  if (u.pathname === '/autocomplete/topics') return ok({ results: [{ id: 'https://openalex.org/T10537', display_name: 'Attention Deficit Hyperactivity Disorder', works_count: 110442 }] })
  if (u.pathname === '/topics/T10537') return ok({
    id: 'https://openalex.org/T10537', display_name: 'Attention Deficit Hyperactivity Disorder', works_count: 110442,
    subfield: { id: 'https://openalex.org/subfields/2738', display_name: 'Psychiatry and Mental health' },
    field: { id: 'https://openalex.org/fields/27', display_name: 'Medicine' }, domain: { id: 'https://openalex.org/domains/4', display_name: 'Health Sciences' },
    siblings: [],
  })
  if (u.pathname === '/works' && (u.searchParams.get('filter') ?? '').startsWith('doi:')) {
    return ok({ results: [{ id: 'https://openalex.org/W9', doi: 'https://doi.org/10.1000/r1', primary_topic: { id: 'https://openalex.org/T10537', display_name: 'Attention Deficit Hyperactivity Disorder' } }] }, 1)
  }
  if (u.pathname === '/works') return ok({ results: [{ id: 'https://openalex.org/W1', title: 'A cited review', publication_year: 2019, type: 'review', cited_by_count: 900 }] }, 1)
  return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) }
}) as unknown as typeof fetch

// ── docs/integration.md 第 2、3 节 ──
const evidence = createEvidenceService({
  onsite: { listArticles: ({ tagKeys }) => db.publicArticles({ tagKeys }) },
  bindings: {
    get: async (tagKey) => db.bindings.get(tagKey) ?? null,
    listByTopic: async (topicId) => [...db.bindings.values()].filter((b) => b.topic_id === topicId),
    put: async (b) => { db.bindings.set(b.tag_key, b) },
  },
  cache: { get: (key) => kv.get(key), set: (key, value) => kv.set(key, value), delete: (key) => kv.del(key) },
  external: createOpenAlexSource({ apiKey: () => 'test-key', dailyCreditBudget: 5000, fetch: openalexFetch }),
  onsiteLabel: 'Example Journal',
  onsiteLicense: 'CC BY 4.0',
  machineBinding: 'first_hit',
  log: () => {},
})
const GET = createEvidenceHandler(evidence, { basePath: '/api/evidence' })
const client = createEvidenceClient({ fetch: (async (u: string) => GET(new Request(`https://example.org${u}`))) as unknown as typeof fetch })

describe('按接入指南接起来', () => {
  it('读者：标签页（服务端组件直调）', async () => {
    const r = await evidence.getTagMap('ADHD')
    if (!r.ok) throw new Error(r.error)
    const v = presentEvidenceMap(r.data, { locale: 'zh' })
    expect(v.title).toBe('ADHD')
    expect(v.binding?.badge).toBe('machine_first_hit')
    expect(v.view.kind).toBe('forest') // 一篇申报了 OR + 95% 区间 ⇒ 森林级（1 项也可以画，只是不画汇总菱形）
    expect(v.view.usable_text).toBe('1 / 3 条记录满足这一级的要求')
    expect(v.view.pooling_text).toBe('满足条件的研究不到 5 项，不画汇总菱形。')
    expect(v.counts_text[0]).toBe('站内文章 2 篇')
    expect(v.footnotes).toHaveLength(2)
    expect(r.data.records.some((x) => x.title === 'Draft')).toBe(false)
  })
  it('读者：客户端组件经读口', async () => {
    const graph = await client.getTagGraph({ focus: 'ADHD', minSupport: 1 })
    const gv = presentTagGraph(graph!, { locale: 'en' })
    expect(gv.nodes.map((n) => n.key).sort()).toEqual(['adhd', 'mindfulness', 'sleep'])
    const layer = await client.getTagCounts('adhd')
    const lv = presentOnsiteCounts(layer!, { locale: 'en' })
    expect(lv.charts.tag.find((c) => c.kind === 'forest')!.available).toBe(true) // 站内申报了效应量与区间
    expect(lv.series.find((s) => s.dimension === 'study_type')!.rows.map((x) => x.label).sort()).toEqual(['Cohort study', 'Randomised controlled trial'])
  })
  it('编辑：候选（按名字 + 按引用）→ 确认 → 标签页变成「编辑确认」', async () => {
    const s = await evidence.suggestBindings('adhd')
    if (!s.ok) throw new Error(s.error)
    const rows = presentBindingSuggestions(s.data, { locale: 'zh' })
    expect(rows[0].cited_text).toContain('1 篇文献里，1 篇的主主题是它')
    const c = await evidence.curate({ tag: 'ADHD', topic_id: 'openalex:T10537', by: 'editor-1' })
    expect(c.ok).toBe(true)
    const after = await evidence.getTagMap('#adhd')
    expect(after.ok && presentEvidenceMap(after.data, { locale: 'en' }).binding?.badge).toBe('curated')
  })
  it('作者：保存文章时的问题清单', () => {
    const { issues } = evidence.intake({ id: 'x', title: 'T', effect: { metric: 'smd', value: 0.4, ci_low: 0.5, ci_high: 0.9 } })
    expect(presentIntakeIssues(issues, { locale: 'en' })).toEqual([
      { code: 'ci_excludes_estimate', field: 'effect.ci', action: 'field_cleared', text: 'The point estimate lies outside its confidence interval; the interval was ignored.' },
    ])
  })
  it('API key 只进请求头：缓存与数据里都没有它', () => {
    expect(JSON.stringify([...kvStore.entries()])).not.toContain('test-key')
  })
})
