// 卡面 canvas 纹理：圆角、类型配色、封面图异步载入后重绘。全部纹理按 key 缓存。
import * as THREE from "three";
import { Card, CARD_TYPE_COLORS, CARD_TYPE_LABELS, Proposal } from "../../types";

// LRU 缓存：命中即刷新热度；超限淘汰最冷条目并 dispose（GPU 侧释放，若仍被引用 three 会自动重传）
const cache = new Map<string, THREE.CanvasTexture>();
const CACHE_MAX = 160;

function cacheGet(key: string): THREE.CanvasTexture | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cachePut(key: string, tex: THREE.CanvasTexture) {
  cache.set(key, tex);
  if (cache.size > CACHE_MAX) {
    const oldestKey = cache.keys().next().value as string;
    const oldest = cache.get(oldestKey);
    cache.delete(oldestKey);
    oldest?.dispose();
  }
}

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function texFromDraw(
  key: string,
  w: number,
  h: number,
  imgSrcs: string[],
  draw: (ctx: CanvasRenderingContext2D, images: Array<HTMLImageElement | null>) => void
): THREE.CanvasTexture {
  const hit = cacheGet(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const images: Array<HTMLImageElement | null> = imgSrcs.map(() => null);
  const render = () => {
    ctx.clearRect(0, 0, w, h);
    draw(ctx, images);
    tex.needsUpdate = true;
  };
  render();
  imgSrcs.forEach((src, i) => {
    if (!src) return;
    const im = new Image();
    im.onload = () => {
      images[i] = im;
      render();
    };
    im.src = src;
  });
  cachePut(key, tex);
  return tex;
}

/** 居中裁剪绘制图片 */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s;
  const sh = h / s;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

const W = 512;
const H = 768;

/** 素材卡卡面 */
export function cardFaceTexture(card: Card): THREE.CanvasTexture {
  const color = CARD_TYPE_COLORS[card.type];
  const label = CARD_TYPE_LABELS[card.type];
  return texFromDraw(`card:${card.id}`, W, H, [card.cover], (ctx, [cover]) => {
    roundedPath(ctx, 4, 4, W - 8, H - 8, 34);
    ctx.fillStyle = "#0d1428";
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = color;
    ctx.stroke();

    // 封面区
    ctx.save();
    roundedPath(ctx, 26, 26, W - 52, H * 0.62, 20);
    ctx.clip();
    if (cover) drawImageCover(ctx, cover, 26, 26, W - 52, H * 0.62);
    else {
      ctx.fillStyle = "#16203d";
      ctx.fillRect(26, 26, W - 52, H * 0.62);
    }
    ctx.restore();

    // 名称
    ctx.font = "700 44px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillStyle = "#f1f5f9";
    const name = card.name.length > 8 ? card.name.slice(0, 8) + "…" : card.name;
    ctx.fillText(name, 32, H * 0.62 + 88);

    // 类型章
    ctx.font = "600 30px 'PingFang SC','Microsoft YaHei',sans-serif";
    const tw = ctx.measureText(label).width + 36;
    roundedPath(ctx, 32, H - 96, tw, 52, 26);
    ctx.fillStyle = color + "33";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(label, 50, H - 59);

    // 热度
    if (card.hot != null) {
      ctx.font = "500 26px 'PingFang SC','Microsoft YaHei',sans-serif";
      ctx.fillStyle = "#fbbf24dd";
      ctx.textAlign = "right";
      ctx.fillText(`🔥 ${card.hot >= 10000 ? (card.hot / 10000).toFixed(1) + "万" : card.hot}`, W - 40, H - 62);
      ctx.textAlign = "left";
    }
  });
}

/** 节点/方案卡：首帧+尾帧上下拼作卡面 */
export function proposalTexture(p: Proposal): THREE.CanvasTexture {
  return texFromDraw(`prop:${p.id}`, W, H, [p.firstFrame, p.lastFrame], (ctx, [first, last]) => {
    roundedPath(ctx, 4, 4, W - 8, H - 8, 34);
    ctx.fillStyle = "#0d1428";
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#38bdf8";
    ctx.stroke();

    const frameH = (H - 190) / 2;
    ctx.save();
    roundedPath(ctx, 24, 24, W - 48, frameH, 16);
    ctx.clip();
    if (first) drawImageCover(ctx, first, 24, 24, W - 48, frameH);
    else {
      ctx.fillStyle = "#16203d";
      ctx.fillRect(24, 24, W - 48, frameH);
    }
    ctx.restore();
    ctx.save();
    roundedPath(ctx, 24, 36 + frameH, W - 48, frameH, 16);
    ctx.clip();
    if (last) drawImageCover(ctx, last, 24, 36 + frameH, W - 48, frameH);
    else {
      ctx.fillStyle = "#16203d";
      ctx.fillRect(24, 36 + frameH, W - 48, frameH);
    }
    ctx.restore();

    ctx.font = "500 22px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillStyle = "#ffffffcc";
    ctx.fillText("首", 40, 60);
    ctx.fillText("尾", 40, 72 + frameH);

    ctx.font = "700 36px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillStyle = "#f1f5f9";
    ctx.fillText(p.title, 32, H - 92);
    ctx.font = "500 26px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`${p.durationSec}s`, 32, H - 44);
  });
}

/** 虚线空白节点卡位 */
export function placeholderTexture(): THREE.CanvasTexture {
  return texFromDraw("placeholder", W, H, [], (ctx) => {
    ctx.setLineDash([26, 18]);
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#67e8f9";
    roundedPath(ctx, 12, 12, W - 24, H - 24, 32);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = "center";
    ctx.fillStyle = "#67e8f9";
    ctx.font = "300 150px 'PingFang SC',sans-serif";
    ctx.fillText("+", W / 2, H / 2 - 20);
    ctx.font = "500 44px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText("节点卡", W / 2, H / 2 + 90);
    ctx.textAlign = "left";
  });
}

/** 卡背（卡组堆叠顶面） */
export function cardBackTexture(): THREE.CanvasTexture {
  return texFromDraw("back", W, H, [], (ctx) => {
    roundedPath(ctx, 4, 4, W - 8, H - 8, 34);
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#111a33");
    g.addColorStop(1, "#1e2b52");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#334e8c";
    ctx.stroke();
    // 菱形纹样
    ctx.strokeStyle = "#2b3f70";
    ctx.lineWidth = 2;
    for (let x = -H; x < W + H; x += 46) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + H, H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + H, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 130px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillStyle = "#67e8f966";
    ctx.fillText("卡", W / 2, H / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  });
}

/** 通用文字标签（合成按钮等），透明底 */
export function labelTexture(text: string, color = "#fde68a"): THREE.CanvasTexture {
  return texFromDraw(`label:${text}:${color}`, 512, 128, [], (ctx) => {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 58px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.shadowColor = "#000000cc";
    ctx.shadowBlur = 10;
    ctx.fillStyle = color;
    ctx.fillText(text, 256, 64);
    ctx.shadowBlur = 0;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  });
}

/** 选中光环（描边圆角框） */
export function ringTexture(color: string): THREE.CanvasTexture {
  return texFromDraw(`ring:${color}`, W, H, [], (ctx) => {
    ctx.lineWidth = 22;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 30;
    roundedPath(ctx, 16, 16, W - 32, H - 32, 36);
    ctx.stroke();
    ctx.shadowBlur = 0;
  });
}
