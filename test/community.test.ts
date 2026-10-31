/**
 * 社区标注（0.6.0）：
 *   ① 比例裁决 `assessQuorum`：Wilson 区间与独立闭式实现（math.erf 二分反解 z）逐个对过；门槛 / 置信度 / 最少人数 / 挑战规则；
 *   ② 账本按层启用比例裁决：贡献者层 pending 不出现在结论里；编辑层照旧按一致 / 分歧；不设 quorum 行为与 0.5.0 相同；
 *   ③ `resolveAnnotations`：标签、分面（单选与分歧）、结果行（整行原子、盲复录、peeked、冲突）、缺出处封顶、模型只记不算、黑名单、层级门槛；
 *   ④ 复录比对容差；概念解析；竞争值；
 *   ⑤ 导出读取（契约对不上、摘要、重复、坏状态）与宿主端口（文章 / 账本 / 结果行 / 记录 / 合并先到先得）；
 *   ⑥ 阶梯差距与 frame 预览；展示函数的人话。
 */
import { assessQuorum, DEFAULT_QUORUM_RULE, resolveWorkTags, resolveWorkTagsWithPending, DEFAULT_LEDGER_POLICY } from '../src/ledger'
import {
  resolveAnnotations, matchReExtraction, resolveConcepts, publicWorkCard, readCommunityExport, createCommunityPorts, mergeWorkTagSources, reconcileRows,
  communityStateToWorkTagState, DEFAULT_COMMUNITY_POLICY,
} from '../src/community'
import { describeLadderGap } from '../src/ladder'
import { buildSynthesisTable, intakeOutcomeRows, previewFrameChange, summarizeFrames, synthesisFrameKey } from '../src/synthesis'
import { presentCommunityDecision, presentCommunityWork, presentFrameChange, presentFrames, presentLadderGap, presentWorkCard, presentWorkTags } from '../src/present'
import type {
  EvidenceAnnotation, EvidenceCommunityExport, EvidenceCommunityWork, EvidenceConcept, EvidenceRecord, EvidenceTagActor, EvidenceTagAssertion, EvidenceWorkCard,
} from '../src/types'
import { EVIDENCE_CONTRACT_VERSION } from '../src/types'

const close = (a: number | null, b: number, tol = 1e-9) => { expect(a).not.toBeNull(); expect(Math.abs(a! - b)).toBeLessThanOrEqual(tol) }

describe('① 比例裁决 assessQuorum', () => {
  // 参考值：独立闭式实现（Brown, Cai & DasGupta 2001 式 4），z 由 math.erf 二分反解；两侧 80% ⇒ z = 1.2815515655446004
  it.each<[number, number, number, number, string]>([
    [1, 0, 0.3784475032253529, 1, 'pending'],
    [2, 0, 0.5490923699884755, 1, 'accepted'],
    [3, 1, 0.43254145036907754, 0.9219192523148821, 'pending'],   // 1 个反对未达 min_disputers ⇒ 不入 n：实际按 3:0 算（见下一组）
    [4, 1, 0.5135414727563554, 0.9381042509712396, 'accepted'],
    [1, 1, 0.1642517200298993, 0.8357482799701007, 'disputed'],
    [1, 4, 0.06189574902876033, 0.4864585272436445, 'rejected'],
    [7, 3, 0.4973717052397509, 0.8462008219240327, 'disputed'],
    [8, 2, 0.6015960115342782, 0.9137627792113974, 'accepted'],
    [0, 2, 0, 0.45090763001152445, 'rejected'],
  ])('%i:%i（反对计票时）', (add, remove, low, high, state) => {
    // min_disputers 设 1：所有反对都入 n，直接对表
    const r = assessQuorum({ add, remove }, { ...DEFAULT_QUORUM_RULE, min_disputers: 1 })
    close(r.quorum.ci_low, low)
    close(r.quorum.ci_high, high)
    expect(r.quorum.n).toBe(add + remove)
    expect(r.state).toBe(state === 'pending' && add === 3 ? 'disputed' : state) // 3:1 全计票时跨门槛且两边有人 ⇒ disputed
  })
  it('挑战规则：反对人数不到 min_disputers 不入 n，只标 challenged；到了才计票', () => {
    const one = assessQuorum({ add: 2, remove: 1 })
    expect(one).toMatchObject({ state: 'accepted', quorum: { n: 2, add: 2, remove: 0, challengers: 1, challenged: true } })
    const two = assessQuorum({ add: 2, remove: 2 })
    expect(two.state).toBe('disputed')
    expect(two.quorum).toMatchObject({ n: 4, challenged: false, challengers: 0 })
    close(two.quorum.ci_low, 0.23024, 1e-5)
  })
  it('min_independent：一个人说有只是 pending；unsure 不入 n', () => {
    const r = assessQuorum({ add: 1, remove: 0, unsure: 3 })
    expect(r.state).toBe('pending')
    expect(r.quorum).toMatchObject({ n: 1, unsure: 3 })
    expect(assessQuorum({ add: 1, remove: 0 }, { ...DEFAULT_QUORUM_RULE, min_independent: 1 }).state).toBe('pending') // 1/1 下界 0.378 < 0.5
    expect(assessQuorum({ add: 0, remove: 0 }).quorum.ci_low).toBeNull()
  })
  it('置信度旋钮：一致同意首次 accepted 所需人数 0.8 → 2、0.9 → 3、0.95 → 4；有 1 人反对（计票）时 0.8 → 5 人', () => {
    const rule = (confidence: number) => ({ ...DEFAULT_QUORUM_RULE, confidence, min_disputers: 1 })
    expect(assessQuorum({ add: 2, remove: 0 }, rule(0.9)).state).toBe('pending')
    expect(assessQuorum({ add: 3, remove: 0 }, rule(0.9)).state).toBe('accepted')
    expect(assessQuorum({ add: 3, remove: 0 }, rule(0.95)).state).toBe('pending')
    expect(assessQuorum({ add: 4, remove: 0 }, rule(0.95)).state).toBe('accepted')
    expect(assessQuorum({ add: 3, remove: 1 }, rule(0.8)).state).toBe('disputed')
    expect(assessQuorum({ add: 4, remove: 1 }, rule(0.8)).state).toBe('accepted')
    close(assessQuorum({ add: 3, remove: 0 }, rule(0.9)).quorum.z, 1.6448536269514715, 1e-8)
  })
  it('参数不合法按缺省算，不抛错', () => {
    const r = assessQuorum({ add: 2, remove: 0 }, { tier: 'contributor', threshold: 2, confidence: 0, min_independent: -1, min_disputers: 1.5 })
    expect(r.quorum).toMatchObject({ threshold: 0.5, confidence: 0.8, min_independent: 2 })
    expect(r.state).toBe('accepted')
  })
})

