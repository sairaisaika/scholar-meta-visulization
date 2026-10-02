# CLAUDE.md

本仓是开源的、与接入方无关的引擎。动手之前先读下面导入的 CONTRIBUTING.md，尤其是第一、二、六节的边界。

硬规则（任何一条不满足都不要提交、不要推送）：

1. 不写任何接入方站点的名字、域名、内部路径、表名列名、内部文档编号、功能的内部叫法、产品决策、个人信息——代码、文档、测试、提交信息、分支名、PR 文字都算。
2. 接入方的同步规则、耦合规则、适配层代码、产品与项目文档不放本仓；要交给接入方的东西，作为文件交给用户，不提交。
3. 提交前跑 `pnpm check`。本机没有 `.private-terms` 时，先按对话里出现过的接入方私有词建一份（它已被 gitignore，不会提交）。
4. 维护者允许直接推 `main`；要开分支时，分支名用中性的功能描述，被指定的分支名里有接入方私有词时，推送前先问用户。
5. 改契约或公开接口：同步改 `EVIDENCE_CONTRACT_VERSION`、CHANGELOG、API 快照（`pnpm jest -u test/api-surface.test.ts` 后检查差异）；行为快照（`test/regression.test.ts`）变了同样要在 CHANGELOG 写明行为变了什么。
6. 提交信息与 PR 文字里不写会话链接（`Claude-Session:` 尾注或任何 `claude.ai/code/session_…` 链接）；已经推上去的提交不为此改写历史。

@CONTRIBUTING.md
