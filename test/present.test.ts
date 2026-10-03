/**
 * 消费端：
 *   ① 词典：每个契约键在中英两份里都有非空的一句；两份模板的占位符集合相同；宿主可以只改几句；
 *   ② 百分比只用声明的分母（多标签维不用桶和）；分母 < 30 不给百分比；带 Wilson 区间；暂定年份印滞后图注；
 *   ③ 图种菜单：画不了的灰着并写明差什么；
 *   ④ 阶梯摘要、汇总估计的一句话；绑定徽章（机器绑定必带 machine_binding 图注）；
 *   ⑤ 研究图谱：外部层状态、只有站内、示例不代表全体、出处脚注；
 *   ⑥ 共现图：节点面积 ∝ 计数、边强度用 lift、线宽用计数；折叠数写进图注；
 *   ⑦ 下钻（0.4.0）：往里一层只给相对长度不给占比、三种「没有」分开说；作品清单的期刊 / 免费链接 / 别的主题与标签 / 同批引用；
 *      「还挂着什么」只在这批里数、不列焦点自己；
 *   ⑧ 审阅门槛（0.4.0）：有在等审阅的才说一句，没有或没开门槛时什么都不说；
 *   ⑦ 里还有 0.5.0 的引用为什么引（只转述申报的、没申报的明说）与一篇文章的位置（是什么研究、推进了什么、只看这一批）。
 */
import {
  EVIDENCE_MESSAGES, getMessages, mergeMessages, formatMessage, placeholders, BINDING_BADGES,
} from '../src/messages'
import type { EvidenceMessageCatalog } from '../src/messages'
import {
  presentSeries, presentChartMenu, presentView, presentBinding, presentEvidenceMap, presentTagGraph, presentIntakeIssues,
  presentBindingSuggestions, presentCounts, formatProvenance, effectDecimals, presentNodeChildren, presentWorks, presentRecordFacets,
  presentOnsiteCounts, presentCitations, presentArticleContext,
} from '../src/present'
import {
  EVIDENCE_CAVEATS, EVIDENCE_CHART_BLOCKERS, EVIDENCE_CHART_KINDS, EVIDENCE_DOWNGRADE_REASONS, EVIDENCE_EXTERNAL_MATCHES,
  EVIDENCE_INTAKE_ISSUES, EVIDENCE_POOLING_REASONS, EVIDENCE_STUDY_DESIGNS, EVIDENCE_DIMENSION_IDS, ONSITE_DIMENSION_IDS,
  EVIDENCE_DENOMINATOR_KINDS, EVIDENCE_EFFECT_METRICS, EVIDENCE_CITATION_FUNCTIONS, EVIDENCE_CITATION_DECLARERS,
} from '../src/types'
import type { EvidenceCitationPurpose, EvidenceCountSeries, EvidenceMapData, EvidenceRecord, EvidenceTopic } from '../src/types'
import { chartAvailability } from '../src/charts'
import { buildTagGraph, countOnsiteLayer, intakeArticle } from '../src/onsite'
import { SHARE_RELIABILITIES } from '../src/stats'
import { isEvidenceMapData } from '../src/guards'

const at = '2026-09-29T12:34:56.000Z'
const prov = { source_label: 'OpenAlex', license: 'CC0 1.0', query: '/works?filter=primary_topic.id:T1&group_by=authorships.countries', retrieved_at: at, credits: 1 }

