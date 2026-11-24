# 开发 TODO

更新：2026-10-31。研究依据见[工程研究](Engineering-research-2026-10.md)，既有 P1–P4 设计演练仍保留历史语境。稳定 ID 用于后续交接；勾选仅代表本项明确交付通过，不代表真实部署/模型质量/外部账户额度已验收。

- [x] **R01 / P0：结果式客户端**。独立工厂覆盖五个方法；区分 HTTP/网络/坏响应，保留 status/Retry-After，旧 factory 保持 data/null。退出：单元、HTTP 联调、类型及安装包验收与更新文档。
- [x] **R02 / P0：OpenAlex 当前合约**。普通列表100、分组200及有界cursor、批量50、计费头/429等待与实例预算核对；6次探针全部通过，完整live12/12（32次、30credits）。见[合约与旧CI失败记录](OpenAlex-contract-2026-10.md)。不是所有账户/嵌套分组/全局硬预算保证；真实429未强行制造，受控输入验其分支。
- [x] **R03 / P0：Windows 包验收**。修正 pnpm 子进程启动，实际执行 pack/install 与 CJS/ESM/TS/端到端，不跳过。
- [x] **R04 / P1：Provider 合约矩阵**。[共用可执行消费端合约](Provider-contract-matrix.md)20个案例覆盖可选能力/null/空/partial/抛错/缓存故障、并发与源前缀隔离。真实第二适配器、任意坏JSON与跨实例一致性未由此证明。
- [ ] **R05 / P1：标签全链路诊断**。模型与收包共用清洗、断言写入、审核与生效统计的计数/原因/出处分阶段；政策保持现状。
- [ ] **R06 / P1：审核提交契约设计**。部分失败、并发、幂等、原子性与宿主身份责任；先出设计，不凭函数名声称已保证。
- [ ] **R07 / P2：第二文献源评估**。R04 后论证 DOI 补全收益与能力差异，不把元数据当效应量或全量主题计数。
- [ ] **R08 / 持续：验收维护**。每次更新路由、计划状态、系统说明、证据与数字摘要；当前工作包未完成前不勾选整项。
- [x] **R09 / P1：多结局结构化收口与分面证据表**。新增 intakeOutcomeRows/buildSynthesisTable、语义/独立性/出处闸、复合组成保留、交互合成示例；24个案例与实际浏览器情景验证。见[实现边界](Outcome-synthesis.md)。不是任意全文自动提取或全站总分。
- [ ] **R10 / P1：真实文章提取与核对**。先定允许读取的公开/授权全文、原文段落定位、提取器/模型版本、结构化候选/拒绝、双核对审核与研究/版本去重；建立按文章类型分层的标注语料，分别报字段正确率/出处正确率/缺失与拒绝率。无基准不得自动开放合成；不要把本轮合成样例算真实论文准确率。
- [ ] **R11 / P2：复杂统计设计**。聚类/交叉/共享对照/重复量表的协方差或选择规则、复合结局公式与方差、率比/诊断准确性等专门模型；先独立方法核验与数值参照，不借other度量绕过。
- [x] **R13 / P0：社区标注的引擎侧（0.6.0）**。契约加法、比例裁决（`assessQuorum`，Wilson + 最少人数 + 挑战规则，pending 不是立场）、`community.ts`（断言裁决 / 整行盲复录 / 导出读回 / 宿主端口 / 合并）、frame 键与预览、阶梯差距、服务 `community` 端口、OpenAlex 名片与自动补全、展示与词典、功能五项、独立参考对表与回归快照一组；本机 `pnpm check` 全绿，提交 dc2398e。见[标签模型](Tagging-model.md)与[社区标注平台](Community-annotation.md)的实现核对。
- [ ] **R14 / P0：标注平台仓（SMT）**。骨架、`scripts/`（intake · export · sample · replay · check · redact · release-export，node:test 25 例含端到端）与 `site/`（静态标注页，Playwright 29 例）已提交到 SMT `main`，依赖钉 v0.6.0 release 安装包。`sample` 已在 CI 真跑并并入（35 张名片 / 207 条模型建议，导出 35 篇）。Pages（来源 GitHub Actions）与「允许 Actions 创建 PR」已于 2026-11-01 由维护者开通并核实（`export` 部署成功，Pages 上 `export/v1/` 可读；`sample` 手动运行自动开出 PR #2，仅刷新时间戳，已关闭未并入）。sample / replay 三个运维修补已入 SMT `main`（3147657 书架没变时不重写 sample.json；cc14f8d 已发布导出整个拉不到时不比对、不开 issue；2ae73e2 读远端文件缺失或失败时重试最多三次），CI check 与 export 均成功。剩余：用一条真实 issue 走通入库 → 导出 → `readCommunityExport`；归档片读回；下次 sample 真有新内容开 PR 时核对 PR 上的 `check` 正常跑（PR #2 上的 check 曾显示 failure 且 0 个作业，推测是 PR 排队时被关闭所致，未查明）。
- [ ] **R15 / P1：演示页与宿主接真实数据**。`build-demo` 在有 `COMMUNITY_EXPORT_URL` 时下载导出，失败退回夹具并挂横幅；宿主按交接文件接 `createCommunityPorts`。
- [x] **R17 / P1：宿主插件层（0.6.1）**。已落地：本机 `pnpm check` 全绿（Jest 589 passed / 12 skipped，快照 15 未变，安装包闸过）；见社区标注平台页实现核对 M14。`refreshCommunityExport`（注入 `fetch` / `sha256`，失败交回上一份）与 `mergeCommunityRecords`（换引擎键、取社区记录、与外部示例去重）；服务层共用同一份去重。计划见[社区标注平台](Community-annotation.md)「宿主插件层」。
- [ ] **R18 / P0：真人路径走通（G1）**。两个真实账号各一条 issue → 入库 → 比例裁决 → 导出 → 读回 → 当周重放通过。要人。见[检测基本盘](Verification-baseline.md)。
- [ ] **R19 / P0：改写能被发现（G2）**。已落地并观察到：只追加闸（CI）、`ledger.json`、当天存档 `data-2026-11-23`。剩余：平台主干禁止强推的仓库规则要维护者在页面上建；连续第二天的存档待观察。
- [x] **R20 / P0：检测节点进 CI（G3）**。标注页浏览器测试 28 例进仓并随 check 跑（CI 已观察）；样本 PR 开出前自检（下次样本运行时观察）。
- [x] **R21 / P1：批量入口与分片（G4）**。`pnpm bulk` 与 `import` 工作流；断言分片（20 MB）。还没有真实贡献包跑过；贡献包的标签目前只进质量评估、页面不显示。
- [ ] **R22 / P1：打标签质量度量（G5）**。算法与管道已落地（引擎 0.6.2 `scoreTagSets` / `scoreLabelAgreement`，平台 `data/gold`、`pnpm evaluate`、`quality.json`）。剩余：标准答案是空的，要维护者标；社区裁决结果对标准答案的评估未做。
- [x] **R23 / P2：频率如实与定时保活（G6）**。文档已改；保活步骤在 replay 工作流，效果待下次运行观察。
- [x] **R24 / P2：公开仓常规件（G7）**。安全政策、依赖更新配置、平台仓贡献规则、第三方 Action 钉提交号。依赖更新 PR 由维护者逐个决定。
- [x] **R25 / P0：第一批真实规模的模型标签（A / B）**。已在线上观察：平台 `tag` 运行 45296167865 → PR #11 → `import` 45296399407，账本 15413 条、11 月分成 4 片，导出 2623 篇；入库后的只追加检查 45296627695 与重放 45296630207（差异 0）通过。见[第一批真实规模的模型打标签](Tagging-at-scale.md)的结束对照。
- [x] **R26 / P0：模型建议上页（C）**。导出有 `suggestions` 旁路文件，作品页标明「模型建议 · 不计票」；浏览器测试（夹具导出与真实导出各一组）随 check 跑；线上页面冒烟随 replay 跑（运行 45300124138：6/6）。人还没有亲眼看过线上页面。
- [x] **R27 / P1：社区裁决对标准答案（D）**。`quality.json` 与 `pnpm evaluate` 有 `consensus`，夹具测试覆盖。线上仍是「没有标准答案」——真实数字要等 R22 的人标标准答案。
- [x] **R28 / P1：宿主分片存储（E）**。引擎 0.6.3：端口类型 `CommunityShardStore` 与四个函数 `refreshCommunityShards`、`readCommunityShards`、`mergeCommunityRecordsFromShards`、`createMemoryShardStore`；2 万篇合成实测写在接入指南。没有宿主用上；装配一张图不比常驻内存的整份快照快。
- [ ] **R29 / P2：批量打标签的已知边界**。从本仓打标签器的包里整条拿掉一篇不被可复现检查判为不一致；模型不能撤回对某篇的回答；首页不能按模型建议的标签浏览；只有一个种子主题。
- [ ] **R16 / P2：OpenAlex 单实体 `/works/{id}` 计费探针**。`probe-openalex.mjs` 实测 `x-ratelimit-credits-used` 后再决定是否把它加进 `isFreeOpenAlexPath`。
- [ ] **R12 / 接入方：文刊功能接线**。维护者将[交接文档](Publication-integration-handoff.md)交给网站开发会话；由其在自己分支处理权限/存储/审核/页面与运行验收。本轮没有改网站仓，避免覆盖并行工作。

R01/R03 保留2026-10-17回执；R02/R04/R09见2026-10-21 [本轮验证](Development-verification-2026-10.md)。R05–R07与R10–R12仍有明确工作，R08持续维护；不宣称真实网站已安装、全文提取已达标或新npm版本已发布。
