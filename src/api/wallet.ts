// AI token 钱包的服务端接口。
//
// ★ 钱包的**权威值在服务端**（server 仓 services/tokenWallet.service.js）。
//   这边这份只是镜像：负责显示余额、按下按钮之前提前拦一道。
//   以前它是权威的——记在浏览器的 IndexedDB 里，改一行前端就能把余额写成无限，
//   而每次方舟调用都是真金白银（一段视频约 1.9 元）。2026-08 搬走了。
//
// ★ 所以这里【不需要】也【不应该】做任何"扣款"逻辑：真正的扣款发生在
//   服务端 /api/ark 转发之前（条件原子扣减）。镜像只跟着走。
import { apiGet, apiPost } from "./client";

export interface WalletSnapshot {
  plan: number;
  addon: number;
  planId: string;
  /**
   * 退款欠额（正数 = 欠多少），>0 时服务端冻结一切消费（403 `WALLET_FROZEN`）。
   * ★ 老服务端没有这两个字段 ⇒ undefined ⇒ 按「没欠、没冻」处理。
   * ★★ `frozen` 是**服务端算好下发的**，客户端不要自己按 debt>0 再推一遍：
   *    这两个判据将来一旦分叉（比如加个宽限期），两边会各说各的。
   */
  debt?: number;
  frozen?: boolean;
}

interface WalletResp {
  ok: boolean;
  wallet: WalletSnapshot;
}

export function fetchWallet(): Promise<WalletResp> {
  return apiGet<WalletResp>("/api/me/wallet");
}

// ── 充值 ──────────────────────────────────────────────────
// ★ 充值**不再是"调一下就到账"**了。服务端把它改成了下单：
//     POST /api/pay/orders → 订单（created）→ 用户在渠道付款 → 渠道回调 → 服务端发币
//   我们这边能做的只有下单 + 轮询订单状态。原来那种"点一下余额就变多"的写法
//   现在会骗人——请求成功 ≠ 到账。
//
// ★ 而且**现在一个真实渠道都没接**（server 仓 services/payment/channels.js 是空的）。
//   所以下单之后没有任何东西会把它推进到 settled，除非服务端开了演示用的 mock 渠道。
//   fetchPayConfig().payable 就是问这个：false 时 UI 必须说"暂时无法付款"，
//   而不是摆一个按下去转圈的按钮。

export interface PayOrder {
  orderNo: string;
  kind: "recharge" | "plan";
  packTokens?: number;
  planId?: string;
  /** 应付金额，单位**分**（服务端一律用整数分，避免浮点对账差） */
  amountFen: number;
  currency: string;
  status: "created" | "paid" | "settled" | "closed" | "failed";
  channel: string;
  grantedTokens: number;
  paidAt: string | null;
  settledAt: string | null;
  createdAt: string;
  expiresInMin: number;
}

export interface PlayCatalogItem {
  /** ★ 必须与 Play Console 里的商品 id 逐字相同（服务端 config/play.js 的 ★★） */
  sku: string;
  kind: "recharge" | "plan";
  tokens: number;
  label: string;
}

export interface PayConfig {
  /** 已接入的渠道名；空数组 = 现在收不了钱 */
  channels: string[];
  payable: boolean;
  /** true = 当前服务端开着演示用假渠道（没有验签，仅供开发/演示） */
  mock: boolean;
  packs: { tokens: number; amountFen: number }[];
  /**
   * Google Play 结算。`enabled` = 服务端配齐了包名 + 服务账号（缺一就整条关着）。
   * ★ 价格**不在这里**：Play 按国家定价，我们只显示 Play 给的 formattedPrice。
   * ★ 老服务端没有这个字段 ⇒ undefined ⇒ 按「没有 Play」处理。
   */
  play?: { enabled: boolean; products: PlayCatalogItem[] };
}

export function fetchPayConfig(): Promise<PayConfig & { ok: boolean }> {
  return apiGet<PayConfig & { ok: boolean }>("/api/pay/config");
}

