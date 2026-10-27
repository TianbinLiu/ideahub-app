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
//   必须与本文件逐条相等，server 的 tests/arkProxy.spec.js 抄了一份按（模型, 分辨率）钉住。改这里先改服务端（服务端先发）——
//   ⚠ **涨价方向反过来**（App 先发、服务端后上）：App 的报价只在本机算，服务端先涨的话没升级的 App 报少扣多。判据：
//   过渡期里既不许「界面能点、服务端拒」，也不许「报价 < 实扣」（放宽窗口 / 降价 = 服务端先；涨价 = App 先）。
//   涨价的样板是 materialRefInputSec（2026-10-19）。
// ★★ MiniMax H3 三行（出片地区 P2b，2026-10-26）另有一份契约：server config/tokens.js 的 MINIMAX_SEC_COST（按秒价目）/ MINIMAX_V2_MAX_IMAGES /
//   VIDEO_SEC_WINDOW 的 H3 三格 / FREE_VIDEO_ALLOW 的 H3-Lite 那一行，server tests/arkProxy.spec.js 的 APP_MM_TIERS 抄了这三行（「跨仓 MiniMax H3 价目」）。
//   本仓的 scripts/check-video-tiers.mjs 反过来抄一份服务端的数逐条核。新增档位走「服务端先上」（server#132 部署之后带这三行的 App 才能发）。

// ── 模型 id ───────────────────────────────────────────────────────────
export const SEEDANCE_1_0_PRO_FAST = "doubao-seedance-1-0-pro-fast-251015";
export const SEEDANCE_1_0_PRO = "doubao-seedance-1-0-pro-250528";
export const SEEDANCE_2_0_MINI = "doubao-seedance-2-0-mini-260615";
export const SEEDANCE_2_5 = "doubao-seedance-2-5-260628";
export const MINIMAX_REAL = "MiniMax-Hailuo-2.3-Fast";
/**
 * MiniMax H3 三个模型（国际站 V2 出片，2026-10-26）：「草稿 / 高清 / 电影级」在 MiniMax 上的对标（主人 10-26 定：草稿 → H3-Lite 480P、
 * 高清 → H3-Highspeed 768P、电影级 → H3 768P，2K 先不开）。与服务端 config/tokens 的 MINIMAX_H3_* 逐字相等。
 * ★ 与 MINIMAX_REAL（真人档的海螺 2.3，V1 接口、按发一口价）不是一回事：H3 走 V2 接口、按秒计价、收参考图。
 */
export const MINIMAX_H3_LITE = "MiniMax-H3-Lite";
export const MINIMAX_H3_HIGHSPEED = "MiniMax-H3-Highspeed";
export const MINIMAX_H3 = "MiniMax-H3";
/**
 * H3 一段（一个 V2 任务）最多几张图：首帧 + 尾帧 + 参考图**合计**（V2 里首尾帧与参考图互斥，所以参考图单独也是这个数）。
 * = 官方每个任务免费的张数 —— 价目里因此没有「每张图多少钱」；第 6 张起服务端报不了价、在扣费之前整句拒。与服务端 MINIMAX_V2_MAX_IMAGES 相等
 */
export const MINIMAX_V2_MAX_IMAGES = 5;

/**
 * 模型 id → 给人看的名字（`doubao-seedance-2-0-mini-260615` → `Seedance 2.0 mini`，`MiniMax-Hailuo-2.3-Fast` → `MiniMax Hailuo 2.3 Fast`）。
 * 出片、出图两边的模型名都从这里推导；界面上说「这一段交给哪个出片模型」一律走 economy.tierModelLabel（它在这个名字后面接分辨率），
 * 手上只有 id、没有档位时（配方里记着的「当时的模型」）才直接用它。economy 原样转出（`economy.modelLabel`），调用方照旧从 economy 引。
 *
 * ★ **从 id 推导，不另外维护一张对照表**。手写一张 `{id: 名字}` 的表，加档位时忘了补
 *   就是"界面上写着标准档、实际跑的是另一个模型"——而这种错没有任何症状，只会让人
 *   在对不上账时怀疑是自己记错了。推导出来的名字永远跟着真正发出去的那个 id 走。
 * ★ 认不出来就**原样返回 id**，不返回"未知模型"：id 本身就是最准确的信息，
 *   宁可显示得难看一点，也不能把它藏起来。构建里 check-video-tiers.mjs 核对档位表里每个模型都认得出（2026-10-26 加：
 *   真人档的 `MiniMax-Hailuo-2.3-Fast` 从 09-26 起就一直原样上屏 —— 方舟那套规则只认小写开头，而这件事零报错）。
 * ★ 方舟的 id（`doubao-<家族>-<主>-<次>-<变体>-<日期>`）：去掉 `doubao-` 前缀与尾巴上那串日期（`-260615` 是方舟的版本戳，
 *   对用户没有意义；要查证的人看档位说明里的完整 id（title））。
 * ★ MiniMax 的 id 本身就是官方名、只是用连字符连着（`MiniMax-H3-Highspeed`、`MiniMax-Hailuo-2.3-Fast`），把连字符换成空格就是。
 *   ⚠ 别把它并进方舟那条正则：那条要的是「主-次」两段数字（`2-0` → `2.0`），MiniMax 的版本号本来就带点（`2.3`），硬套会认错。
 * ★ 放在这个零依赖模块里（2026-10-26 从 economy 搬过来）只为让构建检查能直接 import 它跑正反例 —— 规则本身一个字没变（方舟那一半）。
 */
