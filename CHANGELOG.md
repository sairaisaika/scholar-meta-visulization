# Changelog

版本号遵循 semver 的 0.x 约定：0.x 期间，**次版本号**变化可能带破坏性改动，这里逐条写明。
契约（`src/types.ts`）默认只做加法；破坏性改动只在这里登记过的地方发生。

## 0.2.1（2026-10-02）

只做加法：接入方照常同步即可（契约多一个可选字段，见下）。

### 新增（契约，只做加法）
- `EvidenceCountSeries.sample_gate?`（`EvidenceSampleGate { min, n, ok }`）：接入方样本门的回显——这一维有值的篇数与门槛。

### 新增（代码）
- 站内层可以只要部分维度、带接入方自己的样本门：`countOnsiteLayer(records, { …, dimensions?, sampleGates? })`。
  `dimensions` 只下发这几维的格子（缺省＝全部；`availability` 仍覆盖全部站内维度，契约形状不变）；
  `sampleGates[d]` ⇒ 这一维有值的篇数不到 N 时按 `sampleOk: false` 判图（除主题图与清单外先不画）并回显 `sample_gate`。
  引擎的比例门槛（`MIN_ONSITE_FOR_SHARE_CHARTS`）照常叠加，不做成设置。新导出 `onsiteValueCount`（样本门数的「有值篇数」）。
- `presentSeries` 原样转交 `sample_gate`；`presentOnsiteCounts` 只给下发了格子的维度出图种菜单；验形认得 `sample_gate`。

### 闸与测试
- 契约常量表证明「齐」：`test/contract-tables.test.ts` 在编译期核对每张「先有联合、后有表」的常量表覆盖联合的全部成员
  （漏了 `pnpm typecheck` 当场报出缺的值），阶梯表对照全部视图种类，全部常量表无重复值。
- 私有词闸的自测与调用者隔离：子进程不再继承调用者的 `GIT_*`（比如 git 钩子里的 `GIT_DIR` 会让自测的提交落进调用者的仓）、
  `PRIVATE_TERMS_*` 与全局 / 系统 git 配置；加了两条回归测试。
- 私有词闸加隐去模式（`PRIVATE_TERMS_REDACT=1`：只印类别与处数，不印命中的内容、文件名、引用名）；
  CI 从仓库 secret `PRIVATE_TERMS` 读词表并用隐去模式跑——公开的日志里不出现私有词。没设 secret 时照旧跳过。

### 文档
- README 加在线演示链接；接入指南「安装」改为 release 安装包为首选，补「只用站内层」的用法与「账本里的账号 id 用假名」。

### 发版与安装
- `release` 工作流（`.github/workflows/release.yml`，逻辑在 `scripts/release.sh`）：`main` 上 CI 跑绿后，`package.json` 的版本还没有 tag
  就在那个提交上打 tag、建 GitHub release（说明由 `scripts/release-notes.mjs` 从 CHANGELOG 取这一版的一节），附上编译好的安装包 `scholar-meta-x.y.z.tgz`；
  已经发过的版本只补缺的 release 或安装包，重复运行无害。仓库设了 `NPM_TOKEN` 时同时发到 npm（带来源证明）。
- 安装改为 `pnpm add <release 上的 .tgz 链接>`（npm、yarn 同样可用）：装的是编译好的产物，不再需要 `transpilePackages`。
- `CONTRIBUTING.md` 加「发版」一节；测试核对 CHANGELOG 能取出当前版本的一节、README 的安装链接是当前版本。

### 在线演示
- `demo/`：演示页。六组虚构研究走一遍证据阶梯（森林图与汇总菱形、点估计、信天翁、效应方向、证据与缺口），
  每一级写明满足条件的有几项、为什么不是更高一级；下半页的图种菜单可以拨格子的形状，看哪些图能画、画不了的差什么。
  判据与文案全部来自引擎本身；页面不发任何网络请求（CSP 锁死）；中英两种语言、明暗两种配色、手机上按实际宽度排版。
- `pnpm demo` 打成一个自带脚本与样式的 HTML（`demo/dist/index.html`），`pnpm check` 也构建它；
  `test/demo.test.ts` 核对每个场景确实落在它声称的那一级（引擎判据一改，演示对不上就红）。
