// 「提示词方案」市场的 HTTP 客户端（↔ server 的 routes/promptScheme.routes.js）。
//
// ⚠⚠ 给方案/图位加字段时**四处一起加**（CLAUDE.md 那条坑的本仓版）：server 的
//   `schemas/promptScheme.schemas.js`、`models/PromptScheme.js`、controller 的
//   `toSchemePayload`，以及**本文件**。漏任何一处的表现都是「客户端发了、服务端 201 了、
//   读回来是空的」——而对方案来说后果更刁钻：漏 `ref` 会让装回来的方案参考图从脸变成
//   主裁剪、漏 `fromCrop` 会让原本不花钱的那一格开始花钱，**全程零报错**。
// ★ 图位的 `id` **刻意不在**「四处一起加」的字段里（2026-09-11 多语言 PR2）：它是只活在客户端的身份
//   （草稿照片按它存，见 data/schemeSlotIds 文件头）。服务端 z.object 会 strip 掉它、toSchemePayload 也不回它，
//   所以每一次读都在 apiToScheme 里经 withSlotIds 重新算，upsertMine 再拿它与本机那份对齐。
//   发出去的请求照样带着 id（toBody 原样发），服务端丢掉而不是 400。给服务端加这一位要主人点头，而且用不着。
import { apiDelete, apiGet, apiPost } from "./client";
import { withSlotIds, type PromptScheme, type SchemeSlot } from "../data/promptSchemes";

/** 服务端回包里的一个图位：没有 id（服务端 strip 掉了，读进来由 withSlotIds 现算） */
export type ApiSchemeSlot = Omit<SchemeSlot, "id"> & { id?: unknown };

/** 服务端回包里的一套方案。★ 与本地 PromptScheme 差一个 id 命名（schemeId ↔ id） */
export interface ApiScheme {
  schemeId: string;
  title: string;
  intro: string;
  faceless: boolean;
  author: string;
  slots: ApiSchemeSlot[];
  examples: string[];
  published: boolean;
  updatedAt?: string;
}

/** 服务端形状 → 本地形状。**唯一实现**：三个读点（mine/shared/install 回包）都走它 */
export function apiToScheme(a: ApiScheme): PromptScheme {
  return {
    id: a.schemeId,
    title: a.title,
    intro: a.intro || "",
    author: a.author || "",
    faceless: !!a.faceless,
    // ★ 回包里的图位没有 id（服务端 strip 了）：在这里现算，三个读点因此都拿到带 id 的形状
    //   （"read"：这是读，不是存编辑屏的改动；与本机那份对齐由 upsertMine 的 prev 做）
    slots: withSlotIds(Array.isArray(a.slots) ? a.slots : [], "read"),
    examples: Array.isArray(a.examples) ? a.examples : [],
    published: !!a.published,
    // ★ builtin 恒 false：远端来的永远是"用户方案"，绝不能冒充内置那几套
    //   （内置的是模块常量，冒充了就会出现"改不动也删不掉的用户方案"）
    builtin: false,
  };
}

/** 本地形状 → 服务端入参。★ 图位原样发（六个字段一个不少，理由见文件头 ⚠⚠） */
function toBody(s: PromptScheme) {
  return {
    schemeId: s.id,
    title: s.title,
    intro: s.intro || "",
    faceless: !!s.faceless,
    slots: s.slots,
    ...(s.examples?.length ? { examples: s.examples } : {}),
  };
}

export async function fetchMySchemes(): Promise<PromptScheme[]> {
  const r = await apiGet<{ ok: boolean; schemes: ApiScheme[] }>("/api/branch/schemes");
  return (r.schemes || []).map(apiToScheme);
}

/** 广场。★ 不登录也能逛（服务端是 optionalAuth）——挑方案是决定要不要注册的一环 */
export async function fetchSharedSchemes(): Promise<PromptScheme[]> {
  const r = await apiGet<{ ok: boolean; schemes: ApiScheme[] }>("/api/branch/schemes/shared", { auth: false });
  return (r.schemes || []).map(apiToScheme);
}

export async function pushScheme(s: PromptScheme): Promise<PromptScheme> {
  const r = await apiPost<{ ok: boolean; scheme: ApiScheme }>("/api/branch/schemes", toBody(s));
  return apiToScheme(r.scheme);
}

export async function publishScheme(id: string, on: boolean): Promise<PromptScheme> {
  const path = `/api/branch/schemes/${encodeURIComponent(id)}/publish`;
  const r = on
    ? await apiPost<{ ok: boolean; scheme: ApiScheme }>(path)
    : await apiDelete<{ ok: boolean; scheme: ApiScheme }>(path);
  return apiToScheme(r.scheme);
}

/** 装一套广场上的方案。★ 幂等：装过就把自己那份原样回来（`alreadyInstalled`） */
export async function installScheme(id: string): Promise<{ scheme: PromptScheme; already: boolean }> {
  const r = await apiPost<{ ok: boolean; alreadyInstalled?: boolean; scheme: ApiScheme }>(
    `/api/branch/schemes/${encodeURIComponent(id)}/install`,
  );
  return { scheme: apiToScheme(r.scheme), already: !!r.alreadyInstalled };
}

export async function deleteScheme(id: string): Promise<void> {
  await apiDelete(`/api/branch/schemes/${encodeURIComponent(id)}`);
}
