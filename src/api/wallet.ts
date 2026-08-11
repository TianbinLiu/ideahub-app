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

export interface PayConfig {
  /** 已接入的渠道名；空数组 = 现在收不了钱 */
  channels: string[];
  payable: boolean;
  /** true = 当前服务端开着演示用假渠道（没有验签，仅供开发/演示） */
  mock: boolean;
  packs: { tokens: number; amountFen: number }[];
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