- `.github/workflows/pages.yml`：`main` 上每次推送重新发布到 GitHub Pages；仓库还没打开 Pages 时只构建、不部署。

## 0.2.0（2026-09-29）

### 破坏性（BREAKING）
- `EvidenceSourceId` 里代表「宿主自己的文章」的那个成员改名为中性的 `'onsite'`（此前是某个具体站点的名字）。这是契约里**唯一**的非加法改动。
  迁移：宿主把自己的记录的 `source` 改成 `'onsite'`，记录 id 前缀随之变成 `onsite:`；按旧 id 存的缓存需要作废重算；
  存了旧 id 的地方（边的两端、链接里的视图状态、书签）一并迁移或做别名；`applyEvidenceFilters` 按 `'onsite'` 认站内记录。
  已经发出去、还在读旧值的客户端，由宿主在自己的接口层按客户端版本转换（引擎的契约里不再出现站点名）。
- 信天翁级（`albatross`）现在真的要求精确 p（`effect.p_value`），与文档和 Harrison et al. 2017 一致；此前只看方向与样本量。
- 汇总判定更严：另要求同一结局方向（`higher_is_better` 都申报且一致，否则 `orientation_unclear`）与同一研究设计（`mixed_designs`）；
  度量 `other` 视为不可合并（`mixed_metrics`）。
- `EvidenceCaveat` 从 `dimensions.ts` 挪进契约（`EVIDENCE_CAVEATS`）；从主入口 `scholar-meta` 导入不受影响。
- OpenAlex 计数里布尔维（撤稿、全球南方）的桶序固定为「真」在前。

### 新增（契约，只做加法）
- 标签绑定 `EvidenceTagBinding`（curated / machine / rejected，带可信度与出处）、绑定候选 `EvidenceBindingSuggestion`、编辑待办队列 `EvidenceBindingQueueItem`、
  外部层状态 `needs_review`、`EvidenceMapData.binding`。
- 站内维度 `ONSITE_DIMENSION_IDS`、站内层 `EvidenceOnsiteCounts`（`EvidenceCountsData.onsite`）、标签共现图 `EvidenceTagGraph`。
- 研究设计词表 `EVIDENCE_STUDY_DESIGNS`；入库问题码 `EVIDENCE_INTAKE_ISSUES`；`effect.p_value`；`EvidenceRecord.tags`；
  `EvidenceCell.provisional`；`EvidenceCountSeries.caveats`；汇总估计 `EvidencePooling.estimate`。
- 各联合类型的运行时数组（`EVIDENCE_CHART_BLOCKERS`、`EVIDENCE_DOWNGRADE_REASONS` …），`EvidenceCountSeries` / `EvidenceOverlap` 的维度泛型参数。

- 图不能画的原因加 `needs_more_onsite`（读占比的图：格子来自站内文章、篇数不到比例门槛）。

### 新增（代码）
- 按形状判图种可用性：`chartAvailabilityFor(shape)`、`chartShapeOf(ctx)`、`ChartShape`（`partition` · `buckets` · `isYear` · `hasCross` ·
  `hasOverlap` · 可选 `sampleOk` · `onsite_n` · `records`）、`MIN_ONSITE_FOR_SHARE_CHARTS`。`chartAvailability(ctx)` 改成薄包装，行为与改写前逐项相同
  （测试把改写前的实现冻结下来，在两万多种组合上逐项比对）；接入方自己的维度按形状判，不必冒充已有维度。
  `needs_more_onsite` 两个来源：站内篇数不到引擎的比例门槛（只挡读占比的四张）；接入方自己的样本门 `sampleOk: false`（挡主题图与清单以外的全部）。
  站内层按文章数用上它。
- 入口吃设置包：`createOpenAlexClient(opts, settings?)`、`createOpenAlexSource(opts, settings?)`（用 `external.dailyCreditBudget`、`external.sampleSize`；
  静态对象、同步函数或现读设置都行，现读设置在每次请求前等它读好；给了的键压过代码选项；认不出的键忽略）；
  `createEvidenceService({ settings })` 同样三种形态都收；`settingsReader`（现读设置过期时在后台重读）。
