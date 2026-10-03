/**
 * 站内层（学术类文章）：
 *   ① 入库验形：每条规则都有动作（整条丢 / 清字段 / 改写 / 标记），从不抛；
 *   ② 方向与点估计矛盾 ⇒ 方向 unclear、orientation 清空；没申报方向时从点估计推；
 *   ③ 链接只收 http(s)（`javascript:` 不许变成可点的链接）；DOI 各种写法归一；
 *   ④ 站内格子：互斥维分母＝有值的记录、多标签维分母＝全部记录；焦点标签不进自己的分布；
 *   ⑤ 共现图：支持度 / Jaccard / lift 按定义算；门槛压掉多少如实回报；少于 30 条印 small_corpus；
 *   ⑥ 审阅门槛（0.4.0）：审阅时间归一、没审阅的只标记不丢；门槛只拦站内记录、数出在等的。
 */
import {
  intakeArticle, intakeArticles, countOnsite, crossOnsite, buildTagGraph, buildRecordEdges, countOnsiteLayer, normalizeDoi, safeHttpUrl, onsiteDimensionsMatchContract, onsiteValueCount,
  applyReviewGate, isReviewed,
} from '../src/onsite'
import type { EvidenceIntakeIssue, EvidenceRecord } from '../src/types'
import { ONSITE_DIMENSION_IDS } from '../src/types'
import { presentOnsiteCounts } from '../src/present'
import { pickEvidenceView } from '../src/ladder'
import { isEvidenceOnsiteCounts } from '../src/guards'

const at = '2026-09-29T00:00:00.000Z'
const codes = (issues: EvidenceIntakeIssue[]) => issues.map((i) => i.code)
const ok = (over: Record<string, unknown> = {}) => intakeArticle({ id: 'a1', title: 'T', ...over }, { retrieved_at: at, license: 'CC BY 4.0', source_label: 'Site' })

