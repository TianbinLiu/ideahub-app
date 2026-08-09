// Token 经济：套餐目录 / 充值包 / Seedance 档位 / 成本估算 / 平台抽成。
// token 与方舟视频 token 同量纲（720p 24fps：时长×1280×720×24/1024/秒），
// 档位系数按各模型单价相对标准档（1.0-pro 15元/M）折算——用户看到的数字
// 就是真实资源消耗，不做虚拟汇率。
import { VideoSegment } from "../types";

/** 观看付费的平台抽成比例（其余进创作者 add-on 余额） */
export const PLATFORM_CUT = 0.3;

/** 订阅套餐（演示环境模拟支付；套餐 token 按月发放，优先扣减） */
export interface TokenPlan {
  id: string;
  name: string;
  /** 元/月；0=免费 */
  price: number;
  monthlyTokens: number;
  desc: string;
}

export const PLANS: TokenPlan[] = [
  { id: "free", name: "免费版", price: 0, monthlyTokens: 300_000, desc: "注册即得，每月刷新" },
  { id: "std", name: "标准套餐", price: 30, monthlyTokens: 2_000_000, desc: "约可生成 15 段标准档视频" },
  { id: "pro", name: "专业套餐", price: 98, monthlyTokens: 8_000_000, desc: "重度创作，约 60 段标准档" },
];

/** 直充包：到账进 add-on（永不过期，套餐扣完才动它） */
export const RECHARGE_PACKS = [
  { tokens: 200_000, price: 6 },
  { tokens: 1_000_000, price: 25 },
  { tokens: 5_000_000, price: 98 },
];

/** Seedance 档位：id 持久化在 VideoSegment.videoTier / EditorState.videoTier */
export interface VideoTier {
  id: string;
  label: string;
  model: string;
  /** token 消耗系数（相对标准档；按模型单价折算） */
  mult: number;
  /** 是否支持首尾帧模式（flf2v）。实测 pro-fast 只收首帧：报 task_type flf2v not support */
  flf: boolean;
  desc: string;
}

export const VIDEO_TIERS: VideoTier[] = [
  { id: "fast", label: "极速", model: "doubao-seedance-1-0-pro-fast-251015", mult: 0.3, flf: false, desc: "省 token · 首帧起拍，不锁尾帧" },
  { id: "std", label: "标准", model: "doubao-seedance-1-0-pro-250528", mult: 1, flf: true, desc: "首尾帧可控（默认）" },
  { id: "hd", label: "高清", model: "doubao-seedance-2-0-mini-260615", mult: 1.6, flf: true, desc: "新一代模型 · 需在方舟控制台开通 2.0 系列" },
];

export const DEFAULT_TIER = "std";

export function tierOf(id: string | undefined): VideoTier {
  return VIDEO_TIERS.find((t) => t.id === id) ?? VIDEO_TIERS[1];
}

/** 一段 720p 视频的 token 估算（方舟公式：时长×宽×高×帧率/1024，×档位系数） */
export function segTokens(durationSec: number, tierId?: string): number {
  const base = (Math.max(3, Math.min(10, durationSec)) * 1280 * 720 * 24) / 1024;
  return Math.round(base * tierOf(tierId).mult);
}

/**
 * 一次图像生成（Seedream 卡面/设定帧）的 token 等价。
 * 折算依据：Seedream 5.0 约 0.2 元/张，标准档视频 15 元/M token ⇒ 0.2/15 M ≈ 13.3k。
 * 与视频 token 同量纲，用户看到的就是同一把尺子。
 */
export const IMAGE_TOKENS = 13_300;

/** 视觉模型看图（每帧）的 token 等价：豆包 seed-2.1 图文输入远比出图便宜，取一个保守值 */
export const VISION_FRAME_TOKENS = 900;

/** 每张卡的文案精炼（豆包一次短对话）token 等价。图文输入按保守值给，
 *  与 VISION_FRAME_TOKENS 同量级——真正贵的是出图，这一项只是别装作免费。 */
export const CARD_META_TOKENS = 400;

/**
 * 素材炼卡的预估：**一份素材 = 一张卡**，纯描述（没传文件）也出一张。
 * 图片素材直接拿用户原图当卡面，不烧 Seedream；文本素材/纯描述才要出图。
 * 这个不对称是 real.generateCards 的实际行为（见 `if (!f?.dataUrl)`），
 * 报价必须跟着它走，否则传 6 张图会被报成 6 倍价钱而白白吓退用户。
 */
export function forgeCost(imageFiles: number, textFiles: number, hasNote: boolean): number {
  const cards = imageFiles + textFiles + (imageFiles + textFiles === 0 && hasNote ? 1 : 0);
  const covers = textFiles + (imageFiles + textFiles === 0 && hasNote ? 1 : 0);
  return cards * CARD_META_TOKENS + covers * IMAGE_TOKENS;
}

/**
 * 上传视频提炼卡组的预估：看 N 帧 + 最多铸 M 张卡面。
 * 张数是上限而非确数（模型认出几个实体就出几张，重复的还会被剔掉），
 * 所以 UI 必须说"最多"，并按实际出卡张数结算。
 */
export function extractCost(frameCount: number, maxCards: number): number {
  return frameCount * VISION_FRAME_TOKENS + maxCards * IMAGE_TOKENS;
}

/** 整片合成的 token 估算：只算还没有真视频的段 */
export function composeCost(segments: Array<Pick<VideoSegment, "durationSec" | "videoUrl" | "videoTier">>): number {
  return segments.filter((s) => !s.videoUrl).reduce((sum, s) => sum + segTokens(s.durationSec, s.videoTier), 0);
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(Math.round(n));
}
