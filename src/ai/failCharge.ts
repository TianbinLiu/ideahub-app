// 「这一次 AI 调用失败了，钱花没花」—— 判定与钱上的那句话，**全仓一处**（铁律六）。
//
// ★★ 为什么要有它（2026-09-17，多语言 T4 评审抓到）：远端模式（正式包）下 data/account.spendTokens 是空操作，
//   钱由服务端在 /api/ark 上**先扣、再转发**，只有上游回非 2xx 才退（docs/api-contract.md「扣费」一节，
//   实现在 server services/arkGateway.chargedArkCall）。于是「失败 = 没扣钱」这句话只在一部分失败上成立：
//     ① 没等到回包（ArkNoReply：断网、客户端先超时）—— 服务端那一发照样跑完、按 2xx 计费，钱**可能**已经扣了；
//     ② 回包是 2xx 但结果用不上（ArkBadReply：JSON 坏了 / 回包里没有图 / 图出了却取不回来）—— **已经**扣了；
//     ③ 逐格出图画到第 k 格才失败（ArkBatchPartial）—— 前 k-1 张各自按调用结算过了，与第 k 张成不成无关
//        （那几张图调用方会收下、下一次只补剩下的，见 real.PortraitViewsPartial）；
//     ④ 其余（服务端明说失败：400 敏感词 / 402 余额不足 / 403 套餐门禁 / 429 / 5xx 已退；或请求根本没到计费端点）—— 没扣；
//     ⑤ 任务**受理之后**上游明说失败（ArkTaskFailed：方舟 failed / cancelled / expired、真人档 Fail）—— 受理那一刻扣过，
//        2026-10-07 起服务端按原桶退回（主人「做生成失败返回 token」），退没退、退了多少只认服务端在回包上说的那一句
//        （ArkTaskFailed.refund）：退了 / 正在退 / 没说（老服务端不退）三档各一句话。**App 从不自己把退款加进钱包镜像**，
//        只刷一次钱包（2026-08-10 双计数那次的教训：余额只认服务端给的数）；
//     ⑥ 一段出片里视频之前已经画好的几张画面（SegmentGenFailed：补画设定帧 / 圈选改帧）—— 那几次出图各自结算过，
//        视频退了也退不到它们头上：话要分开说「视频那部分 / 出片前画好的 N 张」。失败的若是其中一张画面（failedCall: "image"），
//        就按出图说「已经画好的 N 张 + 失败的这一张」（离线时 genNode 一张都没记账，照 paidBefore 的 ★ 不说已计费）。
//   收口之前，自传图做卡片的圈选改图 / AI 生成图位 / 人物信息、提取窗的炼形象图、导演台融图五处的 catch 一律说
//   「没扣钱」，只有 CustomCardPage.recognize 一处自己抄了一遍三档 —— 而且它指给用户的「钱包流水」在 App 里并不存在。
// ★★ 一律认错误的**类型**，绝不去 message 里找字（CLAUDE.md「按错误 message 里的中文关键词判」那一格：
//   措辞一改、或界面换成英文，分流就静默全落进「没扣钱」，而被分错的恰恰是关系到钱的那一档）。
//   所以这条规则的另一半在抛错的那一侧：凡是「2xx 之后才坏」的失败都得抛 ArkBadReply（见该类的 ★），
//   抛裸 Error 就会落进 ④。
// ★ 网关层（Cloudflare / nginx）自己回的错误页落在哪一档：它们不带 CORS 头，WebView 里读不到，表现为 fetch reject
//   ⇒ ArkNoReply ⇒ 「可能已扣」。Cloudflare 125 秒读超时那一档实测过就是这样（CLAUDE.md「上传大视频失败」那一格：
//   客户端只拿到 fetch reject、没有状态码）—— 那种情况下服务端那一发确实还在跑，说「可能」正合适。
// ★ dev 的一处不等价：`npm run dev` 下 /api/ark 由 vite 代理直连方舟、不经服务端，也就没有人记账；此时若连着服务端
//   （远端模式），这里照样会说「可能已经扣了」。只影响开发机，刻意不为它加分支 —— 加了就没法在浏览器里验正式包的那几句话。
import { t } from "@lingui/core/macro";
import { billingExempt, isRemoteMode, refreshRemoteWallet } from "../data/account";
import { IMAGE_TOKENS, fmtTokens } from "../data/economy";
import { ArkBadReply, ArkBatchPartial, ArkNoReply, ArkTaskFailed, SegmentGenFailed } from "./arkClient";

