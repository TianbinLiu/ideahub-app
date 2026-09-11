// 结构化技能（2026-09-06，docs/competitor-canvas-skill-mapping.md §四 7，对标 updream 的 Skill：步骤 / 输出 schema / 何时要人点头）。
//
// 「出片技能」（data/agentSkills）是**一句话**——存下来、起个名、发布给别人；这里是一条**有形状**的流程：
//   输入 → 模型 → 形状检查（schema）→ 确认（人点头）→ 落地。
// 第一条官方技能「剧本 → 分镜字段」用来验证这个形状：整篇剧本拆成 N 段，每段带 types.ShotSpec（景别 / 运镜 /
// 情绪节拍）、时长与剧情，确认后铺成一条流水线（每段一套已挑定的方案，`plan:"picked"`，与做同款同一形状）。
//
// ★ 铺是**整表覆盖 nodes 的第九条入口**：守卫一律走 components/flow/useApplyTemplate（脏了先问、成了再断旧草稿、
//   在途出片不许换 —— 三件缺一不可，见 CLAUDE.md 那条）。本模块只出节点，不碰 seed。
// ★ 模型输出是不可信输入：parseShotPlan 逐段过形状（cleanShot 那种检查的整段版），不合的整段丢，一段不剩就当失败——
//   失败**不落地、不扣第二次钱**（钱在请求成功那一拍扣过一次，与 canvasAgent 同口径）。
// ★ 依赖方向：data → store → 组件。本模块认 flowStore（newFlowNode），组件（ScriptSkillSheet）认它；反过来绝不。
import { AI_REAL, VIDEO_PROMPT_MAX, canvasAgentChat } from "../ai";
import { canAfford, spendTokens } from "../data/account";
import { CHAT_TURN_TOKENS, clampDuration, fmtTokens } from "../data/economy";
import { cleanShot, uid, type Card, type Proposal, type ShotSpec, type VideoAspect } from "../types";
import { newFlowNode, type FlowNode } from "./flowStore";
import type { MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";

export type SkillStepKind = "input" | "model" | "check" | "confirm" | "apply";
export interface SkillStep {
  kind: SkillStepKind;
  /** 描述符（模块顶层不翻）：面板画步骤栏时再 t() */
  title: MessageDescriptor;
  hint: MessageDescriptor;
}

/** 拆出来的一段（模型输出过了形状检查之后的样子） */
export interface ShotPlanSeg {
  title: string;
  plot: string;
  durationSec: number;
  shot?: ShotSpec;
}
export interface ShotPlan {
  segments: ShotPlanSeg[];
}

/** 剧本上限（字）。★ 不是 VIDEO_PROMPT_MAX：那是**一段**提示词的顶，整篇剧本本来就该比它长 */
export const SCRIPT_MAX = 2000;
export const SCRIPT_MIN = 20;
/** 最多拆几段。与做同款 / 草稿一样铺进同一条流水线，段越多越难一次出对，先钉 8 */
export const SCRIPT_SEGMENTS_MAX = 8;

/**
 * 官方技能「剧本 → 分镜字段」的**形状**：steps 给面板画流程，confirmAt 说哪几步要人点头，cost 是一次运行的价签。
 * ★ 这是"结构化技能"的第一份实例；再加一条时先照它的字段来（步骤 / 形状检查 / 确认点 / 价签四件齐）。
 */
export const SCRIPT_TO_SHOTS = {
  id: "official.script-to-shots",
  title: msg`剧本 → 分镜字段`,
  intro: msg`整篇剧本拆成几段，每段带景别 / 运镜 / 情绪节拍与时长，看一遍再铺成一条流水线`,
  steps: [
    { kind: "input", title: msg`贴剧本`, hint: msg`一整篇（${SCRIPT_MIN}~${SCRIPT_MAX} 字），故事梗概或分场脚本都行` },
    { kind: "model", title: msg`拆分镜`, hint: msg`模型按段写：标题 / 剧情 / 时长 / 景别 · 运镜 · 情绪节拍` },
    { kind: "check", title: msg`形状检查`, hint: msg`不合形状的段整段丢掉；一段不剩就算失败，不落地` },
    { kind: "confirm", title: msg`你来点头`, hint: msg`看一遍再铺；铺是整表覆盖，现有流水线会先问你` },
    { kind: "apply", title: msg`铺进画布`, hint: msg`每段一套已挑定的方案，镜头字段进方案台与出片提示词` },
  ] satisfies readonly SkillStep[],
  confirmAt: ["confirm"] satisfies readonly SkillStepKind[],
  // ★ 价签 = 一次 chat 的定额：runScriptToShots 只发一次 canvasAgentChat，服务端按调用收 CHAT_TURN_TOKENS。
  //   原来按"两趟"标 800，按钮、余额门槛、离线记账都比实收高一倍（见 economy.ts 删 SCRIPT_SPLIT_TOKENS 那段 ★★）。
  cost: CHAT_TURN_TOKENS,
} as const;

/* i18n-frozen: 分镜师模型的系统提示词（规定输出的 JSON 形状），冻结中文 */
const SYS =
  `你是分镜师。把用户给的剧本拆成 2~${SCRIPT_SEGMENTS_MAX} 段首尾相接的视频镜头，按时间顺序、不跳时间线。` +
  `输出 JSON：{"segments":[{"title":"12字内标题","plot":"60-120字这一段的画面与动作，小说式，画面感强，写清人物在做什么","durationSec":3到10的整数,` +
  `"shot":{"size":"景别（远景/全景/中景/近景/特写）","camera":"运镜（固定/推/拉/摇/移/跟/环绕/手持，可带方向，6字内）","beat":"情绪节拍，6字内，如 压抑→爆发"}}]}。` +
  `只输出 JSON，不要解释。`;

/** 模型输出 → 形状检查（不可信输入：JSON 里什么都可能出现）。不合形状的段整段丢；一段不剩就 throw */
export function parseShotPlan(raw: string, tierId: string): ShotPlan {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!m) throw new Error(t`模型没有给出 JSON（换个说法或把剧本写具体些再试）`);
    try {
      data = JSON.parse(m[0]);
    } catch {
      throw new Error(t`模型给的 JSON 读不出来（再试一次）`);
    }
  }
  const arr = Array.isArray(data) ? data : (data as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(arr)) throw new Error(t`模型输出里没有 segments 数组`);
  const segments: ShotPlanSeg[] = [];
  for (const it of arr.slice(0, SCRIPT_SEGMENTS_MAX)) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const plot = typeof o.plot === "string" ? o.plot.trim().slice(0, VIDEO_PROMPT_MAX) : "";
    if (plot.length < 10) continue;
    const title = (typeof o.title === "string" ? o.title.trim() : "").slice(0, 12) || t`第 ${segments.length + 1} 段`;
    const durRaw = typeof o.durationSec === "number" ? o.durationSec : Number(o.durationSec);
    // 时长按档位夹（与报价 / 出片同一把尺 clampDuration）；给不出数的按 5 秒
    const durationSec = clampDuration(Number.isFinite(durRaw) && durRaw > 0 ? durRaw : 5, tierId);
    const shot = cleanShot(o.shot);
    segments.push({ title, plot, durationSec, ...(shot ? { shot } : {}) });
  }
  if (!segments.length) throw new Error(t`拆出来的段一段都不合形状（剧情太短或缺字段）——把剧本写具体些再试`);
  return { segments };
}

