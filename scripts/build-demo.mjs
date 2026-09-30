// 把演示页打成一个自带脚本与样式的 HTML：demo/dist/index.html。GitHub Pages 只发这一个文件；本机直接用浏览器打开也行。
// 判据与文案直接从 src/ 打进来，与发布的包是同一份源码。用法：pnpm demo
import { build } from 'tsup'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = join(root, 'demo', '.build')
const out = join(root, 'demo', 'dist')

rmSync(tmp, { recursive: true, force: true })
await build({
  config: false, // 不读仓根的 tsup.config（那是发布包用的）
  entry: { main: join(root, 'demo/src/main.ts') },
  format: ['iife'],
  platform: 'browser',
  target: 'es2019',
  outDir: tmp,
  minify: true,
  dts: false,
  sourcemap: false,
  splitting: false,
  silent: true,
})

// 内联进 HTML：脚本里的 </script 要转义；替换用函数，免得代码里的 $ 被当成替换模式
const js = readFileSync(join(tmp, 'main.global.js'), 'utf8').replace(/<\/script/gi, '<\\/script')
const css = readFileSync(join(root, 'demo/style.css'), 'utf8')
const html = readFileSync(join(root, 'demo/index.html'), 'utf8')
  .replace('<!-- STYLE -->', () => `<style>\n${css}</style>`)
  .replace('<!-- SCRIPT -->', () => `<script>\n${js}</script>`)
if (html.includes('<!-- STYLE -->') || html.includes('<!-- SCRIPT -->')) throw new Error('demo/index.html 缺占位')

mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'index.html'), html)
rmSync(tmp, { recursive: true, force: true })
console.log(`✅ demo/dist/index.html（${Math.round(Buffer.byteLength(html) / 1024)} KB）`)
