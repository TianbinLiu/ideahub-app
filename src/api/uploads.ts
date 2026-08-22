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
import { API_BASE, ApiError, apiPost, getToken } from "./client";

/** 与服务端 middleware/upload.js 的上限一致。超了就别发出去，省一次必然失败的往返 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
/**
 * 模板**原始素材**的大小上限。2026-08-15 白模 V2 从 20MB 放宽到 100MB —— 因为进方舟的
 * 不再是这个文件本身，而是编辑页框出来的那 5~30 秒（服务端拼 Cloudinary 变换现裁），
 * 原片是"素材库"不是"成品"，按成品的尺子量它等于逼用户先自己剪一遍。
 * ★ 服务端 nginx 的 `client_max_body_size` 必须 ≥110m，否则网络层直接掐断、
 *   浏览器只看到 `Failed to fetch`（发布体那条老坑的同款形状，见本文件头）。
 */
export const MAX_TEMPLATE_VIDEO_BYTES = 100 * 1024 * 1024;

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
  // ★★ 「是不是我们自己掐的」用**一面自己举的旗子**，不嗅探错误形状（2026-08-22 真机撞到）：
  //   原来判的是 `e instanceof DOMException && e.name === "AbortError"`，而 Android WebView
  //   在**上传中途**被 abort 时给的往往是 `TypeError: Failed to fetch` —— 于是自己的超时
  //   被报成「网络不可用」，而这两句话该让人往完全不同的方向查。
  //   ⚠ 这面旗子**不是**为 47MB 那次事故加的（那次真因是 CF 的 125 秒读超时，见下面
  //     ★★★，600 秒这道闸根本没轮到响）—— 我一度按时间巧合把它判成"自己掐的"，
  //     又判错了一次。留着它是因为**判据本身不该建立在错误对象的形状上**：
  //     同一个 abort，Chromium 在不同阶段给 DOMException 还是 TypeError 并不保证。
  //   ⚠ 旗子要在 `abort()` **之前**举 —— 回调是同步执行的，顺序反了就永远读到 false。
  let selfAborted = false;
  const timer = setTimeout(() => {
    selfAborted = true;
    ctrl.abort();
  }, timeoutMs);
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
    // 旗子优先；`AbortError` 只作补充（别处调 ctrl.abort() 时仍认得出来）
    const aborted = selfAborted || (e instanceof DOMException && e.name === "AbortError");
    // ★★ 把**这份文件多大**写进话里（2026-08-21 真机撞到）：47MB 那一发跑到 100 秒
    //   上下直接 reject，屏幕上只有"网络不可用"五个字 —— 而同一台设备、同一条 WiFi、
    //   同一分钟内 11.6MB 传得上去。
    //   ★★★ 真因已查实（2026-08-22，nginx `$request_time` 实证）：**Cloudflare 的
    //     Proxy Read Timeout = 125 秒**。三发连续复现，`rt=125.006 / 125.005 / 125.006`，
    //     精确到毫秒一致；`len` 只有 18~23MB（body 根本没传完）、`urt=-`（nginx 还在读
    //     body，压根没转发给 Node）。机理：nginx 默认 `proxy_request_buffering on`，
    //     **要把整个 body 收完才回包** ⇒ 整个上传期间 CF 看到的是"源站零响应" ⇒ 125 秒
    //     到点掐断。⇒ **这条路真正的天花板不是 100MB，是「125 秒内能推上去多少」**
    //     （实测那台手机 5G 上行 0.126MB/s ⇒ 约 15MB；WiFi 0.69MB/s ⇒ 约 86MB）。
    //     ⚠ 别再拿"路由不存在"的路径做探针：`/api/health` 收 POST 时 Express 立刻回 404、
    //     不等 body，CF 的读超时永远不触发 —— 我就是被这个无效对照骗过一次。
    //     ⚠ 也别升 CF 套餐：这个值**只有 Enterprise 能调**，Pro/Business 一样是 125 秒。
    //   fetch 对这两种情况给的都是一个 TypeError（`res.ok` 那条路根本走不到，状态码
    //   无从谈起），所以客户端**判不出来**。⇒ 不断言原因、不写死阈值，只把用户唯一
    //   能拿来判断的那个数给他，并给一条出路（铁律八：说清楚 + 给活路）。
    const mb = `${(blob.size / 1024 / 1024).toFixed(1)}MB`;
    throw new ApiError(
      aborted
        ? `上传超时：这份 ${mb} 在 ${Math.round(timeoutMs / 1000)} 秒内没传完。不是断网——` +
          `是这条网推不完这么大的文件（手机上行常见只有 1Mbps 上下，47MB 就要六分钟）。` +
          `换个更快的网络，或者先把视频压小再传。`
        : `上传失败（网络不可用）：这份 ${mb} 没能推上去。断网、慢网、或者传太久被中途掐断，都会是这一句；` +
          `传得越久越容易被掐 —— 先把视频压小一点再传，多半就过了。`,
      0,
      aborted ? "TIMEOUT" : "NETWORK",
    );
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