export function modelLabel(modelId: string): string {
  const raw = String(modelId || "");
  if (MINIMAX_MODEL_ID.test(raw)) return raw.replace(/-+/g, " ").trim();
  const s = raw.replace(/^doubao-/, "").replace(/-\d{6,8}$/, "");
  const m = /^([a-z0-9]+)-(\d+)-(\d+)(?:-(.+))?$/.exec(s);
  if (!m) return modelId;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  const variant = m[4] ? ` ${m[4].replace(/-/g, " ")}` : "";
  return `${family} ${m[2]}.${m[3]}${variant}`;
}

/** MiniMax 的模型 id 长什么样（`MiniMax-H3`、`MiniMax-Hailuo-2.3-Fast`）—— modelLabel 与 providerOfModel 共用这一条，别各抄一份 */
const MINIMAX_MODEL_ID = /^MiniMax-[A-Za-z0-9]/;

/**
 * 一个**记下来的**出片模型 id 是哪一家的（2026-10-26 出片地区终审）—— 配方 / 作品里记着「当时用的是哪个模型」，那一档今天可能已经换了型号，
 * 按档位的 provider 认不出它；account.recordedModelName 拿它判「这个地区给不给这一家、写不写名字」。
 * ★ 与档位表的 provider 同一套名字；认不出的（`doubao-…`、空串、以后的新型号）一律按方舟（档位表的缺省也是方舟）。构建里 check-video-tiers 核对每一行
 *   providerOfModel(行.model) === 行.provider ?? "ark"。
 */
export function providerOfModel(modelId: string): "ark" | "minimax" {
  return MINIMAX_MODEL_ID.test(String(modelId || "")) ? "minimax" : "ark";
}

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
// ✅ 480p 与 720p 同一个千 token 单价：**刊例已核**（火山方舟价目页 https://docs.volcengine.com/docs/ark/model-pricing，2026-10-19 读：
//   2.0 mini「输出视频分辨率为 480p，720p」同一行，无视频输入 ¥23/M、有视频输入 ¥14/M；2.5 的 480p / 720p 同一行，无视频输入 ¥70/M、有视频输入 ¥42/M）。
//   10-19 付费验证任务 cgt-20261020073411-2jh9n（草稿 · 2.0 mini 480p 9:16 4 秒）：用量 40,594 = 97 帧 × 496×864 ÷ 1024（取整），
//   服务端实扣 61,603 = App 报价（按 4 秒报，比 97 帧少 1%，已知误差）。账单行「Doubao-Seedance-2.0-mini 在线推理（无输入视频）」
//   （应为 ¥0.023/千 token，看单价 / 原价那一列）待主人在费用中心核。
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
/**
 * MiniMax H3（V2）请求体里的分辨率写法：上游的大写原样（`480P` / `768P`；2K 先不开）。只有 api "minimax-v2" 的行写它（VideoTierSpec.upstreamResolution）。
 * ★ 与小写的 TierResolution 是两套写法、**不归一大小写**：服务端价目表（MINIMAX_SEC_COST）、免费档清单（FREE_VIDEO_ALLOW）、健康端点的 freeVideo
 *   都按上游原样认（server tokens.js FREE_VIDEO_ALLOW 的 ★）—— 拿小写的 resolution 去比，免费用户看见灰键、服务端其实放行（2026-10-26 审核）。
 */
export type UpstreamResolution = "480P" | "768P";

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
 * ✅ 刊例已核（火山方舟价目页 2026-10-19：2.5 480p / 720p「输入不含视频」¥70/M —— 原来这里写的「不是从官方价目页读到的」作废）。
 *   10-19 付费验证任务 cgt-20261020073912-9e452（电影级 720p 9:16 4 秒）：用量 87,300 = 97 帧 × 900，服务端实扣 406,080 = App 报价。
 *   账单行「Doubao-Seedance-2.5 在线推理 480P/720P（无输入视频）」（应为 ¥0.070/千 token）待主人在费用中心核 ——
 *   10-05 / 10-06 端到端验证那几发电影级也在账单上，同一个单价。
 * ⚠ 4.7 比 70/15（4.667）多收约 0.7%（当初取整的结果；样片第一步也用这个系数）：留 4.7 还是两仓改成 70/15，等主人定（改的话
 *   server tokens.VIDEO_MULT 与 arkProxy.spec 的跨仓一致性一起改；这是降价方向 ⇒ 服务端先、App 后，理由见 materialRefInputSec 的 ★★）。
 * ★ 样片（draft）第一步也按它收（480p 的像素 × 4.7，主人 10-07 拍板）。
 */
export const ULTRA_MULT = 4.7;

