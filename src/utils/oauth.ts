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
// ★ Capacitor 插件用**动态 import**取：web 构建里这两个包只有 web 垫片，
//   用不到时不该把它们拖进主包。
import { oauthStartUrl } from "../api/auth";

/** App 深链的 scheme。改这里要同步改 android 的 intent-filter 与服务端的 APP_OAUTH_SCHEME */
export const APP_SCHEME = "ideahub";
/** 回程落地路由（web 用 hash 路由，所以是 /#/oauth/callback） */
export const WEB_CALLBACK_PATH = "/oauth/callback";

export interface OauthResult {
  token?: string;
  error?: string;
}

/** 跑在 Capacitor 原生壳里（web 版没有这个全局） */
export function isNative(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

// ── 回程结果的单一出口 ────────────────────────────────────────────────
// 结果只有一个消费者（App 里的 OauthDeepLinkBridge），但深链可能比它挂载得更早
// （冷启动时 getLaunchUrl 立刻就有值），所以先存着，等它订阅时再交付。
let pending: OauthResult | null = null;
let sink: ((r: OauthResult) => void) | null = null;

function deliver(r: OauthResult) {
  if (sink) sink(r);
  else pending = r;
}

/** 订阅回程结果；订阅的瞬间会把在它之前到达的那一条补交付 */
export function onOauthResult(cb: (r: OauthResult) => void): () => void {
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
function parseDeepLink(url: string): OauthResult | null {
  if (!url?.startsWith(`${APP_SCHEME}://`)) return null;
  const qs = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const p = new URLSearchParams(qs);
  const token = p.get("token");
  if (token) return { token };
  return { error: p.get("message") || p.get("error") || "第三方登录未完成" };
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
    await App.addListener("appUrlOpen", (e: { url: string }) => {
      const r = parseDeepLink(e.url);
      if (!r) return;
      void closeBrowser();
      deliver(r);
    });
    // 冷启动：事件可能在 JS 起来之前就派发过了，这一条才是那种情况的唯一来源
    const launch = await App.getLaunchUrl();
    const r = launch?.url ? parseDeepLink(launch.url) : null;
    if (r) deliver(r);
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
  if (!isNative()) {
    window.location.href = oauthStartUrl(provider, WEB_CALLBACK_PATH);
    return;
  }
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: oauthStartUrl(provider, `${APP_SCHEME}://oauth`), presentationStyle: "popover" });
  } catch (e) {
    // 插件没装（或被裁掉）时不要静默失败：用户点了按钮必须得到回音
    onError(`这台设备上还没接第三方登录（${e instanceof Error ? e.message : String(e)}）——先用邮箱或手机号登录`);
  }
}
