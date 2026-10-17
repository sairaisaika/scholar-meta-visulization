# 本轮开发验证（2026-10-17）

研究基线：`e74574404ce9dfeddb98eaeae5ece879064dd8bc`。本轮实现 R01 结果式 SDK 与 R03 Windows 包验收；其余计划见[TODO](TODO.md)。提交前本机验证如下，CI 结果另由对应提交工作流确认。

| 检查 | 观察结果 | 证据边界 |
|---|---|---|
| pnpm check | 完整通过：typecheck、typecheck:src、boundary、Jest、build/产物/manifest、check:package、demo | 私有词表为空明确跳过；没有真实 provider 新验收 |
| Jest | 435 passed / 12 skipped；14 快照通过 | 12 个外部 live 案例没有自动当作通过；本轮新增16个结果式客户端案例 |
| 包安装 | 临时目录真实 pack/install；五入口 CJS/ESM；bundler/node16 类型；旧客户端成功与新客户端 501 联调通过 | 当前源码候选包，不代表版本已发布或接入方生产安装 |
| API 快照 | 只新增 createEvidenceResultClient 一个运行时导出 | 领域 types.ts 未变；没有自动重写行为快照 |
| Python Wiki | 9/9 通过；结构、漂移与保存摘要一致 | 定位存在不代替语义或运行验收 |
| 导航 | 29/29 已知首选；2/2 未知拒绝；复合范围1/1；最大449空白分隔词 | 作者维护的登记题自测，不是独立采用/速度测量 |

Windows 包脚本修改包含两部分：用当前 package-script 提供的 pnpm CLI 和参数数组启动子进程，避免把 .cmd 当作原生可执行文件；tar 列表按 CRLF/LF 分行，避免误判包中全部文件缺失。没有删掉验收或跳过安装。

客户端真实内存 handler 案例覆盖成功、缺配置与 unavailable/503/60 秒；受控 fetch 案例覆盖已知状态/正文一致、未知正文不透传、网络、坏 JSON、guard 失败、Retry-After 秒数和日期、Unicode 编码与不自动重试。早期测试比较两次不同时间的来源时间戳导致失败，已通过固定服务 now 使兼容性比较可重复；API 快照先审阅只有新增工厂，再更新对应快照。

**源码与检查位置**：`src/client.ts`、`test/client-result.test.ts`、`test/http.test.ts`、`test/integration.test.ts`、`test/features.test.ts`、`scripts/check-package.mjs`、`test/__snapshots__/api-surface.test.ts.snap`。新接口规范见[客户端诊断](Client-diagnostics.md)，协议研究见[工程研究](Engineering-research-2026-10.md)。

仍未执行：新真实 OpenAlex 预算/计量验收、第二源适配、宿主真实数据库/身份/并发事务、陌生 agent 采用实验。本轮不宣称已发新版、已上线或改变标签政策。

最终兼容审查另补：旧工厂在非成功状态仍直接返回 null，不为新增诊断读取/等待错误正文；新工厂才解析错误详情。这条约束已加入独立回归测试。