describe('词典', () => {
  const sections: Array<[keyof EvidenceMessageCatalog, readonly string[]]> = [
    ['caveat', EVIDENCE_CAVEATS], ['blocker', EVIDENCE_CHART_BLOCKERS], ['chart', EVIDENCE_CHART_KINDS],
    ['downgrade', EVIDENCE_DOWNGRADE_REASONS], ['pooling', EVIDENCE_POOLING_REASONS], ['external', EVIDENCE_EXTERNAL_MATCHES],
    ['intake', EVIDENCE_INTAKE_ISSUES], ['studyDesign', EVIDENCE_STUDY_DESIGNS], ['binding', BINDING_BADGES],
    ['dimension', [...EVIDENCE_DIMENSION_IDS, ...ONSITE_DIMENSION_IDS]], ['denominator', EVIDENCE_DENOMINATOR_KINDS],
    ['metric', EVIDENCE_EFFECT_METRICS], ['reliability', SHARE_RELIABILITIES], ['studyDesignMeaning', EVIDENCE_STUDY_DESIGNS],
  ]
  it.each(Object.keys(EVIDENCE_MESSAGES))('%s：每个契约键都有非空的一句', (locale) => {
    const cat = EVIDENCE_MESSAGES[locale as 'zh' | 'en'] as unknown as Record<string, Record<string, string>>
    for (const [section, keys] of sections) {
      for (const k of keys) expect([section, k, (cat[section][k] ?? '').trim().length > 0]).toEqual([section, k, true])
    }
  })
  it.each(Object.keys(EVIDENCE_MESSAGES))('%s：引用用途的四节每个键都有一句（0.5.0）', (locale) => {
    const { citation } = EVIDENCE_MESSAGES[locale as 'zh' | 'en']
    for (const part of ['label', 'phrase', 'meaning'] as const) {
      for (const f of EVIDENCE_CITATION_FUNCTIONS) expect([part, f, citation[part][f]?.trim().length > 0]).toEqual([part, f, true])
    }
    for (const d of EVIDENCE_CITATION_DECLARERS) expect([d, citation.declarer[d]?.trim().length > 0]).toEqual([d, true])
    expect(Object.keys(EVIDENCE_MESSAGES.zh.publicationTypeMeaning).sort()).toEqual(Object.keys(EVIDENCE_MESSAGES.en.publicationTypeMeaning).sort())
  })
  it('中英两份模板的占位符集合相同（逐节逐键）', () => {
    const zh = EVIDENCE_MESSAGES.zh as unknown as Record<string, Record<string, unknown>>
    const en = EVIDENCE_MESSAGES.en as unknown as Record<string, Record<string, unknown>>
    for (const section of Object.keys(zh)) {
      if (section === 'bucket') continue
      for (const key of Object.keys(zh[section])) {
        expect([section, key, placeholders(String(zh[section][key]))]).toEqual([section, key, placeholders(String(en[section][key]))])
      }
    }
  })
  it('按语言挑词典；宿主可以只改几句；缺变量时占位符原样保留', () => {
    expect(getMessages('zh-Hant-TW')).toBe(EVIDENCE_MESSAGES.zh)
    expect(getMessages('ja')).toBe(EVIDENCE_MESSAGES.en)
    const custom = mergeMessages(EVIDENCE_MESSAGES.en, { caveat: { small_corpus: 'Tiny!' }, bucket: { oa_status: { gold: 'Gold!' } } })
    expect(custom.caveat.small_corpus).toBe('Tiny!')
    expect(custom.caveat.multi_label).toBe(EVIDENCE_MESSAGES.en.caveat.multi_label)
    expect(custom.bucket.oa_status?.gold).toBe('Gold!')
    expect(custom.bucket.oa_status?.green).toBe('Green OA')
    expect(EVIDENCE_MESSAGES.en.caveat.small_corpus).not.toBe('Tiny!') // 不改原词典
    expect(formatMessage('{a} and {b}', { a: 1 })).toBe('1 and {b}')
  })
})

const series = (over: Partial<EvidenceCountSeries> = {}): EvidenceCountSeries => ({
  dimension: 'country',
  cells: [{ key: 'US', label: 'United States', count: 60 }, { key: 'CN', label: 'China', count: 50 }, { key: 'IS', label: 'Iceland', count: 2 }],
  denominator: { kind: 'works_with_country', value: 100 },
  partition: false,
  unknown: null,
  provenance: prov,
  ...over,
})

describe('格子视图', () => {
  it('多标签维：百分比用声明的分母（不是桶和 112），并标出桶和会超过分母', () => {
    const v = presentSeries(series(), { locale: 'en' })
    expect(v.rows.map((r) => r.share)).toEqual([0.6, 0.5, 0.02])
    expect(v.sum_exceeds_denominator).toBe(true)
    expect(v.multi_label_text).toBe('A work can fall into several buckets, so buckets add up to more than 100')
    expect(v.denominator.text).toBe('Denominator: the 100 works with at least one institution country')
    expect(v.rows[0].label).toBe('United States')                      // Intl.DisplayNames
    expect(presentSeries(series(), { locale: 'zh' }).rows[0].label).toBe('美国')
    expect(v.caveats.map((c) => c.key)).toEqual(['producer_not_population', 'multi_label']) // 旧服务端没下发 caveats ⇒ 按注册表补
    expect(v.footnote).toBe('Source: OpenAlex (CC0 1.0), retrieved 2026-09-29')
  })
  it('每个比例带 Wilson 区间；分母 < 30 时只给计数', () => {
    const v = presentSeries(series(), { locale: 'en' })
    expect(v.rows[0].ci!.low).toBeCloseTo(0.5020, 3)
    expect(v.rows[0].reliability).toBe('ok')
    const small = presentSeries(series({ denominator: { kind: 'works_with_country', value: 12 }, cells: [{ key: 'US', label: 'US', count: 8 }] }))
    expect(small.rows[0]).toMatchObject({ count: 8, share: null, share_text: null, ci: null, reliability: 'insufficient_n' })
  })
  it('词典维按 key 查；词典里没有的新值回落到原文；暂定年份印滞后图注', () => {
    const oa = presentSeries(series({
      dimension: 'oa_status', partition: true, unknown: 5, denominator: { kind: 'works_with_value', value: 100 },
      cells: [{ key: 'gold', label: 'gold', count: 40 }, { key: 'platinum', label: 'platinum', count: 60 }],
    }), { locale: 'zh' })
    expect(oa.rows.map((r) => r.label)).toEqual(['金色 OA', 'platinum'])
    expect(oa.unknown_text).toBe('另有 5 篇这一维没有值，不计入分母')
    const years = presentSeries(series({
      dimension: 'publication_year', partition: true, denominator: { kind: 'works_with_value', value: 100 },
      cells: [{ key: '2024', label: '2024', count: 50 }, { key: '2025', label: '2025', count: 50, provisional: true }],
      caveats: ['recent_years_lag'],
    }))
    expect(years.rows[1].provisional).toBe(true)
    expect(years.caveats.map((c) => c.key)).toEqual(['recent_years_lag'])
  })
  it('站内缺口图：交叉表标签解析，每行没申报设计的数目单独给出', () => {
    const v = presentSeries({
      dimension: 'tag', by: 'study_type', partition: false, unknown: null,
      cells: [{ key: 'sleep', label: 'Sleep', count: 5 }],
      cross: [[{ key: 'rct', label: 'rct', count: 2 }, { key: 'cohort', label: 'cohort', count: 1 }]],
      denominator: { kind: 'works_in_scope', value: 5 },
      provenance: { ...prov, query: 'onsite:group_by=tag,study_type', credits: 0 },
    } as EvidenceCountSeries<string>, { locale: 'en' })
    expect(v.layer).toBe('onsite')
    expect(v.cross![0].map((x) => x.label)).toEqual(['Randomised controlled trial', 'Cohort study'])
    expect(v.cross_unassigned).toEqual([2])
  })
})