/**
 * 演示构建（没配 ARK_API_KEY）的本地降级：按句号切成最多 4 段，镜头字段按位置给个常见搭配。
 * 只为让流程能走通看形状，**不冒充模型**（面板会标「演示」）。
 */
function localSplit(script: string, tierId: string): ShotPlan {
  const parts = script
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const n = Math.min(4, Math.max(2, Math.ceil(parts.length / 2)));
  const per = Math.ceil(parts.length / n);
  // 演示档写进 ShotSpec 的是与模型输出同形的中文字段值（界面上的样子归 types.shotLineDisplay），不在这里翻
  const shots: ShotSpec[] = [
    // i18n-ignore-next-line: ShotSpec 字段值，与模型输出同形
    { size: "全景", camera: "缓推", beat: "铺垫" },
    // i18n-ignore-next-line: 同上
    { size: "中景", camera: "跟", beat: "推进" },
    // i18n-ignore-next-line: 同上
    { size: "近景", camera: "固定", beat: "对峙" },
    // i18n-ignore-next-line: 同上
    { size: "特写", camera: "环绕", beat: "释放" },
  ];
  const segments: ShotPlanSeg[] = [];
  for (let i = 0; i < n; i++) {
    const plot = parts.slice(i * per, (i + 1) * per).join("");
    if (plot.length < 10) continue;
    segments.push({ title: t`第 ${segments.length + 1} 段`, plot: plot.slice(0, VIDEO_PROMPT_MAX), durationSec: clampDuration(5, tierId), shot: shots[i % shots.length] });
  }
  if (!segments.length) throw new Error(t`剧本太短，切不出段`);
  return { segments };
}

/**
 * 跑「剧本 → 分镜字段」到确认之前：门禁（长度 / 余额）→ 模型 → 扣一次钱 → 形状检查。
 * onStep 报每一步的开始（面板的步骤栏据此亮灯）。失败整句 throw（铁律八）。
 */
export async function runScriptToShots(script: string, tierId: string, onStep: (kind: SkillStepKind) => void): Promise<ShotPlan> {
  const s = script.trim().slice(0, SCRIPT_MAX);
  if (s.length < SCRIPT_MIN) throw new Error(t`剧本太短（至少 ${SCRIPT_MIN} 字）`);
  if (AI_REAL && !canAfford(CHAT_TURN_TOKENS)) {
    const price = fmtTokens(CHAT_TURN_TOKENS);
    throw new Error(t`拆分镜要 ${price} token，余额不够——去「我的」页充值`);
  }
  onStep("model");
  if (!AI_REAL) {
    onStep("check");
    return localSplit(s, tierId);
  }
  const raw = await canvasAgentChat(SYS, s);
  spendTokens(CHAT_TURN_TOKENS); // 请求成功才扣（与 canvasAgent 同口径）；形状检查失败不退也不再扣
  onStep("check");
  return parseShotPlan(raw, tierId);
}

/** 确认之后：把分镜铺成节点（与 flowStore.remakeNodesOf 同一形状：单方案、已挑定、requirement = 剧情）。seed 由调用方经守卫做 */
export function shotPlanNodes(plan: ShotPlan, o: { tierId: string; aspect: VideoAspect; materials?: Card[] }): FlowNode[] {
  return plan.segments.map((sg, i) => {
    const p: Proposal = {
      id: uid("prop"),
      title: sg.title,
      plot: sg.plot,
      firstFrame: "",
      lastFrame: "",
      durationSec: sg.durationSec,
      ...(sg.shot ? { shot: sg.shot } : {}),
    };
    return newFlowNode(i, {
      proposals: [p],
      chosenId: p.id,
      plan: "picked",
      requirement: sg.plot,
      videoTier: o.tierId,
      aspect: o.aspect,
      ...(o.materials?.length ? { materials: o.materials } : {}),
    });
  });
}
