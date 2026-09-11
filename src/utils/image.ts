// 本地图片处理：裁成正方形 + 缩放 + 压缩。
// 头像不该把用户相册里 4MB 的原图直接塞进库——离线模式会挤爆 IndexedDB，
// 远端模式白白占 Cloudinary 流量。统一处理成 256px 见方、几十 KB。

import { t } from "@lingui/core/macro";

export interface SquareImage {
  /** 压缩后的 dataURL，可直接当 <img src> 或存库 */
  dataUrl: string;
  /** 同一份数据的 Blob，用于 multipart 上传 */
  blob: Blob;
  bytes: number;
}

const MAX_INPUT_BYTES = 20 * 1024 * 1024;

/**
 * 把一张 dataURL 缩到 maxW 宽以内，用作列表缩略图。
 * 草稿列表必须用它：AI 出的首帧是 1MB 级的 base64，个人页一屏十几张草稿直接拿原图
 * 当封面，光解码就能卡住主线程，草稿索引也会大到每次读写都肉眼可见地慢。
 * 失败（空串/坏图）时返回空串——调用方显示占位即可，不该为了一张缩略图让保存失败。
 */
export async function shrinkDataUrl(src: string, maxW = 320, quality = 0.72): Promise<string> {
  if (!src || !src.startsWith("data:image")) return "";
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error(t`解码失败`));
      im.src = src;
    });
    const w = Math.min(maxW, img.naturalWidth || maxW);
    const h = Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * w) || Math.round(w * 0.5625);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/jpeg", quality);
  } catch {
    return "";
  }
}

/**
 * 本地图 → 设定帧 dataURL（不裁剪，只把超宽的压下来）。
 * Seedream 的参考图与 Seedance 的首/尾帧都收 dataURL，而手机相册原图动辄 5MB+ base64，
 * 直接塞进方案会白白撑大草稿正文（一条草稿本来就有 1MB 级的帧）。
 * ★ 这份实现原来长在 studio/ui/projection.tsx 里，方案台也要用同一条规则（铁律六），
 *   所以提到这里；两处若各写一份，压缩阈值改一边就会分叉。
 */
export async function fileToFrameDataUrl(file: File, maxW = 1600, quality = 0.87): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = raw;
  });
  if (img.width <= maxW) return raw;
  const c = document.createElement("canvas");
  c.width = maxW;
  c.height = Math.round((img.height * maxW) / img.width);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

/**
 * Seedream 参考图的**硬**约束：边长 14~6000px、宽高比必须落在 1/3 ~ 3。
 * 越界不是"忽略这张图"，是把**整个请求 400 掉**。
 * ai/real.ts 的 prepRefImage 也钉着这两个数（那边管的是出图那一刻的兜底，
 * 这边管的是入库那一刻的预防）—— 改了要一起改。
 */
export const REF_MIN_SIDE = 14;
export const REF_MAX_RATIO = 3;

export interface RefImage {
  blob: Blob;
  /** 原图比例越界，已居中裁进 3:1（或 1:3）。★ 必须告诉用户，不能默默改人家的图 */
  cropped: boolean;
}

/**
 * 本地图 → **卡片形象参考图**（多图参考功能用）。
 *
 * ★ 出参是 Blob 不是 dataURL：卡片的 views 只存 https URL（见 types.CardView），
 *   这张 Blob 是拿去 `api/uploads` 转存的。存 dataURL 会把随作品发布的卡组快照撑爆。
 * ★ 长边压到 1024：参考图只用来让模型**认特征**，不是出片素材；再大只是白白拖慢
 *   手机上行（既有的素材图走 fileToCover 才 512 宽就够认脸了），1024 是给全身照的
 *   衣服纹样留的余量。
 * ★ 比例越界就**居中裁**并把 cropped 报上去，而不是静默裁或直接拒：手机全景/长截图
 *   正好越界，直接拒等于这个功能对相册里一半的图不存在；静默裁则是当面改用户的图。
 */
