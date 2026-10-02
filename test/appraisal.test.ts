/**
 * 偏倚风险与证据确定性（0.3.0）：
 *   ① 验形：工具认得出、判断是这种工具的档位、写明是谁评的才收；写法宽松（`RoB 2`、`Some concerns`）；
 *   ② 风险档跨工具对齐（只用来取颜色和计数），没评过 ⇒ null，**不是** low；
 *   ③ 敏感性分析：参与汇总的研究里有高风险的 ⇒ 去掉再判、再算；主分析不变；没评过的不去掉；
 *   ④ 证据确定性：等级、结局、谁评的缺一不收；理由去重、按 GRADE 顺序；链接只收 http(s)；
 *   ⑤ 展示：工具自己的判断原样印；汇总概况、敏感性那一句、GRADE 符号与标准含义；没取到 ≠ 没有；
 *   ⑥ 服务：评级端口按范围取、逐条验形；端口出错 ⇒ certainty: null；没接端口 ⇒ 不下发。
 */
import {
  checkCertainties, checkCertainty, checkRiskOfBias, isHighRiskOfBias, isValidRiskOfBias, robBand, summarizeRiskOfBias, APPRAISAL_TEXT_MAX,
} from '../src/appraisal'
import { assessPooling, poolEvidence } from '../src/ladder'
import { intakeArticle } from '../src/onsite'
import { presentCertainty, presentEvidenceMap, presentRiskOfBias, presentRiskOfBiasSummary, presentView } from '../src/present'
import { isEvidenceMapData } from '../src/guards'
import { createEvidenceService } from '../src/service'
import { createMemoryCertaintySource, createMemoryOnsiteSource } from '../src/ports'
import type { EvidenceMapData, EvidenceRecord, EvidenceRiskOfBias } from '../src/types'

const rec = (i: number, over: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  id: `onsite:${i}`, source: 'onsite', external_id: String(i), title: `S${i}`, year: 2024, authors: [], doi: null, url: null, topic_ids: [],
  study_type: 'rct', self_reported_claim: null, direction: null, cited_by_count: null, is_retracted: false, is_open_access: null,
  effect: { metric: 'smd', value: 0.2 + i * 0.05, ci_low: 0.2 + i * 0.05 - 0.3, ci_high: 0.2 + i * 0.05 + 0.3, n: 100, higher_is_better: true },
  provenance: { source_label: 'Site', license: 'CC BY 4.0', retrieved_at: '2026-10-01T00:00:00Z' },
  ...over,
})
const rob = (tool: EvidenceRiskOfBias['tool'], overall: EvidenceRiskOfBias['overall']): EvidenceRiskOfBias => ({ tool, overall, source: '编辑甲' })

