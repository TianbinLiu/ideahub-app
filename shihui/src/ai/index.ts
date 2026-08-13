import { mockGenClip } from "./mock"
import { realGenClip } from "./real"

/** 真假切换与 ideahub 同法：构建期看 ARK_API_KEY。mock 是静默的，UI 必须挂「演示模式」角标 */
export const AI_REAL: boolean = __AI_REAL__

/** 生成一句诗的画面段。prevTail = 上一段真实尾帧（承接起拍） */
export const genLineClip = AI_REAL ? realGenClip : mockGenClip
