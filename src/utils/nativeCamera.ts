// 拍照的**唯一入口**（乙-8 b，统一执行顺序第 7 批）。页面不直接 import 相机插件（照 utils/nativeMerge 的写法）。
//
// ★★ 为什么装 @capacitor/camera，而不是只靠 <input capture>：WebView 的文件选择在 Activity 被系统回收重建之后结果直接丢
//   （Capacitor BridgeWebChromeClient 那一段），低内存机上拍一张照 = 表单连照片一起没了。插件的 getPhoto 走
//   Plugin.startActivityForResult，进程被杀后能经 App 的 appRestoredResult 回放 —— 回放与草稿落盘是 §1 第 13 批，
//   这一批先把入口收口，页面只认这个文件。
// ★ 只用 getPhoto(Camera)。它自 8.1.0 起标了 deprecated，但只有它走 startActivityForResult；takePhoto 走 ioncamera，
//   进程被杀后结果静默丢。哪天升级到去掉 getPhoto 的大版本，要照 VideoMergePlugin 自写一个本地插件。
// ★ 清单**不声明 CAMERA**：没声明时插件不弹授权、直接起系统相机（CameraPlugin.kt 在没声明 CAMERA 时恒报已授予）；
//   一旦声明，就要先弹运行时授权、拒绝即 reject。所以 checkPermissions() 在我们这儿恒为「已授予」，不能拿它当门禁。
// ★ MainActivity.onActivityResult 只在 QQLoginPlugin.handleActivityResult 回 false 时才调 super —— 改 QQ 那边时，
//   非 QQ 的 requestCode 必须回 false，否则相机结果会被吞掉（零报错，表现为「拍完没反应」）。
// ★★ 带 EXIF 的原始字节**不出这个文件**：原图带 GPS。拿到手第一件事就是按方向摆正、canvas 重编码成不带 EXIF 的 JPEG，
//   之后才进格子、进识别、进任何存储。
// ★ 插件的报错没有结构化错误码，只能按 LegacyCameraFlow 里那几个常量文案认（下面 ERRORS）。升级插件时对着源码核一遍。
import { t } from "@lingui/core/macro";
import { App } from "@capacitor/app";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";

export type CaptureResult =
  /** file 已经重编码、不含 EXIF */
  | { kind: "photo"; file: File }
  /** 用户在相机里按了返回 */
  | { kind: "cancelled" }
  | { kind: "failed"; reason: string }
  /** 回到前台 20 秒还没有结果（插件在存储满时会吞掉异常、Promise 永不结束） */
  | { kind: "lost" }
  /** 不在原生壳里（浏览器）：页面走自己的 capture input */
  | { kind: "unsupported" };

/** 拍照走不走原生相机。浏览器里为假 —— 页面退到带 capture 的 input，只为开发时走得通 */
export function nativeCameraSupported(): boolean {
  return Capacitor.isNativePlatform();
}

/** 去 EXIF 时长边的上限：50MP 原图解成位图约 190MiB，钳到 4096 把内存峰值压住，道具占长边 1/13 时裁出来仍有 ≥315px */
const STRIP_MAX_SIDE = 4096;

/**
 * 按 EXIF 方向摆正、canvas 重编码成 JPEG —— **去 EXIF 的唯一实现**。GPS、机型、时间一概不留。
 * @throws 解不开的图（HEIC 等）抛一句人话
 */
export async function stripExif(blob: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      throw new Error(t`这张照片解不开（常见于 HEIC 等手机专有格式）——换成 JPG，或截个图再传`);
    }
  }
  try {
    const k = Math.min(1, STRIP_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * k));
    const h = Math.max(1, Math.round(bitmap.height * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) throw new Error(t`这台设备处理不了照片（画布不可用）`);
    g.imageSmoothingQuality = "high";
    g.drawImage(bitmap, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t`照片重新编码失败`))), "image/jpeg", 0.92),
    );
  } finally {
    bitmap.close();
  }
}

/** 删掉插件落在本机的那张原图（原样传插件回的 path）。删不掉不抛：留给 sweepCameraLeftovers */
export async function deleteNativeCapture(path: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path });
  } catch {
    /* 见上 */
  }
}

/**
 * 清拍照残留：原生外部私有目录 Pictures/ 下的 JPEG_*。插件在**拉起相机之前**就建了临时文件，所以取消拍照也会留下
 * 0 字节的一张；IndexedDB 那份清理清单（data/cacheSweep）数不到这个目录。
 * @returns 删掉了几个。浏览器里、目录不存在（从没拍过）都回 0，永不抛
 */
