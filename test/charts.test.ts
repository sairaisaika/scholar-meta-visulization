/**
 * 图种可用性：
 *   ① 只给格子（外部计数）时，记录级四张图恒灰并写明差什么——与 0.1 行为一致；
 *   ② 给了记录时，四张图与阶梯同判（森林 ↔ forest 级、信天翁 ↔ albatross 级、收获 ↔ direction 级）；
 *   ③ 阳性率要 ≥ 30 篇自报了结果类型的文章（与比例门槛同一个数）；
 *   ④ 缺口图的交叉对可换（站内层是 标签 × 研究设计）；注册表与契约同源；
 *   ⑤ 按形状判（chartAvailabilityFor）：chartAvailability 是它的薄包装，与改写前的实现在整张网格上逐项相同；
 *      接入方自己的维度按形状判，不必冒充已有维度；站内篇数不到比例门槛时读占比的四张图回 needs_more_onsite。
 */
import {
  chartAvailability, chartAvailabilityFor, chartShapeOf, chartsMatchContract, MIN_CLAIMS_FOR_POSITIVE_RATE, MIN_ONSITE_FOR_SHARE_CHARTS,
} from '../src/charts'
import type { ChartContext, ChartShape } from '../src/charts'
import { EGM_PAIR } from '../src/dimensions'
import { EVIDENCE_VIEWS } from '../src/ladder'
import { countOnsiteLayer } from '../src/onsite'
import { EVIDENCE_CHART_KINDS, EVIDENCE_DIMENSION_IDS, ONSITE_DIMENSION_IDS } from '../src/types'
import type { EvidenceChartAvailability, EvidenceChartBlocker, EvidenceChartKind, EvidenceCountSeries, EvidenceRecord, EvidenceViewKind } from '../src/types'

const series = (partition: boolean, n: number): EvidenceCountSeries => ({
  dimension: 'language',
  cells: Array.from({ length: n }, (_, i) => ({ key: `k${i}`, label: `k${i}`, count: i + 1 })),
  denominator: { kind: 'works_with_value', value: 100 },
  partition,
  unknown: partition ? 0 : null,
  provenance: { source_label: 'OpenAlex', license: 'CC0 1.0', query: '/works', retrieved_at: '2026-09-29T00:00:00Z', credits: 1 },
})
const blockers = (c: ChartContext) =>
  Object.fromEntries(chartAvailability(c).map((a) => [a.kind, a.blocker])) as Record<EvidenceChartKind, EvidenceChartBlocker | null>
const rec = (over: Partial<EvidenceRecord>): EvidenceRecord => ({
  id: 'onsite:x', source: 'onsite', external_id: 'x', title: 't', year: 2024, authors: [], doi: null, url: null, topic_ids: [],
  study_type: null, self_reported_claim: null, direction: null, effect: null, cited_by_count: null, is_retracted: false,
  is_open_access: null, provenance: { source_label: 's', license: 'l', retrieved_at: '2026-09-29T00:00:00Z' }, ...over,
})

describe('图种可用性', () => {
  it('① 只有格子：记录级四张恒灰，写明差什么', () => {
    const b = blockers({ dimension: 'language', series: series(true, 6), overlap: null, hasCross: false })
    expect([b.positive_rate, b.harvest, b.albatross, b.forest]).toEqual(['needs_onsite_significance', 'needs_direction', 'needs_exact_p', 'needs_effect_size'])
    expect([b.bar, b.pie, b.lorenz, b.timeseries, b.egm]).toEqual([null, null, null, 'needs_year', 'needs_cross'])
  })
  it('多标签维禁饼图 / 华夫 / 树图 / 洛伦兹', () => {
    const b = blockers({ dimension: 'country', series: { ...series(false, 6), dimension: 'country' }, overlap: null, hasCross: false })
    expect([b.pie, b.waffle, b.treemap, b.lorenz]).toEqual(['needs_partition', 'needs_partition', 'needs_partition', 'needs_partition'])
  })
  it('② 给了记录：与阶梯同判', () => {
    const effect = { metric: 'smd' as const, value: -0.3, ci_low: -0.5, ci_high: -0.1, n: 80, higher_is_better: false, p_value: 0.004 }
    const records = [rec({ direction: 'favours', effect }), rec({ id: 'onsite:y', direction: 'favours', effect })]
    const b = blockers({ dimension: 'tag', series: undefined, overlap: null, hasCross: false, records })
    expect([b.forest, b.albatross, b.harvest]).toEqual([null, null, null])
    const onlyDirection = blockers({ dimension: 'tag', series: undefined, overlap: null, hasCross: false, records: [rec({ direction: 'against' })] })
    expect([onlyDirection.forest, onlyDirection.albatross, onlyDirection.harvest]).toEqual(['needs_effect_size', 'needs_exact_p', null])
  })
  it('③ 阳性率门槛', () => {
    const claims = (n: number) => Array.from({ length: n }, (_, i) => rec({ id: `onsite:${i}`, self_reported_claim: i % 2 ? 'significant' : 'non_significant' }))
    const ctx = (records: EvidenceRecord[]): ChartContext => ({ dimension: 'self_reported_claim', series: undefined, overlap: null, hasCross: false, records })
    expect(blockers(ctx(claims(MIN_CLAIMS_FOR_POSITIVE_RATE - 1))).positive_rate).toBe('needs_onsite_significance')
    expect(blockers(ctx(claims(MIN_CLAIMS_FOR_POSITIVE_RATE))).positive_rate).toBeNull()
    // not_applicable 不算「报了结果类型」
    const na = Array.from({ length: 40 }, (_, i) => rec({ id: `onsite:${i}`, self_reported_claim: 'not_applicable' }))
    expect(blockers(ctx(na)).positive_rate).toBe('needs_onsite_significance')
  })
  it('④ 缺口图交叉对可换；注册表与契约同源', () => {
    const onsiteEgm = blockers({ dimension: 'tag', series: undefined, overlap: null, hasCross: true, egmPair: { rows: 'tag', cols: 'study_type' } })
    expect(onsiteEgm.egm).toBeNull()
    expect(blockers({ dimension: 'tag', series: undefined, overlap: null, hasCross: true }).egm).toBe('needs_cross')
    expect(chartsMatchContract()).toBe(true)
  })
})

