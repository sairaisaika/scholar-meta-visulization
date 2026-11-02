# 本轮开发验证（2026-11）

承接[2026-10 验证页](Development-verification-2026-10.md)。本月目前只有一轮：引擎仓（SMV）代码未改，只改 Wiki；平台仓（SMT）上线 Pages 与 Actions 开 PR 的权限后做了三个运维修补。观察均为 2026-11-01 本机与 CI 的记录，不宣称已有真实标注入库。

## 2026-11-01：平台上线与运维修补

基线：SMV 最近提交 `6fc2709`（2026-10-31，平台侧回执），0.6.0 已发布（release v0.6.0），本轮 SMV 代码未改、只改 Wiki。SMT 三个提交 `3147657` → `cc14f8d` → `2ae73e2`，都在 `main`，CI `check` 与 `export` 均成功。

| 检查 | 本轮观察 | 边界 |
|---|---|---|
| 维护者设置核实 | 维护者在仓库设置里开通 GitHub Pages（来源 GitHub Actions）并打开「允许 GitHub Actions 创建和批准 PR」。核实：仓库 API `has_pages: true`；`export` 手动运行 41349846687（commit `07d20a2`）build + deploy 两个作业成功，Pages 上 `export/v1/` 可读；`sample` 手动运行 41349994169 成功并自动开出 PR #2「sample: refresh the starter shelf」，证明 Actions 开 PR 的权限已生效 | PR #2 只改了 `data/sample.json` 的 `generated_at`（书架没有新内容），已关闭未并入；PR 上的 `check` 运行 41350019604（pull_request 事件）显示 failure 且 0 个作业，推测是 PR 在排队时被关闭所致，未查明；远程分支 `sample/refresh` 仍在（删除被权限拒绝），维护者可手动删 |
| sample 时间戳修补（`3147657`） | `scripts/sample.ts`：名片、模型断言、主题列表都与上次相同（added === 0 && newAssertions === 0 && 旧 `sample.json` 的 topics 深相等）⇒ 不写 `sample.json`，日志「书架没变，不改任何文件」，返回值多可选 `unchanged`。测试：重跑后 `generated_at` 仍是第一次的时间（2026-10-31T00:00:00.000Z） | 避免每周只为时间戳开 PR；下次 sample 真有新内容开 PR 时再核对 PR 上 `check` 是否正常跑 |
| replay 拉不到（`cc14f8d`） | 起因：定时 replay 运行 41302268794（2026-11-01 11:31 UTC，Pages 当时还没开通）把 37 个文件全记成不一致（每个文件 remote 为 null），开了 issue #1「replay: 37 file(s) differ, 0 mutual pair(s)」，退出码 1。修补：`scripts/replay.ts` 先拉远端 `manifest.json`，拉不到（404 或网络失败）⇒ `unreachable: true`，不比对、不开 issue、退出码 0，日志「已发布导出拉不到…这次不比对（外部源失败 ≠ 不一致）」；`replay.json` 多字段 `unreachable`；manifest 在而某分片缺才算差异。测试：manifest 404 ⇒ unreachable=true、diffs=[]、issue=null、不调 createIssue；manifest 在、分片缺 ⇒ unreachable=false 且记差异 | issue #1 已留言说明误报并关闭（not planned）；与本仓「外部源失败回 null，不当成没有研究」同一原则 |
| replay 重试（`2ae73e2`） | 起因：手动 replay 运行 41350515078（21:09 UTC，紧接 export 部署完成 21:09:10 之后）已能连上 Pages（unreachable=false），37 个文件中 36 个一致、1 个（`works/e9.jsonl`）远端 404，开了 issue #3「replay: 1 file(s) differ, 0 mutual pair(s)」；三分钟后再手动运行 41350813853（同一提交 `cc14f8d`）37 个文件全部一致、成功。修补：常量 `REMOTE_ATTEMPTS = 3`、`REMOTE_RETRY_MS = 3000`（间隔线性加长：3s、6s）；`ReplayDeps.sleep` 可注入；缺失或失败的文件重试后仍 null 才算差异。测试：缺失文件被请求 REMOTE_ATTEMPTS 次；「第二次才拿到」不算差异 | issue #3 已留言说明误报并关闭（not planned）；单文件 404 的原因推测为刚部署后的 CDN 传播窗口（三分钟后同一提交重跑全部一致），未直接查明；不是 Pages 长期不可用 |
| SMT 本机验收 | `pnpm typecheck`、`pnpm test`（node:test 25 例）、`pnpm check`、`bash scripts/check-private-terms.sh`（没有私有词）全过 | 25 例是扩展既有用例，没有新增用例数 |
| CI | `3147657`：check 41350309973 成功、export 41350309995 成功；`cc14f8d`：check 41350459836 成功、export 41350459723 成功；`2ae73e2`：check 41350890356 成功、export 41350890380 成功 | 都是 push 到 `main` 的运行；本轮唯一一次 pull_request 事件的 check（PR #2，41350019604）没有正常跑起来，见第一行 |
| 副作用 | 在 issue #1 / #3 上留言触发了 `intake` 工作流（issue_comment 事件）两次，都成功且无操作（这些 issue 不是标注表单） | 无需处理：两次运行都成功且无操作，与这些 issue 不是标注表单一致 |

**未决**：用一条真实 issue 走通入库 → 导出 → `readCommunityExport`（还没有人提交过真实标注）；归档片（Release 资产）读回；R15 演示页 / 接入方接真实导出；R16 OpenAlex 单实体计费探针；下次 sample 真有新内容开 PR 时核对 PR 上 `check` 是否正常跑。