describe('图种菜单与阶梯摘要', () => {
  it('画不了的灰着，写明差什么', () => {
    const menu = presentChartMenu(chartAvailability({ dimension: 'country', series: series(), overlap: null, hasCross: false }), { locale: 'en' })
    const pie = menu.find((i) => i.kind === 'pie')!
    expect(pie).toMatchObject({ available: false, blocker: 'needs_partition', label: 'Pie chart' })
    expect(pie.reason).toContain('double-count')
    expect(menu.find((i) => i.kind === 'forest')!.reason).toBe('Needs effect sizes with confidence intervals.')
  })
  it('阶梯摘要与汇总估计', () => {
    const v = presentView({ kind: 'gap_map', usable: 3, total: 3, downgrade_reason: 'no_direction' }, { allowed: false, reason: 'not_applicable', studies: 0 }, { locale: 'zh' })
    expect(v.why_not_higher).toContain('按显著性计票不构成证据合成')
    expect(v.usable_text).toBe('3 / 3 条记录满足这一级的要求')
    const pooled = presentView({ kind: 'forest', usable: 5, total: 5, downgrade_reason: null }, {
      allowed: true, reason: 'ok', studies: 5,
      estimate: { method: 'reml_hksj', metric: 'or', k: 5, estimate: 1.40586, ci_low: 0.94929, ci_high: 2.08203, pi_low: 0.58803, pi_high: 3.36113, tau2: 0.0568, i2: 0.6163, q: 10.42, df: 4 },
    }, { locale: 'en' })
    // 同一句话里点估计与区间同一个小数位（比值至少 2 位）
    expect(pooled.estimate_text).toBe('Random-effects summary (Odds ratio (OR), 5 studies): 1.41, 95% CI 0.95 to 2.08; 95% prediction interval 0.59 to 3.36; I² = 61.6%')
  })
  it('汇总那句话：区间碰到负数用真正的减号（U+2212），近零的下限不多出位数', () => {
    const smd = presentView({ kind: 'forest', usable: 5, total: 5, downgrade_reason: null }, {
      allowed: true, reason: 'ok', studies: 5,
      estimate: { method: 'reml_hksj', metric: 'smd', k: 5, estimate: 0.3165, ci_low: -0.0032577, ci_high: 0.6363, pi_low: -0.2851, pi_high: 0.9181, tau2: 0.03, i2: 0.56, q: 9.1, df: 4 },
    }, { locale: 'zh' })
    expect(smd.estimate_text).toContain('0.32，95% 置信区间 −0.00 至 0.64；95% 预测区间 −0.29 至 0.92')
    expect(smd.estimate_text).not.toMatch(/-/)
  })
  it.each([
    ['or', 0.949, 2.08, 2], ['smd', -0.0033, 0.64, 2], ['smd', 0.30, 0.34, 3], ['r', 0.401, 0.4032, 4],
    ['md', 80.2, 160.8, 0], ['md', 1.2, 4.8, 1], ['md', 0.12, 0.18, 3], ['smd', 0.5, 0.5, 2], ['md', Number.NaN, 1, 2],
  ] as const)('小数位：%s 区间 %p 至 %p ⇒ %p 位', (metric, lo, hi, d) => {
    expect(effectDecimals(metric, lo, hi)).toBe(d)
  })
})

