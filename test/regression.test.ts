/**
 * 行为回归快照：固定输入走一遍主要入口，把输出钉进快照（`test/__snapshots__/regression.test.ts.snap`）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 别的测试各钉一条规则；这里钉的是「整体行为」——判据、文案、数字格式、验形、绑定、站内层、共现图、服务端到端。
 * 接入方升级时最怕的是「接口没变、结果悄悄变了」：这份快照一变，CI 当场红，改动的人必须
 *   ① 确认是有意的改动，`pnpm jest -u test/regression.test.ts` 更新快照并检查差异；
 *   ② 在 CHANGELOG 这一版里写明行为变了什么（CONTRIBUTING 第三节）。
 * 数字统一取 10 位有效数字再比（不同平台浮点末位的差别不算行为变化）。
 */
import { SCENARIOS } from '../demo/src/fixtures'
import { assessPooling, pickEvidenceView, poolEvidence } from '../src/ladder'
import { chartAvailabilityFor, type ChartShape } from '../src/charts'
import { intakeArticle } from '../src/onsite'
import { buildTagGraph, countOnsiteLayer } from '../src/onsite'
import { normalizeTag, pickMachineCandidate, resolveTagBinding } from '../src/tags'
import { presentEvidenceMap, presentRiskOfBiasSummary, presentView } from '../src/present'
import { poolRandomEffects, wilsonInterval } from '../src/stats'
import { createEvidenceService } from '../src/service'
import { createMemoryBindingStore, createMemoryCertaintySource, createMemoryOnsiteSource } from '../src/ports'
import type { ExternalEvidenceSource } from '../src/ports'
import type { EvidenceRecord, EvidenceTopic } from '../src/types'

/** 10 位有效数字：浮点末位的平台差异不算行为变化 */
const stable = <T>(x: T): T => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(10)) : v)))
const AT = '2026-10-01T00:00:00Z'

