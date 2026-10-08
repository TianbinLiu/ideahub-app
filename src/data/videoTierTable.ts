// 出片档位的**能力 / 价目 / 分辨率表** —— 唯一出处（2026-10-07 从 economy.VIDEO_TIERS 拆出来，免费档限制 + 「草稿」档那一次）。
//
// 纯数据 + 纯函数、零运行时依赖（只许 `import type`）：构建里 scripts/check-video-tiers.mjs 直接 import 它核对表的不变量
// （id 不重、每行都写了 freeOk / resolution、免费档清单与服务端那份逐条相等、同一个模型的几行能力一致、每个（模型, 分辨率）都有价）。
// 界面上的字（档位名、一句话说明）不在这里 —— 那是界面文案，进 Lingui 目录，在 data/economy 把它们按 id 接上（VIDEO_TIERS）。
//
// ★★ 为什么必须拆出来：「草稿」与「高清」是**同一个模型**（Seedance 2.0 mini）的两档，只差分辨率（480p / 720p）与谁能用（免费 / 会员）。
//   这件事里每一处判错都是零报错：报 480p 的价、发 720p 的请求（钱包多扣一倍多）；按模型认档，「草稿」被认成「高清」（或反过来）；
//   免费档清单两仓各写一份、差一行就是「界面能点、服务端 403」。表的不变量只能在构建里实跑核对，而 economy.ts 拉着 lingui / db，Node 直接 import 不了。
// ★★ 跨仓契约：server 的 config/tokens.js（VIDEO_MULT / 每秒 token 的像素表 / FREE_VIDEO_ALLOW / RETIRED_MODELS_AT / VIDEO_SEC_WINDOW）
//   必须与本文件逐条相等，server 的 tests/arkProxy.spec.js 抄了一份按（模型, 分辨率）钉住。改这里先改服务端（服务端先发）。

// ── 模型 id ───────────────────────────────────────────────────────────
export const SEEDANCE_1_0_PRO_FAST = "doubao-seedance-1-0-pro-fast-251015";
export const SEEDANCE_1_0_PRO = "doubao-seedance-1-0-pro-250528";
export const SEEDANCE_2_0_MINI = "doubao-seedance-2-0-mini-260615";
export const SEEDANCE_2_5 = "doubao-seedance-2-5-260628";
export const MINIMAX_REAL = "MiniMax-Hailuo-2.3-Fast";

/**
 * Seedance 1.0 pro / pro fast（「标准」「极速」两档）的**停用时刻**。
 * ★ 方舟第十批下线公告：这两个模型 2026-11-24 14:00（北京时间）停服。我们**提前一小时**自己停（主人 10-07 拍板）：
 *   停服那一刻还在排队的任务结局没人说得准（受理了、钱扣了、片出不来），提前停就不会有新任务落进那个窗口。
 * ★ 与服务端 RETIRED_MODELS_AT 逐字相等：服务端过了这一刻整句拒新任务，App 把这两档藏起来、默认档往后退（firstLiveTierId）。
 */
export const RETIRE_1_0_AT = "2026-11-24T13:00:00+08:00";

// ── 每秒 raw token：W × H × 24 ÷ 1024（方舟官方「创建视频生成任务」文档的分辨率表，doc 1520757 第 717~742 行）──
//
// ★ 720p 一律 21,600（1280×720，与改之前同一个数）：r2v 的 adaptive 实测 1266×728 也是 92 万像素级，账单逐 token 核过（见 economy 文件头）。
//   720p 的竖屏 / 方形实际像素各不相同，但我们从开工起就按 1280×720 结算、账单也对得上 —— 不在这次一起改。
// ★ 480p / 1080p 按画幅查表；画幅缺省 / adaptive / 认不出 = 取那一行**最大**的一格（宁可多报，不能少收）。
//   2.0 系列（2.0 / fast / mini）与 2.5 的 480p 是两张表（16:9 一个 864×496、一个 854×480）。1080p 只给 2.5（样片定稿那一步）。
// ⚠ 480p 与 720p 同一个千 token 单价是**按账单行名推的**（「在线推理480P/720P」同一行），还没对过一张 480p 的真账单 —— 上线前跑一发核。
type Px = readonly [number, number];
type PxTable = Readonly<Record<string, Px>>;
const PX_480P_SEEDANCE_2_0: PxTable = { "16:9": [864, 496], "9:16": [496, 864], "4:3": [752, 560], "3:4": [560, 752], "1:1": [640, 640], "21:9": [992, 432] };
const PX_480P_SEEDANCE_2_5: PxTable = { "16:9": [854, 480], "9:16": [480, 854], "4:3": [752, 560], "3:4": [560, 752], "1:1": [640, 640], "21:9": [992, 432] };
const PX_1080P_SEEDANCE_2_5: PxTable = { "16:9": [1920, 1080], "9:16": [1080, 1920], "4:3": [1664, 1248], "3:4": [1248, 1664], "1:1": [1440, 1440], "21:9": [2206, 946] };

