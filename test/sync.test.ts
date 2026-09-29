/**
 * 同步钩子（接入方靠这些跟上本仓）：
 *   ① 契约版本是合法的版本号，不超过包版本，CHANGELOG 里有这一版的一节；
 *   ② 规则文件在：CONTRIBUTING.md 写着边界，CLAUDE.md 导入它（AI 会话一进仓就读到）。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { EVIDENCE_CONTRACT_VERSION } from '../src/types'

const root = join(__dirname, '..')
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const parse = (v: string) => v.split('.').map(Number)
const cmp = (a: string, b: string) => {
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

describe('同步钩子', () => {
  it('① 契约版本', () => {
    expect(EVIDENCE_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    const pkg = JSON.parse(read('package.json')) as { version: string }
    expect(cmp(EVIDENCE_CONTRACT_VERSION, pkg.version)).toBeLessThanOrEqual(0)
    expect(read('CHANGELOG.md')).toMatch(new RegExp(`^## ${EVIDENCE_CONTRACT_VERSION.replace(/\./g, '\\.')}\\b`, 'm'))
  })
  it('② 规则文件', () => {
    expect(existsSync(join(root, 'CONTRIBUTING.md'))).toBe(true)
    expect(read('CONTRIBUTING.md')).toContain('判断标准只有一条')
    expect(read('CLAUDE.md')).toMatch(/^@CONTRIBUTING\.md$/m)
  })
})
