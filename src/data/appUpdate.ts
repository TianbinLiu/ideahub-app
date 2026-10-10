// 侧载渠道的应用内更新：查有没有新版 → 下载 APK → 拉起系统安装器。
//
// ★★ 这条路**只在自己发出去的包里存在**。Google Play 禁止应用自己装 APK，所以
//   原生实现被隔离在 android 的 sideload 渠道里，上架包拿到的是一个会 reject 的空壳
//   （见 android/app/build.gradle 的 productFlavors）。这里的 `selfUpdate` 就是那个开关：
//   为 false 时整套 UI 一个像素都不该出现 —— 摆一个点了没反应的"检查更新"比没有更糟。
//
// ★ 网络请求全部走**原生**（插件里的 HttpURLConnection），不走 WebView 的 fetch：
//   WebView 的 origin 是 https://localhost，去拉 GitHub 上的清单是跨域，而那边不会
//   给我们发 CORS 头，Web 层永远只能拿到一个没有细节的 TypeError。
//
// ★ 浏览器里跑（npm run dev）没有这个插件，全部接口安静地退化成"没有更新"——
//   开发时不该被一个装不了的更新提示打断。
//
// ★★ 强制更新（2026-10-10，方舟 11-24 下线那一批）：清单里可选的 `minVersionCode` = 比它老的包必须先更新才能接着用。
//   原生那侧（AppUpdaterPlugin.check）算好 `mandatory`（有更新可装 且 手上这版 < minVersionCode），这里只认它：
//   强制的那一版**不认「以后再说」的记录**（SKIP_KEY），弹层也关不掉（components/UpdateSheet）。
//   老清单没有这一格 → mandatory 恒 false，一切照旧；Play 渠道（selfUpdate:false）根本走不到这里。
//   哪一版要设 minVersionCode 由发版时显式指定（scripts/release.mjs 的 --min-version-code），见 docs/app-distribution.md。
import { registerPlugin } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";
import { SITE_BASE } from "../utils/shareLink";

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersionCode: number;
  versionCode: number;
  versionName: string;
  apkUrl: string;
  sha256: string;
  sizeBytes: number;
  notes: string;
  /** 清单上的最低可用版本（没写 = 0），原生回的原值 —— 只留作排查；判强制只看 mandatory（isMandatory） */
  minVersionCode?: number;
  /** 必须更新才能接着用（原生算好的：有更新可装 且 当前版本 < minVersionCode）。缺省 = 不强制 */
  mandatory?: boolean;
}

/**
 * 官网下载页 —— 应用内更新在**这台手机上**走不通时（本 App 没有「安装未知应用」的授权、原生下载器出毛病）的另一条路：
 * 在系统浏览器里打开，从那儿下新包装上。
 * ⚠ 它**不是**第二个下载源：那一页的下载键 302 到的是同一个镜像文件、同一个 Cloudflare 边缘 —— 镜像坏了它一起坏，那时靠 githubApkUrl。
 * ★ 用不带版本号的那一页（docs/app-distribution.md「官网下载页」）：版本、大小、sha256 全是现取清单的，发版之后不用改这里。
 */
export const DOWNLOAD_PAGE_URL = `${SITE_BASE}/download`;

/** 这一版是不是必须更新（强制的那一版：弹层关不掉、不认「以后再说」）。判据只有原生回的 mandatory 一处 */
export function isMandatory(info: UpdateInfo | null | undefined): boolean {
  return !!info && info.hasUpdate && info.mandatory === true;
}

/**
 * GitHub Release 上这一版的安装包 —— 强制更新时「镜像也下不动」的那条备用路（components/UpdateSheet）。
 *
 * ★★ 为什么要它（2026-10-10 评审抓到）：应用内更新与官网下载页（/download → /api/app/download → 302）拉的是**同一个**镜像文件、
 *   走**同一个** Cloudflare 边缘（docs/app-distribution.md「更新源现在长什么样」）。镜像上没有这个文件、边缘缓存了一份 404 /
 *   坏的副本时两条路一起坏 —— 而强制的那一版关不掉，人就被整个锁在 App 外面。GitHub Release 是发版脚本传上去的**权威**那份
 *   （镜像与它逐字节相同），换的是另一套机器。
 * ⚠ 国内网络常常打不开 GitHub（2026-08-30 那次事故正是因此才改走镜像）—— 它只是备用，界面上照实说。
 * ⚠ 地址的拼法与 scripts/release.mjs 的 `tag = v<versionName>`、`apkAsset = qimeng-<versionName>.apk` 是同一条规矩（那边改名这里一起改，
 *   那边的注释点着这里）。清单经服务端转手时 apkUrl 已被改写成镜像地址，拿不到 GitHub 那一份原值，只能照规矩拼。
 * 回 null = 版本号里有拼不进地址的字符（发版脚本只放行 [\w.-]，这里同一个口径）。
 */
export function githubApkUrl(info: UpdateInfo): string | null {
  const v = info.versionName;
  if (!v || !/^[\w.-]+$/.test(v)) return null;
  return `https://github.com/TianbinLiu/ideahub-app/releases/download/v${v}/qimeng-${v}.apk`;
}