/** 720p 一秒的 raw token（1280×720×24÷1024）。全仓唯一一处：segTokens / r2v / 素材参考都读它 */
export const SEC_720P_TOKENS = (1280 * 720 * 24) / 1024;

/** 档位能选的分辨率（送进请求体的 resolution）。1080p 不是档位：只出现在电影级「样片」的定稿那一步 */
export type TierResolution = "480p" | "720p";
export type VideoResolution = TierResolution | "1080p";

/** 模型属于哪一代（像素表按代分）。认不出 = null */
function seedanceFamily(model: string): "2.0" | "2.5" | null {
  if (/seedance-2-5/.test(model)) return "2.5";
  if (/seedance-2-0/.test(model)) return "2.0";
  return null;
}

function tableOf(model: string, resolution: VideoResolution): PxTable | null {
  const fam = seedanceFamily(model);
  if (resolution === "480p") return fam === "2.0" ? PX_480P_SEEDANCE_2_0 : fam === "2.5" ? PX_480P_SEEDANCE_2_5 : null;
  if (resolution === "1080p") return fam === "2.5" ? PX_1080P_SEEDANCE_2_5 : null;
  return null;
}

const cellTokens = ([w, h]: Px): number => (w * h * 24) / 1024;
const maxCell = (tables: PxTable[]): number => Math.max(...tables.flatMap((tb) => Object.values(tb).map(cellTokens)));

/**
 * 一秒视频的 raw token —— **唯一实现**（报价 segTokens / 样片两步的报价都读它；服务端 config/tokens.perSecTokens 同一张表）。
 * ★ 认不出的（模型, 分辨率）组合不抛（报价在 render 里调，抛 = 白屏）：取这个分辨率所有表里最大的一格 —— 偏贵不偏便宜，
 *   而构建里 check-video-tiers.mjs 核对过档位表里每一行都查得到自己的表（hasPriceTable），走到这一支只可能是表外的数据。
 */
export function perSecTokens(model: string, resolution: VideoResolution, ratio?: string): number {
  if (resolution === "720p") return SEC_720P_TOKENS;
  const table = tableOf(model, resolution);
  if (!table) {
    return resolution === "1080p" ? maxCell([PX_1080P_SEEDANCE_2_5]) : maxCell([PX_480P_SEEDANCE_2_0, PX_480P_SEEDANCE_2_5]);
  }
  const cell = ratio ? table[ratio] : undefined;
  return cell ? cellTokens(cell) : maxCell([table]);
}

/** 这个（模型, 分辨率）在不在价表里（构建检查用：档位表的每一行都得查得到） */
export function hasPriceTable(model: string, resolution: VideoResolution): boolean {
  return resolution === "720p" || tableOf(model, resolution) !== null;
}

// ── 档位系数（元/百万 token ÷ 15，标准档 1.0-pro = 15 元/M = 1）──

/**
 * Seedance 2.5 的档位系数：**70 元/百万 token**（不含视频输入）⇒ 70/15 ≈ 4.67，取 4.7。
 * 交叉验证：另一来源报「720P 每秒约 1.51 元」，而 1 秒 720p24 = 21,600 token = 0.0216M ⇒ 1.51/0.0216 ≈ 69.9 元/M，与 70 吻合。
 * ⚠ 这个数**不是从方舟官方价目表页面读到的**，是两个独立来源互相印证得来的。真实结算永远以账单为准。
 * ★ 样片（draft）第一步也按它收（480p 的像素 × 4.7，主人 10-07 拍板）。
 */
export const ULTRA_MULT = 4.7;

/**
 * Seedance 2.5 **含视频输入**档（r2v/白模模板）的系数：42 元/百万 token ÷ 15 = 2.8。
 * ✅ 对过真账单：2026-08 A3 实测两发，raw 用量与 economy 文件头那条公式逐 token 相等；2026-08-15 费用中心又逐行核过（¥0.042/千 token）。
 * ★ 与 ULTRA_MULT 不是一个东西也**不许互相推导**：方舟按请求里有没有 reference_video 分档计价，server 的 resolveR2v 也按同一判据换表。
 */
