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

/** 直充（服务端仍是模拟支付，见 server 仓 routes/wallet.routes.js 的警告） */
export function rechargeWallet(tokens: number): Promise<WalletResp> {
  return apiPost<WalletResp>("/api/me/wallet/recharge", { tokens });
}

export function buyWalletPlan(planId: string): Promise<WalletResp> {
  return apiPost<WalletResp>("/api/me/wallet/plan", { planId });
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