describe('入库验形', () => {
  it('最小文章也能进；来源与许可进 provenance；id 加 onsite: 前缀', () => {
    const r = ok()
    expect(r.issues).toEqual([])
    expect(r.record).toMatchObject({ id: 'onsite:a1', source: 'onsite', external_id: 'a1', title: 'T', effect: null, direction: null, tags: [] })
    expect(r.record!.provenance).toEqual({ source_label: 'Site', license: 'CC BY 4.0', retrieved_at: at })
  })
  it('整条丢掉的四种情况', () => {
    expect(codes(intakeArticle({ title: 'T' }).issues)).toEqual(['missing_id'])
    expect(codes(intakeArticle({ id: 'a', title: '  ' }).issues)).toEqual(['missing_title'])
    expect(codes(intakeArticle({ id: 'a', title: 'T', is_public: false }).issues)).toEqual(['not_public'])
    expect(codes(intakeArticle({ id: 'a', title: 'T', is_retracted: true }).issues)).toEqual(['retracted'])
    expect(intakeArticle(null).record).toBeNull()
    expect(intakeArticle('x').record).toBeNull()
  })
  it('年份：显式 year 优先；published_at 兜底；越界清空', () => {
    expect(ok({ year: 2024 }).record!.year).toBe(2024)
    expect(ok({ published_at: '2023-05-01T00:00:00Z' }).record!.year).toBe(2023)
    expect(ok({ published_at: new Date(Date.UTC(2022, 0, 1)) }).record!.year).toBe(2022)
    const bad = ok({ year: 3000 })
    expect(bad.record!.year).toBeNull()
    expect(codes(bad.issues)).toEqual(['invalid_year'])
  })
  it('链接只收 http(s)；DOI 各种写法归一', () => {
    const js = ok({ url: 'javascript:alert(1)' })
    expect(js.record!.url).toBeNull()
    expect(codes(js.issues)).toEqual(['invalid_url'])
    expect(ok({ url: 'https://example.org/a?b=1' }).record!.url).toBe('https://example.org/a?b=1')
    expect(normalizeDoi('https://doi.org/10.1000/ABC.1')).toBe('10.1000/abc.1')
    expect(normalizeDoi('doi: 10.1000/xyz')).toBe('10.1000/xyz')
    expect(normalizeDoi('not a doi')).toBeNull()
    expect(safeHttpUrl('data:text/html,hi')).toBeNull()
    const d = ok({ doi: '10.1000/xyz' }).record!
    expect(d.doi).toBe('https://doi.org/10.1000/xyz')
    expect(d.url).toBe('https://doi.org/10.1000/xyz')
  })
  it('标签：归一后去重，保留第一个原文写法；坏标签丢掉；超过上限截断', () => {
    const r = ok({ tags: ['ADHD', 'adhd', ' Sleep ', '', 42, '#'] })
    expect(r.record!.tags).toEqual(['ADHD', 'Sleep'])
    expect(codes(r.issues)).toEqual(['tag_invalid'])
    const many = intakeArticle({ id: 'a', title: 'T', tags: Array.from({ length: 5 }, (_, i) => `t${i}`) }, { maxTags: 3 })
    expect(many.record!.tags).toEqual(['t0', 't1', 't2'])
    expect(codes(many.issues)).toEqual(['too_many_tags'])
  })
  it('封闭词表：研究设计 / 结果类型 / 方向，词表外清空', () => {
    const r = ok({ study_design: 'RCT', claim: 'Significant', direction: 'sideways' })
    expect(r.record!.study_type).toBe('rct')
    expect(r.record!.self_reported_claim).toBe('significant')
    expect(r.record!.direction).toBeNull()
    expect(codes(r.issues)).toEqual(['unknown_direction'])
    expect(codes(ok({ study_design: 'anecdote' }).issues)).toEqual(['unknown_study_design'])
    expect(codes(ok({ claim: 'yes' }).issues)).toEqual(['unknown_claim'])
  })

  describe('效应量', () => {
    const eff = (e: Record<string, unknown>, extra: Record<string, unknown> = {}) => ok({ effect: e, ...extra })
    it('数字样的字符串也收（数据库驱动常把 numeric 读成字符串）', () => {
      const r = eff({ metric: 'smd', value: '-0.42', ci_low: '-0.61', ci_high: '-0.23', n: '120', p_value: '0.001', higher_is_better: false })
      expect(r.issues).toEqual([])
      expect(r.record!.effect).toEqual({ metric: 'smd', value: -0.42, ci_low: -0.61, ci_high: -0.23, n: 120, p_value: 0.001, higher_is_better: false })
    })
    it.each([
      [{ metric: 'bogus', value: 1 }, 'unknown_metric'],
      [{ metric: 'smd', value: 'abc' }, 'effect_not_finite'],
      [{ metric: 'or', value: 0 }, 'ratio_not_positive'],
      [{ metric: 'r', value: 1.2 }, 'value_out_of_range'],
      [{ metric: 'prevalence', value: 12 }, 'value_out_of_range'],
    ])('%j ⇒ 没有别的可留，整个效应量清空（%s）', (e, code) => {
      const r = eff(e)
      expect(r.record!.effect).toBeNull()
      expect(codes(r.issues)).toEqual([code])
    })
    it('只有精确 p 与样本量、没有点估计 ⇒ 照收（value 为 null），两篇就能画到信天翁那一级', () => {
      const r = eff({ metric: 'smd', p_value: 0.03, n: 120 }, { direction: 'favours' })
      expect(r.issues).toEqual([])
      expect(r.record!.effect).toEqual({ metric: 'smd', value: null, ci_low: null, ci_high: null, n: 120, p_value: 0.03, higher_is_better: null })
      expect(r.record!.direction).toBe('favours')
      const two = intakeArticles([
        { id: 1, title: 'A', direction: 'favours', effect: { metric: 'smd', p_value: '0.004', n: 240 } },
        { id: 2, title: 'B', direction: 'against', effect: { metric: 'smd', value: '', p_value: 0.45, n: '60' } },
      ], { retrieved_at: at })
      expect(two.issues).toEqual([])
      expect(pickEvidenceView(two.records)).toEqual({ kind: 'albatross', usable: 2, total: 2, downgrade_reason: 'no_effect_sizes' })
    })
    it('点估计不合法但 p 与样本量合法 ⇒ 只清点估计，效应量保留', () => {
      const r = eff({ metric: 'or', value: -2, p_value: 0.2, n: 80 })
      expect(r.record!.effect).toMatchObject({ value: null, n: 80, p_value: 0.2 })
      expect(r.issues).toEqual([{ code: 'ratio_not_positive', field: 'effect.value', action: 'field_cleared' }])
    })
    it('没有点估计的区间核不了 ⇒ 只清区间（ci_without_estimate）；只填了度量 ⇒ 没有效应量、也不报错', () => {
      const r = eff({ metric: 'smd', ci_low: 0.1, ci_high: 0.5, n: 50 })
      expect(r.record!.effect).toMatchObject({ value: null, ci_low: null, ci_high: null, n: 50 })
      expect(r.issues).toEqual([{ code: 'ci_without_estimate', field: 'effect.ci', action: 'field_cleared' }])
      const bare = eff({ metric: 'smd' })
      expect(bare.record!.effect).toBeNull()
      expect(bare.issues).toEqual([])
    })
    it.each([
      [{ ci_low: 0.1 }, 'ci_incomplete'],
      [{ ci_low: 0.9, ci_high: 0.1 }, 'ci_inverted'],
      [{ ci_low: 0.3, ci_high: 0.3 }, 'ci_inverted'],
      [{ ci_low: 0.6, ci_high: 0.9 }, 'ci_excludes_estimate'],
    ])('区间 %j ⇒ 只清空区间（%s），点估计保留', (ci, code) => {
      const r = eff({ metric: 'smd', value: 0.3, ...ci })
      expect(r.record!.effect).toMatchObject({ value: 0.3, ci_low: null, ci_high: null })
      expect(codes(r.issues)).toEqual([code])
    })
    it('比值的区间 ≤ 0 ⇒ ratio_not_positive，只清区间', () => {
      const r = eff({ metric: 'or', value: 1.2, ci_low: 0, ci_high: 2 })
      expect(r.record!.effect).toMatchObject({ value: 1.2, ci_low: null })
      expect(codes(r.issues)).toEqual(['ratio_not_positive'])
    })
    it('样本量要正整数；p 要在 (0, 1]', () => {
      expect(codes(eff({ metric: 'smd', value: 0.1, n: 12.5 }).issues)).toEqual(['n_invalid'])
      expect(codes(eff({ metric: 'smd', value: 0.1, n: 0 }).issues)).toEqual(['n_invalid'])
      expect(codes(eff({ metric: 'smd', value: 0.1, p_value: 0 }).issues)).toEqual(['p_invalid'])
      expect(codes(eff({ metric: 'smd', value: 0.1, p_value: 1.5 }).issues)).toEqual(['p_invalid'])
    })
    it('没申报方向 ⇒ 从点估计推（按点估计方向，不看显著性）', () => {
      expect(eff({ metric: 'smd', value: -0.4, higher_is_better: false }).record!.direction).toBe('favours')
      expect(eff({ metric: 'or', value: 0.8, higher_is_better: true }).record!.direction).toBe('against')
      expect(eff({ metric: 'smd', value: 0, higher_is_better: true }).record!.direction).toBe('unclear')
      expect(eff({ metric: 'smd', value: 0.4 }).record!.direction).toBeNull()        // 不知道大＝好还是坏
      expect(eff({ metric: 'prevalence', value: 0.2, higher_is_better: true }).record!.direction).toBeNull() // 没有无效应值
    })
    it('方向与点估计矛盾 ⇒ 方向 unclear、orientation 清空（谁错了判断不了，就都不拿来画「偏向谁」）', () => {
      const r = eff({ metric: 'smd', value: 0.5, higher_is_better: true }, { direction: 'against' })
      expect(r.record!.direction).toBe('unclear')
      expect(r.record!.effect!.higher_is_better).toBeNull()
      expect(r.issues).toEqual([{ code: 'direction_conflicts_effect', field: 'direction', action: 'value_adjusted' }])
    })
    it('自报显著性、p 与 95% 区间矛盾 ⇒ 只标记，原值保留', () => {
      const r = eff({ metric: 'smd', value: 0.2, ci_low: -0.1, ci_high: 0.5, p_value: 0.01 }, { claim: 'significant' })
      expect(r.record!.self_reported_claim).toBe('significant')
      expect(r.record!.effect!.p_value).toBe(0.01)
      expect(r.issues.map((i) => [i.code, i.action])).toEqual([['claim_conflicts_ci', 'flagged'], ['p_conflicts_ci', 'flagged']])
      expect(eff({ metric: 'or', value: 1.5, ci_low: 1.1, ci_high: 2 }, { claim: 'non_significant' }).issues.map((i) => i.code)).toEqual(['claim_conflicts_ci'])
      expect(eff({ metric: 'or', value: 1.5, ci_low: 1.1, ci_high: 2, p_value: 0.049 }).issues).toEqual([]) // 临界附近不误报
    })
  })

  it('参考文献：DOI 归一去重', () => {
    const r = ok({ references: ['10.1000/AB', { doi: 'https://doi.org/10.1000/ab' }, { doi: null }, 'junk', '10.1/too-short-prefix', 'doi:10.1234/c'] })
    expect(r.references).toEqual(['10.1000/ab', '10.1234/c'])
  })
  it('参考文献的引用用途（0.5.0）：我们的名字与 CiTO 名称都认、按词表顺序去重；认不出的只清掉那几个；标注人认不出整条不转述', () => {
    const r = ok({ references: [
      { doi: '10.1000/a', functions: ['cito:usesMethodIn', 'Confirms', 'uses-method', 'guesswork'] },
      { doi: '10.1000/b', functions: 'http://purl.org/spar/cito/disputes', declared_by: 'editor' },
      { doi: '10.1000/c', functions: ['extends'], declared_by: 'robot' },
      { doi: '10.1000/d', functions: [] },
      { doi: '10.1000/A', functions: ['replicates', ' '] }, // 同一条写了两次、同一个人标的：合起来
      { doi: '10.1000/b', functions: ['confirms'], declared_by: 'author' }, // 不同的人标的：留先写的那份
      '10.1000/e',
    ] })
    expect(r.references).toEqual(['10.1000/a', '10.1000/b', '10.1000/c', '10.1000/d', '10.1000/e'])
    expect([...r.purposes!.entries()]).toEqual([
      ['10.1000/a', { functions: ['uses_method', 'replicates', 'confirms'], declared_by: 'author' }],
      ['10.1000/b', { functions: ['disputes'], declared_by: 'editor' }],
    ])
    expect(r.issues).toEqual([{ code: 'unknown_citation_function', field: 'references', action: 'field_cleared' }])
    expect(r.record).not.toBeNull()
    // CiTO 里意思落在同一档的名字（supports ≈ confirms，citesAsDataSource ≈ uses_data）；原型链上的名字不认
    expect([...ok({ references: [{ doi: '10.1000/a', functions: ['cito:supports', 'citesAsDataSource', 'obtains background from'] }] }).purposes!.values()])
      .toEqual([{ functions: ['background', 'uses_data', 'confirms'], declared_by: 'author' }])
    expect(ok({ references: [{ doi: '10.1000/a', functions: ['constructor', '__proto__'] }] }).purposes!.size).toBe(0)
    expect(ok({ references: [{ doi: '10.1000/a', functions: 42 }] }).issues.map((i) => i.code)).toEqual(['unknown_citation_function'])
    expect(ok({ references: [{ doi: '10.1000/a', functions: ['background'], declared_by: 'machine' }] }).issues).toEqual([])
    // 批量：用途按记录 id 归好，只放申报过的
    const batch = intakeArticles([
      { id: 1, title: 'A', references: [{ doi: '10.1000/x', functions: ['extends'] }] }, { id: 2, title: 'B', references: ['10.1000/x'] },
    ], { retrieved_at: at })
    expect([...batch.purposes.entries()].map(([id, m]) => [id, [...m.keys()]])).toEqual([['onsite:1', ['10.1000/x']]])
  })
  it('批量：只列有问题的文章', () => {
    const out = intakeArticles([{ id: 1, title: 'A' }, { id: 2, title: 'B', year: 'x' }, { title: 'no id' }], { retrieved_at: at })
    expect(out.records.map((r) => r.id)).toEqual(['onsite:1', 'onsite:2'])
    expect(out.issues).toEqual([
      { article_id: '2', issues: [{ code: 'invalid_year', field: 'year', action: 'field_cleared' }] },
      { article_id: null, issues: [{ code: 'missing_id', field: 'id', action: 'record_dropped' }] },
    ])
  })
})

