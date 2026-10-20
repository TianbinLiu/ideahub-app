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
// ★ 失败分两段说（2026-10-19 发版后验证 oauth-4b 实测更正）：在我们的处理函数里才失败的（没拿到资料、邮箱被占用…）
//   从 server#116 起就回 App 并回带。而**取消授权、provider 报错、服务端 state 过期**这几种：
//   · 58b934c（10-16 部署的生产版）及之前 —— 一律落到官网的错误页、不回带，原生 App 的用户停在系统浏览器里，App 一个字节都收不到；
//   · 部署了 server「失败也回到 App」那一版（分支 claude/oauth-fail-back-to-app）之后 —— App 发起的回 `ideahub://oauth?error=…&state=…`，
//     带的就是本机这条 state，下表照常认作「本机发起、显示失败」；签名对不上的仍不回带、落官网。
//   所以本机真发起过的登录里，「回到 App、却没带 state」的回程只会来自 #116 之前的老服务端 —— 下面「暂且放行」那一支就是为它留的。
// ★ 老服务端（还没发 state 回带的那一版）回跳不带 state：**暂且放行**，但只在本机 startOauth 之后 STATE_TTL_MS 之内 ——
//   这一道就是提案里问的「本机近期确实调过 startOauth 才收深链」的闸。服务端那一版上线、老服务端没人用之后，
//   后一版 App 把「缺 state」也改成拒（见 decideOauthReturn 里标着 ⚠ 的那一支）。

/**
 * 本机记下的 state 多久之内算数。
 *
 * ★ 15 分钟：这段时间是**整个系统浏览器往返** —— 用户在 Google / GitHub 的页面上挑账号、敲密码、过两步验证、可能还要
 *   先去找验证器 App，期间 Android 随时会回收本 App 的进程（所以记在 localStorage 而不是内存）。
 *   服务端自己那份签名 state 的 TTL（10 分钟）是另一件事：那是服务端在「它把人送去提供商」到「提供商回调它」之间的绑定，
 *   过期由服务端判。部署了「失败也回到 App」那一版服务端之后，过期以**带 state 的**失败回跳回到 App（签名对就认，过期只决定
 *   不能登录）—— 而那条失败回跳也要本机这里还记着 state 才能上屏，所以这里只能比它长、不能比它短。
 *   ⚠ 58b934c 及之前的服务端：过期那条落在官网、根本回不到 App（10-19 实测），这条理由要等那一版服务端部署之后才真的用得上。
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

// ── 失败回程说什么（2026-10-19，docs/review-personas-2026-10.md 第九节「留着的」第三条）──────────────────────
// ★ 为什么要有它：服务端的失败回跳是 `?error=<码>&message=<固定英文>`（server oauth.routes 的 redirectFail / failBack），
//   App 原来把 message 原样上屏 —— 中文界面里冒出一句「google login failed」「Invalid or expired OAuth state」。
//   这里只做**归类**（认 error 码与几句服务端写死的英文，零依赖、构建里 check-oauth-state.mjs 实跑），话在 utils/oauth.oauthFailText
//   按界面语言说。认不出的 message **原样**交回去（服务端在 catch 里会回 e.message，那句话可能是有用的中文）。
// ★ 认的是服务端**写死**的那几句（2026-10-19 对着 server#119 的 oauth.routes.js 逐条抄的）：改了那边的措辞，这里认不出就退回原样显示，
//   不会说错 —— 判错的方向是安全的。只认开头锚定的整句，免得把 provider / 别人拼进来的长句认成我们的。
// ★ 只有能回到 App 的那几种（登录流）；绑定流（/me 上「绑定 Google」）只在官网有，那几句不在 App 里出现，不认。

/** 第三方登录的提供方（界面上要说名字的那几家）；别的（含 /oauth/fail 缺省的 "oauth"）当不知道是哪家 */
export type OauthProvider = "google" | "github";

