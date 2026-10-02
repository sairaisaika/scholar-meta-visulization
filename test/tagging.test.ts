/**
 * 打标签的模型与标签账本：
 *   ① 参考实现（词表匹配）：关键词 > 外部主题 > 标题 > 摘要；拉丁文按词边界、中文按子串；别名由人维护；
 *   ② runTagger 替任何模型验形：归一、夹置信度、同标签取最高、词表外丢掉、门槛、上限；模型抛错或回 null ⇒ null；
 *   ③ 账本裁决：每人只算最新立场；人压过模型；最高一级内部分歧 ⇒ disputed；低置信模型断言不算；
 *   ④ 写入闸：低一级不能推翻高一级的结论、不能碰高一级的争议（要提修改申请）；同级或更高可以；
 *   ⑤ 修改申请：只有人；不能审自己的；层级要够（审核门槛与所涉标签的现行结论）；通过后以审核人名义写断言、即生效，同级要改得再申请；撤回只限申请人；
 *   ⑥ 优待自己人：层级顺序与审核门槛是策略参数，接入方自己排；
 *   ⑦ 作品 id 归一与交换包：同一篇论文只有一个键；包是不可信输入，用收包方的词表，从不抛错；
 *   ⑧ 结论用到统计上：只有 present 计入、争议先不计入；图注标出模型决定与争议排除；服务接了账本就按它算，账本取不到回 unavailable。
 */
import { buildTagContribution, createVocabularyTagger, normalizeWorkId, runTagger, validateTagContribution } from '../src/tagging'
import type { EvidenceTagger } from '../src/tagging'
import { createEvidenceService, createMemoryOnsiteSource } from '../src/service'
import {
  applyWorkTags, resolveWorkTags, checkAssertion, openChangeRequest, decideChangeRequest, withdrawChangeRequest, createTagLedger, createMemoryTagLedgerStore,
} from '../src/ledger'
import { ledgerPolicyFromSettings, defaultSettings } from '../src/settings'
import { presentWorkTags, presentChangeRequests, presentTagSuggestions, presentContributionIssues } from '../src/present'
import type { EvidenceTagActor, EvidenceTagAssertion } from '../src/types'
import { EVIDENCE_CONTRACT_VERSION } from '../src/types'

const editor: EvidenceTagActor = { kind: 'person', id: 'ed-1', tier: 'editor' }
const editor2: EvidenceTagActor = { kind: 'person', id: 'ed-2', tier: 'editor' }
const maintainer: EvidenceTagActor = { kind: 'person', id: 'mt-1', tier: 'maintainer' }
const contributor: EvidenceTagActor = { kind: 'person', id: 'c-1', tier: 'contributor' }
const modelA: EvidenceTagActor = { kind: 'model', id: 'vocab', tier: 'model', model_version: '1' }
const modelB: EvidenceTagActor = { kind: 'model', id: 'llm', tier: 'model', model_version: '2026-09' }
let seq = 0
const as = (by: EvidenceTagActor, op: 'add' | 'remove', tag: string, at: string, confidence: number | null = null): EvidenceTagAssertion => ({
  id: `a${++seq}`, work_id: 'openalex:W1', tag_key: tag.toLowerCase(), tag_label: tag, op, by, confidence, at, note: null, request_id: null,
})

describe('① 词表匹配', () => {
  const tagger = createVocabularyTagger({ entries: [
    { tag: 'ADHD', aliases: ['attention deficit hyperactivity disorder', '注意力缺陷'] },
    { tag: 'Sleep', aliases: ['insomnia'] },
    { tag: 'Anxiety' },
  ] })
  it('按字段给置信度；整词匹配（adhd 不匹配 adhdx）；中文按子串', async () => {
    const out = await tagger.tag({
      work_id: 'openalex:W1', title: 'Insomnia in adults with attention-deficit/hyperactivity disorder',
      abstract: 'We studied adhdx markers.', keywords: ['注意力缺陷多动障碍'],
    })
    expect(out).toEqual([
      { tag: 'ADHD', confidence: 0.9, rationale: 'matched "注意力缺陷" in keywords' },
      { tag: 'Sleep', confidence: 0.7, rationale: 'matched "insomnia" in title' },
    ])
    expect(tagger.vocabulary).toEqual(['ADHD', 'Sleep', 'Anxiety'])
  })
})

