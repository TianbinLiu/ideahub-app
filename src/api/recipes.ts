// 「公开配方」（制作过程）服务端接口（挂在 /api/branch/videos/:id/recipe，对应 docs/api-contract.md「公开配方」）。
//
// ★ 这一层只做「HTTP ↔ DTO」，领域侧在 data/recipes.ts。
// ★ **判回包形状，不判状态码**（CLAUDE.md 那条铁律：Capacitor 对未命中路径回 200 + index.html）。
//   老服务端上「没有这个端点」如果只看状态码，会伪装成「这条作品没有公开制作过程」—— 一个我们真会显示给用户的状态。
import { apiDelete, apiGet, apiPatch, apiPut } from "./client";
import { readRecipe, type WorkflowRecipe } from "../data/recipe";

export interface ApiRecipeMeta {
  video: string;
  videoRevision: number;
  public: boolean;
  /** 描述的不是作品当下这一版（回炉之后还没换上新的）。★ 判否定：不发 = 不过期 */
  stale: boolean;
  bytes: number;
  nodeCount: number;
  /** 上架到了模板市场（工作流模板 = 上了架的公开配方，2026-10-02 P2）。判否定：老服务端不发 = 没上架 */
  listed: boolean;
  updatedAt: string | number;
}

/** 模板市场「工作流」货架上的一条（GET /api/branch/templates/workflows，不带正文） */
export interface ApiWorkflowTemplate {
  video: string;
  title: string;
  cover: string;
  author: { _id: string; username: string; displayName: string; avatarUrl: string };
  summary: { segs: number; totalSec: number; tiers: string[]; templated: number; cards: number; slots: number };
  remixCount: number;
  listedAt: string | number;
}