describe('① 偏倚风险验形', () => {
  it('没给 ⇒ 没有、也不报问题', () => {
    expect(checkRiskOfBias(undefined)).toEqual({ value: null, issue: null })
    expect(checkRiskOfBias(null)).toEqual({ value: null, issue: null })
  })
  it('写法宽松：工具与判断的大小写、空格、连字符都认', () => {
    expect(checkRiskOfBias({ tool: 'RoB 2', overall: 'Some concerns', source: ' 编辑甲 ' }).value).toEqual({ tool: 'rob2', overall: 'some_concerns', source: '编辑甲' })
    expect(checkRiskOfBias({ tool: 'ROBINS-I', overall: 'no information', source: 'Review X' }).value).toEqual({ tool: 'robins_i', overall: 'no_information', source: 'Review X' })
  })
  it.each([
    ['不是对象', 'rob2', 'unknown_rob_tool', 'risk_of_bias'],
    [{ tool: 'jadad', overall: 'low', source: 'x' }, null, 'unknown_rob_tool', 'risk_of_bias.tool'],
    [{ tool: 'rob2', overall: 'serious', source: 'x' }, null, 'rob_judgement_invalid', 'risk_of_bias.overall'],   // ROBINS-I 的档，不是 RoB 2 的
    [{ tool: 'robins_i', overall: 'some_concerns', source: 'x' }, null, 'rob_judgement_invalid', 'risk_of_bias.overall'],
    [{ tool: 'rob2', overall: 'low' }, null, 'rob_source_missing', 'risk_of_bias.source'],
    [{ tool: 'rob2', overall: 'low', source: '   ' }, null, 'rob_source_missing', 'risk_of_bias.source'],
  ])('%j ⇒ 整条不收（%s）', (raw, _unused, code, field) => {
    const r = checkRiskOfBias(raw)
    expect(r.value).toBeNull()
    expect(r.issue).toEqual({ code, field, action: 'field_cleared' })
  })
  it('「谁评的」太长就截断', () => {
    const r = checkRiskOfBias({ tool: 'other', overall: 'high', source: 'x'.repeat(500) })
    expect(r.value!.source).toHaveLength(APPRAISAL_TEXT_MAX)
    expect(r.value!.source.endsWith('…')).toBe(true)
  })
  it('自己拼记录的接入方可以自查', () => {
    expect(isValidRiskOfBias(rob('rob2', 'high'))).toBe(true)
    expect(isValidRiskOfBias({ tool: 'rob2', overall: 'critical', source: 'x' })).toBe(false)
    expect(isValidRiskOfBias({ tool: 'rob2', overall: 'low', source: '' })).toBe(false)
  })
  it('入库：合格的落到记录上，不合格的只报问题、记录照收', () => {
    const okA = intakeArticle({ id: 1, title: 'A', risk_of_bias: { tool: 'rob2', overall: 'high', source: '编辑甲' } })
    expect(okA.record!.risk_of_bias).toEqual(rob('rob2', 'high'))
    expect(okA.issues).toEqual([])
    const bad = intakeArticle({ id: 2, title: 'B', risk_of_bias: { tool: 'rob2', overall: 'high' } })
    expect(bad.record).not.toBeNull()
    expect(bad.record!.risk_of_bias).toBeUndefined()
    expect(bad.issues.map((i) => i.code)).toEqual(['rob_source_missing'])
    expect(intakeArticle({ id: 3, title: 'C' }).record).not.toHaveProperty('risk_of_bias')
  })
})

describe('② 风险档', () => {
  it.each([
    [rob('rob2', 'low'), 'low', false], [rob('rob2', 'some_concerns'), 'concerns', false], [rob('rob2', 'high'), 'high', true],
    [rob('robins_i', 'moderate'), 'concerns', false], [rob('robins_i', 'serious'), 'high', true], [rob('robins_i', 'critical'), 'critical', true],
    [rob('robins_i', 'no_information'), 'unknown', false], [rob('other', 'unclear'), 'unknown', false], [rob('other', 'high'), 'high', true],
  ] as const)('%j ⇒ %s', (r, band, high) => {
    expect(robBand(r)).toBe(band)
    expect(isHighRiskOfBias(r)).toBe(high)
  })
  it('没评过 ⇒ null，不是 low；判断与工具对不上 ⇒ null', () => {
    expect(robBand(null)).toBeNull()
    expect(robBand(undefined)).toBeNull()
    expect(robBand({ tool: 'rob2', overall: 'critical', source: 'x' })).toBeNull()
    expect(isHighRiskOfBias(null)).toBe(false)
  })
  it('概况：评过几项、各档几项、用了哪些工具（按固定顺序）', () => {
    const s = summarizeRiskOfBias([
      rec(1, { risk_of_bias: rob('robins_i', 'serious') }), rec(2, { risk_of_bias: rob('rob2', 'low') }), rec(3, { risk_of_bias: rob('rob2', 'high') }), rec(4),
    ])
    expect(s).toEqual({ total: 4, assessed: 3, by_band: { low: 1, concerns: 0, high: 2, critical: 0, unknown: 0 }, tools: ['rob2', 'robins_i'] })
  })
})

describe('③ 敏感性分析', () => {
  const six = (high: number[]) => Array.from({ length: 6 }, (_, i) => rec(i, high.includes(i) ? { risk_of_bias: rob('rob2', 'high') } : { risk_of_bias: rob('rob2', 'low') }))
  it('有高风险研究 ⇒ 去掉再算；与单独汇总剩下的研究完全一致；主分析不变', () => {
    const all = six([2])
    const p = poolEvidence(all)
    expect(p.allowed).toBe(true)
    const withoutRob = poolEvidence(all.map((r) => ({ ...r, risk_of_bias: null })))
    expect({ ...p, sensitivity: undefined }).toEqual({ ...withoutRob, sensitivity: undefined }) // 主分析不受偏倚风险影响
    const rest = poolEvidence(all.filter((_, i) => i !== 2))
    expect(p.sensitivity).toEqual({ excluded: 1, allowed: true, reason: 'ok', studies: 5, estimate: rest.estimate })
  })
  it('去掉之后不到 5 项 ⇒ 只给理由，不给数', () => {
    const p = poolEvidence(six([0, 1]))
    expect(p.sensitivity).toEqual({ excluded: 2, allowed: false, reason: 'too_few_studies', studies: 4, estimate: null })
  })
  it('没有高风险研究、主分析不能汇总、没评过的 ⇒ 都没有敏感性分析', () => {
    expect(poolEvidence(six([]))).not.toHaveProperty('sensitivity')
    const notAssessed = Array.from({ length: 6 }, (_, i) => rec(i))
    expect(poolEvidence(notAssessed)).not.toHaveProperty('sensitivity')
    const few = six([0]).slice(0, 4)
    expect(assessPooling(few).allowed).toBe(false)
    expect(poolEvidence(few)).not.toHaveProperty('sensitivity')
  })
})