const rec = (id: string, over: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  ...intakeArticle({ id, title: id }, { retrieved_at: at }).record!, ...over,
})

describe('站内格子', () => {
  const records = [
    rec('1', { year: 2024, tags: ['ADHD', 'sleep'], study_type: 'rct', self_reported_claim: 'significant' }),
    rec('2', { year: 2024, tags: ['adhd', 'Sleep', 'diet'], study_type: 'cohort' }),
    rec('3', { year: 2023, tags: ['ADHD'], study_type: 'rct', self_reported_claim: 'non_significant' }),
    rec('4', { year: null, tags: ['ADHD', 'diet'] }),
  ]
  it('互斥维：分母＝有值的记录，unknown＝没值的，年份升序', () => {
    const s = countOnsite(records, 'publication_year', { retrieved_at: at })
    expect(s.cells.map((c) => [c.key, c.count])).toEqual([['2023', 1], ['2024', 2]])
    expect(s.denominator).toEqual({ kind: 'works_with_value', value: 3 })
    expect(s.unknown).toBe(1)
    expect(s.partition).toBe(true)
    expect(s.caveats).toEqual(['onsite_self_selected', 'small_corpus'])
    expect(s.provenance.credits).toBe(0)
  })
  it('多标签维：分母＝全部记录；焦点标签不进自己的分布；桶名取最常见写法（并列取码点序最小的）', () => {
    const s = countOnsite(records, 'tag', { excludeKeys: ['adhd'] })
    expect(s.cells.map((c) => [c.key, c.label, c.count])).toEqual([['diet', 'diet', 2], ['sleep', 'Sleep', 2]])
    expect(s.denominator).toEqual({ kind: 'works_in_scope', value: 4 })
    expect(s.unknown).toBeNull()
    expect(s.partition).toBe(false)
    expect(s.caveats).toContain('multi_label')
  })
  it('标签 × 研究设计的缺口图：行的计数含未申报设计的，cross 只数申报了的', () => {
    const s = crossOnsite(records)
    expect(s.by).toBe('study_type')
    expect(s.cells[0]).toMatchObject({ key: 'adhd', count: 4 })
    expect(s.cross![0]).toEqual([{ key: 'rct', label: 'rct', count: 2 }, { key: 'cohort', label: 'cohort', count: 1 }])
  })
  it('注册表与契约值域同源', () => expect(onsiteDimensionsMatchContract()).toBe(true))
})

