# 排错与维护

## 常见现象

| 现象 | 先检查 |
|---|---|
| 标签没有外部层 | 是否被编辑否决、machinePolicy 是否 off、是否有计入的站内标签、外部端口是否配置及取数成功 |
| 账本新增标签不见 | listArticles 按标签查询是否也覆盖账本 present 的作品；ledger.apply 是否 off |
| 同级分歧后计数下降 | disputed 标签按规则被排除，不是少数服从多数 |
| 审阅门开启后文章不计入 | reviewed_at 是否有效；宿主是否正确重算资格；pending 是否被展示 |
| 有方向却不是信天翁图 | 至少两条同时有有效精确 p、正样本量和方向 |
| 有森林图但没菱形 | 查 pooling.reason；至少五项及同度量、方向、设计、区间；再查 estimate 是否为 null |
| 饼图灰掉 | 是否互斥、是否超过八个有值桶、站内分母是否达到 30 |
| 503 或客户端 null | 外部请求、预算、端口、响应形状、账本/文章源是否失败；不能解释成没有研究 |
| 缓存后看不到设置变化 | live TTL、refresh、服务派生缓存、HTTP/CDN 缓存分别检查 |
| SMT 无法 install / 启动 | 本地 SMT 没有包或程序，使用 SMV 的 scholar-meta 实现 |

## 验证命令与能证明的范围

| 命令 | 验证内容 |
|---|---|
| pnpm typecheck / typecheck:src | 工程与较严格源码类型检查 |
| pnpm test | 单元、契约、行为与模拟集成 |
| pnpm build | 构建、产物入口与清单一致性 |
| pnpm check:package | 打包后安装、CJS/ESM、TS 解析与客户端到服务链 |
| pnpm demo | 演示构建，不证明真实外部源 |
| pnpm check | 上述完整闸及边界、私有词检查 |

真实 OpenAlex 检查需显式启用 `OPENALEX_LIVE=1` 后运行 `pnpm jest test/openalex.live.test.ts`，它会访问外部网络，与离线测试区分记录。成功测试不等于完成宿主生产部署或发布 Wiki。

## 共同 Wiki 的维护规则

1. 正文只在此目录修改，两仓入口都指向 Home。
2. 用源文件、契约、注册表、测试核对结论；README 与注释不替代实现条件。
3. 接口、设置、图种或裁决规则变化时，更新对应页与 Project-status 的基线。
4. 未实现的独立服务、模型、数据源、UI 不写成已完成；远端未验证的状态明确注明。
5. 公共 API 或契约变化按 CONTRIBUTING 更新版本、CHANGELOG 与快照；仅文档修改不需要冒充契约升级。

GitHub 的两个仓库有各自 Wiki 仓库，不能自动共享同一份正文。若启用 GitHub Wiki，可选择 SMV Wiki 作为线上入口，将此目录的页面发布并把相对链接转换为 Wiki 页面链接；SMT Wiki 只保留跳转说明。转换后的链接与侧栏需再核验，不能直接复制后宣称发布成功。本次没有执行远端发布。

来源：[贡献规则](../../CONTRIBUTING.md)、[package.json](../../package.json)、[测试目录](../../test)。

## 本次文档核验记录（2026-10-14）

- `pnpm typecheck` 与 `pnpm typecheck:src` 通过。
- 现有 docs、ladder、tagging、tags、settings、http、integration 共 7 个测试套件、103 个测试通过。
- Wiki 10 个 Markdown 文件的 49 个本地链接目标均存在。
- Quick-start 的 TypeScript 示例经本地转译运行，站内方向视图生成成功，HTTP 处理器返回 200；未调用外部 API。
- 发布前复核：26 个离线测试套件、419 个测试及 14 个快照通过；12 个真实外部 API 测试按缺省跳过。类型、源码边界、构建、清单一致性与演示构建通过。
- Windows 检出清单的 CRLF 已恢复为仓库 LF；安装包检查脚本直接运行遇到 pnpm 可执行文件解析与 tar 输出换行问题，使用仅当前进程的 Node 调用适配和输出换行归一后，同一脚本的安装包内容、五入口 CJS/ESM、两种 TS 解析与客户端到服务端到端检查通过，未修改检查脚本。
- 两仓 `git diff --check` 通过。本次未调用真实 OpenAlex API。线上入口使用仓库内共享 Wiki 正文，GitHub 独立 Wiki 未启用或发布；具体仓库提交状态以远端 Git 为准。
