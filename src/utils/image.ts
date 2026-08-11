// 本地图片处理：裁成正方形 + 缩放 + 压缩。
// 头像不该把用户相册里 4MB 的原图直接塞进库——离线模式会挤爆 IndexedDB，
// 远端模式白白占 Cloudinary 流量。统一处理成 256px 见方、几十 KB。

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
      im.onerror = () => rej(new Error("解码失败"));
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
 * 读一张本地图片，居中裁成正方形并缩到 size×size。
 * 用 createImageBitmap 的 imageOrientation:"from-image" 让浏览器按 EXIF 摆正——
 * 手机竖拍的照片不这样处理会躺倒。
 */
export async function fileToSquareImage(file: File, size = 256, quality = 0.85): Promise<SquareImage> {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
  if (file.size > MAX_INPUT_BYTES) throw new Error("图片太大了（超过 20MB）");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Safari 老版本不支持 options，退回默认
    bitmap = await createImageBitmap(file);
  }

  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法处理图片");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close?.();

  // webp 体积明显更小；不支持的浏览器 toBlob 会回退成 png，用 type 反查真实结果
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", quality));
  const finalBlob =
    blob && blob.type === "image/webp"
      ? blob
      : await new Promise<Blob>((res, rej) =>
          canvas.toBlob((b) => (b ? res(b) : rej(new Error("图片编码失败"))), "image/jpeg", quality),
        );

  const dataUrl = await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(new Error("图片读取失败"));
    fr.readAsDataURL(finalBlob);
  });

  return { dataUrl, blob: finalBlob, bytes: finalBlob.size };
}
