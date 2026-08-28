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
 * 资产组列表（查授权状态 / asset id）。
 * ⚠⚠ `items[]` 的字段名**尚未实证**（要等真有一条授权入库）——所以这里返回 `unknown[]`，
 *   刻意不硬造 TS 结构。真授权跑通后再定 asset id / 状态 / 演员名 的读法
 *   （docs/backlog.md §1.6 的 TODO）。硬造字段的下场是"看起来有值其实全 undefined"。
 */
export async function fetchPortraitGroups(): Promise<{ totalCount: number; items: unknown[] }> {
  const r = await apiGet<{ ok: boolean; totalCount: number; items: unknown[] }>("/api/ark/portrait/groups");
  return { totalCount: r.totalCount ?? 0, items: Array.isArray(r.items) ? r.items : [] };
}