describe('② runTagger', () => {
  const fake = (out: unknown, vocabulary: string[] | null = null): EvidenceTagger =>
    ({ id: 'm', version: '1', vocabulary, tag: async () => out as never })
  it('归一、夹置信度、同标签取最高、词表外丢掉、门槛、上限', async () => {
    const r = (await runTagger(fake([
      { tag: 'ADHD', confidence: 0.4 }, { tag: '#adhd', confidence: 0.8, rationale: '  r  ' }, { tag: '', confidence: 1 }, { tag: 'Invented', confidence: 0.99 },
      { tag: 'Sleep', confidence: 1.7 }, { tag: 'Diet', confidence: 0.1 },
    ], ['ADHD', 'Sleep', 'Diet']), { work_id: 'x', title: 't' }, { minConfidence: 0.2, maxTags: 1 }))!
    expect(r.suggestions).toEqual([{ tag_key: 'sleep', label: 'Sleep', confidence: 1, rationale: null }])
    expect(r.dropped).toEqual({ invalid: 1, out_of_vocabulary: 1, below_threshold: 1, over_limit: 1 })
    expect(r.tagger).toEqual({ id: 'm', version: '1' })
  })
  it('模型失败 ⇒ null（不是「没有标签」）', async () => {
    expect(await runTagger(fake(null), { work_id: 'x', title: 't' })).toBeNull()
    expect(await runTagger({ ...fake([]), tag: async () => { throw new Error('rate limited') } }, { work_id: 'x', title: 't' })).toBeNull()
    expect((await runTagger(fake([]), { work_id: 'x', title: 't' }))!.suggestions).toEqual([])
  })
})

describe('③ 裁决', () => {
  it('人压过模型；每人只算最新立场', () => {
    const tags = resolveWorkTags([
      as(modelA, 'add', 'ADHD', '2026-01-01', 0.9), as(modelB, 'add', 'ADHD', '2026-01-02', 0.8),
      as(contributor, 'remove', 'ADHD', '2026-01-03'),
      as(contributor, 'add', 'ADHD', '2026-01-04'), // 改主意
    ])
    expect(tags).toEqual([expect.objectContaining({ tag_key: 'adhd', state: 'present', decided_by: 'contributor', support: { model: { add: 2, remove: 0 }, contributor: { add: 1, remove: 0 } } })])
  })
  it('最高一级内部意见不一 ⇒ disputed（不投票）；更高一级表态后按它', () => {
    const base = [as(editor, 'add', 'Sleep', '2026-01-01'), as(editor2, 'remove', 'Sleep', '2026-01-02'), as(modelA, 'add', 'Sleep', '2026-01-01', 0.9)]
    expect(resolveWorkTags(base)[0]).toMatchObject({ state: 'disputed', decided_by: 'editor' })
    expect(resolveWorkTags([...base, as(maintainer, 'remove', 'Sleep', '2026-01-05')])[0]).toMatchObject({ state: 'absent', decided_by: 'maintainer' })
  })
  it('模型的最新立场没把握 ⇒ 没有立场（不回退到它更早的高置信结论）', () => {
    expect(resolveWorkTags([as(modelA, 'add', 'Diet', '2026-01-01', 0.9), as(modelA, 'add', 'Diet', '2026-02-01', 0.2)])).toEqual([])
    const mixed = resolveWorkTags([as(modelA, 'add', 'Diet', '2026-01-01', 0.9), as(modelA, 'add', 'Diet', '2026-02-01', 0.2), as(modelB, 'add', 'Diet', '2026-01-01', 0.6)])
    expect(mixed[0]).toMatchObject({ state: 'present', support: { model: { add: 1, remove: 0 } }, last_changed: '2026-01-01' })
  })
  it('低于置信门槛的模型断言不算；没给置信度的照算', () => {
    expect(resolveWorkTags([as(modelA, 'add', 'Diet', '2026-01-01', 0.3)])).toEqual([])
    expect(resolveWorkTags([as(modelA, 'add', 'Diet', '2026-01-01', null)])[0].state).toBe('present')
    const strict = { ...ledgerPolicyFromSettings({ ...defaultSettings(), 'ledger.modelMinConfidence': 95 }), tierOrder: ['maintainer', 'editor', 'contributor', 'model'] as const }
    expect(resolveWorkTags([as(modelA, 'add', 'Diet', '2026-01-01', 0.9)], strict)).toEqual([])
  })
})

