# 贡献规则与边界

本仓是**开源的、与接入方无关的**研究证据可视化引擎。下面的规则在写第一行代码之前就生效，对人和对 AI 会话一样适用。

## 一、这个仓装什么、不装什么

**装**：与接入方无关的引擎——契约（`src/types.ts`）、判据、生产端、消费端、外部源适配、门面与读口；
方法与架构文档（`docs/`）；通用的接入指南（用占位符写，不写任何具体站点）；测试与闸。

**不装**（放在接入方自己的仓里）：

- 任何接入方站点的名字、品牌、域名、内部路径、数据库表名 / 列名、内部设计文档与决策记录的编号、功能的内部叫法；
- 接入方的产品文档、项目文档（产品需求、路线图、PRODUCT / PROJECT 之类的 md）、运营数据、用户数据、个人信息；
- 接入方与本仓之间的**同步规则、耦合规则**、拷贝契约的校验脚本、适配层代码（文章表映射、绑定表、缓存、路由鉴权）。

判断标准只有一条：**换一个完全不同的站点来接，这段内容还成立吗？** 不成立，就不属于这里。

## 二、公开的不只是文件

分支名、提交信息、PR 标题与正文、issue、标签名、发布说明——推上去就公开，一样守第一节。

- 维护者可以直接推 `main`（CI 跑 `pnpm check`）；要开分支时，分支名用中性的功能描述（如 `feat/tag-graph`、`fix/overlap-empty`），不带接入方的名字；
- 提交信息与 PR 说明只描述本仓的改动；需要接入方配合的地方，用通用措辞写「接入方需要做什么」。

## 三、接口与同步：接入方靠这些跟上

- **公开接口**＝五个入口（`scholar-meta`、`/openalex`、`/service`、`/http`、`/client`）导出的东西，
  清单钉在 `test/__snapshots__/api-surface.test.ts.snap`。没从入口导出的都是内部实现，接入方不许依赖。
- **契约只做加法**（加可选字段、加联合成员）。破坏性改动只能随次版本号（0.x 期间）发生，并在 CHANGELOG 那一版的「破坏性」一节写迁移步骤。
- 改 `src/types.ts` 时，把 `EVIDENCE_CONTRACT_VERSION` 改成将要发布的版本号；CHANGELOG 必须有这一版的一节（测试核对）。
- 公开接口清单变了（快照要更新），CHANGELOG 必须写明加了 / 删了什么。
- **行为**也钉着：`test/regression.test.ts` 把固定输入走一遍主要入口（阶梯与汇总、图种菜单、入库验形、标签绑定、站内层、共现图、服务端到端），输出存在 `test/__snapshots__/regression.test.ts.snap`。快照变了＝接入方看到的结果变了：确认是有意的再 `pnpm jest -u test/regression.test.ts`，并在 CHANGELOG 这一版写明行为变了什么。
- 装出来能不能用也钉着：`pnpm check:package` 按发版的方式打出 `.tgz`，在空目录里装上，用 CommonJS / ESM 各加载一遍五个入口，用 TypeScript 的 bundler 与 node16 两种解析各编译一遍接入方代码，再走一遍客户端 → 读口 → 服务。
- 接入方怎么同步由接入方在自己的仓里定。本仓的建议：钉住本仓的提交或版本；拷贝契约后在 CI 里逐字节比对并核对 `EVIDENCE_CONTRACT_VERSION`；升级前读 CHANGELOG 的「破坏性」一节。

## 四、写功能的规矩

- 每个功能都有**生产端与消费端**，登记在 `src/features.ts`，并在 `docs/architecture.md` 的功能表里加一行（测试核对两端都在、表没漏）。
- 加一样东西＝加一行：图种、维度、效应量度量、视图、图注限定、外部源、语言（见 `docs/architecture.md` 的扩展点表）。
- 生产端下发的每个键，消费端词典都要有一句话（`tsc` 查）。
- 服务端代码不许从浏览器入口运行时可达；只有 `src/openalex.ts` 与 `src/client.ts` 可以用 `fetch`（边界闸查源码，产物闸查打包结果）。
- 有的接入方把 `src/` 原样拷进自己的工程编译：`src/` 不加运行时依赖、不引 `node:*` 与 `process`，并且要过 `pnpm typecheck:src`（较严的编译选项、不带 Node 类型）。
- README 里「给接入方的约定」一表是对接入方的承诺：改其中任何一条，按破坏性改动处理。
- 浏览器能用的代码要能在 React Native / Hermes 上跑：不用 `URL`、`URLSearchParams`；用 `Intl` 时要有降级。
- 外部源失败回 `null`，绝不当成「没有研究」；「没问成」永不缓存。
- 数值算法要有独立参考实现（如 scipy）核对过的测试；引用文献写可核对的出处（期刊、卷期、DOI）。
- 源码注释与 `docs/` 以中文为主，README 保留英文一节。

