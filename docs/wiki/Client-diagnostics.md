# 结果式客户端：错误、状态和重试提示

2026-10-17 新增源码能力，尚未据此宣布新版本发布。`scholar-meta/client` 现在导出两套五方法工厂，均使用原有四条只读路由和相同数据 guard：

- `createEvidenceClient`：保持成功 data、失败 null。
- `createEvidenceResultClient`：成功 `{ ok: true, data, status }`；失败 `{ ok: false, error, status, retryAfterSeconds }`。

不使用额外运行依赖，不自动重试或订阅，不修改标签政策、HTTP 响应正文或 `src/types.ts` 的领域数据契约。该扩展复用既有图谱/计数的生产端与载荷，只增加客户端诊断消费方式，因此没有新领域功能 ID 或 manifest 数据能力。

## 使用

```ts
import { createEvidenceResultClient } from 'scholar-meta/client'

const api = createEvidenceResultClient({ baseUrl: '/api/evidence' })
const result = await api.getTagCounts('sleep')
if (result.ok) {
  // 显示 result.data；成功空集也在此分支。
} else {
  // 由宿主映射 result.error，不把失败渲染成零研究。
  // result.status 和 result.retryAfterSeconds 可用于提示。
}
```

五方法：getTagMap、getNodeMap、getCounts、getTagCounts、getTagGraph；参数和原工厂相同，默认 baseUrl、headers 和注入 fetch 也相同。移动端可提供绝对宿主 URL；浏览器仍只请求宿主。

## 返回边界

| 场景 | error / status | 提示与限制 |
|---|---|---|
| 2xx 且数据 guard 通过 | ok=true，data 和 status | 成功空结果与失败区分 |
| 已知错误且正文代码与状态对应 | invalid_input/400、not_found/404、method_not_allowed/405、internal/500、not_configured/501、unavailable/503 | 只有相符的受支持组合会细分 |
| 非成功状态但未知/不匹配代码，或坏 JSON | http_error，保留实际 status | 不透传未知 error、异常文本或服务器正文；401/403/429 等仍能看 status |
| fetch 拒绝 | network / null | 不把网络异常文本暴露给调用方；不自动重试 |
| 2xx 坏 JSON 或不合形状 | invalid_response，保留 status | HTTP 成功不等于有效数据 |
| 查询参数含无法编码的孤立 Unicode 代理项 | invalid_input / null | 不发请求；旧接口在此场景由 URIError 改为 null |

真实 Response 有数值 status；不完整的宿主 fetch mock 缺 status 时为 null。Retry-After 在非成功响应解析为秒数：支持非负整数与运行时 Date.parse 能识别的 HTTP 日期；日期相对接收时的本机时钟，过期为 0；非法/负数/小数/溢出或缺失为 null。它是等待提示，不是可重试保证，宿主仍要结合业务/状态决定。服务器日期与本机时钟偏差、跨域响应头可见性由宿主评估。

**章节来源**：`src/client.ts::createEvidenceResultClient/EvidenceClientResult/EvidenceClientError/retryAfterSeconds/createEvidenceClient`，路由 `client-diagnostics` 解析当前行号。`retryAfterSeconds` 和内部 get 为私有实现，公开的是两工厂及类型。原客户端通过共用私有请求核心只发送一次请求；非成功状态仍直接返回 null，不额外等待错误正文。

检查：`test/client-result.test.ts` 使用真实内存 service/handler 验证成功/缺配置/503；覆盖五方法的错误及坏形状、状态代码一致、未知正文不回显、秒数/日期、编码与无自动重试。原 `http/integration` 测试保持旧调用回归。安装包脚本验证新工厂导出、真实已安装包的 501 结果及两种模块/类型消费；这些不是在线宿主或真实 provider 验收。

研究理由与后续：见[工程研究](Engineering-research-2026-10.md)和[TODO](TODO.md)。RFC 9457 是后续 HTTP 设计选项；当前实现没有宣称支持 application/problem+json。
