/**
 * 标签层：
 *   ① 正字法归一只做可解释的事：NFKC / 大小写 / 分隔符 / `#` / 不可见字符；不翻译、不做繁简、不合并同义词；
 *   ② 别名组：显示名取最常见的原文写法，计数按记录去重；
 *   ③ 绑定优先级：编辑绑定（含否决）> 机器命中 > 没问；`error` 是 unavailable 不是 no_match；
 *      `exact_only` 策略下非同名的机器命中进 needs_review；`off` 不做机器绑定；
 *      机器候选有同名的取同名的（不论名次），没有才取第一条（`first_hit`）。
 */
import {
  normalizeTag, groupTags, recordTagKeys, tagNameMatch, machineConfidence, resolveTagBinding, createCuratedBinding, splitTopicId,
  pickMachineCandidate, MACHINE_CANDIDATE_LIMIT,
} from '../src/tags'

describe('normalizeTag', () => {
  it.each([
    ['ADHD', 'adhd'], ['ＡＤＨＤ', 'adhd'], ['#ADHD', 'adhd'], ['  adhd  ', 'adhd'], ['＃ＡＤＨＤ', 'adhd'],
    ['Self-Esteem', 'self esteem'], ['self_esteem', 'self esteem'], ['self — esteem', 'self esteem'], ['self esteem', 'self esteem'],
    ['a​dhd', 'adhd'], ['COVID-19', 'covid 19'], ['焦虑', '焦虑'], ['焦虑　症', '焦虑 症'],
  ])('%j → %j', (raw, key) => expect(normalizeTag(raw)).toBe(key))

  it('繁简不合并、不翻译（那是语义判断，交给编辑绑定）', () => {
    expect(normalizeTag('焦慮')).not.toBe(normalizeTag('焦虑'))
    expect(normalizeTag('anxiety')).not.toBe(normalizeTag('焦虑'))
  })
  it('空、非字符串、超长 ⇒ null', () => {
    expect(normalizeTag('')).toBeNull()
    expect(normalizeTag('  #  ')).toBeNull()
    expect(normalizeTag(42)).toBeNull()
    expect(normalizeTag(null)).toBeNull()
    expect(normalizeTag('x'.repeat(101))).toBeNull()
    expect(normalizeTag('x'.repeat(100))).toBe('x'.repeat(100))
  })
})

describe('别名组', () => {
  const records = [
    { tags: ['ADHD', 'sleep'] },
    { tags: ['adhd', 'ADHD'] },          // 同一条记录里重复：只算一次
    { tags: ['ＡＤＨＤ', 'Sleep'] },
    { tags: ['ADHD'] },
    { tags: [] },
    {},
  ]
  it('计数按记录去重；显示名取最常见的原文写法', () => {
    const groups = groupTags(records)
    expect(groups.map((g) => [g.key, g.count, g.label])).toEqual([['adhd', 4, 'ADHD'], ['sleep', 2, 'Sleep']])
    expect(groups[0].variants).toEqual([{ raw: 'ADHD', count: 3 }, { raw: 'adhd', count: 1 }, { raw: 'ＡＤＨＤ', count: 1 }])
  })
  it('recordTagKeys 去重保序', () => {
    expect(recordTagKeys({ tags: ['B', 'a', 'b', '#A'] })).toEqual(['b', 'a'])
  })
})

describe('名字匹配与主题 id', () => {
  it('exact / contains / none', () => {
    expect(tagNameMatch('adhd', 'ADHD')).toBe('exact')
    expect(tagNameMatch('anxiety', 'Anxiety and Stress Disorders')).toBe('contains')
    expect(tagNameMatch('adhd', 'Attention Deficit Hyperactivity Disorder')).toBe('none')
    expect(machineConfidence('adhd', 'Attention Deficit Hyperactivity Disorder')).toBe('first_hit')
  })
  it('挑机器候选：有同名的取同名的（不论名次），没有才取第一条；没有候选 ⇒ null', () => {
    const c = (name: string) => ({ display_name: name })
    const long = c('Attention Deficit Hyperactivity Disorder')
    expect(pickMachineCandidate('adhd', [long, c('ADHD')])).toEqual({ candidate: c('ADHD'), confidence: 'exact' })
    expect(pickMachineCandidate('adhd', [long])).toEqual({ candidate: long, confidence: 'first_hit' })
    expect(pickMachineCandidate('app', [c('Plasma Diagnostics and Applications')])?.confidence).toBe('first_hit')
    expect(pickMachineCandidate(null, [c('ADHD')])).toEqual({ candidate: c('ADHD'), confidence: 'first_hit' })
    expect(pickMachineCandidate('adhd', [])).toBeNull()
    expect(MACHINE_CANDIDATE_LIMIT).toBe(10)
  })
  it('主题 id 验形：形状不对不拼进查询', () => {
    expect(splitTopicId('openalex:T10537')).toEqual({ source: 'openalex', external_id: 'T10537' })
    expect(splitTopicId('openalex:T1/../x')).toBeNull()
    expect(splitTopicId('T10537')).toBeNull()
    expect(splitTopicId(null)).toBeNull()
  })
})