/** 改写成「按形状判」之前的实现，原样冻结在这里当参照（不给 records / egmPair 时就是 0.1 的行为）。 */
function legacyChartAvailability(c: ChartContext): EvidenceChartAvailability[] {
  const cells = c.series?.cells.filter((x) => x.count > 0).length ?? 0
  const ladderSupports = (kind: EvidenceViewKind) => {
    if (!c.records) return false
    const spec = EVIDENCE_VIEWS.find((v) => v.kind === kind)
    if (!spec) return false
    return c.records.filter(spec.accepts).length >= Math.max(1, spec.minRecords)
  }
  const claimCount = (records: readonly EvidenceRecord[]) =>
    records.filter((r) => r.self_reported_claim === 'significant' || r.self_reported_claim === 'non_significant' || r.self_reported_claim === 'mixed').length
  const pair = c.egmPair ?? EGM_PAIR
  const rules: Record<EvidenceChartKind, EvidenceChartBlocker | null> = {
    nodes: null,
    list: null,
    bar: cells > 0 ? null : 'too_few_buckets',
    timeseries: c.dimension === 'publication_year' ? null : 'needs_year',
    waffle: c.series?.partition ? (cells > 0 ? null : 'too_few_buckets') : 'needs_partition',
    treemap: !c.series?.partition ? 'needs_partition' : cells < 3 ? 'too_few_buckets' : null,
    upset: c.overlap && c.overlap.dimension === c.dimension ? null : 'needs_overlap',
    lorenz: !c.series?.partition ? 'needs_partition' : cells < 5 ? 'too_few_buckets' : null,
    egm: c.hasCross && (c.dimension === pair.rows || c.dimension === pair.cols) ? null : 'needs_cross',
    pie: !c.series?.partition ? 'needs_partition' : cells > 8 ? 'too_many_buckets' : cells > 0 ? null : 'too_few_buckets',
    positive_rate: c.records && claimCount(c.records) >= 30 ? null : 'needs_onsite_significance',
    harvest: ladderSupports('direction') ? null : 'needs_direction',
    albatross: ladderSupports('albatross') ? null : 'needs_exact_p',
    forest: ladderSupports('forest') ? null : 'needs_effect_size',
  }
  return EVIDENCE_CHART_KINDS.map((kind) => ({ kind, available: rules[kind] === null, blocker: rules[kind] }))
}

