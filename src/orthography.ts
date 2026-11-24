/**
 * 正字法折叠——标签键归一与「匹配用归一」共用的那一步（内部模块，不从任何入口导出）。
 * ─────────────────────────────────────────────────────────────────────────────
 * `normalizeTag`（tags.ts）在它外面加长度上限，得到标签键；词表打标签器（tagging.ts）在它外面加标点分隔、不设标签长度上限，
 * 得到只用来比对正文与词条的形式。两处共用同一份折叠规则，所以「算不算同一个写法」只有一个答案。
 */

// C0/C1 控制字符、软连字符、零宽字符、方向控制符、BOM
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁯﻿]/g
// 空白、下划线、ASCII 连字符、Unicode 连字符 / 破折号 / 减号
const SEPARATORS = /[\s_\-‐-―−﹘﹣]+/g

/**
 * NFKC；运行环境没有 `String.prototype.normalize`（比如关掉 Intl 的 Hermes）时原样返回——
 * 只是少折叠全角 / 兼容字符，不会崩（移动端也能直接用这个入口）。
 */
export function nfkc(s: string): string {
  try { return typeof s.normalize === 'function' ? s.normalize('NFKC') : s } catch { return s }
}

/**
 * NFKC → 去不可见字符 → 去首尾空白 → 去开头的 `#` → 小写 → 空白 / 下划线 / 各种连字符折成一个空格。
 * 不限长度、不判空：调用方自己定上限（标签键 100 字符；正文匹配只设保护上限）。
 */
export function foldOrthography(raw: string): string {
  return nfkc(raw)
    .replace(INVISIBLE, '')
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(SEPARATORS, ' ')
    .trim()
}
