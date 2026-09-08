// 「工坊工程」服务端接口（挂在 /api/branch/projects，对应 docs/api-contract.md）。
//
// 一条已发布作品对应至多一份工程（服务端按 video 唯一），存的是发布那一刻那份**瘦身过的
// 工坊画布**（只含永久 URL 的 JSON）。作者点「🛠 回炉重做」时把它取回工坊接着改。
//
// ★ 这一层只做「HTTP ↔ DTO」，不碰 IndexedDB / 内存缓存 —— 领域侧在 data/projects.ts。
// ★ **判回包形状，不判状态码**（CLAUDE.md 那条铁律）：Capacitor 的本地静态服务器对
//   未命中路径回 **200 + index.html**，`res.ok` 恒真。老服务端上「没有这个端点」如果只看
//   状态码，会伪装成「这条作品没有留存工程」（一个我们**真的会显示给用户**的状态），
//   于是用户对着一颗永远灰着的键找不出原因。所以每个函数都自己验形状，验不过回 null。
import { apiDelete, apiGet, apiPut } from "./client";

/** 工程列表项：**不含 canvas**（列表接口刻意不回正文，见服务端 §3.7） */
export interface ApiProjectMeta {
  video: string;
  title: string;
  bytes: number;
  /**
   * 这份画布描述的是作品的**哪一版**。
   *
   * ★★ 它是「陈旧画布」这一档**唯一**的检出信号，取回时必须与作品当下的 `revision` 比 ——
   *   对不上就不许铺进工坊（见 data/projects.loadProject 的 ★★）。作品的 `revision`
   *   挡的是**并发**（两台设备同时提交），它挡的是**陈旧**（画布是上一版），两回事。
   */
  videoRevision: number;
  /** 服务端说的「这份工程已经不描述作品当下那一版了」（回炉成功、客户端还没 PUT 新画布）。
   *  ★ 判否定：老服务端不发这一格 = 不过期。真正的判据是 `videoRevision`，这一格只用来说话。 */
  stale: boolean;
  /** 留存时有几处素材没能留下（回炉打开时那条 amber 横幅要如实报数） */
  lostCount: number;
  updatedAt: string | number;
}

export interface ApiProject extends ApiProjectMeta {
  /** 客户端定义形状、服务端只当 Mixed 存（见 data/projects.ts 的 CanvasSnapshot） */
  canvas: unknown;
}

export interface PutProjectBody {
  title: string;
  /** 这份画布描述的是作品的**哪一版**（并发支点仍然只有 BranchVideo.revision 一个） */
  videoRevision: number;
  lostCount: number;
  canvas: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 回包里那份 project 的形状检查。★ `video` 是字符串 id —— 认不出来就当这台服务器不支持 */
function readMeta(raw: unknown): ApiProjectMeta | null {
  if (!isRecord(raw)) return null;
  const video = raw.video;
  if (typeof video !== "string" || !video) return null;
  return {
    video,
    title: typeof raw.title === "string" ? raw.title : "",
    bytes: typeof raw.bytes === "number" ? raw.bytes : 0,
    videoRevision: typeof raw.videoRevision === "number" ? raw.videoRevision : 0,
    // ★ 判否定：老服务端不发这一格 = 不过期（缺失 = 老数据 = 否定）
    stale: raw.stale === true,
    // ★ 判否定：老服务端不发这一格 = 没有缺失（不是"未知"）—— 那条 amber 横幅宁可不出现，
    //   也不能凭空报一个数出来（本仓「不许拼一个骗人的数」那条）
    lostCount: typeof raw.lostCount === "number" ? raw.lostCount : 0,
    updatedAt: (raw.updatedAt as string | number) ?? 0,
  };
}

const path = (videoId: string) => `/api/branch/projects/by-video/${encodeURIComponent(videoId)}`;

/**
 * GET /api/branch/projects（requireAuth）→ 我留存过的全部工程（最多 200 条，无 canvas）。
 * @returns null = **这台服务器不支持**（回包形状认不出来）；数组 = 支持，可能是空的。
 *   ★ 两者必须分得开：前者要说「等服务器更新」，后者要说「这条作品没有留存工程」。
 */
export async function listProjects(): Promise<ApiProjectMeta[] | null> {
  const res = await apiGet<unknown>("/api/branch/projects");
  if (!isRecord(res) || !Array.isArray(res.items)) return null;
  return res.items.map(readMeta).filter((x): x is ApiProjectMeta => !!x);
}

/**
 * GET /api/branch/projects/by-video/:videoId（requireAuth + 仅作者）。
 * 没有这份工程时服务端 404 `PROJECT_NOT_FOUND` —— apiGet 会**抛** ApiError，
 * 调用方按 `code` 分档（"没有工程"与"取回失败"是两句完全不同的话）。
 */
export async function getProject(videoId: string): Promise<ApiProject | null> {
  const res = await apiGet<unknown>(path(videoId));
  if (!isRecord(res) || !isRecord(res.project)) return null;
  const meta = readMeta(res.project);
  if (!meta) return null;
  const canvas = (res.project as Record<string, unknown>).canvas;
  // ★ canvas 为空/缺失 = 这台服务器回的不是我们要的东西，别把一份空画布铺进工坊
  if (canvas === undefined || canvas === null) return null;
  return { ...meta, canvas };
}

/**
 * PUT /api/branch/projects/by-video/:videoId（requireAuth + 仅作者，12/分钟）。
 * ★ 不发 `bytes` / `owner`：服务端自己算、自己填，传了也会被 zod strip。
 * ★ 400 的四种原因（缺画布 / 画布里还有本机地址 / 太大 / 配额满）都带**整句中文**，
 *   调用方原样显示给用户，别自己另写一套话（铁律六：话也只该有一份）。
 */
export async function putProject(videoId: string, body: PutProjectBody): Promise<ApiProjectMeta | null> {
  const res = await apiPut<unknown>(path(videoId), body, { timeoutMs: 60_000 });
  if (!isRecord(res) || !isRecord(res.project)) return null;
  return readMeta(res.project);
}

/**
 * DELETE /api/branch/projects/by-video/:videoId（requireAuth + 仅作者）。作品本身不受影响。
 * ★ 判回包形状（`ok: true`），理由同 branch.deleteLanded：状态码在真机上不可信。
 */
export async function deleteProject(videoId: string): Promise<boolean> {
  const res = await apiDelete<unknown>(path(videoId));
  return isRecord(res) && res.ok === true;
}