// ── 两个窗口，别混用（白模 V2 起）────────────────────────────────────
//
// ★★ 从这一版起「模板视频」有**两道**尺子，量的是两样东西：
//   ① 原始素材（本文件上传的那个文件）—— 宽松，它只是素材库；
//   ② 裁后那一段（编辑页框出来、真正进方舟 edit 的那 5~30 秒）—— 严，方舟的硬门全在这。
//   放宽 ① 的前提正是有了 ②：白模 V2 的输入是「任意视频 + 一个时间窗 + 一个裁剪框」，
//   服务端拼 Cloudinary 变换（`so_,du_,c_crop,x_,y_,w_,h_`）零成本现裁，原片本身不进方舟。
//   拿 ② 的尺子去量 ① 等于要求用户先自己剪好再来（那正是 V2 要免掉的一步）；
//   反过来只量 ① 就会把不满足 F3 的裁剪框放到付费出片那一步才被方舟 400。
// ★ 两个窗口的**唯一实现都在服务端**（`middleware/upload.js` 的 `templateSourceIssue`
//   与 `templateRefIssue`），这里是客户端**镜像**（跨仓无法共码）——
//   **改窗口两边一起改**，契约见 docs/api-contract.md「白模模板」。
//   镜像存在的意义只是省用户一次 100MB 的白传与一次必然失败的付费出片，
//   **作数的永远是服务端那份复核**。
// ★★ 本文件只放 ①。窗口 ② 的数在 `data/templates`（`ARK_EDIT_RULES` /
//   `BLOCKOUT_INPUT_RULES`），说人话的那一份在 `components/blockout/arkVideoRules`
//   （`selectionIssue`）—— 编辑页要的是"差多少、往哪拖"那种带着裁剪框语境的整句话。
//   **别在这里再写一份 [4,30]/[0.4,2.5]**：两份一起漂的时候没有任何症状，
//   只表现为界面放行、服务端整句拒（或更糟：界面拦下一个其实合法的选段）。
//   下面 minEdge / minPixels 这两个数是窗口 ② 的**必要条件投影**（裁剪面积 ≤ 原片面积），
//   动 `ARK_EDIT_RULES` 的这两项时这里要跟着动。
// ★★ **白模输入下限（5 秒）不在本文件**，虽然它确实是"上传之前就该拦下"的一条：
//   本文件是比 `data/` 更低的一层（只 import ./client），而那个下限与方舟窗口是一对
//   （判词里要同时说 5 和 4），住在 data/templates。让 uploads 去 import 它会成环
//   （uploads → arkVideoRules → data/templates → uploads，Vite 下拿到半初始化模块）。
//   所以那一条由白模路的宿主在**调用本函数之后、上传之前**紧接着问一次
//   （`VideoTemplateExtractor.pick` → `arkVideoRules.blockoutSourceDurationIssue`）——
//   止损点没有变晚，用户照样连 100MB 都不用传。

