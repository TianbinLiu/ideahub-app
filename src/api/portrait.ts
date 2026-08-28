// 真人肖像授权（方舟素材库）的 app 侧客户端 ↔ server 的 routes/arkPortrait.routes.js。
//
// ★ 这是「app 内授权」（LibTV 同款）的前端一半：请 server 生成邀约链接（渲染成二维码给
//   被拍者扫）、轮询授权状态拿 asset id。密钥全在服务端，app 只见链接与状态。
// ★ 未开通（服务端没配 AK/SK）时 server 回 503 —— 调用方据此退回"去方舟控制台手工创建
//   资产组 + 手工粘贴 asset id"那条老路（cardAsset 那颗手填按钮一直在）。
import { apiGet, apiPost } from "./client";

/** 一条邀约：uuid + 可渲染成二维码的 H5 链接 + 授权有效期（秒级时间戳） */
export interface PortraitInvite {
  uuid: string;
  url: string;
  startSec: number;
  endSec: number;
}

/**
 * 生成一条邀约。★ days 缺省交给服务端（与控制台默认 1 年一致）。
 * 失败（含未开通 503）会 throw ApiError —— 调用方 catch 后走手填退路。
 */
export async function createPortraitInvite(days?: number): Promise<PortraitInvite> {
  const r = await apiPost<{ ok: boolean; uuid: string; url: string; startSec: number; endSec: number }>(
    "/api/ark/portrait/invite",
    days ? { days } : {},
  );
  return { uuid: r.uuid, url: r.url, startSec: r.startSec, endSec: r.endSec };
}

/**
 * 资产组列表（**授权那一层**：授没授权、几个组）。
 * ⚠⚠ 组「已授权」**不等于**有素材能出片 —— 素材要单独过内容审核，可能整张失败而组照样
 *   写着 Authorized（2026-08-28 实测第一发就是）。要判"能不能出片"用 fetchPortraitAssets。
 * ★ items[] 仍是 `unknown[]`：这一层的消费方只用 totalCount，没有读字段的需求，
 *   写一份 TS 结构出来只会多一处要跟着方舟改的地方。
 */
export async function fetchPortraitGroups(): Promise<{ totalCount: number; items: unknown[] }> {
  const r = await apiGet<{ ok: boolean; totalCount: number; items: unknown[] }>("/api/ark/portrait/groups");
  return { totalCount: r.totalCount ?? 0, items: Array.isArray(r.items) ? r.items : [] };
}

/**
 * 一份可信素材。字段名 2026-08-28 用真授权逐字段实证（服务端已挑过字段、去掉了肖像直链）。
 */
export interface PortraitAsset {
  /** `asset-20260828131637-4872q` —— 出片时拼成 `asset://<id>` 的那个 */
  id: string;
  /** 上传时的文件名，用户用来认"这是哪一张" */
  name?: string;
  /** "Image" / 视频音频另有值 */
  assetType?: string;
  /** 所属资产组 `group-…` */
  groupId?: string;
  /**
   * 方舟给的状态。**只实证到 `"Failed"`**（成功那个字符串还没见过）——
   * 所以判读一律**判否定**：`status !== "Failed"` 才当可用，别去写 `=== "成功值"`。
   */
  status?: string;
  /** 审核失败的原因，**必须让用户看见**（否则就是"授权成功但用不了"的静默失败） */
  error?: { code?: string; message?: string };
  createTime?: string;
}

/**
 * 素材列表（**出片要用的 asset id 在这里**）。
 * @param groupId 只看某个资产组；不给 = 本账号全部真人肖像素材
 */
export async function fetchPortraitAssets(groupId?: string): Promise<{ totalCount: number; items: PortraitAsset[] }> {
  const q = groupId ? `?groupId=${encodeURIComponent(groupId)}` : "";
  const r = await apiGet<{ ok: boolean; totalCount: number; items: PortraitAsset[] }>(`/api/ark/portrait/assets${q}`);
  return { totalCount: r.totalCount ?? 0, items: Array.isArray(r.items) ? r.items : [] };
}

/**
 * 这份素材能不能拿去出片。**判据唯一实现** —— UI 与自动绑定都问它。
 * ★ 判否定：只有明确 `Failed` 才算不可用。成功态的字符串我们没见过，写白名单会把
 *   将来出现的新状态（Processing/Succeeded/…）一律误判成不可用，那是"功能突然没了"。
 */
export function assetUsable(a: PortraitAsset): boolean {
  return a.status !== "Failed";
}
