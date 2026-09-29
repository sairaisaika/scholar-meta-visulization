// 插件清单：由源码生成仓根的 scholar-meta.manifest.json（接入方的同步任务从 GitHub 取它）。
//   node scripts/manifest.mjs          生成 / 覆盖
//   node scripts/manifest.mjs --check  只核对（与源码不一致就失败——pnpm check 里跑这个）
// 需要先 tsup 打包（从 dist 取 buildPluginManifest）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const { buildPluginManifest } = await import(pathToFileURL(join(root, 'dist', 'index.mjs')).href)
const json = JSON.stringify(buildPluginManifest({ version: pkg.version }), null, 2) + '\n'
const file = join(root, 'scholar-meta.manifest.json')

if (process.argv.includes('--check')) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (current !== json) {
    console.log('❌ scholar-meta.manifest.json 与源码不一致：跑 `pnpm manifest` 重新生成后提交')
    process.exit(1)
  }
  console.log('✅ 插件清单与源码一致')
} else {
  writeFileSync(file, json)
  console.log(`✅ 已生成 scholar-meta.manifest.json（${pkg.version}）`)
}