const person = (id: string, tier: EvidenceTagActor['tier']): EvidenceTagActor => ({ kind: 'person', id, tier })
const asrt = (by: EvidenceTagActor, op: 'add' | 'remove', tag: string, at: string, request: string | null = null): EvidenceTagAssertion => ({
  id: `${by.id}-${tag}-${at}`, work_id: 'doi:10.1/x', tag_key: tag.toLowerCase(), tag_label: tag, op, by, confidence: null, at, note: null, request_id: request,
})
const c1 = person('gh:1', 'contributor'); const c2 = person('gh:2', 'contributor'); const c3 = person('gh:3', 'contributor')
const ed = person('gh:9', 'editor')

describe('② 账本按层启用比例裁决', () => {
  const policy = { ...DEFAULT_LEDGER_POLICY, quorum: DEFAULT_QUORUM_RULE }
  it('贡献者层：一人 ⇒ pending（不在结论里，单列）；两人一致 ⇒ present 带 quorum；一人反对只算挑战', () => {
    const one = resolveWorkTagsWithPending([asrt(c1, 'add', 'ADHD', '2026-01-01')], policy)
    expect(one.tags).toEqual([])
    expect(one.pending).toHaveLength(1)
    expect(one.pending[0]).toMatchObject({ tag_key: 'adhd', quorum: { n: 1, add: 1 } })
    const two = resolveWorkTags([asrt(c1, 'add', 'ADHD', '2026-01-01'), asrt(c2, 'add', 'ADHD', '2026-01-02'), asrt(c3, 'remove', 'ADHD', '2026-01-03')], policy)
    expect(two).toHaveLength(1)
    expect(two[0]).toMatchObject({ state: 'present', decided_by: 'contributor', support: { contributor: { add: 2, remove: 1 } }, quorum: { n: 2, challenged: true, challengers: 1 } })
  })
  it('编辑层照旧：一致即生效、分歧即争议，不带 quorum；编辑压过贡献者的比例结论', () => {
    const r = resolveWorkTags([asrt(c1, 'add', 'ADHD', '2026-01-01'), asrt(c2, 'add', 'ADHD', '2026-01-02'), asrt(ed, 'remove', 'ADHD', '2026-01-03')], policy)
    expect(r[0]).toMatchObject({ state: 'absent', decided_by: 'editor' })
    expect(r[0]!.quorum).toBeUndefined()
  })
  it('不设 quorum ⇒ 与 0.5.0 逐字相同（同级一致 present，分歧 disputed）', () => {
    const base = [asrt(c1, 'add', 'ADHD', '2026-01-01'), asrt(c2, 'remove', 'ADHD', '2026-01-02')]
    expect(resolveWorkTags(base)[0]).toMatchObject({ state: 'disputed', decided_by: 'contributor' })
    expect('quorum' in resolveWorkTags(base)[0]!).toBe(false)
    expect(resolveWorkTags([asrt(c1, 'add', 'ADHD', '2026-01-01')])[0]!.state).toBe('present')
  })
  it('经审核的立场仍优先于比例', () => {
    const r = resolveWorkTags([asrt(c1, 'add', 'ADHD', '2026-01-01'), asrt(c2, 'add', 'ADHD', '2026-01-02'), asrt(c3, 'remove', 'ADHD', '2026-01-03', 'req-1')], policy)
    expect(r[0]).toMatchObject({ state: 'absent', request_id: 'req-1' })
  })
})

