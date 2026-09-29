/**
 * 私有词闸（在一个一次性的 git 仓库里跑脚本本体）：
 *   ① 文件里有 ⇒ 失败；② 先加后删（未推送）⇒ 仍失败（历史里还在）；③ 分支名有 ⇒ 只警告；
 *   ④ 没有词表 ⇒ 跳过；⑤ --history 审计全部历史。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const script = join(__dirname, '..', 'scripts', 'check-private-terms.sh')
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.org', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.org' }

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'private-terms-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env, stdio: 'pipe' }).toString()
  git('init', '-q', '-b', 'main')
  mkdirSync(join(dir, 'scripts'))
  copyFileSync(script, join(dir, 'scripts', 'check-private-terms.sh'))
  writeFileSync(join(dir, '.gitignore'), '.private-terms\n')
  writeFileSync(join(dir, '.private-terms'), '# 注释\nacme[ -]?corp\n')
  writeFileSync(join(dir, 'a.txt'), 'hello\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  const run = (...args: string[]) => {
    try {
      return { code: 0, out: execFileSync('bash', ['scripts/check-private-terms.sh', ...args], { cwd: dir, env, stdio: 'pipe' }).toString() }
    } catch (e) {
      const err = e as { status: number; stdout: Buffer }
      return { code: err.status, out: err.stdout.toString() }
    }
  }
  return { dir, git, run, done: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('私有词闸', () => {
  it('① 文件里有 ⇒ 失败', () => {
    const r = repo()
    writeFileSync(join(r.dir, 'b.txt'), 'made by Acme Corp\n')
    const out = r.run()
    expect(out.code).toBe(1)
    expect(out.out).toContain('b.txt:1:made by Acme Corp')
    r.done()
  })
  it('② 先加后删、还没推送 ⇒ 仍失败（历史里还在）', () => {
    const r = repo()
    writeFileSync(join(r.dir, 'b.txt'), 'acme-corp inside\n')
    r.git('add', '.'); r.git('commit', '-q', '-m', 'add')
    writeFileSync(join(r.dir, 'b.txt'), 'clean\n')
    r.git('add', '.'); r.git('commit', '-q', '-m', 'remove')
    const out = r.run()
    expect(out.code).toBe(1)
    expect(out.out).toContain('加进去过私有词')
    r.done()
  })
  it('③ 分支名有 ⇒ 只警告；④ 没有词表 ⇒ 跳过', () => {
    const r = repo()
    r.git('checkout', '-q', '-b', 'feature/acme-corp-thing')
    const out = r.run()
    expect(out.code).toBe(0)
    expect(out.out).toContain('⚠️')
    expect(out.out).toContain('feature/acme-corp-thing')
    rmSync(join(r.dir, '.private-terms'))
    expect(r.run().out).toContain('跳过')
    r.done()
  })
  it('⑤ --history：全部历史与引用名', () => {
    const r = repo()
    writeFileSync(join(r.dir, 'b.txt'), 'AcmeCorp\n')
    r.git('add', '.'); r.git('commit', '-q', '-m', 'x')
    r.git('rm', '-q', 'b.txt'); r.git('commit', '-q', '-m', 'y')
    r.git('update-ref', 'refs/remotes/origin/main', 'HEAD') // 假装都推过了：缺省模式不再管
    expect(r.run().code).toBe(0)
    const h = r.run('--history')
    expect(h.code).toBe(1)
    expect(h.out).toContain('全部历史里加进去过私有词')
    r.done()
  })
})
