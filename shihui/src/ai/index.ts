import { mockGenClip } from "./mock"
import { realGenClip } from "./real"

/**
 * 「这台机器上创作侧 AI 是真的吗」。
 * dev：构建期看 ARK_API_KEY（vite 注入 __AI_REAL__），代理在 vite dev 服务器上；
 * 打包：**强制 false**——打包版没有 /api/ark，而 Capacitor 的 SPA 回退会对不存在的
 * 路径回 200+index.html（主仓真机事故）。接上服务端代理（API_BASE）后再放开这条。
 */
export const AI_REAL: boolean = import.meta.env.DEV ? __AI_REAL__ : false

/** 生成一句诗的画面段。prevTail = 上一段真实尾帧（承接起拍）；onProgress 给等待态喂文案 */
export const genLineClip = AI_REAL ? realGenClip : mockGenClip