/**
 * Seedance 2.5 **含视频输入**档（r2v/白模模板）的系数：42 元/百万 token ÷ 15 = 2.8。
 * ✅ 对过真账单：2026-08 A3 实测两发，raw 用量与 economy 文件头那条公式逐 token 相等；2026-08-15 费用中心又逐行核过（¥0.042/千 token）。
 *   刊例 2026-10-19 再核一次（价目页：2.5 480p / 720p「输入包含视频」¥42/M）。⚠ 含输入视频时有**最低用量**（10-19 付费验证
 *   cgt-20261020074220-c7l9g 往后延长 7 秒按最低用量收），见 materialRefInputSec。
 * ★ 与 ULTRA_MULT 不是一个东西也**不许互相推导**：方舟按请求里有没有 reference_video 分档计价，server 的 resolveR2v 也按同一判据换表。
 */
export const ULTRA_R2V_MULT = 2.8;

/**
 * 高清（Seedance 2.0 mini）**含视频输入**档的系数：官方刊例 14 元/百万 token ÷ 15 = 14/15。
 * 2026-10-05 主人「合」开高清的片段重拍 + 参考视频出片。
 * ✅ 刊例已核（火山方舟价目页 2026-10-19：2.0 mini 480p / 720p「输入包含视频」¥14/M、「输入不含视频」¥23/M；页上 mini 的价格示例
 *   「含视频 720p ¥2.72~6.05」= (4+5)×21,600×14/M 到 (15+5)×21,600×14/M，单独印证了 14）。10-19 付费验证：
 *   cgt-20261020073613-4gq5v（片段重拍 edit 4 秒）用量 173,700 = (4 + 97/24) × 21,600，服务端实扣 161,280 = App 报价；
 *   cgt-20261020074617-sxmps（示例视频出片 7 秒）用量 260,100，按最低用量收（见 materialRefInputSec）。
 *   账单行「Doubao-Seedance-2.0-mini 在线推理（有输入视频）」（应为 ¥0.014/千 token；mini 含视频有过 4 折促销，看单价 / 原价那一列、
 *   别看应付；出账可能晚一天）待主人在费用中心核。核出来是 0.023 就两仓一起改成 23/15（server config/tokens.js 的 VIDEO_MULT_R2V 同一个数，
 *   arkProxy.spec 钉着）—— 那是涨价方向 ⇒ App 先发、服务端后上（理由见 materialRefInputSec 的 ★★）。
 */
export const HD_R2V_MULT = 14 / 15;

/**
 * 带视频输入的出片（往后延长 extend / 示例视频出片 reference）**输入按多少秒计价** —— 唯一实现（economy.materialRefSecs 读它，
 * 报价 materialRefCost 与延长按钮旁 / 示例视频那一格 / 出片进度三处的「输入 N 秒」都从那儿来；构建里 check-video-tiers.mjs 拿官方最低用量表实跑）。
 *
 * ★ 方舟官方规则（价目页 https://docs.volcengine.com/docs/ark/model-pricing，2026-10-19 读）：「对于 Seedance 2.0 系列、Seedance 2.5 模型，
 *   当输入包含视频时，存在最低 token 用量限制」「如果估算 token 用量 ＜ 最低 token 用量，则按最低 token 用量计算视频价格」。
 *   价目页链到的最低用量表（「火山方舟视频生成模型价格快查表」）：2.5 720p 输出 4 / 5 / 6 / 7 / 8 / 10 / 15 / 23 秒 →
 *   151,200 / 194,400 / 216,000 / 259,200 / 302,400 / 367,200 / 540,000 / 842,400 token；2.0 480p 输出 4 / 7 / 15 → 70,308 / 120,528 / 251,100。
 *   都是 ⌈5 × 输出 / 3⌉ 秒 × 每秒数，即「输入 + 输出」至少按 ⌈5 × 输出 / 3⌉ 秒算 ⇔ 输入至少按 ⌈2 × 输出 / 3⌉ 秒算（输出是整秒，两种写法逐秒相等）。
 * ★ 10-19 付费验证两发都按最低用量收了：cgt-20261020074220-c7l9g（2.5 往后延长，输入 4.06 秒、输出 7 秒）用量 259,200 = 12 × 21,600
 *   （按「输入 + 输出」是 237,600）；cgt-20261020074617-sxmps（2.0 mini 示例视频出片，输入 4 秒、输出 7 秒）用量 260,100 = (5 + 169/24) × 21,600
 *   （按「输入 + 输出」是 238,500）。改之前这两条路在「输出超过输入的 1.5 倍」时都少报少收（电影级 4 → 30 秒每发少收约 ¥14.5）。
 * ★ 片段重拍（edit，r2vTokens 按输入 × 2）不走它：输出 ≈ 输入，而输入 ≤ 30 秒时 ⌈2 × 输入 / 3⌉ ≤ 输入，永远够得上最低用量。
 * ★★ **先后顺序（2026-10-19 定）：App 先发、服务端后上** —— 这是涨价。App 的报价只在本机算、不问服务端（余额门按报价放行，
 *   segmentGen 的「契约核对」比的也是 App 自己的两个数），服务端先上的话没升级的 App 报少扣多（本仓头号事故形状）；
 *   App 先发时过渡期报价 ≥ 实扣（安全方向：用户被扣的不会比看到的多）。所以 App（2.63 之后那一版）先带上它，
 *   服务端那半（server 分支 claude/ark-min-usage：tokens.materialRefTokens 同一个式子）等那一版发出约一周后再合。
 *   ⚠ 那之前 App 在「输出 > 1.5 × 输入」的延长 / 示例视频出片上报价会**高于**服务端实扣 —— 有意的，别当成两仓对不上去「修」。
 * 入参是**已经夹过、取过整**的输入 / 输出秒数（economy.materialRefSecs 先夹：输入 [4,30]、输出这一档的 [minSec, maxSec]）。
 */
