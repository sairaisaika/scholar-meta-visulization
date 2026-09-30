/**
 * 演示页的每个场景都要真的落在它声称的那一级：引擎判据一改，演示对不上就红（演示不许替引擎说它没说过的话）。
 */
import { SCENARIOS } from '../demo/src/fixtures'
import { pickEvidenceView, poolEvidence } from '../src/ladder'
import { chartAvailabilityFor } from '../src/charts'
import { intakeArticle } from '../src/onsite'

describe('演示场景', () => {
  it.each(SCENARIOS.map((s) => [s.id, s] as const))('%s：阶梯的级别、降级原因、能否汇总都与声称的一致', (_id, s) => {
    const decision = pickEvidenceView(s.records)
    const pooling = poolEvidence(s.records)
    expect({ kind: decision.kind, downgrade: decision.downgrade_reason, pooling: pooling.reason }).toEqual(s.expect)
    expect(decision.usable).toBeGreaterThan(0)
  })
  it('能汇总的场景真的算出了估计（菱形有数可画）', () => {
    const pooled = SCENARIOS.find((s) => s.id === 'pooled')!
    const e = poolEvidence(pooled.records).estimate
    expect(e).not.toBeNull()
    expect(e!.ci_low).toBeLessThan(e!.estimate)
    expect(e!.pi_high).toBeGreaterThanOrEqual(e!.ci_high)
  })
  it('图种菜单里记录级的图与阶梯同判：带上场景的记录，森林 / 信天翁 / 收获图的开关与阶梯一致', () => {
    const at = (id: string) => {
      const s = SCENARIOS.find((x) => x.id === id)!
      const menu = chartAvailabilityFor({ partition: true, buckets: 3, isYear: false, hasCross: false, hasOverlap: false, records: s.records })
      return Object.fromEntries(menu.filter((m) => ['forest', 'albatross', 'harvest'].includes(m.kind)).map((m) => [m.kind, m.available]))
    }
    expect(at('pooled')).toEqual({ harvest: true, albatross: false, forest: true })
    expect(at('albatross')).toEqual({ harvest: true, albatross: true, forest: false })
    expect(at('claims')).toEqual({ harvest: false, albatross: false, forest: false })
  })
  it('演示用的研究设计与效应量都过得了入库验形（不是引擎不认的写法）', () => {
    for (const s of SCENARIOS) {
      for (const r of s.records) {
        const hasValue = !!r.effect && Number.isFinite(r.effect.value)
        const res = intakeArticle({
          id: r.external_id, title: 'demo', tags: ['demo'], is_public: true, study_design: r.study_type,
          direction: r.direction, claim: r.self_reported_claim,
          ...(hasValue ? { effect: { ...r.effect, metric: r.effect!.metric } } : {}),
        })
        expect([s.id, r.title, res.issues.filter((i) => i.action !== 'flagged').map((i) => i.code)]).toEqual([s.id, r.title, []])
      }
    }
  })
})
