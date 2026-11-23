# Security policy / 安全政策

**报告方式 / Reporting.** 请用本仓库 GitHub 页面 Security → "Report a vulnerability"（私下报告）提交，不要开公开 issue。
Please use GitHub's private vulnerability reporting (Security → "Report a vulnerability") instead of a public issue.

**范围 / Scope.** 本仓是一个库：验形、判据与视图模型，以及一个可选的外部文献源适配器。值得报告的例子：
不可信输入（外部源响应、贡献包、社区导出、宿主传入的文章行）导致的崩溃、越界读取、把出网代码带进浏览器入口、
把密钥写进日志或产物。宿主怎样部署、鉴权与存储不在本仓范围内。
This repository is a library. In scope: crashes or unsafe behaviour on untrusted input (external-source responses, contribution
packages, community exports, host-supplied rows), server-only code reachable from browser entry points, secrets leaking into logs
or build output. A host's deployment, authentication and storage are out of scope.

**支持的版本 / Supported versions.** 只修最新发布的版本。Only the latest release receives fixes.

**不要在报告里放**真实用户数据或接入方的内部信息；用最小复现即可。
Do not include real user data or a host's internal details; a minimal reproduction is enough.