/** chargeOnFail 的结论。调用方只拿它挑话 / 交给 chargeNote，别再自己 instanceof 一遍 */
export interface FailCharge {
  /**
   * 失败的形状：只看错误类型，与联网 / 离线无关。
   * 钱不经服务端结算时 tier 恒为 none，想按「没等到 / 读不出」换说法的看它（CustomCardPage.recognize 的离线那两句）。
   */
  shape: "noReply" | "badReply" | "taskFailed" | "other";
  /**
   * 失败的**这一发**钱扣没扣：maybe = 可能已经扣了（只能说「可能」）；charged = 已计费（含受理之后失败、服务端没说退的那种）；
   * none = 没扣；refunded = 受理之后上游明说失败、服务端已经退回；refunding = 服务端说会退、还没到账。
   * ⚠ 只答这一发。整次操作有没有花钱还要看 paidBefore —— 两样合起来的那句话由 chargeNote 给，别在调用点自己拼。
   */
  tier: "maybe" | "charged" | "none" | "refunded" | "refunding";
  /**
   * 同一批里在这一发之前已经各自结算的调用次数（逐格出图：已经画好、交给调用方留下的那几张；一段出片：视频之前画好的那几张画面）。
   * 不是批量调用、或管理员免扣费时恒 0。
   * ★ 离线账本：逐格出图那几张算（调用方收下时当场按张记进本机账本，real.PortraitViewsPartial 的 ★★）；
   *   出片前的画面**不算**（genNode 只在成片到手时按整段报价记一次，失败时一张都没记）。
   */
  paidBefore: number;
  /**
   * 失败的那一发是一段**视频**（ArkTaskFailed / SegmentGenFailed —— 后者 0 张画面也包）—— 话按「视频 / 出片前画好的画面」分开说，
   * paidBefore 那几张按出图单价（IMAGE_TOKENS）报，不按视频的价。
   */
  video: boolean;
  /** tier = refunded 时服务端说退了多少（服务端的数，不是本机报价）；0 = 服务端没给数 */
  refunded: number;
}

/**
 * 这次失败，钱花没花 —— **唯一判定**。
 *
 * ★ 失败的**这一发**只有「钱由服务端结算」时才分档：离线 / 演示构建的账本在本机，用到这里的调用点都是**成功之后**才 spendTokens，
 *   这一发失败就是没扣（新接进来的调用点先核对这一条：先扣后调的话，离线那一句「没扣钱」就不成立了）。
 *   管理员同理：服务端对 admin 跳过扣费（chargedArkCall 的 free），客户端判据只有 billingExempt 一处。
 * ★★ 批量里**之前画好的那几发**（paidBefore）离线时照样算已计费（2026-09-17 起）：逐格出图半途失败时调用方不再丢掉那几张图，
 *   而是收下、并在离线账本里按张记上 —— 不记的话离线用户能白拿图（主人点名）。所以离线分支带 settledBefore 回去，
 *   chargeNote 说出来的是「已经画好的 N 张已按张计费」，与本机账本真扣的那一笔一致。
 *   离线的管理员这一档不存在（role 只从服务端的账号来），不必为它分支。
 * ★ 副作用：判成 maybe 时顺手去刷一次钱包。这一档恰恰是**没有回包**的那一档，响应头带不回余额（arkFetch 的
 *   syncWalletFromHeaders 没机会跑），不刷的话「我的」页上那个数还是扣之前的 —— 而我们正要用户去看它。
 *   放在这里而不是留给调用点：漏掉它没有任何症状。charged 与 paidBefore 那几发都拿到过 2xx，余额已经随响应头同步过。
 */
