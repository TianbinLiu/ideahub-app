// 「公开配方」（制作过程）的领域层：投影 + 上行 / 读回 / 开关。纯函数在 data/recipe.ts，HTTP 在 api/recipes.ts。
//
// ★ 结局**不压档**（CLAUDE.md「把 N 种结局压成两档」那格）：读回来有四种 —— 有 / 没有（没公开或没留存）/
//   这台服务器没有这个端点 / 没问到（网络）。前两种是产品状态，后两种是故障，各自说各自的话，
//   页面上「没问到」永远单列一句并配重试。
// ★ 上行只在两个时机发生：发布 / 回炉成功之后（data/projects.retain 顺手做，拿的是刚瘦身好的那份画布），
//   以及编辑页作者手动「公开制作过程」（从服务端取回留存的工程再投影）。两条都走 shareFromCanvas 一处。
// ★ 依赖方向：data 层，不引任何 store。
import { t } from "@lingui/core/macro";
import * as api from "../api/recipes";
import { ApiError } from "../api/client";
import { projectRecipe, type RecipeIssue, type WorkflowRecipe } from "./recipe";
import type { ApiRecipe, ApiRecipeMeta, ApiWorkflowTemplate } from "../api/recipes";
import { onViewerChange } from "./deviceOwner";

/**
 * 「这条作品的配方状态变了」的广播（公开成功 / 开关 / 删掉）。videos.ts 订阅它把缓存里那条作品的 `recipePublic` /
 * `recipeState` 改过来 —— 本文件不能引 videos（videos → projects → 本文件，反过来就是环），所以用订阅不用直调。
 * null = 配方没了。
 */
export type RecipeStateListener = (videoId: string, state: { public: boolean; stale: boolean; listed: boolean } | null) => void;
const listeners = new Set<RecipeStateListener>();
export function onRecipeStateChange(fn: RecipeStateListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function announce(videoId: string, state: { public: boolean; stale: boolean; listed: boolean } | null): void {
  for (const fn of listeners) fn(videoId, state);
}

export type ShareOutcome =
  | { ok: true; meta: ApiRecipeMeta }
  | {
      ok: false;
      /** unsupported = 这台服务器没有这个端点；projection = 画布投不出配方；rejected = 服务端整句拒；network = 没送到 */
      kind: "unsupported" | "projection" | "rejected" | "network";
      why: string;
    };

/** 投影失败那一句（原因代码 → 整句人话，与 data/recipe 的 RecipeIssue 一一对应） */
export function recipeIssueText(issue: RecipeIssue): string {
  switch (issue) {
    case "empty":
      return t`这条作品没有可公开的制作过程（画布是空的）`;
    case "too-many-nodes":
      return t`这条作品的流水线超过 24 段，制作过程暂时公开不了`;
  }
}

function why(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message.slice(0, 120) : String(e);
}

/**
 * 画布 → 配方 → PUT。`canvas` 必须是**瘦身过**的（只含永久地址）：发布链路上拿的是 projects.submit 刚算出来的那份，
 * 编辑页拿的是服务端留存的那份 —— 两条路进来的都已经干净了；带着本机地址来的投影会把那些画面丢掉，服务端也会整句拒。
 */
export async function shareFromCanvas(
  videoId: string,
  videoRevision: number,
  canvas: unknown,
  isPublic: boolean,
  /** 同时上架到模板市场（工作流模板）。不传 = 不动原来的上架位 */
  listed?: boolean,
): Promise<ShareOutcome> {
  const recipe = projectRecipe(canvas);
  if (typeof recipe === "string") return { ok: false, kind: "projection", why: recipeIssueText(recipe) };
  try {
    const meta = await api.putRecipe(videoId, { recipe, videoRevision, public: isPublic, ...(listed !== undefined ? { listed } : {}) });
    if (!meta) return { ok: false, kind: "unsupported", why: t`这台服务器还不支持公开制作过程` };
    cache.set(videoId, null); // 作者那一页读的是服务端那份，下次重取
    announce(videoId, { public: meta.public, stale: meta.stale, listed: meta.listed });
    shelf = null; // 货架缓存作废
    return { ok: true, meta };
  } catch (e) {
    if (e instanceof ApiError && e.status >= 400 && e.status < 500) return { ok: false, kind: "rejected", why: why(e) };
    return { ok: false, kind: "network", why: why(e) };
  }
}

export type RecipeFetch =
  | { state: "ok"; data: ApiRecipe }
  /** 没有（没公开 / 没留存）：服务端 404 带 code */
  | { state: "none"; code: string }
  | { state: "unsupported" }
  | { state: "failed"; why: string };

/** 本次会话里读过的（作品页 → 制作过程页 → 返回再进，不必再打一次）。null = 读过但要重取 */
const cache = new Map<string, ApiRecipe | null>();
// ★ 换人就整个清掉：回包里带着 `isOwner`（按谁在问算的），A 退出 B 登录后沿用 A 那份会把 B 当成作者 ——
//   制作过程页上冒出「这是你公开的制作过程，到编辑页可以关闭」（2026-10-02 浏览器里实测撞到）
onViewerChange(() => {
  cache.clear();
  shelf = null; // 货架按"这个人读得到的作品"筛，换人要重取
});

export async function fetchRecipe(videoId: string, opts?: { fresh?: boolean }): Promise<RecipeFetch> {
  if (!opts?.fresh) {
    const hit = cache.get(videoId);
    if (hit) return { state: "ok", data: hit };
  }
  try {
    const data = await api.getRecipe(videoId);
    if (!data) return { state: "unsupported" };
    cache.set(videoId, data);
    return { state: "ok", data };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      // 作品本身不存在也是 404（code NOT_FOUND）：对看配方的人来说同样是"没有"，code 带下去由页面分句
      return { state: "none", code: e.code || "NOT_FOUND" };
    }
    return { state: "failed", why: why(e) };
  }
}

