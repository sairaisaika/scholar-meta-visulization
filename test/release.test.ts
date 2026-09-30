/**
 * 发版：CHANGELOG 里当前版本的一节能取出来当 release 说明（格式没被改坏），README 里的安装链接跟着版本走。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string }
const notes = (...args: string[]) => spawnSync('node', [join(root, 'scripts/release-notes.mjs'), ...args], { encoding: 'utf8' })
const asset = `https://github.com/sairaisaika/scholar-meta-visulization/releases/download/v${pkg.version}/${pkg.name}-${pkg.version}.tgz`

describe('发版', () => {
  it('取出当前版本那一节（不带标题、不混进别的版本），末尾附安装命令', () => {
    const r = notes()
    expect(r.status).toBe(0)
    const [body] = r.stdout.split('\n---\n')
    expect(body.trim().length).toBeGreaterThan(50)
    expect(r.stdout).not.toMatch(/^## /m)
    expect(r.stdout).not.toContain('## 未发布')
    expect(r.stdout).toContain(`pnpm add ${asset}`)
  })
  it('CHANGELOG 里没有的版本 ⇒ 失败并说明', () => {
    const r = notes('9.9.9')
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('9.9.9')
  })
  it('版本号要整段匹配：0.2 不会取到 0.2.0 那一节', () => {
    expect(notes('0.2').status).not.toBe(0)
  })
  it('两份 README 的安装链接都是当前版本', () => {
    for (const f of ['README.md', 'README.en.md']) expect([f, readFileSync(join(root, f), 'utf8').includes(asset)]).toEqual([f, true])
  })
})