describe('标签共现图', () => {
  // 10 篇：a 出现 6 次，b 5 次，a∧b 4 次，c 2 次（只与 a 同现 1 次），d 1 次
  const tagsets = [['a', 'b'], ['a', 'b'], ['a', 'b'], ['a', 'b'], ['a', 'c'], ['a'], ['b'], ['c', 'd'], [], []]
  const records = tagsets.map((t, i) => rec(String(i), { tags: t }))
  it('支持度、Jaccard、lift 按定义算', () => {
    const g = buildTagGraph(records, { retrieved_at: at })
    expect(g.records).toBe(10)
    expect(g.nodes.map((n) => [n.key, n.count])).toEqual([['a', 6], ['b', 5], ['c', 2]])
    expect(g.edges).toHaveLength(1)
    const e = g.edges[0]
    expect([e.a, e.b, e.count]).toEqual(['a', 'b', 4])
    expect(e.jaccard).toBeCloseTo(4 / (6 + 5 - 4), 12)
    expect(e.lift).toBeCloseTo((4 * 10) / (6 * 5), 12)
  })
  it('门槛压掉多少如实回报；少于 30 条印 small_corpus', () => {
    const g = buildTagGraph(records)
    expect(g.collapsed).toEqual({ tags: 1, edges: 2 }) // d 被压掉；a–c、c–d 两条边被压掉
    expect(g.caveats).toEqual(['onsite_self_selected', 'cooccurrence_not_citation', 'small_corpus'])
  })
  it('以某个标签为中心：只看带它的记录，焦点一定在图里', () => {
    const g = buildTagGraph(records, { focus: 'C', minSupport: 1 })
    expect(g.focus).toBe('c')
    expect(g.records).toBe(2)
    expect(g.nodes.map((n) => n.key).sort()).toEqual(['a', 'c', 'd'])
  })
  it('节点上限', () => {
    expect(buildTagGraph(records, { maxNodes: 1 }).nodes.map((n) => n.key)).toEqual(['a'])
  })
})

