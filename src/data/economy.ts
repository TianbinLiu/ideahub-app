// Token 经济：套餐目录 / 充值包 / Seedance 档位 / 成本估算 / 平台抽成。
// token 与方舟视频 token 同量纲（720p 24fps：时长×1280×720×24/1024/秒），
// 档位系数按各模型单价相对标准档（1.0-pro 15元/M）折算——用户看到的数字
// 就是真实资源消耗，不做虚拟汇率。
//
// ── r2v（白模模板出片）的计费契约 ──────────────────────────────
// 方舟公式（✅ 2026-08 A3 实测：同素材各打一发 t2v 与 r2v，两行账单逐 token 对上，分毫不差）：
//   raw tokens = (输入视频时长 + 输出时长) × 输出宽 × 输出高 × fps ÷ 1024
// **输入视频的时长也计费**。输出恒为 720p 档（16:9 实测给 1280×720 = 921,600px，
// adaptive 实测给 1266×728 = 921,648px，都是 92 万像素级）、fps=24
// ⇒ 每秒 21,600 raw tokens（SEC_720P_TOKENS —— 与 segTokens 同一个常量，铁律六）。
// 报价按【输出时长 = 输入时长】取上界：edit 任务输出≈输入是协议行为，实测方舟还会
// 略微裁短输出（14.04s 输入 → 13.67s 计费），报价≥实收方向安全，误差 ~1%。
// Seedance 2.5 含视频输入档 42 元/M ⇒ 系数 42/15 = 2.8（ULTRA_R2V_MULT）。
// ⚠ 「42 < 70 所以 r2v 便宜」的直觉是**反的**：输入也计费 + 输出=输入，同时长下
//   r2v ≈ 纯任务的 2×2.8/4.7 ≈ 1.2 倍 —— 报价行必须写明含输入费。
// ★ 跨仓契约：server 的 config/tokens.js **VIDEO_MULT_R2V** 必须与本表 r2vMult 逐条
//   相等（同 VIDEO_MULT ↔ mult 的对账关系，server 侧 spec 有钉子）。
import { i18n } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import type { GenMode } from "../types";
import {
  CARD_SIZE,
  CARD_SLOTS,
  CARD_TYPES,
  DURATIONS,
  LONG_DURATIONS,
  MAX_CARD_VIEWS,
  VIDEO_PROMPT_MAX,
  VIDEO_PROMPT_MAX_V2,
  VideoSegment,
  type CardSlot,
  type CardType,
} from "../types";
import { drawCount } from "./drawPlan";
import {
  DRAFT_FINAL_MULT,
  PAID_DEFAULT_CHAIN,
  SEC_720P_TOKENS,
  SEEDANCE_2_5,
  ULTRA_MULT,
  ULTRA_R2V_MULT,
  VIDEO_TIER_SPECS,
  firstLiveTierId,
  perSecTokens,
  tierRetiredAt,
  type VideoTierSpec,
} from "./videoTierTable";

/** 样片任务号还能定稿多久（7 天差 1 小时，与服务端同一个数）—— 唯一出处在 videoTierTable，这里只是转出（界面与 store 从 economy 引） */
export { DRAFT_VALID_MS } from "./videoTierTable";

/** 观看付费的平台抽成比例（其余进创作者 add-on 余额） */
export const PLATFORM_CUT = 0.3;

/**
 * 付费作品的最低解锁价（token）。**唯一一处**：输入框的 `min` 与发布前的校验都用它。
 *
 * ★★ 为什么必须有真校验、而不是只在 input 上写个 `min`：`min`/`step` 在 HTML 里只是
 *   浏览器的提示，**不参与任何拦截**。发布那一句写的是 `paid && price > 0`，于是
 *   「选了付费 → 把价格框清空」= chip 上「付费解锁」还高亮着、pricing 一个字都没写进去
 *   ⇒ **静默发成免费**。而编辑页没有定价控件（服务端还会 strip），回炉重做也整句拒付费作品，
 *   一次手滑就是永久免费 —— 丢的是用户的收入（2026-08-30 修）。
 * ★ 100 这个数：低于它平台抽成后作者到手不足 70 token，不够炼任何东西，
 *   与其让人定一个没意义的价，不如让他确认一次。
 */
export const MIN_PAID_PRICE = 100;

/**
 * 订阅套餐（套餐 token 按月发放，优先扣减）。
 * ★ 2026-10-07 主人拍板：标准 ¥30 → 1,660,000、专业 ¥98 → 5,800,000（约 10 段 / 35 段 5 秒「高清」）；免费版不再每月发 30 万，
 *   改成**新人一次 170,000 + 每天 2,000（最多攒 7 天 = 14,000）**，而且免费用户只能用「极速」「草稿」两档出片（VideoTierSpec.freeOk）。
 * ★★ 价钱 / 额度与服务端 config/tokens.js 的 PLANS 逐条相等（server tests/payOrder.spec.js 钉着）。免费额度怎么发由服务端说了算
 *   （GET /api/me/wallet 的 `free` 那一格是它的权威值，account.freeQuota 优先读它）；这里的数是离线账本与「我的」页的兜底。
 */
export interface TokenPlan {
  id: string;
  name: string;
  /** 元/月；0=免费 */
  price: number;
  /** 每月发进套餐额度的数。免费版是 0 —— 它的额度是下面三格 */
  monthlyTokens: number;
  /** 新人一次发多少（进 add-on，永不过期；只发给新开的钱包）。只有免费版有 */
  welcomeTokens?: number;
  /** 每过一个 UTC 自然日往套餐额度里补多少。只有免费版有 */
  dailyTokens?: number;
  /** 每天补到这个数为止（= dailyTokens × 7：最多攒 7 天）；本来就比它多的不会被扣回来 */
  dailyCapTokens?: number;
  desc: string;
}

/** 「约可生成 N 段 5 秒高清」里那个 N：按「高清」档 5 秒的报价现算（同 segTokens），套餐额度改了这句话跟着变 */
function hdClipsOf(tokens: number): number {
  return Math.floor(tokens / segTokens(5, "hd"));
}

// ★ name / desc 是界面文案，用 getter 读到时现翻（同 types.ts 的 VIDEO_ASPECTS）：开机是先激活语言、再 import App，
//   模块顶层翻出来的字会冻结在开机那一刻的语言上。id / 价钱 / 额度一格不动（id 存进钱包，价钱与服务端 config/tokens.js 对账）。
//   ⚠ 别展开（{...plan}）或 JSON 化了再拿去显示：getter 会在那一刻被取成死值。
export const PLANS: TokenPlan[] = [
  {
    id: "free",
    get name() {
      return i18n._(msg`免费版`);
    },
    price: 0,
    monthlyTokens: 0,
    welcomeTokens: 170_000,
    dailyTokens: 2_000,
    dailyCapTokens: 14_000,
    get desc() {
      const welcome = fmtTokens(this.welcomeTokens ?? 0);
      const daily = fmtTokens(this.dailyTokens ?? 0);
      const days = Math.round((this.dailyCapTokens ?? 0) / Math.max(1, this.dailyTokens ?? 1));
      const names = joinTierNames(VIDEO_TIERS.filter((x) => x.freeOk && !tierRetired(x)).map((x) => x.label));
      return i18n._(msg`新人一次 ${welcome} + 每天 ${daily}（最多攒 ${days} 天）· 能用「${names}」档出片`);
    },
  },
  {
    id: "std",
    get name() {
      return i18n._(msg`标准套餐`);
    },
    price: 30,
    monthlyTokens: 1_660_000,
    get desc() {
      const n = hdClipsOf(this.monthlyTokens);
      const hd = tierOf("hd").label;
      return i18n._(msg`约可生成 ${n} 段 5 秒「${hd}」档视频 · 全部档位都能用`);
    },
  },
  {
    id: "pro",
    get name() {
      return i18n._(msg`专业套餐`);
    },
    price: 98,
    monthlyTokens: 5_800_000,
    get desc() {
      const n = hdClipsOf(this.monthlyTokens);
      const hd = tierOf("hd").label;
      return i18n._(msg`重度创作，约 ${n} 段 5 秒「${hd}」档 · 全部档位都能用`);
    },
  },
];

/** 按 id 查套餐。★ 认不出的 id 当**免费版**（与服务端 planOf 的兜底同一口径：那边 PLANS[0] 就是免费版）——
 *  反过来当付费的话，界面放行、服务端 403，而那时推演 / 画帧的钱已经花了 */
export function planOf(id: string | undefined): TokenPlan {
  return PLANS.find((p) => p.id === id) ?? PLANS.find((p) => p.id === "free")!;
}

/** 直充包：到账进 add-on（永不过期，套餐扣完才动它） */
export const RECHARGE_PACKS = [
  { tokens: 200_000, price: 6 },
  { tokens: 1_000_000, price: 25 },
  { tokens: 5_000_000, price: 98 },
];

// ── 出片档位 ───────────────────────────────────────────────────────────
// ★★ 能力 / 价目 / 分辨率 / 谁能用，全在 ./videoTierTable（零依赖，构建里 check-video-tiers.mjs 直接 import 它核对不变量）；
//   这里只把界面文案（档位名、一句话说明）按 id 接上去。2026-10-07 拆开（免费档限制 + 「草稿」档那一次），理由见那个文件的文件头。
//   系数（ULTRA_MULT 4.7 / ULTRA_R2V_MULT 2.8 / HD_R2V_MULT 14/15）的出处与账单核对记录也搬过去了，两仓对账就对那一张表。

/** Seedance 档位：id 持久化在 VideoSegment.videoTier / EditorState.videoTier */
export interface VideoTier extends VideoTierSpec {
  /** 界面名。★ VIDEO_TIERS 里是 getter，读到时按界面语言现翻 —— 判据一律认 id，别拿它比较（desc 同理） */
  label: string;
  desc: string;
}

