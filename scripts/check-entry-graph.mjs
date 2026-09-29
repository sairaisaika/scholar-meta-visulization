// 入口依赖闸：浏览器能用的入口（主入口 index、客户端 client）**运行时**不许（直接或间接）引到会出网 / 只该在服务端的模块。
// 只看运行时 import / export-from；`import type` / `export type` 编译后消失，不算。
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BROWSER_SAFE = ['src/index.ts', 'src/client.ts']
const SERVER_ONLY = ['src/openalex.ts', 'src/openalex-counts.ts', 'src/openalex-meta.ts', 'src/service.ts', 'src/http.ts']
const IMPORT_RE = [
  /^\s*import\s+(?!type\b)[^'"]*?\bfrom\s+['"](\.[^'"]+)['"]/gm,
  /^\s*import\s+['"](\.[^'"]+)['"]/gm,
  /^\s*export\s+(?!type\b)[^'"]*?\bfrom\s+['"](\.[^'"]+)['"]/gm,
]

function deps(file) {
  const src = readFileSync(join(root, file), 'utf8')
  const out = new Set()
  for (const re of IMPORT_RE) for (const m of src.matchAll(re)) {
    const target = join(dirname(file), m[1]) + '.ts'
    if (!existsSync(join(root, target))) throw new Error(`${file}: 解析不到 ${m[1]}`)
    out.add(target)
  }
  return out
}

let bad = 0
for (const entry of BROWSER_SAFE) {
  const seen = new Map([[entry, null]])
  const queue = [entry]
  while (queue.length) {
    const f = queue.shift()
    for (const d of deps(f)) if (!seen.has(d)) { seen.set(d, f); queue.push(d) }
  }
  for (const s of SERVER_ONLY) {
    if (!seen.has(s)) continue
    const chain = [s]
    for (let p = seen.get(s); p; p = seen.get(p)) chain.unshift(p)
    console.log(`❌ 浏览器入口 ${entry} 运行时引到了服务端模块：${chain.join(' → ')}`)
    bad++
  }
}
if (bad) process.exit(1)
console.log('✅ 浏览器入口的依赖图干净')
