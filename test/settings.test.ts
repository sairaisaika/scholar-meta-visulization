/**
 * 插件设置与清单：
 *   ① 注册表与契约同一组键；每个设置项的缺省值自己验得过；
 *   ② 验值从不抛：认不出的键忽略（来自更新版本也不报错）、不合法的值退回缺省值，都记问题；数字 / 布尔的字符串写法也收；
 *   ③ 现读：短缓存、失败沿用上次的值、refresh 立刻重读；
 *   ④ 服务按「后台 > 代码选项 > 缺省」生效，改了下一次请求就生效；读口据设置开关路由、定缓存时长；外部源预算可以跟着设置走；
 *   ⑤ 清单与源码一致；两份清单的差别说得出新增 / 删除 / 改动的设置与功能。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EVIDENCE_SETTINGS, defaultSettings, validateSettings, createLiveSettings, settingsReader,
} from '../src/settings'
import { buildPluginManifest, diffPluginManifests } from '../src/manifest'
import { presentSettingsForm } from '../src/present'
import { createEvidenceService, createMemoryOnsiteSource } from '../src/service'
import { createEvidenceHandler } from '../src/http'
import { createOpenAlexClient } from '../src/openalex'
import type { EvidenceSettings } from '../src/types'

const root = join(__dirname, '..')

describe('① 注册表', () => {
  it('与契约同一组键（契约里的 EvidenceSettings 由类型钉住，这里核对运行时一侧）；缺省值自己验得过', () => {
    const keys = EVIDENCE_SETTINGS.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
    const v = validateSettings(defaultSettings())
    expect(v.issues).toEqual([])
    expect(v.provided).toEqual(defaultSettings())
    const types = readFileSync(join(root, 'src/types.ts'), 'utf8')
    const block = types.slice(types.indexOf('export interface EvidenceSettings {'), types.indexOf('export type EvidenceSettingKey'))
    expect([...block.matchAll(/^\s+'([a-zA-Z.]+)':/gm)].map((m) => m[1]).sort()).toEqual([...keys].sort())
  })
})

describe('② 验值', () => {
  it('合法的收下；字符串写法的数字与布尔也收', () => {
    const v = validateSettings({ 'external.sampleSize': '12', 'http.route.counts': 'false', 'binding.machinePolicy': 'exact_only', 'onsite.label': '  Journal  ' })
    expect(v.issues).toEqual([])
    expect(v.provided).toEqual({ 'external.sampleSize': 12, 'http.route.counts': false, 'binding.machinePolicy': 'exact_only', 'onsite.label': 'Journal' })
    expect(v.values['external.gate']).toBe('onsite_tags_only')
  })
  it('不合法的退回缺省值并记问题；认不出的键忽略；null 当没给', () => {
    const v = validateSettings({
      'external.sampleSize': 999, 'external.dailyCreditBudget': 1.5, 'binding.machinePolicy': 'always', 'http.route.map': 'yes',
      'onsite.license': 'x'.repeat(101), 'future.newThing': 1, 'graph.maxNodes': null,
    })
    expect(v.issues).toEqual([
      { key: 'external.sampleSize', code: 'out_of_range' },
      { key: 'external.dailyCreditBudget', code: 'wrong_type' },
      { key: 'binding.machinePolicy', code: 'not_an_option' },
      { key: 'http.route.map', code: 'wrong_type' },
      { key: 'onsite.license', code: 'too_long' },
      { key: 'future.newThing', code: 'unknown_key' },
    ])
    expect(v.values['external.sampleSize']).toBe(25)
    expect(v.provided).toEqual({})
    expect(validateSettings('nope').issues).toEqual([{ key: '*', code: 'not_an_object' }])
    expect(validateSettings(null)).toEqual({ values: defaultSettings(), provided: {}, issues: [] })
  })
})

describe('③ 现读', () => {
  it('短缓存；失败沿用上次；refresh 立刻重读', async () => {
    let t = 0
    let calls = 0
    let value: unknown = { 'external.sampleSize': 10 }
    const log = jest.fn()
    const live = createLiveSettings(async () => { calls++; if (value === 'boom') throw new Error('db'); return value }, { ttlMs: 1000, now: () => t, log })
    expect(live.peek().values['external.sampleSize']).toBe(25) // 还没读过
    expect((await live.get()).values['external.sampleSize']).toBe(10)
    value = { 'external.sampleSize': 11 }
    expect((await live.get()).values['external.sampleSize']).toBe(10) // 缓存内
    t = 1500
    expect((await live.get()).values['external.sampleSize']).toBe(11)
    value = 'boom'
    t = 3000
    expect((await live.get()).values['external.sampleSize']).toBe(11) // 读库失败沿用上次
    expect(log).toHaveBeenCalledWith('[evidence.settings] provider failed, keeping last values', { error: 'db' })
    value = { 'external.sampleSize': 12 }
    expect((await live.refresh()).values['external.sampleSize']).toBe(12)
    expect(calls).toBe(4)
  })
})

describe('④ 生效', () => {
  const articles = [{ id: 1, title: 'A', tags: ['adhd', 'sleep'] }, { id: 2, title: 'B', tags: ['adhd', 'sleep'] }]
  it('后台 > 代码选项 > 缺省；改了下一次请求就生效', async () => {
    let stored: Partial<EvidenceSettings> = {}
    const live = createLiveSettings(() => stored, { ttlMs: 0 })
    const service = createEvidenceService({ onsite: createMemoryOnsiteSource(articles), settings: live, onsiteLabel: 'Code label', sampleSize: 10, log: () => {} })
    let s = await service.settings()
    expect([s['onsite.label'], s['external.sampleSize'], s['graph.minSupport']]).toEqual(['Code label', 10, 2])
    stored = { 'onsite.label': 'Admin label', 'graph.minSupport': 3 }
    s = await service.settings()
    expect([s['onsite.label'], s['external.sampleSize'], s['graph.minSupport']]).toEqual(['Admin label', 10, 3])
    const g = await service.getTagGraph()
    expect(g.ok && [g.data.min_support, g.data.provenance.source_label]).toEqual([3, 'Admin label'])
    const intake = service.intake({ id: 'x', title: 'T' })
    expect(intake.record?.provenance.source_label).toBe('Admin label')
  })
  it('读口：后台关掉的路由回 404；缓存时长跟着设置', async () => {
    const service = createEvidenceService({ onsite: createMemoryOnsiteSource(articles), settings: { 'http.route.tagGraph': false, 'http.cacheMaxAge': 60 }, log: () => {} })
    const handler = createEvidenceHandler(service, { log: () => {} })
    expect((await handler(new Request('https://x/api/evidence/tags/graph'))).status).toBe(404)
    const ok = await handler(new Request('https://x/api/evidence/tags/counts?tag=adhd'))
    expect([ok.status, ok.headers.get('cache-control')]).toEqual([200, 'public, max-age=60, stale-while-revalidate=86400'])
    const fixed = createEvidenceHandler(service, { cacheControl: 'no-store', log: () => {} })
    expect((await fixed(new Request('https://x/api/evidence/tags/counts?tag=adhd'))).headers.get('cache-control')).toBe('no-store')
  })
  it('外部源预算可以是函数：跟着设置现取', async () => {
    let budget = 1
    const f = jest.fn(async () => ({ ok: true, status: 200, headers: new Headers({ 'x-ratelimit-credits-used': '1' }), json: async () => ({ meta: { count: 1 }, group_by: [] }) }))
    const c = createOpenAlexClient({ fetch: f as unknown as typeof fetch, dailyCreditBudget: () => budget, log: () => {} })
    expect(await c.groupByWorks('primary_topic.id:T1', 'type')).not.toBeNull()
    expect(await c.groupByWorks('primary_topic.id:T1', 'type')).toBeNull()
    budget = 5
    expect(await c.groupByWorks('primary_topic.id:T1', 'type')).not.toBeNull()
  })
  it('OpenAlex 客户端吃设置包：给了的键压过代码选项；认不出的键忽略；函数与现读设置每次现取', async () => {
    const res = (json: unknown) => ({ ok: true, status: 200, headers: new Headers({ 'x-ratelimit-credits-used': '1' }), json: async () => json })
    const f = jest.fn(async () => res({ meta: { count: 1 }, group_by: [] }))
    const bundle = { 'external.dailyCreditBudget': 1, 'future.unknownKey': true }
    const c = createOpenAlexClient({ fetch: f as unknown as typeof fetch, dailyCreditBudget: 100, log: () => {} }, bundle)
    expect(await c.groupByWorks('primary_topic.id:T1', 'type')).not.toBeNull()
    expect(await c.groupByWorks('primary_topic.id:T1', 'type')).toBeNull() // 设置包的 1 压过代码的 100
    // 函数：每次现取；样本数跟着 external.sampleSize（显式传的 limit 仍然优先）
    let size = 7
    const w = jest.fn(async () => res({ results: [] }))
    const c2 = createOpenAlexClient({ fetch: w as unknown as typeof fetch, log: () => {} }, () => ({ 'external.sampleSize': size }))
    await c2.fetchWorksForTopic('T1')
    size = 9
    await c2.fetchWorksForTopic('T1')
    await c2.fetchWorksForTopic('T1', 3)
    const perPage = w.mock.calls.map((call) => /per_page=(\d+)/.exec(String((call as unknown[])[0]))?.[1])
    expect(perPage).toEqual(['7', '9', '3'])
    // 现读设置（读库是异步的）：首个请求就等它读好，不拿缺省值凑数
    const live = createLiveSettings(async () => ({ 'external.sampleSize': 4 }))
    const w3 = jest.fn(async () => res({ results: [] }))
    await createOpenAlexClient({ fetch: w3 as unknown as typeof fetch, log: () => {} }, live).fetchWorksForTopic('T1')
    expect(String((w3.mock.calls[0] as unknown[])[0])).toContain('per_page=4')
    // 同步读取函数：回最近一次的值，过期了在后台重读
    let stored: Record<string, unknown> = { 'external.sampleSize': 6 }
    let clock = 0
    const live2 = createLiveSettings(async () => stored, { ttlMs: 10, now: () => clock })
    const read = settingsReader(live2)!
    expect(read().values['external.sampleSize']).toBe(25) // 还没读过：缺省值
    await live2.get()
    expect(read().values['external.sampleSize']).toBe(6)
    stored = { 'external.sampleSize': 8 }
    clock = 100
    expect(read().values['external.sampleSize']).toBe(6) // 过期：先回旧值，后台重读
    await live2.get()
    expect(read().values['external.sampleSize']).toBe(8)
  })
  it('清单：密钥只说要哪个、建议放在哪个环境变量，不带值；变更记录是相对路径', () => {
    const m = buildPluginManifest({ version: '0.2.0' })
    expect(m.changelog).toBe('CHANGELOG.md')
    expect(m.secrets).toEqual([expect.objectContaining({ key: 'external.apiKey', env: 'OPENALEX_API_KEY', required: false, entry: 'scholar-meta/openalex', option: 'apiKey' })])
    expect(m.secrets[0].label).toEqual({ zh: 'OpenAlex API key', en: 'OpenAlex API key' })
    expect(Object.keys(m.secrets[0]).sort()).toEqual(['entry', 'env', 'help', 'key', 'label', 'option', 'required'])
  })
  it('设置页视图：按组、带单位、生效方式、问题；认不出的键单列', () => {
    const v = validateSettings({ 'external.dailyCreditBudget': 100, 'external.sampleSize': 0, 'future.x': 1 })
    const form = presentSettingsForm(v.values, v.issues, { locale: 'zh' })
    expect(form.groups.map((g) => g.title)).toEqual(['标签绑定', '外部文献库', '缓存', '站内文章', '共现图', '公开读口', '标签账本'])
    const budget = form.groups[1].fields.find((f) => f.key === 'external.dailyCreditBudget')!
    expect(budget).toMatchObject({ value: 100, default: 5000, changed: true, unit_text: 'credit', apply_text: '改了立即生效', issue_text: null })
    const size = form.groups[1].fields.find((f) => f.key === 'external.sampleSize')!
    expect([size.value, size.issue_text]).toEqual([25, '超出允许范围，用缺省值。'])
    expect(form.groups[0].fields[0].options).toEqual([
      { value: 'first_hit', label: '第一条候选就用（图上标「未经确认」）' },
      { value: 'exact_only', label: '名称完全相同才用，其余等编辑' },
      { value: 'off', label: '只用编辑确认的' },
    ])
    expect(form.unknown).toEqual([{ key: 'future.x', text: expect.stringContaining('升级后会自动生效') }])
  })
})

describe('⑤ 清单', () => {
  it('仓根的清单与源码一致（版本号取 package.json）', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
    const file = JSON.parse(readFileSync(join(root, 'scholar-meta.manifest.json'), 'utf8'))
    expect(file).toEqual(JSON.parse(JSON.stringify(buildPluginManifest({ version: pkg.version }))))
    expect(file.settings[0]).toMatchObject({ key: 'binding.machinePolicy', label: { zh: '机器绑定策略', en: 'Automatic binding policy' } })
  })
  it('两份清单的差别', () => {
    const a = buildPluginManifest({ version: '0.2.0' })
    const b = JSON.parse(JSON.stringify(a))
    b.version = '0.3.0'
    b.contract_version = '0.3.0'
    b.settings.push({ ...b.settings[0], key: 'tagger.model' })
    b.settings = b.settings.filter((s: { key: string }) => s.key !== 'http.route.counts')
    b.settings.find((s: { key: string }) => s.key === 'external.sampleSize').default = 30
    b.features.push({ id: 'future_feature', audience: 'editor', route: null })
    expect(diffPluginManifests(a, b)).toEqual({
      from: '0.2.0', to: '0.3.0', contract_changed: true,
      settings_added: ['tagger.model'], settings_removed: ['http.route.counts'],
      settings_changed: [{ key: 'external.sampleSize', fields: ['default'] }],
      features_added: ['future_feature'], features_removed: [],
    })
  })
})