export interface ApiRecipe {
  recipe: WorkflowRecipe;
  meta: ApiRecipeMeta & {
    title: string;
    /** 示例视频（那条作品）的封面；老服务端不发 = 空串 */
    cover: string;
    author: { _id: string; username: string; displayName: string; avatarUrl: string };
    isOwner: boolean;
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function readMeta(raw: unknown): ApiRecipeMeta | null {
  if (!isRecord(raw)) return null;
  const video = raw.video;
  if (typeof video !== "string" || !video) return null;
  return {
    video,
    videoRevision: typeof raw.videoRevision === "number" ? raw.videoRevision : 0,
    public: raw.public === true,
    stale: raw.stale === true,
    bytes: typeof raw.bytes === "number" ? raw.bytes : 0,
    nodeCount: typeof raw.nodeCount === "number" ? raw.nodeCount : 0,
    listed: raw.listed === true,
    updatedAt: (raw.updatedAt as string | number) ?? 0,
  };
}

function readAuthor(raw: unknown): ApiWorkflowTemplate["author"] {
  const a = isRecord(raw) ? raw : {};
  return {
    _id: typeof a._id === "string" ? a._id : "",
    username: typeof a.username === "string" ? a.username : "",
    displayName: typeof a.displayName === "string" ? a.displayName : "",
    avatarUrl: typeof a.avatarUrl === "string" ? a.avatarUrl : "",
  };
}

/**
 * GET /api/branch/templates/workflows（optionalAuth）：工作流模板货架。
 * 回包形状认不出来回 null（= 这台服务器没有这条货架）；认得出来但是空的回 []。逐条验形状，坏的一条跳过。
 */
export async function listWorkflowTemplates(limit = 30): Promise<ApiWorkflowTemplate[] | null> {
  const res = await apiGet<unknown>(`/api/branch/templates/workflows?limit=${limit}`);
  if (!isRecord(res) || !Array.isArray(res.items)) return null;
  const out: ApiWorkflowTemplate[] = [];
  for (const raw of res.items) {
    if (!isRecord(raw) || typeof raw.video !== "string" || !raw.video) continue;
    const s = isRecord(raw.summary) ? raw.summary : {};
    out.push({
      video: raw.video,
      title: typeof raw.title === "string" ? raw.title : "",
      cover: typeof raw.cover === "string" ? raw.cover : "",
      author: readAuthor(raw.author),
      summary: {
        segs: Number(s.segs) || 0,
        totalSec: Number(s.totalSec) || 0,
        tiers: Array.isArray(s.tiers) ? s.tiers.filter((t): t is string => typeof t === "string") : [],
        templated: Number(s.templated) || 0,
        cards: Number(s.cards) || 0,
        slots: Number(s.slots) || 0,
      },
      remixCount: Number(raw.remixCount) || 0,
      listedAt: (raw.listedAt as string | number) ?? 0,
    });
  }
  return out;
}

const path = (videoId: string) => `/api/branch/videos/${encodeURIComponent(videoId)}/recipe`;

/**
 * GET（optionalAuth）。没有 / 没公开时服务端 404（`RECIPE_NOT_FOUND` / `RECIPE_NOT_PUBLIC`）—— apiGet 会**抛** ApiError，
 * 调用方按 `code` 分档。回包形状认不出来回 null（= 这台服务器没有这个端点）。
 */
export async function getRecipe(videoId: string): Promise<ApiRecipe | null> {
  const res = await apiGet<unknown>(path(videoId));
  if (!isRecord(res) || !isRecord(res.meta)) return null;
  const meta = readMeta(res.meta);
  const recipe = readRecipe(res.recipe);
  if (!meta || !recipe) return null;
  const a = isRecord(res.meta.author) ? res.meta.author : {};
  return {
    recipe,
    meta: {
      ...meta,
      title: typeof res.meta.title === "string" ? res.meta.title : "",
      cover: typeof res.meta.cover === "string" ? res.meta.cover : "",
      author: {
        _id: typeof a._id === "string" ? a._id : "",
        username: typeof a.username === "string" ? a.username : "",
        displayName: typeof a.displayName === "string" ? a.displayName : "",
        avatarUrl: typeof a.avatarUrl === "string" ? a.avatarUrl : "",
      },
      isOwner: res.meta.isOwner === true,
    },
  };
}

export interface PutRecipeBody {
  recipe: WorkflowRecipe;
  /** 这份配方描述的是作品的哪一版（对不上服务端 400 `RECIPE_REVISION_MISMATCH`） */
  videoRevision: number;
  public: boolean;
  /** 同时上架到模板市场（从属于 public；不带 = 不动原来的上架位） */
  listed?: boolean;
}

/** PUT（requireAuth + 仅作者，12/分钟）。400 的几种原因都带整句中文，调用方原样显示。形状认不出来回 null */
export async function putRecipe(videoId: string, body: PutRecipeBody): Promise<ApiRecipeMeta | null> {
  const res = await apiPut<unknown>(path(videoId), body, { timeoutMs: 60_000 });
  if (!isRecord(res) || !isRecord(res.recipe)) return null;
  return readMeta(res.recipe);
}

/**
 * PATCH（仅作者）：开 / 关公开，上 / 下架模板市场（至少给一样）。没有配方时服务端 404 `RECIPE_NOT_FOUND`（apiPatch 抛）；
 * 没公开 / 过期时要上架是 400 `RECIPE_NOT_LISTABLE`（整句中文，原样显示）
 */
export async function patchRecipe(videoId: string, patch: { public?: boolean; listed?: boolean }): Promise<ApiRecipeMeta | null> {
  const res = await apiPatch<unknown>(path(videoId), patch);
  if (!isRecord(res) || !isRecord(res.recipe)) return null;
  return readMeta(res.recipe);
}

/** DELETE（仅作者）。判回包形状（`ok: true`） */
export async function deleteRecipe(videoId: string): Promise<boolean> {
  const res = await apiDelete<unknown>(path(videoId));
  return isRecord(res) && res.ok === true;
}
