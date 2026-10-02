# Changelog

版本号遵循 semver 的 0.x 约定：0.x 期间，**次版本号**变化可能带破坏性改动，这里逐条写明。
契约（`src/types.ts`）默认只做加法；破坏性改动只在这里登记过的地方发生。

## 未发布

### 文档
- README「额度、隐私与已知限制」：子领域 / 领域 / 大类实体、按 DOI 批量查、往里一层与作品细节都已由 `live` 工作流对真实 API 核过（2026-10-02 全部通过），去掉「尚未实测」；写明期刊只在示例里数。

## 0.4.0（2026-10-02）

只有加法，没有破坏性改动：逐级下钻（往里一层、作品的期刊 / 免费链接 / 别的主题 / 同批引用）与审阅门槛。升级步骤见接入指南第 8 节「从 0.3 到 0.4」。

### 新增（契约，加法）
- 往里一层：`EvidenceMapData.children?: EvidenceTopic[] | null`（`null` ＝ 这次没取到，`[]` ＝ 往里没有）与 `children_partial?`；主题往里是编辑绑到它的站内标签（`level: 'tag'`，篇数＝站内文章数）。
- 作品细节：`EvidenceRecord.venue?`（`EvidenceVenue { id, name, type, is_oa, issn_l, publisher }`）、`oa_url?`、`topics?`（`EvidenceTopicRef[]`）、`cites?`（同一批里引用了谁）。
- 审阅门槛：`EvidenceRecord.reviewed_at?`、`EvidenceMapData.onsite_pending?`、`EvidenceOnsiteCounts.pending?`、`EvidenceTagGraph.pending?`；设置 `onsite.reviewGate`（`off` / `reviewed_only`，缺省 `off`）；入库问题 `awaiting_review`（只做标记）。
- 图注 `primary_location_only`（期刊按主要发表位置算）。
- `EVIDENCE_CONTRACT_VERSION = '0.4.0'`。

### 新增（代码）
- OpenAlex 适配器：`fetchNodeChildren(level, id)`（大类 → 领域 → 子领域 → 主题，按父过滤的列表，1 credit；第一页没拿到 ⇒ `null`，后面的页没拿到 ⇒ `partial`），外部源接口多一个可选方法 `children`；
  示例作品多取 `primary_location`、`topics`、`referenced_works` 三列（仍是 1 credit）：带上期刊、开放获取地址（只收 http(s)）、最多 5 个自己的主题，引用只留同一批里的。
- 服务：`getNodeMap` 带上往里一层（上级三级问外部源、缓存同缩放包、没取全的不进长缓存；主题级列出编辑绑定的站内标签与篇数）；
  `buildRecordEdges` 把外部作品自带的引用也连成引用边；审阅门槛开着时，标签图谱、主题图谱、站内层、共现图、编辑待办、绑定候选都只算审阅过的站内文章，并数出在等的篇数，`intake` 对没审阅的文章多回一条 `awaiting_review`。
- `applyReviewGate(records)`、`isReviewed(record)`：不用服务门面的接入方自己过门槛。
- 展示：`presentNodeChildren`（相对长度，不给占比）、`presentWorks`（期刊、能不能免费读、别的主题与标签、同批引用、被引数）、`presentRecordFacets`（这批作品还挂着的主题、站内标签、期刊——只在这批里数）；
  `presentEvidenceMap` 多 `children`，有在等审阅的文章时 `notices` 里说一句；`presentOnsiteCounts` 多 `pending_text`；`presentTagGraph` 的图注里说在等的篇数。
- 词典：`venueType` 一节、下钻与 `onsite_pending` 的模板（中英）。

