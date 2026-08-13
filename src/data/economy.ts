// Token 经济：套餐目录 / 充值包 / Seedance 档位 / 成本估算 / 平台抽成。
// token 与方舟视频 token 同量纲（720p 24fps：时长×1280×720×24/1024/秒），
// 档位系数按各模型单价相对标准档（1.0-pro 15元/M）折算——用户看到的数字
// 就是真实资源消耗，不做虚拟汇率。
import {
  CARD_SIZE,
  CARD_SLOTS,
  CARD_TYPES,
  MAX_CARD_VIEWS,
  VideoSegment,
  type CardSlot,
  type CardType,
} from "../types";

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

/**
 * Seedance 2.5 的档位系数。**只有这一处**，两仓对账就对这一个数
 * （server 的 `config/tokens.js` VIDEO_MULT 必须逐条相等）。
 *
 * 折算口径与其它档位一致：元/百万 token ÷ 15（标准档 1.0-pro = 15 元/M = 1）。
 * Seedance 2.5 = **70 元/百万 token**（不含视频输入）⇒ 70/15 ≈ 4.67，取 4.7。
 * 交叉验证：另一来源报「720P 每秒约 1.51 元」，而 1 秒 720p24 = 1280×720×24/1024
 * = 21,600 token = 0.0216M ⇒ 1.51/0.0216 ≈ 69.9 元/M，与 70 吻合。
 *
 * ⚠ 这个数**不是从方舟官方价目表页面读到的**（那页抓不到内容），是两个独立来源互相
 *   印证得来的。上线前必须照**控制台实际账单**校一次；真实结算永远以账单为准。
 */
const ULTRA_MULT = 4.7;

/** Seedance 档位：id 持久化在 VideoSegment.videoTier / EditorState.videoTier */
export interface VideoTier {
  id: string;
  label: string;
  model: string;
  /** token 消耗系数（相对标准档；按模型单价折算） */
  mult: number;
  /** 是否支持首尾帧模式（flf2v）。实测 pro-fast 只收首帧：报 task_type flf2v not support */
  flf: boolean;
  /**
   * 是否支持**参考图**（全模态参考生视频：多张形象图 + 一句话直出，不需要设定帧）。
   *
   * ★ 写死在表里，**不靠运行时探测**：`reference_image` 只有 Seedance 2.5 与 2.0 系列
   *   支持，1.0/1.5 完全没有这个能力。而"1.0 收到 reference_image 会 400 还是**静默忽略**"
   *   没有人验证过 —— 如果是忽略，那就是"用户挂了卡、多付了钱、画面一点没变、零报错"，
   *   本仓最怕的形状。所以由这个标志做**硬白名单**（见 studio/segmentGen 的 refVideoOn），
   *   不满足就退回首尾帧模式**并把原因说出来**。
   * ★ 三个 1.x 档位显式写 false，不留 undefined —— 留空就得到处 `?? false`，那是第二处默认值。
   */
  refImg: boolean;
  /**
   * 只有付费套餐能选。免费版**看得见但选不了**，并写出原因（藏起来用户不知道有这回事）。
   * ★ 这只是界面提示，**不是安全边界** —— 真正的拦截在服务端按当前用户套餐判。
   *   判断本身只有一处：data/account.tierBlockReason。
   */
  paidOnly?: boolean;
  /**
   * 这一档允许的最短时长（秒）。★ Seedance 2.5 的合法区间是 **[4,30]**，而时长按钮上
   * 第一个选项就是 3 秒 —— 直接发过去是同步 400 InvalidParameter，用户只会觉得"这档坏了"。
   * 收在档位表里，**报价（segTokens）与出片（composeSegments）用的是同一个 clampDuration**。
   */
  minSec: number;
  desc: string;
}