describe('绑定与研究图谱', () => {
  const machine = { tag_key: 'adhd', topic_id: 'openalex:T10537', topic_name: 'ADHD topic', kind: 'machine' as const, confidence: 'first_hit' as const, bound_at: at, bound_by: null, note: null }
  it('机器绑定必带 machine_binding 图注；编辑绑定不带', () => {
    const b = presentBinding(machine, 'matched', { locale: 'en' })
    expect(b).toMatchObject({ badge: 'machine_first_hit', text: 'Matched automatically (not reviewed): "ADHD topic"' })
    expect(b.caveat?.key).toBe('machine_binding')
    expect(presentBinding({ ...machine, kind: 'curated', confidence: null }, 'matched').caveat).toBeNull()
    expect(presentBinding(null, 'no_match', { locale: 'zh' }).status_text).toContain('没有与这个标签对应的主题')
  })
  it('研究图谱：状态、只有站内、示例、出处', () => {
    const onsite = intakeArticle({ id: 'a', title: 'A', tags: ['ADHD'] }, { retrieved_at: at, source_label: 'Site', license: 'CC BY 4.0' }).record!
    const ext: EvidenceRecord = { ...onsite, id: 'openalex:W1', source: 'openalex', external_id: 'W1', provenance: { source_label: 'OpenAlex', license: 'CC0 1.0', retrieved_at: at } }
    const map: EvidenceMapData = {
      level: 'tag', focus: { id: 'onsite:adhd', source: 'onsite', external_id: 'adhd', level: 'tag', display_name: 'ADHD', description: null, parent_id: 'openalex:T10537', works_count: 1 },
      parent: null, siblings: [], records: [onsite, ext], view: { kind: 'gap_map', usable: 2, total: 2, downgrade_reason: 'no_direction' },
      pooling: { allowed: false, reason: 'not_applicable', studies: 0 }, sources: [onsite.provenance, ext.provenance],
      onsite_only: false, external_match: 'matched', binding: machine,
    }
    const v = presentEvidenceMap(map, { locale: 'en' })
    expect(v.title).toBe('ADHD')
    expect(v.notices).toEqual([])
    expect(v.caveats.map((c) => c.key)).toEqual(['machine_binding', 'sample_not_population', 'onsite_self_selected', 'self_reported', 'small_corpus'])
    expect(v.counts_text).toEqual(['On-site articles: 1', 'External works: only the most cited are shown (1), a sample, not the whole'])
    expect(v.footnotes).toEqual(['Source: Site (CC BY 4.0), retrieved 2026-09-29', 'Source: OpenAlex (CC0 1.0), retrieved 2026-09-29'])
    const onlyOnsite = presentEvidenceMap({ ...map, records: [onsite], onsite_only: true, external_match: 'unavailable', binding: null }, { locale: 'en' })
    expect(onlyOnsite.notices).toEqual([EVIDENCE_MESSAGES.en.external.unavailable, EVIDENCE_MESSAGES.en.text.onsite_only])
    expect(formatProvenance(onsite.provenance, { locale: 'zh' })).toBe('来源：Site（CC BY 4.0），取数于 2026-09-29')
  })
})

describe('共现图、入库问题、绑定候选、计数读口', () => {
  it('共现图：面积 ∝ 计数、强度用 lift、线宽用计数；折叠数写进图注', () => {
    const recs = [['a', 'b'], ['a', 'b'], ['a', 'c'], ['a', 'c'], ['a'], ['b', 'c'], ['b', 'c'], ['d']].map((t, i) =>
      intakeArticle({ id: String(i), title: 't', tags: t }, { retrieved_at: at }).record!)
    const v = presentTagGraph(buildTagGraph(recs, { retrieved_at: at }), { locale: 'en' })
    expect(v.nodes[0]).toMatchObject({ key: 'a', size: 1 })
    expect(v.nodes.find((n) => n.key === 'b')!.size).toBeCloseTo(Math.sqrt(4 / 5), 12)
    expect(Math.max(...v.edges.map((e) => e.strength))).toBe(1)
    expect(Math.max(...v.edges.map((e) => e.width))).toBe(1)
    expect(v.caption).toEqual(['Only tags and co-occurrences seen at least 2 times are drawn (articles: 8)', 'Below the threshold and not drawn: tags 1, co-occurrences 0'])
    expect(v.caveats.map((c) => c.key)).toContain('cooccurrence_not_citation')
  })
  it('入库问题给作者一句话', () => {
    const r = intakeArticle({ id: 'a', title: 't', effect: { metric: 'or', value: 1.2, ci_low: 1.5, ci_high: 2 } })
    expect(presentIntakeIssues(r.issues, { locale: 'zh' })).toEqual([
      { code: 'ci_excludes_estimate', field: 'effect.ci', action: 'field_cleared', text: '点估计不在置信区间内，区间已忽略。' },
    ])
  })
  it('绑定候选：两路证据分开写', () => {
    const [v] = presentBindingSuggestions([{
      topic_id: 'openalex:T1', display_name: 'Sleep', works_count: 1200, rank: 0, name_match: 'exact',
      cited: { works: 40, in_topic: 30, share: 0.75, ci_low: 0.6, ci_high: 0.86 },
    }], { locale: 'en' })
    expect(v).toEqual({
      topic_id: 'openalex:T1', display_name: 'Sleep', name_text: 'Same name', rank_text: 'Name search rank 1',
      cited_text: 'Citation evidence: of 40 works cited by articles with this tag, 30 have this as their primary topic (75%, 95% interval 60%–86%)',
      works_count_text: '1,200',
    })
  })
  it('计数读口：口径两个数都印', () => {
    const v = presentCounts({
      node: { id: 'openalex:T1', level: 'topic', display_name: 'ADHD' }, scope: 'primary_topic', total: 110442, other_scope_total: 180000,
      series: [series()], overlap: null,
      availability: { country: chartAvailability({ dimension: 'country', series: series(), overlap: null, hasCross: false }) } as never,
    }, { locale: 'en' })
    expect(v.scope_text).toBe('Scope: works with this as their primary topic, 110,442 in total')
    expect(v.other_scope_text).toBe('Works in the other scope: 180,000 (percentages depend on the scope)')
    expect(v.series[0].layer).toBe('external')
    expect(v.charts.country.find((i) => i.kind === 'upset')!.available).toBe(false)
    expect(v.onsite).toBeNull()
  })
})

