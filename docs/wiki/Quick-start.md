# 快速开始

## 本地开发

在 SMV 仓库目录运行，Node 要求 `>=20`，包管理器声明为 `pnpm@10.33.0`：

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm exec jest --runInBand
pnpm demo
```

演示产物是 `demo/dist/index.html`。它使用虚构的内存数据与实际引擎源码，不会验证真实 OpenAlex、实际数据库或生产鉴权。完整检查命令是 `pnpm check`，其中边界与私有词检查需要 Bash；Windows 可使用 Git Bash。

发布包与 git 源码依赖的导出目标不同：`package.json` 当前源码入口是 `src/*.ts`，发布配置使用 `dist` 的 CJS / ESM / 类型声明。安装方式与框架转译要求见[原接入指南](../integration.md)。不要仅按源码入口推断安装包损坏，也不要将源码仓当作已经构建的安装包。

## 不连外部网络的最小例子

以下 TypeScript 放在能够解析 `scholar-meta` 的项目内，适合先核对自己的渲染链：

```ts
import { presentEvidenceMap } from 'scholar-meta'
import { createEvidenceService, createMemoryOnsiteSource } from 'scholar-meta/service'
import { createEvidenceHandler } from 'scholar-meta/http'

const evidence = createEvidenceService({
  onsite: createMemoryOnsiteSource([
    { id: 'demo-1', title: 'Example study', tags: ['sleep'],
      study_design: 'rct', direction: 'favours' },
  ]),
})

const result = await evidence.getTagMap('sleep')
if (result.ok) {
  const view = presentEvidenceMap(result.data, { locale: 'zh' })
  console.log(view)
} else {
  console.log(result.error)
}

const handler = createEvidenceHandler(evidence)
const response = await handler(new Request('https://example.invalid/api/evidence/map?tag=sleep'))
console.log(response.status, await response.json())
```

这里的 Request 直接交给处理函数，没有网络请求。示例只申报方向，不伪造效应量或置信区间。

## 逐步接入

1. 把公开文章映射成 `OnsiteArticle`，调用 `intake` 检查问题。
2. 先接站内数据，核对标签、分母、共现与图注。
3. 再接编辑绑定表、缓存和服务端 OpenAlex；明确提供预算。
4. 需要多人或模型贡献时再接账本，给写口加身份验证与授权。
5. 前端将返回数据交给 `present*`，保留失败、缺失、样本与降级说明。

SMT 当前没有可独立运行的程序，不存在另一个必须先启动的 SMT 服务。