// ── 断言夹具 ───────────────────────────────────────────────────────────────────────
const W = 'doi:10.1016/j.jad.2020.01.001'
let seq = 0
const ann = (
  by: EvidenceTagActor, kind: EvidenceAnnotation['kind'], op: EvidenceAnnotation['op'], subject: string, payload: EvidenceAnnotation['payload'], at = `2026-10-${String(10 + ++seq).padStart(2, '0')}T00:00:00Z`,
): EvidenceAnnotation => ({ id: `a_${seq}`, at, work_id: W, kind, op, subject, by, payload, note: null, source: { issue: seq }, supersedes: null })
const rowInput = (value: number, extra: Partial<{ ci_low: number; ci_high: number; n: number | null; p_value: number | null; locator: string }> = {}) => ({
  kind: 'row' as const,
  context: { row_id: 'o1', outcome: 'ADHD-RS total score', comparison: 'methylphenidate vs placebo', population: 'adults', timepoint: '8 weeks', unit: 'ADHD-RS points', analysis: 'unadjusted', kind: 'continuous' as const, locator: extra.locator ?? 'Table 2' },
  effect: { metric: 'smd' as const, value, ci_low: extra.ci_low ?? value - 0.3, ci_high: extra.ci_high ?? value + 0.3, n: extra.n === undefined ? 212 : extra.n, p_value: extra.p_value === undefined ? 0.004 : extra.p_value, higher_is_better: false },
  direction: null,
})
const reExtract = (value: number, peeked = false, extra: Parameters<typeof rowInput>[1] = {}) => {
  const r = rowInput(value, extra)
  return { kind: 'review' as const, reason: null, re_extraction: { effect: r.effect, direction: null }, peeked }
}

