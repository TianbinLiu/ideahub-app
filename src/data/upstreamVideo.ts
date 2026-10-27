// 上游给的**临时**成片地址里 MiniMax H3（V2）那一半 —— 判据的唯一出处（2026-10-26 出片地区 P2b）。
//
// 纯函数、零运行时依赖：ai 层（arkClient.isArkAssetUrl：要不要转存 / 走产物代理）与 data 层（publishAssets / projects / recipe：
// 能不能当永久地址落库）都引它，别在各处再抄一份域名。
//
// ★★ 为什么要有它：H3 的成片落在 `video-product.cdn.minimax.io`，**有时效**（官方：拿到就下载或存起来；过期了再查一次会给新地址，
//   任务只在 7 天内查得到）。它与方舟的 TOS 直链是**同一类**东西（上游给的临时成片）：只认方舟的话，揣着 H3 链接的段
//   出片之后不转存、回炉工程与公开配方照样把它当永久地址存进去 —— 过期之后是死链，全程零报错。
// ★ 与服务端逐字同源：server config/minimax.MINIMAX_V2_VIDEO_HOST_FRAGMENT / isMinimaxV2VideoUrl（转存、产物代理、发布兜底都认它），
//   branchProject.schemas 的 MINIMAX_V2_TEMP_RE（回炉工程的不变量）。**只认这一个主机**，不放开 minimax.io 整个域（服务端同一个口径）。
// ⚠ 真人档（V1 海螺）的成片（public-cdn-video-data*.aliyuncs.com）不在这里：那条链接今天出片后与发布时都没有转存路，
//   服务端也没把它算进临时地址（服务端 branchProject.schemas 头上记着的缺口）—— 两边一起改，别只改一边。

/** H3 成片的主机（小写）。与服务端 MINIMAX_V2_VIDEO_HOST_FRAGMENT 同一个名字 */
export const MINIMAX_V2_VIDEO_HOST = "video-product.cdn.minimax.io";

/**
 * 这个地址是不是 MiniMax H3 的成片：https、主机**整名**等于上面那个（`…minimax.io.evil.com` 不算）、不带端口、不带账号密码。
 * 与服务端 isMinimaxV2VideoUrl 同一个口径。
 */
export function isMinimaxV2VideoUrl(url: string | undefined | null): boolean {
  if (typeof url !== "string" || !url.trim()) return false;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" && !u.port && !u.username && !u.password && u.hostname.toLowerCase() === MINIMAX_V2_VIDEO_HOST;
  } catch {
    return false;
  }
}

/**
 * 在一段 JSON 文本里认 H3 成片地址的那一段正则（回炉工程瘦身之后的不变量用，data/projects 的 LOCAL_RE 把它并进去）。
 * 与服务端 branchProject.schemas 的 MINIMAX_V2_TEMP_RE 同源：`https?://` + 主机 + 主机名到这里**结束**（`(?![\w.-])`）。
 * ★ 正则字面量，不写成字符串常量（`"\."` 在字符串里会悄悄退化，CLAUDE.md 那一格坑）；别处要拼就用 `.source`。
 */
export const MINIMAX_V2_TEMP_RE = /https?:\/\/video-product\.cdn\.minimax\.io(?![\w.-])/i;
