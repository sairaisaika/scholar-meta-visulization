# 架构：五层、两端、一张登记表

```
┌──────────── 契约 src/types.ts（零导入，可整份拷走）──────────────┐
│  EvidenceRecord · EvidenceMapData · EvidenceCountsData · EvidenceTagBinding · EvidenceTagGraph …  │
└──────────────────────────────────────────────────────────────┘
       ▲ 生产端（服务端）                         消费端（浏览器）▼
┌─ 纯判据与纯生产 ─────────────┐           ┌─ 视图模型 ──────────────┐
│ ladder  charts  dimensions   │           │ present  messages       │
│ effects stats  tags  onsite  │           │ guards                  │
└──────────────┬──────────────┘           └───────────▲────────────┘
┌─ 外部源适配 ─┴──────────────┐                        │
│ openalex  openalex-counts    │                        │
└──────────────┬──────────────┘                        │
┌─ 门面与端口 ─┴──────────────┐   HTTP   ┌─ 客户端 ───┴────────────┐
│ service  ports               │ ───────▶ │ client                  │
│ http（Request → Response）   │          │（只打宿主自己的 API）    │
└──────────────────────────────┘          └─────────────────────────┘
```

| 入口 | 模块 | 在哪跑 | 会不会出网 |
|---|---|---|---|
| `scholar-meta` | types · ladder · charts · dimensions · effects · appraisal · stats · tags · onsite · filters · tagging · ledger · settings · manifest · messages · present · guards · features | 任何地方 | 不会 |
| `scholar-meta/client` | client（+ guards） | 浏览器 | 只打宿主自己的读口 |
| `scholar-meta/service` | service · ports | 服务端 | 通过外部源端口 |
| `scholar-meta/http` | http | 服务端 | 不直接出网 |
| `scholar-meta/openalex` | openalex · openalex-counts | 服务端 | 会（OpenAlex） |

---

## 每个功能都有生产端与消费端

下表与 `src/features.ts` 的 `EVIDENCE_FEATURES` 逐行对应；`test/features.test.ts` 核对两端的导出真实存在、payload 是契约里的类型、读口在服务端与客户端都有且没有孤儿读口；`test/docs.test.ts` 核对这张表没漏掉任何一个功能。

| 功能 | 谁看 | 两端之间流的契约 | 生产端 | 消费端 | 读口 |
|---|---|---|---|---|---|
| `evidence_map` | 读者 | `EvidenceMapData` | `service.getTagMap` | `presentEvidenceMap` | `GET /map?tag=` |
| `node_map` | 读者 | `EvidenceMapData` | `service.getNodeMap` | `presentEvidenceMap` | `GET /map?level=&id=` |
| `evidence_view` | 读者 | `EvidenceViewDecision` | `pickEvidenceView` | `presentView` | 随 `/map` |
| `pooling` | 读者 | `EvidencePooling` | `poolEvidence` | `presentView` | 随 `/map` |
| `pooling_sensitivity` | 读者 | `EvidencePoolingSensitivity` | `poolEvidence` | `presentView` | 随 `/map` |
| `risk_of_bias` | 读者 | `EvidenceRiskOfBias` | `checkRiskOfBias`（入库时由 `intakeArticle` 调） | `presentRiskOfBias` | 随 `/map`（在记录上） |
| `certainty` | 读者 | `EvidenceCertainty` | `checkCertainty`（服务层经 `CertaintySource` 取来后调） | `presentCertainty` | 随 `/map` |
| `tag_binding` | 读者 | `EvidenceTagBinding` | `resolveTagBinding` | `presentBinding` | 随 `/map` |
| `record_edges` | 读者 | `EvidenceEdge` | `buildRecordEdges` | `presentEvidenceMap` | 随 `/map` |
| `external_counts` | 读者 | `EvidenceCountsData` | `fetchEvidenceCounts` | `presentCounts` | `GET /counts` |
| `chart_availability` | 读者 | `EvidenceChartAvailability` | `chartAvailability` | `presentChartMenu` | 随 `/counts`、`/tags/counts` |
| `onsite_counts` | 读者 | `EvidenceOnsiteCounts` | `countOnsiteLayer` | `presentOnsiteCounts` | `GET /tags/counts` |
| `tag_graph` | 读者 | `EvidenceTagGraph` | `buildTagGraph` | `presentTagGraph` | `GET /tags/graph` |
| `article_intake` | 作者 | `EvidenceIntakeIssue` | `intakeArticle` | `presentIntakeIssues` | —（宿主的文章编辑器里调） |
| `binding_suggestions` | 编辑 | `EvidenceBindingSuggestion` | `service.suggestBindings` | `presentBindingSuggestions` | —（宿主的后台路由，要鉴权） |
| `binding_queue` | 编辑 | `EvidenceBindingQueueItem` | `service.bindingQueue` | `presentBindingQueue` | —（同上） |
| `curation` | 编辑 | `EvidenceTagBinding` | `service.curate` | `presentBinding` | —（同上） |
| `auto_tagging` | 编辑 | `EvidenceTagAssertion` | `runTagger` | `presentTagSuggestions` | —（接入方的打标签流程） |
| `tag_ledger` | 编辑 | `EvidenceWorkTag` | `resolveWorkTags` | `presentWorkTags` | —（接入方托管的账本） |
| `tag_change_requests` | 编辑 | `EvidenceTagChangeRequest` | `decideChangeRequest` | `presentChangeRequests` | —（同上，要鉴权） |
| `tag_contributions` | 编辑 | `EvidenceTagContribution` | `buildTagContribution` | `validateTagContribution` | —（接入方收包的写口，要鉴权） |
| `plugin_settings` | 编辑 | `EvidenceSettings` | `validateSettings` | `presentSettingsForm` | —（接入方后台的插件页） |
| `plugin_manifest` | 编辑 | `EvidencePluginManifest` | `buildPluginManifest` | `diffPluginManifests` | —（接入方的同步任务） |