describe('③ resolveAnnotations', () => {
  const model: EvidenceTagActor = { kind: 'model', id: 'smt-vocab-keywords', tier: 'model', model_version: '2026-10' }
  it('标签：提出 + 一个认可 ⇒ accepted；模型建议只记不算；一个人只是 pending', () => {
    const d = resolveAnnotations([
      ann(model, 'tag', 'add', 'tag:adhd', { kind: 'tag', tag: 'ADHD' }),
      ann(c1, 'tag', 'add', 'tag:adhd', { kind: 'tag', tag: 'ADHD' }),
      ann(c2, 'review', 'endorse', 'tag:adhd', { kind: 'review', reason: null }),
    ])
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ kind: 'tag', state: 'accepted', decided_by: 'contributor', value: 'ADHD', support: { model: { add: 1, remove: 0 }, contributor: { add: 2, remove: 0 } }, quorum: { n: 2 } })
    expect(resolveAnnotations([ann(model, 'tag', 'add', 'tag:x', { kind: 'tag', tag: 'X' })])).toEqual([])
    expect(resolveAnnotations([ann(c1, 'tag', 'add', 'tag:y', { kind: 'tag', tag: 'Y' })])[0]!.state).toBe('pending')
  })
  it('编辑层说了算：编辑一人 ⇒ confirmed；两个编辑分歧 ⇒ disputed；维护者压过编辑', () => {
    const base = [ann(c1, 'tag', 'add', 'tag:adhd', { kind: 'tag', tag: 'ADHD' }), ann(c2, 'review', 'endorse', 'tag:adhd', { kind: 'review', reason: null })]
    expect(resolveAnnotations([...base, ann(ed, 'review', 'dispute', 'tag:adhd', { kind: 'review', reason: 'not about ADHD at all' })])[0]).toMatchObject({ state: 'removed', decided_by: 'editor', reasons: ['not about ADHD at all'] })
    const ed2 = person('gh:10', 'editor')
    expect(resolveAnnotations([...base, ann(ed, 'review', 'dispute', 'tag:adhd', { kind: 'review', reason: 'no' }), ann(ed2, 'review', 'endorse', 'tag:adhd', { kind: 'review', reason: null })])[0]!.state).toBe('disputed')
    const m = person('gh:11', 'maintainer')
    expect(resolveAnnotations([...base, ann(ed, 'review', 'dispute', 'tag:adhd', { kind: 'review', reason: 'no' }), ann(m, 'review', 'endorse', 'tag:adhd', { kind: 'review', reason: null })])[0]).toMatchObject({ state: 'confirmed', decided_by: 'maintainer' })
  })
  it('每人只算最新立场；挑战者不入 n；黑名单留档不计', () => {
    const d = resolveAnnotations([
      ann(c1, 'tag', 'add', 'tag:adhd', { kind: 'tag', tag: 'ADHD' }),
      ann(c2, 'review', 'dispute', 'tag:adhd', { kind: 'review', reason: 'wrong paper' }),
      ann(c2, 'review', 'endorse', 'tag:adhd', { kind: 'review', reason: null }), // 改主意
      ann(c3, 'review', 'dispute', 'tag:adhd', { kind: 'review', reason: 'still wrong' }),
    ])
    expect(d[0]).toMatchObject({ state: 'accepted', quorum: { n: 2, add: 2, remove: 0, challengers: 1, challenged: true }, reasons: ['still wrong'] })
    expect(resolveAnnotations([ann(c1, 'tag', 'add', 'tag:adhd', { kind: 'tag', tag: 'ADHD' })], DEFAULT_COMMUNITY_POLICY, { blocklist: ['gh:1'] })).toEqual([])
  })
  it('分面单选：胜出值、其余值算反对、alternatives；design 缺出处封顶 pending', () => {
    const d = resolveAnnotations([
      ann(c1, 'facet', 'add', 'facet:design', { kind: 'facet', facet: 'design', value: 'rct', locator: 'Methods' }),
      ann(c2, 'facet', 'add', 'facet:design', { kind: 'facet', facet: 'design', value: 'rct', locator: 'Abstract' }),
      ann(c3, 'facet', 'add', 'facet:design', { kind: 'facet', facet: 'design', value: 'cohort', locator: 'Methods' }),
    ])
    expect(d[0]).toMatchObject({ kind: 'facet', value: 'rct', alternatives: [{ value: 'rct', votes: 2 }, { value: 'cohort', votes: 1 }], quorum: { add: 2, challenged: true } })
    expect(d[0]!.state).toBe('accepted')
    const noLoc = resolveAnnotations([
      ann(c1, 'facet', 'add', 'facet:design', { kind: 'facet', facet: 'design', value: 'rct' }),
      ann(c2, 'review', 'endorse', 'facet:design', { kind: 'review', reason: null }),
    ])
    expect(noLoc[0]).toMatchObject({ state: 'pending', issues: ['missing_locator'] })
  })
  it('结果行：一人抄 ⇒ pending（needs_re_extraction）；盲复录一致 ⇒ accepted/double；peeked 计票不计复录；不带复录的认可不算票', () => {
    const single = resolveAnnotations([ann(c1, 'row', 'add', 'row:o1', rowInput(-0.42))])
    expect(single[0]).toMatchObject({ kind: 'row', state: 'pending', verification: 'single', issues: ['needs_re_extraction'], re_extractions: 0, quorum: { n: 1 } })
    const double = resolveAnnotations([ann(c1, 'row', 'add', 'row:o1', rowInput(-0.42)), ann(c2, 'review', 'endorse', 'row:o1', reExtract(-0.421))])
    expect(double[0]).toMatchObject({ state: 'accepted', verification: 'double', re_extractions: 1, issues: [] })
    const peeked = resolveAnnotations([ann(c1, 'row', 'add', 'row:o1', rowInput(-0.42)), ann(c2, 'review', 'endorse', 'row:o1', reExtract(-0.42, true))])
    expect(peeked[0]).toMatchObject({ state: 'pending', verification: 'single', re_extractions: 0, quorum: { n: 2, add: 2 } })
    const bare = resolveAnnotations([ann(c1, 'row', 'add', 'row:o1', rowInput(-0.42)), ann(c2, 'review', 'endorse', 'row:o1', { kind: 'review', reason: null })])
    expect(bare[0]!.quorum).toMatchObject({ n: 1, add: 1 })
  })
  it('结果行：复录不一致自动变成不认可并标 extraction_conflict；编辑认可 ⇒ editor 核验', () => {
    const conflict = resolveAnnotations([ann(c1, 'row', 'add', 'row:o1', rowInput(-0.42)), ann(c2, 'review', 'endorse', 'row:o1', reExtract(-0.24))])
    expect(conflict[0]).toMatchObject({ state: 'disputed', issues: ['extraction_conflict'], quorum: { add: 1, remove: 0, challengers: 1 } })
    const editor = resolveAnnotations([ann(c1, 'row', 'add', 'row:o1', rowInput(-0.42)), ann(ed, 'review', 'endorse', 'row:o1', { kind: 'review', reason: null })])
    expect(editor[0]).toMatchObject({ state: 'confirmed', verification: 'editor', decided_by: 'editor' })
  })
  it('独立性断言只收编辑层并挂在行上；绑定低层直接不算', () => {
    const d = resolveAnnotations([
      ann(c1, 'row', 'add', 'row:o1', rowInput(-0.42)),
      ann(c2, 'independence', 'set', 'row:o1', { kind: 'independence', study_id: 'nct:1', dependence_id: 'nct:1', independence_verified: true, note: null }),
      ann(ed, 'independence', 'set', 'row:o1', { kind: 'independence', study_id: 'nct:2', dependence_id: 'nct:2', independence_verified: true, note: 'single parallel RCT' }),
    ])
    expect(d[0]!.independence).toEqual({ study_id: 'nct:2', dependence_id: 'nct:2', independence_verified: true })
    expect(resolveAnnotations([ann(c1, 'binding', 'add', 'binding:adhd', { kind: 'binding', topic: { id: 'openalex:T1', display_name: 'ADHD' } })])).toEqual([])
    expect(resolveAnnotations([ann(ed, 'binding', 'add', 'binding:adhd', { kind: 'binding', topic: { id: 'openalex:T1', display_name: 'ADHD' } })])[0]).toMatchObject({ kind: 'binding', state: 'confirmed' })
  })
})