describe('④ 写入闸', () => {
  const current = resolveWorkTags([as(editor, 'add', 'ADHD', '2026-01-01')])[0]
  it('低一级推翻高一级的结论 ⇒ needs_change_request；附和可以；同级或更高可以', () => {
    expect(checkAssertion(current, { op: 'remove', by: contributor })).toEqual({ ok: false, refusal: 'needs_change_request' })
    expect(checkAssertion(current, { op: 'remove', by: modelA })).toEqual({ ok: false, refusal: 'needs_change_request' })
    expect(checkAssertion(current, { op: 'add', by: modelA })).toEqual({ ok: true })
    expect(checkAssertion(current, { op: 'remove', by: editor2 })).toEqual({ ok: true })
    expect(checkAssertion(current, { op: 'remove', by: maintainer })).toEqual({ ok: true })
    expect(checkAssertion(undefined, { op: 'remove', by: modelA })).toEqual({ ok: true })
  })
  it('高一级的争议低一级不能碰', () => {
    const disputed = resolveWorkTags([as(editor, 'add', 'X', '2026-01-01'), as(editor2, 'remove', 'X', '2026-01-02')])[0]
    expect(checkAssertion(disputed, { op: 'add', by: contributor })).toEqual({ ok: false, refusal: 'needs_change_request' })
  })
})

describe('⑤ 修改申请', () => {
  const open = () => openChangeRequest({ id: 'r1', work_id: 'openalex:W1', changes: [{ op: 'remove', tag: 'ADHD' }], by: contributor, reason: 'The paper is about autism.', at: '2026-02-01' })
  it('只有人能申请；作品 id 要认得出；要有改动和理由；标签要合法', () => {
    expect(open()).toMatchObject({ ok: true, value: { status: 'open', changes: [{ op: 'remove', tag_key: 'adhd', tag_label: 'ADHD' }] } })
    expect(openChangeRequest({ id: 'r', work_id: 'onsite:1', changes: [{ op: 'add', tag: 'x' }], by: modelA, reason: 'r', at: 't' })).toEqual({ ok: false, refusal: 'not_a_person' })
    expect(openChangeRequest({ id: 'r', work_id: 'w', changes: [{ op: 'add', tag: 'x' }], by: editor, reason: 'r', at: 't' })).toEqual({ ok: false, refusal: 'invalid_work' })
    expect(openChangeRequest({ id: 'r', work_id: 'onsite:1', changes: [], by: editor, reason: 'r', at: 't' })).toEqual({ ok: false, refusal: 'empty_request' })
    expect(openChangeRequest({ id: 'r', work_id: 'onsite:1', changes: [{ op: 'add', tag: 'x' }], by: editor, reason: '  ', at: 't' })).toEqual({ ok: false, refusal: 'empty_request' })
    expect(openChangeRequest({ id: 'r', work_id: 'onsite:1', changes: [{ op: 'add', tag: '  ' }], by: editor, reason: 'r', at: 't' })).toEqual({ ok: false, refusal: 'invalid_tag' })
  })
  it('审核：不能审自己的；层级要 ≥ 门槛且 ≥ 现行结论；通过后以审核人名义写断言', () => {
    const req = (open() as { ok: true; value: import('../src/types').EvidenceTagChangeRequest }).value
    const current = resolveWorkTags([as(maintainer, 'add', 'ADHD', '2026-01-01')])
    let n = 0
    const newId = () => `new${++n}`
    expect(decideChangeRequest(req, { decision: 'accept', by: contributor, at: 't', current, newId })).toEqual({ ok: false, refusal: 'self_review' })
    expect(decideChangeRequest(req, { decision: 'accept', by: editor, at: 't', current, newId })).toEqual({ ok: false, refusal: 'insufficient_tier' }) // 现行结论是维护者给的
    const r = decideChangeRequest(req, { decision: 'accept', by: maintainer, note: 'agreed', at: '2026-02-02', current, newId })
    if (!r.ok) throw new Error(r.refusal)
    expect(r.value.request).toMatchObject({ status: 'accepted', decided_by: maintainer, decided_at: '2026-02-02', decision_note: 'agreed' })
    expect(r.value.assertions).toEqual([{ id: 'new1', work_id: 'openalex:W1', tag_key: 'adhd', tag_label: 'ADHD', op: 'remove', by: maintainer, confidence: null, at: '2026-02-02', note: 'agreed', request_id: 'r1' }])
    expect(decideChangeRequest(r.value.request, { decision: 'reject', by: maintainer, at: 't', current, newId })).toEqual({ ok: false, refusal: 'not_open' })
  })
  it('撤回只限申请人，且只在 open 时', () => {
    const req = (open() as { ok: true; value: import('../src/types').EvidenceTagChangeRequest }).value
    expect(withdrawChangeRequest(req, editor, 't')).toEqual({ ok: false, refusal: 'not_requester' })
    expect(withdrawChangeRequest(req, contributor, 't')).toMatchObject({ ok: true, value: { status: 'withdrawn' } })
  })
})