export const VIDEO_TIERS: VideoTier[] = [
  { id: "fast", label: "极速", model: "doubao-seedance-1-0-pro-fast-251015", mult: 0.3, flf: false, refImg: false, minSec: 3, desc: "省 token · 首帧起拍，不锁尾帧" },
  { id: "std", label: "标准", model: "doubao-seedance-1-0-pro-250528", mult: 1, flf: true, refImg: false, minSec: 3, desc: "首尾帧可控（默认）" },
  // ★ desc 是给**用户**看的，不是给运维看的。原来这里写的是「需在方舟控制台开通 2.0 系列」——
  //   那是部署方的事，终端用户既看不懂也做不了（CLAUDE.md 那条「界面上摆一个用户看不懂
  //   也做不了事的东西」）。开通与否的后果由服务端 ALLOWED_MODELS 与方舟的 ModelNotOpen 负责。
  { id: "hd", label: "高清", model: "doubao-seedance-2-0-mini-260615", mult: 1.6, flf: true, refImg: true, minSec: 3, desc: "新一代模型 · 画面更稳、细节更多；可直接用素材卡的形象参考图出片" },
  {
    id: "ultra",
    label: "电影级",
    model: "doubao-seedance-2-5-260628",
    mult: ULTRA_MULT,
    flf: true,
    refImg: true,
    paidOnly: true,
    // 2.5 的时长区间是 [4,30]，3 秒会被同步 400（见 VideoTier.minSec）
    minSec: 4,
    desc: "最新一代 · 画面与运镜最好，单段消耗约标准档 4.7 倍（仅付费套餐）",
  },
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

/**
 * 真正会发给方舟的时长（秒）。上限 10 是本 app 的产品约束，下限跟着档位走
 * （见 VideoTier.minSec —— 2.5 不收 3 秒）。
 * ★ 报价与出片必须用同一个函数：只在出片那侧夹一下的话，用户看到的是 3 秒的价、
 *   拿到的是 4 秒的片，差 33% 且无从察觉。
 */
export function clampDuration(durationSec: number, tierId?: string): number {
  return Math.max(tierOf(tierId).minSec, Math.min(10, Math.round(durationSec)));
}

/** 一段 720p 视频的 token 估算（方舟公式：时长×宽×高×帧率/1024，×档位系数） */
export function segTokens(durationSec: number, tierId?: string): number {
  const base = (clampDuration(durationSec, tierId) * 1280 * 720 * 24) / 1024;
  return Math.round(base * tierOf(tierId).mult);
}

// ── 出图模型与铸卡档位 ─────────────────────────────────────────
//
// 口径与视频同一把尺子：**元/张 ÷ 15 元/百万 token**（15 = Seedance 1.0-pro 标准档）。
// ★ 不做 base × mult 两层：图片是"每张一口价"，没有时长那样的连续量，除一次再乘回来
//   只会引入舍入误差，而误差方向总是我们垫钱。直接写绝对 token。
//
// ⚠ 单价来自方舟公开价目（2026-08-11 核对），**尚未与控制台账单对过**。
//   发现偏差**只改这一张表**，并同步 server/src/config/tokens.js 的同名表（跨仓契约）。
//
// 各模型的像素区间是 2026-08-11 拿真 key 探出来的（发必然 400 的尺寸、读报错文案，零成本）：
//   4.0     ≥ 921,600      ≤ 16,777,216
//   4.5     ≥ 3,686,400    ≤ 16,777,216
//   5.0     ≥ 3,686,400                    ← 公开价目里查不到单价，**因此不进档位表**
//   5.0-pro ≥ 921,600      ≤ 4,624,220
// ★ 那条 3,686,400 是 **5.0 / 4.5 专属**，不是 Seedream 的通则 —— 别再照抄成全家桶下限。

/** 一张出图的 token 等价，按模型。★ 每一格的注释必须带：单价、口径、核对状态 */
export const IMAGE_TOKENS_BY_MODEL: Record<string, number> = {
  // 0.20 元/张 ÷ 15 元/M = 13,333。账单核对 ☐ 未做
  "doubao-seedream-4-0-250828": 13_333,
  // 0.25 元/张 ÷ 15 元/M = 16,667。账单核对 ☐ 未做
  "doubao-seedream-4-5-251128": 16_667,
  // 0.60 元/张（输出图 > 236 万像素那一档）÷ 15 元/M = 40,000。账单核对 ☐ 未做
  // ★ 顶档**故意用满画布** CARD_SIZE(1728×2304 = 398 万像素) 走贵的那一档：
  //   压到 236 万以下（例 1296×1728）单价减半，但那样顶档出的图会**比中档还小**，
  //   一个"更贵却更糊"的顶档迟早被当成 bug。想换成半价版只改 ImageTier.size 这一行。
  "doubao-seedream-5-0-pro-260628": 40_000,
};

/**
 * 查一张图的单价；**认不出的模型返回 null**。
 *
 * ★ 不写 `?? IMAGE_TOKENS` 兜底：那会把"档位表加了、价表忘了"这种配置错**静默**盖住，
 *   表现为高档按低档收费 —— 用户无感、界面无错、测试全绿，只有火山账单知道。
 * ★★ 但也**不在这一层抛**（原来是 `throw new Error`）。这个函数的调用链是
 *   imageTierTokens → forgeCost，而 forgeCost 是在 NpcDialog 的 **render 里**调的，
 *   `IMAGE_TOKENS` 更是**模块顶层常量**：
 *     · render 里抛 → 全 app 没有任何 ErrorBoundary（2026-08-11 全仓 grep 确认），
 *       React 直接卸载整棵树；
 *     · 顶层抛 → economy.ts 求值失败，所有 import 它的模块连带挂掉，app 根本起不来。
 *   两种都表现为**白屏，错误只进 console** —— 用户拿不到任何一句话（铁律八），而抛异常
 *   的初衷恰恰是"别静默"。所以这一层只回答"表里有没有"，把"没有该怎么办"交给上面两处：
 *   数值侧返回 null（类型逼着调用方处理），人话侧走 imageTierPriceIssue。
 * ★ 用 `?? null` 而不是 `if (!n)`：0 也是一个合法单价（哪天某个模型免费），
 *   `!n` 会把它当成"不在表里"。
 * ★ 那句 `number | undefined` 标注不能省：tsconfig 没开 noUncheckedIndexedAccess，
 *   `Record<string, number>` 的下标在**类型上**是 number（运行时却真会给 undefined）。
 *   不标的话 `?? null` 看起来像一段永远走不到的死代码，下一个人顺手就删了。
 */
function imagePriceOf(model: string): number | null {
  const n: number | undefined = IMAGE_TOKENS_BY_MODEL[model];
  return n ?? null;
}

/** 铸卡出图档位：id 持久化在 Card.imageTier */
export interface ImageTier {
  id: string;
  label: string;
  model: string;
  /**
   * 取该卡种图位列表（types.CARD_SLOTS）的前几个。实际张数还要 min 上列表长度。
   * ★ **没有档位敢写 3**：出片管线一张卡最多喂 2 张（见 slotsFor 的 ★★），
   *   第 3 张画了也进不了模型 —— 收了钱、画面一个像素不变。
   */
  views: number;
  /**
   * 发给方舟的画布。★ 必填、不许留空 —— 单价按输出像素分档，留空就等于把钱交给默认值。
   */
  size: string;
  desc: string;
}

/**
 * 铸卡档位。**低→高单调递增**，且三个模型的单价都有公开出处。
 *
 * ★ 为什么没有现在天天在调的 `doubao-seedream-5-0-260128`：它的单价在方舟公开价目里
 *   查不到。拿一个不知道多少钱的模型当默认，就是今天这个局面 —— `IMAGE_TOKENS` 原值
 *   13,300 折的是 **0.20 元**，那是 4.0 的价，而我们一直在调 5.0，差价自己吃了。
 *
 * ★★ 三档的 desc 必须**如实说清各自差在哪**：
 *     速写→定妆 差在**张数**（1 张 → 2 张），定妆→精绘 差在**模型**（4.5 → 5.0-pro），
 *     张数两者都是 2。谁要是在精绘那句里暗示"图更多"，就是拿一张画不出来的图卖钱 ——
 *     顶档的 views 曾经写 3，而第 3 张永远进不了出片管线（见 slotsFor 的 ★★），
 *     人物卡一张 120,400 里有 40,000 是白花的。
 */
export const IMAGE_TIERS: ImageTier[] = [
  {
    id: "sketch",
    label: "速写",
    model: "doubao-seedream-4-0-250828",
    views: 1,
    size: CARD_SIZE,
    desc: "只画 1 张主图 · 它同时就是卡面",
  },
  {
    id: "studio",
    label: "定妆",
    model: "doubao-seedream-4-5-251128",
    views: 2,
    size: CARD_SIZE,
    desc: "画 2 张：主图 + 一张参考图，照着主图画同一个对象",
  },
  {
    id: "master",
    label: "精绘",
    model: "doubao-seedream-5-0-pro-260628",
    // ★ 2（不是 3）：出片管线一张卡最多喂 2 张，第 3 张是画了也用不上的（见 slotsFor）
    views: 2,
    size: CARD_SIZE,
    // 实测 2026-08-11：pro 出一张 1296×1728 用了 73.6 秒，是 5.0（21-25s）的三倍多。
    // 客户端出图超时因此必须 > 服务端 T_CREATE，见 ai/arkClient 的说明。
    desc: "同样 2 张，换最新旗舰模型来画 · 形象更准、细节更实，出图较慢",
  },
];

export const DEFAULT_IMAGE_TIER = "sketch";

/**
 * 按 id 查档位。
 * ★ 兜底用 **DEFAULT_IMAGE_TIER 常量**，不学 tierOf 那样写 `IMAGE_TIERS[1]` —— 下标兜底
 *   在往数组前面插一档时会**静默**变成另一档，而这种错没有任何症状。
 */
export function imageTierOf(id: string | undefined): ImageTier {
  return IMAGE_TIERS.find((t) => t.id === id) ?? IMAGE_TIERS.find((t) => t.id === DEFAULT_IMAGE_TIER)!;
}

/**
 * 「这一档现在报不报得出价」—— **唯一实现**。null = 能报价，否则是一句给用户看的原因。
 *
 * ★ 形状照抄 account.tierBlockReason：界面拿它决定"这颗按钮能不能按、旁边写什么"，
 *   而不是各自去 IMAGE_TOKENS_BY_MODEL 里探一次（铁律六）。
 * ★ 为什么非要有这么一句：价目缺失时唯一诚实的做法是**既不报价也不开炼**。
 *   放它过去只有两个下场 —— 按 0 收（页面写着免费、火山照扣），或者在 render 里抛
 *   （白屏，用户一个字都看不到）。两个都是本仓最怕的形状。
 */
export function imageTierPriceIssue(tierId?: string): string | null {
  const t = imageTierOf(tierId);
  if (imagePriceOf(t.model) !== null) return null;
  return `「${t.label}」这一档暂时报不出价（${modelLabel(t.model)} 不在价目表里），先用别的档位`;
}

/**
 * 一张出图的 token 等价（按档位）。非铸卡路径（设定帧/方案首尾帧）走 IMAGE_TOKENS。
 * ★ 返回 null = **这一档报不了价**，不是"免费"。类型上就是 nullable，调用方想当 0 用
 *   得自己写 `?? 0` —— 那时候至少是一次显式的、看得见的选择。
 */
export function imageTierTokens(tierId?: string): number | null {
  return imagePriceOf(imageTierOf(tierId).model);
}

/**
 * 非铸卡路径（补设定帧、三套方案的首尾帧、AI 封面、提炼卡组）一张出图的 token 等价。
 * ★ 跟着默认档走，不再是一个手写常量 —— 手写常量正是"折的是 4.0 的价、跑的是 5.0"
 *   那个错的来源。
 * ★★ 这里**一个字都不能抛**：它是模块顶层常量，抛出去就是 economy.ts 求值失败 →
 *   所有 import 它的模块连带失败 → app 连界面都挂不起来（白屏 + 只有 console 有话说）。
 *   "默认档一定在价目表里"是本模块的不变量（DEFAULT_IMAGE_TIER = 速写 = 4.0，就在表里）；
 *   万一哪天被改破，退到表里**最贵**的那个单价：报价宁可偏高也不能偏低 —— 偏低就是
 *   CLAUDE.md 里「页面报 ¥25、实际扣 ¥15」那条事故的方向。同时 console.error 点名，
 *   让改坏它的人当场看见。
 * ⚠ 留给人工确认：这几条路径**没有**"这一档报不了价"的界面出口（只有铸卡那条有，
 *   见 imageTierPriceIssue）。真要让它们也开口说话，得在各自的 TokenCost 旁边补一句，
 *   那些文件这一轮不归我改。
 */
export const IMAGE_TOKENS: number = ((): number => {
  const model = imageTierOf(DEFAULT_IMAGE_TIER).model;
  const n = imagePriceOf(model);
  if (n !== null) return n;
  console.error(`[economy] 默认出图档位的模型 ${model} 不在价目表里，暂按表里最贵的单价报价`);
  return Math.max(...Object.values(IMAGE_TOKENS_BY_MODEL));
})();

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
 * 这一档给这种卡出哪几张图 —— **全仓唯一实现**（铁律六）。
 * 报价、出图、结算、界面上那个张数，四处都只调它。
 *
 * ★ 用 `slice` 不做长度断言：档位的 `views` 是**名义上限**，某类卡的图位列表比它短时
 *   （顶档还写 3 那会儿，非人物卡就只有 2 格）就按短的来 —— 这个函数返回的才是
 *   **这一次的真张数**。报价与出图必须读同一次 slice 的结果，否则就是
 *   "页面报 3 张、实际画 2 张"。
 * ★ 为什么非人物卡只有 2 格：那是它们的图位表就只有 2 格（types.CARD_SLOTS）。
 *   ⚠ 这里原来写的理由是"出片管线对它们只读 viewsOf()[0] 一张"——**那条已经不成立**：
 *   2026-08-11 起 prepareMaterialRefs 改成两轮分配，预算有余时会给非人物卡补第 2 张。
 *   结论没变，理由变了。照旧理由读下去的人会得出"第 2 格也是白花钱"进而把它砍掉，
 *   那会静默地把刚补上的窟窿原样退回去（一张场景卡 16.7k 白花），且没有任何测试会拦。
 *
 * ★★ 为什么**没有档位敢把 views 写成 3**（顶档曾经写过，2026-08-11 改回 2）：
 *   出片管线对**任何一张卡**最多喂 2 张图 ——
 *     · 人物卡：只有第一张（主角）能带参考图，且按 face→body→detail 排序取前
 *       `MAX_CHAR_REFS = 2` 张（ai/real 规则一、规则三；依据是方舟指南「不建议用满
 *       素材上限，过多素材会导致模型难以判断特征优先级」）；
 *     · 非人物卡：图位表本来就只有 2 格（第 1 张保底，第 2 张在预算有余时进）。
 *   所以人物卡的第 3 格「标志性细节」**永远排在配额之外**：前两张必然已经占满。
 *   花钱替用户画它 = 卖一张卖不出去的图（一张顶档 40,000 token）。
 * ★ 但那一格不是废格，它是**手动专用**：用户可以在卡片详情页自己补一张 detail，
 *   而当这张卡缺 face 或 body 时它就轮得到（取图是按卡上真有的图排序，不是按图位表）。
 *   —— 所以删格子是错的，删的只是"铸卡自动出第 3 张"这件事。
 * ★ 这里仍然只 `Math.min(views, MAX_CARD_VIEWS)`，不再另写一个 `Math.min(…, 2)`：
 *   真正的 2 在 ai/real 那侧（`MAX_CHAR_REFS`）。它现在是导出的，但**照样不 import**——
 *   data 层反向依赖 ai 层会把依赖方向拧过来（ai/real 已经 import 本文件，会成环）。
 *   约束由档位表的 views 表达，理由写在这里；改 MAX_CHAR_REFS 的人请回来看这段。
 */
export function slotsFor(type: CardType, tierId?: string): readonly CardSlot[] {
  const k = Math.min(imageTierOf(tierId).views, MAX_CARD_VIEWS);
  return CARD_SLOTS[type].slice(0, k);
}

/**
 * 卡种还没定（🎲「让铸卡师看着办」）时**按哪一类报价** —— 取这一档下图位最多的那类。
 *
 * ★ 独立成函数是因为它有两个读者：forgeCost 的 null 分支（算钱）与素材窗的那句
 *   "先按最贵的人物卡报价"（说给用户听）。两边各写一份 reduce，哪天有人给场景卡
 *   加第 3 格，就会变成"嘴上说按人物卡报、实际按别的类算"—— 正是 CLAUDE.md 里
 *   「页面报 ¥25、实际扣 ¥15」那条事故的形状（铁律六）。
 * ★ 平手时取 CARD_TYPES 里靠前的那个（reduce 用严格大于）：五类现在图位数只有 1/2 两种，
 *   谁在前面都不影响钱数，但保证同一次渲染里"报价用的类"和"文案里写的类"是同一个。
 */
export function dearestCardType(tierId?: string): CardType {
  return CARD_TYPES.reduce((a, b) => (slotsFor(b, tierId).length > slotsFor(a, tierId).length ? b : a));
}

/**
 * 素材炼卡的预估：每张卡 = 一次豆包文案 + **这一档这一类要画的每一张图**。
 *
 * ★ `type` 为 null 是「让铸卡师看着办 · 按素材自动判断类型」那条路 —— 报价发生在
 *   卡种**已知之前**。这时按**最贵的那类**报（dearestCardType，与界面文案同一处），
 *   并由调用方在文案里说"最多"；按最便宜的报就是"界面按场景卡报价、实际按人物卡扣钱"，
 *   正是 CLAUDE.md 里「页面报 ¥25、实际扣 ¥15」那条事故的镜像版。
 * ★ 返回 null = **这一档报不出价**（价目表里没有它的模型），不是 0。调用方必须把它
 *   翻成一句人话并挡住开炼按钮（见 imageTierPriceIssue 与 NpcDialog.forge）。
 */
export function forgeCost(cardCount: number, type: CardType | null, tierId?: string): number | null {
  const one = imageTierTokens(tierId);
  if (one === null) return null;
  const per = slotsFor(type ?? dearestCardType(tierId), tierId).length;
  return cardCount * (CARD_META_TOKENS + per * one);
}

/**
 * 实际结算：按**每张卡真画成了几张图**收。
 *
 * ★ 入参是每张卡各自画成的张数，不是"出了卡面的卡数"。旧签名是一张卡一个布尔，
 *   物理上表达不了"该画 3 张、成了 2 张" —— 那种情况下用户被全额收费且全程零提示。
 * ★ 返回 null 同 forgeCost：这一档报不出价，别当 0 花掉。
 *
 * ⚠⚠ 这个"按实结算"**只在离线模式生效**。远端模式下 account.spendTokens 是**空操作**
 *   （余额镜像只由服务端的权威值写入），真扣费发生在服务端：**按每次方舟调用是否 2xx 记**，
 *   W2 只对非 2xx 退款。也就是说"图画出来了、只是取图那一步 504 / 弱网超时"的那一张，
 *   服务端照扣，而客户端把它算作"没画成"。
 *   所以界面上**绝不许**写"少的那几张没收你的钱" —— 那是客户端无从验证、也不成立的
 *   承诺，用户照它对账只会认定自己被多扣（见 NpcDialog 那句提示的措辞）。
 */
export function forgeSettle(mintedPerCard: number[], tierId?: string): number | null {
  const per = imageTierTokens(tierId);
  if (per === null) return null;
  return mintedPerCard.reduce((sum, n) => sum + CARD_META_TOKENS + n * per, 0);
}

// ── 一次铸卡最多出几张 ────────────────────────────────────────
//
// ★★ 这个上限**同时**决定三件事，而三者必须永远相等：
//   ① 报价：本文件的 extractCost / templateCost / deckCardsCost 按它算"最多花多少"；
//   ② 模型实际会返回几张：交给豆包的提示词里那句「输出 JSON 数组（0~N 张）」——
//      模型看到的是这个数，它决定实际出几张；
//   ③ 客户端实际会铸几张：ai/real.ts 的 mintCards 切掉多余的那一刀。
//   一旦分叉就是 CLAUDE.md 里「页面报 ¥25、实际扣 ¥15」那条事故：报小了用户被多扣，
//   报大了是吓唬人，而**两种都不报错、界面上什么症状都没有**。
//
// ★★ 2026-08-13 之前这个 8 在仓里有四份（本文件一份、mintCards 的 slice 一份、
//   两句提示词各一份），组件里还另有一份 MAX_CARDS。模板那条路当时**已经是错的**：
//   提示词写 0~6、mintCards 却切 8、界面按 6 报价 —— 模型多认出两张，
//   那两张卡面的钱就是白收的。所以这里不是"以后可能会分叉"，是已经分叉过了。
//
// ★ 因此上限是**带牌子的类型**（CardMintCap），不是裸 number：报价函数与 mintCards
//   都只收它，`extractCost(n, 8)` / `mintSpec(12, …)` 这类手写数字**编译不过**。
//   要改上限只能改下面这两个常量 —— 提示词由 mintSpec 从同一个值插值出来，
//   slice 用的也是同一个值，改一处三处一起动，漏不掉。
declare const CARD_MINT_CAP: unique symbol;
export type CardMintCap = number & { readonly [CARD_MINT_CAP]: true };

/** 成片派生卡组 / 上传视频提卡：一次最多出几张。 */
export const DECK_MAX_CARDS = 8 as CardMintCap;

/** 上传视频提**模板**时顺带出的素材卡上限。比提卡少是有原因的：模板不出 character 卡
 *  （主角由套模板的人自己指定），能复用的只剩场景/氛围/道具/画风四类。 */
export const TEMPLATE_MAX_CARDS = 6 as CardMintCap;

/** 看帧 + 铸卡面 —— 报价与结算共用这一条式子，两边分开写就会各自漂。 */
function visionCardsTokens(frameCount: number, cards: number, visionPasses = 1): number {
  return frameCount * VISION_FRAME_TOKENS * visionPasses + cards * IMAGE_TOKENS;
}

/**
 * 上传视频提炼卡组的预估：看 N 帧 + 最多铸 cap 张卡面。
 * 张数是上限而非确数（模型认出几个实体就出几张，重复的还会被剔掉），
 * 所以 UI 必须说"最多"，并用 extractSettle 按实际出卡张数结算。
 * ★ 第二个参数只收 CardMintCap：这里能手写数字的话，就又有了一处会和提示词分叉的 8。
 */
export function extractCost(frameCount: number, cap: CardMintCap): number {
  return visionCardsTokens(frameCount, cap);
}

/** 视频提卡的**实际结算**：看帧照收（已经看过了），卡面按真出了几张收。 */
export function extractSettle(frameCount: number, minted: number): number {
  return visionCardsTokens(frameCount, minted);
}

/** 视频提**模板**的预估。看帧要两遍（总结配方 + 认素材卡），所以视觉部分 2×。
 *  ★ 这式子原来长在 VideoTemplateExtractor 里，那里同时还自带一个 `MAX_CARDS = 6`——
 *    正是上面说的那处分叉。搬到这里是为了让它和 mintCards 读同一个 cap。 */
export function templateCost(frameCount: number, cap: CardMintCap): number {
  return visionCardsTokens(frameCount, cap, 2);
}

/** 视频提模板的实际结算：同样按真出了几张卡面收。 */
export function templateSettle(frameCount: number, minted: number): number {
  return visionCardsTokens(frameCount, minted, 2);
}

/**
 * 「炼一段」的**整笔**报价：出片 + 这一段还得现补几张设定帧。
 *
 * ★ 补帧条件与 studio/segmentGen 的第③步同源（缺首帧就画首帧；flf 档缺尾帧再画一张），
 *   这里只是把它折成钱。此前界面只报 segTokens，而简约模式恰恰是**两张帧都没有**的
 *   那条路 —— 用户看到 108k，实际还烧掉两张 Seedream（26.6k），差价没人说过一个字。
 * ★ 走**参考生视频**（refMode）时一张设定帧都不画，省下的钱必须从报价里也去掉：
 *   界面报一个用不上的价，和报低了一样是骗人。
 */
export function segmentCost(o: {
  durationSec: number;
  tierId?: string;
  /** 已经有起拍帧（自己的设定首帧，或承接上一段的真实尾帧） */
  hasFirstFrame: boolean;
  /** 已经有结束帧 */
  hasLastFrame: boolean;
  /** 这一段走参考生视频（多图直出，不画设定帧） */
  refMode: boolean;
}): number {
  const tier = tierOf(o.tierId);
  const draws = o.refMode ? 0 : (o.hasFirstFrame ? 0 : 1) + (tier.flf && !o.hasLastFrame ? 1 : 0);
  return segTokens(o.durationSec, o.tierId) + draws * IMAGE_TOKENS;
}

/** 整片合成的 token 估算：只算还没有真视频的段 */
export function composeCost(segments: Array<Pick<VideoSegment, "durationSec" | "videoUrl" | "videoTier">>): number {
  return segments.filter((s) => !s.videoUrl).reduce((sum, s) => sum + segTokens(s.durationSec, s.videoTier), 0);
}

/**
 * 一次 seed3d 建模的 token 等价。折算依据：doubao-seed3d-2.0 约 **2.4 元/次**
 * （带纹理 + PBR），标准档视频 15 元/M ⇒ 2.4/15 M = 160k。
 * 这是全 app **最贵的单次操作**——12 张 Seedream 的钱。它以前一分不收也一句提示
 * 没有，还由一条正则静默触发；那条正则现在是 styleWants3d（本文件下方），
 * 报价与触发读的是同一个判断。
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

// ── 成片派生卡组（组稿那一下）──────────────────────────────
//
// ★★ 这笔钱在 2026-08-12 之前**从来没在界面上出现过**：工作流顶栏那个"剩余约 xx"
//   只累加各段的 segmentCost，而按下「完成视频」还会静默烧掉最多 110k（8 张卡）
//   —— 撞上 3D 关键词再加最多 320k。用户看到的总价与实际扣的差一倍以上，
//   正是 CLAUDE.md 里「页面报 ¥25、实际扣 ¥15」那条事故的放大版。
//   所以下面这几个常量/函数的存在意义是：**让 UI 有东西可报**（FlowPage 顶栏与
//   「完成视频」旁那句话），而结算侧（studioStore.finalizeFromFlow）读同一份。

/** 派生卡组时最多顺带铸几个 3D 建模（只给派生出来的角色卡铸）。
 *  studioStore.finalizeFromFlow 传给 deriveCharacterModels 的上限读的就是它。 */
export const DECK_MAX_3D = 2;

/**
 * 「这条片的画风/剧情会不会触发 3D 建模」—— **全仓唯一一处**（铁律六）。
 *
 * ★★ 这条正则原来写死在 studioStore.finalizeFromFlow 里，是个**静默触发器**：
 *   剧情里出现"渲染"两个字，组稿就会去铸最多 2 个建模（每个 160k，全 app 最贵的
 *   单次操作）。搬到这里是为了让**报价与触发读同一个判断** —— 报价那侧自己再写一遍
 *   正则的话，多写少写一个词就是"界面说不铸、实际铸了"，而用户只会在账单上发现。
 * ★ 它匹配的是"用户已经写下的字"，所以在报价那一刻就**是确定的**（不是概率）：
 *   撞上就一定会去铸，没撞上就一定不铸。真正说不准的只有"派生出几张角色卡"（0~2 张），
 *   那部分只能按上限报、按实际结算。
 */
const STYLE_3D_RE = /3d|三维|立体感|cg|建模|皮克斯|pixar|渲染/i;

export function styleWants3d(text: string): boolean {
  return STYLE_3D_RE.test(String(text || ""));
}

/** 一张派生卡的单价：一次豆包文案 + 一次 Seedream 卡面。报价与结算共用。 */
const DECK_CARD_TOKENS = CARD_META_TOKENS + IMAGE_TOKENS;

/** 成片派生卡组：最多 DECK_MAX_CARDS 张，每张一次文案 + 一次卡面。
 *  与 extractCost 一样给的是**上限**——重复实体会被剔掉，按 deckCardsSettle 结算。 */
export function deckCardsCost(cap: CardMintCap = DECK_MAX_CARDS): number {
  return cap * DECK_CARD_TOKENS;
}

/** 派生卡组的**实际结算**：按真出了几张收。
 *  ★ 与 deckCardsCost 分成两个函数（同 forgeCost / forgeSettle）是因为参数类型不同：
 *    报价只能拿上限常量，结算拿的是运行期数出来的张数。合成一个的话，那个
 *    `CardMintCap` 牌子就得摘掉，"界面按 8 报价、实际切 12 张"又能编过了。 */
export function deckCardsSettle(minted: number): number {
  return minted * DECK_CARD_TOKENS;
}

/** 派生角色卡顺带铸 3D 建模的上限报价。★ 与实际结算（按 minted 张数）同一个单价。 */
export function deckModel3dCost(count = DECK_MAX_3D): number {
  return count * MODEL3D_TOKENS;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(Math.round(n));
}