interface OrderResp {
  ok: boolean;
  order: PayOrder;
  payParams: unknown;
  payable: boolean;
}

/** 下一张直充订单。返回订单，**不代表已到账** */
export function createRechargeOrder(tokens: number): Promise<OrderResp> {
  return apiPost<OrderResp>("/api/pay/orders", { kind: "recharge", tokens });
}

/** 下一张套餐订单 */
export function createPlanOrder(planId: string): Promise<OrderResp> {
  return apiPost<OrderResp>("/api/pay/orders", { kind: "plan", planId });
}

/** 查单：付款后轮询这个等 status 变成 settled */
export function fetchOrder(orderNo: string): Promise<{ ok: boolean; order: PayOrder }> {
  return apiGet<{ ok: boolean; order: PayOrder }>(`/api/pay/orders/${encodeURIComponent(orderNo)}`);
}

/**
 * 演示用：把自己的订单标成已支付。
 * ★ 只有服务端开了 PAY_ALLOW_MOCK 才存在这个端点（payConfig.mock 为 true）。
 *   没开的时候调它会 404 —— 这是对的，不要在 UI 上给它兜底成"充值成功"。
 */
export function mockPayOrder(orderNo: string): Promise<{ ok: boolean; order: PayOrder }> {
  return apiPost<{ ok: boolean; order: PayOrder }>("/api/pay/mock/pay", { orderNo });
}

// ── Google Play 结算 ──────────────────────────────────────
// ★ 只有 play 渠道的包会用到这两条。发币在服务端：客户端拿到 purchaseToken 就交上来，
//   服务端查验（真的付了 / 属于这个账号 / 没退款）→ 发币 → 调 Play 的 consume。
//   ⚠ 客户端**不要** consume（见 utils/playBilling 的 ★★）。

/**
 * 这个账号的**混淆 id**，发起 Play 购买时要设进 `obfuscatedAccountId`。
 * ★★ 没有它，服务端「这笔购买属于谁」那道闸就是空的（它对「没带」只 warn 一句就放行）。
 *   所以拿不到就**不许发起购买** —— 客户端算不出这个值（它是 HMAC(服务端密钥, userId)）。
 * ★ 服务端没配 Play 时回 501。
 */
export function fetchPlayAccount(): Promise<{ ok: boolean; obfuscatedAccountId: string }> {
  return apiGet<{ ok: boolean; obfuscatedAccountId: string }>("/api/pay/play/account");
}

/**
 * 把 Play 的 purchaseToken 交给服务端兑币。
 *
 * ★ **幂等**：同一个 token 重复兑只发一次（服务端唯一索引兜底），所以失败可以放心重试 ——
 *   而且**必须**重试：consume 在这条链路末尾，而许可测试员的购买 3 分钟不被
 *   acknowledge 就会被 Google 自动退款（consume 蕴含 acknowledge）。
 * ★ 状态码分档（服务端 pay.routes.js）：400 参数错、409 已退款 / 不是这个账号、
 *   429 测试购买超限、501 服务端没配 Play、502 查验或其它上游问题（**这一档才值得重试**）。
 */
export function redeemPlayPurchase(
  purchaseToken: string,
): Promise<{ ok: boolean; code: string; granted: number; wallet: WalletSnapshot }> {
  return apiPost<{ ok: boolean; code: string; granted: number; wallet: WalletSnapshot }>("/api/pay/play/redeem", { purchaseToken });
}

export interface LedgerRow {
  delta: number;
  reason: string;
  balanceAfter: number | null;
  memo: string;
  createdAt: string;
}

/** 「我的 token 花哪儿了」。余额对不上时唯一能查回去的东西 */
export function fetchWalletLedger(limit = 50): Promise<{ ok: boolean; items: LedgerRow[] }> {
  return apiGet<{ ok: boolean; items: LedgerRow[] }>("/api/me/wallet/ledger", { query: { limit } });
}
