// 占位画面生成器：canvas 绘制“伪 AI 生成”的首尾帧 / 卡片封面。
// 同一 seed 永远得到同一画面；hueSeed 用于让相邻片段共享色调（首尾帧续接感）。
import { VideoAspect, aspectOf } from "../types";
import { makeRng, pick } from "./rng";

const PALETTES: Array<[string, string, string]> = [
  ["#0f172a", "#1d4ed8", "#38bdf8"],
  ["#1e1b4b", "#7c3aed", "#f472b6"],
  ["#052e16", "#15803d", "#a3e635"],
  ["#431407", "#ea580c", "#fbbf24"],
  ["#082f49", "#0e7490", "#67e8f9"],
  ["#3b0764", "#a21caf", "#f0abfc"],
  ["#450a0a", "#b91c1c", "#fca5a5"],
  ["#1c1917", "#57534e", "#d6d3d1"],
];

function paletteFor(hueSeed: string): [string, string, string] {
  const rng = makeRng(`hue:${hueSeed}`);
  return pick(rng, PALETTES);
}

function drawBase(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: string,
  hueSeed: string
) {
  const [c0, c1, c2] = paletteFor(hueSeed);
  const rng = makeRng(`frame:${seed}`);
  const g = ctx.createLinearGradient(0, 0, w * (0.4 + rng() * 0.6), h);
  g.addColorStop(0, c0);
  g.addColorStop(0.6, c1);
  g.addColorStop(1, c0);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 光斑
  for (let i = 0; i < 5; i++) {
    const x = rng() * w;
    const y = rng() * h * 0.7;
    const r = (0.08 + rng() * 0.22) * w;
    const rad = ctx.createRadialGradient(x, y, 0, x, y, r);
    rad.addColorStop(0, c2 + "55");
    rad.addColorStop(1, c2 + "00");
    ctx.fillStyle = rad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // 主光源（日/月）
  const sx = w * (0.15 + rng() * 0.7);
  const sy = h * (0.12 + rng() * 0.3);
  const sr = w * (0.04 + rng() * 0.05);
  const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 2.4);
  sun.addColorStop(0, "#ffffffdd");
  sun.addColorStop(0.35, c2 + "aa");
  sun.addColorStop(1, c2 + "00");
  ctx.fillStyle = sun;
  ctx.fillRect(sx - sr * 3, sy - sr * 3, sr * 6, sr * 6);

  // 远山剪影两层
  for (let layer = 0; layer < 2; layer++) {
    const base = h * (0.62 + layer * 0.16);
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, base);
    const peaks = 4 + Math.floor(rng() * 4);
    for (let i = 1; i <= peaks; i++) {
      const px = (w / peaks) * i;
      const py = base - rng() * h * (0.18 - layer * 0.06);
      ctx.lineTo(px - (w / peaks) * 0.5, py);
      ctx.lineTo(px, base - rng() * h * 0.05);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = layer === 0 ? c0 + "cc" : "#000000aa";
    ctx.fill();
  }

  // 暗角
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.4, w / 2, h / 2, w * 0.75);
  vg.addColorStop(0, "#00000000");
  vg.addColorStop(1, "#00000066");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

/** 视频帧占位图（jpeg dataURL）：横屏 640x360 / 竖屏 360x640 */
export function makeFrame(seed: string, label: string, hueSeed?: string, aspect?: VideoAspect): string {
  // 占位帧也得跟着画幅走：竖屏作品配一张 16:9 占位图，播放器一算比例就当成横屏，
  // 首页给它上下留黑边——演示模式下看起来就像"竖屏根本没生效"
  const portrait = aspectOf(aspect).id === "portrait";
  const w = portrait ? 360 : 640;
  const h = portrait ? 640 : 360;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  drawBase(ctx, w, h, seed, hueSeed ?? seed);

  if (label) {
    ctx.font = "600 26px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillStyle = "#ffffffee";
    ctx.shadowColor = "#000000aa";
    ctx.shadowBlur = 8;
    ctx.fillText(label, 24, h - 26);
    ctx.shadowBlur = 0;
  }
  ctx.font = "500 14px 'PingFang SC','Microsoft YaHei',sans-serif";
  ctx.fillStyle = "#ffffff88";
  ctx.textAlign = "right";
  ctx.fillText("AI 预览帧", w - 16, 28);
  ctx.textAlign = "left";
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** 480x672 卡片封面占位图 */
export function makeCover(seed: string, name: string): string {
  const w = 480;
  const h = 672;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  drawBase(ctx, w, h, seed, seed);

  // 中央徽记：环 + 首字
  const rng = makeRng(`emblem:${seed}`);
  const cx = w / 2;
  const cy = h * 0.42;
  const [, , c2] = paletteFor(seed);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, 70 + i * 26 + rng() * 8, 0, Math.PI * 2);
    ctx.strokeStyle = c2 + (i === 0 ? "cc" : "44");
    ctx.lineWidth = i === 0 ? 3 : 1.5;
    ctx.stroke();
  }
  const ch = (name || "卡").trim().charAt(0) || "卡";
  ctx.font = "700 96px 'PingFang SC','Microsoft YaHei',sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffffea";
  ctx.shadowColor = c2;
  ctx.shadowBlur = 24;
  ctx.fillText(ch, cx, cy + 4);
  ctx.shadowBlur = 0;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** 把用户图片文件压成 512 宽内的 jpeg dataURL 作为真实卡面 */
export function fileToCover(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 512 / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