describe('⑥ 账本门面（端到端）与优待自己人', () => {
  it('模型建议 → 贡献者想去掉被拒 → 提申请 → 编辑通过 → 结论改变；全程留痕', async () => {
    const store = createMemoryTagLedgerStore()
    let n = 0
    let t = 0
    const ledger = createTagLedger({ store, newId: () => `id${++n}`, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++t)) })
    const tagger = createVocabularyTagger({ entries: [{ tag: 'ADHD' }, { tag: 'Sleep' }] })
    const run = (await runTagger(tagger, { work_id: 'openalex:W9', title: 'ADHD and sleep' }))!
    const w = await ledger.submitSuggestions('openalex:W9', run.suggestions, { id: tagger.id, version: tagger.version })
    expect(w.written.map((a) => [a.tag_key, a.by.kind, a.by.model_version, a.confidence])).toEqual([['adhd', 'model', '1', 0.7], ['sleep', 'model', '1', 0.7]])
    await ledger.assert('openalex:W9', [{ op: 'add', tag: 'ADHD' }], editor) // 编辑确认
    const blocked = await ledger.assert('openalex:W9', [{ op: 'remove', tag: 'ADHD' }], contributor)
    expect(blocked).toEqual({ written: [], unchanged: [], refused: [{ tag: 'ADHD', refusal: 'needs_change_request' }] })
    const req = await ledger.requestChange('openalex:W9', [{ op: 'remove', tag: 'ADHD' }], contributor, 'Mentions ADHD only as an exclusion criterion.')
    if (!req.ok) throw new Error(req.refusal)
    expect((await ledger.openRequests('openalex:W9')).map((r) => r.id)).toEqual([req.value.id])
    const d = await ledger.decide(req.value.id, 'accept', editor2, 'Checked the methods section.')
    expect(d.ok).toBe(true)
    const tags = await ledger.workTags('openalex:W9')
    // 通过即生效：编辑乙审核通过的「去掉」在编辑这一级说了算，编辑甲之前的「有」不再构成争议
    expect(tags.map((x) => [x.tag_key, x.state, x.decided_by, x.request_id])).toEqual([['adhd', 'absent', 'editor', req.value.id], ['sleep', 'present', 'model', null]])
    const rows = presentWorkTags(tags, { locale: 'zh' })
    expect(rows.find((r) => r.tag_key === 'adhd')).toMatchObject({ counted: false, reviewed: true, text: '没有（经编辑审核）' })
    // 经审核的结论：同级不能直接推翻（要再提申请），更高一级可以直接改
    // 编辑甲重申原立场：已在档、不重复写，也推翻不了审核结论；编辑乙想改回「有」：得再提申请
    expect(await ledger.assert('openalex:W9', [{ op: 'add', tag: 'ADHD' }], editor)).toEqual({ written: [], unchanged: ['adhd'], refused: [] })
    expect(await ledger.assert('openalex:W9', [{ op: 'add', tag: 'ADHD' }], editor2)).toEqual({ written: [], unchanged: [], refused: [{ tag: 'ADHD', refusal: 'needs_change_request' }] })
    expect((await ledger.workTags('openalex:W9')).find((x) => x.tag_key === 'adhd')).toMatchObject({ state: 'absent', request_id: req.value.id })
    expect(presentChangeRequests(await store.listRequests({}), { locale: 'en' })[0]).toMatchObject({
      status_text: 'Accepted', changes_text: 'Add: —; remove: ADHD', requester_id: 'c-1', requester_tier_text: 'contributor', reviewer_id: 'ed-2', decided_at: '2026-01-01',
    })
    expect(presentTagSuggestions(run.suggestions, { locale: 'en' })[0].confidence_text).toBe('Confidence 70%')
    expect(await ledger.decide('nope', 'accept', editor, null)).toEqual({ ok: false, refusal: 'not_found' })
    expect((await ledger.assert('openalex:W9', [{ op: 'add', tag: 'ADHD' }], maintainer)).written).toHaveLength(1)
    expect((await ledger.workTags('openalex:W9')).find((x) => x.tag_key === 'adhd')).toMatchObject({ state: 'present', decided_by: 'maintainer', request_id: null })
  })
  it('经审核的结论：同一级后来又通过的申请覆盖前一个；同级没经审核的分歧照样是争议', () => {
    const reviewed = (by: EvidenceTagActor, op: 'add' | 'remove', at: string, request_id: string): EvidenceTagAssertion => ({ ...as(by, op, 'X', at), request_id })
    const first = resolveWorkTags([as(editor, 'add', 'X', '2026-01-01'), reviewed(editor2, 'remove', '2026-01-02', 'r1')])[0]
    expect(first).toMatchObject({ state: 'absent', decided_by: 'editor', request_id: 'r1' })
    const third: EvidenceTagActor = { kind: 'person', id: 'ed-3', tier: 'editor' }
    const second = resolveWorkTags([as(editor, 'add', 'X', '2026-01-01'), reviewed(editor2, 'remove', '2026-01-02', 'r1'), reviewed(third, 'add', '2026-01-03', 'r2')])[0]
    expect(second).toMatchObject({ state: 'present', request_id: 'r2' })
    expect(resolveWorkTags([as(editor, 'add', 'X', '2026-01-01'), as(editor2, 'remove', 'X', '2026-01-02')])[0]).toMatchObject({ state: 'disputed', request_id: null })
    // 写入闸：同级对经审核的结论表同意可以，唱反调要申请；对没经审核的结论同级可以直接表态
    expect(checkAssertion(first, { op: 'remove', by: editor })).toEqual({ ok: true })
    expect(checkAssertion(first, { op: 'add', by: editor })).toEqual({ ok: false, refusal: 'needs_change_request' })
    expect(checkAssertion({ ...first, request_id: null }, { op: 'add', by: editor })).toEqual({ ok: true })
    expect(checkAssertion(first, { op: 'add', by: maintainer })).toEqual({ ok: true })
  })
  it('层级顺序由接入方排：比如把自家编辑排在社区维护者之上', () => {
    const house: EvidenceTagActor = { kind: 'person', id: 'house-editor', tier: 'editor' }
    const community: EvidenceTagActor = { kind: 'person', id: 'community-maintainer', tier: 'maintainer' }
    const assertions = [as(community, 'add', 'X', '2026-01-01'), as(house, 'remove', 'X', '2026-01-02')]
    expect(resolveWorkTags(assertions)[0].state).toBe('present')
    const favourHouse = { tierOrder: ['editor', 'maintainer', 'contributor', 'model'] as const, modelMinConfidence: 0.5, reviewTier: 'editor' as const }
    expect(resolveWorkTags(assertions, favourHouse)[0]).toMatchObject({ state: 'absent', decided_by: 'editor' })
  })
})