export const ULTRA_R2V_MULT = 2.8;

/**
 * 高清（Seedance 2.0 mini）**含视频输入**档的系数：官方刊例 14 元/百万 token ÷ 15 = 14/15。
 * 2026-10-05 主人「合」开高清的片段重拍 + 参考视频出片。⚠ 还没对过账单（探测那三个任务原价 ¥3.04 = 14 元/M、¥4.99 = 23 元/M）。
 *   核出来不是 14 就两仓一起改（server config/tokens.js 的 VIDEO_MULT_R2V 同一个数，arkProxy.spec 钉着）。
 */
export const HD_R2V_MULT = 14 / 15;

/**
 * 电影级「样片」**定稿**那一步（2.5 把 480p 的样片升成 1080p 成片）的系数：77/15（主人 10-07 拍板，约 ¥22 / 5 秒两步合计）。
 * 时长 = 样片的时长（服务端按自己登记的那一发算，不收请求体里的数），像素按 1080p 那张表。
 */
export const DRAFT_FINAL_MULT = 77 / 15;

/** 样片任务号在方舟那边的有效期是 7 天；我们只在**还剩一小时以上**时才让人定稿（服务端同一个数） */
export const DRAFT_VALID_MS = 7 * 24 * 3600_000 - 3600_000;