describe('站内层', () => {
  it('一个标签的全部站内格子：各维度都有、记录级图按记录判', () => {
    const records = [
      rec('1', { tags: ['x'], direction: 'favours' }),
      rec('2', { tags: ['x', 'y'], direction: 'against' }),
    ]
    const layer = countOnsiteLayer(records, { scope: { level: 'tag', id: 'onsite:x', display_name: 'x', tag_keys: ['x'] }, retrieved_at: at })
    expect(layer.total).toBe(2)
    expect(layer.series.map((s) => s.dimension)).toEqual(['publication_year', 'publication_type', 'study_type', 'tag', 'self_reported_claim'])
    const tagSeries = layer.series.find((s) => s.dimension === 'tag')!
    expect(tagSeries.cells.map((c) => c.key)).toEqual(['y']) // 焦点 x 自己不进分布
    const avail = Object.fromEntries(layer.availability.tag.map((a) => [a.kind, a.blocker]))
    expect(avail.harvest).toBeNull()                     // 有方向 ⇒ 收获图可画
    expect(avail.forest).toBe('needs_effect_size')
    expect(avail.positive_rate).toBe('needs_onsite_significance')
    expect(avail.egm).toBeNull()                         // 标签 × 研究设计
    expect(avail.pie).toBe('needs_partition')
    expect(layer.tag_graph?.focus).toBe('x')
  })
  it('只要部分维度、带接入方样本门：只下发要的格子并回显 sample_gate；availability 仍覆盖全部维度；门没过只剩主题图与清单', () => {
    const records = [
      rec('1', { year: 2024, tags: ['x'], self_reported_claim: 'significant', study_type: 'rct' }),
      rec('2', { year: 2024, tags: ['x', 'y'], self_reported_claim: 'non_significant' }),
      rec('3', { year: null, tags: ['x'] }),
    ]
    const scope = { level: 'tag' as const, id: 'onsite:x', display_name: 'x', tag_keys: ['x'] }
    const layer = countOnsiteLayer(records, {
      scope, retrieved_at: at, graph: false,
      dimensions: ['publication_year', 'self_reported_claim'],
      sampleGates: { self_reported_claim: 3, publication_year: 2 },
    })
    expect(layer.series.map((s) => s.dimension)).toEqual(['publication_year', 'self_reported_claim'])
    expect(Object.keys(layer.availability).sort()).toEqual([...ONSITE_DIMENSION_IDS].sort())
    expect(layer.series.map((s) => s.sample_gate)).toEqual([{ min: 2, n: 2, ok: true }, { min: 3, n: 2, ok: false }])
    const claim = Object.fromEntries(layer.availability.self_reported_claim.map((a) => [a.kind, a.blocker]))
    expect([claim.nodes, claim.list, claim.bar]).toEqual([null, null, 'needs_more_onsite'])
    const year = Object.fromEntries(layer.availability.publication_year.map((a) => [a.kind, a.blocker]))
    expect([year.bar, year.timeseries]).toEqual([null, null]) // 门过了：照形状判（读占比的图仍受引擎 30 篇比例门槛）
    expect(year.pie).toBe('needs_more_onsite')
    // 不给门的维度不回显；不给 dimensions ＝ 全部（既有行为不变）
    const plain = countOnsiteLayer(records, { scope, retrieved_at: at, graph: false })
    expect(plain.series).toHaveLength(ONSITE_DIMENSION_IDS.length)
    expect(plain.series.every((s) => s.sample_gate === undefined)).toBe(true)
    expect(Object.fromEntries(plain.availability.self_reported_claim.map((a) => [a.kind, a.blocker])).bar).toBeNull()
    // 视图：菜单只给下发了的维度，样本门原样转交；验形认得 sample_gate
    const view = presentOnsiteCounts(layer, { locale: 'zh' })
    expect(Object.keys(view.charts).sort()).toEqual(['publication_year', 'self_reported_claim'])
    expect(view.series[1].sample_gate).toEqual({ min: 3, n: 2, ok: false })
    expect(isEvidenceOnsiteCounts(layer)).toBe(true)
    expect(isEvidenceOnsiteCounts({ ...layer, series: [{ ...layer.series[0], sample_gate: { min: 'x' } }] })).toBe(false)
  })
  it('有值篇数：多值维除去焦点标签后至少还有一个值才算', () => {
    const records = [rec('1', { tags: ['x'] }), rec('2', { tags: ['x', 'y'] }), rec('3', { tags: [] })]
    expect(onsiteValueCount(records, 'tag', ['x'])).toBe(1)
    expect(onsiteValueCount(records, 'tag')).toBe(2)
    expect(onsiteValueCount(records, 'publication_year')).toBe(records.filter((r) => r.year != null).length)
  })
})