### 行为变化
- `presentEvidenceMap` 的视图模型多一个 `children` 字段（没下发时为 `null`）。
- 几句英文的计数改成「名词: 数字」的写法，不再出现「1 articles」：`onsite_count`（`On-site articles: 3`）、`queue_articles`、`undeclared_design`、`unknown`、`sample`、`scope_other`、`graph_threshold`、`graph_collapsed`。中文不变。
- 服务层示例作品的缓存键换了（`sample2`），升级后每个节点第一次请求会重新取一次示例（1 credit）；共现图的缓存键带上审阅门槛，切换门槛立即生效。
- 行为快照：标签研究图谱那一例多了 `children: null`；新增一例「下钻」（子领域往里一层、主题往里的站内标签、作品清单、还挂着什么、同批引用）。

### 闸与测试
- `test/openalex.live.test.ts` 加往里一层与作品细节的实测；新工作流 `.github/workflows/live.yml`：手动触发，或推送改了适配器时对真实 API 跑一遍（有仓库 secret `OPENALEX_API_KEY` 就带上）。
- 服务、适配器、展示、入库、演示各加下钻与审阅门槛的用例。

### 文档
- 接入指南：第 1 节加「只让审阅过的文章进标签系统」，第 4 节加「下钻：从大类一路点到文章」，第 8 节加「从 0.3 到 0.4」；README 的诚实规则加一行、入口表与演示一节跟着改；架构文档的功能表加四行。
- 「这个节点的论文都发在哪些期刊」的全量分布暂不提供：外部源的分组只回前 200 个来源，按引擎的分母规则会算错，等有了「截断的格子」这种形状再加。

### 演示
- 新区块「下钻」：一棵虚构的分类树，从大类一路点到文章；文章的期刊、能不能免费读、还挂着的主题与标签、互相引用（指针停在一篇上会标出有引用关系的），以及审阅门槛的开关。跑的是引擎真正的服务层，外部源换成内存里的树，页面仍不连网。

## 0.3.0（2026-10-02）

**破坏性一处**：`EvidenceEffect.value` 可以是 `null`（见下，迁移只需改读它的地方）。其余是加法与修正。升级步骤见接入指南第 8 节。

### 破坏性（BREAKING）
- `EvidenceEffect.value` 由 `number` 改为 `number | null`：`null` ＝ 没有点估计（只申报了精确 p 与样本量——这样的研究能进信天翁那一级）。
  此前这种情况只能写 `NaN`，而 `NaN` 经过 JSON 就成了 `null`，类型对不上。
  **迁移**：读 `effect.value` 的地方改用 `pointEstimate(effect)`（有限的数才返回，否则 `null`）；TypeScript 会把要改的地方都标出来。引擎仍把 `NaN` 当作「没有」。

### 新增（契约，加法）
- 偏倚风险：`EvidenceRecord.risk_of_bias?`（`EvidenceRiskOfBias { tool, overall, source }`）；`EVIDENCE_ROB_TOOLS`（`rob2` / `robins_i` / `other`）、`EVIDENCE_ROB_JUDGEMENTS`、`EVIDENCE_ROB_SCALES`（每种工具认哪几档）。
- 敏感性分析：`EvidencePooling.sensitivity?`（`EvidencePoolingSensitivity`）。
- 证据确定性（GRADE）：`EvidenceMapData.certainty?`（`EvidenceCertainty { level, outcome, source, url?, rated_down_for?, rated_up_for? }`）；`EVIDENCE_CERTAINTY_LEVELS` / `EVIDENCE_CERTAINTY_DOWNGRADES` / `EVIDENCE_CERTAINTY_UPGRADES`。
- 入库问题：`ci_without_estimate`、`unknown_rob_tool`、`rob_judgement_invalid`、`rob_source_missing`。
- `EVIDENCE_CONTRACT_VERSION = '0.3.0'`。

### 新增（代码）
- `appraisal.ts`：`checkRiskOfBias` / `isValidRiskOfBias` / `robBand` / `isHighRiskOfBias` / `summarizeRiskOfBias`，`checkCertainty` / `checkCertainties`，`EVIDENCE_ROB_BANDS`、`APPRAISAL_TEXT_MAX`。
  引擎**不评**偏倚风险与证据确定性：只验形、如实转述（必须写明是谁评的），并只按成文的规则用。
