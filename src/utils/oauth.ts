// 第三方登录的起跳与回程。
//
// ★ 绝不能在应用内 WebView 里跑 Google 的授权页：Google 对嵌入式 WebView 的 OAuth
//   请求直接返 `disallowed_useragent`（这是它的反钓鱼策略，不是可以绕的 bug）。
//   所以原生端必须把授权页交给**系统浏览器**，再由服务端深链回 App。
//
// 两条回程，取决于跑在哪：
//   Web / dev  —— 服务端回跳 `CLIENT_BASE_URL/oauth/callback?token=…`，
//                 本页是同一个 WebView，路由直接接住（见 pages/OauthCallbackPage）。
//   原生 App   —— 服务端回跳自定义 scheme `ideahub://oauth?token=…`，
//                 由 @capacitor/app 的 appUrlOpen 事件接住。
//
// ★ 监听器必须在【App 启动时】就挂上，不能只在 startOauth 执行期间挂——这是真机上
//   实测出来的坑：用户跳去系统浏览器期间，Android 随时可能回收 App 进程；授权完成
//   深链回来时是**冷启动**，那一刻 startOauth 早就不在栈上了，监听器也就不存在，
//   token 被静默丢弃 —— 用户回到 App 仍是未登录，且没有任何提示。
//   （实测：OnePlus 15R 上冷启动深链能把 App 拉起来，但 JS 侧收不到任何东西。）
//   冷启动还有第二个缺口：进程刚起来时事件可能已经派发过了，所以除了 addListener
//   还必须查一次 App.getLaunchUrl()。两条都接上才算闭合。
//
// ★★ 回程只认本机发起的那一条（2026-10-15 教材人格评审，owasp-security-1）：startOauth 生成一次性 state 记在本机、
//   带给服务端，服务端成功 / 失败两种回跳都原样回带；两条回程（深链 / web 回跳）都只经 acceptOauthReturn 这一道闸进来 ——
//   对不上 / 本机没发起过 / 过期的一律丢弃，连 `?error=` 的文字都不上屏。判定表在 data/oauthState（零依赖、构建里实跑），
//   契约在 docs/api-contract.md「第三方登录深链的 state 绑定」。原来任何 App / 网页投一条带 token 的深链就能把用户换成别人。
//
// ★ Capacitor 插件用**动态 import**取：web 构建里这两个包只有 web 垫片，
//   用不到时不该把它们拖进主包。
import { t } from "@lingui/core/macro";
import { oauthStartUrl } from "../api/auth";
import {
  classifyOauthFailure,
  decideOauthReturn,
  encodeStateBytes,
  STATE_TTL_MS,
  type OauthReturn,
  type RememberedState,
} from "../data/oauthState";
import { showToast } from "../data/toast";

export type { OauthReturn };

/** App 深链的 scheme。改这里要同步改 android 的 intent-filter 与服务端的 APP_OAUTH_SCHEME */
export const APP_SCHEME = "ideahub";
/** 回程落地路由（web 用 hash 路由，所以是 /#/oauth/callback） */
export const WEB_CALLBACK_PATH = "/oauth/callback";

/** 跑在 Capacitor 原生壳里（web 版没有这个全局） */
export function isNative(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

// ── 一次性 state（本机这一半；收不收的判定在 data/oauthState）────────────────
const STATE_KEY = "ideahub-app.oauth.state.v1";
/**
 * 内存里再留一份：localStorage 写不进去（隐私模式 / 配额满）时**热启动**的回程还能对上（web 的起跳是整页跳走，模块状态随之没了，
 * 那条路只能靠 localStorage —— 发版前复核更正，原来这里把 web 也算进去了）。
 * 冷启动（进程被回收后深链拉起）只能靠 localStorage 那份 —— 那正是记在盘上而不是只记内存的理由。
 */
let rememberedInMemory: RememberedState | null = null;

function newState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return encodeStateBytes(bytes);
}

function rememberState(r: RememberedState): void {
  rememberedInMemory = r;
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(r));
  } catch {
    /* 写不进去：只剩内存那份（见上）*/
  }
}

/**
 * 取出并**删掉**（一次性）：一条 state 只判一条回程 —— 判过的那条留着，就能拿来放行后面投进来的任何一条（重放）。
 * 代价是「真在系统浏览器里登着的时候，别人投一条假链接进来」会让这一次登录失败（state 被假链接消耗掉），
 * 但失败的方向是安全的：人再点一次就好，而谁都换不成别人的号。
 */
function takeRememberedState(): RememberedState | null {
  let r = rememberedInMemory;
  rememberedInMemory = null;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    localStorage.removeItem(STATE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as { state?: unknown; at?: unknown };
      if (typeof v.state === "string" && typeof v.at === "number") r = { state: v.state, at: v.at };
    }
  } catch {
    /* 读不出来就用内存那份 */
  }
  return r;
}

