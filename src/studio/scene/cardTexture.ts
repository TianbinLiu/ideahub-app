// 卡面 canvas 纹理：圆角、类型配色、封面图异步载入后重绘。全部纹理按 key 缓存。
// 素材卡走塔罗版式：Seedream 生成的魔法边框 + 画窗铺满封面 + 牌匾衬线题名，
// 与 2D 的 TarotCard 组件共用同一张框图和同一组画窗/牌匾常量。
import * as THREE from "three";
import { TAROT_FRAME_URL, TAROT_LAYOUT, TYPE_GLYPH } from "../../components/TarotCard";
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

const SERIF_CANVAS = `'Songti SC','STSong','SimSun','Noto Serif SC',serif`;

/** 素材卡卡面：塔罗版式（生成边框 + 满窗封面 + 牌匾题名 + 类型宝石徽记） */
export function cardFaceTexture(card: Card): THREE.CanvasTexture {
  const color = CARD_TYPE_COLORS[card.type];
  const L = TAROT_LAYOUT;
  return texFromDraw(`card:${card.id}`, W, H, [card.cover, TAROT_FRAME_URL], (ctx, [cover, frame]) => {
    // 卡底
    roundedPath(ctx, 0, 0, W, H, 30);
    ctx.fillStyle = "#0a0f22";
    ctx.fill();
    // 封面铺满画窗
    const wx = L.win.left * W;
    const wy = L.win.top * H;
    const ww = L.win.width * W;
    const wh = L.win.height * H;
    if (cover) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(wx, wy, ww, wh);
      ctx.clip();
      drawImageCover(ctx, cover, wx, wy, ww, wh);
      ctx.restore();
    }
    // 魔法边框叠加：画窗区是纯黑，screen 混合让封面完整透出、边框纹饰点亮
    if (frame) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.drawImage(frame, 0, 0, W, H);
      ctx.restore();
    } else {
      // 框图未就绪的一两帧：先给个细边撑住卡形
      roundedPath(ctx, 4, 4, W - 8, H - 8, 28);
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#8a6d3b";
      ctx.stroke();
    }
    // 类型宝石徽记：画窗左上角（特别标注，不吃画面）
    const br = W * 0.068;
    const bx = wx + br + W * 0.012;
    const by = wy + br + W * 0.012;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(6,10,25,0.82)";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = `700 ${Math.round(br * 1.1)}px ${SERIF_CANVAS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(TYPE_GLYPH[card.type], bx, by + 2);
    // 塔罗式题名：牌匾区居中、衬线、拉字距、淡金
    const name = card.name.length > 7 ? card.name.slice(0, 7) + "…" : card.name;
    const cy = (L.banner.top + L.banner.height / 2) * H;
    ctx.font = `700 52px ${SERIF_CANVAS}`;
    const canSpace = "letterSpacing" in ctx;
    if (canSpace) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "8px";
    ctx.fillStyle = "#fde9c8";
    ctx.shadowColor = "rgba(251,191,36,0.4)";
    ctx.shadowBlur = 10;
    ctx.fillText(name, W / 2, cy - 16);
    ctx.shadowBlur = 0;
    // 副题：类型全称 + 热度
    ctx.font = `500 26px ${SERIF_CANVAS}`;
    if (canSpace) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "10px";
    ctx.fillStyle = "rgba(253,230,190,0.62)";
    const sub =
      card.hot != null
        ? `${CARD_TYPE_LABELS[card.type]} · ${card.hot >= 10000 ? (card.hot / 10000).toFixed(1) + "万" : card.hot}`
        : CARD_TYPE_LABELS[card.type];
    ctx.fillText(sub, W / 2, cy + 40);
    if (canSpace) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
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