describe('移动端可移植性', () => {
  it('运行环境没有 Intl 时照样出视图模型（简化的数字格式）', () => {
    jest.isolateModules(() => {
      const saved = globalThis.Intl
      try {
        // @ts-expect-error 模拟没有 Intl 的运行环境
        delete globalThis.Intl
        const { presentSeries: fresh } = require('../src/present') as typeof import('../src/present')
        const v = fresh(series(), { locale: 'en' })
        expect(v.rows[0].share_text).toBe('60%')
        expect(v.rows[0].count_text).toBe('60')
        expect(v.rows[0].label).toBe('United States') // 没有 DisplayNames：回落到原文
      } finally {
        globalThis.Intl = saved
      }
    })
  })
})

describe('编辑待办队列视图', () => {
  it('一行一个标签：文章数、读者现在看到什么、候选', async () => {
    const { presentBindingQueue } = await import('../src/present')
    const rows = presentBindingQueue([{
      tag_key: 'adhd', label: 'ADHD', articles: 12, external_match: 'needs_review', binding: null,
      candidate: { topic_id: 'openalex:T1', display_name: 'Attention Deficit Hyperactivity Disorder' },
    }], { locale: 'zh' })
    expect(rows).toEqual([{
      tag_key: 'adhd', label: 'ADHD', articles: 12, articles_text: '12 篇文章', badge: 'none',
      status_text: EVIDENCE_MESSAGES.zh.external.needs_review, candidate_text: '候选主题：Attention Deficit Hyperactivity Disorder',
    }])
  })
})