/** Seedance 档位的能力与价目（不含界面文案）：id 持久化在 VideoSegment.videoTier / EditorState.videoTier */
export interface VideoTierSpec {
  id: string;
  model: string;
  /**
   * 这一档走哪个供应商。缺省（不写）= 方舟（Seedance）。
   * ★ 加它是因为**计价模型根本不同**：方舟按 token 连续计（时长×每秒×系数），MiniMax 按发固定价（见 flatCost）。
   *   协议层（谁来出片）也按它分流：ark → ai/arkClient，minimax → server 的 /api/minimax 代理。
   * ★ 判否定：缺省即 ark，别到处 `?? "ark"`（第二处默认值）——统一走 economy.providerOf()。
   */
  provider?: "ark" | "minimax";
  /**
   * **按发固定计价表**（token/发，按时长档查）。非空 = 这一档不按 token 连续计，segTokens 改查这张表。
   * ★★ 报价=实扣的锚（成本价 1.0x）：官方美元单价 × 全仓锚 **$1 = 447,563 token** 折算取整（2026-09-26 起）。
   *   ⚠ server 的结算价（config/tokens.MINIMAX_FLAT_COST，按**模型**分行）必须与「真人」那一行逐条相等（realPersonProxy.spec.js 钉着）。
   */
  flatCost?: Record<number, number>;
  /** token 消耗系数（相对标准档；按模型单价折算）。flatCost 档不看它，随便填 1 */
  mult: number;
  /**
   * 送进请求体的分辨率（2026-10-07 起每行必写）。★ 价钱跟着它走（perSecTokens）：「草稿」与「高清」同一个模型，只差这一格。
   * ★ 只管纯任务：r2v / 延长 / 白模 / 返修那几条路服务端钉死 720p（resolveR2v），协议层 arkClient 照钉。
   * 真人档（MiniMax 768P）这一格不发给任何人，写 720p 只是为了「每行都写」。
   */
  resolution: TierResolution;
  /** 是否支持首尾帧模式（flf2v）。实测 pro-fast 只收首帧：报 task_type flf2v not support */
  flf: boolean;
  /**
   * 是否支持**参考图**（全模态参考生视频：多张形象图 + 一句话直出，不需要设定帧）。
   * ★ 写死在表里，**不靠运行时探测**：`reference_image` 只有 Seedance 2.5 与 2.0 系列支持。由这个标志做**硬白名单**
   *   （见 studio/segmentGen 的 refVideoOn），不满足就退回首尾帧模式**并把原因说出来**。
   * ★ 每一档显式写 false / true，不留 undefined —— 留空就得到处 `?? false`，那是第二处默认值。
   */
  refImg: boolean;
  /**
   * 这一档**协议上**一次最多收几张参考图（只对 refImg/assetRef 为真的档有意义）：2.0 系列 1–9 张、2.5 是 1–30 张。
   * ★ 预算分配（ai/real.allocateRefs）按它砍：少发是白白砍功能，多发是整条请求 400（2.0 收到第 10 张不是忽略是拒收）。
   */
  refImagesMax?: number;
  /**
   * 能不能**带参考视频**出片（片段重拍、自定义的示例视频）。高清与电影级能，「草稿」不能（服务端把参考视频那几条路钉在 720p）。
   * ★ 每一档显式写值（同 refImg 的理由）。判据在 economy.r2vPriceIssue。
   */
  refVid: boolean;
  /**
   * r2v 档位系数（口径同 mult）。**null = 这一档没有 r2v 价** —— 不是 0、不是免费，r2vTokens 返回 null、r2vPriceIssue 整句拦下。
   */
  r2vMult: number | null;
  /**
   * 能不能「往后延长」（extend 子任务）。★ 与 refVid **分开**一位：2026-10-05 付费探测 —— 高清延长接缝处画面跳一下，电影级两轮都接得上。
   * 读它的三处：flowStore.extendIssue、genNode 出片之前、segmentGen 的延长那一支。
   */
  extendOk: boolean;
  /**
   * 能不能跑**白模模板**（参考视频 edit 逐镜头复刻、只换主体）。★ 与 refVid **分开**一位：白模化那一发由服务端钉在 2.5，
   * 模板上的角色位、时长窗口都是照着 2.5 量出来的。读它的：economy.blockoutTier、blockoutPriceIssue、real.validateGenSpec。
   */
  blockoutOk: boolean;
  /**
   * 能不能走「样片」（2.5 的 draft 模式：先出 480p 样片看效果，满意再按同一份样片升成 1080p 成片）。今天只有电影级（方舟只给 2.5 开了 draft）。
   * ★ 逐档显式写（同 refImg 的理由）。界面与出片那一半在 A2（components/flow/DraftModeBox），判据只读这一位。
   */
  draftOk: boolean;
  /**
   * 这一档的出片**带不带 AI 生成的环境音**（协议侧发 `generate_audio: true`）。
   * ★★ 分界在**模型代际，不在价钱** —— 2026-08-15 实测：2.x 真出声（2.0-mini -30.2dB、2.5 -27.5dB），1.x **收下这个参数却静默忽略**。
   * ★ 开音频**零额外成本**（2026-08-15 费用中心逐行核对：有声 / 无声两发用量与单价完全相同），所以这一格**不进任何报价公式**。
   * ★ 协议侧（ai/arkClient.generateVideo）按 **model id** 回查这一格（economy.videoAudioOn）：同一个模型的几行这一格必须相同（构建检查钉着）。
   * ⚠ 今天挡住白模声音的只有 app 自己的 `arkClient.BLOCKOUT_TASK`（版权拦截换来的），要动先读那个常量头上那段 ★★。
   */
  audio: boolean;
  /**
   * 这一档收不收**真人照片素材**（声明过 `Card.realPerson` 的卡当参考图）。
   * ★★ 方舟各档全 false 是**实测结论**（2026-08-24）：方舟对真人参考图两套探测器全拦（名人按版权、普通人按隐私），整发拒收。
   *   只有 MiniMax 真人档是 true —— 门禁（account.realFaceIssue）靠它放行，本表之外不许再翻 realPerson。
   */
  realFace: boolean;
  /**
   * 这一档的模型收不收**方舟可信素材**（`asset://<id>`，已授权的真人人像）。官方文档：Seedance 2.0 与 2.5 系列支持，1.0 不支持 ——
   * 跟着**模型代次**走（「草稿」也是 2.0 mini，所以也收）。与 `realFace` 是两件事，别合并。
   */
  assetRef: boolean;
  /**
   * **免费用户能不能用这一档出片**（2026-10-07 主人拍板：没付过钱的用户只能用「极速」与「草稿」）。白名单：新加一档默认就是会员档，除非有人明写 true。
   * ★ 判据只有 data/account.tierBlockReason 一处（「付过钱」= 套餐价 > 0 或付过任何一笔，与服务端 isPaidUser 同口径）；这只是**提示**，
   *   真正的拦截在服务端（videoPlanDenial，403 PLAN_REQUIRED）。
   * ★★ 与服务端 FREE_VIDEO_ALLOW 逐条相等（下面的 FREE_VIDEO_ALLOW 是它的镜像，构建检查核对两者）。
   */
  freeOk: boolean;
  /** 停用时刻（ISO，带时区）。过了这一刻：服务端整句拒新任务，App 把这一档藏起来、默认档往后退（tierRetired）。缺省 = 不下线 */
  retireAt?: string;
  /**
   * 这一档允许的最短时长（秒）。★ Seedance 2.5 与 2.0 mini 都是 4 起（3 秒同步 400）。
   * 收在档位表里，**报价（segTokens）与出片（composeSegments）用的是同一个 clampDuration**。
   */
  minSec: number;
  /**
   * 这一档允许的最长时长（秒）。2.0 系列 15、2.5 30（方舟协议上限），1.0 两档 10，真人档只有 6 / 10 两整档。
   * ★★ 与服务端 `config/tokens.js` 的 `VIDEO_SEC_WINDOW` **逐条相等**（跨仓契约）。同一个模型的几行必须相同（协议层按模型查窗口）。
   */
  maxSec: number;
}