## 五、提交之前

```bash
pnpm check        # tsc + 边界闸 + 私有词闸 + jest（含行为快照）+ 打包与产物闸 + 安装包闸 + 演示页（CI 在每次推送时跑同一条）
```

在本机仓根建 `.private-terms`（已 gitignore，每行一个不分大小写的正则），列上你自己接入的站点的私有词。
私有词闸查会被提交的文件、未推送的提交信息、未推送提交里加进去的行（先加后删也算），分支名给警告。
公开发布前再跑一次 `bash scripts/check-private-terms.sh --history`，审计全部历史与所有引用名。
CI 也能跑这道闸：把词表存成仓库 secret `PRIVATE_TERMS`（每行一个正则），CI 用隐去模式（`PRIVATE_TERMS_REDACT=1`）只印类别与处数——公开的日志里不出现私有词。

## 六、多个会话 / 多人同时开发

- 在本仓工作的会话只改本仓；接入方的仓由接入方的会话去改。跨仓的约定（接口怎么用、怎么同步、耦合到什么程度）写在接入方的仓里，本仓只提供通用接口、CHANGELOG 与这份规则。
- 需要交给接入方的材料（迁移清单、接线草图、私有的检查结果），作为文件交给维护者，不提交到本仓。

## 七、发版

1. 改 `package.json` 的 `version`（契约改了的话 `EVIDENCE_CONTRACT_VERSION` 一起改），跑 `pnpm manifest` 重新生成插件清单（清单里带版本号），把 CHANGELOG 顶上「未发布」一节改名为 `## x.y.z（日期）`，README 两份里的安装链接换成新版本（测试会核对）；
2. `pnpm check`，推到 `main`；
3. CI 跑绿后，`release` 工作流在这个提交上打 tag `vx.y.z`、建 GitHub release（说明取 CHANGELOG 这一节），附上编译好的安装包 `scholar-meta-x.y.z.tgz`；
   仓库设了 `NPM_TOKEN` 这个 secret 时同时发到 npm。已经发过的版本不会重发，只补缺的 release 或安装包（`scripts/release.sh`）。

---

## Contributing (English summary)

This repository is an open-source, **host-agnostic** engine. Never commit names, domains, internal paths, database schema names, internal document or decision identifiers, product plans, or personal data of any platform that integrates it — in code, docs, tests, commit messages, branch names or PR text. Host-specific sync and coupling rules, adapters, and product/project documents live in the host's own repository.
The public interface is whatever the five entry points export (locked by `test/__snapshots__/api-surface.test.ts.snap`); behaviour is locked too (`test/__snapshots__/regression.test.ts.snap`), and any change to either snapshot needs a CHANGELOG entry. `pnpm check:package` installs the packed tarball into an empty project and uses it through CommonJS, ESM, TypeScript (bundler and node16 resolution) and an end-to-end client → handler → service run. The contract in `src/types.ts` is additive-only; breaking changes happen only with a minor version bump (0.x) and a CHANGELOG migration note, and `EVIDENCE_CONTRACT_VERSION` must be updated whenever the contract changes.
Every feature needs a producer and a consumer registered in `src/features.ts`. Run `pnpm check` before committing, with a local, git-ignored `.private-terms` file listing your own platform's private terms.
To release, bump `version` in `package.json`, run `pnpm manifest`, rename the CHANGELOG's unreleased section to that version, update the install link in both READMEs, and push to `main`: once CI is green, the `release` workflow tags the commit, creates the GitHub release with the prebuilt package attached, and publishes to npm when an `NPM_TOKEN` secret is set.