describe('⑦ 下钻（0.4.0）', () => {
  const P = { source_label: 'OpenAlex', license: 'CC0 1.0', retrieved_at: at }
  const node = (level: EvidenceTopic['level'], id: string, name: string, n: number | null, source: EvidenceTopic['source'] = 'openalex'): EvidenceTopic =>
    ({ id: `${source}:${id}`, source, external_id: id, level, display_name: name, description: null, parent_id: null, works_count: n })
  const work = (id: string, over: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
    id: `openalex:${id}`, source: 'openalex', external_id: id, title: `Work ${id}`, year: 2020, authors: ['A', 'B'], doi: null, url: `https://doi.org/10.1/${id}`,
    topic_ids: [], study_type: null, self_reported_claim: null, direction: null, effect: null, cited_by_count: 1234, is_retracted: false,
    is_open_access: false, provenance: P, ...over,
  })
  const base = (over: Partial<EvidenceMapData>): EvidenceMapData => ({
    level: 'topic', focus: node('topic', 'T1', 'Sleep', 900), parent: null, siblings: [], records: [],
    view: { kind: 'gap_map', usable: 0, total: 0, downgrade_reason: 'too_few' }, pooling: { allowed: false, reason: 'not_applicable', studies: 0 },
    sources: [], onsite_only: false, external_match: 'matched', binding: null, ...over,
  })

  it('往里一层：相对长度（不是占比）、按级出说法；没下发 ⇒ null；三种「没有」分开说', () => {
    const m = base({ level: 'field', focus: node('field', '27', 'Medicine', 5000), children: [node('subfield', '2738', 'Psychiatry', 800), node('subfield', '2701', 'Anatomy', 200), node('subfield', '9', 'X', null)] })
    const v = presentNodeChildren(m, { locale: 'zh' })!
    expect(v.title).toBe('往里一层：子领域（3 个）')
    expect(v.rows.map((r) => [r.label, r.count_text, r.size])).toEqual([['Psychiatry', '800 篇', 1], ['Anatomy', '200 篇', 0.25], ['X', null, null]])
    expect(v.notice).toBeNull()
    expect(v.caveats.map((c) => c.key)).toEqual(['multi_label'])
    expect(presentEvidenceMap(m, { locale: 'zh' }).children?.title).toBe(v.title)
    expect(isEvidenceMapData({ ...m, children: 'x' })).toBe(false)
    expect(isEvidenceMapData({ ...m, children: null })).toBe(true)
    expect(presentNodeChildren(base({}))).toBeNull()
    expect(presentEvidenceMap(base({})).children).toBeNull()
    expect(presentNodeChildren(base({ level: 'field', children: null }), { locale: 'en' })?.notice).toBe(EVIDENCE_MESSAGES.en.text.children_unavailable)
    expect(presentNodeChildren(base({ level: 'field', children: [node('subfield', '1', 'One', 3)], children_partial: true }), { locale: 'en' })?.notice)
      .toBe('The list is incomplete (1 shown); the rest could not be retrieved this time.')
    expect(presentNodeChildren(base({ level: 'subfield', children: [] }), { locale: 'zh' })?.notice).toBe(EVIDENCE_MESSAGES.zh.text.children_none)
    // 主题往里是站内标签：篇数写成站内文章数；没有绑定的标签另一句
    const tags = presentNodeChildren(base({ children: [node('tag', 'sleep', 'Sleep', 4, 'onsite')] }), { locale: 'zh' })!
    expect([tags.level_text, tags.rows[0].count_text, tags.caveats]).toEqual(['标签', '站内文章 4 篇', []])
    expect(presentNodeChildren(base({ children: [] }), { locale: 'zh' })?.notice).toBe(EVIDENCE_MESSAGES.zh.text.children_no_tags)
  })

  it('作品清单：期刊与类型、免费链接（没有已知的 ≠ 读不到）、别的主题不含焦点、同批引用、被引数只做参考', () => {
    const one = work('W1', {
      authors: ['A', 'B', 'C', 'D'], oa_url: 'https://repo.example/w1.pdf', is_open_access: true,
      venue: { id: 'openalex:S1', name: 'Journal One', type: 'journal', is_oa: true, issn_l: null, publisher: null },
      topics: [{ id: 'openalex:T1', display_name: 'Sleep' }, { id: 'openalex:T2', display_name: 'Insomnia' }],
    })
    const two = work('W2', { venue: { id: 'openalex:S2', name: 'Some Repo', type: 'repository', is_oa: null, issn_l: null, publisher: null } })
    const three = work('W3', { is_open_access: null, venue: { id: 'openalex:S3', name: 'Odd', type: 'newtype', is_oa: null, issn_l: null, publisher: null } })
    const onsite = intakeArticle({ id: 'a', title: 'Mine', tags: ['Sleep', 'stress', 'STRESS'], url: 'https://site.example/a' }, { retrieved_at: at, source_label: 'Site', license: 'CC BY 4.0' }).record!
    const m = base({
      records: [onsite, one, two, three],
      children: [node('tag', 'sleep', 'Sleep', 1, 'onsite')],
      edges: [{ from: 'openalex:W1', to: 'openalex:W2', kind: 'cites' }, { from: 'openalex:W3', to: 'openalex:W2', kind: 'cites' }, { from: 'onsite:a', to: 'openalex:W1', kind: 'shares_tag' }],
    })
    const [mine, w1, w2, w3] = presentWorks(m, { locale: 'zh' })
    expect(mine).toMatchObject({ layer: 'onsite', read_url: 'https://site.example/a', open: true, access_text: '在Site阅读', other_tags: ['stress'], citations_text: null, venue_text: null })
    expect(w1).toMatchObject({
      layer: 'external', authors_text: 'A、B、C 等', venue_text: 'Journal One（期刊） · 全刊开放获取', venue_id: 'openalex:S1',
      read_url: 'https://repo.example/w1.pdf', open: true, access_text: '可免费阅读', other_topics: [{ id: 'openalex:T2', label: 'Insomnia' }],
      cites: 1, cited_by: 0, links_text: '引用了这里的 1 篇', citations_text: '被引 1,234 次',
    })
    expect(w1.risk_of_bias.assessed).toBe(false)
    expect(w2).toMatchObject({ venue_text: 'Some Repo（知识库 / 预印本库）', read_url: null, open: false, access_text: '没有已知的免费版本', cites: 0, cited_by: 2, links_text: '被这里的 2 篇引用' })
    // 词典里没有的来源类型回落到原文；开放与否不知道就说不知道
    expect(w3).toMatchObject({ venue_text: 'Odd（newtype）', open: null, access_text: '不清楚有没有免费版本' })
    expect(presentWorks(m, { locale: 'en' })[1]).toMatchObject({ authors_text: 'A, B, C et al.', venue_text: 'Journal One (journal) · fully open access', access_text: 'Free to read', citations_text: 'Citations: 1,234' })
  })

  it('还挂着什么：只在这批里数、不列焦点（标签级还不列它绑到的主题）、按篇数排、多的折起来', () => {
    const t = (id: string) => ({ id: `openalex:${id}`, display_name: `Topic ${id}` })
    const v = (id: string) => ({ id: `openalex:${id}`, name: `Venue ${id}`, type: 'journal', is_oa: null, issn_l: null, publisher: null })
    const recs = [
      work('W1', { topics: [t('T1'), t('T2'), t('T3')], venue: v('S1') }),
      work('W2', { topics: [t('T2'), t('T2')], venue: v('S1') }),
      work('W3', { topics: [t('T3'), t('T4')], venue: v('S2') }),
    ]
    const onsite = ['x', 'y'].map((id, i) => intakeArticle({ id, title: id, tags: i === 0 ? ['Sleep', 'Stress'] : ['sleep', 'stress', 'Diet'] }, { retrieved_at: at, source_label: 'Site', license: 'CC BY 4.0' }).record!)
    const tagMap = base({
      level: 'tag', focus: node('tag', 'sleep', 'Sleep', 2, 'onsite'), records: [...onsite, ...recs],
      binding: { tag_key: 'sleep', topic_id: 'openalex:T1', topic_name: 'Topic T1', kind: 'curated', confidence: null, bound_at: at, bound_by: 'ed', note: null },
    })
    const f = presentRecordFacets(tagMap, { locale: 'zh', limit: 2 })
    // T1 是它绑到的主题，不列；W2 重复挂的 T2 只算一次
    expect(f.topics.rows.map((r) => [r.id, r.count, r.count_text])).toEqual([['openalex:T2', 2, '2 / 3 篇'], ['openalex:T3', 2, '2 / 3 篇']])
    expect([f.topics.more, f.topics.more_text, f.topics.base_text]).toEqual([1, '另有 1 个', '在被引最多的 3 篇外部作品里'])
    expect(f.tags.rows.map((r) => [r.id, r.label, r.count])).toEqual([['stress', 'Stress', 2], ['diet', 'Diet', 1]])
    expect(f.tags.base_text).toBe('在 2 篇站内文章里')
    expect(f.venues.rows.map((r) => [r.label, r.count])).toEqual([['Venue S1', 2], ['Venue S2', 1]])
    expect(f.caveats.map((c) => c.key)).toEqual(['sample_not_population', 'multi_label', 'primary_location_only'])
    // 主题级：焦点主题不列；没有外部作品时那两栏是空的，也不印「在 0 篇里」
    const topicMap = presentRecordFacets(base({ records: onsite }), { locale: 'en' })
    expect([topicMap.topics.rows, topicMap.topics.base_text, topicMap.venues.base_text]).toEqual([[], null, null])
    expect(topicMap.tags.base_text).toBe('Counted in on-site articles (2)')
    expect(topicMap.caveats.map((c) => c.key)).toEqual(['multi_label'])
  })

  // 0.5.0：一篇站内文章（申报了设计）引用两篇外部作品；外部作品之间有一条机器判读的、一条没说明的
  const purposeMap = () => base({
    records: [
      intakeArticle({ id: 'a', title: 'Mine', study_design: 'rct', tags: ['Sleep'] }, { retrieved_at: at, source_label: 'Site', license: 'CC BY 4.0' }).record!,
      work('W1', { publication_type: 'review' }), work('W2', { publication_type: 'preprint', cited_by_count: 50 }), work('W3', { publication_type: 'mystery', cited_by_count: null }),
    ],
    edges: [
      { from: 'onsite:a', to: 'openalex:W1', kind: 'cites', purpose: { functions: ['uses_method', 'confirms'], declared_by: 'author' } },
      { from: 'openalex:W2', to: 'openalex:W1', kind: 'cites', purpose: { functions: ['disputes'], declared_by: 'machine' } },
      { from: 'openalex:W3', to: 'openalex:W1', kind: 'cites' },
      // 线上来的坏用途（读口只验骨架）：认不出 ⇒ 当作没申报
      { from: 'onsite:a', to: 'openalex:W2', kind: 'cites', purpose: { functions: ['made_up'], declared_by: 'author' } as unknown as EvidenceCitationPurpose },
      { from: 'onsite:a', to: 'openalex:W3', kind: 'shares_tag' },
    ],
  })

  it('引用为什么引（0.5.0）：一条一句、谁标的；图例只列用到的；没申报的明说；坏用途当作没申报', () => {
    const v = presentCitations(purposeMap(), { locale: 'zh' })
    expect(v.links.map((l) => l.text)).toEqual([
      '《Mine》引用《Work W1》：用了它的方法或工具、结果与它一致（作者标注）',
      '《Work W2》引用《Work W1》：结果与它不一致或对它提出质疑（机器判读，未经人工核对）',
      '《Work W3》引用《Work W1》，没有说明为什么引用。',
      '《Mine》引用《Work W2》，没有说明为什么引用。',
    ])
    expect(v.links[0]).toMatchObject({ functions: ['uses_method', 'confirms'], labels: ['用了方法', '结果一致'], declared_by: 'author', declared_text: '作者标注' })
    expect(v.links[3]).toMatchObject({ functions: [], labels: [], declared_by: null, declared_text: null })
    expect(v.legend.map((r) => [r.function, r.label, r.count_text])).toEqual([['uses_method', '用了方法', '1 条'], ['confirms', '结果一致', '1 条'], ['disputes', '结果不一致', '1 条']])
    expect(v.legend[0].meaning).toBe(EVIDENCE_MESSAGES.zh.citation.meaning.uses_method)
    expect([v.undeclared, v.undeclared_text, v.machine_text]).toEqual([2, '2 条引用没有说明为什么引用（引擎不替作者猜）。', '有 1 条引用的用途是机器判读的，未经人工核对。'])
    expect(presentCitations(purposeMap(), { locale: 'en' }).links[0].text)
      .toBe('“Mine” cites “Work W1”: uses its method or tool, finds results consistent with it (marked by the author)')
    expect(presentCitations(base({}))).toEqual({ links: [], legend: [], undeclared: 0, undeclared_text: null, machine_text: null })
  })

  it('一篇文章的位置（0.5.0）：是什么研究、能回答什么；引用了谁、谁引用了它、推进了什么；只看这一批', () => {
    const m = purposeMap()
    const w1 = presentArticleContext(m, 'openalex:W1', { locale: 'zh' })!
    expect([w1.kind_text, w1.kind_hint]).toEqual(['文献类型：综述', EVIDENCE_MESSAGES.zh.publicationTypeMeaning.review])
    expect([w1.cites, w1.cited_by.map((l) => l.from)]).toEqual([[], ['onsite:a', 'openalex:W2', 'openalex:W3']])
    expect(w1.advances_text).toBe('这里引用它的 3 篇里：1 篇用了它的方法或工具、1 篇结果与它一致、1 篇结果与它不一致或对它提出质疑。')
    expect(w1.rank_text).toBe('被引 1,234 次，在这里列出的 2 篇外部作品里排第 1')
    expect(w1.notes).toEqual([
      '1 条引用没有说明为什么引用（引擎不替作者猜）。', '有 1 条引用的用途是机器判读的，未经人工核对。',
      EVIDENCE_MESSAGES.zh.text.ctx_overlap, // 「用了方法」「结果一致」是同一篇
      EVIDENCE_MESSAGES.zh.text.ctx_scope_note, EVIDENCE_MESSAGES.zh.text.ctx_citations_note,
    ])
    expect(w1.legend.map((r) => r.function)).toEqual(['uses_method', 'confirms', 'disputes'])
    const mine = presentArticleContext(m, 'onsite:a', { locale: 'zh' })!
    expect([mine.kind_text, mine.kind_hint, mine.rank_text, mine.advances_text, mine.topics_text])
      .toEqual(['研究设计：随机对照试验', EVIDENCE_MESSAGES.zh.studyDesignMeaning.rct, null, null, '它还涉及：#Sleep'])
    expect(mine.cites.map((l) => [l.to, l.labels])).toEqual([['openalex:W1', ['用了方法', '结果一致']], ['openalex:W2', []]])
    expect([mine.cites_title, mine.cited_by_title]).toEqual([EVIDENCE_MESSAGES.zh.text.ctx_cites_title, EVIDENCE_MESSAGES.zh.text.ctx_cited_by_title])
    expect(presentArticleContext(m, 'openalex:W1', { locale: 'en' })!.advances_text)
      .toBe('Works here that cite it: 3. What they do with it: uses its method or tool (1), finds results consistent with it (1), finds different results or questions it (1).')
    // 没有说明的形态不给说明；文献库没给被引数的不排名；不在这批里 ⇒ null
    const w3 = presentArticleContext(m, 'openalex:W3', { locale: 'en' })!
    expect([w3.kind_text, w3.kind_hint, w3.rank_text]).toEqual(['Type: mystery', null, null])
    expect(presentArticleContext(m, 'openalex:none')).toBeNull()
    // 写明了用途的排在前面
    const reordered = presentArticleContext({ ...m, edges: [...m.edges!].reverse() }, 'openalex:W1', { locale: 'zh' })!
    expect(reordered.cited_by.map((l) => l.from)).toEqual(['openalex:W2', 'onsite:a', 'openalex:W3'])
    const lonely = presentArticleContext(base({ records: [work('W9')] }), 'openalex:W9', { locale: 'en' })!
    expect(lonely.notes).toEqual([EVIDENCE_MESSAGES.en.text.ctx_none, EVIDENCE_MESSAGES.en.text.ctx_scope_note])
    // 作品清单上也有这两句：列表里就能看到它是什么研究
    expect(presentWorks(m, { locale: 'zh' }).map((w) => w.kind_text)).toEqual(['研究设计：随机对照试验', '文献类型：综述', '文献类型：预印本', '文献类型：mystery'])
    expect(presentWorks(m, { locale: 'en' }).map((w) => w.kind_label)).toEqual(['Randomised controlled trial', 'Review', 'Preprint', 'mystery'])
    expect(presentWorks(base({ records: [work('W8')] }))[0]).toMatchObject({ kind_label: null, kind_text: null, kind_hint: null })
  })
})

