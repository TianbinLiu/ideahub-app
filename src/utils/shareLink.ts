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
