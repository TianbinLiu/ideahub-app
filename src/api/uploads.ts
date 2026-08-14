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
export const MAX_TEMPLATE_VIDEO_BYTES = 20 * 1024 * 1024;

/** multipart POST 的唯一实现：拿回**整份**回包（模板视频要读服务端登记的元数据，
 *  不止一个 URL）。错误处理与 post 同一份——两条上传路各写一份超时/解析必然分叉。 */
async function postForm(
  path: string,
  field: string,
  blob: Blob,
  filename: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
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
  // ok:false 与非 2xx 都算失败（server 约定两者成对出现，双判是照 client.ts request 的口径）
  if (!res.ok || data.ok === false) throw new ApiError(String(data.message ?? `上传失败 HTTP ${res.status}`), res.status);
  return data;
}

async function post(path: string, field: string, blob: Blob, filename: string, timeoutMs: number): Promise<string> {
  const data = await postForm(path, field, blob, filename, timeoutMs);
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

// ── 白模模板的参考视频 ────────────────────────────────────────────────
//
// 专用端点，不复用 /media：方舟 r2v 只认 mp4/mov（/media 白名单里的 webm/ogg 传上去
// 也没用，会拖到用户**付费出片**那一步才 400），服务端还要把 Cloudinary 回执里的
// 时长/尺寸登记下来当 r2v 结算锚点——这些 /media 都没有。

/**
 * 白模视频的验收窗口 —— **服务端的唯一实现在 server `middleware/upload.js` 的
 * `templateVideoIssue`**（上传回执复核与建模板复核共用那一份）；这里是它的客户端
 * **镜像**（跨仓无法共码，改窗口两边一起改，契约见 docs/api-contract.md「白模模板」）。
 * 镜像存在的意义只是省用户一次 20MB 的白传——**作数的永远是服务端那份复核**。
 *
 * 各数值的出处（都不是拍脑袋）：
 *   [4,15]s   —— 下限 4 保住方舟 edit 子任务的时长窗口 [4,30]；上限 15 对齐
 *               Seedance 2.0 系列单发上限，且封住单次成本上界（输入时长计进 r2v token）。
 *   [300,6000] / 比例 [0.4,2.5] —— 方舟官方对输入视频的边长与宽高比约束。
 *   宽×高 ≥ 407,696 —— 2026-08-14 A2 探针第一发 400 实测出的**像素数硬门**
 *               （官方文档没写，方舟直接拒单）。
 */
export const TEMPLATE_VIDEO_RULES = Object.freeze({
  minSec: 4,
  maxSec: 15,
  minEdge: 300,
  maxEdge: 6000,
  minRatio: 0.4,
  maxRatio: 2.5,
  minPixels: 407_696,
});

/** mp4 / mov —— 方舟 r2v 官方只认这两种（与 server 的 ALLOWED_TEMPLATE_VIDEO_MIMES 镜像） */
const TEMPLATE_VIDEO_MIMES = ["video/mp4", "video/quicktime"];

export interface TemplateVideoProbe {
  /** File.type（浏览器报的 MIME） */
  mimeType: string;
  bytes: number;
  /** `<video>` metadata 探出来的本机值，只用于预检；登记值以服务端回执为准 */
  durationSec: number;
  width: number;
  height: number;
}

/**
 * 客户端预检：这个文件能不能当白模模板的参考视频。
 * @returns null = 过；字符串 = **能直接显示给用户的整句原因**（铁律八：每条不过
 *   都当场说明白，不让用户传完 20MB 才从服务端听到同一句话）。
 */
export function templateVideoPrecheckIssue(m: TemplateVideoProbe): string | null {
  const R = TEMPLATE_VIDEO_RULES;
  if (!TEMPLATE_VIDEO_MIMES.includes(m.mimeType)) {
    return `模板视频只收 mp4 / mov 格式（AI 出片引擎只认这两种），当前是 ${m.mimeType || "未知格式"}，请转码后重试。`;
  }
  if (m.bytes > MAX_TEMPLATE_VIDEO_BYTES) {
    return `视频文件最大 ${Math.round(MAX_TEMPLATE_VIDEO_BYTES / 1024 / 1024)}MB（当前约 ${(m.bytes / 1024 / 1024).toFixed(1)}MB）——白模是大色块画面，压缩率很高，压一下再来。`;
  }
  // ★ 取整口径与服务端一致（server 对 Cloudinary 回执做 Math.round）：本机探出 3.6s
  //   的视频服务端会按 4s 收，客户端不取整就会把它拦在门外——两边判出相反结论。
  const durationSec = Math.round(m.durationSec);
  const width = Math.round(m.width);
  const height = Math.round(m.height);
  if (!Number.isFinite(durationSec) || durationSec <= 0 || width <= 0 || height <= 0) {
    return "读不出这个视频的时长或尺寸（文件可能损坏），请换一个 mp4/mov 文件重试。";
  }
  if (durationSec < R.minSec) {
    return `模板视频至少要 ${R.minSec} 秒（当前约 ${durationSec} 秒）：低于 ${R.minSec} 秒会低于 AI 出片任务的时长下限。`;
  }
  if (durationSec > R.maxSec) {
    return `模板视频最长 ${R.maxSec} 秒（当前约 ${durationSec} 秒），请剪短后重试——模板越长，套用者每次出片的费用也越高。`;
  }
  if (width < R.minEdge || height < R.minEdge || width > R.maxEdge || height > R.maxEdge) {
    return `视频边长要在 ${R.minEdge}~${R.maxEdge} 像素之间（当前 ${width}×${height}），AI 引擎不接受这个尺寸。`;
  }
  if (width * height < R.minPixels) {
    return `视频分辨率太低：宽×高至少要 ${R.minPixels.toLocaleString("en-US")} 像素（当前 ${width}×${height} = ${(width * height).toLocaleString("en-US")}），AI 引擎会拒绝这样的输入。`;
  }
  const ratio = width / height;
  if (ratio < R.minRatio || ratio > R.maxRatio) {
    return `视频宽高比要在 ${R.minRatio}~${R.maxRatio} 之间（当前约 ${ratio.toFixed(2)}），过于细长的画幅 AI 引擎不接受。`;
  }
  return null;
}

/** 服务端登记回执。四个数值由服务端从 Cloudinary 上传回执读出（不信客户端报的任何数），
 *  客户端把它镜像进 `VideoTemplate.refVideo`——r2v 报价的输入时长只从这份镜像读。 */
export interface TemplateVideoReceipt {
  url: string;
  publicId: string;
  /** 整数秒（Cloudinary 回执口径） */
  durationSec: number;
  width: number;
  height: number;
  bytes: number;
}

/**
 * POST /api/uploads/template-video（requireAuth，服务端限流 3 次/分 + 10 次/天）。
 *
 * ★ 回包按**形状**验收，不信状态码（Capacitor SPA 回退恒 200 + HTML；老服务端回
 *   JSON 404 会在 postForm 里抛）。缺登记元数据 = 这份回执当不了 r2v 结算锚点，
 *   必须整句响亮拒绝——静默放行就是"存了个报不出价的模板"。
 */
export async function uploadTemplateVideo(file: File): Promise<TemplateVideoReceipt> {
  // 180s 与 /media 同口径（20MB 上限、慢网）
  const data = await postForm("/api/uploads/template-video", "video", file, file.name || "template.mp4", 180_000);
  const url = data.url;
  const publicId = data.publicId;
  const durationSec = Number(data.duration);
  const width = Number(data.width);
  const height = Number(data.height);
  const bytes = Number(data.bytes);
  if (
    typeof url !== "string" ||
    !url ||
    typeof publicId !== "string" ||
    !publicId ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0 ||
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    throw new ApiError("服务器没有返回这段视频的登记信息（可能是旧版服务端），白模模板没有创建。", 502);
  }
  return { url, publicId, durationSec, width, height, bytes: Number.isFinite(bytes) ? bytes : 0 };
}

/**
 * DELETE /api/uploads/template-video —— 回收**未登记成模板**的托管视频（孤儿治理）。
 *
 * ★ 为什么存在：上传成功 ≠ 建成模板。视觉分析挂了、登记一直失败后用户删掉本机模板、
 *   或干脆放弃 —— 不回收的话那段 20MB 级公开视频两端都没了句柄，配额只增不减零症状。
 *   已登记模板**不走这里**（服务端会整句拒），它的回收归 DELETE /api/branch/templates/:id 级联。
 * ★ 服务端按 public_id 前缀钉归属（只能删本账号传的），幂等（资源已不存在也算成功）。
 */
export async function deleteTemplateVideo(publicId: string): Promise<void> {
  const token = getToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/uploads/template-video`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ publicId }),
      signal: ctrl.signal,
    });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    throw new ApiError(aborted ? "回收超时" : "回收失败（网络不可用）", 0, aborted ? "TIMEOUT" : "NETWORK");
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* 非 JSON（SPA 回退/老服务端）：按形状判失败 */
  }
  if (data.ok !== true) {
    throw new ApiError(String(data.message ?? "这台服务器不支持回收模板视频（可能需要升级服务端）"), res.status);
  }
}