describe('⑧ 审阅门槛（0.4.0）', () => {
  const recs = ['a', 'b'].map((id) => intakeArticle({ id, title: id, tags: ['Sleep', 'Diet'] }, { retrieved_at: at, source_label: 'Site', license: 'CC BY 4.0' }).record!)
  it('研究图谱、站内层、共现图：有在等的才说一句', () => {
    const map: EvidenceMapData = {
      level: 'tag', focus: null, parent: null, siblings: [], records: recs, view: { kind: 'gap_map', usable: 2, total: 2, downgrade_reason: 'too_few' },
      pooling: { allowed: false, reason: 'not_applicable', studies: 0 }, sources: [], onsite_only: true,
    }
    expect(presentEvidenceMap({ ...map, onsite_pending: 3 }, { locale: 'zh' }).notices).toContain('另有 3 篇站内文章在等审阅，审阅之后才计入。')
    expect(presentEvidenceMap({ ...map, onsite_pending: 0 }, { locale: 'zh' }).notices.join('')).not.toContain('审阅')
    expect(presentEvidenceMap(map, { locale: 'en' }).notices.join('')).not.toContain('review')
    const layer = countOnsiteLayer(recs, { scope: { level: 'tag', id: 'onsite:sleep', display_name: 'Sleep', tag_keys: ['sleep'] }, retrieved_at: at })
    expect(presentOnsiteCounts({ ...layer, pending: 2 }, { locale: 'en' }).pending_text).toBe('On-site articles waiting for review, not counted yet: 2')
    expect(presentOnsiteCounts(layer).pending_text).toBeNull()
    const graph = buildTagGraph(recs, { minSupport: 1, retrieved_at: at })
    expect(presentTagGraph({ ...graph, pending: 1 }, { locale: 'zh' }).caption).toContain('另有 1 篇站内文章在等审阅，审阅之后才计入。')
    expect(presentTagGraph(graph, { locale: 'zh' }).caption.join('')).not.toContain('审阅')
  })
})
