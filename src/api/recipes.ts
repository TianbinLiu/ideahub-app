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
  updatedAt: string | number;
}

export interface ApiRecipe {
  recipe: WorkflowRecipe;
  meta: ApiRecipeMeta & {
    title: string;
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
    updatedAt: (raw.updatedAt as string | number) ?? 0,
  };
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
}

/** PUT（requireAuth + 仅作者，12/分钟）。400 的几种原因都带整句中文，调用方原样显示。形状认不出来回 null */
export async function putRecipe(videoId: string, body: PutRecipeBody): Promise<ApiRecipeMeta | null> {
  const res = await apiPut<unknown>(path(videoId), body, { timeoutMs: 60_000 });
  if (!isRecord(res) || !isRecord(res.recipe)) return null;
  return readMeta(res.recipe);
}

/** PATCH（仅作者）：只开 / 关公开。没有配方时服务端 404 `RECIPE_NOT_FOUND`（apiPatch 抛） */
export async function patchRecipe(videoId: string, isPublic: boolean): Promise<ApiRecipeMeta | null> {
  const res = await apiPatch<unknown>(path(videoId), { public: isPublic });
  if (!isRecord(res) || !isRecord(res.recipe)) return null;
  return readMeta(res.recipe);
}

/** DELETE（仅作者）。判回包形状（`ok: true`） */
export async function deleteRecipe(videoId: string): Promise<boolean> {
  const res = await apiDelete<unknown>(path(videoId));
  return isRecord(res) && res.ok === true;
}
