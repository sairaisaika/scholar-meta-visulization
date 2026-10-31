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
- [ ] **R14 / P0：标注平台仓（SMT）**。骨架、`scripts/`（intake · export · sample · replay · check · redact · release-export，node:test 25 例含端到端）与 `site/`（静态标注页，Playwright 29 例）已提交到 SMT `main`，依赖钉 v0.6.0 release 安装包。`sample` 已在 CI 真跑并并入（35 张名片 / 207 条模型建议，导出 35 篇）。剩余：维护者开 Pages（Source 选 GitHub Actions）并允许 Actions 创建 PR；用一条真实 issue 走通入库 → 导出 → `readCommunityExport`；归档片读回。
- [ ] **R15 / P1：演示页与宿主接真实数据**。`build-demo` 在有 `COMMUNITY_EXPORT_URL` 时下载导出，失败退回夹具并挂横幅；宿主按交接文件接 `createCommunityPorts`。
- [ ] **R16 / P2：OpenAlex 单实体 `/works/{id}` 计费探针**。`probe-openalex.mjs` 实测 `x-ratelimit-credits-used` 后再决定是否把它加进 `isFreeOpenAlexPath`。
- [ ] **R12 / 接入方：文刊功能接线**。维护者将[交接文档](Publication-integration-handoff.md)交给网站开发会话；由其在自己分支处理权限/存储/审核/页面与运行验收。本轮没有改网站仓，避免覆盖并行工作。

R01/R03 保留2026-10-17回执；R02/R04/R09见2026-10-21 [本轮验证](Development-verification-2026-10.md)。R05–R07与R10–R12仍有明确工作，R08持续维护；不宣称真实网站已安装、全文提取已达标或新npm版本已发布。