/** 作者开 / 关公开。@returns null = 成了；字符串 = 整句人话 */
export async function setRecipePublic(videoId: string, on: boolean): Promise<string | null> {
  return patchRecipeState(videoId, { public: on });
}

/** 作者把制作过程上 / 下架到模板市场（工作流模板）。@returns null = 成了；字符串 = 整句人话（没公开 / 过期时服务端整句拒） */
export async function setRecipeListed(videoId: string, on: boolean): Promise<string | null> {
  return patchRecipeState(videoId, { listed: on });
}

async function patchRecipeState(videoId: string, patch: { public?: boolean; listed?: boolean }): Promise<string | null> {
  try {
    const meta = await api.patchRecipe(videoId, patch);
    if (!meta) return t`这台服务器还不支持公开制作过程`;
    cache.set(videoId, null);
    announce(videoId, { public: meta.public, stale: meta.stale, listed: meta.listed });
    shelf = null;
    return null;
  } catch (e) {
    return why(e);
  }
}

// ── 模板市场的「工作流」货架 ─────────────────────────────────────────

export type WorkflowShelf =
  | { state: "ok"; items: ApiWorkflowTemplate[] }
  | { state: "unsupported" }
  | { state: "failed"; why: string };

/** 本次会话里读过的货架（上下架之后作废） */
let shelf: WorkflowShelf | null = null;

export async function fetchWorkflowTemplates(opts?: { fresh?: boolean }): Promise<WorkflowShelf> {
  if (!opts?.fresh && shelf && shelf.state === "ok") return shelf;
  try {
    const items = await api.listWorkflowTemplates();
    const next: WorkflowShelf = items ? { state: "ok", items } : { state: "unsupported" };
    if (next.state === "ok") shelf = next;
    return next;
  } catch (e) {
    return { state: "failed", why: why(e) };
  }
}

/** 作者把留存的制作过程整个删掉。@returns null = 成了；字符串 = 整句人话 */
export async function removeRecipe(videoId: string): Promise<string | null> {
  try {
    const ok = await api.deleteRecipe(videoId);
    if (!ok) return t`这台服务器还不支持公开制作过程`;
    cache.set(videoId, null);
    announce(videoId, null);
    return null;
  } catch (e) {
    return why(e);
  }
}

/** 给预览用：画布 → 配方（本机地址的画面也留着，只画不上行）。null = 投不出来 */
export function previewRecipe(canvas: unknown): WorkflowRecipe | null {
  const r = projectRecipe(canvas, { allowLocal: true });
  return typeof r === "string" ? null : r;
}