/**
 * ① 原始素材的验收窗口（`POST /api/uploads/template-video`）。
 *
 * 各数值的出处：
 *   (0,600]s   —— 2026-08-15 从 [4,15] 放宽：要处理的那一段由编辑页框选，原片不进方舟。
 *                 上限 10 分钟是"手机随手拍的一条"的量级，再长的片子裁一段本来就该先剪。
 *                 ⚠ 下限仍是**开区间 0**（不是白模那个 5）：V1 建模板走的是同一个上传口，
 *                 而 V1 把整段原片直接当参考视频用，4 秒的 V1 模板完全合法。白模那条路
 *                 的 5 秒下限由它自己的宿主紧接着问一次，见上面 ★★。
 *   边长 ≥300  —— 裁剪框只会更小，原片连 300 都不到就永远裁不出合规的一段（提前拦）。
 *                 **上限取消**：4K 原片裁出 720p 的一段是完全正常的用法。
 *   ★★★ **像素门 2026-08-17 从这里去掉了**（原来是 407,696，理由写作"裁剪面积 ≤ 原片面积"）。
 *     那个数是**方舟对参考视频**的约束，而 `POST /uploads/template-video/derive` 现在能
 *     在裁完之后按需**放大到刚过线** —— 于是"裁剪只会更小"这个前提不成立了。
 *     不去掉的话，一段 836×480 = 401,280 像素（只差 1.6%）的真实素材**连传都传不上来**，
 *     而它裁一段放大之后完全合格。
 *     ★ 够不够格改由**边长**判（≥300）：像素能靠放大补出来，边长补不出来
 *       —— 200×120 放大到 700×420 只是把马赛克放大，那种仍然在这里就拒。
 *     ⚠ 严窗口一点没松：裁出来的那一段仍要过服务端的 `templateRefIssue`（含像素门），
 *       V2 的框选也仍由 `arkVideoRules.selectionIssue` 当场判 —— 止损点没有变晚。
 *     ⚠ 与 server 的 `TEMPLATE_SOURCE_RULES` 是**跨仓镜像**：那边也去掉了这一项，
 *       两边必须同进同退（只改一边的表现是"界面放行、服务端拒"或反过来）。
 *   ⚠ **宽高比不校**：比例正是裁剪框能修的那一项（16:9 的原片裁出 9:16 竖版是主用法）。
 */
