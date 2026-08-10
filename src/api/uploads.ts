// 二进制资产上传：把本地的帧/卡面/成片传成 Cloudinary 永久 URL。
//
// ★★ 为什么必须有这一层（2026-08-10 查出来的真事故）：
//   发布走的是「把整份作品塞进一个 JSON POST 出去」，而帧和卡面都是 base64 dataURL，
//   成片的 videoUrl 干脆是 `idb:merged:xxx`（**本地 IndexedDB 键**）。后果有两个：
//     ① 一条 1 段的作品发布体就有 4.9MB（其中 61% 是卡组卡面），
//        被 nginx 的 client_max_body_size（默认 1m）在网络层直接掐断 ——
//        浏览器只看到 `Failed to fetch`，作品"自己消失"；
//     ② **就算传上去，别人也放不出来** —— 服务端存下的是一个指向"你手机上某处"的字符串。
//   把资产逐个传成 URL 之后，发布体从 4.9MB 掉到几 KB，上面两件事一起消失，
//   而且**不需要改 nginx**（改它只是治标，还要冒改线上配置的风险）。
//
// ★ 服务端这两个端点早就在线、Cloudinary 也早就配好了（2026-08-10 实测：
//   传一张 1x1 png 回的是 res.cloudinary.com 的永久 URL）。缺的一直只是 App 去用它。
import { API_BASE, ApiError, getToken } from "./client";

/** 与服务端 middleware/upload.js 的上限一致。超了就别发出去，省一次必然失败的往返 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

async function post(path: string, field: string, blob: Blob, filename: string, timeoutMs: number): Promise<string> {
  const token = getToken();
  const fd = new FormData();
  fd.append(field, blob, filename);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      // ★ 不要手写 Content-Type：multipart 的 boundary 由浏览器生成，
      //   自己填一个会让服务端解析不出文件（multer 直接判定没有 file）。
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
      signal: ctrl.signal,
    });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    throw new ApiError(aborted ? "上传超时" : "上传失败（网络不可用）", 0, aborted ? "TIMEOUT" : "NETWORK");
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* 非 JSON：下面按状态码报错 */
  }
  if (!res.ok) throw new ApiError(String(data.message ?? `上传失败 HTTP ${res.status}`), res.status);
  const url = data.imageUrl ?? data.mediaUrl ?? data.url;
  if (typeof url !== "string" || !url) throw new ApiError("上传成功但没拿到地址", 502);
  return url;
}

/** 图片（帧 / 封面 / 卡面）。服务端限 5MB、只收 jpeg/png/gif/webp */
export function uploadImage(blob: Blob, filename = "frame.jpg"): Promise<string> {
  // 大图在慢网上要传很久；60s 是按 5MB 上限估的，别用 client.ts 那个 20s 默认值
  return post("/api/uploads/image", "image", blob, filename, 60_000);
}

/** 图片或视频（成片）。服务端限 20MB */
export function uploadMedia(blob: Blob, filename = "video.webm"): Promise<string> {
  return post("/api/uploads/media", "media", blob, filename, 180_000);
}