/**
 * 回程的**唯一**闸：深链（appUrlOpen / 冷启动 launch URL）与 web 的 /oauth/callback 都从这里过。
 * 收下 → 原样返回；丢弃 → 控制台一行（只记结论、不记 token / state 的值）+ 一句轻提示，返回 null ——
 * 调用方拿到 null 就什么都不做：不交付、不跳转、不碰 token，`error` 文本也不上屏。
 */
export function acceptOauthReturn(r: OauthReturn): { ok: true; value: OauthReturn } | { ok: false; why: string } {
  const remembered = takeRememberedState();
  const verdict = decideOauthReturn(r, remembered, Date.now());
  if (verdict === "accept") return { ok: true, value: r };
  console.warn(`[oauth] 丢弃了一条登录回程（${verdict}）：本机${remembered ? "记着" : "没记"} state，回程${r.state ? "带" : "不带"} state`);
  // ★ 过期（stale）是本机发起的、只是走太久了 —— 说成「不是本机发起」就是把人往反方向引（发版前复核抓到）；另外两档才是那句
  const why = verdict === "stale" ? t`登录链接过期了（超过 ${Math.round(STATE_TTL_MS / 60_000)} 分钟），请重新登录` : t`忽略了一条不是本机发起的登录链接`;
  showToast(why, 4000);
  return { ok: false, why };
}

// ── 回程结果的单一出口 ────────────────────────────────────────────────
// 结果只有一个消费者（App 里的 OauthDeepLinkBridge），但深链可能比它挂载得更早
// （冷启动时 getLaunchUrl 立刻就有值），所以先存着，等它订阅时再交付。
let pending: OauthReturn | null = null;
let sink: ((r: OauthReturn) => void) | null = null;

function deliver(r: OauthReturn) {
  if (sink) sink(r);
  else pending = r;
}

/** 订阅回程结果；订阅的瞬间会把在它之前到达的那一条补交付 */
export function onOauthResult(cb: (r: OauthReturn) => void): () => void {
  sink = cb;
  if (pending) {
    const p = pending;
    pending = null;
    // 异步交付：调用方通常在 effect 里订阅，同步回调会在它自己挂载完成前就跑
    setTimeout(() => cb(p), 0);
  }
  return () => {
    if (sink === cb) sink = null;
  };
}

/** 自定义 scheme 的 query 用 URL 解析不稳（各平台对 host 段的切法不一样），直接从 ? 之后取 */
function parseDeepLink(url: string): OauthReturn | null {
  if (!url?.startsWith(`${APP_SCHEME}://`)) return null;
  const qs = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const p = new URLSearchParams(qs);
  const token = p.get("token");
  const state = p.get("state");
  if (token) return { token, state };
  return { error: oauthFailText(p.get("error"), p.get("message")), state };
}

/**
 * 失败回程给人看的那句话（深链与 web 的 /oauth/callback 共用）。归类只在 data/oauthState.classifyOauthFailure，这里只按界面语言说。
 * ★ 原来是把服务端的 `message=` 原样上屏（固定英文：「google login failed」「Invalid or expired OAuth state」），2026-10-19 起认得出的
 *   换成本地化的话，认不出的照旧原样（服务端 catch 里回的 e.message 可能是一句有用的中文）。
 */
export function oauthFailText(error: string | null | undefined, message: string | null | undefined): string {
  const f = classifyOauthFailure(error, message);
  const who = "provider" in f && f.provider === "google" ? "Google" : "provider" in f && f.provider === "github" ? "GitHub" : "";
  switch (f.kind) {
    case "notCompleted":
      // ★ 不点名是谁的错（2026-10-19 复核抓到）：服务端对我们自己的意外错误（TypeError 之类，console.error 那一支）回的也是
      //   「<provider> login failed」—— 原来写「或者 Google 那边出了错」，会把我们的错算到 Google 头上。中性说「登录过程出了错」
      return who
        ? t`${who} 登录没有完成：授权被取消了，或者登录过程出了错。可以再试一次。`
        : t`第三方登录没有完成：授权被取消了，或者登录过程出了错。可以再试一次。`;
    case "stateExpired":
      // 服务端那份签名 state 10 分钟过期：人在 Google / GitHub 的授权页上耽搁太久（与本机 15 分钟那条「登录链接过期了」是两道闸）
      return t`在授权页上停留太久，这次登录已经失效了，请重新登录。`;
    case "emailTaken":
      return who
        ? t`这个 ${who} 账号的邮箱已经用别的方式注册过了：请用当初注册时的方式登录。`
        : t`这个邮箱已经用别的方式注册过了：请用当初注册时的方式登录。`;
    case "noEmail":
      return who ? t`${who} 没有提供邮箱地址，没法用它登录。` : t`对方没有提供邮箱地址，没法用它登录。`;
    case "noProfile":
      return who ? t`没拿到 ${who} 的账号信息，请再试一次。` : t`没拿到第三方账号的信息，请再试一次。`;
    case "callbackError":
      return who ? t`${who} 登录时出了错，请再试一次。` : t`第三方登录时出了错，请再试一次。`;
    case "raw":
      return f.text;
    default:
      return t`第三方登录未完成`;
  }
}

