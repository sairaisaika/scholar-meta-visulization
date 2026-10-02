/**
 * 演示页的每个场景都要真的落在它声称的那一级：引擎判据一改，演示对不上就红（演示不许替引擎说它没说过的话）。
 */
import { SCENARIOS } from '../demo/src/fixtures'
import { pickEvidenceView, poolEvidence } from '../src/ladder'
import { chartAvailabilityFor } from '../src/charts'
import { intakeArticle } from '../src/onsite'
import { OPEN_PATH, TREE, createDemoExplorer, demoArticles, demoExternal, pathTo } from '../demo/src/explore-data'
import { presentNodeChildren, presentWorks } from '../src/present'

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

describe('演示的下钻（0.4.0）', () => {
  it('站内文章都过得了入库验形（中英两份）；审阅时间认得出', () => {
    for (const locale of ['zh', 'en'] as const) {
      for (const a of demoArticles(locale)) {
        const r = intakeArticle(a)
        expect([locale, a.id, r.issues]).toEqual([locale, a.id, []])
        expect(!!r.record?.reviewed_at).toBe('reviewed_at' in a)
      }
    }
  })
  it('填满的那条路径一路点得进去：每一层往里都有、篇数从多到少；面包屑从大类开始', async () => {
    const svc = createDemoExplorer('zh', () => false)
    for (const id of OPEN_PATH.slice(0, -1)) {
      const r = await svc.getNodeMap(TREE[id].level, id)
      if (!r.ok) throw new Error(r.error)
      const counts = (r.data.children ?? []).map((c) => c.works_count ?? 0)
      expect(counts.length).toBeGreaterThan(1)
      expect(counts).toEqual([...counts].sort((a, b) => b - a))
      const next = OPEN_PATH[OPEN_PATH.indexOf(id) + 1]
      expect(r.data.children?.map((c) => c.external_id)).toContain(next)
    }
    expect(pathTo('T9101011')).toEqual([...OPEN_PATH])
  })
  it('主题往里是编辑绑定的站内标签；审阅门槛一开，标签篇数变少并说出在等的篇数；外部示例的引用只连同一批里的', async () => {
    let gate = false
    const svc = createDemoExplorer('en', () => gate)
    const off = await svc.getNodeMap('topic', 'T9101011')
    gate = true
    const on = await svc.getNodeMap('topic', 'T9101011')
    if (!off.ok || !on.ok) throw new Error('unavailable')
    const kids = (m: typeof off.data) => presentNodeChildren(m, { locale: 'en' })!.rows.map((r) => [r.label, r.count])
    expect(kids(off.data)).toEqual([['insomnia', 4], ['sleep hygiene', 3], ['CBT-I', 2]])
    expect(kids(on.data)).toEqual([['insomnia', 3], ['CBT-I', 2], ['sleep hygiene', 2]])
    expect([off.data.onsite_pending, on.data.onsite_pending]).toEqual([undefined, 2])
    const ids = new Set(on.data.records.map((r) => r.id))
    expect(on.data.edges?.filter((e) => e.kind === 'cites').every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true)
    expect(presentWorks(on.data).some((w) => w.links_text !== null)).toBe(true)
    // 大类的示例里有全部 9 篇（每篇的主主题都在树上）
    expect((await demoExternal.sampleWorks('domain', '91', 25))?.length).toBe(9)
  })
})
