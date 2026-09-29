/**
 * 证据视图阶梯——钉五件：
 *   ① 阶梯顺序与契约常量同源，加视图不许只改一边；
 *   ② 手上有什么数据就选到哪一级，且说得出「为什么不是更高的那一级」；
 *   ③ 按「显著/不显著」投票计数不构成任何一级（Cochrane 12.2.2.1 判定其无效）——
 *      只有作者自报结果类型时必须落 gap_map、降级原因 no_direction；
 *   ④ 汇总菱形默认不画：度量不一致 / 缺方差 / 不足 5 条都要给出理由，不许悄悄不画；
 *   ⑤ 被引数等文献计量永不出现在效应量轴上（源码钉）；
 *   ⑥ 0.2.0：信天翁级真的要求精确 p；汇总还要求同一结局方向、同一研究设计；能汇总时连数一起算（与 scipy 对过）。
 */
import { readFileSync } from 'node:fs'
import { pickEvidenceView, assessPooling, poolEvidence, viewLadderMatchesContract, EVIDENCE_VIEWS, MIN_STUDIES_FOR_POOLING } from '../src/ladder'
import { EVIDENCE_VIEW_LADDER, NEVER_AS_EFFECT_AXIS } from '../src/types'
import type { EvidenceRecord } from '../src/types'

const base = (over: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  id: 'openalex:W1', source: 'openalex', external_id: 'W1', title: 't', year: 2024, authors: [], doi: null, url: null,
  topic_ids: [], study_type: null, self_reported_claim: null, direction: null, effect: null,
  cited_by_count: 120, is_retracted: false, is_open_access: null,
  provenance: { source_label: 'OpenAlex', license: 'CC0', retrieved_at: '2026-09-22T00:00:00Z' },
  ...over,
})
const eff = (over: Partial<NonNullable<EvidenceRecord['effect']>> = {}) => ({
  metric: 'smd' as const, value: -0.42, ci_low: -0.61, ci_high: -0.23, n: 120, higher_is_better: false, ...over,
})