// ── 同一条深链只收一次 ───────────────────────────────────────────────
// ★ 为什么（state 做成一次性之后才成了问题）：launch URL 在进程活着的期间一直是那一条 —— WebView 重载（开机失败屏的「重新加载」）、
//   系统改语言重建 Activity（memory：android-locale-change-relaunches-activity）之后 initOauthDeepLink 再跑一遍，
//   getLaunchUrl 把登过的那条又给一次。原来只是多登一次同一个 token（无害）；现在 state 已经用掉，第二次会被判成
//   「不是本机发起的」弹一句提示 —— 对着一次成功的登录说假话。所以收过的记下来：内存记原文（两条来路几乎同拍），
//   localStorage 只记 SHA-256 摘要 —— 深链里带着 token，原文不落盘。
const HANDLED_KEY = "ideahub-app.oauth.handled.v1";
let handledUrl: string | null = null;

async function digestOf(url: string): Promise<string | null> {
  try {
    return encodeStateBytes(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url))));
  } catch {
    return null; // 没有 subtle（非安全上下文）：只剩内存那道去重
  }
}

/** 两条来路（appUrlOpen / 冷启动的 launch URL）共用的入口：认深链 → 去重 → 过 state 闸 → 交付 */
async function onDeepLink(url: string): Promise<void> {
  const r = parseDeepLink(url);
  if (!r) return;
  if (url === handledUrl) return;
  handledUrl = url; // 先占住再去算摘要：两条来路几乎同拍
  const d = await digestOf(url);
  try {
    if (d && localStorage.getItem(HANDLED_KEY) === d) return;
    // ★ 只记带 token 的那条（发版前复核抓到）：失败回跳在老服务端上不带 state、字节一样（同一种 error + message），记下来的话第二次
    //   同样的失败就一声不响 —— 原来至少 /login?err= 还会说；而失败回跳被重放也没有危害，不用防
    if (d && r.token) localStorage.setItem(HANDLED_KEY, d);
  } catch {
    /* 读不到 / 存不下：只剩内存那道去重，重载后同一条可能再来一次（最坏是一句提示） */
  }
  void closeBrowser();
  const res = acceptOauthReturn(r);
  if (res.ok) deliver(res.value);
}

let inited = false;

/**
 * App 启动时调一次。挂上常驻的深链监听，并补查一次冷启动的 launch URL。
 * 非原生环境下是空操作（web 的回程走 /oauth/callback 路由）。
 */
export async function initOauthDeepLink(): Promise<void> {
  if (inited || !isNative()) return;
  inited = true;
  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("appUrlOpen", (e: { url: string }) => void onDeepLink(e.url));
    // 冷启动：事件可能在 JS 起来之前就派发过了，这一条才是那种情况的唯一来源
    const launch = await App.getLaunchUrl();
    if (launch?.url) await onDeepLink(launch.url);
  } catch (e) {
    console.warn("[oauth] 深链监听挂载失败:", e);
  }
}

async function closeBrowser(): Promise<void> {
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
  } catch {
    /* 浏览器可能已经被用户自己关了，关不上不影响拿 token */
  }
}

/**
 * 起跳。原生端交给系统浏览器；web 端整页跳走。
 * ★ 只报「起跳本身失败」；成功的回程一律走 onOauthResult，不从这里回调——
 *   否则冷启动那条路径就没人管了（见文件头的说明）。
 */
export async function startOauth(provider: string, onError: (msg: string) => void): Promise<void> {
  // 一次性 state：先记在本机、再起跳 —— 回程只认记着的这一条（判定表 data/oauthState；老服务端忽略这个参数、回跳不回带，暂且放行）
  const state = newState();
  rememberState({ state, at: Date.now() });
  if (!isNative()) {
    window.location.href = oauthStartUrl(provider, WEB_CALLBACK_PATH, state);
    return;
  }
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: oauthStartUrl(provider, `${APP_SCHEME}://oauth`, state), presentationStyle: "popover" });
  } catch (e) {
    // 插件没装（或被裁掉）时不要静默失败：用户点了按钮必须得到回音
    const why = e instanceof Error ? e.message : String(e);
    onError(t`这台设备上还没接第三方登录（${why}）——先用邮箱或手机号登录`);
  }
}
