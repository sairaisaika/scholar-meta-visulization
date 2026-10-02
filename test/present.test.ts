/**
 * 消费端：
 *   ① 词典：每个契约键在中英两份里都有非空的一句；两份模板的占位符集合相同；宿主可以只改几句；
 *   ② 百分比只用声明的分母（多标签维不用桶和）；分母 < 30 不给百分比；带 Wilson 区间；暂定年份印滞后图注；
 *   ③ 图种菜单：画不了的灰着并写明差什么；
 *   ④ 阶梯摘要、汇总估计的一句话；绑定徽章（机器绑定必带 machine_binding 图注）；
 *   ⑤ 研究图谱：外部层状态、只有站内、示例不代表全体、出处脚注；
 *   ⑥ 共现图：节点面积 ∝ 计数、边强度用 lift、线宽用计数；折叠数写进图注。
 */
import {
  EVIDENCE_MESSAGES, getMessages, mergeMessages, formatMessage, placeholders, BINDING_BADGES,
} from '../src/messages'
import type { EvidenceMessageCatalog } from '../src/messages'
import {
  presentSeries, presentChartMenu, presentView, presentBinding, presentEvidenceMap, presentTagGraph, presentIntakeIssues,
  presentBindingSuggestions, presentCounts, formatProvenance, effectDecimals,
} from '../src/present'
import {
  EVIDENCE_CAVEATS, EVIDENCE_CHART_BLOCKERS, EVIDENCE_CHART_KINDS, EVIDENCE_DOWNGRADE_REASONS, EVIDENCE_EXTERNAL_MATCHES,
  EVIDENCE_INTAKE_ISSUES, EVIDENCE_POOLING_REASONS, EVIDENCE_STUDY_DESIGNS, EVIDENCE_DIMENSION_IDS, ONSITE_DIMENSION_IDS,
  EVIDENCE_DENOMINATOR_KINDS, EVIDENCE_EFFECT_METRICS,
} from '../src/types'
import type { EvidenceCountSeries, EvidenceMapData, EvidenceRecord } from '../src/types'
import { chartAvailability } from '../src/charts'
import { buildTagGraph, intakeArticle } from '../src/onsite'
import { SHARE_RELIABILITIES } from '../src/stats'

const at = '2026-09-29T12:34:56.000Z'
const prov = { source_label: 'OpenAlex', license: 'CC0 1.0', query: '/works?filter=primary_topic.id:T1&group_by=authorships.countries', retrieved_at: at, credits: 1 }

describe('词典', () => {
  const sections: Array<[keyof EvidenceMessageCatalog, readonly string[]]> = [
    ['caveat', EVIDENCE_CAVEATS], ['blocker', EVIDENCE_CHART_BLOCKERS], ['chart', EVIDENCE_CHART_KINDS],
    ['downgrade', EVIDENCE_DOWNGRADE_REASONS], ['pooling', EVIDENCE_POOLING_REASONS], ['external', EVIDENCE_EXTERNAL_MATCHES],
    ['intake', EVIDENCE_INTAKE_ISSUES], ['studyDesign', EVIDENCE_STUDY_DESIGNS], ['binding', BINDING_BADGES],
    ['dimension', [...EVIDENCE_DIMENSION_IDS, ...ONSITE_DIMENSION_IDS]], ['denominator', EVIDENCE_DENOMINATOR_KINDS],
    ['metric', EVIDENCE_EFFECT_METRICS], ['reliability', SHARE_RELIABILITIES],
  ]
  it.each(Object.keys(EVIDENCE_MESSAGES))('%s：每个契约键都有非空的一句', (locale) => {
    const cat = EVIDENCE_MESSAGES[locale as 'zh' | 'en'] as unknown as Record<string, Record<string, string>>
    for (const [section, keys] of sections) {
      for (const k of keys) expect([section, k, (cat[section][k] ?? '').trim().length > 0]).toEqual([section, k, true])
    }
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
    expect(v.counts_text).toEqual(['1 on-site articles', 'External works show only the 1 most cited: a sample, not the whole'])
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
    expect(v.caption).toEqual(['Only tags and co-occurrences seen at least 2 times are drawn (8 articles)', '1 more tags and 0 more co-occurrences fall below the threshold and are not drawn'])
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
    expect(v.other_scope_text).toBe('The other scope gives 180,000 works (percentages depend on the scope)')
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