/**
 * 强制更新那张弹层只挂在**一处**：App.tsx 的 UpdateGate（路由之外，安卓返回键退不掉它）。
 * ★ 为什么要这一对（2026-10-10 评审抓到）：设置页的「检查更新」原来在设置页**里面**自己画一张 UpdateSheet —— 查到的是强制的那一版时，
 *   安卓返回键（WebView 后退）把设置页连同那张「关不掉」的弹层一起卸掉，人照常用一个已经停止支持的版本。
 *   开机那一次检查又是静默的（没网就什么都不说、之后不再查），所以设置页恰恰常是强制更新**第一次**露面的地方。
 *   现在任何地方查到强制的那一版都交给这里（raiseForcedUpdate），由 UpdateGate 画。普通更新照旧各画各的（关得掉，无所谓挂在哪）。
 */
let forcedInfo: UpdateInfo | null = null;
const forcedListeners = new Set<() => void>();

/** 交一份强制更新给 App 根上那张弹层画（不是强制的直接忽略） */
export function raiseForcedUpdate(info: UpdateInfo): void {
  if (!isMandatory(info)) return;
  forcedInfo = info;
  forcedListeners.forEach((fn) => fn());
}

/** 现在挂着的强制更新（没有 = null）。给 useSyncExternalStore 用 */
export function forcedUpdate(): UpdateInfo | null {
  return forcedInfo;
}

export function subscribeForcedUpdate(fn: () => void): () => void {
  forcedListeners.add(fn);
  return () => {
    forcedListeners.delete(fn);
  };
}

interface AppUpdaterPlugin {
  current(): Promise<{ versionCode: number; versionName: string; selfUpdate: boolean; canInstall: boolean }>;
  check(opts: { manifestUrl: string }): Promise<UpdateInfo>;
  openInstallPermission(): Promise<void>;
  downloadAndInstall(opts: { url: string; sha256?: string }): Promise<{ installerLaunched: boolean }>;
  addListener(
    event: "downloadProgress",
    fn: (e: { received: number; total: number }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const AppUpdater = registerPlugin<AppUpdaterPlugin>("AppUpdater");

/** 版本清单地址。配在 .env.production（公开信息，随包发布）。
 *  空 = 整个功能关掉 —— 浏览器开发、以及还没搭好分发的阶段都走这条 */
const MANIFEST_URL = (import.meta.env.VITE_UPDATE_MANIFEST as string | undefined)?.trim() ?? "";

/** 用户点过「以后再说」的版本号。同一个版本不再打扰，出了更新的才再提 */
const SKIP_KEY = "ideahub-app.update.skipped";

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** 这个包支不支持应用内更新（侧载渠道 + 配了清单地址）。UI 的总开关 */
export async function selfUpdateSupported(): Promise<boolean> {
  if (!isNative() || !MANIFEST_URL) return false;
  try {
    return (await AppUpdater.current()).selfUpdate === true;
  } catch {
    return false; // 老包里没有这个插件（第一版发出去的就没有），安静地当不支持
  }
}

export async function currentVersion(): Promise<{ versionCode: number; versionName: string } | null> {
  if (!isNative()) return null;
  try {
    const c = await AppUpdater.current();
    return { versionCode: c.versionCode, versionName: c.versionName };
  } catch {
    return null;
  }
}

/** 这台机器允许安装未知来源的应用了吗 */
export async function canInstall(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    return (await AppUpdater.current()).canInstall === true;
  } catch {
    return false;
  }
}

export async function openInstallPermission(): Promise<void> {
  await AppUpdater.openInstallPermission();
}

/**
 * 查有没有新版。
 * @param silent 自动检查（启动时）传 true：查不到就当没有，别弹错误。
 *               手动点「检查更新」传 false：查不到要说出来，否则用户分不清
 *               "已经是最新"和"根本没查成"。
 */
export async function checkUpdate(silent = true): Promise<UpdateInfo | null> {
  if (!(await selfUpdateSupported())) return null;
  try {
    const info = await AppUpdater.check({ manifestUrl: MANIFEST_URL });
    if (!info.hasUpdate || !info.apkUrl) return null;
    return info;
  } catch (e) {
    if (silent) return null;
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** 启动时那次自动检查：已经被用户跳过的版本不再冒头 —— **强制的那一版除外**（跳过的记录对它不算数） */
export async function checkUpdateForPrompt(): Promise<UpdateInfo | null> {
  const info = await checkUpdate(true);
  if (!info) return null;
  if (isMandatory(info)) return info;
  try {
    if (localStorage.getItem(SKIP_KEY) === String(info.versionCode)) return null;
  } catch {
    /* 读不到就当没跳过，照常提示 */
  }
  return info;
}

export function skipVersion(versionCode: number): void {
  // 强制的那一版界面上根本没有「以后再说」；这里不另设闸 —— 真被记下了，checkUpdateForPrompt 也不认它
  try {
    localStorage.setItem(SKIP_KEY, String(versionCode));
  } catch {
    /* 存不下就只是这一次会话不再提，无所谓 */
  }
}

/** 下载并拉起安装。onProgress 收到的是已下载/总字节 */
export async function downloadAndInstall(
  info: UpdateInfo,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  const sub = await AppUpdater.addListener("downloadProgress", (e) => onProgress(e.received, e.total));
  try {
    await AppUpdater.downloadAndInstall({ url: info.apkUrl, sha256: info.sha256 || undefined });
  } finally {
    await sub.remove();
  }
}

export function fmtSize(bytes: number): string {
  if (!bytes) return "";
  return `${(bytes / 1048576).toFixed(1)}MB`;
}