export function chargeOnFail(e: unknown): FailCharge {
  // 外面那层壳：逐格出图（同一种调用）/ 一段出片（前面是画面、失败的是视频或其中一张画面）。拆一层就够 —— 两种壳不互相套
  const frames = e instanceof SegmentGenFailed;
  const failure = e instanceof ArkBatchPartial || e instanceof SegmentGenFailed ? e.failure : e;
  const settled = e instanceof ArkBatchPartial ? e.settledBefore : e instanceof SegmentGenFailed ? e.framesSettled : 0;
  // 出片之前的某一张画面失败（failedCall: "image"）不算视频：话按出图的价说「已经画好的 N 张 + 失败的这一张」（chargeNote 的非视频那一半）
  const video = (frames && e.failedCall === "video") || failure instanceof ArkTaskFailed;
  const shape: FailCharge["shape"] =
    failure instanceof ArkNoReply ? "noReply" : failure instanceof ArkBadReply ? "badReply" : failure instanceof ArkTaskFailed ? "taskFailed" : "other";
  // 离线：失败的这一发没扣；之前那几发只有逐格出图的算（见 paidBefore 的 ★）
  if (!isRemoteMode()) return { shape, tier: "none", paidBefore: frames ? 0 : settled, video, refunded: 0 };
  if (billingExempt()) return { shape, tier: "none", paidBefore: 0, video, refunded: 0 };
  if (shape === "noReply") void refreshRemoteWallet();
  if (failure instanceof ArkTaskFailed) {
    const r = failure.refund;
    if (r?.state === "refunded" || r?.state === "refunding") {
      // ★ 退款发生在服务端：钱包镜像**只**从服务端读（这一发轮询的响应头多半已经带回来了；清扫器早先退的那种没有，刷一次）
      void refreshRemoteWallet();
      return { shape, tier: r.state, paidBefore: settled, video, refunded: r.state === "refunded" ? r.tokens : 0 };
    }
    // 服务端说这一发本来就没扣（管理员免单 / 一分没扣）
    if (r?.state === "skipped") return { shape, tier: "none", paidBefore: settled, video, refunded: 0 };
    // ★ 其余一律「已计费、没退」：服务端没说（老服务端不退 / 上线之前的任务）、还没结局（真人档退款开关关着）、问不出结局。
    //   往吓人的方向说错是可以接受的那一边：钱真退了的话，余额与站内通知会说话；把没退说成退了才是不可接受的
    return { shape, tier: "charged", paidBefore: settled, video, refunded: 0 };
  }
  return {
    shape,
    tier: shape === "noReply" ? "maybe" : shape === "badReply" ? "charged" : "none",
    paidBefore: settled,
    video,
    refunded: 0,
  };
}

/** 钱上的那句话（chargeNote 给）：`line` 是一个完整的句子，自带句末标点；`brief` 是放进括号里的短语 */
export interface ChargeNote {
  line: string;
  brief: string;
}

/**
 * 把结论说成人话 —— 钱上的话**全仓只有这几句**，调用点把它当占位符嵌进自己的整句里。
 * 回 null = 这次确实一分钱没扣：调用点说它原来那句（「没扣钱」），离线 / 演示构建因此一个字都不变
 * （例外只有批量半途失败、画好的那几张被收下的时候：离线账本也记了它们，说的是「已经画好的 N 张已按张计费」）。
 *
 * @param unitTokens 这类调用**一次**的价：出图 ONE_IMAGE、对话 CHAT_TURN_TOKENS —— 与报价、余额门读同一个常量
 *
 * ★ 为什么钱上的话不让各处自己写：「指给用户去哪儿核对」是会说错的 —— recognize 原来那句写的是
 *   「以『我的』页钱包流水为准」，而 App 里**没有**流水页（api/wallet.fetchWalletLedger 零调用方，「我的」页与钱包抽屉
 *   只有余额）。指向一个不存在的出口比不说更坏（arkClient 出片超时那段注释记的是同一个坑）。现在指的是余额，它真的在那儿，
 *   而且 chargeOnFail 刚刷过。哪天真有了流水页，改这一处。
 * ★ 逐个计费的批量调用眼下只有逐格出图（real.portraitViews）一处，所以那两句按「张」说。
 *   哪天有了别的批量（按次的对话之类），按种类另写句子，别把「张」硬套过去。
 * ★ 「已经画好的」含 2xx 了却没取回来的那一张（tier = charged）：它在服务端确实画出来了，也确实结算了。
 */
