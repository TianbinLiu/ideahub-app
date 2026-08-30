// 「出片技能」市场的 HTTP 客户端（↔ server 的 routes/agentSkill.routes.js）。
//
// ⚠⚠ 给技能加字段时**四处一起加**（CLAUDE.md 那条坑的本仓版）：server 的
//   `schemas/agentSkill.schemas.js`、`models/AgentSkill.js`、controller 的
//   `toSkillPayload`，以及**本文件**。漏任何一处的表现都是「客户端发了、服务端 201 了、
//   读回来是空的」——对技能来说就是"装回来是个空壳按钮"，全程零报错。
import { apiDelete, apiGet, apiPost } from "./client";
import type { AgentSkill } from "../data/agentSkills";

/** 服务端回包里的一条技能。★ 与本地 AgentSkill 差一个 id 命名（skillId ↔ id） */
export interface ApiSkill {
  skillId: string;
  title: string;
  intro: string;
  text: string;
  author: string;
  published: boolean;
  updatedAt?: string;
}

/** 服务端形状 → 本地形状。**唯一实现**：三个读点（mine/shared/install 回包）都走它 */
export function apiToSkill(a: ApiSkill): AgentSkill {
  return {
    id: a.skillId,
    title: a.title,
    intro: a.intro || "",
    text: a.text || "",
    author: a.author || "",
    published: !!a.published,
  };
}

function toBody(s: AgentSkill) {
  return {
    skillId: s.id,
    title: s.title,
    intro: s.intro || "",
    text: s.text,
  };
}

export async function fetchMySkills(): Promise<AgentSkill[]> {
  const r = await apiGet<{ ok: boolean; skills: ApiSkill[] }>("/api/branch/skills");
  return (r.skills || []).map(apiToSkill);
}

/** 广场。★ 不登录也能逛（服务端是 optionalAuth） */
export async function fetchSharedSkills(): Promise<AgentSkill[]> {
  const r = await apiGet<{ ok: boolean; skills: ApiSkill[] }>("/api/branch/skills/shared", { auth: false });
  return (r.skills || []).map(apiToSkill);
}

export async function pushSkill(s: AgentSkill): Promise<AgentSkill> {
  const r = await apiPost<{ ok: boolean; skill: ApiSkill }>("/api/branch/skills", toBody(s));
  return apiToSkill(r.skill);
}

export async function publishSkill(id: string, on: boolean): Promise<AgentSkill> {
  const path = `/api/branch/skills/${encodeURIComponent(id)}/publish`;
  const r = on
    ? await apiPost<{ ok: boolean; skill: ApiSkill }>(path)
    : await apiDelete<{ ok: boolean; skill: ApiSkill }>(path);
  return apiToSkill(r.skill);
}

/** 装一条广场上的技能。★ 幂等：装过就把自己那份原样回来（`alreadyInstalled`） */
export async function installSkill(id: string): Promise<{ skill: AgentSkill; already: boolean }> {
  const r = await apiPost<{ ok: boolean; alreadyInstalled?: boolean; skill: ApiSkill }>(
    `/api/branch/skills/${encodeURIComponent(id)}/install`,
  );
  return { skill: apiToSkill(r.skill), already: !!r.alreadyInstalled };
}

export async function deleteSkill(id: string): Promise<void> {
  await apiDelete(`/api/branch/skills/${encodeURIComponent(id)}`);
}