describe('④ 复录比对、概念解析、竞争值', () => {
  it('容差：相对 0.5% 或绝对 0.005 取大；n 与 p（3 位有效数字）精确；方向与度量相等', () => {
    const a = rowInput(-0.42)
    expect(matchReExtraction({ effect: a.effect, direction: null }, { effect: { ...a.effect, value: -0.4219 }, direction: null }).match).toBe(true)
    expect(matchReExtraction({ effect: a.effect, direction: null }, { effect: { ...a.effect, value: -0.43 }, direction: null })).toEqual({ match: false, diffs: ['value'] })
    expect(matchReExtraction({ effect: { ...a.effect, value: 120 }, direction: null }, { effect: { ...a.effect, value: 120.5 }, direction: null }).match).toBe(true)
    expect(matchReExtraction({ effect: a.effect, direction: null }, { effect: { ...a.effect, n: 213, p_value: 0.0040004 }, direction: null }).diffs).toEqual(['n'])
    expect(matchReExtraction({ effect: a.effect, direction: null }, { effect: { ...a.effect, p_value: 0.005 }, direction: 'favours' }).diffs).toEqual(['direction', 'p_value'])
    expect(matchReExtraction({ effect: null, direction: 'favours' }, { effect: null, direction: 'favours' }).match).toBe(true)
    expect(matchReExtraction({ effect: a.effect, direction: null }, { effect: null, direction: null }).diffs).toEqual(['effect'])
    expect(matchReExtraction(null, { effect: null, direction: null }).match).toBe(false)
  })
  it('概念解析按别名归一；只认 active；解析不到的分面不出现', () => {
    const concepts: EvidenceConcept[] = [
      { id: 'c:outcome/adhd-symptoms', facet: 'outcome', label: { zh: 'ADHD 症状', en: 'ADHD symptoms' }, aliases: ['ADHD-RS total score', 'SNAP-IV total'], broader: [], status: 'active' },
      { id: 'c:population/adults', facet: 'population', label: { en: 'Adults' }, aliases: ['adult'], broader: [], status: 'deprecated' },
    ]
    expect(resolveConcepts({ outcome: 'adhd rs total score', population: 'Adults', comparison: 'x vs y' }, concepts)).toEqual({ outcome: 'c:outcome/adhd-symptoms' })
    expect(resolveConcepts({ outcome: 'ADHD symptoms' }, concepts)).toEqual({ outcome: 'c:outcome/adhd-symptoms' })
  })
  it('竞争值：同一槽位两条 accepted 行数值不同 ⇒ 都 disputed；在容差内 ⇒ 互为复录（single 升 double 并放行）', () => {
    const mk = (value: number, state: 'accepted' | 'pending', verification: 'single' | 'double') => ({
      input: rowInput(value), decision: {
        work_id: W, subject: 'row:x', kind: 'row' as const, state, decided_by: 'contributor' as const, support: {}, verification, re_extractions: 0, effective_id: null, value: null,
        issues: state === 'pending' ? ['needs_re_extraction' as const] : [], last_changed: '', reasons: [],
        quorum: { n: 2, add: 2, remove: 0, unsure: 0, challengers: 0, challenged: false, share: 1, ci_low: 0.549, ci_high: 1, z: 1.28, threshold: 0.5, confidence: 0.8, min_independent: 2 },
      },
    })
    const a = mk(-0.42, 'accepted', 'double'); const b = mk(-0.2, 'accepted', 'double')
    reconcileRows([a, b])
    expect([a.decision.state, b.decision.state]).toEqual(['disputed', 'disputed'])
    expect(a.decision.issues).toContain('competing_value')
    const c = mk(-0.42, 'pending', 'single'); const d = mk(-0.421, 'pending', 'single')
    reconcileRows([c, d])
    expect([c.decision.state, c.decision.verification, c.decision.issues]).toEqual(['accepted', 'double', []])
  })
  it('裁决 → 账本立场', () => {
    expect(['accepted', 'confirmed', 'rejected', 'removed', 'disputed', 'pending'].map((s) => communityStateToWorkTagState(s as never))).toEqual(['present', 'present', 'absent', 'absent', 'disputed', null])
  })
})

// ── 导出夹具 ───────────────────────────────────────────────────────────────────────
const card: EvidenceWorkCard = {
  id: 'openalex:W3001234567', doi: '10.1016/j.jad.2020.01.001', pmid: '31900000', title: 'Methylphenidate for adult ADHD: a randomised trial', year: 2020,
  authors: ['A. Author', 'B. Author'], venue: { id: 'openalex:S123', name: 'Journal of Affective Disorders', type: 'journal', is_oa: false, issn_l: '0165-0327', publisher: 'Elsevier' },
  publication_type: 'article', topics: [{ id: 'openalex:T10537', display_name: 'Attention Deficit Hyperactivity Disorder' }], keywords: ['Methylphenidate'], mesh: ['Methylphenidate'],
  abstract: 'should not leak', language: 'en', cited_by_count: 31, is_open_access: false, oa_url: null, is_retracted: false,
}
const decision = (over: Partial<EvidenceCommunityWork['rows'][number]['decision']>): EvidenceCommunityWork['rows'][number]['decision'] => ({
  work_id: W, subject: 'row:o1', kind: 'row', state: 'accepted', decided_by: 'contributor', support: { contributor: { add: 2, remove: 0 } },
  quorum: { n: 2, add: 2, remove: 0, unsure: 0, challengers: 0, challenged: false, share: 1, ci_low: 0.549, ci_high: 1, z: 1.2816, threshold: 0.5, confidence: 0.8, min_independent: 2 },
  verification: 'double', re_extractions: 1, effective_id: 'a_1', value: null, issues: [], last_changed: '2026-11-01T00:00:00Z', reasons: [], ...over,
})
const work = (over: Partial<EvidenceCommunityWork> = {}): EvidenceCommunityWork => ({
  work_id: W, aliases: ['openalex:W3001234567', 'pmid:31900000'], card: publicWorkCard(card),
  tags: [
    { tag_key: 'adhd', label: 'ADHD', state: 'present', decided_by: 'contributor', support: { contributor: { add: 3, remove: 0 } }, last_changed: '2026-11-01T00:00:00Z', request_id: null, quorum: decision({}).quorum },
    { tag_key: 'sleep', label: 'Sleep', state: 'absent', decided_by: 'editor', support: { editor: { add: 0, remove: 1 } }, last_changed: '2026-11-01T00:00:00Z', request_id: null },
  ],
  pending: [{ subject: 'tag:methylphenidate', decision: decision({ subject: 'tag:methylphenidate', kind: 'tag', state: 'pending', value: 'Methylphenidate', verification: null, re_extractions: 0 }) }],
  facets: { design: { value: 'rct', decision: decision({ subject: 'facet:design', kind: 'facet', state: 'accepted', value: 'rct', verification: null, re_extractions: 0 }), locators: ['Abstract-Methods'] } },
  rows: [
    { row_id: 'o1', input: rowInput(-0.42), concept_ids: { outcome: 'c:outcome/adhd-symptoms' }, decision: decision({ independence: { study_id: 'nct:1', dependence_id: 'nct:1', independence_verified: true } }) },
    // 一人抄、平台配置不要求复录时也可能 accepted：宿主按 minVerification 决定收不收
    { row_id: 'o2', input: { ...rowInput(-0.1), context: { ...rowInput(-0.1).context, row_id: 'o2', outcome: 'Sleep quality' } }, decision: decision({ subject: 'row:o2', verification: 'single', re_extractions: 0 }) },
  ],
  unsure: 0, updated_at: '2026-11-02T00:00:00Z', ...over,
})
const manifest = {
  contract: EVIDENCE_CONTRACT_VERSION, export_version: 1, generated_at: '2026-11-02T09:00:00Z', source_commit: 'abc', label: 'Community annotations', license: 'CC0-1.0',
  repository: 'https://example.org/repo', policy: DEFAULT_COMMUNITY_POLICY, facet_vocab: { design: { values: ['rct'], maps_to: 'study_type', locator_required: true } },
  concepts_version: '2026-11-01', maintainers: ['someone'], shards: [{ path: 'works/3a.jsonl', bytes: 1, sha256: 'x', works: 1 }],
  counts: { works: 1, assertions: 5, contributors: 3, accepted: 3, pending: 2, disputed: 0, frames: 1 },
}