describe('⑥ 账本门面的写入细节', () => {
  const setup = () => {
    let n = 0
    return createTagLedger({ store: createMemoryTagLedgerStore(), newId: () => `id${++n}`, now: () => new Date('2026-03-01T00:00:00Z') })
  }
  it('同一次写入里同一个标签只留最后一条；与现有立场相同的不重复写；层级变了算新立场', async () => {
    const ledger = setup()
    const w1 = await ledger.assert('openalex:W5', [{ op: 'add', tag: 'Sleep' }, { op: 'remove', tag: '#sleep' }, { op: 'add', tag: 'ADHD' }], contributor)
    expect(w1.written.map((a) => [a.tag_key, a.op])).toEqual([['sleep', 'remove'], ['adhd', 'add']])
    const w2 = await ledger.assert('openalex:W5', [{ op: 'remove', tag: 'Sleep' }, { op: 'add', tag: 'ADHD' }], contributor)
    expect(w2).toEqual({ written: [], unchanged: ['sleep', 'adhd'], refused: [] })
    const promoted: EvidenceTagActor = { ...contributor, tier: 'editor' }
    expect((await ledger.assert('openalex:W5', [{ op: 'add', tag: 'ADHD' }], promoted)).written).toHaveLength(1)
    expect((await ledger.workTags('openalex:W5')).find((t) => t.tag_key === 'adhd')).toMatchObject({ decided_by: 'editor' })
  })
  it('模型置信度夹到 [0, 1]；置信度变了算新立场', async () => {
    const ledger = setup()
    const a = await ledger.assert('doi:10.1000/x', [{ op: 'add', tag: 'Diet', confidence: 7 }], modelA)
    expect(a.written[0].confidence).toBe(1)
    expect((await ledger.assert('doi:10.1000/x', [{ op: 'add', tag: 'Diet', confidence: 1 }], modelA)).unchanged).toEqual(['diet'])
    expect((await ledger.assert('doi:10.1000/x', [{ op: 'add', tag: 'Diet', confidence: 0.6 }], modelA)).written).toHaveLength(1)
  })
  it('作品 id 归一：不同写法落到同一个键；认不出的整批拒收', async () => {
    const ledger = setup()
    await ledger.assert('https://doi.org/10.1000/ABC', [{ op: 'add', tag: 'Sleep' }], editor)
    expect((await ledger.workTags('doi:10.1000/abc')).map((t) => t.tag_key)).toEqual(['sleep'])
    expect(await ledger.assert('not a work', [{ op: 'add', tag: 'Sleep' }], editor)).toEqual({ written: [], unchanged: [], refused: [{ tag: 'Sleep', refusal: 'invalid_work' }] })
    expect(await ledger.requestChange('nope', [{ op: 'add', tag: 'Sleep' }], editor, 'why')).toEqual({ ok: false, refusal: 'invalid_work' })
    expect(await ledger.workTags('nope')).toEqual([])
    expect(await ledger.openRequests('nope')).toEqual([])
  })
})