export async function sweepCameraLeftovers(maxAgeMs: number): Promise<number> {
  if (!nativeCameraSupported()) return 0;
  let files: { name: string; type: string; mtime?: number }[];
  try {
    files = (await Filesystem.readdir({ path: "Pictures", directory: Directory.External })).files;
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeMs;
  let n = 0;
  for (const f of files) {
    if (f.type !== "file" || !/^JPEG_/.test(f.name) || (f.mtime ?? 0) > cutoff) continue;
    try {
      await Filesystem.deleteFile({ path: `Pictures/${f.name}`, directory: Directory.External });
      n += 1;
    } catch {
      /* 下次再清 */
    }
  }
  return n;
}

const CANCELLED = "User cancelled photos app";
const ERRORS: ReadonlyArray<readonly [string, () => string]> = [
  ["Device doesn't have a camera available", () => t`这台设备没有可用的相机`],
  ["Unable to resolve camera activity", () => t`本机没有系统相机（Android 11 起只认预装相机）——改用「上传本地图片」`],
  ["Unable to create photo on disk", () => t`相机照片存不下来（存储可能已满）`],
];

function mapError(e: unknown): CaptureResult {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  // 「User cancelled photos app」也覆盖「相机回了 RESULT_OK 却没写文件」，所以 debug 里把原文打出来，能对上 resultCode
  if (msg.includes(CANCELLED)) {
    if (import.meta.env.DEV) console.debug("[camera] cancelled:", msg);
    return { kind: "cancelled" };
  }
  for (const [needle, say] of ERRORS) if (msg.includes(needle)) return { kind: "failed", reason: say() };
  return { kind: "failed", reason: t`相机没拍成：${msg.slice(0, 80)}` };
}

/** 回到前台之后等多久还没结果就当「没接到」 */
const RESUME_WATCHDOG_MS = 20_000;
/** 模块级在途锁：LegacyCameraFlow 只有一个 imageFileSavePath 字段，两次叠着拍，前一张的路径会被后一张覆盖 */
let busy = false;

async function takeOne(): Promise<CaptureResult> {
  const photo = await Camera.getPhoto({
    source: CameraSource.Camera,
    // ★ resultType 必须传：缺了会 reject「Invalid resultType option」
    resultType: CameraResultType.Uri,
    quality: 90,
    correctOrientation: true,
    saveToGallery: false,
    // ★ 不传 width/height：插件缩放用的是不插值的 createScaledBitmap，缩放交给 stripExif
  });
  try {
    if (!photo.webPath) return { kind: "failed", reason: t`相机没有交回照片` };
    const raw = await (await fetch(photo.webPath)).blob();
    const clean = await stripExif(raw);
    return { kind: "photo", file: new File([clean], `camera-${Date.now()}.jpg`, { type: "image/jpeg" }) };
  } catch (e) {
    return { kind: "failed", reason: e instanceof Error ? e.message : String(e) };
  } finally {
    if (photo.path) void deleteNativeCapture(photo.path);
  }
}

/**
 * 拉起系统相机拍一张。浏览器里回 unsupported。
 * @param onLate 看门狗已经回了 lost 之后照片才到：交给调用方决定还要不要（那一格还在等就照样落格）
 */
export function capturePhoto(onLate?: (r: CaptureResult) => void): Promise<CaptureResult> {
  if (!nativeCameraSupported()) return Promise.resolve({ kind: "unsupported" });
  if (busy) return Promise.resolve({ kind: "failed", reason: t`上一张还没拍完` });
  busy = true;
  return new Promise<CaptureResult>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeListener: (() => void) | null = null;
    const stopWatch = () => {
      if (timer) clearTimeout(timer);
      removeListener?.();
      removeListener = null;
    };
    void App.addListener("resume", () => {
      if (timer || settled) return;
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        stopWatch();
        resolve({ kind: "lost" });
      }, RESUME_WATCHDOG_MS);
    }).then((h) => {
      if (settled) void h.remove();
      else removeListener = () => void h.remove();
    });
    const finish = (r: CaptureResult) => {
      busy = false;
      if (!settled) {
        settled = true;
        stopWatch();
        resolve(r);
      } else if (r.kind === "photo") {
        onLate?.(r);
      }
    };
    takeOne().then(finish, (e) => finish(mapError(e)));
  });
}
