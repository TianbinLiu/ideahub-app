// 作品的站外预览链接。
//
// ★ 为什么不是 API_BASE：官网是 https://ideahubs.org（apex），API 是 api. 子域，
//   两个不是一回事。预览页在官网仓（ideahub-client 的 /v/:id），不登录能看、
//   看完引导装 App —— 分享出去的链接**只准指它**。
// ★ 此前分享键发的是 `${location.origin}/#/video/<id>`，在 APK 里 origin 是
//   https://localhost —— 发出去是死链。链接的唯一出处收口到这里（铁律六），
//   别再在任何调用点自己拼。
export const SITE_BASE = "https://ideahubs.org";

export function previewUrlOf(videoId: string): string {
  return `${SITE_BASE}/v/${encodeURIComponent(videoId)}`;
}

/**
 * 儿童安全标准页（CSAE）。
 *
 * ★★ 它长在**官网**而不是 App 里，是有意的：Google Play 核的是一个"网页资源"
 *   （打得开 / 讲的是儿童安全 / 出现商店上的应用名），Play Console 里要填的也是
 *   这个网址。正文只有官网仓 ideahub-client 的 /child-safety 一份 —— 在 App 里
 *   再抄一份中文全文，就是同一份对外承诺的第二处实现，改一处漏一处不会有任何报错，
 *   只会让审核看到的和用户读到的不是同一套标准。
 * ★ 设置页那一行走它。别在调用点自己拼 SITE_BASE。
 */
export const childSafetyUrl = () => `${SITE_BASE}/child-safety`;