export const TEMPLATE_UPLOAD_RULES = Object.freeze({
  maxSec: 600,
  minEdge: 300,
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
 * 客户端预检：这个文件能不能当白模模板的**原始素材**（窗口 ①）。
 * @returns null = 过；字符串 = **能直接显示给用户的整句原因**（铁律八：每条不过
 *   都当场说明白，不让用户传完 100MB 才从服务端听到同一句话）。
 */
export function templateVideoPrecheckIssue(m: TemplateVideoProbe): string | null {
  const R = TEMPLATE_UPLOAD_RULES;
  if (!TEMPLATE_VIDEO_MIMES.includes(m.mimeType)) {
    return `模板视频只收 mp4 / mov 格式（AI 出片引擎只认这两种），当前是 ${m.mimeType || "未知格式"}，请转码后重试。`;
  }
  if (m.bytes > MAX_TEMPLATE_VIDEO_BYTES) {
    return `视频文件最大 ${Math.round(MAX_TEMPLATE_VIDEO_BYTES / 1024 / 1024)}MB（当前约 ${(m.bytes / 1024 / 1024).toFixed(1)}MB），请压缩或剪短后重试。`;
  }
  // ★★ **时长不取整**（2026-08-16 改）。以前这里跟着服务端做 `Math.round`，而服务端那个
  //   `Math.round` 正是白模事故的单点根因：`Math.round(3.712) === 4` 让"产出短于方舟下限"
  //   的模板一路绿灯落库，也让 3.6s 的原片被读成 4s 放行。服务端已经改成按真实小数判，
  //   客户端再取整就会重新制造"界面放行、服务端整句拒"（4.6s 取整成 5 过了本机、
  //   服务端按 4.6 拒）。宽高维持取整 —— 像素天然是整数。
  const durationSec = m.durationSec;
  const width = Math.round(m.width);
  const height = Math.round(m.height);
  if (!Number.isFinite(durationSec) || durationSec <= 0 || width <= 0 || height <= 0) {
    return "读不出这个视频的时长或尺寸（文件可能损坏），请换一个 mp4/mov 文件重试。";
  }
  if (durationSec > R.maxSec) {
    return `视频最长 ${Math.round(R.maxSec / 60)} 分钟（当前约 ${Math.round(durationSec)} 秒），请先剪短再上传。`;
  }
  // ★ 边长只有下限、比例不校：真正要满足方舟硬门的是**裁剪框框出来的那一块**
  //   （窗口 ②：components/blockout/arkVideoRules 的 selectionIssue）。这里拦的只是
  //   "裁剪框再怎么拉也不可能合规"的原片 —— 裁剪面积 ≤ 原片面积，所以下面两条是必要条件。
  if (width < R.minEdge || height < R.minEdge) {
    return `视频边长至少 ${R.minEdge} 像素（当前 ${width}×${height}）：比这更小的画面，裁剪框怎么拉都达不到 AI 引擎的下限。`;
  }
  return null;
}

/** 服务端登记回执。四个数值由服务端从 Cloudinary 上传回执读出（不信客户端报的任何数），
 *  客户端把它镜像进 `VideoTemplate.refVideo`——r2v 报价的输入时长只从这份镜像读。 */
export interface TemplateVideoReceipt {
  url: string;
  publicId: string;
  /**
   * 素材时长（秒）。★ **可能是小数**：服务端 2026-08-16 起不再对 Cloudinary 回执的
   * duration 取整（那个 `Math.round` 是白模事故的单点根因）。这里只当"画时间轴、
   * 判选段超不超片尾"的依据，不参与计价 —— 计价锚点是模板登记的 `refVideo.durationSec`。
   */
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
/**
 * 把已上传的素材**裁出框选那一段**（不够清晰时服务端顺带放大），落成一个新素材。
 *
 * ★★ 只交**四组整数**，变换 URL 由服务端自己拼（`buildClipUrl`，唯一实现）——
 *   与白模 V2 同一条纪律：能让客户端拼 URL，就等于让用户自己决定"方舟拿到多长"。
 *   这段视频将成为**别人套用时的 r2v 输入时长**（segmentCost 读 refVideo.durationSec），
 *   一样是钱。
 * ★ 放大由服务端按需要做（只放到刚过方舟那道像素门）：放大不会凭空变清楚，
 *   它解决的是"引擎拒收这个尺寸"。客户端不参与决定放多大。
 * ★ 裁后服务端用**参考视频那套严窗口**复核，不过就先回收再整句拒 ——
 *   所以这里失败一律把 message 原样显示，别自己编一句。
 */
export async function deriveTemplateVideo(
  publicId: string,
  clip: { startSec: number; durSec: number; crop: { x: number; y: number; w: number; h: number } },
): Promise<TemplateVideoReceipt> {
  const data = await apiPost<Record<string, unknown>>("/api/uploads/template-video/derive", {
    publicId,
    startSec: clip.startSec,
    durSec: clip.durSec,
    crop: clip.crop,
  });
  const url = String(data?.url ?? "");
  const newId = String(data?.publicId ?? "");
  const durationSec = Number(data?.durationSec);
  const width = Number(data?.width);
  const height = Number(data?.height);
  // ★ 按**回包形状**验收，不看状态码（Capacitor 那条坑：未命中路径回 200 + index.html）
  if (!url || !newId || !Number.isFinite(durationSec) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("裁剪没成功：服务器没有返回可用的视频信息（可能是旧版服务端）");
  }
  return { url, publicId: newId, durationSec, width, height, bytes: Number(data?.bytes) || 0 };
}

/**
 * 「这一发直传的票」—— 服务端签好、客户端**原样转发**的那一份。
 * ★ `params` 里有什么由服务端说了算（签名与要发的字段是同一个对象）：客户端自己拼、
 *   自己增删任何一项，Cloudinary 都只回一句 Invalid Signature，而那是最难查的一类错。
 */
interface DirectTicket {
  uploadUrl: string;
  publicId: string;
  params: Record<string, string | number | boolean>;
  chunkBytes: number;
  maxSizeBytes: number;
}

/**
 * 问服务端要一张直传票。
 * @returns null = **这台服务器还不支持直传**（老服务端）→ 调用方退回老路。
 *
 * ★ 判「支不支持」看**回包形状**不看状态码（CLAUDE.md 那条坑：Capacitor 的本地静态
 *   服务器对未命中路径回 200 + index.html）。这里两头都挡：抛错（真 404）与形状不对
 *   （HTML/老服务端）都当"不支持"，而**别的**错（401、限流 429）必须原样抛出去 ——
 *   把"你被限流了"吞成"退回老路"，用户会在老路上再撞一次 125 秒的墙。
 */
async function directTicket(): Promise<DirectTicket | null> {
  let data: Record<string, unknown>;
  try {
    data = await apiPost<Record<string, unknown>>("/api/uploads/template-video/sign", {});
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null; // 老服务端
    throw e;
  }
  const uploadUrl = String(data?.uploadUrl ?? "");
  const publicId = String(data?.publicId ?? "");
  const params = data?.params;
  const chunkBytes = Number(data?.chunkBytes);
  if (!uploadUrl.startsWith("https://") || !publicId || !params || typeof params !== "object") return null;
  if (!Number.isFinite(chunkBytes) || chunkBytes <= 0) return null;
  return {
    uploadUrl,
    publicId,
    params: params as Record<string, string | number | boolean>,
    chunkBytes,
    maxSizeBytes: Number(data?.maxSizeBytes) || 0,
  };
}

/** 一块的超时。★ 按**最慢的网**给：6MB 在 0.05MB/s 上要 120 秒，留一倍余量。
 *  分块最大的好处就在这儿 —— 超时是"每块"的，不再是"整发一个 600 秒"，
 *  47MB 在慢网上要走十分钟也不会有哪一次请求跑到那么久。 */
const CHUNK_TIMEOUT_MS = 240_000;

/**
 * 把一块推给 Cloudinary。用 XHR 不用 fetch —— **fetch 拿不到上传进度**，
 * 而这条路上用户要盯着看好几分钟，没有进度条就只能猜"是不是卡死了"。
 * @returns 末块回完整资产（含 secure_url），中间块回 `{done:false}`
 */
function putChunk(
  t: DirectTicket,
  blob: Blob,
  /** null = **整份一次发完**（不分块）。★ 官方 SDK 也是这么分的（upload vs upload_large）：
   *  一块就装得下时走普通上传，不去依赖"单块 Content-Range"那条我们没实测过的语义。 */
  range: { start: number; end: number; total: number } | null,
  uploadId: string,
  onBytes: (sentInThisChunk: number) => void,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", blob);
    // ★ 原样转发服务端给的每一项，一个不多一个不少（见 DirectTicket 的 ★）
    for (const [k, v] of Object.entries(t.params)) fd.append(k, String(v));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", t.uploadUrl);
    // ★★ 同一次上传的每一块必须带**同一个** X-Unique-Upload-Id，Cloudinary 靠它把
    //   多块归成一次上传；而 Content-Range 的 end 是**闭区间**的最后一个字节下标
    //   （写成 start+len 会得到 "Chunk size doesn't match upload size"）。
    if (range) {
      xhr.setRequestHeader("X-Unique-Upload-Id", uploadId);
      xhr.setRequestHeader("Content-Range", `bytes ${range.start}-${range.end}/${range.total}`);
    }
    xhr.timeout = CHUNK_TIMEOUT_MS;
    xhr.upload.onprogress = (ev) => onBytes(ev.loaded);
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        /* 非 JSON：下面按状态码与形状报错 */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
      // Cloudinary 的错误体是 { error: { message } }，把它原样带出来 —— 自己编一句
      // 会把 "Invalid Signature" 这种一眼定位的信息盖掉
      const msg = String((body?.error as { message?: string } | undefined)?.message || `HTTP ${xhr.status}`);
      reject(new Error(`视频存储拒绝了这一段：${msg}`));
    };
    xhr.onerror = () => reject(new Error("上传中断了（网络不可用）"));
    xhr.ontimeout = () => reject(new Error("这一小段传了 4 分钟还没完成——网络太慢或不稳，换个网络再试"));
    // ★★ 关窗要真的把它停下来：不 abort 的话 XHR 会**在组件卸载之后继续跑**，
    //   最后在 Cloudinary 上落一份**没有任何人认得**的资产（本机没有 receipt ⇒
    //   dropReceipt 够不着它），配额只增不减、零症状。中途 abort 留下的是一次
    //   未完成的分块上传，Cloudinary 自己会清掉，比落一份完整孤儿好得多。
    if (signal) {
      if (signal.aborted) return reject(new DOMException("已取消", "AbortError"));
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
      xhr.onabort = () => reject(new DOMException("已取消", "AbortError"));
    }
    xhr.send(fd);
  });
}