/** 这一档的停用日按界面语言写成「11月24日」/「November 24」（北京时间那一天）；不下线的档回空串 */
export function tierRetireDay(tier: Pick<VideoTierSpec, "retireAt">): string {
  if (!tier.retireAt) return "";
  return new Intl.DateTimeFormat(i18n.locale || "zh", { month: "long", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(tier.retireAt));
}

/** 电影级一秒的钱是高清的几倍（desc 那句话现算，系数改了跟着变） */
function ultraVsHd(): string {
  const hd = tierOf("hd");
  const ultra = tierOf("ultra");
  return (perSecTokensOf(ultra) * ultra.mult / (perSecTokensOf(hd) * hd.mult)).toFixed(1);
}

// ★ label / desc 是界面文案，读到时现翻（同 PLANS 那条 ★）；按 id 接到 videoTierTable 的那一行上。
//   英文档名与画布指挥认的档位词对齐（studio/agentGrammar：fast / standard / hd / cinematic + tier）。
//   ⚠「草稿」带 context：同一个字在草稿箱（Drafts）与模板状态（Draft）里各有一条，这里是一档的名字（英文叫 Lite，别与电影级的「样片」撞名）。
//   ⚠ 别把「草稿」加进 agentGrammar 的档位词：「存草稿」会被认成改档位。
const TIER_TEXT: Record<string, { label: () => string; desc: () => string }> = {
  fast: {
    label: () => i18n._(msg`极速`),
    desc: () => {
      const day = tierRetireDay(tierOf("fast"));
      return i18n._(msg`省 token · 首帧起拍，不锁尾帧 · 免费可用 · 模型 ${day}起停用`);
    },
  },
  draft: {
    label: () => i18n._(msg({ message: "草稿", context: "画质档位名：Seedance 2.0 mini 480p 的省钱档（不是草稿箱的草稿，也不是电影级的样片）" })),
    desc: () => {
      const hd = tierOf("hd").label;
      return i18n._(msg`480p 省钱档 · 与「${hd}」同一个模型、画面小一号；可直接用素材卡的形象参考图出片 · 出片带 AI 生成的环境音 · 免费可用`);
    },
  },
  std: {
    label: () => i18n._(msg`标准`),
    desc: () => {
      const day = tierRetireDay(tierOf("std"));
      return i18n._(msg`首尾帧可控 · 会员档 · 模型 ${day}起停用`);
    },
  },
  // ★ desc 是给**用户**看的，不是给运维看的（原来写过「需在方舟控制台开通 2.0 系列」—— 那是部署方的事）
  hd: {
    label: () => i18n._(msg`高清`),
    desc: () => i18n._(msg`新一代模型 · 画面更稳、细节更多；可直接用素材卡的形象参考图出片 · 出片带 AI 生成的环境音 · 会员档`),
  },
  ultra: {
    label: () => i18n._(msg`电影级`),
    desc: () => {
      const x = ultraVsHd();
      const hd = tierOf("hd").label;
      return i18n._(msg`最新一代 · 画面与运镜最好，出片带 AI 生成的环境音，每秒消耗约「${hd}」档的 ${x} 倍（会员档）`);
    },
  },
  real: {
    // ★ 带 context：「真人」在别处是真人卡 / 真人照片里的形容词，这里是一档的名字，英文不是同一个词
    label: () => i18n._(msg({ message: "真人", context: "画质档位名：唯一收真人照片的那一档（不是「真人卡」「真人照片」里的形容词）" })),
    desc: () => i18n._(msg`唯一收真人照片的档 · 供应商按发计价（6 秒或 10 秒整档）· 用真人卡出片选它 · 会员档`),
  },
};

/** 档位表（能力 + 界面文案）。★ label / desc 是 getter：别展开（{...tier}）或 JSON 化了再拿去显示 */
export const VIDEO_TIERS: VideoTier[] = VIDEO_TIER_SPECS.map((spec) => {
  const text = TIER_TEXT[spec.id];
  return Object.defineProperties(
    { ...spec },
    {
      label: { get: () => (text ? text.label() : spec.id), enumerable: true },
      desc: { get: () => (text ? text.desc() : ""), enumerable: true },
    },
  ) as VideoTier;
});

/**
 * 认不出的档位 id 落到哪一档（**显式 id，不按下标** —— 原来是 `VIDEO_TIERS[1]`，2026-10-07 在前面插了「草稿」，下标兜底会悄悄变成草稿）。
 * 「标准」，它下线之后「高清」（videoTierTable.PAID_DEFAULT_CHAIN）。★ 这是**目录**层的兜底（老数据 / 别的版本写进来的 id），
 * 不看套餐；新段的默认档问 account.defaultTierId（按套餐，免费用户落在免费档上）。
 */
export function fallbackTierId(now: number = Date.now()): string {
  return firstLiveTierId(PAID_DEFAULT_CHAIN, now);
}

/** 这一档到现在停用了没有（videoTierTable.tierRetiredAt 的现在时）。界面藏不藏、默认档往哪退、出片拦不拦都问它 */
export function tierRetired(tier: Pick<VideoTierSpec, "retireAt">, now: number = Date.now()): boolean {
  return tierRetiredAt(tier, now);
}

/** 这一档一秒视频的 raw token（按它自己的模型与分辨率；ratio 缺省 = 那一行最大的一格）。唯一实现在 videoTierTable.perSecTokens */
export function perSecTokensOf(tier: Pick<VideoTierSpec, "model" | "resolution">, ratio?: string): number {
  return perSecTokens(tier.model, tier.resolution, ratio);
}

/** 这一档走哪个供应商 —— 判否定的唯一出口（缺省 = 方舟）。别在别处 `?? "ark"` */
export function providerOf(tierId: string | undefined): "ark" | "minimax" {
  return tierOf(tierId).provider ?? "ark";
}

/**
 * 这一档能不能走「推演三套方案」—— 唯一实现（flowStore.deriveProposals、
 * 工坊 studioStore.generateNode、工坊档位按钮三处共用，别各写一遍）。
 * 按发计价档（flatCost，真人档）没有方案台：它不画设定帧（首帧就是卡片照片），
 * 推演产出的三套首尾帧一张都用不上 —— 收了推演的钱再全扔掉，就是白扣一笔。
 */
export function deriveIssue(tierId: string | undefined): string | null {
  const tier = tierOf(tierId);
  if (!tier.flatCost) return null;
  const label = tier.label;
  // ★ 整句、自带句号（2026-09-11 多语言）：调用方不许再往后补「。」接下一句 ——
  //   工坊 NPC 那句（studioStore.generateNode）是「这一整句 + 另一整句」，英文得自己断句
  return t`「${label}」档按发直出（起拍画面就是真人卡的照片），没有推演三套方案这一步——写好一句话直接生成，或换回其它档再推演。`;
}

export function tierOf(id: string | undefined): VideoTier {
  // ★ 兜底认**显式 id**（fallbackTierId），不按下标：在表前面插一档（2026-10-07 的「草稿」）不会悄悄改掉认不出的 id 落在哪
  return VIDEO_TIERS.find((t) => t.id === id) ?? VIDEO_TIERS.find((t) => t.id === fallbackTierId())!;
}

/**
 * 「这个模型出片带不带 AI 生成的环境音」—— 按**真正发出去的 model id** 查，给协议层
 * （ai/arkClient.generateVideo 决定传不传 `generate_audio`）用。
 *
 * ★ **唯一实现**（铁律六）：音频支持与否只有 `VideoTier.audio` 一格，arkClient 那侧
 *   **不许再列一张模型正则表**。它已经有 supportsRefImage / supportsRefVideo 两张白名单，
 *   再加一张就是"改了档位表却忘了改正则"——而音频漏改**没有任何症状**：画面照出、
 *   钱照收，只是片子是哑的，用户只会以为自己手机静音了。
 * ★ 按 model 而不是 tierId 查，是因为协议层手上只有 model（generateVideo 的入参就是
 *   model，档位在更上游）。⚠ 2026-10-07 起**一个模型不止一档**（「草稿」与「高清」都是 2.0 mini）：
 *   按模型查还成立，是因为同一个模型的几行在 audio / minSec / maxSec 上必须一致 —— 构建里 check-video-tiers.mjs 钉着。
 *   哪天要让同一个模型的两档在这几格上不同（比如免费档时长更短），就得把档位 id 传进协议层，别在这里挑第一行。
 * ★ 认不出的 model 一律 false（= 不传这个字段）：那是"不在档位表里的 id"——老包报上来的
 *   旧型号、临时试的新型号。往"不传"这一侧退是安全的：实测有声无声同价，两个方向都不会
 *   多收钱；而猜它支持再传过去，只是给一个不认识的模型发一个它不认识的参数。
 * ★ 写 `=== true` 而不是 `?? false`：后者读起来像"这里有一个默认值"，会引下一个人去别处
 *   再写一个 `?? false`（那就是第二处默认值，refImg 的注释里已经踩过这条）。
 */
export function videoAudioOn(model: string): boolean {
  return VIDEO_TIERS.find((t) => t.model === model)?.audio === true;
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
 * 真正会发给方舟的时长（秒）。上下限都跟着档位走（VideoTier.minSec / maxSec —— 2.5 不收 3 秒；
 * 高清最长 15、电影级最长 30、1.0 两档仍是 10）。
 * ★ 报价与出片必须用同一个函数：只在出片那侧夹一下的话，用户看到的是 3 秒的价、
 *   拿到的是 4 秒的片，差 33% 且无从察觉。
 */
/**
 * 这一档的出片提示词上限（字符）—— **唯一判定**（输入框的 maxLength、点图 / 运镜芯片的长度闸、segmentGen 给正文留位、
 * ai/real 最后那一刀都问它）。收参考图的两档（2.x：高清 / 电影级）= 官方建议值 500，其余 = 400（理由见 types.VIDEO_PROMPT_MAX_V2）。
 * ★ 按**能力**判（refImg）不按档位 id 判：新加一档 2.x 模型时不用回来改这里。
 */
export function promptMaxOf(tierId: string | undefined): number {
  return tierOf(tierId).refImg ? VIDEO_PROMPT_MAX_V2 : VIDEO_PROMPT_MAX;
}

/**
 * 这一档一次最多带多长的**参考音频**（所有声音样本加起来，秒）。null = 这一档不出声 / 不收参考音频。
 * ★ 出处（2026-10-03 查，官方「创建视频生成任务」文档音频一节）：Seedance 2.0 系列单段 2~15 秒、最多 3 段、**合计不超过 15 秒**；
 *   Seedance 2.5 单段 2~30 秒、最多 10 段、合计不超过 30 秒。此前只按「最多 3 张带声音的卡」数，没看合计 ——
 *   三张卡各录 8 秒就是 24 秒，高清档整发 400（不花钱，但出不了片，而那句英文报错里看不出是声音样本的事）。
 * ★ 2.5 的张数上限我们仍按 3 张用（音色点名句只实测到 3 个人），这里只管合计秒数。
 */
export function refAudioSecOf(tierId: string | undefined): number | null {
  const t = tierOf(tierId);
  if (!t.audio || !t.refImg) return null;
  return (t.refImagesMax ?? 0) > 9 ? 30 : 15;
}

export function clampDuration(durationSec: number, tierId?: string): number {
  const t = tierOf(tierId);
  // 按发计价的档只有价表里那几个整档时长（海螺 768P 就是 6s/10s，不是我们砍的）：
  // 报价与下单都得吸附到档上，否则"按 8 秒报价、按 10 秒扣费"这种缝隙就开了——
  // 吸附方向取**不小于所选时长的最小档**（用户要 8 秒就给 10 秒档并按 10 秒收，
  // 往少给的方向吸是暗降级）。超过最大档就顶格。
  if (t.flatCost) {
    const steps = Object.keys(t.flatCost).map(Number).sort((a, b) => a - b);
    return steps.find((s) => s >= durationSec) ?? steps[steps.length - 1];
  }
  return Math.max(t.minSec, Math.min(t.maxSec, Math.round(durationSec)));
}

/**
 * 时长按钮上摆哪几个（秒）—— **唯一出处**：本段设置（SegSettings）、方案台（PlanBoard，经宿主传进去）、画布自定义车道三处都读它。
 * 所有档位都摆 types.DURATIONS 那几档，再接上这一档 maxSec 够得着的长段（types.LONG_DURATIONS：高清到 15、电影级到 30）。
 * ★ 低于本档下限的照旧摆出来、由调用方灰掉并说明（minSec 那条 ★：藏起来用户不知道为什么没有 3 秒）。
 */
export function durationChoices(tierId: string | undefined): number[] {
  const max = tierOf(tierId).maxSec;
  return [...DURATIONS, ...LONG_DURATIONS].filter((d) => d <= max);
}

/**
 * 按**真正发出去的 model id** 查这个模型一段视频的时长窗口 [最短, 最长]（秒）—— 给协议层（ai/arkClient 只拿得到 model）用。
 * ★ 与 videoAudioOn 同一个理由按 model 查：档位在更上游，协议层手上只有 model。同一个模型的几行窗口必须一致（「草稿」与「高清」都是 [4,15]），
 *   构建里 check-video-tiers.mjs 钉着 —— 理由见 videoAudioOn 的 ⚠。
 * ★ 认不出的 model 按改版前的 [3,10]（与服务端 videoSecWindow 的兜底同一口径），往窄的一侧退是安全的。
 */
export function durationWindowOfModel(model: string): [number, number] {
  const t = VIDEO_TIERS.find((x) => x.model === model);
  return t ? [t.minSec, t.maxSec] : [3, 10];
}

// 720p 一秒的 raw token（21,600）与 480p / 1080p 的像素表都在 ./videoTierTable（SEC_720P_TOKENS / perSecTokens），全仓只有那一处。
//   r2v 的 adaptive 输出实测也是 92 万像素级（1266×728 vs 1280×720，差 0.005%），同一个每秒数照样成立 —— 别为 adaptive 另抄一份。

/** 一段视频的 token 报价。方舟档按公式连续计（时长 × 每秒 raw token × 系数，每秒数按这一档的分辨率与画幅查，见 perSecTokensOf）；
 *  按发计价档（flatCost 非空，如 MiniMax 真人档）查价表——clampDuration 已把时长
 *  吸附到价表档位上，这里直接取数。**报价与实扣共用本函数**（铁律六），
 *  server 结算侧的对应表必须逐条相等（服务端 segTokens(秒, 模型, 分辨率, 画幅)，同一个乘法顺序：秒 × 每秒 × 系数）。
 *  ★ ratio = 送进请求体的那个画幅（"9:16" / "16:9"）：480p 的每秒数按画幅不同；缺省按那一行最大的一格报（宁可多报）。
 *    720p 不看画幅（一律 21,600）。 */
export function segTokens(durationSec: number, tierId?: string, ratio?: string): number {
  const t = tierOf(tierId);
  const sec = clampDuration(durationSec, tierId);
  if (t.flatCost) return t.flatCost[sec] ?? Math.max(...Object.values(t.flatCost));
  return Math.round(sec * perSecTokensOf(t, ratio) * t.mult);
}

/**
 * 电影级「样片」两步的报价（2026-10-07 主人拍板；出片那一半在 A2）。**两步各是一单**，服务端各扣各的：
 *   ① 样片：2.5 出 480p（draft:true），像素按 2.5 的 480p 表 × 电影级系数 4.7；时长按 2.5 的窗口夹（同 clampDuration）；
 *   ② 定稿：把同一份样片升成 1080p，像素按 2.5 的 1080p 表 × 77/15；**时长 = 样片的时长**（服务端按它登记的那一发算，不收请求体里的数）。
 * ★ 与服务端 config/tokens.js（segTokens(…, "480p", ratio) × 4.7 / draftFinalTokens）同一个式子同一个乘法顺序（arkProxy.spec 钉着）。
 * ★ ratio 缺省 / adaptive = 那一行最大的一格（宁可多报）。
 */
export function draftStepTokens(durationSec: number, ratio?: string): number {
  const sec = clampDuration(durationSec, draftTierId());
  return Math.round(sec * perSecTokens(SEEDANCE_2_5, "480p", ratio) * ULTRA_MULT);
}

export function draftFinalTokens(durationSec: number, ratio?: string): number {
  const sec = clampDuration(durationSec, draftTierId());
  return Math.round(sec * perSecTokens(SEEDANCE_2_5, "1080p", ratio) * DRAFT_FINAL_MULT);
}

/**
 * 走得了「样片」的那一档（draftOk；今天是电影级）。一档都没有时回电影级的 id（报价照电影级的窗口夹，开不开由 draftOk 判）。
 * ★ 导出给「定稿」那一步用：样片是在这一档上出的，之后这一段换了档也不影响定稿（定稿只认样片任务号）—— 门禁问的是这一档，不是段上现在的档。
 */
export function draftTierId(): string {
  return VIDEO_TIERS.find((t) => t.draftOk)?.id ?? "ultra";
}

/**
 * 档位 → 给人看的模型名（「Seedance 2.0 mini · 480p」）。**界面上显示「这一段交给哪个模型」一律走它**，别直接 modelLabel(tier.model)：
 * 「草稿」与「高清」是同一个模型，只差分辨率 —— 只印模型名的话两档看起来一模一样，用户不知道自己付的是哪一种。
 * 720p 是改之前的样子（不写），别的分辨率接在后面。
 */
export function tierModelLabel(tier: Pick<VideoTierSpec, "model" | "resolution">): string {
  const name = modelLabel(tier.model);
  return tier.resolution === "720p" ? name : `${name} · ${tier.resolution}`;
}

/**
 * 服务端登记表里的一发（只有模型与分辨率，没有档位 id）→ 是哪一档。认不出 = undefined（调用方别写 videoTier，交给 tierOf 兜底）。
 * ★ 必须连分辨率一起认：「草稿」与「高清」是同一个模型 —— 只按模型认的话，取回来的 480p 成片会被当成「高清」，之后的重拍 / 延长按错的档报价。
 *   分辨率缺省（老服务端不登记这一格）= 720p（2026-10-07 之前只有 720p）。
 */
export function tierIdOf(model: string | undefined, resolution: string | undefined): string | undefined {
  if (!model) return undefined;
  const res = resolution || "720p";
  return VIDEO_TIERS.find((t) => t.model === model && t.resolution === res)?.id;
}

/** 同上，但用完整的模型 id（档位按钮的 title：要查证的人看的那一份）。同一个模型的两档靠分辨率分开 */
export function tierModelId(tier: Pick<VideoTierSpec, "model" | "resolution">): string {
  return tier.resolution === "720p" ? tier.model : `${tier.model} · ${tier.resolution}`;
}

/**
 * 按**生成契约**报视频那半的价（2026-09-06 §四 1）：报价（flowStore.nodeCost）与出片（segmentGen）各自算出的数要在
 * 出片前对得上 —— segmentGen 在 composeSegments 之前拿它与 quotedTokens 对账，对不上把差额写进步骤日志。
 * ★ 只报视频那半：设定帧 / 圈选改图那几张由调用方按"这一发真画了几张"另加（IMAGE_TOKENS）。
 * ★ null = 这一档报不出这种模式的价（r2vMult 为 null 的档走 edit / reference）—— 不是免费，调用方该在门口就拒。
 */
export function videoTokensOfSpec(o: { mode: GenMode; durationSec: number; tierId?: string; refVideoSec?: number; ratio?: string }): number | null {
  if (o.mode === "edit") return r2vTokens(o.refVideoSec ?? 0, o.tierId);
  // 电影级「样片」两步（2026-10-07）：第一步 480p × 电影级系数；第二步 = 样片的时长 × 1080p × 77/15（服务端按自己登记的样片时长结算）
  if (o.mode === "draft") return draftStepTokens(o.durationSec, o.ratio);
  if (o.mode === "draftFinal") return draftFinalTokens(o.durationSec, o.ratio);
  // 延长与素材参考同一个式子：(输入 + 输出) × 系数（服务端 resolveR2v 的延长那一支结算走 tokens.materialRefTokens）
  if (o.mode === "reference" || o.mode === "extend") {
    if (tierOf(o.tierId).r2vMult === null) return null;
    return materialRefCost(o.refVideoSec ?? 0, o.durationSec, o.tierId);
  }
  return segTokens(o.durationSec, o.tierId, o.ratio);
}

/** r2v 公式核心：(输入 + 输出) × 每秒 21,600 × 系数，输出按 = 输入取上界 ⇒ 输入 × 2。
 *  拆出来是给 segmentCost 的兜底分支复用的 —— 同一条式子不许出现第二份（铁律六）。 */
function r2vRawTokens(inputSec: number, mult: number): number {
  return Math.round(inputSec * 2 * SEC_720P_TOKENS * mult);
}

/**
 * 素材参考出片（自定义 = 多图 + 参考视频，reference 子任务）的报价。
 *
 * ★ 与白模那条 r2vRawTokens 是**两个公式**：edit 输出≈输入所以 输入×2；
 *   reference 的输出时长由用户选（这一档的时长窗口内，电影级 4~30s），式子是 (输入 + 输出)×21,600×系数。
 * ★★ 夹取区间与 server 的 tokens.materialRefTokens **逐字相等**（报价=实扣，
 *   跨仓契约）：输入夹 [4,30]、输出夹到这一档的 [minSec, maxSec]（2026-10-03 之前两边都写死 [3,10]）。系数走档位表 r2vMult（方舟按
 *   "有没有视频输入"分档，不按子任务分档 —— 与白模同一档 2.8）。
 * ★ 档位没有 r2v 价（r2vMult 为 null）时**抛错**：这是报价函数，开发期就该当场炸
 *   （与 server 那份"结算不能炸"的分工相反，理由见 server tokens.imageTokensOf 注释）。
 */
export function materialRefCost(inputSec: number, outputSec: number, tierId?: string): number {
  const t = tierOf(tierId);
  if (t.r2vMult === null) {
    // i18n-ignore-next-line: 开发期断言（调用方 flowStore.nodeCost 已按 r2vMult 判过，引用字段名）
    throw new Error(`档位 ${t.id} 没有 r2v 价目（r2vMult=null），不能带参考视频出片——调用方该先判 refVid`);
  }
  const i = Math.max(4, Math.min(30, Math.round(inputSec)));
  const o = Math.max(t.minSec, Math.min(t.maxSec, Math.round(outputSec)));
  return Math.round((i + o) * SEC_720P_TOKENS * t.r2vMult);
}

/**
 * 白模模板（r2v）一段出片的 token 估算。**null = 这一档报不出 r2v 价**，不是免费
 * （类型逼着调用方处理，同 imageTierTokens；人话侧走 r2vPriceIssue）。
 *
 * ★ 公式见文件头「r2v 计费契约」（A3 账单逐 token 核过）：输入视频的时长**也计费**。
 * ★ 只收 inputSec 一个时长，因为报价按【输出时长 = 输入时长】取上界：edit 任务
 *   输出≈输入是**协议行为**（不是我们能选的参数），实测方舟还会略微裁短输出
 *   （14.04s 输入 → 13.67s 计费）—— 报价≥实收方向安全，误差 ~1%。
 * ★ **不过 clampDuration**：那个 10s 上限是纯 t2v 档位的产品约束（时长按钮选出来的数），
 *   白模没有时长选择器 —— 时长跟着模板走（白模**输入**窗口 [5,30]s、**模板视频**窗口
 *   [4,30]s，两个数不是一回事，见 data/templates 的 ARK_EDIT_RULES / BLOCKOUT_INPUT_RULES；
 *   服务端复核兜底）。在这里夹到 10 就是"报 10s 的价、按 30s 实收"，正是本文件最怕的方向。
 * ★★ **报价 = 实收的完整论证（2026-08-16 加了 realDurationSec 之后仍然成立）**：
 *   本函数**不 round 不 clamp**，服务端的同名式子是 round + clamp 到 [4,30]。两者恒等的
 *   前提是 `inputSec` 恒为 **[4,30] 内的整数** —— 而这正是服务端 finish 那道产物闸门
 *   保证的（真实秒数 ∈ [4,30] ⇒ 锚点 = `ceil(真实)` ∈ [4,30] 且为整数 ⇒ 服务端的
 *   `Math.round(整数)` 与 clamp 都是恒等操作）。所以：
 *     · 锚点**必须**继续存整数（`refVideo.durationSec`）。把它改成小数的那一刻，
 *       App 报 449,004 / 服务端实扣 483,840 —— 页面报少、钱包扣多，本仓头号事故形状。
 *     · 文件的真实小数秒另存 `refVideo.realDurationSec`，**只用于展示与校验，不进这条式子**。
 *   这条式子这次**一个字都没改**，就是"报价没被动过"的证据。
 * ★ inputSec 只准喂 `template.refVideo.durationSec`（服务端登记值的镜像，见 types.ts）——
 *   别拿 `<video>` 现探的本机值：server 结算按 URL 反查同一份登记值，两端必须算同一个数。
 * ★★ **参考图张数不进这条式子**，而这是**量出来的**不是猜的：G0 那一发带 3 张人物参考图，
 *   实收 188,109 raw = 8.7s × 21,621.6 = （输入 4.7s + 输出 4.0s），一张图的 token 都没多收。
 *   所以 2026-08-15 把白模路的参考图预算从 3 张放到 30 张（`ai/real.ARK_REF_IMAGES_MAX`）
 *   时**报价一个字都不用改**。
 *   ⚠ 但那个证据只有"3 张"这一个点：真按 9 个角色位发 18 张时，请回控制台账单再核一次
 *   （核法：拿这一发的 raw token ÷ 21,621.6，看是不是仍然只等于「输入+输出」的秒数）。
 *   今天的公式按【输出=输入】取上界，实测输出还会被裁短一点（4.7s 输入 → 4.0s 计费），
 *   富余约 8% —— 图真开始计费也大概率仍在"报价 ≥ 实收"这一侧，但那是**推论不是账单**。
 */
export function r2vTokens(inputSec: number, tierId?: string): number | null {
  const m = tierOf(tierId).r2vMult;
  return m === null ? null : r2vRawTokens(inputSec, m);
}

/**
 * 「这一档现在能不能按白模（r2v）报价/出片」—— **唯一实现**，照 imageTierPriceIssue
 * 的形状：null = 能，否则是一句给用户看的整句原因（界面拿它决定按钮能不能按、旁边写
 * 什么，而不是各自去档位表里探一次，铁律六）。
 *
 * ★ 先查 refVid 再查 r2vMult，顺序是有意的：refVid 是**闸门**（开闸 = 仓库主人只翻
 *   那一个布尔的 commit），r2vMult 是**价签**。闸没开时说「暂未开放」比说「报不出价」
 *   诚实 —— ultra 的价其实已经钉死了，没开的是链路。
 * ★ 为什么非有这句：价目/闸门不满足时唯一诚实的做法是既不报价也不开炼。放过去只有
 *   两个下场 —— 静默退回首尾帧（背景/运镜全丢、钱照收，偷换商品），或按错的系数收。
 * ★ 2026-10-05 起它只管「能不能**带参考视频**出片」（片段重拍、自定义的示例视频）：高清开了视频参考，
 *   但跑不了白模模板 —— 白模那件事问 blockoutPriceIssue（判据 VideoTier.blockoutOk），两件事别再用同一句判。
 */
export function r2vPriceIssue(tierId?: string): string | null {
  const tier = tierOf(tierId);
  const block = r2vBlockOfTier(tier);
  return block ? r2vBlockText(block, [tier.label], "refVideo") : null;
}

/**
 * 「这一档能不能跑**白模模板**」—— null = 能，否则整句原因。白模段的档位那一排（TierRow / r2vBlockLines）、
 * 出片闸（segmentGen.blockoutIssue 的非返修那一支）、模板详情页的出片键都只问它。
 * 判据：VideoTier.blockoutOk（只有电影级，理由见那一位）+ 价签（r2vMult）。
 */
export function blockoutPriceIssue(tierId?: string): string | null {
  const tier = tierOf(tierId);
  const block = blockoutBlockOfTier(tier);
  return block ? r2vBlockText(block, [tier.label], "blockout") : null;
}

/** 走不了白模（r2v）的两种原因：闸门没开（closed），或闸开了但价签没钉（unpriced，model 是括号里点名的模型显示名） */
export type R2vBlock = { kind: "closed" } | { kind: "unpriced"; model: string };

/**
 * 「这一档为什么走不了白模（r2v）」的**原因本身**，不带档位名（null = 走得了）。
 * r2vPriceIssue 就是它再加上档位名，先闸门后价签的顺序见 r2vPriceIssue 的 ★。
 *
 * ★ 为什么要有不带档位名的这一层（2026-09-11 多语言）：本段设置抽屉原来用正则 `^「[^」]*」` 剥掉整句开头的
 *   档位名，再按剩下的句子去重 —— 英文句子不以「…」开头，剥不掉 ⇒ 去重静默失效（同一件事糊四遍），
 *   重拼时还把中文引号塞进英文里。按原因去重，就不用去猜句子长什么样。
 */
export function r2vBlockOf(tierId?: string): R2vBlock | null {
  return r2vBlockOfTier(tierOf(tierId));
}

/** 判据本体，只有这一处。★ 收档位**对象**而不是 id：r2vBlockLines 要让「原因」与「档位名」出自同一个对象 ——
 *  按 id 再查一次表的话，传进来的对象与表里那份一旦不是同一个（或 id 不在表里、tierOf 静默退回标准档），两者就对不上 */
function r2vBlockOfTier(tier: VideoTier): R2vBlock | null {
  if (!tier.refVid) return { kind: "closed" };
  if (tier.r2vMult === null) return { kind: "unpriced", model: modelLabel(tier.model) };
  return null;
}

/** 白模模板的判据本体（与 r2vBlockOfTier 同形，闸门换成 blockoutOk）。收档位对象的理由同上 */
function blockoutBlockOfTier(tier: VideoTier): R2vBlock | null {
  if (!tier.blockoutOk) return { kind: "closed" };
  if (tier.r2vMult === null) return { kind: "unpriced", model: modelLabel(tier.model) };
  return null;
}

/** 这句话说的是哪件事：带参考视频出片（返修 / 示例视频），还是跑白模模板 */
type R2vScope = "refVideo" | "blockout";

/** 几个档位名接成一串：整串外面那对引号由整句自己带（中文「极速」「标准」，英文 “Fast”, “Standard”） */
export function joinTierNames(labels: string[]): string {
  return labels.join(
    t({
      message: "」「",
      comment: "几个档位名接成一串时的分隔符。整串外面那对引号写在句子里，所以中文是前一个名字的右引号接上后一个的左引号（「极速」「标准」）；英文写成 ”, “ 就是 “Fast”, “Standard”",
    }),
  );
}

/**
 * 有某种能力、还没停用的那几档的名字接成一串（**目录口径，不看套餐** —— 要按「这个人用得了的」说，问 account.tierNamesFor）。
 * 空串 = 一档都没有。★ 句子里点名「去换哪一档」一律从能力现算，别写死「高清」「电影级」：2026-10-07 加了「草稿」之后，
 * 二十来处写死的档名一下子都少说了一档（而且是免费用户唯一能用的那一档）。
 */
export function tierNamesWhere(pred: (t: VideoTier) => boolean): string {
  return joinTierNames(VIDEO_TIERS.filter((x) => pred(x) && !tierRetired(x)).map((x) => x.label));
}

/**
 * 出片会参考卡上声音样本的那几档（出声 + 收参考媒体：2.x 的「草稿」「高清」「电影级」）。卡片页 / 录音 / 圈选取声音几处说明共用，
 * 原来各写「高清/电影级」—— 加了「草稿」之后那几句都少说一档。目录口径（说的是「哪几档会用它」，不看套餐）。
 */
export function voiceTierNames(): string {
  return tierNamesWhere((x) => x.audio && x.refImg);
}

/**
 * 「按模型适配」那一格的行首（卡片页 / 卡组页）：**收参考图的方舟档**有哪几档（2.x：草稿 / 高清 / 电影级）。
 * 用「 / 」并列（这是分类的名字，不是指路的句子，不加引号）。目录口径、不看套餐：说的是「卡在这几档上怎么起作用」。
 */
export function refImgTierList(): string {
  return VIDEO_TIERS.filter((x) => x.refImg && !x.flatCost && !tierRetired(x))
    .map((x) => x.label)
    .join(" / ");
}

/**
 * 同一个原因、一档或几档合成一整句（labels 是档位的界面名）。单档（r2vPriceIssue）与合并（r2vBlockLines）读同一份措辞。
 *
 * ★★ 「closed」分两种说法（2026-10-02 主人拍板：模板对出片模型是**硬要求**，不是"还没轮到"）：
 *   · 有一档开着（今天是电影级 / Seedance 2.5）⇒ 说清**这类出片只有那一档做得到**。原来一律写「暂未开放…等开放后再来」，
 *     读起来像是别的档过一阵也会放开 —— 而 1.0 两档与真人档在协议上就没有参考视频这一项，等多久都不会有；
 *     用户该做的是换到做得到的那一档（或者按自己能用的模型去挑模板，见模板货架的「出片模型」筛选），不是等。
 *   · 一档都没开（闸门全关）⇒ 才是真的「暂未开放」，原句保留。
 * ★ 2026-10-05 起分两种用途（scope）各说各的：高清能带参考视频（片段重拍、自定义的示例视频），但跑不了白模模板。
 *   「blockout」= 白模段的档位那一排（r2vBlockLines）与白模出片闸；「refVideo」= 返修（FixSegmentBox 的片段重拍）与示例视频。
 *   原来一句话包两件事（「白模模板复刻、返修都属于这一类——只有电影级做得到」），高清开了之后那句话一半是错的。
 */
function r2vBlockText(block: R2vBlock, labels: string[], scope: R2vScope): string {
  const names = joinTierNames(labels);
  if (block.kind === "closed") {
    if (scope === "blockout") {
      const open = blockoutTier();
      if (!open) return t`「${names}」这一档暂未开放白模模板出片，等开放后再来`;
      const openLabel = open.label;
      const openModel = modelLabel(open.model);
      return t`「${names}」跑不了白模模板（模板对出片模型是硬要求）——白模模板只有「${openLabel}」（${openModel}）跑得了`;
    }
    const open = VIDEO_TIERS.filter((x) => !r2vBlockOfTier(x));
    if (!open.length) return t`「${names}」这一档暂未开放按参考视频出片，等开放后再来`;
    const openNames = joinTierNames(open.map((x) => x.label));
    return t`「${names}」做不了按参考视频出片（片段重拍、自定义的示例视频都属于这一类）——这类出片只有「${openNames}」做得到`;
  }
  const model = block.model;
  return scope === "blockout"
    ? t`「${names}」这一档的白模出片暂时报不出价（${model} 的 r2v 单价未核账），先用别的档位`
    : t`「${names}」这一档的参考视频出片暂时报不出价（${model} 的单价未核账），先用别的档位`;
}

/**
 * 白模段上「哪几档点不动、为什么」—— 同一个原因只说一句，档位名并到一起。本段设置抽屉与工坊 TierBlockNote 两面共用。
 * ★ 2026-08-23 抽屉修过"每句带着自己的档位名、字面各不相同 ⇒ 去重恒失效、同一件事糊四遍"，
 *   工坊那一面一直是逐档各印一句 —— 收成这一处，两面说的是同一串话。
 * ★ 不收档位表参数，只走 VIDEO_TIERS，原因与档位名从同一个档位对象上取（blockoutBlockOfTier）：
 *   收一份外来的表、原因却按 id 回全局表里查的话，两者可以悄悄对不上。
 * ★ 两个调用方（本段设置抽屉、工坊 TierBlockNote）都只在白模段上问它，所以按白模判据（blockoutOk），不是 refVid。
 */
export function r2vBlockLines(): string[] {
  const groups = new Map<string, { block: R2vBlock; labels: string[] }>();
  for (const tier of VIDEO_TIERS) {
    const block = blockoutBlockOfTier(tier);
    if (!block) continue;
    // 报不出价的按模型分开说（括号里点名的是各自的模型），暂未开放的并成一句
    const key = block.kind === "unpriced" ? `unpriced:${block.model}` : block.kind;
    const hit = groups.get(key);
    if (hit) hit.labels.push(tier.label);
    else groups.set(key, { block, labels: [tier.label] });
  }
  return [...groups.values()].map((g) => r2vBlockText(g.block, g.labels, "blockout"));
}

/**
 * 「白模那条路实际走哪一档」—— 用户在白模链路上**没有档位选择器**（出片模型由链路本身
 * 决定，不是节点卡上选的），所以这件事得有一个统一的出处：**blockoutOk 的那一档**。
 * ★ 2026-10-05 从 `find(refVid)` 改成 `find(blockoutOk)`：主人「合」给高清开了视频参考（refVid），而高清排在电影级前面 ——
 *   不改的话白模模板会被悄悄换到高清。下面「同时最多只有一档开着」那条假设现在落在 blockoutOk 上（今天只有电影级）。
 *
 * ★ 返回 null = 全表都没开闸（refVid 全 false，首发时的状态）。调用方据此既不报价也不开炼，
 *   人话走 blockoutizeIssue。
 * ★ 为什么用 `find(refVid)` 而不是写死 `"ultra"`：refVid 是**闸门**（开闸 = 仓库主人只翻
 *   那一个布尔的 commit），写死 id 就等于把闸门抄了第二份 —— 翻了布尔却没改这里，
 *   表现是"闸开了但白模链路还按老档报价"，两个方向都不报错。
 * ⚠ 这里假设**同时最多只有一档开着 refVid**（今天成立：方舟只有 2.5 支持 edit 子任务，
 *   而白模化那一发的模型由**服务端**的 blockoutize 端点钉死，能对上正是因为只有一个候选）。
 *   哪天开了第二档，这个函数就不再够用 —— 那时必须改成「服务端告诉我们这一发用了哪一档」，
 *   **不许在这里猜**：猜错就是报 A 档的价、按 B 档结算。
 * ★ 2026-10-02 起全仓只剩这一处：pages/TemplateDetailPage 与 studio/flowStore（套用 / 整组套用 / 按段换模板）
 *   原来各自内联的 `VIDEO_TIERS.find((x) => x.refVid)` 都换成了本函数；「这个模板能在哪几档上跑」再往上一层
 *   是 data/templates.templateTiers（货架筛选、卡面与详情页的标注问的都是它）。
 */
export function blockoutTier(): VideoTier | null {
  return VIDEO_TIERS.find((t) => t.blockoutOk) ?? null;
}

// ── 出图模型与铸卡档位 ─────────────────────────────────────────
//
// 口径与视频同一把尺子：**元/张 ÷ 15 元/百万 token**（15 = Seedance 1.0-pro 标准档）。
// ★ 不做 base × mult 两层：图片是"每张一口价"，没有时长那样的连续量，除一次再乘回来
//   只会引入舍入误差，而误差方向总是我们垫钱。直接写绝对 token。
//
// ✅ 单价已于 **2026-08-14** 对着方舟官方价目页逐行核过（见下面那张表的注释），
//   并与控制台账单里 5.0-Lite 的实收 0.22 元/张互相印证。
//   发现偏差**只改这一张表**，并同步 server/src/config/tokens.js 的同名表（跨仓契约）。
//
// ⚠ 顺带记一件会误导人的事：这个账号上挂着一堆「协作奖励计划」资源包（每天发的
//   20 张/张数包、2000000 token 包，递减型、30 日有效），所以**眼下出图的现金支出
//   接近 0**，账单里那几行的单价是 ¥0。**不要**据此把价目表改成 0 ——
//   那是促销额度，用完就按下面的刊例价走；而用户花的是我们的 token 体系，
//   它折算的是**真实资源消耗**，不是我们这个月恰好没付钱。
//
// 各模型的像素区间是 2026-08-11 拿真 key 探出来的（发必然 400 的尺寸、读报错文案，零成本）：
//   4.0     ≥ 921,600      ≤ 16,777,216
//   4.5     ≥ 3,686,400    ≤ 16,777,216
//   5.0     ≥ 3,686,400
//   5.0-pro ≥ 921,600      ≤ 4,624,220
// ★ 那条 3,686,400 是 **5.0 / 4.5 专属**，不是 Seedream 的通则 —— 别再照抄成全家桶下限。
//
// ⚠⚠ 关于 `doubao-seedream-5-0-260128`（此前一直是全站默认出图模型）：详见下面的
//   SEEDREAM_5_LITE_TOKENS。一句话：它叫 5.0 **Lite**、0.22 元/张，当初把它排除在
//   档位表外的理由（"公开价目查不到"）是**错的**。
//
// ✅ 折算分母被账单印证：`Doubao-Seedance-1.0-pro 推理 ¥0.015/千 token` = **¥15/百万 token**，
//   正是本文件全部 mult 与 IMAGE_TOKENS 的那个 15。地基是对的。

// ── 2026-08-13 在生产上用真 key 各出了一张真图（画布就是 CARD_SIZE），实测 ──
//   三个档位模型**都能在 1728×2304 上出图**（此前只有 5.0 与 pro@1296×1728 真跑过）。
//   耗时（单次，仅供量级参考，波动很大）：
//     4.0     11.6s
//     4.5      7.1s   ← **比 4.0 还快**。中档既更好又更快，选底档的唯一理由是便宜；
//                        速写档的 desc 别暗示它更快。
//     5.0-pro 95.7s @1728×2304 ／ 77.9s @1296×1728（更早一次测同尺寸是 73.6s）
//   ★ pro 满画布近 96 秒 ⇒ 顶档一张卡三张图串行就是**将近 5 分钟**。
//     客户端出图超时 170s 仍然够（且必须 > 服务端 T_CREATE 150s），但逐图进度播报
//     不是锦上添花，是必需的 —— 没有它，用户看到的就是一个不动的"炼卡中…"。
//   ★ usage.output_tokens 恒等于 **像素 ÷ 256**（398 万 → 15552，224 万 → 8748），
//     它是像素折算，**不是**计费口径；计费看 generated_images。

/**
 * 一张出图的 token 等价，按模型。
 *
 * ✅ **2026-08-14 对着方舟官方价目页逐行核过**
 *   （docs.volcengine.com/docs/82379/1544106 →「图片生成模型」表）。
 *   那一页是 JS 渲染的，抓取工具拿不到内容 —— 之前几轮全靠第三方转载互相印证，
 *   现在是打开真浏览器读的原表。官方表只有「输入图单价」「输出图单价」两列，
 *   **没有**任何「基础推理 1.00 元/张」那样的行。
 */
export const IMAGE_TOKENS_BY_MODEL: Record<string, number> = {
  // 0.20 元/张 ÷ 15 元/M = 13,333。✅ 官方价目已核
  "doubao-seedream-4-0-250828": 13_333,
  // 0.25 元/张 ÷ 15 元/M = 16,667。✅ 官方价目已核
  "doubao-seedream-4-5-251128": 16_667,
  // 0.60 元/张 ÷ 15 元/M = 40,000。✅ 官方价目已核
  //
  // pro 是全表唯一按场景分档的：
  //   输入图：**首张免费，第 2 张起 0.02** —— 铸卡管线恒定只带 1 张参考图
  //           （slot[i>0] 拿 slot[0] 当参考，见 ai/real.forgeSlots），所以**永不触发**，
  //           这一格不含它。哪天改成多张参考图，这里要加。
  //   输出图（单图生成场景）：≤261 万像素 0.30 ／ **>261 万像素 0.60**
  //   输出图（图层拆分场景）：0.15 ／ 0.30 —— 那是另一个功能，我们不用
  // ★ 顶档**故意用满画布** CARD_SIZE(1728×2304 = 398 万像素) 落在 0.60 那一档：
  //   压到 261 万以下（例 1296×1728 = 224 万）单价减半，但那样顶档出的图会
  //   **比中档还小**，一个"更贵却更糊"的顶档迟早被当成 bug。
  //   想换成半价版只改 ImageTier.size 那一行，**这个数要一起改成 20,000**（两仓都改）。
  "doubao-seedream-5-0-pro-260628": 40_000,
};

/**
 * `doubao-seedream-5-0-260128` 的官方名是 **Doubao-Seedream 5.0 Lite**，**0.22 元/张**
 * （✅ 2026-08-14 官方价目页 + 账单双向核对）⇒ 折 14,667。
 *
 * ★ 它**不在上面那张表里**，因为它不是任何一档铸卡用的模型（三档是 4.0/4.5/pro）。
 *   但服务端仍然要认它 —— 已装机的老 APK 还在发这个 id，那边按**老包自己报的
 *   13,300** 结算（差价我们吃），理由见 server/src/config/tokens.js 的 LEGACY_IMAGE_TOKENS。
 * ★ 记在这里是为了让下一个人知道：当初把它排除在档位表外的理由（"公开价目查不到"）
 *   是**错的** —— 查不到只是因为它在账单与价目页里叫 "Lite" 而不是 id 里那个 "5-0"。
 *   要不要把它放回档位表是产品决定（0.22 vs 4.0 的 0.20，差 10%），别再拿"查不到价"当理由。
 */
export const SEEDREAM_5_LITE_TOKENS = 14_667;

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
  /** 界面名。★ IMAGE_TIERS 里是 getter，读到时按界面语言现翻 —— 判据一律认 id（Card.imageTier 存的也是 id） */
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
    // ★ label / desc 用 getter 读到时现翻（同 VIDEO_TIERS 那条 ★）；「定妆」这个词另在 ai/index.ts 的提示词里出现，那边冻结中文、别共用
    get label() {
      return i18n._(msg`速写`);
    },
    model: "doubao-seedream-4-0-250828",
    views: 1,
    size: CARD_SIZE,
    get desc() {
      return i18n._(msg`只画 1 张主图 · 它同时就是卡面`);
    },
  },
  {
    id: "studio",
    get label() {
      return i18n._(msg`定妆`);
    },
    model: "doubao-seedream-4-5-251128",
    views: 2,
    size: CARD_SIZE,
    get desc() {
      return i18n._(msg`画 2 张：主图 + 一张参考图，照着主图画同一个对象`);
    },
  },
  {
    id: "master",
    get label() {
      return i18n._(msg`精绘`);
    },
    model: "doubao-seedream-5-0-pro-260628",
    // ★ 2（不是 3）：出片管线一张卡最多喂 2 张，第 3 张是画了也用不上的（见 slotsFor）
    views: 2,
    size: CARD_SIZE,
    // 实测 2026-08-11：pro 出一张 1296×1728 用了 73.6 秒，是 5.0（21-25s）的三倍多。
    // 客户端出图超时因此必须 > 服务端 T_CREATE，见 ai/arkClient 的说明。
    get desc() {
      return i18n._(msg`同样 2 张，换最新旗舰模型来画 · 形象更准、细节更实，出图较慢`);
    },
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
  const tier = imageTierOf(tierId);
  if (imagePriceOf(tier.model) !== null) return null;
  const label = tier.label;
  const model = modelLabel(tier.model);
  return t`「${label}」这一档暂时报不出价（${model} 不在价目表里），先用别的档位`;
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

// ★★ 这里原来有个 `VISION_FRAME_TOKENS = 900`（"看图每帧 900"），2026-09-10 连名字一起删了。
//   服务端 `config/tokens.js` 的 `priceOf` 对 `kind:"chat"` **恒收 CHAT_TURN_TOKENS**，而看图
//   （arkClient.chatVision）走的就是 /chat/completions —— **一次调用一个定额，塞几张图都一样**
//   （2026-09-10 拿服务端 priceOf 实跑：带 0 / 1 / 6 / 8 张图都是 400）。按帧报价从一开始就对不上：
//   白模那条（blockoutTemplateCost）08-17 先修过，提卡四条路的报价与 real.ts 里记实收的六处一直按帧算。
//   留着这个常量就是给"按帧计价"留个复活的口子。看图一律 = CHAT_TURN_TOKENS × 调用次数（见 mintQuote）。

/** 成片提炼卡组时最多看几帧（V3：豆包看成片抽帧而不是只读剧情文字），real.deckFrameUrls 按它封顶。
 *  ★ 不进报价：看图按调用次数收（CHAT_TURN_TOKENS），帧数只影响认得准不准、请求有多大。 */
export const DECK_VISION_FRAMES = 6;

/** 每张卡的文案精炼（豆包一次短对话）token 等价 —— 素材炼卡（real.generateCards）**每张卡真发一次 chat**，
 *  服务端按 chat 定额收，所以它必须与 CHAT_TURN_TOKENS 相等（server 那条跨仓钉子两个一起钉）。
 *  ⚠ 看片提卡那几条路（real.mintCards）**没有**逐张文案这一趟：卡名 / 简介 / 出片句都在前面那一次看图里
 *  一起吐出来了。2026-09-10 之前那边每张卡照记 400，记的是一次不存在的调用 —— 别把这一项加回去。 */
export const CARD_META_TOKENS = 400;

/**
 * 一次 chat 调用的 token 等价 —— **服务端 `config/tokens.js` 同名常量的镜像**（跨仓契约，两仓一起改；
 * 钉在 server 的 `tests/arkProxy.spec.js`「跨仓 chat 定额一致性」）。
 * 服务端对 /chat/completions 一律按调用定额收：闲聊（chatTurns）、一问一答（chat）、看图（chatVision）
 * 都是这一个数，与带多少历史、塞几张图无关。所以看图的报价与记账都按「调用次数 × 它」算。
 *
 * ★ 闲聊为什么单开一个常量、不复用 CARD_META_TOKENS：那是"一次极短的 JSON 抽取"（几十字输入），
 *   闲聊要背 ~600 字人设 + ~1000 字历史，**真实成本**是它的十几倍。但服务端**结算**不分这两种，
 *   所以两个数眼下必须相等；哪天服务端按用量分档，再让它们各走各的。
 * ⚠ doubao-seed-2-1-turbo 的实际单价**没有实测过**，400 是按同一把尺子估的保守值，
 *   上线前必须照方舟账单校一次。（这里原来写着"真实结算走接口返回的用量"—— 不对，服务端收的就是这个定额。）
 */
export const CHAT_TURN_TOKENS = 400;

/**
 * 老师人格三个单价（M4，tutor 仓 docs/06 §6.1「economy.ts 镜像 tutor_turn / distill / extract」）—— 这是**报价**那一半；
 * **结算**在 server `config/tokens.js` 的 TUTOR_PRICES，两边逐条相等：server `tests/tutorPrices.spec.js` 钉着这一份的三个数
 * （改价先改 server，再来这里，再改那条 spec —— 顺序反了 App 会先报一个服务端不认的价）。
 * tutor_turn 钉在 CHAT_TURN_TOKENS（一次教学轮 = 一次 chat 调用，tutor 仓 docs/08 #4）；其余按「相对一轮花多少」按比例，都是建议值（dogfood 量过再钉死）。
 */
export const TUTOR_PRICES = Object.freeze({ tutor_turn: CHAT_TURN_TOKENS, tutor_distill: 600, tutor_extract: 400 } as const);

// ★★ 这里原来有个 `SCRIPT_SPLIT_TOKENS = 2 * CHAT_TURN_TOKENS`（结构化技能「剧本 → 分镜字段」的价签，理由是
//   "输入输出都是闲聊那一趟的几倍，按两趟计"），2026-09-10 删了：那一发只是**一次** chat
//   （structuredSkills.runScriptToShots → canvasAgentChat → chat()），服务端按调用收 CHAT_TURN_TOKENS ——
//   按钮上写 800、余额门槛按 800、离线记账扣 800，实收 400，与 VISION_FRAME_TOKENS 同一个错。价签现在就是 CHAT_TURN_TOKENS。
// ★ 调研过同类平台才定的（2026-09-10）：LibTV 的 Agent 对话不扣积分（09-08 主人账号实测走过一轮对话、积分没动；
//   非会员按每天 3 轮限次），积分只在提交出图 / 出片时扣，价格写在生成那一行；FLORA、Figma Weave 连文本模型也扣，
//   但**跑之前节点 / 运行按钮上显示的就是这一次要扣的数**。没有一家是"价签按内容量估、结算按调用算"两套口径。
// ⚠ 真实成本确实比 400 高：turbo 输入 3 元/M、输出 15 元/M（2026-08-06 官方价目），折成本仓 15 元/M 的尺子是
//   「0.2 × 输入 token + 1 × 输出 token」。一篇 2000 字剧本（按 1 字 ≈ 1 token 取上限）加提示词、输出顶满 chat() 的
//   max_tokens 800，约 1,260 —— 每次最多少收约 860（≈1.3 分钱），这笔差价我们吃掉。
//   真要按成本收，得在**服务端**按方舟回包的 usage 计量（先按上限预扣、多退少补），不能在客户端单给某个技能标一个
//   更高的价：服务端认不出"这一发是拆分镜"，客户端说什么都不作数。

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
 * ★★ 为什么**至今没有档位把 views 写成 3**（顶档曾经写过，2026-08-11 改回 2）：
 *   原来的理由是"出片管线对任何一张卡最多喂 2 张图，第 3 张永远排在配额之外"——
 *   ⚠ **那半句 2026-09-23 起不成立了**：作者在卡片页把第 3 张标成「出片用」之后，
 *   它会在"每张卡都拿到第 1 张"之后等预算补进来（ai/real 规则二的 ★★，放开三视图 / 规格稿那次）。
 *   ⇒ 现在留着 2 的理由只剩一条，而且是**产品决定不是技术结论**：多画一张顶档 40,000 token 的图，
 *   而它只在"同段挂的卡少、预算有余"时才真进模型。要不要涨是价目与商品的决定（主人拍板），
 *   别顺手把它改了 —— 报价与出图读的是同一次 slice，改这个数是真收钱。
 * ★ 那一格照旧**手动也能用**：用户可以在卡片详情页自己补一张 detail，缺 face 或 body 时它还会顶上来
 *   （取图按卡上真有的图排序，不是按图位表）。—— 所以删格子是错的。
 * ★ 这里仍然只 `Math.min(views, MAX_CARD_VIEWS)`，不再另写一个 `Math.min(…, 2)`：
 *   真正的 2 在 ai/real 那侧（`MAX_CHAR_REFS`，今天只管第一轮）。它现在是导出的，但**照样不 import**——
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
//   都只收它，`extractCost(8)` / `mintSpec(12, …)` 这类手写数字**编译不过**。
//   要改上限只能改下面这两个常量 —— 提示词由 mintSpec 从同一个值插值出来，
//   slice 用的也是同一个值，改一处三处一起动，漏不掉。
declare const CARD_MINT_CAP: unique symbol;
export type CardMintCap = number & { readonly [CARD_MINT_CAP]: true };

/** 成片派生卡组 / 上传视频提卡：一次最多出几张。 */
export const DECK_MAX_CARDS = 8 as CardMintCap;

/** 上传视频提**模板**时顺带出的素材卡上限。比提卡少是有原因的：模板不出 character 卡
 *  （主角由套模板的人自己指定），能复用的只剩场景/氛围/道具/画风四类。 */
export const TEMPLATE_MAX_CARDS = 6 as CardMintCap;

/**
 * 看片提卡里**一张卡最多花多少** —— 取 real.mintCards 真实调用序列里最贵的那一格：
 * 场景卡 = 原帧去人留景出一张图（IMAGE_TOKENS）+ 看一眼复核还有没有人（一次 chat）。
 * 别的格都更便宜：风格整帧 / 道具裁剪 0 次调用，文生图兜底 1 张图、不复核。
 * ★ **没有逐张文案那一趟**（见 CARD_META_TOKENS 的 ⚠）。
 * ★ 出图按默认档：mintCards 出图不传 model，arkClient.generateImage 缺省发的就是默认档（IMAGE_TOKENS 的出处）。
 */
const MINT_CARD_MAX_TOKENS = IMAGE_TOKENS + CHAT_TURN_TOKENS;

/**
 * 看片提卡的**上限**：`chatCalls` 次 chat + 最多 `cap` 张卡 —— 下面三个报价函数（extractCost / templateCost /
 * deckCardsCost）只准从这里取（原来还有第四个 blockoutCardsCost：白模路上那一步走不到的「从原片铸素材卡」的报价，2026-09-17 一起删）。
 *
 * ★★ 单位与服务端结算一一对应：一次 chat（看图、纯文字都一样）= CHAT_TURN_TOKENS，一张图 = IMAGE_TOKENS。
 *   real.ts 记实收时按同一对单位逐笔加（每发一次 chat 加一个、每真出一张图加一个），报价只是把
 *   "最多发几次、最多出几张"代进来，所以实收只会 ≤ 报价。
 * ★★ **没有帧数参数是有意的**：服务端 priceOf 对 kind:"chat" 返回定额，与消息里塞几张图无关。
 *   2026-09-10 之前这里按「帧数 × 900 × 遍数」算：经典模板看 8 帧、6 张场景卡时视觉那一半报 19,800、
 *   最多只扣 3,200（记账那边每张卡还多记一笔不存在的文案钱）。余额卡在中间时 canAfford 判否，把人挡在门外 ——
 *   与 blockoutTemplateCost 08-17 修掉的是同一个错，当时没修到这几条路上。
 *   （blockoutTemplateCost 还留着 frameCount 形参，只因为它嵌在 blockoutizeCost 的签名里，那边同样不计价。）
 */
function mintQuote(chatCalls: number, cap: CardMintCap): number {
  return chatCalls * CHAT_TURN_TOKENS + cap * MINT_CARD_MAX_TOKENS;
}

/**
 * 上传视频提炼卡组的预估：看一次抽帧认卡 + 最多铸 cap 张卡面。
 * 张数是上限而非确数（模型认出几个实体就出几张，重复的还会被剔掉），
 * 所以 UI 必须说"最多"；实收由 real.extractCardsFromVideo 逐笔记（看图一次 + 真出的图 + 去人复核），只会比这个上限少。
 * ★ 参数只收 CardMintCap：这里能手写数字的话，就又有了一处会和提示词分叉的 8。
 */
export function extractCost(cap: CardMintCap): number {
  return mintQuote(1, cap);
}

/** 视频提**模板**的预估：看两次抽帧（总结配方 + 认素材卡，real.extractTemplateFromVideo 里两发 chatVision）+ 最多 cap 张卡。
 *  ★ 这式子原来长在 VideoTemplateExtractor 里，那里同时还自带一个 `MAX_CARDS = 6`——
 *    正是上面说的那处分叉。搬到这里是为了让它和 mintCards 读同一个 cap。 */
export function templateCost(cap: CardMintCap): number {
  return mintQuote(2, cap);
}

/**
 * 提**白模模板**的预估：看 N 帧总结配方，**单遍视觉、卡面恒 0 张**（预估即结算 ——
 * 没有"按实出卡"的浮动项，所以不需要逐笔结算）。
 *
 * ★ 与 templateCost（两遍视觉 + 最多 TEMPLATE_MAX_CARDS 张卡）**不是一回事，别复用**：
 *   白模里全是大色块和红色小人，「认素材卡」那一遍必然空手而归 —— 跑了是白烧钱，
 *   照 6 张报价则是吓唬人（报价≠实收的另一个方向，两种都不报错）。配方总结一遍就够。
 * ★ 看图一次 = CHAT_TURN_TOKENS，与 mintQuote 同一个单位；这条路没有卡，所以直接就是它。
 */
export function blockoutTemplateCost(frameCount: number): number {
  // ★★★ 2026-08-17 修：**看几帧不影响这一笔**，所以照实按「一次 chat」报，
  //   `frameCount` 只留在签名里给调用方读（它仍然决定质量，只是不决定价钱）。
  //   原来写的是 `frameCount * VISION_FRAME_TOKENS`，而服务端那一头
  //   （`config/tokens.js` 的 `priceOf`）对 `kind:"chat"` **返回定额 CHAT_TURN_TOKENS**，
  //   与几帧完全无关 —— 8 帧时页面报 7,200、实扣 400，报价是实收的 18 倍。
  //   方向虽然是"少收"（不偷钱），但它是一句**假话**，而且真会伤人：
  //   余额卡在两者之间时 `canAfford` 判否，用户被自家报价挡在门外，
  //   去充了一笔本来不需要的钱。
  //   ⚠ 机理是**服务端按"调用了几次、什么 kind"计价，不按内容量**：N 帧是塞进
  //   同一条 messages 里的一次 chat。所以"按帧报价"这个模型从一开始就对不上。
  //   ⚠ 同一处分叉当时还留在提卡四条路（templateCost / extractCost / deckCardsCost / blockoutCardsCost —— 最后这个 2026-09-17 已删）
  //   与 real.ts 的记账上；2026-09-10 逐条核清每条路真发几次 chat 之后一并改成按调用计（见 mintQuote）。
  void frameCount;
  return CHAT_TURN_TOKENS;
}

/**
 * 「作者自己传一段参考视频登记成模板」这一次的报价（V1 登记路，`POST /api/branch/templates`）。
 *
 * ★★ 这条路**不出片**（视频已经在手上了），所以没有 r2v 那一笔 —— 它花的全部是 chat：
 *     ① 认人**最多两发**（8 帧的视觉调用在上游 150s 超时线上下浮动，实测同一段素材
 *        前一次回 7 个角色位、后一次回 504 —— 允许重试一次。⚠ 失败那次网关会退费，
 *        所以"最多两发"是报价上限，实收多半只有一发）；
 *     ② 量框**最多 `BLOCKOUT_BOX_TRIES` 发**（一帧一发，第一个能给出正好 M 个框的胜出）。
 *   量框要重试是因为它成立的前提是"这一帧里所有人都在画面里"，而人会入场/离场 ——
 *   2026-08-17 实测：认人认出 7 个，正中间那一帧只站着 5 个，整份被闸门丢掉。
 * ★ 报的是**上限**，实收按真发了几发（服务端一命中就不再试）。方向永远是
 *   「报价 ≥ 实收」—— 与 visionFrames 那条同一侧（报计划、收实际）。
 * ⚠ `BLOCKOUT_BOX_TRIES` 是**跨仓契约**：服务端那一半是 `blockoutize.BOX_FRAME_TRIES`
 *   （= boxFrameCandidates 的长度）。谁改候选帧的个数，两边一起改 —— 只改一边的表现是
 *   报价与实收差一发 chat，两个方向都不报错。
 */
export const BLOCKOUT_BOX_TRIES = 5;
/** 认人最多发几次（超时抖动允许重试一次）。跨仓契约：服务端那一半是登记路里那个 `attempt <= 2` */
export const BLOCKOUT_ROSTER_TRIES = 2;

export function ownRefTemplateCost(): number {
  return CHAT_TURN_TOKENS * (BLOCKOUT_ROSTER_TRIES + BLOCKOUT_BOX_TRIES);
}

// ══ 「成片回来后量一帧位置框」为什么**不在这张价目表里** ═══════════════════════
//   白模视频出来之后，服务端还会看一帧，记住每个人偶站在画面哪儿（`markBoxes`，
//   App 靠它开"把卡直接拖到人偶身上"那条挂卡路径）。那一发**我们自己吃掉，不计费**，
//   所以这里一个字都不用加 —— 报价里没有它、账单上也没有它，两边一致。
//   理由写在服务端 `branchTemplate.routes` 的 ⑧b：它只有 400 token（同一次白模化的总账是
//   3,760 万），而要把它算进来就得破掉「**钱全在阶段一花掉，取回结果一分不加**」
//   那条已经钉死的承诺 —— finish 是一条可以重来的路，一旦它会花钱，"重试取件"
//   就变成用户不敢做的事。
//   ⚠ 哪天那一步真的变贵了（比如改成量五帧、或换成付费的检测模型），**先回来加这一项**，
//   别指望"反正很小"—— 那句话每加一次就少成立一点，而它失效时没有任何一层会报错。

/**
 * **白模化**（把用户自己的一段视频整段换成白模人偶 —— 2026-08-17 起是一模一样的纯白人偶、
 * 靠位置指认，此前印过数字也上过颜色；**标记怎么做不影响这条报价**，几种方案都是同一发
 * r2v、同样四个钉死的参数，报价与实收的关系一个字没变）那一次的报价：
 * 看帧列人物 + **一次真实付费出片**（r2v edit）。
 *
 * ★ 这条链路花的是**两次真钱**（白模化一次、别人套用出片再一次），而这个函数报的是
 *   **前面那次**。编辑页开炼前必须把它整句报出来 —— 只报"套用时多少钱"是把最先花掉的
 *   那笔藏起来，正是本文件反复在防的「报价 ≠ 实收」。
 * ★ 视觉那一半复用 blockoutTemplateCost 的口径（单遍视觉、0 张卡面）：白模化的第一步与
 *   提白模模板一样是"看几帧总结画面里有什么"，同一件事不许有第二条式子。
 * ★★ `frameCount` **不是常数**（2026-08-15 起）：白模化那一步看几帧要么按选段时长自动算、
 *   要么由作者在编辑页逐帧标出来。所以调用方必须**每次都现算**，且只能从
 *   `data/templates.visionFrameCount(durSec, frameTimes)` 取 —— 它与真正发上去的
 *   `frameTimes` 读同一个数组。在调用点手数一次（marks.length 之类）就是第二条式子：
 *   用户把某一帧拖出选段之后，页面报 5 帧、服务端按 3 帧扣，两个方向都不报错。
 *   ⚠ 帧数的**权威值**在服务端（阶段一回包的 `frames`）：与本机算的不等时以它为准并如实
 *   说一句（`blockoutizeTemplate` 的 framesNote），别默默按本机这个数继续显示。
 * ★ 出片那一半走 r2vTokens，输入时长 = **编辑页框选的那一段**（白模输入窗口 5~30 秒：
 *   方舟 edit 自己的窗口是 4~30，但它的**产出比输入短**，而这一发的产出就是模板视频、
 *   还要能当下一发的输入 —— 见 data/templates 的 BLOCKOUT_MIN_INPUT_SEC）。
 *   它能与服务端结算对上，是因为服务端拼 Cloudinary 变换 URL 用的就是
 *   提交上来的那个 durSec（并现查裁后元数据复核）—— 两端算的是同一个数。
 *   ⚠ 别喂 `<video>` 在本机现探的时长：那是客户端报的数，服务端一律不认。
 * ★ **不过 clampDuration**（同 r2vTokens）：那个 10s 上限是纯 t2v 档位的产品约束，
 *   白模化这一段是 [5,30]，夹到 10 就是"报 10s 的价、按 30s 实收"。
 * ★ 返回 **null = 这一发报不出价**（语义与 r2vTokens 完全一致：闸没开 / 这一档没有 r2v 单价），
 *   不是免费、也**不许退化成"只报视觉那一半"** —— 那会让用户以为白模化只花几千 token。
 *   人话侧走 blockoutizeIssue，两者必须同时用：报不出价就既不报也不开炼。
 */
export function blockoutizeCost(frameCount: number, durSec: number): number | null {
  const video = r2vTokens(durSec, blockoutTier()?.id);
  return video === null ? null : blockoutTemplateCost(frameCount) + video;
}

/**
 * 「白模化现在能不能**报价**」的人话版（null = 能）。
 *
 * ★ 不是第二处判断：走哪一档由 blockoutTier 说，能不能卖由 r2vPriceIssue 说，这里只是把
 *   两者接起来 —— 因为白模链路上**用户没有档位选择器**，直接 `r2vPriceIssue(undefined)`
 *   会退到标准档，吐出一句「「标准」这一档暂未开放…」，而用户根本没选过标准档。
 * ★ 与 blockoutizeCost 一一对应：那边返回 null 时，这边必然有一句话可说（反之亦然）。
 *
 * ★★ **它只是门禁的一半**（目录侧：闸门 + 价目），认不出"当前用户的套餐" —— 而白模化
 *   钉死走的 ultra 是会员档（freeOk 为假：2026-10-07 起免费用户只能用「极速」「草稿」），没付过钱的用户在服务端是 403 PLAN_REQUIRED。要问「这个账号现在
 *   能不能开炼」，一律问 **`data/templates.blockoutizeBlockReason()`**（那边把本函数与
 *   `account.tierBlockReason` 接成一句话，是全 app 唯一的那处）。
 *   为什么这里不自己补上套餐那一半：本模块是**纯目录**，account 已经 import 它，
 *   反向 import 会成环（Vite 下拿到半初始化的模块，CLAUDE.md 那条 store 环坑同理）。
 * ★ 编辑页（BlockoutTrimmer）只问本函数是**有意的**：套餐那道门在更早的入口
 *   （VideoTemplateExtractor 的白模开关）已经拦过，走到编辑页的人必然过了它 ——
 *   在这里把同一句话再说一遍，用户只会以为出了两个错。
 */
export function blockoutizeIssue(): string | null {
  const tier = blockoutTier();
  if (tier === null) return t`白模化暂未开放（当前没有任何档位开着白模出片），等开放后再来`;
  return r2vPriceIssue(tier.id);
}

/**
 * 「炼一段」的**整笔**报价：出片 + 这一段还得现补几张设定帧。
 *
 * ★ 补帧条件与 studio/segmentGen 的第③步同源（缺首帧就画首帧；flf 档缺尾帧再画一张），
 *   这里只是把它折成钱。此前界面只报 segTokens，而简约模式恰恰是**两张帧都没有**的
 *   那条路 —— 用户看到 108k，实际还烧掉两张 Seedream（26.6k），差价没人说过一个字。
 * ★ 走**参考生视频**（refMode）时一张设定帧都不画，省下的钱必须从报价里也去掉：
 *   界面报一个用不上的价，和报低了一样是骗人。
 * ★ 走**白模模板**（refVideo）时同样一张帧不画（画面整个来自参考视频），且 token
 *   换 r2v 公式 —— 时长跟模板走，入参的 durationSec 在这条路上**不参与计算**
 *   （白模节点没有时长选择器，也不过 clampDuration，理由见 r2vTokens）。
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
  /** 这一段不补画帧（data/drawPlan 的规矩 ①：参考图直出等模式的段）。必填：漏传就按补画报价，与出片两把尺 */
  noDraw: boolean;
  /** 这一段的剧情分了两个以上镜头（data/drawPlan 的规矩 ②：不画结束画面）。必填，理由同上 */
  multiShot: boolean;
  /** 这一段送进请求体的画幅（"9:16" / "16:9"）：480p 的每秒数按画幅不同（segTokens 的 ★）。缺省按最贵的一格报 */
  ratio?: string;
  /**
   * 这一段先出**样片**（电影级的 draft 模式，2026-10-07）：视频那一半按 2.5 的 480p × 电影级系数报（draftStepTokens），
   * 不按这一档的 720p。补画的帧照常算（样片的槽位与普通出片一样摆）。
   * **必填**（判定只在 flowStore.nodeDraftOn）：可选的话漏传就按 720p 报价、按 480p 出片 —— 报价与实扣两把尺，零症状。
   */
  draft: boolean;
  /**
   * 这一段走**白模模板**（r2v）。inputSec = 模板参考视频的时长 —— **只准从
   * `template.refVideo.durationSec`（服务端登记值镜像）读**，别拿本机 `<video>` 现探：
   * server 按同一份登记值结算，两端要算同一个数（见 r2vTokens 的 ★）。
   */
  refVideo?: { inputSec: number };
}): number {
  if (o.refVideo) {
    const quoted = r2vTokens(o.refVideo.inputSec, o.tierId);
    if (quoted !== null) return quoted;
    // ★ 走到这里 = 调用方没先问 r2vPriceIssue 就带着 refVideo 来报价（那是它的失职，
    //   但这里不能抛 —— 本函数在 render 里被调，抛 = 白屏，同 IMAGE_TOKENS 那段的理由）；
    //   也不能按经典路报（那是另一件商品的价）。照 IMAGE_TOKENS 的处置：按表里最贵的
    //   r2v 系数报 —— 报价宁可偏高也不能偏低 —— 并 console.error 点名，让改坏门禁的人
    //   当场看见。ULTRA_R2V_MULT 垫底是防"有人把表里的 r2vMult 全删光"的最后一道。
    console.error(`[economy] 档位 ${o.tierId ?? fallbackTierId()} 没有 r2v 单价却被要求按白模报价（调用方该先问 r2vPriceIssue）`);
    const worst = VIDEO_TIERS.reduce((m, t) => Math.max(m, t.r2vMult ?? 0), ULTRA_R2V_MULT);
    return r2vRawTokens(o.refVideo.inputSec, worst);
  }
  const tier = tierOf(o.tierId);
  // ★ 补画几张只问 data/drawPlan 一处（出片 segmentGen 与参考清单读的是同一个函数）：
  //   按发计价档（真人档）一张不画（首帧就是真人卡的照片本身）、参考生视频一张不画、不补画的段缺的那张不补、
  //   多镜头的段不画结束画面 —— 把不会发生的图钱算进去，就是报价 ≠ 实扣的方向错。
  const draws = drawCount({
    tier: { flf: tier.flf, flat: !!tier.flatCost },
    hasFirstFrame: o.hasFirstFrame,
    hasLastFrame: o.hasLastFrame,
    refMode: o.refMode,
    noDraw: o.noDraw,
    multiShot: o.multiShot,
  });
  return (o.draft ? draftStepTokens(o.durationSec, o.ratio) : segTokens(o.durationSec, o.tierId, o.ratio)) + draws * IMAGE_TOKENS;
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
 * 「按一套提示词方案炼形象图」要多少 token —— **唯一实现**（报价与实扣共用）。
 *
 * ★★ 图位数**随方案变**，所以这个数不能写死成 `2 * ONE_IMAGE`（上一版就是写死的，
 *   那时只有"全身+特写"两张）。命名屏按钮上印的数、`canAfford` 的门、真扣钱的
 *   `spendTokens`，三处都必须读这一个函数 —— 抄第二份的下场就是本仓头号事故的形状：
 *   页面按 2 张报价、实际炼了 3 张，多出来的那张照扣钱，两个方向都不报错。
 * ★ 只数**生成型**图位（`isGenerated`）：`fromCrop` 那种直接放原片裁剪、一次模型都不调，
 *   把它算进报价就是收了不存在的钱。判据只有 promptSchemes.isGenerated 一处。
 */
export function schemeCost(slots: readonly { fromCrop?: boolean }[]): number {
  return slots.filter((s) => !s.fromCrop).length * ONE_IMAGE;
}

/**
 * 「按 N 处圈选重新生成」里那几张改图的钱 —— **唯一实现**。
 *
 * ★★ 2026-08-21 第九轮扫描确认的 high：出片管线对**每一处圈选**都会跑一次 refineFrame
 *   （`studio/segmentGen.ts` 里那个 for 循环，一次真的 Seedream 图生图），而两处报价
 *   （剪辑页的 `annCost`、工作流的 `nodeCost`）从头到尾只算视频那一半。
 *   5 秒标准档 + 5 处圈选：按钮印 108k，实扣约 175k —— 多 62%，而按钮旁边还写着
 *   「这一步才计费」。这正是本仓头号事故形状（CLAUDE.md「两仓价目表各写各的」那一条）。
 * ★ 圈选数**没有上限**，所以这笔随 N 线性涨，不是一个可以忽略的尾数。
 */
export function annRedrawCost(annCount: number): number {
  return Math.max(0, annCount) * ONE_IMAGE;
}

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

/** 成片派生卡组：看一次成片抽帧（抽不到帧就退回纯文字 chat，同价）+ 最多 cap 张卡（mintQuote）。
 *  与 extractCost 一样给的是**上限**——缺的卡种才补、重复实体会被剔掉，实收按 real.deriveDeckCards 逐笔记的 tokens，只会少不会多。
 *  ★ 这里原来还有个 `DECK_CARD_TOKENS = CARD_META_TOKENS + IMAGE_TOKENS`（"一次文案 + 一次卡面"）—— 那趟文案并不存在，删了。 */
export function deckCardsCost(cap: CardMintCap = DECK_MAX_CARDS): number {
  return mintQuote(1, cap);
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
