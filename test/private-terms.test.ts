/**
 * 私有词闸（在一个一次性的 git 仓库里跑脚本本体）：
 *   ① 文件里有 ⇒ 失败；② 先加后删（未推送）⇒ 仍失败（历史里还在）；③ 分支名有 ⇒ 只警告；
 *   ④ 没有词表 ⇒ 跳过；⑤ --history 审计全部历史；⑥ 调用者的环境（GIT_DIR、PRIVATE_TERMS_FILE、全局 git 配置）漏不进来；
 *   ⑦ 隐去模式（CI 用）只印处数，不印命中的内容。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const script = join(__dirname, '..', 'scripts', 'check-private-terms.sh')

/**
 * 子进程只拿干净的环境：调用者的 GIT_*（比如 git 钩子里设的 GIT_DIR，会让下面的 init / commit 落进调用者的仓）、
 * PRIVATE_TERMS_*（会顶掉夹具的词表）和全局 / 系统 git 配置（签名、钩子、模板）都不许漏进来。
 */
function isolatedEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) if (!k.startsWith('GIT_') && !k.startsWith('PRIVATE_TERMS')) out[k] = v
  return {
    ...out, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.org', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.org',
  }
}

function repo(env: NodeJS.ProcessEnv = isolatedEnv(process.env)) {
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
  it('⑥ 调用者环境里的 GIT_DIR / PRIVATE_TERMS_FILE 漏不进来：一次性仓库照常工作，别人的仓一个提交都不多', () => {
    const decoy = repo()
    const before = decoy.git('rev-list', '--count', 'HEAD').trim()
    const hostile = { ...process.env, GIT_DIR: join(decoy.dir, '.git'), GIT_WORK_TREE: decoy.dir, PRIVATE_TERMS_FILE: join(decoy.dir, 'nope') }
    const r = repo(isolatedEnv(hostile))
    writeFileSync(join(r.dir, 'b.txt'), 'made by Acme Corp\n')
    expect(r.run().code).toBe(1) // 用的是夹具自己的词表
    expect(decoy.git('rev-list', '--count', 'HEAD').trim()).toBe(before)
    r.done()
    decoy.done()
  })
  it('⑦ 隐去模式：只印类别与处数，不印命中的内容与文件名', () => {
    const r = repo({ ...isolatedEnv(process.env), PRIVATE_TERMS_REDACT: '1' })
    writeFileSync(join(r.dir, 'acme-corp.txt'), 'made by Acme Corp\nand acme corp again\n')
    const out = r.run()
    expect(out.code).toBe(1)
    expect(out.out).toContain('文件里有私有词')
    expect(out.out).toContain('2 处')
    expect(out.out).not.toMatch(/acme/i)
    r.done()
  })
})
