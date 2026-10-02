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
  it('演示用的研究设计、效应量（含只有 p 与样本量的）与偏倚风险都过得了入库验形，入库前后同判', () => {
    for (const s of SCENARIOS) {
      for (const r of s.records) {
        const res = intakeArticle({
          id: r.external_id, title: 'demo', tags: ['demo'], is_public: true, study_design: r.study_type,
          direction: r.direction, claim: r.self_reported_claim, effect: r.effect, risk_of_bias: r.risk_of_bias,
        })
        expect([s.id, r.title, res.issues.filter((i) => i.action !== 'flagged').map((i) => i.code)]).toEqual([s.id, r.title, []])
        expect([s.id, r.title, res.record!.effect, res.record!.risk_of_bias ?? null]).toEqual([s.id, r.title, r.effect, r.risk_of_bias ?? null])
      }
    }
  })
  it('汇总场景的敏感性分析：去掉唯一一项偏倚风险高的研究后还剩 5 项，仍可汇总', () => {
    const pooled = SCENARIOS.find((s) => s.id === 'pooled')!
    const sens = poolEvidence(pooled.records).sensitivity
    expect(sens).toMatchObject({ excluded: 1, allowed: true, reason: 'ok', studies: 5 })
    expect(sens!.estimate).not.toBeNull()
  })
})
