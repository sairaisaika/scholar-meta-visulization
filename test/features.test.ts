/**
 * 功能登记表：**每个功能都有生产端与消费端**（不是文档约定，是这里逐行核对的约束）。
 *   ① 两端的导出真实存在且是函数；服务方法真的构造一个服务去看；
 *   ② payload 是契约里真实导出的类型；
 *   ③ 读口在服务端与客户端路由表里都有、路径一致；每个读口至少被一个功能用到；
 *   ④ package.json 的 exports 与登记表用到的入口一一对应、文件存在。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { EVIDENCE_FEATURES } from '../src/features'
import type { EvidenceFeatureEnd } from '../src/features'
import { EVIDENCE_ROUTES } from '../src/http'
import { EVIDENCE_CLIENT_ROUTES, createEvidenceClient } from '../src/client'
import { createEvidenceService, createMemoryOnsiteSource } from '../src/service'

const root = join(__dirname, '..')
const types = readFileSync(join(root, 'src/types.ts'), 'utf8')
const load = (end: EvidenceFeatureEnd) => require(join(root, 'src', end.module)) as Record<string, unknown>

describe('功能登记表', () => {
  const service = createEvidenceService({ onsite: createMemoryOnsiteSource([]) }) as unknown as Record<string, unknown>

  it.each(EVIDENCE_FEATURES.map((f) => [f.id, f] as const))('%s：生产端与消费端都在', (_id, f) => {
    const producer = load(f.producer)[f.producer.export]
    expect(typeof producer).toBe('function')
    if (f.producer.method) expect(typeof service[f.producer.method]).toBe('function')
    expect(typeof load(f.consumer)[f.consumer.export]).toBe('function')
    expect(types).toMatch(new RegExp(`export (interface|type) ${f.payload}\\b`))
  })

  it('id 不重复；读者功能都走公开读口，作者 / 编辑功能都不走', () => {
    expect(new Set(EVIDENCE_FEATURES.map((f) => f.id)).size).toBe(EVIDENCE_FEATURES.length)
    for (const f of EVIDENCE_FEATURES) expect([f.id, f.route !== null]).toEqual([f.id, f.audience === 'reader'])
  })

  it('读口两端一致，没有孤儿读口；客户端对每个读口都有方法', () => {
    expect(EVIDENCE_CLIENT_ROUTES).toEqual(EVIDENCE_ROUTES)
    const used = new Set(EVIDENCE_FEATURES.map((f) => f.route).filter(Boolean))
    expect([...used].sort()).toEqual(Object.keys(EVIDENCE_ROUTES).sort())
    const client = createEvidenceClient() as unknown as Record<string, unknown>
    for (const m of ['getTagMap', 'getNodeMap', 'getCounts', 'getTagCounts', 'getTagGraph']) expect(typeof client[m]).toBe('function')
  })

  it('入口：登记表用到的入口都在 package.json 的 exports 里，文件存在', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { exports: Record<string, string> }
    const entries = new Set(EVIDENCE_FEATURES.flatMap((f) => [f.producer.entry, f.consumer.entry]))
    for (const e of entries) {
      const key = e === 'scholar-meta' ? '.' : `./${e.split('/')[1]}`
      expect([e, key in pkg.exports]).toEqual([e, true])
    }
    for (const file of Object.values(pkg.exports)) expect([file, existsSync(join(root, file))]).toEqual([file, true])
  })
})
