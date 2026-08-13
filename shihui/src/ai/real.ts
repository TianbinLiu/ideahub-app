import type { LineClip } from "../types"
import { mockGenClip } from "./mock"

// 真实实现（未接线）。接线时直接抄 ideahub-app 的 src/ai/real.ts + studio/segmentGen.ts，
// 那边已经用真金白银踩平的坑（全部有实测记录）：
//
// 1. 一段 = 三拍：Seedream 出首尾帧（竖屏 1728x2304，比例不符会被静默裁）→ 用户确认
//    → Seedance 首尾帧模式出片（doubao-seedance-1-0-pro，6s/720p ≈ ¥1.9；
//    pro-fast ≈ ¥0.5 但不支持尾帧锁定，只能首帧起拍）。
// 2. 段间承接必须"逐段捕获上一段视频的真实末帧"（video seek 到尾 → canvas），
//    设定尾帧只是蓝图，成片不一定拍到那儿。
// 3. 产物 URL 是 TOS 域、24h 失效、无 CORS 头——浏览器取帧必须走服务端 /api/asset 代理，
//    且判断服务器能力永远看 Content-Type / 健康端点，不看状态码（Capacitor SPA 回退陷阱）。
// 4. 提示词敏感词是 400 整个失败不是降级；孩子的自由输入必须先过一层前置审（见 IDEA-REVIEW）。
// 5. 等媒体事件（loadedmetadata/seeked）一律带超时，后台标签页里它们永远不来。
export async function realGenClip(text: string, prevTail?: string): Promise<LineClip> {
  // TODO(接线): 见上。先退回 mock，让 __AI_REAL__ 构建也能跑通页面而不是白屏。
  return mockGenClip(text, prevTail)
}