describe('证据视图阶梯', () => {
  it('① 阶梯顺序与契约常量同源', () => {
    expect(viewLadderMatchesContract()).toBe(true)
    expect(EVIDENCE_VIEWS.map((v) => v.kind)).toEqual([...EVIDENCE_VIEW_LADDER])
  })

  it('② 有点估计 + CI ⇒ forest，且已是最高级（无降级原因）', () => {
    const d = pickEvidenceView([base({ effect: eff() }), base({ id: 'openalex:W2', effect: eff({ value: -0.1 }) })])
    expect(d.kind).toBe('forest')
    expect(d.usable).toBe(2)
    expect(d.downgrade_reason).toBeNull()
  })

  it('② 有点估计无 CI ⇒ estimates，降级原因 no_variance', () => {
    const d = pickEvidenceView([base({ effect: eff({ ci_low: null, ci_high: null }) })])
    expect(d.kind).toBe('estimates')
    expect(d.downgrade_reason).toBe('no_variance')
  })

  it('② 只有方向 ⇒ direction，降级原因 no_p_or_n；有点估计时先落 estimates', () => {
    expect(pickEvidenceView([base({ direction: 'favours' })]).kind).toBe('direction')
    expect(pickEvidenceView([base({ direction: 'favours' })]).downgrade_reason).toBe('no_p_or_n')
    const withN = [
      base({ direction: 'favours', effect: eff({ value: 0, ci_low: null, ci_high: null, n: 80 }) }),
      base({ id: 'openalex:W2', direction: 'against', effect: eff({ value: 0, ci_low: null, ci_high: null, n: 50 }) }),
    ]
    // 有点估计（value 有限）⇒ 先落 estimates；这正是「取最高可用」的表现
    expect(pickEvidenceView(withN).kind).toBe('estimates')
  })

  it('③ 只有作者自报的显著性 ⇒ gap_map（投票计数不构成任何一级），降级原因 no_direction', () => {
    const onsite = [
      base({ id: 'onsite:a1', source: 'onsite', self_reported_claim: 'significant', cited_by_count: null }),
      base({ id: 'onsite:a2', source: 'onsite', self_reported_claim: 'non_significant', cited_by_count: null }),
      base({ id: 'onsite:a3', source: 'onsite', self_reported_claim: 'mixed', cited_by_count: null }),
    ]
    const d = pickEvidenceView(onsite)
    expect(d.kind).toBe('gap_map')
    expect(d.downgrade_reason).toBe('no_direction')
    expect(d.total).toBe(3)
  })

  it('③ 空集也要给得出答案（不许抛，读图不该因为判据兜底整页崩）', () => {
    const d = pickEvidenceView([])
    expect(d.kind).toBe('gap_map')
    expect(d.total).toBe(0)
  })

  it('④ 汇总菱形默认不画：度量混排 / 缺方差 / 不足 5 条各有理由', () => {
    expect(assessPooling([])).toEqual({ allowed: false, reason: 'not_applicable', studies: 0 })
    expect(assessPooling([base({ effect: eff() }), base({ id: 'x', effect: eff({ metric: 'or', value: 1.2 }) })]).reason).toBe('mixed_metrics')
    expect(assessPooling([base({ effect: eff() }), base({ id: 'x', effect: eff({ ci_low: null, ci_high: null }) })]).reason).toBe('no_variance')
    const four = Array.from({ length: 4 }, (_, i) => base({ id: `w${i}`, effect: eff() }))
    expect(assessPooling(four)).toEqual({ allowed: false, reason: 'too_few_studies', studies: 4 })
    const five = Array.from({ length: MIN_STUDIES_FOR_POOLING }, (_, i) => base({ id: `w${i}`, effect: eff() }))
    expect(assessPooling(five)).toEqual({ allowed: true, reason: 'ok', studies: 5 })
  })

  it('⑤ 文献计量永不当效应量轴：阶梯判据里不出现被引类字段', () => {
    const src = readFileSync(`${__dirname}/../src/ladder.ts`, 'utf8')
    const judge = src.slice(src.indexOf('const hasEffect'), src.indexOf('export function viewLadderMatchesContract'))
    for (const banned of NEVER_AS_EFFECT_AXIS) {
      expect(judge).not.toMatch(new RegExp(`\\b${banned}\\b`))
    }
    expect(NEVER_AS_EFFECT_AXIS).toContain('cited_by_count')
  })

  it('⑥ 信天翁：方向 + 样本量 + **精确 p** 才够；缺 p 落 direction', () => {
    const noValue = (p: number | null, n: number) => eff({ value: NaN, ci_low: null, ci_high: null, n, p_value: p })
    const withP = [
      base({ direction: 'favours', effect: noValue(0.03, 80) }),
      base({ id: 'openalex:W2', direction: 'against', effect: noValue(0.4, 50) }),
    ]
    expect(pickEvidenceView(withP)).toEqual({ kind: 'albatross', usable: 2, total: 2, downgrade_reason: 'no_effect_sizes' })
    const noP = withP.map((r) => ({ ...r, effect: { ...r.effect!, p_value: null } }))
    expect(pickEvidenceView(noP).kind).toBe('direction')
  })

  it('⑥ 汇总：结局方向没申报齐 / 不一致 ⇒ orientation_unclear；设计不一致 ⇒ mixed_designs；度量未知 ⇒ mixed_metrics', () => {
    const five = (over: (i: number) => Partial<EvidenceRecord>) =>
      Array.from({ length: 5 }, (_, i) => base({ id: `w${i}`, effect: eff(), ...over(i) }))
    expect(assessPooling(five((i) => ({ effect: eff({ higher_is_better: i === 0 ? true : false }) }))).reason).toBe('orientation_unclear')
    expect(assessPooling(five((i) => ({ effect: eff({ higher_is_better: i === 0 ? null : false }) }))).reason).toBe('orientation_unclear')
    expect(assessPooling(five((i) => ({ study_type: i === 0 ? 'cohort' : 'rct' }))).reason).toBe('mixed_designs')
    expect(assessPooling(five(() => ({ study_type: 'rct' }))).allowed).toBe(true)
    expect(assessPooling(five(() => ({ effect: eff({ metric: 'other' }) }))).reason).toBe('mixed_metrics')
  })

  it('⑥ 能汇总时连数一起算：OR 在对数尺度汇总再取指数（REML + HKSJ + t(k−2) 预测区间，与 scipy 对过）', () => {
    const ors: Array<[number, number, number]> = [[1.5, 1.1, 2.05], [0.9, 0.6, 1.35], [2.1, 1.3, 3.4], [1.2, 0.95, 1.52], [1.8, 1.2, 2.7]]
    const recs = ors.map(([v, l, h], i) => base({ id: `w${i}`, effect: eff({ metric: 'or', value: v, ci_low: l, ci_high: h, higher_is_better: false }) }))
    const p = poolEvidence(recs)
    expect(p.allowed).toBe(true)
    const e = p.estimate!
    expect(e.method).toBe('reml_hksj')
    expect(e.metric).toBe('or')
    expect(e.k).toBe(5)
    expect(e.estimate).toBeCloseTo(1.4058620580433447, 7)
    expect(e.ci_low).toBeCloseTo(0.949290446422556, 6)
    expect(e.ci_high).toBeCloseTo(2.0820267745179604, 6)
    expect(e.pi_low).toBeCloseTo(0.5880305085055628, 6)
    expect(e.pi_high).toBeCloseTo(3.3611319441041743, 6)
    expect(e.i2).toBeCloseTo(0.6162611193422948, 9)
    expect(e.df).toBe(4)
  })

  it('⑥ 不能汇总时 estimate 为 null；判据不变', () => {
    expect(poolEvidence([base({ effect: eff() })])).toEqual({ allowed: false, reason: 'too_few_studies', studies: 1, estimate: null })
  })

  it('⑥ 缺 higher_is_better 字段（旧记录 / 外部构造的记录）＝没申报，不能汇总', () => {
    const noOrientation = Array.from({ length: 5 }, (_, i) => {
      const { higher_is_better: _drop, ...e } = eff()
      return base({ id: `w${i}`, effect: e as unknown as NonNullable<EvidenceRecord['effect']> })
    })
    expect(assessPooling(noOrientation).reason).toBe('orientation_unclear')
  })
})