describe('⑤ 导出读取与宿主端口', () => {
  it('读回：摘要被置空并报 abstract_not_allowed；契约主次版本对不上 ⇒ ok: false；重复作品与坏状态逐条报', () => {
    const r = readCommunityExport(manifest, [[{ ...work(), card }]])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.works[0]!.card!.abstract).toBeNull()
    expect(r.issues).toEqual([{ code: 'abstract_not_allowed', path: 'shards[0][0].card.abstract' }])
    expect(r.value.manifest.policy.quorum.confidence).toBe(0.8)
    const mismatch = readCommunityExport({ ...manifest, contract: '0.5.0' }, [[work()]])
    expect(mismatch).toEqual({ ok: false, issues: [{ code: 'contract_mismatch', path: 'manifest.contract' }] })
    const dup = readCommunityExport(manifest, [{ works: [work(), work()] }, [{ ...work(), tags: [{ tag_key: 'x', state: 'maybe' }] }]])
    expect(dup.ok && dup.value.works).toHaveLength(1)
    expect(dup.ok && dup.issues.map((i) => i.code)).toEqual(['duplicate_work', 'bad_state', 'duplicate_work'])
    expect(readCommunityExport(null, []).ok).toBe(false)
    expect(readCommunityExport({ ...manifest, license: 'MIT' }, []).ok).toBe(false)
  })
  it('文章端口：一篇一行，标签只带「有」的，研究设计取 accepted 的 design，效应取第一条够核验档的行；按标签键过滤', async () => {
    const exp = (readCommunityExport(manifest, [[work()]]) as { ok: true; value: EvidenceCommunityExport }).value
    const ports = createCommunityPorts(exp)
    const rows = await ports.articles.listArticles({}) as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: W, title: card.title, tags: ['ADHD'], study_design: 'rct', effect: { metric: 'smd', value: -0.42 }, doi: card.doi })
    expect(await ports.articles.listArticles({ tagKeys: ['sleep'] })).toEqual([])
    expect(await ports.articles.listArticles({ tagKeys: ['adhd'] })).toHaveLength(1)
    expect(ports.articles.label).toBe('Community annotations')
    // 要求 editor 核验时没有够格的行 ⇒ 没有效应
    expect((await createCommunityPorts(exp, { minVerification: 'editor' }).articles.listArticles({}) as Array<Record<string, unknown>>)[0]).toMatchObject({ effect: null })
  })
  it('账本端口：缺省只给 present；with_negative 连 absent 一起；作品键与别名都能查', async () => {
    const exp = (readCommunityExport(manifest, [[work()]]) as { ok: true; value: EvidenceCommunityExport }).value
    const present = await createCommunityPorts(exp).workTags.forWorks([W, 'openalex:W3001234567', 'doi:10.9999/none'])
    expect([...present.keys()]).toEqual([W, 'openalex:W3001234567'])
    expect(present.get(W)!.map((t) => t.state)).toEqual(['present'])
    const all = await createCommunityPorts(exp, { tagStates: 'with_negative' }).workTags.forWorks([W])
    expect(all.get(W)!.map((t) => t.state)).toEqual(['present', 'absent'])
  })
  it('结果行与记录：只给计入且够核验档的行；reviewed 只有 editor 才 true；独立性来自编辑断言；记录走同一套验形并带数值出处', () => {
    const exp = (readCommunityExport(manifest, [[work()]]) as { ok: true; value: EvidenceCommunityExport }).value
    const ports = createCommunityPorts(exp)
    const outcomes = ports.outcomes(W)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ id: 'o1', context: { reviewed: false, independence_verified: true, study_id: 'nct:1', dependence_id: 'nct:1', concept_ids: { outcome: 'c:outcome/adhd-symptoms' } } })
    expect(ports.outcomes(W, { minVerification: 'single' })).toHaveLength(2)
    const { records, contexts, issues } = ports.records()
    expect(issues).toEqual([])
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ source: 'community', id: `community:${W}/o1`, study_type: 'rct', effect: { metric: 'smd', value: -0.42 }, provenance: { license: 'CC0-1.0', source_label: 'Community annotations' } })
    expect(records[0]!.data_provenance).toMatchObject({ locator: 'Table 2', verification: 'double', decided_by: 'contributor' })
    expect(contexts[0]).toMatchObject({ record_id: records[0]!.id, outcome: 'ADHD-RS total score' })
    expect(ports.work('pmid:31900000')?.work_id).toBe(W)
  })
  it('合并账本端口：先到先得（宿主账本优先）；一个来源抛错整体抛错', async () => {
    const host = { async forWorks(ids: readonly string[]) { return new Map(ids.filter((i) => i === W).map((i) => [i, [{ tag_key: 'host', label: 'Host', state: 'present' as const, decided_by: 'editor' as const, support: {}, last_changed: '' }]])) } }
    const exp = (readCommunityExport(manifest, [[work()]]) as { ok: true; value: EvidenceCommunityExport }).value
    const merged = mergeWorkTagSources([host, createCommunityPorts(exp).workTags])
    const r = await merged.forWorks([W, 'openalex:W3001234567'])
    expect(r.get(W)!.map((t) => t.tag_key)).toEqual(['host'])
    expect(r.get('openalex:W3001234567')!.map((t) => t.tag_key)).toEqual(['adhd']) // 宿主没按别名回答的键由后面的来源补上（按键对，不按别名）
    await expect(mergeWorkTagSources([{ async forWorks() { throw new Error('db down') } }]).forWorks([W])).rejects.toThrow('db down')
  })
})