describe('④ 证据确定性验形', () => {
  const ok = { level: 'Very low', outcome: '焦虑症状', source: '某篇系统综述', url: 'https://example.org/sof', rated_down_for: ['imprecision', 'risk of bias', 'imprecision', 'bogus'], rated_up_for: [] }
  it('写法宽松；理由去重、丢掉认不出的、按 GRADE 的固定顺序排', () => {
    expect(checkCertainty(ok)).toEqual({
      level: 'very_low', outcome: '焦虑症状', source: '某篇系统综述', url: 'https://example.org/sof', rated_down_for: ['risk_of_bias', 'imprecision'],
    })
  })
  it.each([
    [{ ...ok, level: 'medium' }], [{ ...ok, outcome: ' ' }], [{ ...ok, source: undefined }], ['high'], [null],
  ])('%j ⇒ 不收', (raw) => expect(checkCertainty(raw)).toBeNull())
  it('链接只收 http(s)；一批里不合格的丢掉', () => {
    expect(checkCertainty({ ...ok, url: 'javascript:alert(1)' })!.url).toBeNull()
    expect(checkCertainties([ok, { level: 'x' }, ok])).toHaveLength(2)
    expect(checkCertainties('nope')).toEqual([])
  })
})

describe('⑤ 展示', () => {
  it('单项：工具自己的判断原样印，写明谁评的；没评过就说没评过', () => {
    expect(presentRiskOfBias(rob('robins_i', 'serious'), { locale: 'zh' })).toEqual({ assessed: true, band: 'high', label: 'ROBINS-I：严重风险', source_text: '评定：编辑甲' })
    expect(presentRiskOfBias(rob('rob2', 'some_concerns'), { locale: 'en' }).label).toBe('RoB 2: Some concerns')
    expect(presentRiskOfBias(null, { locale: 'zh' })).toEqual({ assessed: false, band: null, label: '未评估偏倚风险', source_text: null })
  })
  it('概况一句话；一项都没评过 ⇒ 不说', () => {
    const v = presentRiskOfBiasSummary([rec(1, { risk_of_bias: rob('rob2', 'low') }), rec(2, { risk_of_bias: rob('rob2', 'high') }), rec(3)], { locale: 'zh' })
    expect(v.text).toBe('偏倚风险（RoB 2）：低风险 1 · 高风险 1')
    expect(v.missing_text).toBe('1 项没有评估')
    expect(presentRiskOfBiasSummary([rec(1)], { locale: 'zh' })).toMatchObject({ text: null, missing_text: null })
  })
  it('敏感性那一句：能汇总给数（与主分析同一个小数位），不能给理由', () => {
    const view = { kind: 'forest' as const, usable: 6, total: 6, downgrade_reason: null }
    const p = poolEvidence(Array.from({ length: 6 }, (_, i) => rec(i, { risk_of_bias: rob('rob2', i === 2 ? 'high' : 'low') })))
    const zh = presentView(view, p, { locale: 'zh' }).sensitivity_text!
    expect(zh).toMatch(/^去掉 1 项偏倚风险高的研究后（剩 5 项）：\d\.\d{2}，95% 置信区间 \d\.\d{2} 至 \d\.\d{2}$/)
    const few = poolEvidence(Array.from({ length: 6 }, (_, i) => rec(i, { risk_of_bias: rob('rob2', i < 2 ? 'high' : 'low') })))
    expect(presentView(view, few, { locale: 'en' }).sensitivity_text).toBe('Excluding studies at high risk of bias (2 removed, 4 left): Fewer than 5 eligible studies, so no summary diamond is drawn.')
    expect(presentView(view, poolEvidence([rec(1)]), { locale: 'en' }).sensitivity_text).toBeNull()
  })
  it('证据确定性：GRADE 符号、标准含义、升降级理由、出处链接', () => {
    const v = presentCertainty(checkCertainty({ level: 'low', outcome: '焦虑症状', source: '某篇系统综述', rated_down_for: ['risk_of_bias', 'imprecision'], rated_up_for: ['dose_response'] })!, { locale: 'zh' })
    expect(v).toMatchObject({
      level: 'low', label: '低', symbol: '⊕⊕◯◯',
      text: '证据确定性（GRADE）：低——结局「焦虑症状」；评定：某篇系统综述',
      reasons_text: '因偏倚风险、不精确降级；因有剂量反应关系升级', url: null,
    })
    expect(v.meaning).toContain('可能与估计值有实质差别')
    expect(presentCertainty({ level: 'high', outcome: 'Pain', source: 'Review X' }, { locale: 'en' })).toMatchObject({ symbol: '⊕⊕⊕⊕', reasons_text: null })
  })
  it('研究图谱：没取到评级要说出来；空数组就是没有评级，不说', () => {
    const base: EvidenceMapData = {
      level: 'tag', focus: null, parent: null, siblings: [], records: [rec(1, { risk_of_bias: rob('rob2', 'low') })], view: { kind: 'gap_map', usable: 1, total: 1, downgrade_reason: 'too_few' },
      pooling: { allowed: false, reason: 'not_applicable', studies: 0 }, sources: [], onsite_only: true,
    }
    const unavailable = presentEvidenceMap({ ...base, certainty: null }, { locale: 'zh' })
    expect(unavailable.notices).toContain('这次没取到证据确定性评级，稍后再试。')
    expect(unavailable.certainty).toEqual([])
    expect(unavailable.risk_of_bias.text).toBe('偏倚风险（RoB 2）：低风险 1')
    const none = presentEvidenceMap({ ...base, certainty: [] }, { locale: 'zh' })
    expect(none.notices.some((n) => n.includes('证据确定性'))).toBe(false)
    expect(isEvidenceMapData({ ...base, certainty: 'x' })).toBe(false)
    expect(isEvidenceMapData({ ...base, certainty: null })).toBe(true)
  })
})