describe('绑定优先级', () => {
  const at = '2026-09-29T00:00:00.000Z'
  const hit = { kind: 'matched' as const, topic_id: 'openalex:T10537', display_name: 'Attention Deficit Hyperactivity Disorder' }
  const curated = createCuratedBinding({ tag: 'ADHD', topic: { id: 'openalex:T1', display_name: 'X' }, by: 'editor-1', at })!
  const rejected = createCuratedBinding({ tag: 'adhd', topic: null, by: 'editor-1', note: '太宽', at })!

  it('编辑绑定压过机器命中；否决 ⇒ no_match', () => {
    expect(resolveTagBinding({ tagKey: 'adhd', curated, machine: hit })).toEqual({ binding: curated, external_match: 'matched' })
    expect(resolveTagBinding({ tagKey: 'adhd', curated: rejected, machine: hit })).toEqual({ binding: rejected, external_match: 'no_match' })
    expect(rejected.kind).toBe('rejected')
    expect(rejected.topic_id).toBeNull()
  })
  it('别的标签的编辑绑定不算数', () => {
    expect(resolveTagBinding({ tagKey: 'sleep', curated, machine: { kind: 'no_match' } }).external_match).toBe('no_match')
  })
  it('机器命中：first_hit 策略照绑但标可信度；exact_only 策略下进 needs_review', () => {
    const r = resolveTagBinding({ tagKey: 'adhd', machine: hit, at })
    expect(r.external_match).toBe('matched')
    expect(r.binding).toEqual({
      tag_key: 'adhd', topic_id: 'openalex:T10537', topic_name: 'Attention Deficit Hyperactivity Disorder', kind: 'machine', confidence: 'first_hit',
      bound_at: at, bound_by: null, note: null,
    })
    expect(resolveTagBinding({ tagKey: 'adhd', machine: hit, policy: 'exact_only' })).toEqual({ binding: null, external_match: 'needs_review' })
    const exact = resolveTagBinding({ tagKey: 'sleep', machine: { kind: 'matched', topic_id: 'openalex:T2', display_name: 'Sleep' }, policy: 'exact_only' })
    expect(exact.binding?.confidence).toBe('exact')
  })
  it('没问 ⇒ not_queried；没问成 ⇒ unavailable（不是 no_match）；off ⇒ not_queried', () => {
    expect(resolveTagBinding({ tagKey: 'adhd' }).external_match).toBe('not_queried')
    expect(resolveTagBinding({ tagKey: 'adhd', machine: { kind: 'error' } }).external_match).toBe('unavailable')
    expect(resolveTagBinding({ tagKey: 'adhd', machine: { kind: 'no_match' } }).external_match).toBe('no_match')
    expect(resolveTagBinding({ tagKey: 'adhd', machine: hit, policy: 'off' }).external_match).toBe('not_queried')
  })
  it('createCuratedBinding 拒绝不合法的标签与主题 id', () => {
    expect(createCuratedBinding({ tag: '   ', topic: null, by: null })).toBeNull()
    expect(createCuratedBinding({ tag: 'adhd', topic: { id: 'T1', display_name: 'x' }, by: null })).toBeNull()
  })
})

describe('移动端可移植性', () => {
  it('运行环境没有 String.prototype.normalize 时不崩，只是少做兼容字符折叠', () => {
    const original = String.prototype.normalize
    try {
      Object.defineProperty(String.prototype, 'normalize', { value: undefined, configurable: true, writable: true })
      expect(normalizeTag('#ADHD ')).toBe('adhd')
      expect(normalizeTag('ＡＤＨＤ')).toBe('ａｄｈｄ')
    } finally {
      Object.defineProperty(String.prototype, 'normalize', { value: original, configurable: true, writable: true })
    }
    expect(normalizeTag('ＡＤＨＤ')).toBe('adhd')
  })
})
