/**
 * @file protocol.ts - 看板娘「演出协议」：服务端标签 → 模型上的表情/动作/节奏
 * @category Utility
 *
 * 服务端（server/src/services/companion.service.js）让 LLM 按句输出 `[情绪][face:x][action:y]`，
 * 这里是前端这一半：9 种 face 与 11 种 action 的枚举必须和服务端一字不差，
 * 未知值一律回退到 normal/none，而不是抛错让整句演出中断。
 *
 * 节奏常量沿用 AgentAtelierR 实测过的数值（口型 20ms 帧 / 起 40ms / 落 90ms / 张嘴上限 55% /
 * 无音频时 5.2Hz 合成 / 强表情保持 4.6s / 语义动作后压制 2.3s）。改动前先在真机看效果，
 * 这些数不是拍脑袋，是"看着像人"的临界值。
 */

export const FACES = ["normal", "happy", "laughing", "angry", "sad", "crying", "shy", "tease", "cuddle"] as const;
export type CompanionFace = (typeof FACES)[number];

export const ACTIONS = [
  "none",
  "acknowledge",
  "disagree",
  "think",
  "explain",
  "excited",
  "wave",
  "shy",
  "surprised",
  "comfort",
  "playful",
] as const;
export type CompanionAction = (typeof ACTIONS)[number];

/** 服务端 SSE `sentence` 事件的形状（server/src/routes/companion.routes.js） */
export type CompanionSentence = {
  index: number;
  text: string;
  emotion: string;
  face: CompanionFace;
  action: CompanionAction;
  tts: { emotion: string; instruct: string };
};

export function normalizeFace(value: unknown): CompanionFace {
  return (FACES as readonly string[]).includes(String(value)) ? (value as CompanionFace) : "normal";
}

export function normalizeAction(value: unknown): CompanionAction {
  return (ACTIONS as readonly string[]).includes(String(value)) ? (value as CompanionAction) : "none";
}

/**
 * 模型里的四块「表情补片」Part（Cubism 工程里的顶层 Part 名）。
 * ExprSmile / ExprAngry 靠 Part 不透明度开关；ExprClosed / ExprMouthOpen 自 mascot8 起常开，
 * 露出与否钉在 ParamEyeL/ROpen、ParamMouthOpenY 的关键帧上 —— FacePose.parts 里的 ExprClosed 值
 * 因此表示「闭眼程度」（companionModel 把它写进眼睛参数），不再是补片开关。
 */
export type ExpressionPart = "ExprSmile" | "ExprAngry" | "ExprClosed" | "ExprMouthOpen";
export const EXPRESSION_PARTS: ExpressionPart[] = ["ExprSmile", "ExprAngry", "ExprClosed", "ExprMouthOpen"];

export type FacePose = {
  /** 要点亮的补片（0~1 不透明度） */
  parts: Partial<Record<ExpressionPart, number>>;
  /** 叠加到参数上的值（Add 语义，和 exp3 的 Blend:Add 一致，这样呼吸/动作的摆动还在） */
  params: Record<string, number>;
  /** 保持多久后回到 normal；0 = 一直到下一句 */
  holdMs: number;
  /** 眯眼/闭眼类表情别再眨眼（两块眼睛补片叠一起会穿帮） */
  blink: boolean;
};

export const TIMING = {
  mouthFrameMs: 20,
  attackMs: 40,
  releaseMs: 90,
  mouthCap: 0.55,
  syntheticHz: 5.2,
  strongHoldMs: 4600,
  actionSuppressMs: 2300,
  msPerChar: 110,
  maxSyntheticMs: 6000,
} as const;

export const FACE_POSES: Record<CompanionFace, FacePose> = {
  normal: { parts: {}, params: {}, holdMs: 0, blink: true },
  happy: {
    parts: {},
    params: { ParamMouthForm: 1, ParamCheek: 0.6, ParamEyeLSmile: 0.3, ParamEyeRSmile: 0.3 },
    holdMs: 3200,
    blink: true,
  },
  laughing: {
    parts: { ExprSmile: 1 },
    params: { ParamMouthForm: 1, ParamCheek: 1, ParamAngleY: 6 },
    holdMs: TIMING.strongHoldMs,
    blink: false,
  },
  angry: {
    parts: { ExprAngry: 1 },
    params: { ParamBrowLY: -0.6, ParamBrowRY: -0.6, ParamMouthForm: -0.6 },
    holdMs: TIMING.strongHoldMs,
    blink: true,
  },
  sad: {
    parts: {},
    params: {
      ParamBrowLY: -0.3,
      ParamBrowRY: -0.3,
      ParamBrowLAngle: 0.6,
      ParamBrowRAngle: 0.6,
      ParamMouthForm: -0.7,
      ParamAngleY: -8,
      ParamEyeBallY: -0.4,
    },
    holdMs: TIMING.strongHoldMs,
    blink: true,
  },
  crying: {
    parts: { ExprClosed: 1 },
    params: {
      ParamBrowLY: -0.4,
      ParamBrowRY: -0.4,
      ParamBrowLAngle: 0.8,
      ParamBrowRAngle: 0.8,
      ParamMouthForm: -0.9,
      ParamAngleY: -12,
    },
    holdMs: TIMING.strongHoldMs,
    blink: false,
  },
  shy: {
    parts: {},
    params: { ParamCheek: 1, ParamAngleZ: 6, ParamAngleY: -6, ParamEyeBallY: -0.5, ParamMouthForm: 0.4 },
    holdMs: TIMING.strongHoldMs,
    blink: true,
  },
  tease: {
    parts: {},
    params: { ParamAngleZ: -8, ParamMouthForm: 0.8, ParamBrowLY: 0.3, ParamBrowRAngle: -0.4, ParamEyeBallX: 0.4 },
    holdMs: 3500,
    blink: true,
  },
  cuddle: {
    parts: { ExprSmile: 1 },
    params: { ParamAngleZ: 10, ParamCheek: 0.8, ParamMouthForm: 0.8 },
    holdMs: TIMING.strongHoldMs,
    blink: false,
  },
};

/** action → model3.json 里的动作组名（public/live2d/mascot/*.motion3.json）；null = 只靠表情 */
export const ACTION_MOTIONS: Record<CompanionAction, string | null> = {
  none: null,
  acknowledge: "nod",
  disagree: "shake",
  think: "think",
  explain: "nod",
  excited: "excited",
  wave: "excited",
  shy: null,
  surprised: "excited",
  comfort: "nod",
  playful: "excited",
};

/** 没有音频（TTS 关/失败/未登录）时，按字数估一个"说话时长"，让口型和字幕停留时间对得上 */
export function estimateSpeechMs(text: string) {
  const chars = Array.from(String(text || "")).length;
  return Math.min(TIMING.maxSyntheticMs, Math.max(600, chars * TIMING.msPerChar));
}