export function materialRefInputSec(inputSec: number, outputSec: number): number {
  return Math.max(inputSec, Math.ceil((2 * outputSec) / 3));
}

/**
 * 电影级「样片」**定稿**那一步（2.5 把 480p 的样片升成 1080p 成片）的系数：77/15（主人 10-07 拍板，约 ¥22 / 5 秒两步合计）。
 * 时长 = 样片的时长（服务端按自己登记的那一发算，不收请求体里的数），像素按 1080p 那张表。
 */
export const DRAFT_FINAL_MULT = 77 / 15;

/** 样片任务号在方舟那边的有效期是 7 天；我们只在**还剩一小时以上**时才让人定稿（服务端同一个数） */
export const DRAFT_VALID_MS = 7 * 24 * 3600_000 - 3600_000;

/**
 * 界面上那颗档位芯片是哪一档（「草稿」「高清」「电影级」……）。Seedance 那几行 family 与 id 相同；
 * 出片地区 P2b（2026-10-26）起 draft / hd / ultra 三个 family 各有两家各一行（Seedance、MiniMax H3：id 带 -mm），芯片按它并成一颗、档名也按它取（economy 的 FAMILY_LABEL）。
 */
export type TierFamily = "fast" | "draft" | "std" | "hd" | "ultra" | "real";

/**
 * 出片请求按哪套协议拼。ark = 方舟 contents/generations/tasks（ai/arkClient）；minimax-v1 = 服务端 /api/minimax 代理的
 * V1 视频接口（海螺 2.3 Fast：只收一张首帧，ai/minimaxVideo）；minimax-v2 = 服务端 /api/minimax/v2 的 V2 视频接口
 * （MiniMax H3 三档，2026-10-26 出片地区 P2b：文生 / 首帧 / 首尾帧 / 只给尾帧 / 参考图（≤5），按秒计价、一定出声；契约「MiniMax H3（V2）出片」）。
 * ★ 按它分流**只走 apiCase**（下面）：加一种协议时每个分流点都在 tsc 红（Record 缺键），逼着逐处决定它走哪一支。
 *   ⚠ 等号比较（`tier.api === "minimax-v1"`）做不到这一点 —— 联合类型变大时等号一个错都不报，新的一行会悄悄落进方舟那一支
 *   （补画设定帧、按方舟拼请求）。原来这里写「TypeScript 会指出来」，而当时的五处全是等号（2026-10-26 审核指出）；
 *   scripts/check-tier-semantics.mjs ④ 钉着不许再写等号 / switch。
 */
export type TierApi = "ark" | "minimax-v1" | "minimax-v2";

/**
 * 按请求形状（VideoTier.api）分流的**唯一写法**：每一种 api 都要给一个值。
 * `cases` 的类型是「TierApi 的每一个成员都是必填键」—— TierApi 加一个成员，所有调用点同时编译不过，
 * 每一处都得写清新协议在这里走哪一支（不会像等号比较那样悄悄落进 ark 那一支）。
 * 调用点：real.slotModeOf、segmentGen 的参考清单预览 / 样片闸 / 真人档那一支、flowStore.nodeDraftEligible、flowStore 落取回凭据（记 VideoJob.api）、account 的「这台服务端认不认」（tierServerOff）、
 * 「免费版只能纯文字」（tierTextOnly）与「还没问清，别改写抄来的档」（tierUnsettled）。
 * （2026-10-26 加 "minimax-v2" 时 tsc 在前五处各报一次 TS2345，一处不漏 —— 逐处写了 V2 走哪一支。）
 */
export function apiCase<T>(api: TierApi, cases: { readonly [K in TierApi]: T }): T {
  return cases[api];
}

/**
 * 这一档的请求**只带一张尾帧**（没有首帧）收不收 —— 协议的事实，按请求形状（api）答：MiniMax H3（V2）收（2026-10-26 付费小验：
 * H3-Lite 480P 只给尾帧照常出片，成片跟着尾帧的比例走），方舟那几档的首尾帧任务要先有首帧（只给尾帧时照旧按文生拼、尾帧不发），真人档只收首帧。
 * 读它的两处必须同一个答案：real.slotModeOf（槽位 → 模式）与 segmentGen 声明契约的那一行（声明 ≠ 槽位 = 花钱之前整句拒）。
 */
export function lastFrameOnlyOk(spec: Pick<VideoTierSpec, "api">): boolean {
  return apiCase(spec.api, { ark: false, "minimax-v1": false, "minimax-v2": true });
}

