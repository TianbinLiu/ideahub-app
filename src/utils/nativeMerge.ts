// 成片合并的 Web 侧入口：把活交给**原生**（Android Media3 Transformer，见
// android/.../VideoMergePlugin.java 头部的 ★★），自己只负责把参数翻过去、把产物接回来。
//
// ★★ 2026-09-07 主人点名「以系统硬件编解码器为剪辑功能的核心」，canvas 录屏那条整条撤了。
//   撤掉的理由不是"不好看"，是四条硬伤：耗时恒等于片长、二次编码、机器一忙就掉帧
//   （本机实测比墙钟短 26%）、产出的 WebM 没有 Duration 元素（全 app 问不出时长）。
// ★ 段落一律传 **https**：它们在出片那一刻就转存到图床了，让 Media3 自己流式取 ——
//   先整条下载到手机再喂进去等于把几十兆搬两趟，那正是老路最慢的一段。
// ★ 只有**本地挑的 BGM** 要落盘（它在 Web 侧是 blob:，原生打不开），走 stageFile。
// ★ 浏览器里没有这个插件：`mergeSupported()` 为假时剪辑页要把话说明白，别摆一颗点不动的键。
import { Capacitor, registerPlugin } from "@capacitor/core";

export interface MergeClip {
  /** 公网地址（段落转存后的图床地址）。blob:/data: 传进来原生打不开 */
  url: string;
  startSec?: number;
  endSec?: number;
}

/** 显式标识怎么盖。**政策在 Web 侧定**，原生只认这三个模式（见插件头部的 ★） */
export type BadgeMode = "none" | "head" | "always";

export interface MergeOpts {
  clips: MergeClip[];
  width: number;
  height: number;
  audio?: { url: string; volume: number };
  badge?: { text: string; mode: BadgeMode; headSec?: number };
}

export interface MergeResult {
  /** 本机文件路径 */
  path: string;
  /** file:// 地址 */
  uri: string;
  sizeBytes: number;
  /** 成片**实测**时长（Transformer 报的，不是我们申报的） */
  durationSec: number;
  width: number;
  height: number;
  /**
   * 成片里到底有没有音轨（合成器报的）。
   * ★ 为什么要把它带回来：「没有声音」在界面上不构成任何报错 —— 音轨本来就是可选的，
   *   所以一条哑片会一路走到发布页、发出去，全程零提示。白模复刻段的成片文件天生无声
   *   （generate_audio:false 是版权拦截换来的），声音全靠剪辑页那条音轨预置混进去，
   *   而那条预置有过丢失的前科（见 data/cutSession 的 audioHint）。
   * ★ 老插件（2026-09-07 之前那版）不发这一位 ⇒ `undefined`。调用方**判否定**：
   *   只有明确为 false 才说"这条没声音"，undefined 当"不知道"、什么都不说。
   */
  hasAudio?: boolean;
}

interface VideoMergeApi {
  available(): Promise<{ available: boolean; engine: string }>;
  merge(opts: MergeOpts): Promise<MergeResult>;
  cancel(): Promise<void>;
  stageFile(o: { base64: string; ext: string }): Promise<{ uri: string; path: string }>;
  addListener(
    event: "mergeProgress",
    fn: (e: { percent: number }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const VideoMerge = registerPlugin<VideoMergeApi>("VideoMerge");

/** 这台设备能不能做合并。浏览器（npm run dev）恒为假 */
export function mergeSupported(): boolean {
  return Capacitor.isNativePlatform();
}

/** 合并做不了时给用户的那句话。★ 一处实现：剪辑页的禁用提示与真跑时的整句拒读同一句 */
export const MERGE_UNSUPPORTED =
  "这台设备上合成用不了——合成走的是系统硬件编解码器，只有安装包里有。请在手机 App 里完成合成。";

/**
 * blob:/data: 的本地音频 → 原生能打开的 file:// 地址。已经是 http(s)/file 的原样返回。
 * ★ 只给 BGM 用（几 MB 级）。段落视频**绝不**走这条：几十兆过 base64 桥又慢又占内存。
 */
export async function stageLocalAudio(url: string): Promise<string> {
  if (/^(https?|file):/i.test(url)) return url;
  const blob = await (await fetch(url)).blob();
  const b64 = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const i = s.indexOf(",");
      res(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => rej(new Error("音频读不出来"));
    r.readAsDataURL(blob);
  });
  const ext = (blob.type.split("/")[1] || "mp3").split(";")[0];
  const { uri } = await VideoMerge.stageFile({ base64: b64, ext });
  return uri;
}

/**
 * 跑一次合并。`onProgress` 收 0~1。
 * ★ 失败原样抛（原生已经给了整句人话），调用方把它摆到用户眼前（铁律八）。
 */
export async function runNativeMerge(
  opts: MergeOpts,
  onProgress?: (frac: number) => void,
): Promise<MergeResult> {
  if (!mergeSupported()) throw new Error(MERGE_UNSUPPORTED);
  const sub = onProgress
    ? await VideoMerge.addListener("mergeProgress", (e) => onProgress(Math.max(0, Math.min(1, (e.percent ?? 0) / 100))))
    : null;
  try {
    return await VideoMerge.merge(opts);
  } finally {
    await sub?.remove();
  }
}

export async function cancelNativeMerge(): Promise<void> {
  if (!mergeSupported()) return;
  try {
    await VideoMerge.cancel();
  } catch {
    /* 没在跑就当已经停了 */
  }
}

/**
 * 原生产物（file://）→ Blob。
 * ★ 为什么还要搬进 Blob：成片下游整条链（草稿正文、预览、发布上传）认的是 `idb:` 指针，
 *   教全 app 认 file:// 是另一件大得多的事。读一次几十兆换零改动，值。
 */
export async function mergedFileToBlob(uriOrPath: string): Promise<Blob> {
  const src = Capacitor.convertFileSrc(uriOrPath);
  const res = await fetch(src);
  if (!res.ok) throw new Error(`成片读不出来（${res.status}）`);
  return await res.blob();
}