export async function fileToRefImage(file: File, maxLong = 1024, quality = 0.85): Promise<RefImage> {
  const bitmap = await decodeImageFile(file);
  try {
    const { width: w, height: h } = bitmap;
    if (w < REF_MIN_SIDE || h < REF_MIN_SIDE) throw new Error(t`这张图太小了，AI 认不出里面的东西`);
    const r = w / h;
    // 越界时按"能容下的最大居中矩形"裁：宽的裁宽、长的裁高
    const cw = r > REF_MAX_RATIO ? Math.round(h * REF_MAX_RATIO) : w;
    const ch = r < 1 / REF_MAX_RATIO ? Math.round(w * REF_MAX_RATIO) : h;
    const cropped = cw !== w || ch !== h;
    const k = Math.min(1, maxLong / Math.max(cw, ch));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(cw * k));
    canvas.height = Math.max(1, Math.round(ch * k));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(t`无法处理图片`);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, Math.round((w - cw) / 2), Math.round((h - ch) / 2), cw, ch, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error(t`图片编码失败`))), "image/jpeg", quality),
    );
    return { blob, cropped };
  } finally {
    bitmap.close?.();
  }
}

/** 源图上要取的那块方形区域（像素）。三个头像入口最后都收敛到这一个形状 */
export interface SquareCrop {
  x: number;
  y: number;
  side: number;
}

/**
 * 把一张已经解好码的图按 crop 裁成 size×size 并编码。
 *
 * ★ 三个入口（选本地图 / 手动圈定 / 选官方头像）共用这一段：编码格式、质量、
 *   兜底逻辑只有一份。分开写的话总有一天会出现"官方头像是 png、上传的是 webp"
 *   这种一眼看不出来、体积却差三倍的分叉（铁律六）。
 */
async function encodeSquare(
  src: CanvasImageSource & { width: number; height: number },
  crop: SquareCrop,
  size: number,
  quality: number,
): Promise<SquareImage> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(t`无法处理图片`);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size);

  // webp 体积明显更小；不支持的浏览器 toBlob 会回退成 png，用 type 反查真实结果
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", quality));
  const finalBlob =
    blob && blob.type === "image/webp"
      ? blob
      : await new Promise<Blob>((res, rej) =>
          canvas.toBlob((b) => (b ? res(b) : rej(new Error(t`图片编码失败`))), "image/jpeg", quality),
        );

  const dataUrl = await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(new Error(t`图片读取失败`));
    fr.readAsDataURL(finalBlob);
  });

  return { dataUrl, blob: finalBlob, bytes: finalBlob.size };
}

/**
 * 读一张本地图片解码出来。
 * 用 createImageBitmap 的 imageOrientation:"from-image" 让浏览器按 EXIF 摆正——
 * 手机竖拍的照片不这样处理会躺倒。
 * ★ 收 Blob 不只收 File：「只留主体」那条路把选到的文件先读实成内存里的 Blob 存进 store
 *   （content:// 懒读在切到后台之后可能失效），之后再从 Blob 解码。File 本来就是 Blob。
 * ★★ 解不开时说人话（2026-09-10）：原来第二次也失败时，浏览器的英文
 *   「InvalidStateError: The source image could not be decoded.」原样抛到页面上 ——
 *   HEIC、损坏的文件都是这一句，用户既读不懂，也不知道该怎么办。
 */
export async function decodeImageFile(file: Blob): Promise<ImageBitmap> {
  if (!file.type.startsWith("image/")) throw new Error(t`请选择图片文件`);
  if (file.size > MAX_INPUT_BYTES) throw new Error(t`图片太大了（超过 20MB）`);
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Safari 老版本不支持 options，退回默认
    try {
      return await createImageBitmap(file);
    } catch {
      throw new Error(t`这张图解不开（常见于 HEIC 等手机专有格式，或文件已损坏）——换成 JPG / PNG，或截个图再传`);
    }
  }
}

// ── 道具卡「只留主体」（components/PhotoSubjectPicker）的合成规则 ──────────────
// ★ 放在这里而不是组件里：主人 2026-09-10 拍板「视频提卡 / 视频圈选入口也一起做只留主体」，
//   那两条路要复用同一份规则（底色、留白、比例、短边门），各抄一份必然分叉（铁律六）。