describe('移动端可移植性', () => {
  it('链接校验不依赖 URL 对象：拒绝带账号的主机、空白与控制字符', () => {
    expect(safeHttpUrl('https://example.org:8443/a/b?c=1#d')).toBe('https://example.org:8443/a/b?c=1#d')
    expect(safeHttpUrl('HTTP://Example.org')).toBe('HTTP://Example.org')
    expect(safeHttpUrl('https://real.example@evil.example/')).toBeNull()
    expect(safeHttpUrl('https://exa mple.org')).toBeNull()
    expect(safeHttpUrl('https://example.org/\u0000')).toBeNull()
    expect(safeHttpUrl('https:/example.org')).toBeNull()
    expect(safeHttpUrl('ftp://example.org')).toBeNull()
  })
})

describe('记录之间的边', () => {
  const rec2 = (id: string, over: Partial<EvidenceRecord>) => ({ ...intakeArticle({ id, title: id }).record!, ...over })
  it('引用边：站内文章申报的参考文献 DOI 对上图上另一条记录（站内或外部）；同一对只出一条', () => {
    const a = rec2('a', { tags: ['x', 'sleep'] })
    const b = rec2('b', { tags: ['x', 'sleep', 'diet'], doi: 'https://doi.org/10.1000/b' })
    const w: EvidenceRecord = { ...rec2('w', {}), id: 'openalex:W1', source: 'openalex', doi: 'https://doi.org/10.1000/W1' }
    const refs = new Map([['onsite:a', ['10.1000/b', '10.1000/w1', '10.1000/w1', '10.9999/none']]])
    const edges = buildRecordEdges([a, b, w], refs, { focusKeys: ['x'] })
    expect(edges).toEqual([
      { from: 'onsite:a', to: 'onsite:b', kind: 'cites' },
      { from: 'onsite:a', to: 'openalex:W1', kind: 'cites' },
      { from: 'onsite:a', to: 'onsite:b', kind: 'shares_tag' },
    ])
  })
  it('引用边带上申报的用途（0.5.0）：只给申报过的那几条；外部作品自带的引用不带用途（外部源不给，引擎也不猜）', () => {
    const a = rec2('a', {})
    const b = rec2('b', { doi: 'https://doi.org/10.1000/b' })
    const w: EvidenceRecord = { ...rec2('w', {}), id: 'openalex:W1', source: 'openalex', doi: 'https://doi.org/10.1000/w1', cites: ['onsite:b'] }
    const refs = new Map([['onsite:a', ['10.1000/b', '10.1000/w1']]])
    const purposes = new Map([['onsite:a', new Map([['10.1000/w1', { functions: ['uses_method' as const], declared_by: 'author' as const }]])]])
    const edges = buildRecordEdges([a, b, w], refs, { purposes })
    expect(edges).toEqual([
      { from: 'onsite:a', to: 'onsite:b', kind: 'cites' },
      { from: 'onsite:a', to: 'openalex:W1', kind: 'cites', purpose: { functions: ['uses_method'], declared_by: 'author' } },
      { from: 'openalex:W1', to: 'onsite:b', kind: 'cites' },
    ])
    // 边上的用途是拷贝：改了不影响入库结果
    edges[1].purpose!.functions.push('disputes')
    expect(purposes.get('onsite:a')!.get('10.1000/w1')!.functions).toEqual(['uses_method'])
  })
  it('同标签边：焦点标签不算；门槛与上限；按共有标签数从多到少', () => {
    const r = [
      rec2('a', { tags: ['x', 'p', 'q'] }), rec2('b', { tags: ['x', 'p', 'q'] }), rec2('c', { tags: ['x', 'p'] }), rec2('d', { tags: ['x'] }),
    ]
    expect(buildRecordEdges(r, new Map(), { focusKeys: ['x'] }).map((e) => `${e.from}-${e.to}`)).toEqual(['onsite:a-onsite:b', 'onsite:a-onsite:c', 'onsite:b-onsite:c'])
    expect(buildRecordEdges(r, new Map(), { focusKeys: ['x'], minSharedTags: 2 })).toHaveLength(1)
    expect(buildRecordEdges(r, new Map(), { focusKeys: ['x'], maxSharedTagEdges: 1 })).toEqual([{ from: 'onsite:a', to: 'onsite:b', kind: 'shares_tag' }])
    expect(buildRecordEdges(r, new Map(), { focusKeys: ['x', 'p', 'q'] })).toEqual([])
  })
})

