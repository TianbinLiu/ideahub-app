// 从一段视频里取一帧成 dataURL（示例视频 → 首/尾/中间帧，2026-08-30 自定义车道翻页用）。
//
// ★ 媒体事件一律带超时（CLAUDE.md「在看不见的窗口里测」那条坑）：窗口在后台时浏览器
//   不解码视频，loadeddata/seeked 永远不到 —— 不带超时就是永久卡死。
// ★ 等的是「尺寸已知 + 有可画的一帧」，不是"事件来了就算好"（与 SegPlayer.openAnn 同款
//   教训：loadeddata 先到、videoWidth 仍可能是 0，画出来是全黑）。
// ★ 跨域地址必须 crossOrigin="anonymous" 且对端真发 CORS 头（Cloudinary 发），否则画布
//   被污染、toDataURL 抛 SecurityError —— 本地 objectURL 没有这个问题，调用方按来源传。
/**
 * 离屏解码一段视频并定位到某一秒，返回**已就绪、可 drawImage** 的 <video>。
 * ★ 「等就绪 + 带超时 + 钳位 seek」只有这一份：captureVideoFrame 与剪辑页的圈选截图
 *   （从截帧流上截，不从直连播放器上截——那会污染画布）都调它，别再各写一份等媒体事件的代码。
 */
export async function loadVideoAt(url: string, atSec: number, opts?: { crossOrigin?: boolean }): Promise<HTMLVideoElement> {
  const v = document.createElement("video");
  if (opts?.crossOrigin) v.crossOrigin = "anonymous";
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;
  await new Promise<void>((res, rej) => {
    const ok = () => {
      if (v.videoWidth > 0 && v.readyState >= 2) res();
    };
    v.onloadedmetadata = ok;
    v.onloadeddata = ok;
    v.oncanplay = ok;
    v.onerror = () => rej(new Error("视频读不出来"));
    window.setTimeout(() => rej(new Error("取帧超时（窗口在后台时浏览器不解码视频）")), 20_000);
  });
  // 钳位到 [0, duration-0.05]：duration 恰好等于 atSec（取尾帧）时 seek 会落空截到首帧
  const target = Math.max(0, Math.min(atSec, (v.duration || atSec) - 0.05));
  if (Math.abs(v.currentTime - target) > 0.01) {
    await new Promise<void>((res) => {
      v.onseeked = () => res();
      v.currentTime = target;
      window.setTimeout(() => res(), 8_000);
    });
  }
  return v;
}

export async function captureVideoFrame(
  url: string,
  atSec: number,
  opts?: { crossOrigin?: boolean },
): Promise<string> {
  const v = await loadVideoAt(url, atSec, opts);
  // 按视频原比例出图，长边压到 1280（设定帧的既有量级；再大只是把 IndexedDB 吃掉）
  const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
  const w = Math.max(2, Math.round(v.videoWidth * scale));
  const h = Math.max(2, Math.round(v.videoHeight * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cx = c.getContext("2d")!;
  cx.drawImage(v, 0, 0, w, h);
  // 验一眼真有像素（drawImage 对没就绪的视频是静默空画）：全黑横带 = 没画上
  const band = cx.getImageData(0, Math.floor(h / 2), w, 2).data;
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < band.length; i += 4) {
    if (band[i] < lo) lo = band[i];
    if (band[i] > hi) hi = band[i];
  }
  if (hi === 0 && lo === 255) throw new Error("截出来是一片空白");
  return c.toDataURL("image/jpeg", 0.88);
}

/** 一段视频的首尾两帧（首 = 0 秒，尾 = 结尾前一瞬）。上传示例视频后自动填首尾帧用 */
export async function captureFirstLast(
  url: string,
  durationSec: number,
  opts?: { crossOrigin?: boolean },
): Promise<{ first: string; last: string }> {
  const first = await captureVideoFrame(url, 0, opts);
  const last = await captureVideoFrame(url, Math.max(0, durationSec - 0.05), opts);
  return { first, last };
}