/**
 * 档位表本体。一行一档，**每一格都写**（能力位、分辨率、freeOk 一个都不许靠缺省）。
 * ★ 顺序 = 界面上那一排的顺序（按价钱从低到高）。**判据一律认 id**，不认下标：economy.tierOf 的兜底是显式 id（firstLiveTierId），
 *   在前面插一档不会悄悄改掉「认不出的 id 落到哪一档」。
 * ✅ 2026-08-16 拿 8 月账单明细逐行核过 mult。写成 `4.2 / 15`、`23 / 15` 这种**分数形态**是有意的：分子就是账单上那个「元/千token × 1000」的数。
 */
export const VIDEO_TIER_SPECS: readonly VideoTierSpec[] = [
  // fast 是 1.0-pro fast：`generate_audio` 收下就扔（实测），所以 audio 显式 false。免费档之一（主人 10-07），11-24 下线
  { id: "fast", model: SEEDANCE_1_0_PRO_FAST, mult: 4.2 / 15, resolution: "720p", flf: false, refImg: false, refVid: false, r2vMult: null, extendOk: false, blockoutOk: false, draftOk: false, audio: false, realFace: false, assetRef: false, freeOk: true, retireAt: RETIRE_1_0_AT, minSec: 3, maxSec: 10 },
  // ★ 草稿（2026-10-07 新加）：与高清**同一个模型**（2.0 mini），只是 480p —— 每秒 10,044 raw token（864×496 / 496×864），
  //   约高清的 47%。能力与高清一样（参考图 9 张、出声、收可信素材），只是不带参考视频（服务端把参考视频那几条路钉在 720p）。
  //   免费档之一，也是 11-24 之后免费用户唯一的档（极速下线）。
  { id: "draft", model: SEEDANCE_2_0_MINI, mult: 23 / 15, resolution: "480p", flf: true, refImg: true, refImagesMax: 9, refVid: false, r2vMult: null, extendOk: false, blockoutOk: false, draftOk: false, audio: true, realFace: false, assetRef: true, freeOk: true, minSec: 4, maxSec: 15 },
  { id: "std", model: SEEDANCE_1_0_PRO, mult: 1, resolution: "720p", flf: true, refImg: false, refVid: false, r2vMult: null, extendOk: false, blockoutOk: false, draftOk: false, audio: false, realFace: false, assetRef: false, freeOk: false, retireAt: RETIRE_1_0_AT, minSec: 3, maxSec: 10 },
  // ★ hd 的视频参考 2026-10-05 开（主人「合」）：refVid true、r2vMult = HD_R2V_MULT。延长不开（extendOk，接缝会跳）；白模模板不开（blockoutOk）。
  // ★ minSec 4（2.0 mini 不收 3 秒）、maxSec 15（2.0 系列的协议上限）
  { id: "hd", model: SEEDANCE_2_0_MINI, mult: 23 / 15, resolution: "720p", flf: true, refImg: true, refImagesMax: 9, refVid: true, r2vMult: HD_R2V_MULT, extendOk: false, blockoutOk: false, draftOk: false, audio: true, realFace: false, assetRef: true, freeOk: false, minSec: 4, maxSec: 15 },
  {
    id: "ultra",
    model: SEEDANCE_2_5,
    mult: ULTRA_MULT,
    resolution: "720p",
    flf: true,
    refImg: true,
    refImagesMax: 30,
    // ★ r2v 已开闸（2026-08-14，前置三发实测全过才翻的这个布尔），系数钉死在 ULTRA_R2V_MULT
    refVid: true,
    r2vMult: ULTRA_R2V_MULT,
    // 延长两轮都接得上（2026-10-05 付费探测 U1 / U2）
    extendOk: true,
    // 白模模板只有这一档（白模化那一发由服务端钉在 2.5）
    blockoutOk: true,
    // 样片（draft 模式）只有 2.5 有（方舟官方：draft / draft_task 仅 Seedance 2.5 支持）
    draftOk: true,
    audio: true,
    realFace: false,
    assetRef: true,
    freeOk: false,
    minSec: 4,
    maxSec: 30,
  },
  {
    id: "real",
    // 供应商换成 MiniMax（海螺，768P）：方舟对真人参考图两套探测器全拦，海螺同一批图输入输出两端都放行且成片落地。
    // ⚠ 合规口径 2026-09-26 变了：服务端走**国际站** `api.minimax.io`，真人照片**是出境的**。
    // ★ 2026-09-26 换成 2.3-Fast：官方同能力、便宜 37%；它只支持图生视频，而真人档首帧恒为真人照片，不构成问题。
    model: MINIMAX_REAL,
    provider: "minimax",
    // 按发一口价：官方 $0.19/发(6s)、$0.32/发(10s)，按全仓锚 $1=447,563 折算取整。⚠ server 的 MINIMAX_FLAT_COST 必须逐条相等。
    flatCost: { 6: 85_000, 10: 143_200 },
    mult: 1,
    // 768P，不发给方舟；写 720p 只是「每行都写」
    resolution: "720p",
    // 首帧图实测可用；尾帧、参考图、r2v 海螺都没有
    flf: false,
    refImg: false,
    refVid: false,
    r2vMult: null,
    extendOk: false,
    blockoutOk: false,
    draftOk: false,
    // 海螺出片有没有原生音频没实测过——先按无声报（往少承诺的方向错）
    audio: false,
    // ★ 全表唯一的 true：realFaceIssue 靠它放行（唯一判定处）
    realFace: true,
    assetRef: false,
    // 会员档（主人 10-07：免费用户只能用极速与草稿）
    freeOk: false,
    minSec: 6,
    // 按发计价只有 6 / 10 两整档（clampDuration 吸附到价表档位），这一格只给时长按钮用
    maxSec: 10,
  },
];