describe('审阅门槛（0.4.0）', () => {
  const meta = { retrieved_at: '2026-10-02T00:00:00.000Z', source_label: 'Site', license: 'CC BY 4.0' }
  it('审阅时间：ISO 串或 Date 归一成 ISO；认不出的不带；没有就不带这个字段（旧记录形状不变）', () => {
    expect(intakeArticle({ id: 1, title: 'A', reviewed_at: '2026-09-30T08:00:00+08:00' }, meta).record?.reviewed_at).toBe('2026-09-30T00:00:00.000Z')
    expect(intakeArticle({ id: 1, title: 'A', reviewed_at: new Date('2026-09-30T00:00:00Z') }, meta).record?.reviewed_at).toBe('2026-09-30T00:00:00.000Z')
    const bad = intakeArticle({ id: 1, title: 'A', reviewed_at: 'yesterday-ish' }, meta)
    expect(bad.record && 'reviewed_at' in bad.record).toBe(false)
    expect(bad.issues).toEqual([]) // 门槛没开：审阅时间不影响入库
    expect('reviewed_at' in intakeArticle({ id: 1, title: 'A' }, meta).record!).toBe(false)
  })
  it('开了门槛：没审阅的照出记录，只加一条 awaiting_review（只做标记）；审阅过的没有这条', () => {
    const r = intakeArticle({ id: 1, title: 'A', tags: ['x'] }, { ...meta, requireReview: true })
    expect(r.record?.id).toBe('onsite:1')
    expect(r.issues).toEqual([{ code: 'awaiting_review', field: 'reviewed_at', action: 'flagged' }])
    expect(intakeArticle({ id: 1, title: 'A', reviewed_at: 'not a time' }, { ...meta, requireReview: true }).issues.map((i) => i.code)).toEqual(['awaiting_review'])
    expect(intakeArticle({ id: 1, title: 'A', reviewed_at: '2026-09-30' }, { ...meta, requireReview: true }).issues).toEqual([])
  })
  it('applyReviewGate：站内只留审阅过的、数出在等的；外部记录不受影响；接入方自己映射的记录也认', () => {
    const { records } = intakeArticles([
      { id: 1, title: 'A', reviewed_at: '2026-09-30' }, { id: 2, title: 'B' }, { id: 3, title: 'C' },
    ], meta)
    const ext = { ...records[0], id: 'openalex:W1', source: 'openalex' as const, reviewed_at: undefined }
    const hostMapped = { ...records[1], id: 'onsite:9', reviewed_at: '2026-10-01T00:00:00Z' }
    const garbage = { ...records[2], id: 'onsite:10', reviewed_at: 'n/a' }
    const g = applyReviewGate([...records, ext, hostMapped, garbage])
    expect(g.records.map((r) => r.id)).toEqual(['onsite:1', 'openalex:W1', 'onsite:9'])
    expect(g.pending).toBe(3)
    expect(isReviewed({ reviewed_at: null })).toBe(false)
  })
})