export type OauthFailure =
  /** 「<provider> login failed」/ 只有 oauth_failed 码：取消了授权、provider 那边报错、换 token 失败 —— 服务端分不出是哪一种 */
  | { kind: "notCompleted"; provider: OauthProvider | null }
  /** 「Invalid or expired OAuth state」：在 provider 那边耽搁太久（服务端那份签名 state 10 分钟过期） */
  | { kind: "stateExpired" }
  /** oauth_conflict / 「<P> email is already linked to another IdeaHub login method…」：这个邮箱已经用别的方式注册过 */
  | { kind: "emailTaken"; provider: OauthProvider | null }
  /** 「Google email not available」：provider 没给邮箱 */
  | { kind: "noEmail"; provider: OauthProvider | null }
  /** 「Missing google profile」：provider 没交回资料 */
  | { kind: "noProfile"; provider: OauthProvider | null }
  /** 「Google callback error」：服务端处理回调时出错（没有更具体的原话） */
  | { kind: "callbackError"; provider: OauthProvider | null }
  /** 认不出的 message：原样显示 */
  | { kind: "raw"; text: string }
  /** 什么都没带 */
  | { kind: "unknown" };

function providerOf(word: string): OauthProvider | null {
  const w = word.toLowerCase();
  return w === "google" || w === "github" ? w : null;
}

const FAIL_PATTERNS: { re: RegExp; kind: "notCompleted" | "emailTaken" | "noEmail" | "noProfile" | "callbackError" }[] = [
  { re: /^(\w+) login failed$/i, kind: "notCompleted" },
  { re: /^(\w+) email is already linked to another IdeaHub login method\b/i, kind: "emailTaken" },
  { re: /^(\w+) email not available$/i, kind: "noEmail" },
  { re: /^Missing (\w+) profile$/i, kind: "noProfile" },
  { re: /^(\w+) callback error$/i, kind: "callbackError" },
];

/**
 * 一条失败回程归成哪一类。message 优先（它比码细），没有 message 才看码。
 * @param error 回程里的 `error=`（oauth_failed / oauth_conflict）
 * @param message 回程里的 `message=`
 */
export function classifyOauthFailure(error: string | null | undefined, message: string | null | undefined): OauthFailure {
  const msg = (message ?? "").trim();
  if (msg) {
    if (/^Invalid or expired OAuth state$/i.test(msg)) return { kind: "stateExpired" };
    for (const p of FAIL_PATTERNS) {
      const m = p.re.exec(msg);
      if (m) return { kind: p.kind, provider: providerOf(m[1]) };
    }
    return { kind: "raw", text: msg };
  }
  const code = (error ?? "").trim();
  if (code === "oauth_failed") return { kind: "notCompleted", provider: null };
  if (code === "oauth_conflict") return { kind: "emailTaken", provider: null };
  if (code) return { kind: "raw", text: code };
  return { kind: "unknown" };
}

/**
 * 回程（成功 / 失败）落在哪：人是从登录页 `/login?next=X` 起跳的，回来之后 X 要接着带上。
 *
 * ★ 为什么（2026-10-20，server#119 部署后复核）：原来失败一律 `navigate("/login?err=…")`，把 `next` 换没了 —— 接着改用密码登录
 *   就落到首页、不是当初要去的那一页；成功一律回 "/"。#119 之前取消授权会停在浏览器里、App 停在 `/login?next=X` 不动，
 *   这一跳只在少数失败上走到；#119 之后每一次取消都走这一跳。
 * ★ 只认站内路径（以单个 / 开头）：`next` 在登录页上本来就是原样拿去 navigate 的，这里不放宽、只收紧。
 * @param hash 现在的 `location.hash`（HashRouter：`#/login?next=%2Fme`）。不在登录页上（冷启动回来、别处起跳）回 null = 按原来的去处
 */
export function loginNextOf(hash: string): string | null {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const q = h.indexOf("?");
  if ((q < 0 ? h : h.slice(0, q)) !== "/login") return null;
  const next = new URLSearchParams(q < 0 ? "" : h.slice(q + 1)).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

/** 失败回程回登录页的地址：`err` 必带，`next` 有就接着带（见 loginNextOf） */
export function loginFailPath(err: string, next: string | null): string {
  return `/login?err=${encodeURIComponent(err)}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
}