/**
 * 免费用户能出片的（模型, 分辨率）—— **服务端 config/tokens.FREE_VIDEO_ALLOW 的镜像**（label 是给服务端那句拒绝话用的冻结中文档名）。
 * ★ 档位表里 freeOk 的那几行必须与它一一对应（构建检查核对）：两仓各写一份、差一行就是「界面能点、服务端 403」。只管纯任务（不含 r2v / 样片）。
 */
/* i18n-frozen: 跨仓契约的冻结中文档名（服务端那句拒绝话里用），不是界面文案 */
export const FREE_VIDEO_ALLOW: ReadonlyArray<{ model: string; resolution: TierResolution; label: string }> = [
  { model: SEEDANCE_1_0_PRO_FAST, resolution: "720p", label: "极速" },
  { model: SEEDANCE_2_0_MINI, resolution: "480p", label: "草稿" },
];

/** 这一档到 now 为止停用了没有（retireAt 缺省 = 不下线）。★ 唯一判据：界面藏不藏、默认档往哪退、出片拦不拦都问它 */
export function tierRetiredAt(spec: Pick<VideoTierSpec, "retireAt">, now: number): boolean {
  return !!spec.retireAt && now >= Date.parse(spec.retireAt);
}

/**
 * 默认档的退路（显式 id，不按下标）：付费用户 / 目录兜底「标准」→ 下线后「高清」；免费用户「极速」→ 下线后「草稿」（主人 10-07 拍板）。
 * ★ 为什么是一条链而不是一个常量：「标准」「极速」11-24 下线，那之后默认档还指着它们，新段一出生就是一个出不了片的档。
 */
export const PAID_DEFAULT_CHAIN: readonly string[] = ["std", "hd"];
export const FREE_DEFAULT_CHAIN: readonly string[] = ["fast", "draft"];

/**
 * 链上第一档**到 now 还没下线、且 ok 认它**的 id；一档都不行就回链上最后一档（交给出片闸说清为什么）。
 * ok 缺省 = 只看下线；调用方（account.defaultTierId）另加「这台服务器支不支持」那一条。
 */
export function firstLiveTierId(chain: readonly string[], now: number, ok: (id: string) => boolean = () => true): string {
  for (const id of chain) {
    const spec = VIDEO_TIER_SPECS.find((s) => s.id === id);
    if (spec && !tierRetiredAt(spec, now) && ok(id)) return id;
  }
  return chain[chain.length - 1];
}
