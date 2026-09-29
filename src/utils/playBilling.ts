// Google Play 结算的 Web 侧入口。原生实现在 android/app/src/play/java/.../PlayBillingPlugin.java
// （sideload 渠道是同名空壳，isAvailable() 回 false）。
//
// ★★ 这一层**只管 Play 那一半**：拿商品、拉起付款、把 purchaseToken 交出去。
//   发币与 consume 都在服务端（`POST /api/pay/play/redeem`）。端上绝不 consume ——
//   consume 蕴含 acknowledge，端上先消耗掉，服务端就查不到这笔了：钱收了、币没发。
//
// ★ 「这台设备能不能用 Play 支付」有三个条件，缺一不可，而且三个都不在同一处：
//     ① 原生壳里有这个插件（= play 渠道的包）；② 服务端配好了 Play（/api/pay/config 的
//     play.enabled）；③ Play 商店本身可用（没有 Google 服务的设备连不上，插件会报错）。
//   所以判据分两层：`playBillingSupported()` 只答 ①（同步、便宜），②③ 由调用方在
//   真正要用的时候拿到答案 —— 把三件事塞进一个布尔值，出错时分不出该怪谁。
import { registerPlugin, Capacitor } from "@capacitor/core";

export interface PlayProduct {
  sku: string;
  /** Play 里的商品名（带应用名后缀，商店自己拼的） */
  title: string;
  /** 不带应用名那一版 */
  name: string;
  /** ★ 一律**原样显示**这个字符串：币种符号、小数位、千分位都由 Play 按用户所在国给 */
  formattedPrice: string;
  currency: string;
  /** 整数微单位（1,000,000 = 1 个货币单位）。对账用，不拿来显示 */
  priceMicros: number;
}

export interface PlayPurchase {
  purchaseToken: string;
  products: string[];
  /** Play 允许一次买多份；服务端按份数乘 token（config/play.js 的 tokensOf） */
  quantity: number;
  /** PENDING = 用户选了现金等异步付款方式，钱还没到 —— 这种**不能拿去兑** */
  state: "PURCHASED" | "PENDING" | "UNSPECIFIED";
  orderId: string;
  acknowledged: boolean;
}

interface PlayBillingApi {
  isAvailable(): Promise<{ available: boolean; connected: boolean }>;
  queryProducts(o: { skus: string[] }): Promise<{ products: PlayProduct[] }>;
  purchase(o: { sku: string; obfuscatedAccountId: string }): Promise<{ purchases: PlayPurchase[]; recovered?: boolean }>;
  pendingPurchases(): Promise<{ purchases: PlayPurchase[] }>;
}

export const PlayBilling = registerPlugin<PlayBillingApi>("PlayBilling");

/**
 * 这个包里有没有 Play 结算（= 是不是 play 渠道的原生壳）。
 * ★ Web 端与侧载包一律 false：Web 上 registerPlugin 的代理调用时会抛 "not implemented"，
 *   侧载包里的空壳自己回 false。两者都不该在界面上出现「用 Google Play 支付」。
 */
export function playBillingSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("PlayBilling");
}

/** 原生那一半真的可用吗（问插件，侧载空壳回 false）。拿不到答案时按 false 处理 */
export async function playBillingAvailable(): Promise<boolean> {
  if (!playBillingSupported()) return false;
  try {
    return (await PlayBilling.isAvailable()).available;
  } catch {
    return false;
  }
}