- 清单：`secrets`（插件要用的密钥，只说建议的环境变量名与交给哪个入口，值永远不进清单；`EVIDENCE_PLUGIN_SECRETS`）；`changelog` 改为仓内相对路径；
  清单代码从 `settings.ts` 挪到 `manifest.ts`（主入口导出不变）。
- 标签层 `src/tags.ts`、学术文章入库与站内层 `src/onsite.ts`、效应量度量注册表 `src/effects.ts`、统计小件 `src/stats.ts`
  （Wilson 区间、比例可靠性门槛、t 分布、REML + HKSJ + 预测区间）。
- 消费端 `src/present.ts`、中英词典 `src/messages.ts`、响应验形 `src/guards.ts`、功能登记表 `src/features.ts`。
- 并入主干上的读者筛选 `applyEvidenceFilters`（主入口新导出）与四级缩放包 `fetchNodeBundle`（同父兄弟走列表、带篇数、翻页）；
  筛选按筛后记录连汇总估计一起重算；缩放包兄弟没取全时带 `partial: true`，服务层不写长缓存；免费路径按实测更正为只有自动补全与主题实体。
- 记录之间的边的生产端 `buildRecordEdges`（主入口新导出）：参考文献 DOI 对出的引用边、站内文章的同标签边，服务层随图谱下发。
- 编辑待办队列：`service.bindingQueue()`（还没有编辑结论的标签，按文章数排，带读者现在看到的状态与机器候选）与 `presentBindingQueue`。
- 新入口：`scholar-meta/service`（门面与端口）、`scholar-meta/http`（Web 标准读口）、`scholar-meta/client`（浏览器客户端）。
- OpenAlex：四级缩放包、按节点取示例、候选主题、按 DOI 取主主题、全量计数装配 `fetchEvidenceCounts`、每日 credit 预算、`createOpenAlexSource`。
- 记录级四张图（阳性率 / 收获 / 信天翁 / 森林）在给了记录时按阶梯同一套判据判定，不再恒灰。
- 文档：`docs/tags.md`（标签方法与参考文献）、`docs/architecture.md`、`docs/integration.md`。

### 清理与闸
- 源码注释、README 与测试里去掉了接入方站点的名字、宿主仓的内部路径、内部设计文档与决策记录的编号。
- 私有词闸 `scripts/check-private-terms.sh`：词表放在不进仓的 `.private-terms`；查文件、未推送的提交信息与提交里加进去的行（先加后删也算），分支名只警告；`--history` 审计全部历史与所有引用名。
- 边界闸：浏览器入口的运行时依赖图里不许有服务端模块（`scripts/check-entry-graph.mjs`）；只有 `openalex.ts` 与 `client.ts` 可以用 `fetch`。
- 提交 `pnpm-lock.yaml`，锁定开发依赖。

### 独立成库
- 打包：tsup 产出五个入口的 ESM + CJS + 类型声明（`pnpm build`），产物闸 `scripts/check-dist.mjs` 核对产物齐全、
  浏览器入口的产物里没有服务端代码；`publishConfig` 让以后 `pnpm publish` 发的是编译产物。去掉 `private`，补齐包元数据，`sideEffects: false`。
- CI：`.github/workflows/check.yml` 在推送到 `main` 与 PR 上跑 `pnpm check`。
- 移动端可移植：标签归一在没有 `String.prototype.normalize` 时不崩；链接校验不用 `URL`；客户端不用 `URLSearchParams`；
  视图模型在没有 `Intl` 时用简化格式。React Native / Hermes 上可以直接用主入口与 `/client`。
- 许可维持 MIT（宽松，允许商业站点直接使用，只需保留版权声明）；README 改为中英两份、结构化并加图。
- `engines.node` 放宽到 ≥ 20。

### 插件化：设置与清单
- 契约加 `EvidenceSettings`（设置项注册表，现 21 项，含下面标签账本的 3 项）、`EvidenceSettingDef`、`EvidencePluginManifest`、`EvidenceManifestDiff`。
- `src/settings.ts`（主入口新导出 `EVIDENCE_SETTINGS`、`defaultSettings`、`validateSettings`、`createLiveSettings`、`isLiveSettings`、
  `buildPluginManifest`、`diffPluginManifests`、`PLUGIN_REPOSITORY`）：接入方后台的插件页按注册表自动生成设置表单；
  值存在接入方的库里，服务与读口每次请求现读（后台 > 代码选项 > 缺省），改了就生效；认不出的键（来自更新版本）忽略不报错。
