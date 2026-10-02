/**
 * 外来链接的验形（纯函数）：站内文章的地址、评级出处的地址都过这一道再交给界面渲染成链接。
 */

// http(s)://主机[:端口][路径 / 查询 / 片段]；主机里不许有 `@`（`https://真站@钓鱼站` 这种）与空白、控制字符
const HTTP_URL = /^https?:\/\/[^\s/?#@:\\]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/i
const CONTROL = /[\u0000-\u001f\u007f]/

/**
 * 只接受 http / https 的绝对地址（`javascript:`、`data:` 这类会被当成链接渲染的一律拒绝）。
 * 用正则而不是 `new URL`：React Native 的 URL 实现不全，移动端也要能跑。
 */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null
  const s = raw.trim()
  return HTTP_URL.test(s) && !CONTROL.test(s) ? s : null
}