describe('⑥ 服务：评级端口', () => {
  const articles = [{ id: 1, title: 'A', tags: ['sleep'] }]
  const NOW = new Date('2026-10-01T00:00:00Z')
  it('按范围取、逐条验形（不合格的丢掉并记条数）', async () => {
    const log = jest.fn()
    const good = { level: 'moderate', outcome: 'Sleep quality', source: 'Review X' }
    const service = createEvidenceService({
      onsite: createMemoryOnsiteSource(articles), now: () => NOW, log,
      certainty: { async forScope(scope) { return scope.level === 'tag' && scope.id === 'sleep' ? [good, { level: 'nope' }] : [] } },
    })
    const r = await service.getTagMap('Sleep')
    expect(r.ok && r.data.certainty).toEqual([{ ...good, url: null }])
    expect(log).toHaveBeenCalledWith('[evidence.service] certainty entries dropped', { dropped: 1 })
  })
  it('端口出错 ⇒ null（没取到）；没接端口 ⇒ 不下发', async () => {
    const failing = createEvidenceService({
      onsite: createMemoryOnsiteSource(articles), now: () => NOW, log: jest.fn(),
      certainty: { async forScope() { throw new Error('db down') } },
    })
    const f = await failing.getTagMap('sleep')
    expect(f.ok && f.data.certainty).toBeNull()
    const none = await createEvidenceService({ onsite: createMemoryOnsiteSource(articles), now: () => NOW }).getTagMap('sleep')
    expect(none.ok && 'certainty' in none.data).toBe(false)
  })
  it('内存实现按 level + id 匹配', async () => {
    const src = createMemoryCertaintySource([{ scope: { level: 'topic', id: 'openalex:T1' }, certainty: { level: 'high', outcome: 'o', source: 's' } }])
    expect(await src.forScope({ level: 'topic', id: 'openalex:T1' })).toHaveLength(1)
    expect(await src.forScope({ level: 'tag', id: 'openalex:T1' })).toEqual([])
  })
})