- `presentSettingsForm`：设置页视图模型（分组、单位、生效方式、问题、认不出的键）。
- 读口按设置开关路由（关掉回 404）、定缓存时长；OpenAlex 每日预算可以传函数，跟着设置现取。
- 仓根 `scholar-meta.manifest.json`：同一份声明的 JSON（带中英文案），`pnpm manifest` 生成，`pnpm check` 核对与源码一致；
  接入方的同步任务从 GitHub 取来，用 `diffPluginManifests` 与已装版本比对。

### 打标签的模型与标签账本
- 契约加 `EVIDENCE_TRUST_TIERS`、`EvidenceTagActor`、`EvidenceTagAssertion`、`EvidenceWorkTag`（`EVIDENCE_WORK_TAG_STATES`）、
  `EvidenceTagChangeRequest`（`EVIDENCE_CHANGE_REQUEST_STATUSES`）、`EVIDENCE_LEDGER_REFUSALS`、`EvidenceTagContribution`（`EVIDENCE_CONTRIBUTION_ISSUES`）；
  `EvidenceWorkTag.request_id`（结论由哪个修改申请审核通过而定）；
  图注加 `model_decided_tags`、`disputed_tags_excluded`；设置加 `ledger.modelMinConfidence`、`ledger.reviewTier`、`ledger.apply`。
- `src/tagging.ts`：模型端口 `EvidenceTagger` 与验形 `runTagger`（归一、受控词表、置信度门槛、上限；模型失败回 null）；
  参考实现 `createVocabularyTagger`；作品 id 归一 `normalizeWorkId`；交换包 `buildTagContribution` / `validateTagContribution`。
- `src/ledger.ts`：裁决 `resolveWorkTags`（每人最新立场、人压过模型；一级之内有经审核的立场就由最近的那条定，否则分歧即争议）、写入闸 `checkAssertion`
  （经审核的结论同级不能直接推翻，要再提申请）、
  修改申请 `openChangeRequest` / `decideChangeRequest` / `withdrawChangeRequest`、存储端口 `TagLedgerStore` 与内存实现、
  门面 `createTagLedger`、`applyWorkTags`（结论用到记录的标签上）、`ledgerPolicyFromSettings`。
- 服务加可选端口 `workTags`（`WorkTagSource`）：标签计数与共现图按裁决后的标签算并带图注；账本取不到回 `unavailable`。
- 视图模型 `presentTagSuggestions`、`presentWorkTags`（经审核的结论标 `reviewed`）、`presentChangeRequests`、`presentContributionIssues`；功能登记表加
  `auto_tagging`、`tag_ledger`、`tag_change_requests`、`tag_contributions`。文档 `docs/tagging.md`。

### 给接入方的约定（写进 README，改之前在这里说明）
- 缩放包的兄弟按 `works_count` 从多到少排（没有篇数的排最后，同数按 id）；此前是外部源列表的缺省顺序。
- `applyEvidenceFilters` 在只看站内时 `sources` 原样保留（加了测试钉住）。
- `src/` 零运行时依赖、零 IO（出网只在 `openalex.ts` 与宿主读口客户端 `client.ts`，`fetch` 都可注入）、不引 `node:*` 与 `process`：
  新增 `pnpm typecheck:src`（`tsconfig.src.json`：只编 `src/`、不带 Node 类型、较严的编译选项），`pnpm check` 与 CI 都跑。

### 边界与同步
- `CONTRIBUTING.md`：这个仓装什么、不装什么（接入方的同步 / 耦合规则、适配层、产品与项目文档一律放在接入方自己的仓里），
  公开的不只是文件（分支名、提交信息、PR 文字），接口与同步规则，写功能的规矩，多会话协作。`CLAUDE.md` 导入它。
- 同步钩子：契约版本 `EVIDENCE_CONTRACT_VERSION`；公开接口清单快照 `test/__snapshots__/api-surface.test.ts.snap`（清单一变 CHANGELOG 必写）。
- OpenAlex 真实 API 冒烟测试 `test/openalex.live.test.ts`（缺省跳过，`OPENALEX_LIVE=1` 才跑）。
