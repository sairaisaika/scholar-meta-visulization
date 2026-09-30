// 取 CHANGELOG.md 里某一版的一节（标题下面到下一个「## 」为止），后面附上从 GitHub release 安装的命令，给 release 当说明。
// 用法：node scripts/release-notes.mjs [版本号]      （缺省＝package.json 的版本；CHANGELOG 里没有这一节就失败）
import { readFileSync } from 'node:fs'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json'))
const version = process.argv[2] ?? pkg.version

const lines = read('CHANGELOG.md').split('\n')
const heading = new RegExp(`^## ${version.replace(/\./g, '\\.')}(?![\\d.])`)
const start = lines.findIndex((l) => heading.test(l))
if (start < 0) {
  console.error(`❌ CHANGELOG.md 里没有 ${version} 这一节（发版前把「未发布」一节改名为 ## ${version}（日期））`)
  process.exit(1)
}
const next = lines.findIndex((l, i) => i > start && l.startsWith('## '))
const body = lines.slice(start + 1, next < 0 ? lines.length : next).join('\n').trim()
if (!body) {
  console.error(`❌ CHANGELOG.md 里 ${version} 这一节是空的`)
  process.exit(1)
}

const repo = String(pkg.repository?.url ?? pkg.repository).replace(/^git\+/, '').replace(/\.git$/, '')
const url = `${repo}/releases/download/v${version}/${pkg.name}-${version}.tgz`
process.stdout.write(`${body}\n\n---\n\n安装 / Install（npm、yarn 同样用这个链接）：\n\n\`\`\`bash\npnpm add ${url}\n\`\`\`\n`)
