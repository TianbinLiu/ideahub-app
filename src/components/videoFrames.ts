// 本地视频抽帧：卡片提取与模板提取共用；成片里截一帧（圈选 / 「截这一帧」）也在这里（grabVideoFrame）。
//
// 抽帧在浏览器做（canvas 定点截图），只把几张缩小后的帧交给视觉模型——传整段视频
// 既慢又贵，还得有后端转码。这份逻辑原本长在 VideoCardExtractor 里，做「提取模板」
// 时第二次需要它，于是提出来共用（两处各抄一份必然会分叉）。

import { t } from "@lingui/core/macro";
import { resolveMediaUrl } from "../utils/mediaUrl";
import { loadVideoAt } from "../utils/videoFrames";
import { drawWhole } from "./FrameAnnotator";

/**
 * 从一段成片里截下某一秒的**整帧**（按原比例、长边 1280，JPEG dataURL）—— 成片回看（SegPlayer）的圈选 / 「截这一帧」
 * 与简约页（FlowPage）的圈选共用的**唯一实现**。
 *
 * ★★ 不从正在播的 <video> 上截：两处播放器都**直连**跨域地址（utils/mediaUrl 不传 forCapture 时对 http(s) 原样放行 ——
 *   直连最快、也不占服务端带宽），画布一旦被跨域视频污染，toDataURL 就抛 SecurityError。所以这一下**单独**取一份代理流
 *   （forCapture：整条 fetch 成 blob 再给 objectURL，utils/mediaUrl 的唯一实现），只在用户真点圈选 / 截帧时才走 ——
 *   别为了这个功能让每一次回看 / 播放都先把整条成片下完（2026-10-15 教材人格评审：简约页此前正是这么做的，出片完要
 *   黑着等整条文件下完才出画；这份逻辑同日从 SegPlayer.grab 抽出来，两面都调它、别再抄第二份）。
 * ★ 「等就绪 + 带超时 + 钳位 seek」只有 utils/videoFrames.loadVideoAt 一份：窗口不可见时媒体事件永不到达；duration
 *   恰好等于 at（播到 ended 时 currentTime === duration）时 seek 会落空截到首帧。
 * ★★ 画完要**验一眼真有像素**："全黑的标注底图"与"这一帧本来就很暗"在界面上长得一模一样 —— 分不出来就会让用户在黑框上
 *   圈选、圈完还要付钱重炼。取一条横带看极差，全 0 = 什么都没画上去，当失败抛（走调用方的退路）。
 * ★ atSec 记**真正截到的那一刻**，不是调用方给的 at：seek 失败 / 超时退回 0 秒时位置也跟着是 0，segmentGen 按
 *   `atSec < half` 判成首帧标注 —— 图与位置永远一致。
 */
export async function grabVideoFrame(url: string, atSec: number): Promise<{ frame: string; atSec: number }> {
  const proxied = await resolveMediaUrl(url, { forCapture: true });
  if (!proxied) throw new Error(t`取不到可截帧的地址`);
  const v = await loadVideoAt(proxied, atSec, { crossOrigin: true });
  // ★ 按原比例截**整帧**（drawWhole 的 ★★：竖屏帧 cover 进横画布只剩中间一条，圈不到上下、改回来还被重新构图）
  const c = drawWhole(v);
  if (!c) throw new Error(t`截出来是一片空白`);
  const cx = c.getContext("2d")!;
  const band = cx.getImageData(0, Math.floor(c.height / 2), c.width, 2).data;
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < band.length; i += 4) {
    if (band[i] < lo) lo = band[i];
    if (band[i] > hi) hi = band[i];
  }
  if (hi - lo === 0 && hi === 0) throw new Error(t`截出来是一片空白`);
  return { frame: c.toDataURL("image/jpeg", 0.9), atSec: v.currentTime || 0 };
}

/** 喂给视觉模型的帧宽：640px 足够认清主体，再大只是白白撑请求体 */
export const FRAME_W = 640;

/** 按时间均匀抽 n 帧（首尾各让开 5%，避免抽到黑场/片头） */
export async function sampleFrames(file: File, n: number, onProgress: (i: number) => void): Promise<string[]> {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    // 超时是必需的：页面切到后台时浏览器挂起媒体加载，loadedmetadata 永远不来。
    // 没有它这里就是个无超时的 await——调用方（提取卡片/提取模板）会永久转圈。
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(t`视频加载超时（应用切到后台会暂停解码，回到前台再试）`)), 15_000);
      const ok = () => {
        clearTimeout(timer);
        resolve();
      };
      v.onloadedmetadata = ok;
      v.onerror = () => {
        clearTimeout(timer);
        reject(new Error(t`这个视频浏览器解不开（换 mp4/webm 试试）`));
      };
    });
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
    const c = document.createElement("canvas");
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const at = dur * (0.05 + (0.9 * i) / Math.max(1, n - 1));
      v.currentTime = Math.min(dur - 0.01, at);
      await new Promise<void>((resolve, reject) => {
        v.onseeked = () => resolve();
        v.onerror = () => reject(new Error(t`视频抽帧失败`));
        setTimeout(() => reject(new Error(t`视频抽帧超时`)), 15_000);
      });
      if (!c.width) {
        c.width = FRAME_W;
        c.height = Math.round((v.videoHeight / Math.max(1, v.videoWidth)) * FRAME_W) || 360;
      }
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      out.push(c.toDataURL("image/jpeg", 0.8));
      onProgress(i + 1);
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
