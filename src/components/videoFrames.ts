// 本地视频抽帧：卡片提取与模板提取共用。
//
// 抽帧在浏览器做（canvas 定点截图），只把几张缩小后的帧交给视觉模型——传整段视频
// 既慢又贵，还得有后端转码。这份逻辑原本长在 VideoCardExtractor 里，做「提取模板」
// 时第二次需要它，于是提出来共用（两处各抄一份必然会分叉）。

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
      const t = setTimeout(() => reject(new Error("视频加载超时（应用切到后台会暂停解码，回到前台再试）")), 15_000);
      const ok = () => {
        clearTimeout(t);
        resolve();
      };
      v.onloadedmetadata = ok;
      v.onerror = () => {
        clearTimeout(t);
        reject(new Error("这个视频浏览器解不开（换 mp4/webm 试试）"));
      };
    });
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
    const c = document.createElement("canvas");
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const t = dur * (0.05 + (0.9 * i) / Math.max(1, n - 1));
      v.currentTime = Math.min(dur - 0.01, t);
      await new Promise<void>((resolve, reject) => {
        v.onseeked = () => resolve();
        v.onerror = () => reject(new Error("视频抽帧失败"));
        setTimeout(() => reject(new Error("视频抽帧超时")), 15_000);
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
