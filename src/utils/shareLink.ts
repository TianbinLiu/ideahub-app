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

/**
 * 启梦老师（官网 /tutor，tutor 仓 docs/06 §5.1，2026-09-29）：用自己的教材铸一位 AI 老师、在网页里上课。
 * 与儿童安全页同一个理由：它是**网页功能**（阅读面 + 导学漫游都在官网），App 里只放外链、不抄一份。
 * from = 引流位的名字（服务端白名单：app-settings / app-create），只用来记一行、不奖励 —— 别拿它传别的东西。
 * ⚠ 落到官网用的是那个浏览器里的登录态，不是 App 的（不做跨站登录）；没登录过会先去登录再回到 /tutor。
 */
export const tutorUrl = (from: "app-settings" | "app-create") => `${SITE_BASE}/tutor?from=${from}`;

/**
 * AI 对话安全说明页（自伤危机协议的公开说明，SB 243 §22602(b)(2) 要求公开；契约 docs/api-contract.md「客服」那一节）。
 * ★ 求助卡（`safety` 事件）里的 policyUrl 是服务端按官网写的**相对路径**（"/safety/ai-chat"）：App 里直接当 href，
 *   Capacitor 会把它当成本地路径、落进 SPA 回退页（200 + index.html），点了等于回到首页 —— 所以一律经这里拼成官网地址。
 *   服务端给了完整的 https 地址就原样用；别的（空、协议相对的 "//x"、javascript: 之类）退回契约写明的那一页。
 */
export function aiChatSafetyUrl(policyUrl?: string): string {
  const p = String(policyUrl ?? "").trim();
  if (p.startsWith("/") && !p.startsWith("//")) return `${SITE_BASE}${p}`;
  if (/^https:\/\/[^\s]+$/i.test(p)) return p;
  return `${SITE_BASE}/safety/ai-chat`;
}
