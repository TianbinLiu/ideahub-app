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