describe('⑤ 按形状判', () => {
  const effect = { metric: 'smd' as const, value: -0.3, ci_low: -0.5, ci_high: -0.1, n: 80, higher_is_better: false, p_value: 0.004 }
  const recordSets: Array<EvidenceRecord[] | undefined> = [
    undefined,
    [],
    [rec({ direction: 'against' })],
    Array.from({ length: 35 }, (_, i) => rec({
      id: `onsite:${i}`, self_reported_claim: i % 3 === 0 ? 'mixed' : 'significant', direction: 'favours', ...(i % 2 ? { effect } : {}),
    })),
  ]
  it('chartAvailability 与改写前的实现在整张网格上逐项相同', () => {
    const dims = [...EVIDENCE_DIMENSION_IDS, ...ONSITE_DIMENSION_IDS]
    const seriesVariants: Array<EvidenceCountSeries<string> | undefined> = [undefined]
    for (const partition of [true, false]) {
      for (let n = 0; n <= 10; n++) {
        const s = series(partition, n)
        seriesVariants.push({ ...s, cells: [...s.cells, { key: 'zero', label: 'zero', count: 0 }] })
      }
    }
    let checked = 0
    for (const dimension of dims) {
      for (const sv of seriesVariants) {
        for (const overlapDim of [null, dimension, 'institution_type']) {
          for (const hasCross of [false, true]) {
            for (const egmPair of [undefined, { rows: 'tag', cols: 'study_type' }, { rows: dimension, cols: 'x' }]) {
              for (const records of recordSets) {
                const c: ChartContext = {
                  dimension, series: sv, hasCross,
                  overlap: overlapDim === null ? null : { dimension: overlapDim, sets: [], pairs: [], provenance: sv?.provenance ?? series(true, 1).provenance },
                  ...(egmPair ? { egmPair } : {}), ...(records ? { records } : {}),
                }
                expect(chartAvailability(c)).toEqual(legacyChartAvailability(c))
                checked++
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(20000)
  })
  it('接入方自己的维度：说清形状就能判，不必冒充已有维度', () => {
    const shape: ChartShape = { partition: true, buckets: 4, isYear: false, hasCross: false, hasOverlap: false, onsite_n: 42 }
    const b = Object.fromEntries(chartAvailabilityFor(shape).map((a) => [a.kind, a.blocker]))
    expect([b.bar, b.pie, b.waffle, b.treemap, b.lorenz, b.timeseries, b.upset, b.egm])
      .toEqual([null, null, null, null, 'too_few_buckets', 'needs_year', 'needs_overlap', 'needs_cross'])
    expect(chartShapeOf({ dimension: 'publication_year', series: series(true, 3), overlap: null, hasCross: false }))
      .toEqual({ partition: true, buckets: 3, isYear: true, hasCross: false, hasOverlap: false })
  })
  it('needs_more_onsite：只挡读占比的四张；形状上的毛病先报；篇数不是有限数也挡', () => {
    const at = (onsite_n: number | undefined, over: Partial<ChartShape> = {}) =>
      Object.fromEntries(chartAvailabilityFor({ partition: true, buckets: 6, isYear: true, hasCross: true, hasOverlap: true, onsite_n, ...over }).map((a) => [a.kind, a.blocker]))
    const small = at(MIN_ONSITE_FOR_SHARE_CHARTS - 1)
    expect([small.pie, small.waffle, small.treemap, small.lorenz]).toEqual(['needs_more_onsite', 'needs_more_onsite', 'needs_more_onsite', 'needs_more_onsite'])
    expect([small.bar, small.timeseries, small.upset, small.egm]).toEqual([null, null, null, null])
    const enough = at(MIN_ONSITE_FOR_SHARE_CHARTS)
    expect([enough.pie, enough.waffle, enough.treemap, enough.lorenz]).toEqual([null, null, null, null])
    expect(at(undefined).pie).toBeNull() // 不是站内格子：不看篇数
    expect(at(3, { partition: false }).pie).toBe('needs_partition')
    expect(at(3, { buckets: 12 }).pie).toBe('too_many_buckets')
    expect(at(Number.NaN).pie).toBe('needs_more_onsite')
  })
  it('接入方的样本门 sampleOk: false：主题图与清单照常；形状上能画的回 needs_more_onsite；形状上画不了的照报原因', () => {
    const at = (sampleOk: boolean | undefined) =>
      Object.fromEntries(chartAvailabilityFor({ partition: true, buckets: 3, isYear: false, hasCross: false, hasOverlap: false, sampleOk }).map((a) => [a.kind, a.blocker]))
    const closed = at(false)
    expect([closed.nodes, closed.list]).toEqual([null, null])
    expect([closed.bar, closed.pie, closed.waffle, closed.treemap]).toEqual(['needs_more_onsite', 'needs_more_onsite', 'needs_more_onsite', 'needs_more_onsite'])
    expect([closed.timeseries, closed.upset, closed.egm, closed.lorenz]).toEqual(['needs_year', 'needs_overlap', 'needs_cross', 'too_few_buckets'])
    expect(at(true)).toEqual(at(undefined))
    expect(at(true).bar).toBeNull()
  })
  it('站内层：文章不到门槛时读占比的图回 needs_more_onsite，条形图照画', () => {
    const records = Array.from({ length: 12 }, (_, i) => rec({ id: `onsite:${i}`, year: 2020 + (i % 4), tags: ['ADHD'], study_type: i % 2 ? 'rct' : 'cross_sectional' }))
    const layer = countOnsiteLayer(records, { scope: { level: 'tag', id: 'onsite:adhd', display_name: 'ADHD', tag_keys: ['adhd'] }, retrieved_at: '2026-09-29T00:00:00Z', graph: false })
    const year = Object.fromEntries(layer.availability.publication_year.map((a) => [a.kind, a.blocker]))
    expect([year.bar, year.timeseries, year.pie]).toEqual([null, null, 'needs_more_onsite'])
  })
})