/** Seedance 档位的能力与价目（不含界面文案）：id 持久化在 VideoSegment.videoTier / EditorState.videoTier */
export interface VideoTierSpec {
  id: string;
  model: string;
  /**
   * 这一档是界面上哪一颗芯片（见 TierFamily）。每行必写。
   * ★ 它只回答「这是哪一颗芯片」，**不许拿它判能力**（判能力一律读下面的能力位）：同一个 family 的两行（P2b 起）能力并不相同。
   * ★ 同一家供应商里一个 family 只有一行（构建检查钉着）—— 不然「换到同 family 的另一家」就不知道换到哪一行。
   */
  family: TierFamily;
  /**
   * 这一档走哪个供应商（**只回答「哪家」**）。缺省（不写）= 方舟（Seedance）。
   * 读它的只该是说「哪家」的地方：取回凭据记谁家（flowStore 落凭据、videoJobs、real.takeVideoTask 按它分流）、
   * 「任务可能还在上游 / 方舟那边跑」那句话、剪辑页重拍只认方舟那条路。
   * ★ 2026-10-26 起**协议形状**另读 api、**真人档语义**另读 startOnly / refAudio：原来十几处拿 `provider === "minimax"` 与 flatCost
   *   代替「只认一张起拍画面」「带不了声音样本」，今天碰巧都落在真人档一行上；海外 MiniMax H3（P2b）也是 provider minimax，
   *   却收参考图、按秒计价 —— 那些代用判据会一起判错，而且零报错。构建里 scripts/check-tier-semantics.mjs 钉着不许再这么写。
   * ★ 判否定：缺省即 ark，别到处 `?? "ark"`（第二处默认值）——统一走 economy.providerOf()。
   */
  provider?: "ark" | "minimax";
  /**
   * 出片请求按哪套协议拼（见 TierApi）。每行必写。**只给拼请求形状的那几处读**：real.slotModeOf（→ composeSegments /
   * validateGenSpec 读的 mode）、segmentGen 的真人档那一支（备帧 + 参考清单的预览）、样片能不能走（flowStore.nodeDraftEligible）。
   * 读法一律 apiCase(tier.api, { … })，不写等号（理由见 TierApi）。
   * ★ 与 provider 分工：provider 是「哪家」、api 是「请求长什么样」—— 同一家可以有两套协议（MiniMax V1 的海螺、V2 的 H3）。
   * ★ 与供应商对得上（ark ⇔ 方舟、minimax-* ⇔ MiniMax），构建检查钉着。
   */
  api: TierApi;
  /**
   * **只认一张起拍画面**：没有推演三套、出片前一张设定帧都不画、不收参考图 / 尾帧 / 参考视频 / 声音样本 ——
   * 今天的真人档（海螺 2.3 Fast 图生视频，起拍画面就是真人卡的照片）。每行必写。
   * ★ 2026-10-26 从 flatCost 里拆出来（出片地区 P2a）：「按发计价」说的是**计价模型**，「只认起拍画面」说的是**出片方式**，
   *   今天碰巧重合在真人档一行上。读这层语义的十几处（推演闸 deriveIssue、补画几张 drawPlan、选法屏 modeBlock、特效同款 effectsOn、
   *   段间承接硬不硬 carryIsHard、就近换档 usableTierId、画布的直出车道……）一律读它，flatCost 只在报价与时长吸附里读。
   * ★ 与 api === "minimax-v1" 一一对应（构建检查钉着）：真人档那一支（segmentGen）按 api 走，上面那些按它判 —— 两边说的是同一条产线，漂开就是
   *   「参考清单说一张帧都不画、出片却按方舟那条路补画了两张」。
   */
  startOnly: boolean;
  /**
   * **按发固定计价表**（token/发，按时长档查）。非空 = 这一档不按 token 连续计，segTokens 改查这张表。
   * ★★ 报价=实扣的锚（成本价 1.0x）：官方美元单价 × 全仓锚 **$1 = 447,563 token** 折算取整（2026-09-26 起）。
   *   ⚠ server 的结算价（config/tokens.MINIMAX_FLAT_COST，按**模型**分行）必须与「真人」那一行逐条相等（realPersonProxy.spec.js 钉着）。
   * ★ 只是**价目**：只在 economy.segTokens（报价）与 economy.durationStepsOf（能选哪几个整档时长，clampDuration 吸附也走它）里读。
   *   拿它判「是不是真人档」的写法 2026-10-26 全部改读 startOnly（scripts/check-tier-semantics.mjs 钉着）。
   */
  flatCost?: Record<number, number>;
  /**
   * **按秒计价**（token / 秒，MiniMax H3（V2）那三行必写、别的行不写，构建检查钉着）：一段的价 = 窗口内的整数秒（clampDuration）× 它，
   * 不分画幅、不分文生 / 首帧 / 尾帧 / 首尾帧 / 参考图（官方同模型同分辨率一个单价；一段至多 MINIMAX_V2_MAX_IMAGES 张图，都在免费张数内）。
   * ★★ 报价 = 实扣的锚：= 美元刊例 × 6.71345 ÷ 15 元/百万 token（$1 = 447,563 token，取整到百位，与 flatCost 同一把尺），
   *   与服务端 config/tokens.MINIMAX_SEC_COST 逐条相等（server arkProxy.spec「跨仓 MiniMax H3 价目」抄了这三行；本仓 check-video-tiers 抄了服务端那张表）。
   *   调价两仓同一个提交改；涨价走「App 先上」（文件头那条 ⚠）。
   * ★ 只是**价目**：只在 economy.segTokens 里读（scripts/check-tier-semantics.mjs 钉着）。判「是不是 H3 / 请求怎么拼」读 api（apiCase）。
   */
  secCost?: number;
  /** token 消耗系数（相对标准档；按模型单价折算）。flatCost / secCost 档不看它，随便填 1 */
  mult: number;
  /**
   * 送进请求体的分辨率（2026-10-07 起每行必写）。★ 价钱跟着它走（perSecTokens）：「草稿」与「高清」同一个模型，只差这一格。
   * ★ 只管纯任务：r2v / 延长 / 白模 / 返修那几条路服务端钉死 720p（resolveR2v），协议层 arkClient 照钉。
   * 真人档（MiniMax 768P）这一格不发给任何人，写 720p 只是为了「每行都写」。MiniMax H3 那三行同理（发出去的是 upstreamResolution）：
   * 草稿那一行写 480p（与同 family 的 Seedance 那一行同一格，480p 的档开不了参考视频那条规矩也照样管它），另外两行写 720p。
   */
  resolution: TierResolution;
  /**
   * 发给 MiniMax V2 的分辨率（上游的大写原样：`480P` / `768P`，见 UpstreamResolution）。api "minimax-v2" 的行必写、别的行不写（构建检查钉着）。
   * ★ 服务端的价目表、免费档清单、健康端点的 freeVideo 都按它认（不按上面那一格小写的 resolution）—— 读法一律走 upstreamResOf。
   */
  upstreamResolution?: UpstreamResolution;
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
   * 这一档**协议上**一次最多收几张参考图（只对 refImg/assetRef 为真的档有意义）：2.0 系列 1–9 张、2.5 是 1–30 张、MiniMax H3 5 张（MINIMAX_V2_MAX_IMAGES）。
   * ★ 预算分配（ai/real.allocateRefs）按它砍：少发是白白砍功能，多发是整条请求 400（2.0 收到第 10 张不是忽略是拒收；H3 第 6 张起服务端报不了价、扣费之前拒）。
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
   * ★ MiniMax H3 三行恒为 true：H3 **一定出声**、V2 接口没有开关（2026-10-26 付费小验：5 发成片都带 AAC 音轨）—— V2 请求里不发 generate_audio。
   */
  audio: boolean;
  /**
   * 能不能**带卡上的声音样本**（参考音频）出片。每行必写。Seedance 那几行 = audio && refImg（草稿 / 高清 / 电影级：出声、又走参考类请求）；
   * MiniMax H3 三行出声、收参考图，这一位却是 false（V2 今天不收 audio_url，服务端整句拒）。
   * ★ 单独一位（2026-10-26，出片地区 P2a）：海外 MiniMax H3（P2b）出声、收参考图，却**不收**参考音频 —— 再写 `audio && refImg`
   *   的话那几档会带上声音样本、在花钱之前被契约核对（real.validateGenSpec 的「不收声音样本」那一条）整段拒掉（带声音样本的对话段一律出不了片）。
   *   读它的：economy.refAudioSecOf / shotsOkOf、account.voiceModelsNames（卡片页声音区那几句）、segmentGen 的声音样本判定（voiceRefsFor / refPlanOf）、real.validateGenSpec（最后一道）、
   *   TierRow 的换档损失、几处「要声音样本换哪一档」。`audio && refImg` 的写法 scripts/check-tier-semantics.mjs 不许再出现。
   * ★ refAudio ⇒ audio && refImg（不出声的档带声音样本没有意义；参考音频只能随参考类请求发），构建检查钉着。
   */
  refAudio: boolean;
  /**
   * 这一档收不收**真人照片素材**（声明过 `Card.realPerson` 的卡当参考图）。
   * ★★ 方舟各档全 false 是**实测结论**（2026-08-24）：方舟对真人参考图两套探测器全拦（名人按版权、普通人按隐私），整发拒收。
   *   只有 MiniMax 真人档是 true —— 门禁（account.realFaceIssue）靠它放行，本表之外不许再翻 realPerson。
   * ★ MiniMax H3 三行 false：H3 收不收真人照片**没验过**（2026-10-26 付费小验手上没有授权照片）⇒ 一律按不收报，真人卡照旧只走「真人」档。
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
   * ★★ 与服务端 FREE_VIDEO_ALLOW 逐条相等（下面的 FREE_VIDEO_ALLOW 是它的镜像，构建检查核对两者；按 (模型, 上游分辨率) 认，见 upstreamResOf）。
   * ★ 2026-10-26 加 MiniMax H3-Lite · 480P（「草稿」在 MiniMax 上的对标）：出片按地区下发之后海外只有 MiniMax，海外的免费用户（含 Play 的审核账号）要能出片。
   *   ⚠ 免费版在 H3 上**只能纯文字出片**（服务端 MINIMAX_V2_FREE_TEXT_ONLY，健康端点的 minimaxV2FreeTextOnly）：这一位只回答「这一档开不开」，
   *   带不带图另判 —— 唯一判据 account.tierTextOnly。
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
 * ★ 顺序 = 界面上那一排的顺序（Seedance 那几档按价钱从低到高；MiniMax H3 三行各排在同 family 的 Seedance 那一行后面）。
 *   **判据一律认 id**，不认下标：economy.tierOf 的兜底是显式 id（firstLiveTierId），在前面插一档不会悄悄改掉「认不出的 id 落到哪一档」。
 *   ⚠ 同 family 里 Seedance 排在前面是有意的：被挡住的档换到哪一档（videoZoneRules.stepAsideOf，先同一颗芯片、再能力最接近）都按表的顺序取第一个 ——
 *   境内（两家都给）抄来的档先落回 Seedance（主人 10-26：境内默认仍是 Seedance）。
 * ✅ 2026-08-16 拿 8 月账单明细逐行核过 mult。写成 `4.2 / 15`、`23 / 15` 这种**分数形态**是有意的：分子就是账单上那个「元/千token × 1000」的数。
 */
export const VIDEO_TIER_SPECS: readonly VideoTierSpec[] = [
  // fast 是 1.0-pro fast：`generate_audio` 收下就扔（实测），所以 audio 显式 false。免费档之一（主人 10-07），11-24 下线
  { id: "fast", family: "fast", api: "ark", startOnly: false, model: SEEDANCE_1_0_PRO_FAST, mult: 4.2 / 15, resolution: "720p", flf: false, refImg: false, refVid: false, r2vMult: null, extendOk: false, blockoutOk: false, draftOk: false, audio: false, refAudio: false, realFace: false, assetRef: false, freeOk: true, retireAt: RETIRE_1_0_AT, minSec: 3, maxSec: 10 },
  // ★ 草稿（2026-10-07 新加）：与高清**同一个模型**（2.0 mini），只是 480p —— 每秒 10,044 raw token（864×496 / 496×864），
  //   约高清的 47%。能力与高清一样（参考图 9 张、出声、收可信素材），只是不带参考视频（服务端把参考视频那几条路钉在 720p）。
  //   免费档之一，也是 11-24 之后免费用户唯一的档（极速下线）。
  { id: "draft", family: "draft", api: "ark", startOnly: false, model: SEEDANCE_2_0_MINI, mult: 23 / 15, resolution: "480p", flf: true, refImg: true, refImagesMax: 9, refVid: false, r2vMult: null, extendOk: false, blockoutOk: false, draftOk: false, audio: true, refAudio: true, realFace: false, assetRef: true, freeOk: true, minSec: 4, maxSec: 15 },
  // ── MiniMax H3 三行（出片地区 P2b，2026-10-26）：「草稿 / 高清 / 电影级」在 MiniMax 上的对标（海外只给 MiniMax；境内的人也能选）。
  //   走服务端 /api/minimax/v2（国际站 V2，api "minimax-v2"），按秒计价（secCost = 服务端 MINIMAX_SEC_COST），与同 family 的 Seedance 那一行是同一颗芯片。
  //   能力位照 2026-10-26 付费小验（6 发，$1.00）：首帧 / 首尾帧 / **只给尾帧**都收（flf）；参考图最多 5 张（H3-Highspeed 三张参考图实测收）；
  //   成片一定带声音（audio，API 没有开关）却不收声音样本（refAudio，V2 不收 audio_url）；不收参考视频（refVid / r2vMult）、
  //   没有白模、延长、样片两步；真人照片没验过 ⇒ 按不收报（realFace）；方舟的可信素材 asset:// 是 Seedance 的协议（assetRef）。
  //   时长 4~15 的整数（官方 V2 的枚举，与服务端 VIDEO_SEC_WINDOW 的 H3 三格相等；clampDuration 本来就取窗口内的整数）。
  //   ★ 摆不摆：服务端健康端点的 minimaxV2 为真 **且** 地区问到了、providers 里有 minimax（account.tierServerOff → videoZone.minimaxV2Offered；
  //     老服务端没有这一位 = 三行一行都不摆）。免费版能用 H3-Lite，但只能纯文字出片（account.tierTextOnly）。
  { id: "draft-mm", family: "draft", provider: "minimax", api: "minimax-v2", startOnly: false, model: MINIMAX_H3_LITE, secCost: 11_200, mult: 1, resolution: "480p", upstreamResolution: "480P", flf: true, refImg: true, refImagesMax: MINIMAX_V2_MAX_IMAGES, refVid: false, r2vMult: null, extendOk: false, blockoutOk: false, draftOk: false, audio: true, refAudio: false, realFace: false, assetRef: false, freeOk: true, minSec: 4, maxSec: 15 },
  { id: "std", family: "std", api: "ark", startOnly: false, model: SEEDANCE_1_0_PRO, mult: 1, resolution: "720p", flf: true, refImg: false, refVid: false, r2vMult: null, extendOk: false, blockoutOk: false, draftOk: false, audio: false, refAudio: false, realFace: false, assetRef: false, freeOk: false, retireAt: RETIRE_1_0_AT, minSec: 3, maxSec: 10 },
  // ★ hd 的视频参考 2026-10-05 开（主人「合」）：refVid true、r2vMult = HD_R2V_MULT。延长不开（extendOk，接缝会跳）；白模模板不开（blockoutOk）。
  // ★ minSec 4（2.0 mini 不收 3 秒）、maxSec 15（2.0 系列的协议上限）
  { id: "hd", family: "hd", api: "ark", startOnly: false, model: SEEDANCE_2_0_MINI, mult: 23 / 15, resolution: "720p", flf: true, refImg: true, refImagesMax: 9, refVid: true, r2vMult: HD_R2V_MULT, extendOk: false, blockoutOk: false, draftOk: false, audio: true, refAudio: true, realFace: false, assetRef: true, freeOk: false, minSec: 4, maxSec: 15 },
  // MiniMax H3 Highspeed · 768P（「高清」的对标，会员档）。能力位同 draft-mm 那一行的注释
  { id: "hd-mm", family: "hd", provider: "minimax", api: "minimax-v2", startOnly: false, model: MINIMAX_H3_HIGHSPEED, secCost: 26_900, mult: 1, resolution: "720p", upstreamResolution: "768P", flf: true, refImg: true, refImagesMax: MINIMAX_V2_MAX_IMAGES, refVid: false, r2vMult: null, extendOk: false, blockoutOk: false, draftOk: false, audio: true, refAudio: false, realFace: false, assetRef: false, freeOk: false, minSec: 4, maxSec: 15 },
  {
    id: "ultra",
    family: "ultra",
    api: "ark",
    startOnly: false,
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
    // 声音样本：2.5 单段 2~30 秒、合计 ≤ 30 秒（economy.refAudioSecOf）
    refAudio: true,
    realFace: false,
    assetRef: true,
    freeOk: false,
    minSec: 4,
    maxSec: 30,
  },
  // MiniMax H3 · 768P（「电影级」的对标，会员档；2K 先不开）。能力位同 draft-mm 那一行的注释 —— 电影级 Seedance 那几样（延长、样片、白模模板）它都没有
  { id: "ultra-mm", family: "ultra", provider: "minimax", api: "minimax-v2", startOnly: false, model: MINIMAX_H3, secCost: 35_800, mult: 1, resolution: "720p", upstreamResolution: "768P", flf: true, refImg: true, refImagesMax: MINIMAX_V2_MAX_IMAGES, refVid: false, r2vMult: null, extendOk: false, blockoutOk: false, draftOk: false, audio: true, refAudio: false, realFace: false, assetRef: false, freeOk: false, minSec: 4, maxSec: 15 },
  {
    id: "real",
    family: "real",
    // 供应商换成 MiniMax（海螺，768P）：方舟对真人参考图两套探测器全拦，海螺同一批图输入输出两端都放行且成片落地。
    // ⚠ 合规口径 2026-09-26 变了：服务端走**国际站** `api.minimax.io`，真人照片**是出境的**。
    // ★ 2026-09-26 换成 2.3-Fast：官方同能力、便宜 37%；它只支持图生视频，而真人档首帧恒为真人照片，不构成问题。
    model: MINIMAX_REAL,
    provider: "minimax",
    // V1 视频接口（服务端 /api/minimax 代理）：只收一张首帧
    api: "minimax-v1",
    // ★ 全表唯一的 true：只认一张起拍画面（真人卡的照片），没有推演、不画设定帧、不收参考图
    startOnly: true,
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
    refAudio: false,
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
 * 免费用户能出片的（模型, **上游**分辨率）—— **服务端 config/tokens.FREE_VIDEO_ALLOW 的镜像**（label 是给服务端那句拒绝话用的冻结中文档名）。
 * ★ 档位表里 freeOk 的那几行必须与它一一对应（构建检查核对）：两仓各写一份、差一行就是「界面能点、服务端 403」。只管纯任务（不含 r2v / 样片）。
 * ★ 分辨率按发给上游的原样写（upstreamResOf）：Seedance 小写 480p，MiniMax 大写 480P —— 与服务端、健康端点的 freeVideo 逐字相等，不归一大小写。
 * ★ 服务端那份每条还带 kind（task / minimax_v2）：这边按模型就分得出是哪条链路（两家的模型 id 不重），不另抄。
 */
/* i18n-frozen: 跨仓契约的冻结中文档名（服务端那句拒绝话里用），不是界面文案 */
export const FREE_VIDEO_ALLOW: ReadonlyArray<{ model: string; resolution: TierResolution | UpstreamResolution; label: string }> = [
  { model: SEEDANCE_1_0_PRO_FAST, resolution: "720p", label: "极速" },
  { model: SEEDANCE_2_0_MINI, resolution: "480p", label: "草稿" },
  { model: MINIMAX_H3_LITE, resolution: "480P", label: "草稿" },
];

/**
 * 这一档发给上游的分辨率写法 —— 免费档清单、健康端点的 freeVideo、服务端价目表都按它认（**唯一读法**，别直接读 resolution 去比）。
 * 方舟那几行就是 resolution（小写 480p / 720p）；MiniMax H3（V2）那三行是 upstreamResolution（大写 480P / 768P）。
 * ⚠ 真人档（V1）这一格没意义（它不在免费档里、价目按发查），读到的是那一行为了「每行都写」的 720p。
 */
export function upstreamResOf(spec: Pick<VideoTierSpec, "resolution" | "upstreamResolution">): TierResolution | UpstreamResolution {
  return spec.upstreamResolution ?? spec.resolution;
}

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
