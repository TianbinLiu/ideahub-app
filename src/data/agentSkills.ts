// 「出片技能」：一条存好名字的 agent 指令 —— 本体就是发进画布输入条的那句话。
//
// ★★ 为什么值得成为实体：对画布说话（canvasAgent）已经能一句话铺段/套模板/圈选改写，
//   但好用的句子写完就沉进聊天记录。技能 = 把那句话存下来、起个名、可以发布给别人装
//   （§2.8-⑤ 的发布半）。**它不是新能力**：装回来的技能仍然要过 canvasAgent 的白名单
//   与确认卡 —— 别人写的句子和你自己打的字走完全同一条路，这正是安全边界所在。
//
// ★ 形状刻意照 data/promptSchemes.ts（本机库叶子 + 市场层单独成模块）：
//   本文件**只依赖 types**，联网那半边在 data/skillMarket.ts —— 环的教训见那边文件头。
//
// ⚠⚠ 给技能加字段时**四处一起加**（CLAUDE.md 那条坑的本仓版）：server 的
//   `schemas/agentSkill.schemas.js`、`models/AgentSkill.js`、controller 的
//   `toSkillPayload`，以及 api/skills.ts。漏任何一处 = 发了、201 了、读回来是空的，零报错。
import { VIDEO_PROMPT_MAX, uid } from "../types";

export interface AgentSkill {
  id: string;
  /** 名字（≤SKILL_TITLE_MAX）：显示在「/」面板的技能行上 */
  title: string;
  /** 一句话说清它干什么（可空） */
  intro: string;
  /** 本体：点一下就填进 agent 输入条的那句话（≤VIDEO_PROMPT_MAX，与输入条同顶） */
  text: string;
  /** 原作者显示名（装来的技能跟原作者走；自己建的可空） */
  author?: string;
  /** 已发布到广场（远端态的镜像）。★ 判**存在性**：老数据/离线恒缺省 = 没发布 */
  published?: boolean;
  createdAt?: number;
}

/** 名字上限。★ 跨仓镜像：server 的 agentSkill.schemas title max(20)，超了整发 400 */
export const SKILL_TITLE_MAX = 20;
/** 简介上限。同上跨仓镜像（intro max(120)） */
export const SKILL_INTRO_MAX = 120;

const LS_KEY = "ideahub.agentSkills";

let mine: AgentSkill[] = load();
const listeners = new Set<() => void>();
let version = 0;

function load(): AgentSkill[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(isUsable) : [];
  } catch {
    // 存坏了就当没有：技能库丢了只是少几条快捷句，不该让画布打不开
    return [];
  }
}

/** localStorage / 服务端读回来的都是不可信输入，形状不对整条丢 */
function isUsable(s: unknown): s is AgentSkill {
  const o = s as AgentSkill;
  return !!o && typeof o.id === "string" && typeof o.title === "string" && typeof o.text === "string" && !!o.text;
}

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(mine));
  } catch {
    /* 配额满：技能不是关键路径，丢了下次重存即可 */
  }
}

function emit() {
  version++;
  for (const fn of listeners) fn();
}

export function subscribeSkills(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function skillsVersion(): number {
  return version;
}

/** 我的技能（新的在前）。面板直接渲染它 */
export function mineSkills(): AgentSkill[] {
  return mine;
}

/**
 * 「这条技能能不能存」—— **唯一实现**（面板的保存入口与 saveSkill 都问它）。
 * null = 没问题，否则是一句给用户看的整句原因（铁律八）。
 *
 * ★ 正文顶就是输入条的顶（VIDEO_PROMPT_MAX）：存得下却发不出的技能是假承诺 ——
 *   server 的 SKILL_TEXT_MAX 也钉着同一个 400，超了整发 400 不是截断。
 */
export function skillIssue(d: { title?: string; text?: string; intro?: string }): string | null {
  if (!d.title?.trim()) return "先给这条技能起个名字";
  if (d.title.trim().length > SKILL_TITLE_MAX) return `技能名最多 ${SKILL_TITLE_MAX} 个字——太长会存不到服务器上`;
  if (!d.text?.trim()) return "技能的本体就是那句要发给画布的话，先把它写出来";
  if (d.text.trim().length > VIDEO_PROMPT_MAX)
    return `这句话超过 ${VIDEO_PROMPT_MAX} 字——输入条本来也发不出这么长，精简一下`;
  if ((d.intro || "").trim().length > SKILL_INTRO_MAX) return `简介最多 ${SKILL_INTRO_MAX} 个字`;
  return null;
}

/** 存一条自己的技能（新建或改）。返回落库那份；不合规抛整句原因 */
export function saveSkill(s: Omit<AgentSkill, "id"> & { id?: string }): AgentSkill {
  const issue = skillIssue(s);
  if (issue) throw new Error(issue);
  const next: AgentSkill = {
    ...s,
    id: s.id || uid("ask"),
    title: s.title.trim(),
    intro: (s.intro || "").trim(),
    text: s.text.trim(),
    createdAt: s.createdAt ?? Date.now(),
  };
  mine = [next, ...mine.filter((x) => x.id !== next.id)];
  persist();
  emit();
  return next;
}

export function removeSkill(id: string): void {
  mine = mine.filter((s) => s.id !== id);
  persist();
  emit();
}

// ── 给「市场」模块用的内部口子（形状与 promptSchemes 那组逐字对应）──────────

/** 落一份技能进本机库（装回来的、或推送后回写的）。同 id 覆盖，不重复堆 */
export function upsertMine(s: AgentSkill): void {
  mine = [s, ...mine.filter((x) => x.id !== s.id)];
  persist();
  emit();
}

/** 就地改某几位（例如回写 published）。找不到就静默 —— 清理路径不该吵 */
export function patchMine(id: string, patch: Partial<AgentSkill>): void {
  const i = mine.findIndex((x) => x.id === id);
  if (i < 0) return;
  mine = mine.map((x, k) => (k === i ? { ...x, ...patch } : x));
  persist();
  emit();
}

/** 让界面重渲染（市场层改了自己那份状态时调）。订阅源只有这一个 */
export function emitSkills(): void {
  emit();
}