最底层还有一环：生产端下发的每一个**键**（图注限定、画不了的原因、降级原因、绑定状态、入库问题、研究设计……）在 `messages.ts` 里都有一句人话。词典的每一节都是 `Record<契约联合类型, string>`，契约加一个键而词典没跟上，`tsc` 直接报错。

---

## 扩展点：加一样东西 = 加一行

| 要加 | 改哪里 | 什么会逼你把两端都写全 |
|---|---|---|
| 一种图 | `EVIDENCE_CHART_KINDS`（契约）+ `EVIDENCE_CHARTS` 一行判据（charts.ts） | 词典 `chart` / `blocker` 两节的类型；`chartsMatchContract` 测试 |
| 一个外部维度 | `EVIDENCE_DIMENSION_IDS` + `EVIDENCE_DIMENSIONS` 一行（互斥？分母？图注？） | 词典 `dimension` 节；`dimensionsMatchContract` 测试 |
| 一个站内维度 | `ONSITE_DIMENSION_IDS` + `ONSITE_DIMENSIONS` 一行 | 同上；`onsiteDimensionsMatchContract` 测试 |
| 一种效应量度量 | `EVIDENCE_EFFECT_METRICS` + `EFFECT_METRICS` 一行（无效应值？合法范围？分析尺度？） | 词典 `metric` 节；`effectMetricsMatchContract` |
| 一级视图 | `EVIDENCE_VIEW_LADDER` + `EVIDENCE_VIEWS` 一行（要求什么、至少几条） | 词典 `view` / `downgrade` 节；`viewLadderMatchesContract` |
| 一条图注限定 | `EVIDENCE_CAVEATS` 一项 | 词典 `caveat` 节 |
| 一个外部文献源 | 实现 `ExternalEvidenceSource`（ports.ts），`EvidenceSourceId` 加一个成员 | 服务层对所有源一视同仁；约定 null＝没问成、[]＝没有 |
| 一种语言 | 写一份 `EvidenceMessageCatalog` | 类型要求每一节每个键都写 |
| 一个功能 | `EVIDENCE_FEATURES` 一行 + 生产端 + 消费端 (+ 读口) | `test/features.test.ts`、`test/docs.test.ts` |

## 边界与同步

这个仓只装与接入方无关的东西；接入方的同步规则、耦合规则、适配层与产品 / 项目文档放在接入方自己的仓里（规则全文见 [CONTRIBUTING.md](../CONTRIBUTING.md)）。
本仓给接入方的同步钩子有三个：

| 钩子 | 在哪 | 接入方怎么用 |
|---|---|---|
| 契约版本 | `EVIDENCE_CONTRACT_VERSION`（`src/types.ts`） | 拷贝契约后逐字节比对，并核对版本号 |
| 公开接口清单 | `test/__snapshots__/api-surface.test.ts.snap` | 只依赖清单里的名字；清单一变 CHANGELOG 必写 |
| 迁移说明 | `CHANGELOG.md` 每一版的「破坏性」一节 | 升级前照着改 |

## 闸

`pnpm check` 依次跑：

1. `tsc`：契约联合类型 ↔ 词典的完整性在这里查；
2. `scripts/check-boundary.sh`：`src/` 里不许有宿主框架与环境变量；浏览器入口的**运行时**依赖图里不许有服务端模块（`check-entry-graph.mjs`）；只有 `openalex.ts` 与 `client.ts` 可以用 `fetch`；
3. `scripts/check-private-terms.sh`：宿主私有词（词表放在不进仓的 `.private-terms`）不许出现在会被提交的文件、未推送的提交信息、未推送提交里加进去的行里；分支名只警告；`--history` 审计全部历史与引用名；
4. `jest`：注册表与契约同源、功能两端都在、数值与 scipy 对过、每条诚实规则一个测试；
5. `pnpm build`：tsup 打出五个入口的 ESM + CJS + 类型声明，`scripts/check-dist.mjs` 核对产物齐全、浏览器入口的产物里没有服务端代码。

CI（`.github/workflows/check.yml`）在每次推送到 `main` 与每个 PR 上跑同一条 `pnpm check`。
