/**
 * 文档与代码同步：架构文档的功能表不许漏掉登记表里的任何一个功能；标签方法文档与打标签文档提到的函数都真实存在。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EVIDENCE_FEATURES } from '../src/features'
import * as main from '../src/index'
import * as service from '../src/service'
import { createMemoryTagLedgerStore, createTagLedger } from '../src/ledger'

const doc = (name: string) => readFileSync(join(__dirname, '..', 'docs', name), 'utf8')

describe('文档同步', () => {
  it('architecture.md 的功能表覆盖登记表里的每个功能，且写对了生产端与消费端', () => {
    const arch = doc('architecture.md')
    for (const f of EVIDENCE_FEATURES) {
      const row = arch.split('\n').find((l) => l.startsWith(`| \`${f.id}\``))
      expect([f.id, !!row]).toEqual([f.id, true])
      const producer = f.producer.method ? `service.${f.producer.method}` : f.producer.export
      expect([f.id, row!.includes(`\`${producer}\``), row!.includes(`\`${f.consumer.export}\``), row!.includes(`\`${f.payload}\``)])
        .toEqual([f.id, true, true, true])
    }
  })
  it('tags.md 里用反引号提到的函数名都真实导出', () => {
    const names = [...doc('tags.md').matchAll(/`([a-z][A-Za-z]+)`/g)].map((m) => m[1])
      .filter((n) => /^(normalize|group|resolve|suggest|build|count|cross|intake|pick|pool|present)[A-Z]/.test(n))
    expect(names.length).toBeGreaterThan(8)
    const exported = { ...main, ...service } as Record<string, unknown>
    const serviceMethods = ['suggestBindings']
    for (const n of new Set(names)) expect([n, typeof exported[n] === 'function' || serviceMethods.includes(n)]).toEqual([n, true])
  })
  it('tagging.md 里用反引号提到的函数与账本方法都真实存在', () => {
    const text = doc('tagging.md')
    const names = [...text.matchAll(/`([a-z][A-Za-z]+)`/g)].map((m) => m[1])
    const fns = names.filter((n) => /^(run|create|normalize|build|validate|resolve|check|open|decide|withdraw|ledger|apply|present)[A-Z]/.test(n))
    expect(fns.length).toBeGreaterThan(15)
    const exported = { ...main, ...service } as Record<string, unknown>
    for (const n of new Set(fns)) expect([n, typeof exported[n]]).toEqual([n, 'function'])
    const ledger = createTagLedger({ store: createMemoryTagLedgerStore() }) as unknown as Record<string, unknown>
    for (const m of ['submitSuggestions', 'assert', 'requestChange', 'decide', 'withdraw', 'workTags', 'forWorks']) {
      expect(text.includes(m) ? [m, typeof ledger[m]] : [m, 'function']).toEqual([m, 'function'])
    }
  })
})
