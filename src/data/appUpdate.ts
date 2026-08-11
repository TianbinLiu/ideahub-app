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
import { registerPlugin } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersionCode: number;
  versionCode: number;
  versionName: string;
  apkUrl: string;
  sha256: string;
  sizeBytes: number;
  notes: string;
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

/** 启动时那次自动检查：已经被用户跳过的版本不再冒头 */
export async function checkUpdateForPrompt(): Promise<UpdateInfo | null> {
  const info = await checkUpdate(true);
  if (!info) return null;
  try {
    if (localStorage.getItem(SKIP_KEY) === String(info.versionCode)) return null;
  } catch {
    /* 读不到就当没跳过，照常提示 */
  }
  return info;
}

export function skipVersion(versionCode: number): void {
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