/** 直传：串行推完每一块。★ 串行不并发 —— 官方 SDK 也是串行，乱序/并发官方没有承诺过。 */
async function putDirect(
  t: DirectTicket,
  file: File,
  onProgress?: (frac: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  // ★ 每次上传一个新的分组 id。crypto.randomUUID 在 Android WebView 上要 https 语境，
  //   Capacitor 的 https://localhost 满足；退路用随机数拼，别让它抛。
  const uploadId =
    typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  const total = file.size;
  // 一块就装得下 → 普通上传（见 putChunk 的 range 参数注释）
  if (total <= t.chunkBytes) {
    await putChunk(t, file, null, uploadId, (sent) => onProgress?.(Math.min(1, sent / total)), signal);
    onProgress?.(1);
    return;
  }
  let start = 0;
  let doneBytes = 0;
  while (start < total) {
    const end = Math.min(start + t.chunkBytes, total); // 右开
    const blob = file.slice(start, end);
    // eslint-disable-next-line no-await-in-loop -- 串行是刻意的，见上面的 ★
    await putChunk(
      t,
      blob,
      { start, end: end - 1, total },
      uploadId,
      (sent) => onProgress?.(Math.min(1, (doneBytes + sent) / total)),
      signal,
    );
    doneBytes = end;
    onProgress?.(Math.min(1, doneBytes / total));
    start = end;
  }
}

/**
 * 直传完成后的服务端验收。★ 回执**只认服务端这一份** —— 客户端能直接和 Cloudinary
 * 对话，它手上那份回执完全可以伪造，而时长正是 r2v 的计价输入。
 *
 * ★★ 这一步**要重试**，理由与别处的"失败就报错"不同：字节已经全部推上去了（慢网上
 *   那是好几分钟），而 confirm 只是一个几百字节的请求。让一次网络抖动把几分钟的成果
 *   整个作废、还在 Cloudinary 上留下一份没人回收的孤儿，是明显不成比例的。
 * ★ 只重试**网络类**失败（NETWORK/TIMEOUT）。4xx 是服务端的定论（格式不对、时长不够、
 *   归属不符），它那边**已经 destroy 过了**，重试只会得到同一句话 —— 而且第二次会变成
 *   404「没找到这段视频」，把真正的原因盖掉。
 */
async function confirmDirect(publicId: string): Promise<TemplateVideoReceipt> {
  const waits = [0, 1_500, 4_000];
  let last: unknown;
  for (const wait of waits) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      return receiptOf(await apiPost<Record<string, unknown>>("/api/uploads/template-video/confirm", { publicId }));
    } catch (e) {
      last = e;
      const retriable = e instanceof ApiError && (e.code === "NETWORK" || e.code === "TIMEOUT");
      if (!retriable) throw e;
    }
  }
  // ★ 到这儿说明网络一直没回来。那份已经传上去的资产**没有任何人还认得它**
  //   （本机没有 receipt ⇒ 关窗时的 dropReceipt 够不着它）—— 兜底回收一次，
  //   失败也只吼不拦（回收是兜底不是主链路，与 dropReceipt 同一条纪律）。
  void deleteTemplateVideo(publicId).catch((e) =>
    console.error("[uploads] 直传后验收失败、兜底回收也失败（将留作孤儿）：", e),
  );
  throw new ApiError(
    `视频已经传上去了，但服务器一直没能确认（${last instanceof Error ? last.message : "网络不可用"}）。` +
      `网络恢复后请重新选一次文件再传——这一份已经作废，不会留在服务器上。`,
    0,
    "NETWORK",
  );
}