/**
 * 参考图的**短边**门槛（出片管线）。真机实测（2026-08-24）：方舟参考图要求边长 ≥300px ——
 * 脸部特写圈小了裁出 274×274，出片那一步才 400（钱都要扣了才报错）。
 * 320 留了点余量：不足时**放大**到线（模糊但合法，特征还在）；
 * 小得离谱（< REF_SHORT_REJECT，放大 3 倍都不够）就整句拒，让用户重圈 —— 10 倍放大的糊图当参考是在骗模型。
 * ★ 判短边：仓里对「300 判宽还是判短边」注释不一（VideoCardAnnotator 写宽、ai/real 写短边），
 *   按短边判两种读法下都安全。
 * ★ 与上面的 REF_MIN_SIDE（Seedream 的 14px 边长下限）不是一回事，别合并。
 * （2026-09-10 之前是 VideoCardAnnotator 模块私有的 CROP_MIN 和一个写死的 110，收到这里给两条路共用）
 */
export const REF_SHORT_MIN = 320;
export const REF_SHORT_REJECT = 110;

/** 抠出主体后铺的底色：浅中性灰（主人拍板 6 a）。纯白会吞掉白色物件。
 *  ★ 具体色值等付费实验 X2 定，改这一处即可 */
export const SUBJECT_BG = "#e6e6e6";
/** 主体外接框四周的留白，占主体长边的比例（主体贴着边，当参考图时容易被当成被裁掉的局部） */
const SUBJECT_PAD = 0.08;
/** 读进来的源图长边上限：12MP 的 RGBA 位图约 46MiB、50MP 约 190MiB，低端机扛不住。
 *  压到 4096 时，道具占长边 1/13 也还能裁出 ≥315px */
export const SUBJECT_SOURCE_MAX = 4096;
/** 合成画布的长边上限（之后 prepareCardImage 还会压到 1024，再大只是白耗内存） */
const SUBJECT_OUT_MAX = 2048;

export interface SubjectSource {
  /** 已按 EXIF 摆正、长边 ≤ SUBJECT_SOURCE_MAX 的那张 */
  image: ImageBitmap | HTMLCanvasElement;
  width: number;
  height: number;
}

/** 源像素里的一块矩形（与 blockout/arkVideoRules 的 CropRect 同形） */
export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Blob → dataURL。纯编码，不是规则 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(new Error(t`图片读取失败`));
    fr.readAsDataURL(blob);
  });
}

/** 解码并把长边压到 SUBJECT_SOURCE_MAX 以内。
 *  ★ 同一个 Blob 每次得到同样尺寸的图 —— store 里存的源像素坐标，重挂载之后照样对得上 */
export async function loadSubjectSource(blob: Blob): Promise<SubjectSource> {
  const bitmap = await decodeImageFile(blob);
  const { width, height } = bitmap;
  const k = Math.min(1, SUBJECT_SOURCE_MAX / Math.max(width, height));
  if (k === 1) return { image: bitmap, width, height };
  try {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(width * k));
    c.height = Math.max(1, Math.round(height * k));
    const g = c.getContext("2d");
    if (!g) throw new Error(t`无法处理图片`);
    g.imageSmoothingQuality = "high";
    g.drawImage(bitmap, 0, 0, c.width, c.height);
    return { image: c, width: c.width, height: c.height };
  } finally {
    bitmap.close?.();
  }
}

/** 用完释放位图（canvas 不需要） */
export function closeSubjectSource(s: SubjectSource): void {
  if (typeof ImageBitmap !== "undefined" && s.image instanceof ImageBitmap) s.image.close();
}

/**
 * 一块主体合成之后、放大之前的画布短边 —— 「太小要拒」的**唯一**判据：
 * 圈选层上的灰键与 composeSubjectImage 里的拒绝问的都是它。
 * ★ 不直接比框的短边：抠主体时画布按主体长边铺成 3:4，剑、尺子这种细长物件
 *   自己的短边再窄，铺进画布之后也完全合格；按框的短边判会把它们冤枉掉。
 * @param mode cutout = 抠出主体铺进 3:4 画布；keep = 保留框内背景，只在比例越界时补边
 */
