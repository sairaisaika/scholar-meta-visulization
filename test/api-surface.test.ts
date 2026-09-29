/**
 * 公开接口清单：五个入口运行时导出的名字钉在快照里（类型在运行时不存在，这里只管值）。
 * 快照变了＝公开接口变了：必须在 CHANGELOG 里写明加了 / 删了什么（CONTRIBUTING.md 第三节）。
 * 接入方只依赖这里列出来的东西。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ENTRIES: Record<string, string> = {
  'scholar-meta': 'index',
  'scholar-meta/openalex': 'openalex',
  'scholar-meta/service': 'service',
  'scholar-meta/http': 'http',
  'scholar-meta/client': 'client',
}

describe('公开接口', () => {
  it('入口清单与 package.json 的 exports 一致', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { exports: Record<string, string> }
    const fromPkg = Object.fromEntries(Object.entries(pkg.exports).map(([k, v]) => [k === '.' ? 'scholar-meta' : `scholar-meta/${k.slice(2)}`, v.replace(/^\.\/src\/|\.ts$/g, '')]))
    expect(fromPkg).toEqual(ENTRIES)
  })
  it.each(Object.entries(ENTRIES))('%s 导出的名字', (_entry, mod) => {
    expect(Object.keys(require(join(__dirname, '..', 'src', mod))).sort()).toMatchSnapshot()
  })
})