/** 回包 → 回执。两条路（老路的一次性上传、新路的 confirm）**共用这一份**验收：
 *  分叉的话就会出现"一条路进得来、另一条进不来"，而且两边各自看着都没错。 */
function receiptOf(data: Record<string, unknown>): TemplateVideoReceipt {
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
 * 上传一段视频当白模模板的**原始素材**。
 *
 * ★★★ 默认走**客户端签名直传 Cloudinary + 分块**，字节根本不经过我们的服务器与
 *   Cloudflare。为什么必须这样（2026-08-22 实证，别把它改回去）：
 *     · **Cloudflare 的 Proxy Read Timeout = 125 秒**，而 nginx 默认要把整个 body
 *       收完才回包 ⇒ 整段上传期间 CF 看到的是"源站零响应" ⇒ 125 秒一到就掐断。
 *       三发连续复现，`rt=125.006 / 125.005 / 125.006` 精确到毫秒一致。
 *     · 于是老路的真实上限**不是那个 100MB，是「125 秒内能推上去多少」**：
 *       实测手机 5G 上行 0.126MB/s ⇒ 约 15MB。而服务端还要同步等 Cloudinary
 *       吃完才回包（11.6MB 那发就占了约 79 秒），可用体积还要再打折。
 *     · 这个 125 秒**只有 Enterprise 套餐能调**，升 Pro/Business 一样是 125 秒。
 *   直传之后每一次 HTTP 请求都只是一小块（6MB 量级），跟 125 秒完全不沾边。
 *
 * ★ 老路**保留**并作为退路：新版 App 打到老服务端（`/sign` 回 404）时仍然能传
 *   ——只是仍然受 125 秒那道墙约束。判"支不支持"看回包形状不看状态码。
 * ★ 安全面全部落在服务端：public_id 由服务端生成并签死、`overwrite:false` 进签名、
 *   元数据以 confirm 里 Admin API 取回的那份为准。客户端这边**没有**任何一处值得信任。
 *
 * @param onProgress 0~1。直传才有真进度（XHR 的 upload.onprogress）；老路只有起止两点。
 */
export async function uploadTemplateVideo(
  file: File,
  onProgress?: (frac: number) => void,
  /** 关窗/卸载时传进来，真的把在途的那一块停下（见 putChunk 的 ★★） */
  signal?: AbortSignal,
): Promise<TemplateVideoReceipt> {
  const ticket = await directTicket();
  if (ticket) {
    // ★ 提前量：服务端 confirm 那一步还会按真实字节再判一次（客户端这份只是省用户时间）
    if (ticket.maxSizeBytes > 0 && file.size > ticket.maxSizeBytes) {
      throw new ApiError(
        `视频最大 ${Math.round(ticket.maxSizeBytes / 1024 / 1024)}MB（这份约 ${(file.size / 1024 / 1024).toFixed(1)}MB），请先压小再传。`,
        400,
      );
    }
    onProgress?.(0);
    await putDirect(ticket, file, onProgress, signal);
    return await confirmDirect(ticket.publicId);
  }
  // ── 退路：老服务端只有这条 ────────────────────────────────────────────
  // ★ 600s 不是 /media 那个 180s：上限从 20MB 提到 100MB 之后，慢网上光是把字节推上去
  //   就可能要几分钟。⚠ 但在 Cloudflare 后面它其实到不了 600 秒 —— 125 秒就被掐了
  //   （见上面的 ★★★）。这个数留着只是为了不比那道墙更早响。
  onProgress?.(0);
  const data = await postForm("/api/uploads/template-video", "video", file, file.name || "template.mp4", 600_000);
  onProgress?.(1);
  return receiptOf(data);
}

/**
 * DELETE /api/uploads/template-video —— 回收**未登记成模板**的托管视频（孤儿治理）。
 *
 * ★ 为什么存在：上传成功 ≠ 建成模板。视觉分析挂了、登记一直失败后用户删掉本机模板、
 *   或干脆放弃 —— 不回收的话那段 20MB 级公开视频两端都没了句柄，配额只增不减零症状。
 *   已登记模板**不走这里**（服务端会整句拒），它的回收归 DELETE /api/branch/templates/:id 级联。
 * ★ 服务端按 public_id 前缀钉归属（只能删本账号传的），幂等（资源已不存在也算成功）。
 * ★ 白模 V2 起还多一条拒绝：这个 publicId 被某个模板当 `source`（白模化的原始素材）
 *   引用时服务端 400 整句拒 —— 它的生命周期跟着那个模板走（删模板时级联回收）。
 *   所以「白模化失败后回收原始素材」这条路只在**没建成模板**时才走得通，正是我们要的。
 */
export async function deleteTemplateVideo(publicId: string): Promise<void> {
  const token = getToken();
  const ctrl = new AbortController();
  let selfAborted = false; // 同 postForm 的 ★★：别嗅探错误形状
  const timer = setTimeout(() => {
    selfAborted = true;
    ctrl.abort();
  }, 20_000);
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
    const aborted = selfAborted || (e instanceof DOMException && e.name === "AbortError");
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