- `poolEvidence`：参与汇总的研究里有偏倚风险高的（RoB 2「高」、ROBINS-I「严重」「极严重」、其他工具「高」）⇒ 另给去掉它们之后的判定与估计（Cochrane Handbook v6.5 §10.14）；主分析不变；没评过的不去掉。
- `intakeArticle` 收 `risk_of_bias`（写法宽松：`RoB 2`、`Some concerns`……；工具认不出、档位对不上、没写谁评的都整条不收并报问题）。
- 服务：可选端口 `CertaintySource`（内存实现 `createMemoryCertaintySource`）：标签级与节点级图谱带上这个范围的评级，逐条验形；取不到 ⇒ `certainty: null`；不接 ⇒ 不下发。
- 展示：`presentRiskOfBias`、`presentRiskOfBiasSummary`、`presentCertainty`（GRADE 符号 ⊕⊕◯◯ 与各档标准含义，Balshem et al. 2011）；`presentView` 多一句 `sensitivity_text`；
  `presentEvidenceMap` 多 `risk_of_bias`、`certainty`，没取到评级时 `notices` 里说一句。
- `pointEstimate(effect)`、`effectDecimals(metric, ciLow, ciHigh)`、`pickMachineCandidate`、`MACHINE_CANDIDATE_LIMIT`。
- 词典：`rob`、`certainty` 两节与相关模板（中英）。

### 修正（行为变化）
- **只有精确 p 与样本量的站内文章不再被入库丢掉**：点估计可以不填；填了但不合法只清点估计，p 与样本量照收；没有点估计的区间清掉（`ci_without_estimate`）。站内数据从此能到信天翁那一级。
- **标签配主题带上把握**：`resolveTopicForTag` 一次看最多 10 条候选（自动补全 0 credit），候选里有同名主题就取同名的（以前只取第一条），配上时带 `confidence: 'exact' | 'first_hit'`——
  短词、缩写的第一条常常只是字面上沾边，`first_hit` 必须如实标出来。服务层的机器绑定用同一个挑法；它的缓存键换了，升级后第一次请求会重新问一次。
- **汇总那句话的数字**：点估计与各区间同一个小数位（按 95% 置信区间的宽度定；比值、标准化效应量、相关系数、患病率至少 2 位；最多 4 位），负号用 U+2212（`−`）。

### 闸与测试
- 行为回归快照 `test/regression.test.ts`：阶梯与汇总、图种菜单的形状网格、入库验形、标签归一与绑定、站内层、共现图、统计、服务端到端；快照变了要在 CHANGELOG 写明行为变了什么。
- 安装包闸 `pnpm check:package`（并入 `pnpm check`）：按发版的方式打出 `.tgz`，在空目录里装上，CommonJS / ESM 各加载一遍五个入口，
  TypeScript 用 bundler 与 node16 两种解析编译接入方代码（连同包里的 `.d.ts`），再走一遍客户端 → 读口 → 服务。
- `test/appraisal.test.ts`；演示数据的效应量（含只有 p 与样本量的）与偏倚风险都过入库验形、入库前后同判。

### 文档
- 接入指南：加「偏倚风险与证据确定性」一节、「升级：从 0.2 到 0.3」；README 的诚实规则加一行；`docs/tags.md` 写明机器候选的挑法。
- 贡献规则：行为快照与安装包闸；提交信息与 PR 文字里不写会话链接。

### 演示
- 汇总场景改为 6 项随机试验，每项带虚构的偏倚风险评定：森林图右侧多一栏（颜色之外还有符号，没评过画空心圈）、敏感性分析、偏倚风险概况、一条虚构的证据确定性评级；
  设计混杂的场景里，队列研究的偏倚风险改用 ROBINS-I。

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
