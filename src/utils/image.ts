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
  if (!ctx) throw new Error("无法处理图片");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size);

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

/**
 * 读一张本地图片解码出来。
 * 用 createImageBitmap 的 imageOrientation:"from-image" 让浏览器按 EXIF 摆正——
 * 手机竖拍的照片不这样处理会躺倒。
 */
export async function decodeImageFile(file: File): Promise<ImageBitmap> {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
  if (file.size > MAX_INPUT_BYTES) throw new Error("图片太大了（超过 20MB）");
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Safari 老版本不支持 options，退回默认
    return await createImageBitmap(file);
  }
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
  if (!res.ok || !type.startsWith("image/")) throw new Error("头像素材读取失败（这张图可能没打进包里）");
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    return await encodeSquare(bitmap, { x: (bitmap.width - side) / 2, y: (bitmap.height - side) / 2, side }, size, quality);
  } finally {
    bitmap.close?.();
  }
}
