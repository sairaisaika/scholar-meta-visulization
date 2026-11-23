/**
 * 打标签质量度量：与 scikit-learn 1.9.1 的参考值对表（2026-11-23 在独立环境里算出，脚本见下方注释）。
 *   多标签：`precision_recall_fscore_support(Y, P, average=None | 'micro', zero_division=0)`、`f1_score(Y, P, average='macro')`
 *   单选项：`cohen_kappa_score(gold, predicted)`
 * 参考实现把「算不出」写成 0（zero_division=0）；本实现写 null——对表时逐项说明。
 *
 *   tags = ['adhd','sleep','insomnia','cbt','children']
 *   gold = [{adhd,children},{sleep,insomnia},{adhd},{cbt,insomnia,sleep},{children},{adhd,sleep}]
 *   pred = [{adhd},{sleep,cbt},{adhd,children},{insomnia,sleep},{},{adhd,sleep,insomnia}]
 */
import { scoreLabelAgreement, scoreTagSets } from '../src/quality'
import { presentLabelAgreement, presentTagQuality } from '../src/present'

const W = (i: number) => `doi:10.1000/q.${i}`
const GOLD = [['ADHD', 'Children'], ['Sleep', 'Insomnia'], ['ADHD'], ['CBT', 'Insomnia', 'Sleep'], ['Children'], ['ADHD', 'Sleep']]
const PRED = [['adhd'], ['sleep', 'cbt'], ['adhd', 'children'], ['insomnia', 'sleep'], [], ['adhd', 'sleep', 'insomnia']]
const gold = GOLD.map((tags, i) => ({ work_id: W(i), tags }))
const pred = PRED.map((tags, i) => ({ work_id: W(i), tags }))

describe('scoreTagSets：对 scikit-learn 参考值', () => {
  const q = scoreTagSets(gold, pred)
  const tag = (k: string) => q.per_tag.find((t) => t.tag_key === k)!

  it('逐标签 precision / recall / F1 / support', () => {
    // sklearn: adhd 1.0 1.0 1.0 3 · sleep 1.0 1.0 1.0 3 · insomnia 0.5 0.5 0.5 2 · cbt 0.0 0.0 0.0 1 · children 0.0 0.0 0.0 2
    expect([tag('adhd').precision, tag('adhd').recall, tag('adhd').f1, tag('adhd').support]).toEqual([1, 1, 1, 3])
    expect([tag('sleep').precision, tag('sleep').recall, tag('sleep').f1, tag('sleep').support]).toEqual([1, 1, 1, 3])
    expect([tag('insomnia').precision, tag('insomnia').recall, tag('insomnia').f1, tag('insomnia').support]).toEqual([0.5, 0.5, 0.5, 2])
    expect([tag('cbt').precision, tag('cbt').recall, tag('cbt').f1, tag('cbt').support]).toEqual([0, 0, 0, 1])
    expect([tag('children').precision, tag('children').recall, tag('children').f1, tag('children').support]).toEqual([0, 0, 0, 2])
  })

  it('微平均与宏平均 F1', () => {
    // sklearn micro: 0.7, 0.6363636363636364, 0.6666666666666666；macro F1: 0.5
    expect(q.micro).toMatchObject({ tp: 7, fp: 3, fn: 4 })
    expect(q.micro.precision).toBeCloseTo(0.7, 12)
    expect(q.micro.recall).toBeCloseTo(0.6363636363636364, 12)
    expect(q.micro.f1).toBeCloseTo(0.6666666666666666, 12)
    expect(q.macro_f1).toBeCloseTo(0.5, 12)
  })

  it('覆盖率、排序、标签写法', () => {
    expect(q.works).toEqual({ gold: 6, predicted: 6, with_predictions: 5 })
    expect(q.coverage).toBeCloseTo(5 / 6, 12)
    expect(q.per_tag.map((t) => t.tag_key)).toEqual(['adhd', 'sleep', 'children', 'insomnia', 'cbt'])
    expect(tag('adhd').label).toBe('ADHD') // 标准答案里的写法优先（先出现）
  })
})

