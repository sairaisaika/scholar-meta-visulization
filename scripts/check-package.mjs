// 安装包闸：把这次的产物按发版的同一种方式（pnpm pack，套用 publishConfig）打成 .tgz，在一个空目录里当依赖装上
// （本仓零运行时依赖：解开放进 node_modules 就是安装，不出网），再以接入方的身份用它——
//   ① 包的内容：有产物、许可、说明、清单、CHANGELOG；没有测试、演示、脚本与本机文件；exports 指向编译好的产物；
//   ② 五个入口按包的 exports 解析：CommonJS 的 require 与 ESM 的 import 都能用；
//   ③ 类型按 exports 解析：TypeScript 用 bundler 与 node16 两种解析各编译一遍接入方代码（连同包里的 .d.ts 一起查）；
//   ④ 端到端：浏览器客户端 → 读口 → 服务 → 内存端口，走一遍标签研究图谱（带偏倚风险与证据确定性），结果与契约一致。
// 发出去的是这个 .tgz（release 工作流附在 GitHub release 上），所以这里验的就是接入方拿到的东西。
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const work = mkdtempSync(join(tmpdir(), 'smv-package-'))
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
let bad = 0
const fail = (msg) => { console.log(`❌ ${msg}`); bad++ }

try {
  // ① 打包、看内容
  run('pnpm', ['pack', '--pack-destination', work], root)
  const tgz = readdirSync(work).find((f) => f.endsWith('.tgz'))
  if (!tgz) throw new Error('pnpm pack 没有产出 .tgz')
  if (tgz !== `${pkg.name}-${pkg.version}.tgz`) fail(`安装包名是 ${tgz}，应为 ${pkg.name}-${pkg.version}.tgz`)
  const files = run('tar', ['-tzf', join(work, tgz)], work).split('\n').filter(Boolean).map((f) => f.replace(/^package\//, ''))
  for (const need of ['package.json', 'LICENSE', 'README.md', 'README.en.md', 'CHANGELOG.md', 'scholar-meta.manifest.json', 'dist/index.mjs', 'dist/index.js', 'dist/index.d.ts', 'src/types.ts']) {
    if (!files.includes(need)) fail(`安装包里缺 ${need}`)
  }
  for (const f of files) {
    if (/^(test|demo|scripts|\.github|node_modules)\//.test(f) || /(^|\/)\.private-terms$/.test(f) || /\.test\.ts$/.test(f)) fail(`安装包里不该有 ${f}`)
  }

  // 「安装」：零依赖的包解开放进 node_modules 即可
  const app = join(work, 'app')
  mkdirSync(join(app, 'node_modules'), { recursive: true })
  run('tar', ['-xzf', join(work, tgz), '-C', join(app, 'node_modules')], work)
  renameSync(join(app, 'node_modules', 'package'), join(app, 'node_modules', pkg.name))
  const installed = JSON.parse(readFileSync(join(app, 'node_modules', pkg.name, 'package.json'), 'utf8'))
  if (installed.version !== pkg.version) fail(`装上的版本是 ${installed.version}，应为 ${pkg.version}`)
  if (installed.exports?.['.']?.import?.default !== './dist/index.mjs') fail('装上的 package.json 的 exports 没有指向编译好的产物（publishConfig 没套上）')
  if (Object.keys(installed.dependencies ?? {}).length > 0) fail(`运行时依赖应为空，实际有 ${Object.keys(installed.dependencies).join(', ')}`)
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }))

  // ② CommonJS：五个入口都能 require，关键导出都在
  writeFileSync(join(app, 'consumer.cjs'), `
const assert = require('node:assert/strict')
const want = {
  'scholar-meta': ['pickEvidenceView', 'poolEvidence', 'presentEvidenceMap', 'checkRiskOfBias', 'checkCertainty', 'pointEstimate', 'EVIDENCE_CONTRACT_VERSION'],
  'scholar-meta/service': ['createEvidenceService', 'createMemoryOnsiteSource', 'createMemoryCertaintySource'],
  'scholar-meta/http': ['createEvidenceHandler', 'EVIDENCE_ROUTES'],
  'scholar-meta/client': ['createEvidenceClient'],
  'scholar-meta/openalex': ['createOpenAlexClient', 'createOpenAlexSource'],
}
for (const [entry, names] of Object.entries(want)) {
  const m = require(entry)
  for (const n of names) assert.ok(n in m, entry + ' 缺导出 ' + n)
}
assert.equal(require('scholar-meta').EVIDENCE_CONTRACT_VERSION, ${JSON.stringify(readContractVersion())})
console.log('cjs ok')
`)
  run(process.execPath, ['consumer.cjs'], app)

  // ④ ESM 端到端：客户端 → 读口 → 服务 → 内存端口
  writeFileSync(join(app, 'consumer.mjs'), `
import assert from 'node:assert/strict'
import { presentEvidenceMap } from 'scholar-meta'
import { createEvidenceService, createMemoryCertaintySource, createMemoryOnsiteSource } from 'scholar-meta/service'
import { createEvidenceHandler } from 'scholar-meta/http'
import { createEvidenceClient } from 'scholar-meta/client'
import { createOpenAlexClient } from 'scholar-meta/openalex'

const articles = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1, title: 'Trial ' + (i + 1), tags: ['Sleep'], study_design: 'rct', direction: 'favours',
  effect: { metric: 'smd', value: 0.2 + i * 0.05, ci_low: i * 0.05 - 0.1, ci_high: 0.5 + i * 0.05, n: 100, higher_is_better: true },
  risk_of_bias: { tool: 'RoB 2', overall: i === 0 ? 'High' : 'low', source: 'Editor' },
}))
const service = createEvidenceService({
  onsite: createMemoryOnsiteSource(articles),
  certainty: createMemoryCertaintySource([{ scope: { level: 'tag', id: 'sleep' }, certainty: { level: 'moderate', outcome: 'Sleep quality', source: 'Review X' } }]),
  now: () => new Date('2026-10-01T00:00:00Z'), log: () => {},
})
const handler = createEvidenceHandler(service)
const api = createEvidenceClient({ baseUrl: 'https://host.example/api/evidence', fetch: (url, init) => handler(new Request(url, init)) })
const map = await api.getTagMap('sleep')
assert.ok(map, '读口没回数据')
assert.equal(map.view.kind, 'forest')
assert.equal(map.pooling.allowed, true)
assert.deepEqual([map.pooling.sensitivity.excluded, map.pooling.sensitivity.studies], [1, 5])
assert.equal(map.records.filter((r) => r.risk_of_bias).length, 6)
assert.equal(map.certainty.length, 1)
const view = presentEvidenceMap(map, { locale: 'en' })
assert.match(view.view.sensitivity_text, /^Excluding studies at high risk of bias \\(1 removed, 5 left\\): /)
assert.equal(view.certainty[0].symbol, '⊕⊕⊕◯')
assert.equal(view.risk_of_bias.text, 'Risk of bias (RoB 2): Low 5 · High 1')
assert.equal(await api.getTagMap(''), null) // 读口回 4xx ⇒ 客户端回 null，不当成「没有研究」
const offline = createOpenAlexClient({ fetch: async () => { throw new Error('offline') } })
assert.deepEqual(await offline.resolveTopicForTag('sleep'), { kind: 'error' })
console.log('esm ok')
`)
  run(process.execPath, ['consumer.mjs'], app)

  // ③ 类型：bundler 与 node16 两种解析；node16 下 .mts 走 import 条件、.cts 走 require 条件
  const consumerTs = `
import { pickEvidenceView, pointEstimate, presentCertainty, type EvidenceCertainty, type EvidenceRecord, type EvidenceRiskOfBias } from 'scholar-meta'
import { createEvidenceService, createMemoryOnsiteSource, type CertaintySource } from 'scholar-meta/service'
import { createEvidenceHandler } from 'scholar-meta/http'
import { createEvidenceClient, type EvidenceClient } from 'scholar-meta/client'
import { createOpenAlexClient, type TagTopicResolution } from 'scholar-meta/openalex'

const rob: EvidenceRiskOfBias = { tool: 'robins_i', overall: 'serious', source: 'Editor' }
const record: EvidenceRecord = {
  id: 'onsite:1', source: 'onsite', external_id: '1', title: 't', year: 2024, authors: [], doi: null, url: null, topic_ids: [],
  study_type: 'cohort', self_reported_claim: null, direction: 'favours', cited_by_count: null, is_retracted: false, is_open_access: null,
  effect: { metric: 'smd', value: null, ci_low: null, ci_high: null, n: 80, higher_is_better: true, p_value: 0.03 },
  provenance: { source_label: 'Site', license: 'CC BY 4.0', retrieved_at: '2026-10-01T00:00:00Z' }, risk_of_bias: rob,
}
const estimate: number | null = pointEstimate(record.effect)
const cert: EvidenceCertainty = { level: 'low', outcome: 'o', source: 's', rated_down_for: ['imprecision'] }
const certainty: CertaintySource = { forScope: async () => [cert] }
const service = createEvidenceService({ onsite: createMemoryOnsiteSource([]), certainty })
const handler: (r: Request) => Promise<Response> = createEvidenceHandler(service)
const api: EvidenceClient = createEvidenceClient({ baseUrl: '/api/evidence' })
const resolution: TagTopicResolution = { kind: 'matched', external_id: 'T1', display_name: 'x', works_count: null, confidence: 'exact' }
export const used = [pickEvidenceView([record]).kind, estimate, presentCertainty(cert).symbol, handler, api, resolution, createOpenAlexClient]
`
  writeFileSync(join(app, 'consumer.ts'), consumerTs)
  writeFileSync(join(app, 'consumer.mts'), consumerTs)
  writeFileSync(join(app, 'consumer.cts'), consumerTs.replace('export const used =', 'const used =') + '\nexport = used\n')
  const base = { strict: true, noEmit: true, target: 'es2022', lib: ['es2022', 'dom'], types: [], skipLibCheck: false, exactOptionalPropertyTypes: true }
  writeFileSync(join(app, 'tsconfig.bundler.json'), JSON.stringify({ compilerOptions: { ...base, module: 'esnext', moduleResolution: 'bundler' }, files: ['consumer.ts'] }))
  writeFileSync(join(app, 'tsconfig.node16.json'), JSON.stringify({ compilerOptions: { ...base, module: 'node16', moduleResolution: 'node16' }, files: ['consumer.mts', 'consumer.cts'] }))
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
  for (const config of ['tsconfig.bundler.json', 'tsconfig.node16.json']) {
    try { run(process.execPath, [tsc, '-p', config], app) } catch (e) { fail(`接入方代码按 ${config} 编译不过：\n${e.stdout || e.message}`) }
  }
} catch (e) {
  fail(e.stderr ? `${e.message}\n${e.stderr}` : String(e.stack || e))
} finally {
  rmSync(work, { recursive: true, force: true })
}

function readContractVersion() {
  const m = /^export const EVIDENCE_CONTRACT_VERSION = '([^']+)'/m.exec(readFileSync(join(root, 'src', 'types.ts'), 'utf8'))
  return m ? m[1] : null
}

if (bad) process.exit(1)
console.log(`✅ 安装包 ${pkg.name}-${pkg.version}.tgz：内容齐、exports 指向产物；require / import 五个入口都能用；bundler 与 node16 两种解析的类型都过；客户端 → 读口 → 服务端到端走通`)