describe('⑦ 作品 id 与交换包', () => {
  it('normalizeWorkId', () => {
    expect(normalizeWorkId('https://openalex.org/w123')).toBe('openalex:W123')
    expect(normalizeWorkId('https://api.openalex.org/works/W9')).toBe('openalex:W9')
    expect(normalizeWorkId('openalex:w42')).toBe('openalex:W42')
    expect(normalizeWorkId('10.1000/ABC')).toBe('doi:10.1000/abc')
    expect(normalizeWorkId('doi: 10.1000/abc')).toBe('doi:10.1000/abc')
    expect(normalizeWorkId('onsite:42')).toBe('onsite:42')
    expect(normalizeWorkId('OnSite:my-post')).toBe('onsite:my-post')
    for (const bad of ['', 'W123', 'openalex:A1', 'doi:not-a-doi', 'https://example.com/x', 'onsite:', 'on site:1', 'onsite:a b', 42, null]) {
      expect([bad, normalizeWorkId(bad)]).toEqual([bad, null])
    }
  })
  it('贡献方打包 → 收包方验形（用自己的词表），往返一致', async () => {
    const tagger = createVocabularyTagger({ entries: [{ tag: 'ADHD' }, { tag: 'Sleep' }] })
    const run = (await runTagger(tagger, { work_id: 'openalex:W1', title: 'ADHD and sleep' }))!
    const empty = (await runTagger(tagger, { work_id: 'openalex:W2', title: 'Nothing here' }))!
    const pkg = buildTagContribution(tagger, [{ work_id: 'openalex:W1', suggestions: run.suggestions }, { work_id: 'openalex:W2', suggestions: empty.suggestions }])
    expect(pkg).toEqual({
      contract: EVIDENCE_CONTRACT_VERSION, tagger: { id: 'vocabulary', version: '1' },
      items: [{ work_id: 'openalex:W1', tags: [{ tag: 'ADHD', confidence: 0.7, rationale: 'matched "adhd" in title' }, { tag: 'Sleep', confidence: 0.7, rationale: 'matched "sleep" in title' }] }],
    })
    const v = validateTagContribution(JSON.parse(JSON.stringify(pkg)), { vocabulary: ['Sleep'] })
    expect(v.tagger).toEqual({ id: 'vocabulary', version: '1' })
    expect(v.items).toEqual([{ work_id: 'openalex:W1', suggestions: [{ tag_key: 'sleep', label: 'Sleep', confidence: 0.7, rationale: 'matched "sleep" in title' }] }])
    expect(v.dropped.out_of_vocabulary).toBe(1)
    expect(v.issues).toEqual([])
  })
  it('不可信输入：整包不成形、没写模型、超量、坏 id、重复、没有可收的标签——逐条报出，从不抛错', () => {
    for (const bad of [null, 'x', [], 42]) expect(validateTagContribution(bad).issues).toEqual([{ code: 'not_an_object', index: null }])
    expect(validateTagContribution({ tagger: { id: 'm' }, items: [] }).issues).toEqual([{ code: 'bad_tagger', index: null }])
    expect(validateTagContribution({ tagger: { id: 'bad id', version: '1' }, items: [] }).issues).toEqual([{ code: 'bad_tagger', index: null }])
    expect(validateTagContribution({ tagger: { id: 'm', version: '1' }, items: 'x' }).issues).toEqual([{ code: 'not_an_object', index: null }])
    const v = validateTagContribution({
      tagger: { id: 'alice/my-llm', version: '2026-09' },
      items: [
        { work_id: 'doi:10.1000/a', tags: [{ tag: 'Sleep', confidence: 0.9 }] },
        { work_id: 'https://doi.org/10.1000/A', tags: [{ tag: 'Sleep', confidence: 0.9 }] },
        { work_id: 'nonsense', tags: [{ tag: 'Sleep', confidence: 0.9 }] },
        { work_id: 'onsite:7', tags: [{ tag: '', confidence: 1 }, { tag: 'Diet', confidence: 0.1 }, 'junk'] },
        null,
        { work_id: 'onsite:8', tags: [{ tag: 'Diet', confidence: 0.5 }] },
      ],
    }, { minConfidence: 0.3, maxItems: 5 })
    expect(v.items.map((i) => i.work_id)).toEqual(['doi:10.1000/a'])
    expect(v.issues).toEqual([
      { code: 'too_many_items', index: null }, { code: 'duplicate_work', index: 1 }, { code: 'bad_work_id', index: 2 },
      { code: 'no_valid_tags', index: 3 }, { code: 'bad_work_id', index: 4 },
    ])
    expect(v.dropped).toEqual({ invalid: 2, out_of_vocabulary: 0, below_threshold: 1, over_limit: 0 })
    expect(presentContributionIssues(v.issues, { locale: 'zh' })[1].text).toBe('同一篇论文在包里出现了两次，后一条没有收。')
  })
  it('收包后写进账本：层级由收包方定，模型 id 加上贡献者前缀', async () => {
    const ledger = createTagLedger({ store: createMemoryTagLedgerStore() })
    const v = validateTagContribution({ tagger: { id: 'my-llm', version: '3' }, items: [{ work_id: 'onsite:9', tags: [{ tag: 'Sleep', confidence: 0.8 }] }] })
    for (const item of v.items) await ledger.submitSuggestions(item.work_id, item.suggestions, { id: `alice/${v.tagger!.id}`, version: v.tagger!.version })
    const [tag] = await ledger.workTags('onsite:9')
    expect(tag).toMatchObject({ tag_key: 'sleep', state: 'present', decided_by: 'model' })
  })
})