describe('scoreTagSets：边界', () => {
  it('没有标准答案 ⇒ 全是 null，不是 0', () => {
    const q = scoreTagSets([], pred)
    expect(q.works).toEqual({ gold: 0, predicted: 6, with_predictions: 0 })
    expect([q.coverage, q.macro_f1, q.micro.precision, q.micro.recall, q.micro.f1]).toEqual([null, null, null, null, null])
    expect(q.per_tag).toEqual([])
  })
  it('没有任何建议 ⇒ 精确率 null（算不出），召回率 0（全漏）', () => {
    const q = scoreTagSets(gold, [])
    expect([q.micro.precision, q.micro.recall, q.micro.f1, q.coverage]).toEqual([null, 0, 0, 0])
  })
  it('只评标准答案里的作品；标准答案之外的建议不算对也不算错', () => {
    const q = scoreTagSets([{ work_id: W(0), tags: ['adhd'] }], [{ work_id: W(0), tags: ['ADHD'] }, { work_id: W(9), tags: ['whatever'] }])
    expect(q.micro).toMatchObject({ tp: 1, fp: 0, fn: 0, precision: 1, recall: 1, f1: 1 })
    expect(q.works).toEqual({ gold: 1, predicted: 2, with_predictions: 1 })
  })
  it('标准答案里空集合的作品也被评：这篇上的建议都是多给的', () => {
    const q = scoreTagSets([{ work_id: W(0), tags: [] }], [{ work_id: W(0), tags: ['x'] }])
    expect(q.micro).toMatchObject({ tp: 0, fp: 1, fn: 0, precision: 0, recall: null })
    expect(q.macro_f1).toBeNull() // 标准答案里没有任何标签
  })
  it('作品键与标签两边都归一；同一篇出现多次取并集；坏条目丢掉', () => {
    const q = scoreTagSets(
      [{ work_id: 'https://doi.org/10.1000/Q.0', tags: ['#Sleep-Hygiene'] }, { work_id: 'doi:10.1000/q.0', tags: ['CBT'] }, { work_id: '  ', tags: ['x'] }],
      [{ work_id: 'doi:10.1000/q.0', tags: ['sleep_hygiene', 'cbt', ''] }],
    )
    expect(q.works.gold).toBe(1)
    expect(q.micro).toMatchObject({ tp: 2, fp: 0, fn: 0 })
  })
})

describe('scoreLabelAgreement：对 scikit-learn 参考值', () => {
  const pairs = (g: string[], p: string[]) => g.map((gold, i) => ({ gold, predicted: p[i]! }))
  it('κ 与一致率', () => {
    // sklearn cohen_kappa_score: B 0.5588235294117647（10 对里 7 对一致）；C 0.25（8 对里 5 对一致）
    const b = scoreLabelAgreement(pairs(
      ['rct', 'rct', 'cohort', 'cohort', 'case_control', 'rct', 'cohort', 'rct', 'cross_sectional', 'rct'],
      ['rct', 'cohort', 'cohort', 'cohort', 'case_control', 'rct', 'rct', 'rct', 'cross_sectional', 'case_control'],
    ))
    expect([b.n, b.agreed]).toEqual([10, 7])
    expect(b.agreement).toBeCloseTo(0.7, 12)
    expect(b.kappa).toBeCloseTo(0.5588235294117647, 12)
    expect(b.labels).toEqual(['case_control', 'cohort', 'cross_sectional', 'rct'])
    const c = scoreLabelAgreement(pairs(['a', 'a', 'b', 'b', 'a', 'b', 'a', 'a'], ['a', 'b', 'b', 'a', 'a', 'b', 'b', 'a']))
    expect([c.n, c.agreed]).toEqual([8, 5])
    expect(c.kappa).toBeCloseTo(0.25, 12)
  })
  it('没有可比的对 ⇒ null；两边都只用同一个值 ⇒ κ 算不出', () => {
    expect(scoreLabelAgreement([])).toEqual({ n: 0, agreed: 0, agreement: null, kappa: null, labels: [] })
    expect(scoreLabelAgreement([{ gold: ' ', predicted: 'rct' }]).n).toBe(0)
    const same = scoreLabelAgreement([{ gold: 'rct', predicted: 'rct' }, { gold: 'rct', predicted: 'rct' }])
    expect([same.agreement, same.kappa]).toEqual([1, null])
  })
})

describe('展示', () => {
  it('中英文案；算不出的写「—」；没有标准答案只说一句', () => {
    const q = scoreTagSets(gold, pred)
    const zh = presentTagQuality(q, { locale: 'zh' })
    expect(zh.summary_text).toBe('精确率 70% · 召回率 63.6% · F1 66.7%（命中 7，多给 3，漏掉 4）')
    expect(zh.coverage_text).toBe('标准答案 6 篇，其中 5 篇有建议（83.3%）')
    expect(zh.macro_text).toBe('按标签平均的 F1：50%')
    expect(zh.tags[0]).toEqual({ tag_key: 'adhd', text: 'ADHD：精确率 100% · 召回率 100% · F1 100%（标准答案里 3 篇）' })
    expect(presentTagQuality(q, { locale: 'en' }).summary_text).toBe('Precision 70% · recall 63.6% · F1 66.7% (7 correct, 3 extra, 4 missed)')
    expect(presentTagQuality(scoreTagSets(gold, []), { locale: 'zh' }).summary_text).toContain('精确率 —')
    expect(presentTagQuality(scoreTagSets([], pred), { locale: 'zh' })).toEqual({ none_text: '还没有标准答案，算不出质量。', summary_text: null, coverage_text: null, macro_text: null, tags: [] })
    const a = presentLabelAgreement(scoreLabelAgreement([{ gold: 'a', predicted: 'a' }, { gold: 'a', predicted: 'b' }, { gold: 'b', predicted: 'b' }, { gold: 'b', predicted: 'b' }]), { locale: 'zh' })
    expect(a).toEqual({ agreement_text: '4 对里 3 对一致（75%）', kappa_text: '扣掉碰巧一致后的 κ：0.50' })
    expect(presentLabelAgreement(scoreLabelAgreement([]), { locale: 'zh' })).toEqual({ agreement_text: null, kappa_text: null })
  })
})