export function chargeNote(c: FailCharge, unitTokens: number): ChargeNote | null {
  // 视频那一发（受理之后失败 / 出片前画过画面）另有一套话：前面那几张按出图的价、退款按服务端的数
  if (c.video) return videoChargeNote(c, unitTokens);
  const price = fmtTokens(unitTokens);
  if (c.paidBefore === 0) {
    if (c.tier === "maybe") {
      return {
        line: t({ message: `这一步可能已经扣了 ${price} token——以「我的」页的 token 余额为准。`, comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格" }),
        brief: t({ message: "可能已经扣了钱", context: "失败提示括号里说钱的短语（会被当占位符 moneyBrief 嵌进括号：英文小写开头、不带句号）" }),
      };
    }
    if (c.tier === "charged") {
      return {
        line: t({ message: `这一步已计费 ${price} token。`, comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格" }),
        brief: t({ message: "已计费", context: "失败提示括号里说钱的短语（会被当占位符 moneyBrief 嵌进括号：英文小写开头、不带句号）" }),
      };
    }
    return null;
  }
  // 确定已经结算的张数：之前画好的 + （这一张拿到过 2xx、只是结果用不上）
  const count = c.paidBefore + (c.tier === "charged" ? 1 : 0);
  const paid = fmtTokens(count * unitTokens);
  if (c.tier === "maybe") {
    return {
      line: t({
        message: `已经画好的 ${count} 张已按张计费（共 ${paid} token）；失败的这一张可能也扣了 ${price} token——以「我的」页的 token 余额为准。`,
        comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格",
      }),
      brief: t({ message: `已经画好的 ${count} 张已计费，失败的那张可能也扣了`, context: "失败提示括号里说钱的短语（会被当占位符 moneyBrief 嵌进括号：英文小写开头、不带句号）" }),
    };
  }
  return {
    line: t({ message: `已经画好的 ${count} 张已按张计费（共 ${paid} token）。`, comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格" }),
    brief: t({ message: `已经画好的 ${count} 张已计费`, context: "失败提示括号里说钱的短语（会被当占位符 moneyBrief 嵌进括号：英文小写开头、不带句号）" }),
  };
}

/**
 * 一段**视频**失败时钱上的那句话（chargeNote 的视频那一半，2026-10-07）。
 * @param videoTokens 这一段视频的报价（只在「可能扣了 / 已计费」两句里用；退款的数一律用服务端的 c.refunded，不拿本机报价顶）
 * ★ 出片之前画好的画面（c.paidBefore 张）按出图单价 IMAGE_TOKENS 报：它们各自结算过，视频退了也退不到它们头上 ——
 *   只说「已退回」会把退款说大（主人拍板的「失败返回 token」管的是视频那一发）。
 */
function videoChargeNote(c: FailCharge, videoTokens: number): ChargeNote | null {
  const count = c.paidBefore;
  const paid = fmtTokens(count * IMAGE_TOKENS);
  const price = fmtTokens(videoTokens);
  if (c.tier === "refunded") {
    const n = fmtTokens(c.refunded);
    if (count === 0) {
      return {
        line:
          c.refunded > 0
            ? t({ message: `这一发没出成，扣的 ${n} token 已经退回。`, comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格" })
            : t({ message: "这一发没出成，扣的 token 已经退回。", comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格" }),
        brief: t({ message: "已退回", context: "失败提示括号里说钱的短语（会被当占位符 moneyBrief 嵌进括号：英文小写开头、不带句号）" }),
      };
    }
    return {
      line:
        c.refunded > 0
          ? t({ message: `视频那部分扣的 ${n} token 已经退回；出片前画好的 ${count} 张画面已按张计费（共 ${paid} token）。`, comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格" })
          : t({ message: `视频那部分扣的 token 已经退回；出片前画好的 ${count} 张画面已按张计费（共 ${paid} token）。`, comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格" }),
      brief: t({ message: `视频费已退回，画面 ${count} 张已计费`, context: "失败提示括号里说钱的短语（会被当占位符 moneyBrief 嵌进括号：英文小写开头、不带句号）" }),
    };
  }
  if (c.tier === "refunding") {
    if (count === 0) {
      return {
        line: t({ message: "这一发没出成，扣的 token 会退回——到账以「我的」页的 token 余额为准。", comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格" }),
        brief: t({ message: "会退回", context: "失败提示括号里说钱的短语（会被当占位符 moneyBrief 嵌进括号：英文小写开头、不带句号）" }),
      };
    }
    return {
      line: t({
        message: `视频那部分扣的 token 会退回（到账以「我的」页的 token 余额为准）；出片前画好的 ${count} 张画面已按张计费（共 ${paid} token）。`,
        comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格",
      }),
      brief: t({ message: `视频费会退回，画面 ${count} 张已计费`, context: "失败提示括号里说钱的短语（会被当占位符 moneyBrief 嵌进括号：英文小写开头、不带句号）" }),
    };
  }
  if (c.tier === "charged" && c.shape === "taskFailed") {
    // 服务端没说退（老服务端 / 上线之前的任务 / 还没结局）：照实说「没有退回」，指去余额核对
    if (count === 0) {
      return {
        line: t({ message: "这一发扣的 token 没有退回——以「我的」页的 token 余额为准。", comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格" }),
        brief: t({ message: "没有退回", context: "失败提示括号里说钱的短语（会被当占位符 moneyBrief 嵌进括号：英文小写开头、不带句号）" }),
      };
    }
    return {
      line: t({
        message: `视频那一发扣的 token 没有退回，出片前画好的 ${count} 张画面也已按张计费（共 ${paid} token）——以「我的」页的 token 余额为准。`,
        comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格",
      }),
      brief: t({ message: `没有退回，画面 ${count} 张也已计费`, context: "失败提示括号里说钱的短语（会被当占位符 moneyBrief 嵌进括号：英文小写开头、不带句号）" }),
    };
  }
  if (c.tier === "maybe") {
    if (count === 0) {
      return {
        line: t({ message: `这一步可能已经扣了 ${price} token——以「我的」页的 token 余额为准。`, comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格" }),
        brief: t({ message: "可能已经扣了钱", context: "失败提示括号里说钱的短语（会被当占位符 moneyBrief 嵌进括号：英文小写开头、不带句号）" }),
      };
    }
    return {
      line: t({
        message: `出片前画好的 ${count} 张画面已按张计费（共 ${paid} token）；视频那一发可能也扣了 ${price} token——以「我的」页的 token 余额为准。`,
        comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格",
      }),
      brief: t({ message: `画面 ${count} 张已计费，视频可能也扣了`, context: "失败提示括号里说钱的短语（会被当占位符 moneyBrief 嵌进括号：英文小写开头、不带句号）" }),
    };
  }
  if (c.tier === "charged") {
    // 2xx 之后才坏（成功却没有地址）：视频那一发方舟照收
    if (count === 0) {
      return {
        line: t({ message: `这一步已计费 ${price} token。`, comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格" }),
        brief: t({ message: "已计费", context: "失败提示括号里说钱的短语（会被当占位符 moneyBrief 嵌进括号：英文小写开头、不带句号）" }),
      };
    }
    return {
      line: t({ message: `出片前画好的 ${count} 张画面（共 ${paid} token）与视频那一发（${price} token）都已计费。`, comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格" }),
      brief: t({ message: "画面与视频都已计费", context: "失败提示括号里说钱的短语（会被当占位符 moneyBrief 嵌进括号：英文小写开头、不带句号）" }),
    };
  }
  // none：视频那一发没扣（服务端明说拒了 / 根本没受理）
  if (count === 0) return null;
  return {
    line: t({ message: `出片前画好的 ${count} 张画面已按张计费（共 ${paid} token），视频那一发没扣钱。`, comment: "一句完整的、自带句号的话，会被当占位符（moneyLine）嵌进别的失败提示里：译文首尾不要留空格" }),
    brief: t({ message: `画面 ${count} 张已计费，视频没扣钱`, context: "失败提示括号里说钱的短语（会被当占位符 moneyBrief 嵌进括号：英文小写开头、不带句号）" }),
  };
}