describe('⑧ 结论用到统计上', () => {
  const rec = (id: string, tags: string[], doi: string | null = null) => ({ id, doi, tags })
  const wt = (tag_key: string, state: 'present' | 'absent' | 'disputed', decided_by: EvidenceTagActor['tier'], label = tag_key) =>
    ({ tag_key, label, state, decided_by, support: {}, last_changed: '2026-01-01' })
  it('merge：去掉 absent / disputed，加上 present，账本没说的照旧；按 id 或 DOI 对上', () => {
    const decisions = new Map([
      ['onsite:1', [wt('adhd', 'absent', 'editor'), wt('sleep', 'present', 'model', 'Sleep'), wt('diet', 'disputed', 'editor')]],
      ['https://doi.org/10.1000/Z', [wt('anxiety', 'present', 'contributor', 'Anxiety')]],
    ])
    const r = applyWorkTags([rec('onsite:1', ['ADHD', 'Diet', 'Mood']), rec('onsite:2', ['ADHD'], '10.1000/z'), rec('onsite:3', ['ADHD'])], decisions)
    expect(r.records.map((x) => x.tags)).toEqual([['Mood', 'Sleep'], ['ADHD', 'Anxiety'], ['ADHD']])
    expect(r.stats).toEqual({ works_with_decisions: 2, added: 2, removed: 2, disputed_excluded: 1, model_decided: 1 })
    expect(r.caveats).toEqual(['model_decided_tags', 'disputed_tags_excluded'])
  })
  it('ledger_only：只用账本判 present 的；没有结论的记录没有标签', () => {
    const r = applyWorkTags([rec('onsite:1', ['ADHD', 'Mood']), rec('onsite:2', ['ADHD'])], new Map([['onsite:1', [wt('adhd', 'present', 'editor', 'ADHD')]]]), { mode: 'ledger_only' })
    expect(r.records.map((x) => x.tags)).toEqual([['ADHD'], []])
    expect(r.caveats).toEqual([])
  })
  it('服务接了账本：计数按裁决后的标签算，图注带上；ledger.apply=off 时不用；账本取不到 ⇒ unavailable', async () => {
    const articles = [
      { id: 1, title: 'A', tags: ['ADHD', 'Sleep'], year: 2024 },
      { id: 2, title: 'B', tags: ['ADHD'], year: 2024 },
      { id: 3, title: 'C', tags: ['ADHD', 'Diet'], year: 2025 },
    ]
    const ledger = createTagLedger({ store: createMemoryTagLedgerStore() })
    await ledger.assert('onsite:2', [{ op: 'remove', tag: 'ADHD' }], editor)
    await ledger.submitSuggestions('onsite:3', [{ tag_key: 'sleep', label: 'Sleep', confidence: 0.9, rationale: null }], { id: 'm', version: '1' })
    const service = createEvidenceService({ onsite: createMemoryOnsiteSource(articles), workTags: ledger })
    const tc = await service.getTagCounts('adhd')
    if (!tc.ok) throw new Error(tc.error)
    expect(tc.data.total).toBe(2)
    const tagSeries = tc.data.series.find((x) => x.dimension === 'tag')!
    expect(tagSeries.caveats).toContain('model_decided_tags')
    expect(tc.data.tag_graph!.caveats).toContain('model_decided_tags')
    const g = await service.getTagGraph({ minSupport: 1 })
    if (!g.ok) throw new Error(g.error)
    expect(g.data.nodes.find((n) => n.key === 'sleep')!.count).toBe(2)
    expect(g.data.caveats).toContain('model_decided_tags')

    // 模型决定的标签只在被筛掉的记录上 ⇒ 不带这条图注
    const more = [...articles, { id: 5, title: 'E', tags: ['Anxiety'], year: 2024 }, { id: 6, title: 'F', tags: ['Anxiety'], year: 2024 }]
    await ledger.assert('onsite:5', [{ op: 'remove', tag: 'Anxiety' }], editor)
    await ledger.submitSuggestions('onsite:5', [{ tag_key: 'sleep', label: 'Sleep', confidence: 0.9, rationale: null }], { id: 'm', version: '1' })
    const tcAnx = await createEvidenceService({ onsite: createMemoryOnsiteSource(more), workTags: ledger }).getTagCounts('anxiety')
    if (!tcAnx.ok) throw new Error(tcAnx.error)
    expect(tcAnx.data.total).toBe(1)
    expect(tcAnx.data.series.find((x) => x.dimension === 'tag')!.caveats).not.toContain('model_decided_tags')

    const off = createEvidenceService({ onsite: createMemoryOnsiteSource(articles), workTags: ledger, settings: { 'ledger.apply': 'off' } })
    const tcOff = await off.getTagCounts('adhd')
    expect(tcOff.ok && tcOff.data.total).toBe(3)

    const broken = createEvidenceService({
      onsite: createMemoryOnsiteSource(articles), log: () => {},
      workTags: { forWorks: async () => { throw new Error('db down') } },
    })
    expect(await broken.getTagCounts('adhd')).toEqual({ ok: false, error: 'unavailable' })
  })
})