export function subjectShortSide(w: number, h: number, mode: "cutout" | "keep"): number {
  if (w <= 0 || h <= 0) return 0;
  if (mode === "keep") {
    const cw = h / w > REF_MAX_RATIO ? Math.ceil(h / REF_MAX_RATIO) : w;
    const ch = w / h > REF_MAX_RATIO ? Math.ceil(w / REF_MAX_RATIO) : h;
    return Math.round(Math.min(cw, ch));
  }
  const pad = Math.round(Math.max(w, h) * SUBJECT_PAD);
  const pw = w + pad * 2;
  const ph = h + pad * 2;
  // 3:4 与卡面同比例（types.CARD_SIZE 1728x2304）：竖版画布的短边是宽
  return Math.round(pw / ph > 3 / 4 ? pw : (ph * 3) / 4);
}

/** 轮廓点（源像素）的外接矩形，夹在框内。★ 用循环不用 Math.min(...pts)：描一圈能有上千个点，展开传参会爆栈 */
export function lassoBounds(pts: [number, number][], box: PixelBox): PixelBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const bx0 = Math.max(box.x, Math.floor(x0));
  const by0 = Math.max(box.y, Math.floor(y0));
  const bx1 = Math.min(box.x + box.w, Math.ceil(x1));
  const by1 = Math.min(box.y + box.h, Math.ceil(y1));
  return { x: bx0, y: by0, w: Math.max(0, bx1 - bx0), h: Math.max(0, by1 - by0) };
}

export interface ComposedSubject {
  blob: Blob;
  width: number;
  height: number;
  /** 主体（保留背景时是框）在源图上的尺寸 */
  subjectW: number;
  subjectH: number;
  /** 为了够到 REF_SHORT_MIN 放大过（要写进 note：改了用户的图就必须说） */
  upscaled: boolean;
}

/**
 * 合成进卡的那一张：抠主体（给了 lasso）或保留框内背景（lasso 为 null）→ 铺底定比例 →
 * 短边补到 REF_SHORT_MIN → JPEG。
 * ★★ 先铺底再画主体：canvas 编 JPEG 时透明像素会被合成到**黑底**上（HTML 规范原文
 *   "composited onto an opaque black background"），而方舟怎么处理带 alpha 的参考图没验过 ——
 *   一律不交出带透明的图。
 * ★ 保留背景时只在宽高比越过 REF_MAX_RATIO 时补纯色边，不裁：prepareCardImage 遇到越界比例
 *   会居中裁掉长边，剑、鱼竿的两头会在用户确认之后被悄悄切掉。
 * ★ 出来的图比例一定在 1/3~3 以内、短边 ≥ REF_SHORT_MIN，所以之后过 prepareCardImage 不会再被裁；
 *   它把长边压到 1024 之后短边仍 ≥ 1024/3 ≈ 341。
 */
