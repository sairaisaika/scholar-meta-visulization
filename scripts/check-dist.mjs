// 产物闸：打包之后再核对一遍——
//   ① 五个入口的 ESM 与 CJS 都能加载，关键导出都在；
//   ② 浏览器入口（index / client）的产物里没有任何外部源的地址或服务端代码。
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const require = createRequire(import.meta.url)
const EXPECT = {
  index: ['pickEvidenceView', 'normalizeTag', 'presentEvidenceMap', 'EVIDENCE_CONTRACT_VERSION'],
  client: ['createEvidenceClient'],
  service: ['createEvidenceService', 'createMemoryCache'],
  http: ['createEvidenceHandler', 'EVIDENCE_ROUTES'],
  openalex: ['createOpenAlexClient', 'createOpenAlexSource', 'fetchEvidenceCounts'],
}
// 只在服务端模块代码里出现的字符串（功能登记表里以数据形式出现的函数名不算，所以不用函数名当标记）
const SERVER_MARKERS = ['api.openalex.org', 'x-ratelimit-credits-used', '[evidence.service]', '[evidence.http]', '[evidence.openalex]']

let bad = 0
for (const [entry, names] of Object.entries(EXPECT)) {
  for (const file of [`${entry}.js`, `${entry}.mjs`, `${entry}.d.ts`, `${entry}.d.mts`]) {
    if (!existsSync(join(dist, file))) { console.log(`❌ 缺产物 dist/${file}`); bad++ }
  }
  const cjs = require(join(dist, `${entry}.js`))
  const esm = await import(pathToFileURL(join(dist, `${entry}.mjs`)).href)
  for (const n of names) {
    if (!(n in cjs)) { console.log(`❌ dist/${entry}.js 缺导出 ${n}`); bad++ }
    if (!(n in esm)) { console.log(`❌ dist/${entry}.mjs 缺导出 ${n}`); bad++ }
  }
}
for (const entry of ['index', 'client']) {
  for (const file of [`${entry}.js`, `${entry}.mjs`]) {
    const code = readFileSync(join(dist, file), 'utf8')
    for (const m of SERVER_MARKERS) if (code.includes(m)) { console.log(`❌ 浏览器入口产物 dist/${file} 里有服务端代码：${m}`); bad++ }
  }
}
if (bad) process.exit(1)
console.log('✅ 产物齐全，浏览器入口的产物里没有服务端代码')