const rec = (id: string, over: Partial<EvidenceRecord>): EvidenceRecord => ({
  id, source: 'community', external_id: id, title: id, year: 2020, authors: [], doi: null, url: null, topic_ids: [], study_type: 'rct', publication_type: null,
  self_reported_claim: null, direction: null, effect: null, cited_by_count: null, is_retracted: false, is_open_access: null,
  provenance: { source_label: 'x', license: 'CC0-1.0', retrieved_at: '2026-01-01T00:00:00Z' }, ...over,
})

describe('⑥ 阶梯差距、frame 与人话', () => {
  it('describeLadderGap：空 ⇒ gap_map，差 1 条带方向的；加草稿后到 direction，再差 1 条带 n / p 的到 albatross；汇总那句', () => {
    const empty = describeLadderGap([])
    expect(empty).toMatchObject({ current: 'gap_map', with_draft: null, next: 'direction', missing: [{ field: 'direction', count: 1 }], pooling: null })
    const draft = rec('d', { direction: 'favours' })
    const g = describeLadderGap([], draft)
    expect(g).toMatchObject({ current: 'gap_map', with_draft: 'direction', next: 'albatross', missing: [{ field: 'n', count: 2 }] })
    const withEffects = [rec('a', { effect: { metric: 'smd', value: -0.4, ci_low: -0.7, ci_high: -0.1, n: 100, higher_is_better: false }, direction: 'favours' })]
    const h = describeLadderGap(withEffects)
    expect(h).toMatchObject({ current: 'forest', next: null, missing: [], pooling: { allowed: false, reason: 'too_few_studies', studies: 1, need: 4 } })
    const view = presentLadderGap(g, { usable: 0, total: 0 }, { locale: 'zh' })
    expect(view.with_draft_text).toContain('方向')
    expect(view.next_text).toContain('样本量')
    expect(presentLadderGap(h, null, { locale: 'en' }).pooling_text).toContain('4 more studies')
  })
  it('frame 键：有概念 id 的分面用 id，其余照原文；无 concept_ids 的键与以前逐字相同', () => {
    const r = rec('community:x/o1', { effect: { metric: 'smd', value: -0.4, ci_low: -0.7, ci_high: -0.1, n: 100, higher_is_better: false } })
    const ctx = { record_id: r.id, report_id: 'x', study_id: 'x', dependence_id: 'x', outcome: 'ADHD-RS total score', population: 'adults', comparison: 'a vs b', timepoint: '8 weeks', unit: 'pts', analysis: 'unadjusted', kind: 'continuous' as const, locator: 'T2', reviewed: true, independence_verified: true }
    expect(synthesisFrameKey(ctx, r)).toBe(JSON.stringify(['ADHD-RS total score', 'adults', 'a vs b', '8 weeks', 'pts', 'unadjusted', 'continuous', 'rct', 'smd', false]))
    expect(synthesisFrameKey({ ...ctx, concept_ids: { outcome: 'c:outcome/adhd' } }, r)).toBe(JSON.stringify(['c:outcome/adhd', 'adults', 'a vs b', '8 weeks', 'pts', 'unadjusted', 'continuous', 'rct', 'smd', false]))
    expect(synthesisFrameKey(null, r)).toBe(JSON.stringify(['unclassified', r.id]))
  })
  it('summarizeFrames / previewFrameChange：两份表前后对比，新 frame、级别与条数变化；人话', () => {
    const article = (id: string) => ({ id, title: id, study_design: 'rct', is_public: true })
    const outcome = (id: string, value: number, outcomeName = 'ADHD-RS total score') => ({
      id, effect: { metric: 'smd', value, ci_low: value - 0.3, ci_high: value + 0.3, n: 100, higher_is_better: false },
      context: { study_id: `s-${id}-${value}`, dependence_id: `s-${id}-${value}`, outcome: outcomeName, population: 'adults', comparison: 'mph vs placebo', timepoint: '8 weeks', unit: 'pts', analysis: 'unadjusted', kind: 'continuous', locator: 'T2', reviewed: true, independence_verified: true, concept_ids: outcomeName === 'ADHD-RS total score' ? { outcome: 'c:outcome/adhd-symptoms' } : undefined },
    })
    const a = intakeOutcomeRows(article('w1'), [outcome('o1', -0.4)], { source: 'community', retrieved_at: '2026-01-01T00:00:00Z' })
    const b = intakeOutcomeRows(article('w2'), [outcome('o1', -0.5), outcome('o2', -0.2, 'Sleep quality')], { source: 'community', retrieved_at: '2026-01-01T00:00:00Z' })
    const concepts = [{ id: 'c:outcome/adhd-symptoms', facet: 'outcome' as const, label: { zh: 'ADHD 症状', en: 'ADHD symptoms' }, aliases: [], broader: [], status: 'active' as const }]
    const before = summarizeFrames(buildSynthesisTable(a.records, a.contexts), { concepts, locale: 'zh' })
    const after = summarizeFrames(buildSynthesisTable([...a.records, ...b.records], [...a.contexts, ...b.contexts]), { concepts, locale: 'zh', tagsOf: () => ['adhd'] })
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({ facets: { outcome: 'c:outcome/adhd-symptoms' }, concept_labels: { outcome: 'ADHD 症状' }, works: 1, studies: 1, view: { kind: 'forest' }, blockers: ['too_few_studies'] })
    expect(after).toHaveLength(2)
    expect(after[0]).toMatchObject({ works: 2, studies: 2, tag_keys: ['adhd'] })
    const changes = previewFrameChange(before, after)
    expect(changes.map((c) => [c.before === null, c.changed])).toEqual([[false, ['count']], [true, ['view', 'pooling', 'count', 'blockers']]])
    const text = presentFrameChange(changes, { locale: 'zh' })
    expect(text[0]!.text).toContain('ADHD 症状')
    expect(text[1]!.text).toMatch(/^新 frame/)
    const frames = presentFrames(after, { locale: 'en' })
    expect(frames[0]).toMatchObject({ count_text: '2 works · 2 studies · 2 results', can_pool: false })
    expect(frames[0]!.blockers_text).toContain('too_few_studies')
  })
  it('名片、裁决与作品的人话（中英）', () => {
    const v = presentWorkCard(card, { locale: 'zh' })
    expect(v).toMatchObject({ title: card.title, meta: '2020 · A. Author、B. Author', type_text: '文献类型：论文', cited_text: '被引 31 次（衡量关注度，不是质量）', retracted_text: null })
    expect(v.type_hint).toContain('不是研究设计')
    expect(v.topics_text).toContain('Attention Deficit Hyperactivity Disorder')
    expect(presentWorkCard({ ...card, is_retracted: true, authors: ['A', 'B', 'C', 'D', 'E'] }, { locale: 'en' })).toMatchObject({ retracted_text: 'Retracted: excluded from all counts.', meta: '2020 · A, B, C et al.' })
    const d = presentCommunityDecision(decision({}), { locale: 'zh' })
    expect(d).toMatchObject({ state: 'accepted', counted: true, text: '有（社区认可），由贡献者定', verification_text: '核验：两人独立一致', re_extractions_text: '独立复录一致：1 人' })
    expect(d.quorum_text).toBe('2 人说有、0 人说没有（2 人计票）：支持 100%，80% 区间 54.9%–100%，门槛 50%')
    const challenged = presentCommunityDecision(decision({ quorum: { ...decision({}).quorum!, challenged: true, challengers: 1 }, issues: ['missing_locator'], reasons: ['Methods says open label'] }), { locale: 'en' })
    expect(challenged.quorum_text).toContain('1 more objected')
    expect(challenged.issues_text).toEqual(['No source location given; left out for now'])
    expect(challenged.reasons_text).toBe('Reasons for disputing: Methods says open label')
    const w = presentCommunityWork(work(), { locale: 'zh' })
    expect(w.tags.map((t) => [t.tag_key, t.quorum_text !== null])).toEqual([['adhd', true], ['sleep', false]])
    expect(w.pending[0]).toMatchObject({ state: 'pending', counted: false, value: 'Methylphenidate' })
    expect(w.facets[0]!.text).toBe('design ＝ 随机对照试验')
    expect(w.rows[0]!.text).toBe('ADHD-RS total score · methylphenidate vs placebo · 8 weeks：标准化均数差（SMD） −0.42 [−0.72, −0.12] · n = 212（Table 2）')
    expect(w.rows[1]!.decision.verification_text).toBe('核验：一人抄录')
    expect(presentWorkTags(work().tags, { locale: 'en' }).find((t) => t.tag_key === 'adhd')!.quorum_text).toContain('2 say present')
  })
})
