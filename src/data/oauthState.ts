// 第三方登录深链回程的 state 绑定 —— 「这条回程收不收」判定的**唯一实现**（2026-10-15 教材人格评审，owasp-security-1）。
//
// 纯函数、零运行时依赖（只许 `import type`）：构建里 scripts/check-oauth-state.mjs 直接 import 它跑正反例。
//
// ★★ 为什么要有它：原来 utils/oauth.parseDeepLink 对任何带 token 的 `ideahub://oauth?token=…` 直接放行、App 根上的
//   OauthDeepLinkBridge 直接 signInWithOauthToken —— 手机上任何一个 App / 网页投一条这样的深链，就能把用户换成**别人的**
//   登录态（登录 CSRF）；投一个垃圾 token 也会先盖掉 localStorage 里的 JWT、再被 401 清掉 = 静默登出。
//   微信原生那条有 loginState 校验，网页 OAuth（Google / GitHub）这条一直没有。
// ★ 做法（契约 docs/api-contract.md「第三方登录深链的 state 绑定」）：startOauth 生成 16 字节随机数（hex 32 位）当 state、
//   连同时刻记在本机，交给 `/api/auth/oauth/:provider?state=…`；服务端把它放进自己签名的 state，**成功 / 失败**两种回跳都原样
//   回带 `state=`（web 的 /oauth/callback 与 App 的 ideahub://oauth 都是）。回程只认「本机近期确实发起过、而且 state 对得上」
//   的那一条；对不上的连 `?error=` 文本都不上屏 —— 那段文字同样可以由别人投进来。
// ★ 老服务端（还没发 state 回带的那一版）回跳不带 state：**暂且放行**，但只在本机 startOauth 之后 STATE_TTL_MS 之内 ——
//   这一道就是提案里问的「本机近期确实调过 startOauth 才收深链」的闸。服务端那一版上线、老服务端没人用之后，
//   后一版 App 把「缺 state」也改成拒（见 decideOauthReturn 里标着 ⚠ 的那一支）。

/**
 * 本机记下的 state 多久之内算数。
 *
 * ★ 15 分钟：这段时间是**整个系统浏览器往返** —— 用户在 Google / GitHub 的页面上挑账号、敲密码、过两步验证、可能还要
 *   先去找验证器 App，期间 Android 随时会回收本 App 的进程（所以记在 localStorage 而不是内存）。
 *   服务端自己那份签名 state 的 TTL（10 分钟）是另一件事：那是服务端在「它把人送去提供商」到「提供商回调它」之间的绑定，
 *   过期由服务端判、以失败回跳回来 —— 而那条失败回跳也要本机这里还记着 state 才能上屏，所以这里只能比它长、不能比它短。
 */
export const STATE_TTL_MS = 15 * 60_000;

/** 服务端只收这个形状的 state（与 server 的 oauth 路由同一条正则）；hex 32 位正好落在里面 */
export const STATE_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** 随机字节 → 小写 hex（16 字节 = 32 位）。随机数本身由调用方用 crypto.getRandomValues 取：这个模块不碰 Web API */
export function encodeStateBytes(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** 一条回程（深链 / web 回跳）里我们关心的三格；state 缺省 = 服务端没回带（老服务端） */
export interface OauthReturn {
  token?: string;
  error?: string;
  state?: string | null;
}

/** 本机 startOauth 时记下的那一条 */
export interface RememberedState {
  state: string;
  /** Date.now() */
  at: number;
}

/**
 * accept = 收下；其余三种都是丢弃（分开只为日志能说清是哪一种）：
 *   unsolicited = 本机没记过 state（这台设备近期没发起过登录，链接是别人投进来的 / 上一次的已经用掉了）；
 *   stale = 记过，但超过 STATE_TTL_MS 了；
 *   mismatch = 回程带了 state、与本机记的那条对不上。
 */
export type OauthDecision = "accept" | "unsolicited" | "stale" | "mismatch";

/**
 * 这条回程收不收。判定顺序：没记过 → 过期 → 对不上 → 收下。
 *
 * @param remembered 本机记着的那一条（调用方取出来就要删掉：一条 state 只判一条回程，被判过的不能再用来放行后来者）
 * @param now Date.now()，由调用方给（纯函数，构建里的检查要能钉住 TTL 的边界）
 */
export function decideOauthReturn(ret: OauthReturn, remembered: RememberedState | null, now: number): OauthDecision {
  if (!remembered) return "unsolicited";
  // 正好到 TTL 那一毫秒还算数（边界在 check-oauth-state.mjs 里钉着）；时钟被往回拨成负数也不当过期 —— 记录仍是本机写的
  if (now - remembered.at > STATE_TTL_MS) return "stale";
  const echoed = ret.state ? ret.state : null;
  // ⚠ 没回带 = 老服务端：暂且放行（只在本机 TTL 之内）。服务端那一版普及之后，后一版 App 把这一支改成 "mismatch"
  if (echoed === null) return "accept";
  return echoed === remembered.state ? "accept" : "mismatch";
}