describe('行为回归快照', () => {
  it('证据阶梯与汇总：演示的六个场景（判定、估计、敏感性分析、中英文案）', () => {
    const out = SCENARIOS.map((s) => {
      const decision = pickEvidenceView(s.records)
      const pooling = poolEvidence(s.records)
      const text = (locale: string) => {
        const v = presentView(decision, pooling, { locale })
        return [v.title, v.usable_text, v.why_not_higher, v.pooling_text, v.estimate_text, v.sensitivity_text].filter((x) => x !== null).join(' | ')
      }
      return { id: s.id, decision, pooling: stable(pooling), zh: text('zh'), en: text('en'), rob: presentRiskOfBiasSummary(s.records, { locale: 'zh' }).text }
    })
    expect(out).toMatchSnapshot()
  })

  it('图种菜单：格子形状的网格（每行：形状 → 能画的图；画不了的写原因）', () => {
    const line = (shape: ChartShape) => {
      const tag = [
        shape.partition ? 'P' : 'm', `b${shape.buckets}`, shape.isYear ? 'Y' : '-', shape.hasCross ? 'X' : '-', shape.hasOverlap ? 'O' : '-',
        shape.onsite_n !== undefined ? `n${shape.onsite_n}` : '', shape.sampleOk !== undefined ? `gate:${shape.sampleOk}` : '',
      ].filter(Boolean).join(' ')
      const menu = chartAvailabilityFor(shape)
      const ok = menu.filter((m) => m.available).map((m) => m.kind).join(',')
      const no = menu.filter((m) => !m.available).map((m) => `${m.kind}:${m.blocker}`).join(',')
      return `${tag} → ✓ ${ok} ✗ ${no}`
    }
    const lines: string[] = []
    for (const partition of [true, false]) {
      for (const buckets of [0, 1, 3, 7, 13]) {
        for (const isYear of [false, true]) {
          for (const hasCross of [false, true]) {
            for (const hasOverlap of [false, true]) lines.push(line({ partition, buckets, isYear, hasCross, hasOverlap }))
          }
        }
      }
    }
    const site: ChartShape = { partition: true, buckets: 4, isYear: false, hasCross: false, hasOverlap: false }
    for (const extra of [{ onsite_n: 12 }, { onsite_n: 40 }, { sampleOk: false }, { onsite_n: 40, sampleOk: true }, { onsite_n: 40, sampleOk: false }]) {
      lines.push(line({ ...site, ...extra }))
    }
    expect(lines.join('\n')).toMatchSnapshot()
  })

  it('入库验形：一批脏数据（问题清单与入库后的关键字段）', () => {
    const articles: unknown[] = [
      { id: 1, title: 'ok', year: 2023, study_design: 'RCT', direction: 'favours', effect: { metric: 'smd', value: '0.30', ci_low: 0.1, ci_high: 0.5, n: '120', higher_is_better: true } },
      { id: 2, title: 'p and n only', direction: 'against', effect: { metric: 'smd', p_value: 0.2, n: 60 } },
      { id: 3, title: 'inverted ci', effect: { metric: 'or', value: 1.4, ci_low: 2, ci_high: 1.1 } },
      { id: 4, title: 'ratio ≤ 0', effect: { metric: 'rr', value: -1, p_value: 0.04, n: 30 } },
      { id: 5, title: 'ci without estimate', effect: { metric: 'md', ci_low: 1, ci_high: 3, n: 40 } },
      { id: 6, title: 'direction contradicts', direction: 'against', effect: { metric: 'smd', value: 0.5, ci_low: 0.2, ci_high: 0.8, higher_is_better: true } },
      { id: 7, title: 'claim vs ci', claim: 'significant', effect: { metric: 'smd', value: 0.2, ci_low: -0.1, ci_high: 0.5, p_value: 0.01 } },
      { id: 8, title: 'bad p and n', effect: { metric: 'smd', value: 0.1, p_value: 1.5, n: 12.5 } },
      { id: 9, title: 'unknown metric', effect: { metric: 'cohen', value: 0.4 } },
      { id: 10, title: 'rob ok', study_design: 'cohort', risk_of_bias: { tool: 'ROBINS-I', overall: 'Serious', source: 'Editor' } },
      { id: 11, title: 'rob wrong scale', risk_of_bias: { tool: 'rob2', overall: 'moderate', source: 'Editor' } },
      { id: 12, title: 'rob no source', risk_of_bias: { tool: 'rob2', overall: 'low' } },
      { id: 13, title: 'tags', tags: ['#ADHD', 'ＡＤＨＤ', 'Self-Esteem', '', 'x'.repeat(300)] },
      { id: 14, title: 'bad url and doi', url: 'javascript:alert(1)', doi: 'not a doi' },
      { id: 15, title: 'private', is_public: false },
      { id: 16, title: 'retracted', is_retracted: true },
      { title: 'no id' },
      { id: 18, title: 'bad year', year: 3001 },
    ]
    const out = articles.map((a) => {
      const r = intakeArticle(a, { retrieved_at: AT })
      const rec = r.record
      return {
        issues: r.issues.map((i) => `${i.code}@${i.field}:${i.action}`),
        record: rec && {
          id: rec.id, year: rec.year, url: rec.url, doi: rec.doi, study_type: rec.study_type, direction: rec.direction, claim: rec.self_reported_claim,
          effect: rec.effect, tags: rec.tags, risk_of_bias: rec.risk_of_bias ?? null,
        },
      }
    })
    expect(stable(out)).toMatchSnapshot()
  })

  it('标签：归一、挑机器候选、绑定结论', () => {
    const tags = ['ADHD', '#adhd', 'ＡＤＨＤ', 'Self_Esteem', 'self — esteem', 'COVID-19', '焦虑', '焦慮', '焦虑　症', '  ', 'a​dhd']
    const normalized = tags.map((t) => [t, normalizeTag(t)])
    const c = (name: string) => ({ topic_id: `openalex:${name.length}`, display_name: name })
    const picks = [
      pickMachineCandidate('adhd', [c('Attention Deficit Hyperactivity Disorder'), c('ADHD')]),
      pickMachineCandidate('app', [c('Plasma Diagnostics and Applications')]),
      pickMachineCandidate('sleep', []),
    ]
    const machine = { kind: 'matched' as const, topic_id: 'openalex:T1', display_name: 'Attention Deficit Hyperactivity Disorder' }
    const bindings = (['first_hit', 'exact_only', 'off'] as const).flatMap((policy) => [
      resolveTagBinding({ tagKey: 'adhd', machine, policy, at: AT }),
      resolveTagBinding({ tagKey: 'sleep', machine: { kind: 'matched', topic_id: 'openalex:T2', display_name: 'Sleep' }, policy, at: AT }),
      resolveTagBinding({ tagKey: 'x', machine: { kind: 'error' }, policy, at: AT }),
    ])
    expect({ normalized, picks, bindings }).toMatchSnapshot()
  })

  it('站内层与共现图：固定的一组站内记录', () => {
    const designs = ['rct', 'cohort', 'cross_sectional', null] as const
    const claims = ['significant', 'non_significant', null] as const
    const tagSets = [['ADHD', 'sleep'], ['adhd', 'anxiety'], ['Sleep', 'anxiety', 'ADHD'], ['sleep'], ['anxiety', 'stress'], ['ADHD', 'stress', 'sleep']]
    const records: EvidenceRecord[] = Array.from({ length: 36 }, (_, i) => ({
      id: `onsite:${i}`, source: 'onsite', external_id: String(i), title: `t${i}`, year: i % 5 === 0 ? null : 2015 + (i % 9), authors: [], doi: null, url: null,
      topic_ids: [], study_type: designs[i % 4], publication_type: i % 3 === 0 ? 'review' : 'article', self_reported_claim: claims[i % 3], direction: null,
      effect: null, cited_by_count: null, is_retracted: false, is_open_access: null,
      provenance: { source_label: 'Site', license: 'CC BY 4.0', retrieved_at: AT }, tags: tagSets[i % tagSets.length],
    }))
    const layer = countOnsiteLayer(records, {
      scope: { level: 'tag', id: 'onsite:adhd', display_name: 'ADHD', tag_keys: ['adhd'] }, retrieved_at: AT,
      dimensions: ['publication_year', 'study_type', 'self_reported_claim'], sampleGates: { self_reported_claim: 25, study_type: 1 }, graph: false,
    })
    const graph = buildTagGraph(records, { retrieved_at: AT, minSupport: 2 })
    expect(stable({ layer, graph })).toMatchSnapshot()
  })

  it('统计：Wilson 区间与随机效应汇总（REML + HKSJ），固定输入', () => {
    const wilson = [[0, 10], [3, 10], [10, 10], [17, 40], [250, 1000]].map(([k, n]) => [k, n, wilsonInterval(k, n)])
    const pooled = poolRandomEffects([
      { y: 0.62, v: 0.0266 }, { y: 0.10, v: 0.0219 }, { y: 0.55, v: 0.0356 }, { y: 0.28, v: 0.0204 }, { y: 0.05, v: 0.0376 }, { y: 0.33, v: 0.0219 },
    ])
    const refusals = [assessPooling([]), assessPooling(SCENARIOS.find((s) => s.id === 'mixed')!.records)]
    expect(stable({ wilson, pooled, refusals })).toMatchSnapshot()
  })

  it('服务端到端：标签研究图谱（站内 + 外部示例 + 绑定 + 评级），及其中文视图模型', async () => {
    const topic = (level: EvidenceTopic['level'], id: string, name: string, parent: string | null = null): EvidenceTopic =>
      ({ id: `openalex:${id}`, source: 'openalex', external_id: id, level, display_name: name, description: null, parent_id: parent, works_count: 100 })
    const ext: ExternalEvidenceSource = {
      id: 'openalex',
      async suggestTopics() { return [{ topic_id: 'openalex:T7', display_name: 'Sleep disorders in children', works_count: 9 }, { topic_id: 'openalex:T8', display_name: 'Sleep', works_count: 30 }] },
      async nodeBundle(_level, id) { return { node: topic('topic', id, 'Sleep', 'openalex:2802'), ancestors: [topic('subfield', '2802', 'Neurology')], siblings: [topic('topic', 'T9', 'Insomnia')] } },
      async sampleWorks() {
        return [{ id: 'openalex:W1', source: 'openalex', external_id: 'W1', title: 'External', year: 2021, authors: [], doi: null, url: null, topic_ids: ['openalex:T8'],
          study_type: null, publication_type: 'article', self_reported_claim: null, direction: null, effect: null, cited_by_count: 50, is_retracted: false, is_open_access: true,
          provenance: { source_label: 'OpenAlex', license: 'CC0 1.0', retrieved_at: AT } }]
      },
    }
    const articles = [
      { id: 1, title: 'A', tags: ['Sleep'], year: 2024, study_design: 'rct', direction: 'favours', effect: { metric: 'smd', value: 0.4, ci_low: 0.1, ci_high: 0.7, n: 90, higher_is_better: true },
        risk_of_bias: { tool: 'rob2', overall: 'some_concerns', source: 'Editor' }, references: ['10.1000/a'] },
      { id: 2, title: 'B', tags: ['sleep', 'stress'], year: 2023, study_design: 'cohort', claim: 'significant' },
    ]
    const service = createEvidenceService({
      onsite: createMemoryOnsiteSource(articles), external: ext, bindings: createMemoryBindingStore(),
      certainty: createMemoryCertaintySource([{ scope: { level: 'tag', id: 'sleep' }, certainty: { level: 'low', outcome: 'Sleep quality', source: 'Review X', rated_down_for: ['imprecision'] } }]),
      now: () => new Date(AT), log: () => {}, onsiteLabel: 'Site', onsiteLicense: 'CC BY 4.0',
    })
    const r = await service.getTagMap('SLEEP')
    if (!r.ok) throw new Error(r.error)
    const view = presentEvidenceMap(r.data, { locale: 'zh' })
    expect(stable({ data: r.data, view })).toMatchSnapshot()
  })
})