export async function composeSubjectImage(
  src: CanvasImageSource,
  box: PixelBox,
  lasso: [number, number][] | null,
  quality = 0.95,
): Promise<ComposedSubject> {
  const outline = lasso && lasso.length >= 3 ? lasso : null;
  const s = outline ? lassoBounds(outline, box) : box;
  const short = subjectShortSide(s.w, s.h, outline ? "cutout" : "keep");
  if (short < REF_SHORT_REJECT) {
    throw new Error(t`这块太小了：折算只有 ${short} px，至少 ${REF_SHORT_REJECT} px——框大一点、描大一点再试`);
  }
  let cw: number;
  let ch: number;
  if (outline) {
    const pad = Math.round(Math.max(s.w, s.h) * SUBJECT_PAD);
    const pw = s.w + pad * 2;
    const ph = s.h + pad * 2;
    if (pw / ph > 3 / 4) {
      cw = pw;
      ch = Math.round((pw * 4) / 3);
    } else {
      ch = ph;
      cw = Math.round((ph * 3) / 4);
    }
  } else {
    cw = s.h / s.w > REF_MAX_RATIO ? Math.ceil(s.h / REF_MAX_RATIO) : s.w;
    ch = s.w / s.h > REF_MAX_RATIO ? Math.ceil(s.w / REF_MAX_RATIO) : s.h;
  }
  const dx = (cw - s.w) / 2;
  const dy = (ch - s.h) / 2;
  const canvasShort = Math.min(cw, ch);
  let k = canvasShort < REF_SHORT_MIN ? REF_SHORT_MIN / canvasShort : 1;
  if (k === 1 && Math.max(cw, ch) > SUBJECT_OUT_MAX) k = SUBJECT_OUT_MAX / Math.max(cw, ch);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(cw * k));
  out.height = Math.max(1, Math.round(ch * k));
  const g = out.getContext("2d");
  if (!g) throw new Error(t`无法处理图片`);
  g.imageSmoothingQuality = "high";
  g.fillStyle = SUBJECT_BG;
  g.fillRect(0, 0, out.width, out.height);
  if (outline) {
    g.save();
    g.beginPath();
    outline.forEach(([x, y], i) => {
      const px = (x - s.x + dx) * k;
      const py = (y - s.y + dy) * k;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.closePath();
    g.clip();
  }
  g.drawImage(src, s.x, s.y, s.w, s.h, dx * k, dy * k, s.w * k, s.h * k);
  if (outline) g.restore();
  const blob = await new Promise<Blob>((res, rej) =>
    out.toBlob((b) => (b ? res(b) : rej(new Error(t`图片编码失败`))), "image/jpeg", quality),
  );
  return {
    blob,
    width: out.width,
    height: out.height,
    subjectW: Math.round(s.w),
    subjectH: Math.round(s.h),
    upscaled: k > 1,
  };
}

/** 居中裁成正方形并缩到 size×size（不让用户圈选时的默认口径） */
export async function fileToSquareImage(file: File, size = 256, quality = 0.85): Promise<SquareImage> {
  const bitmap = await decodeImageFile(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    return await encodeSquare(bitmap, { x: (bitmap.width - side) / 2, y: (bitmap.height - side) / 2, side }, size, quality);
  } finally {
    bitmap.close?.();
  }
}

/** 按用户圈定的区域裁（头像裁切框，见 components/AvatarPicker）。
 *  bitmap 由调用方持有并负责释放——裁切界面要一边预览一边反复调它 */
export async function cropSquareImage(
  bitmap: ImageBitmap,
  crop: SquareCrop,
  size = 256,
  quality = 0.85,
): Promise<SquareImage> {
  return encodeSquare(bitmap, crop, size, quality);
}

/**
 * 站内静态图（官方看板娘头像）→ 与上传图**完全同构**的 SquareImage。
 *
 * ★ 为什么绕这一圈，而不是直接把 "/avatars/mascot-x.webp" 写进 user.avatar：
 *   头像在远端模式下要 PUT 给服务端（avatarUrl 字段）。塞一个**站内相对路径**上去，
 *   服务端存的就是一个只有本 app 解得开的字符串，别的客户端、后台、以后的网页版
 *   拿到都是坏图；服务端那边校不校验 URL 我们也管不着（契约里没写）。
 *   走同一条上传路径就永远只有一种东西：一张真图。选官方头像和上传自己的图，
 *   在数据层是同一件事（铁律六）。
 */
export async function urlToSquareImage(url: string, size = 256, quality = 0.85): Promise<SquareImage> {
  const res = await fetch(url);
  // ★ 判 Content-Type 而不是只判 res.ok：Capacitor 的本地静态服务器对未命中的路径
  //   做 SPA 回退，返回 **200 + index.html**（CLAUDE.md 里记过这条）。只看状态码的话，
  //   一张漏打包的头像会变成"createImageBitmap 解不开 HTML"这种查不出源头的报错。
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) throw new Error(t`头像素材读取失败（这张图可能没打进包里）`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    return await encodeSquare(bitmap, { x: (bitmap.width - side) / 2, y: (bitmap.height - side) / 2, side }, size, quality);
  } finally {
    bitmap.close?.();
  }
}
