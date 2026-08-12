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
  // ★ desc 是给**用户**看的，不是给运维看的。原来这里写的是「需在方舟控制台开通 2.0 系列」——
  //   那是部署方的事，终端用户既看不懂也做不了（CLAUDE.md 那条「界面上摆一个用户看不懂
  //   也做不了事的东西」）。开通与否的后果由服务端 ALLOWED_MODELS 与方舟的 ModelNotOpen 负责。
  { id: "hd", label: "高清", model: "doubao-seedance-2-0-mini-260615", mult: 1.6, flf: true, desc: "新一代模型 · 画面更稳、细节更多" },
];

export const DEFAULT_TIER = "std";

export function tierOf(id: string | undefined): VideoTier {
  return VIDEO_TIERS.find((t) => t.id === id) ?? VIDEO_TIERS[1];
}

/**
 * 模型 id → 给人看的名字（`doubao-seedance-2-0-mini-260615` → `Seedance 2.0 mini`）。
 *
 * ★ **从 id 推导，不另外维护一张对照表**。手写一张 `{id: 名字}` 的表，加档位时忘了补
 *   就是"界面上写着标准档、实际跑的是另一个模型"——而这种错没有任何症状，只会让人
 *   在对不上账时怀疑是自己记错了。推导出来的名字永远跟着真正发出去的那个 id 走。
 * ★ 认不出来就**原样返回 id**，不返回"未知模型"：id 本身就是最准确的信息，
 *   宁可显示得难看一点，也不能把它藏起来。
 * ★ 尾巴上那串日期（`-260615`）是方舟的版本戳，对用户没有意义，去掉；
 *   要查证的人看档位说明里的完整 id（title）。
 */
export function modelLabel(modelId: string): string {
  const s = String(modelId || "")
    .replace(/^doubao-/, "")
    .replace(/-\d{6,8}$/, "");
  const m = /^([a-z0-9]+)-(\d+)-(\d+)(?:-(.+))?$/.exec(s);
  if (!m) return modelId;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  const variant = m[4] ? ` ${m[4].replace(/-/g, " ")}` : "";
  return `${family} ${m[2]}.${m[3]}${variant}`;
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
 * 一次闲聊往返的 token 等价。**不复用 CARD_META_TOKENS**——那是"一次极短的 JSON
 * 抽取"（几十字输入），闲聊要背 ~600 字人设 + ~1000 字历史，输入量是它的十几倍；
 * 共用一个常量，以后谁改了卡片提示词就会把聊天报价一起改掉。
 *
 * ⚠ doubao-seed-2-1-turbo 的实际单价**没有实测过**，400 是按同一把尺子估的保守值。
 * 上线前必须照方舟账单校一次。它只是"常驻价签"；真实结算走接口返回的用量。
 */
export const CHAT_TURN_TOKENS = 400;

/** 会炼出几张卡：**一份素材 = 一张卡**，一份素材都没有但写了描述也出一张。 */
export function forgeCardCount(fileCount: number, hasNote: boolean): number {
  return fileCount > 0 ? fileCount : hasNote ? 1 : 0;
}

/**
 * 素材炼卡的预估：每张卡 = 一次豆包文案 + **一次 Seedream 出图**。
 * 旧版按"图片素材直接当卡面、不烧 Seedream"算，是半价；现在卡面一律由
 * Seedream 画（图片素材降级为参考图，见 real.forgeCover），那条捷径没有了，
 * 报价必须跟着涨——报低了就是替用户做主花他的钱。
 */
export function forgeCost(cardCount: number): number {
  return cardCount * (CARD_META_TOKENS + IMAGE_TOKENS);
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

/**
 * 一次 seed3d 建模的 token 等价。折算依据：doubao-seed3d-2.0 约 **2.4 元/次**
 * （带纹理 + PBR），标准档视频 15 元/M ⇒ 2.4/15 M = 160k。
 * 这是全 app **最贵的单次操作**——12 张 Seedream 的钱。它以前一分不收也一句提示
 * 没有，还由一条正则（/3d|三维|立体感|cg|建模|渲染/）静默触发。
 */
export const MODEL3D_TOKENS = 160_000;

/** 三方案推演：1 次豆包写剧情 + 每个方案的首尾帧。
 *  有确定开头帧时三个方案共用它，只画尾帧——图量减半，报价也得跟着减半，
 *  否则用户会看到"接着上一段做反而更贵"。 */
export function proposalsCost(hasStartFrame: boolean): number {
  return CARD_META_TOKENS + 3 * (hasStartFrame ? 1 : 2) * IMAGE_TOKENS;
}

/** 单张图的重画：方案设定图改图（refineFrame）、AI 封面（generateCover） */
export const ONE_IMAGE = IMAGE_TOKENS;

/**
 * 「按修改重画一套方案」的报价：用户自己上传的帧、以及承接上一段真实结尾的那张开头帧
 * 一律不动（见 Proposal.pinned），剩下几张才重画。
 * ★ 只能有这一处实现——按钮上的报价和真正扣的钱分开算，必然分叉，而"界面写 13.3k、
 *   实际扣 26.6k"这种事用户当场发现不了（铁律六）。
 */
export function proposalRedrawCost(keepFirst: boolean, keepLast: boolean): number {
  return ((keepFirst ? 0 : 1) + (keepLast ? 0 : 1)) * ONE_IMAGE;
}

/** 成片派生卡组：最多 8 张，每张一次文案 + 一次卡面。
 *  与 extractCost 一样给的是**上限**——重复实体会被剔掉，按实际出卡结算。 */
export function deckCardsCost(maxCards = 8): number {
  return maxCards * (CARD_META_TOKENS + IMAGE_TOKENS);
}

/** 素材炼卡的**实际**结算：只有真画出卡面的那几张收图钱，
 *  出图失败退回用户原图的那张只收文案钱。 */
export function forgeSettle(cardCount: number, mintedCovers: number): number {
  return cardCount * CARD_META_TOKENS + mintedCovers * IMAGE_TOKENS;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(Math.round(n));
}
