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
import { AI_REAL, VIDEO_PROMPT_MAX, skillChat } from "../ai";
import { canAfford, frozenNote, spendTokens } from "../data/account";
import { CHAT_TURN_TOKENS, clampDuration, fmtTokens, promptMaxOf } from "../data/economy";
import {
  SCENE_MAX,
  SCENE_MIN,
  SCENE_SHOTS_SYS,
  SceneShotsError,
  leadOf,
  parseSceneShots,
  sceneLang,
  sceneShotsBrief,
  shotBodyOf,
  type SceneNote,
  type SceneShotsErrorCode,
} from "../data/sceneShots";
import { SHOT_MAX, joinShots } from "../data/shotScript";
import { cleanShot, shotLineOf, uid, type Card, type Proposal, type ShotSpec, type VideoAspect } from "../types";
import { newFlowNode, nodeDone, tplOfNode, type FlowNode } from "./flowStore";
import { zhPrompt } from "../ai/prompts/zhPrompt";
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
 * 「拆分镜」那一发的输出上限（token）。★ 量出来的，不是拍的（2026-09-11 直连方舟 6 次，同一份 SYS、要 8 段）：
 *   1042 字剧本 → 741 / 787 / 816；1681 字剧本 → 925 / 807 / 774 —— 每段 93~116 token，**6 次里 3 次超过 800**。
 *   原来走 chat() 的 800 上限，超过的那一半被拦腰截断：JSON 解析失败、面板报"读不出来"，钱已经按 chat 计过。
 * ★ 取 2400：SYS 允许的最长写法（8 段 × 剧情 120 字）推到约 1,100，再留一倍余量。上限只是封顶 ——
 *   方舟按实际输出计费、服务端按调用定额收，没写满的部分谁都不花钱，用户价不变。
 */
const SCRIPT_SHOTS_MAX_TOKENS = 2400;
/** 超时：实测 13~18 秒吐完 8 段，按上限写满约 45 秒。取 170 秒 —— 必须比服务端 /api/ark 的 150 秒长：
 *  客户端先放弃的话，服务端照样跑完、照样计费，用户却收到一句失败（arkClient.generateImage 那段 ★ 同一个坑）。 */
const SCRIPT_SHOTS_TIMEOUT_MS = 170_000;

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
    throw new Error(frozenNote() ?? t`拆分镜要 ${price} token，余额不够——去「我的」页充值`);
  }
  onStep("model");
  if (!AI_REAL) {
    onStep("check");
    return localSplit(s, tierId);
  }
  const { text: raw, truncated } = await skillChat(SYS, s, { maxTokens: SCRIPT_SHOTS_MAX_TOKENS, timeoutMs: SCRIPT_SHOTS_TIMEOUT_MS });
  spendTokens(CHAT_TURN_TOKENS); // 请求成功才扣（与 canvasAgent 同口径）；截断 / 形状检查失败都不退也不再扣
  onStep("check");
  // ★ 顶到上限就别去解析半截 JSON：直接说清是"被截断"、并说出钱已经花了 —— 否则面板上只有一句"读不出来"，
  //   用户会以为是自己剧本写得不对、或者以为没扣钱（服务端按 chat 调用已经收过）。
  if (truncated) {
    const limit = SCRIPT_SHOTS_MAX_TOKENS;
    throw new Error(t`模型写到一半被截断了（输出超过 ${limit} token 的上限），这一次已经计费——把剧本删短一些或分两次拆再试`);
  }
  return parseShotPlan(raw, tierId);
}

// ── 官方技能二：「按主题改写全片剧本」（2026-10-02，模板体系 P3a，docs/template-workflow-research.md §七 A）──
//
// 按别人的流程做同款铺过来的每一段剧情还是原作的故事；经典配方模板当年靠 `{{主题}}` 一句话换主题解决这件事，
// 工作流模板没有它 —— 这条技能补上：一句主题 → 模型把每一段的剧情换成你的故事，**段数 / 顺序 / 镜头字段 / 时长 / 卡位不动**，
// 原 / 新逐段对照、点头才写回。只改**还没出片**的普通段与自定义段（白模段的 plot 是点名句、画面来自模板，跳过）。
// ★ 与「剧本 → 分镜」同一副骨架（步骤 / 形状检查 / 确认点 / 价签），同一条钱的规矩：请求成功那一拍扣一次，截断 / 形状检查失败不退也不再扣。
// ★ 落地只改 proposal 的 title / plot（updateProposal），requirement（用户原话）不动，出片 / 报价 / 承接一行不碰。

export const THEME_MIN = 2;
export const THEME_MAX = 200;
/** 一发最多改几段：段数再多输出就逼近上限、段与段之间开始互相串，多的分几发（每发各计一次 chat，面板先说清） */
export const REWRITE_SEGMENTS_PER_CALL = 12;
/**
 * 改写那一发的输出上限（token）。每段标题 + 剧情按最长写法（12 + 120 字）约 160 token，12 段 ≈ 1,900，取 2400 与「剧本 → 分镜」同一个数
 * （那一个是量过的：每段 93~116 token）。★ 真模型跑过之后再按实测收口（memory 里 ark 的三个脾气：重复键 / 不跟语言 / 输出长度）。
 */
const REWRITE_MAX_TOKENS = 2400;

export const THEME_REWRITE = {
  id: "official.theme-rewrite",
  title: msg`按主题改写全片剧本`,
  intro: msg`写一句你的主题，模型把每一段的剧情换成你的故事；段数、镜头字段、时长、卡位都不动，逐段对照再写回`,
  steps: [
    { kind: "input", title: msg`写主题`, hint: msg`一句话（${THEME_MIN}~${THEME_MAX} 字）：讲谁、讲什么、什么调子。已出片的段与白模段不会改` },
    { kind: "model", title: msg`改写`, hint: msg`模型逐段重写剧情与标题，段数与顺序不变，人物按挂着的卡来` },
    { kind: "check", title: msg`形状检查`, hint: msg`段数对不上就整发作废，不写回` },
    { kind: "confirm", title: msg`你来点头`, hint: msg`原 / 新逐段对照，不想改的段勾掉；点了才写回` },
    { kind: "apply", title: msg`写回各段`, hint: msg`只改剧情与标题；你的原话、镜头字段、时长、帧都不动` },
  ] satisfies readonly SkillStep[],
  confirmAt: ["confirm"] satisfies readonly SkillStepKind[],
  /** 一发的价签 = 一次 chat 定额；段数超过 REWRITE_SEGMENTS_PER_CALL 要几发就几份（rewriteCalls） */
  cost: CHAT_TURN_TOKENS,
} as const;

/** 送去改写的一段（从流水线上摘下来的那几格，不带帧） */
export interface RewriteSeg {
  nodeId: string;
  proposalId: string;
  /** 在流水线里的位置（从 0 起，给界面编号） */
  index: number;
  title: string;
  plot: string;
  shot?: ShotSpec;
  durationSec: number;
  /** 挂着的卡名（模型按它们写人物） */
  cards: string[];
}

export interface RewriteItem {
  nodeId: string;
  proposalId: string;
  index: number;
  title: string;
  plot: string;
}

export interface RewritePlan {
  items: RewriteItem[];
}

/** 当前流水线里能改的段：没出片、没在炼、不是白模段（白模段的 plot 是点名句，画面来自模板） */
export function rewritableSegs(nodes: FlowNode[]): RewriteSeg[] {
  const out: RewriteSeg[] = [];
  nodes.forEach((n, index) => {
    if (nodeDone(n) || n.status === "generating" || tplOfNode(n)?.refVideo) return;
    const p = n.proposals.find((x) => x.id === n.chosenId) ?? n.proposals[0];
    if (!p) return;
    out.push({
      nodeId: n.id,
      proposalId: p.id,
      index,
      title: p.title,
      plot: p.plot,
      ...(p.shot ? { shot: p.shot } : {}),
      durationSec: p.durationSec,
      cards: (n.materials ?? []).map((c) => c.name).filter(Boolean),
    });
  });
  return out;
}

/** 要几发（= 价签要乘几）*/
export function rewriteCalls(count: number): number {
  return Math.max(1, Math.ceil(count / REWRITE_SEGMENTS_PER_CALL));
}

/* i18n-frozen: 编剧模型的系统提示词（规定输出的 JSON 形状），冻结中文 */
const REWRITE_SYS =
  `你是编剧。用户给出一个新主题和一条已经分好段的视频流水线（每段的编号、标题、时长、镜头、出场的卡、原剧情）。` +
  `把每一段的剧情改写成新主题下的故事：段数、顺序与编号不变；每段保留原来镜头字段与时长对应的节奏（远景就写环境，特写就写表情）；` +
  `人物一律用给出的卡名，没有卡名就按主题起人物；每段剧情 60~120 字，小说式、画面感强、写清人物在做什么，不写镜头术语；标题 12 字内。` +
  `输出 JSON：{"segments":[{"index":编号,"title":"标题","plot":"剧情"}]}，段数必须与输入相同、编号一一对应。只输出 JSON，不要解释。`;

/** 发给模型的流水线清单（与系统提示词同一份冻结中文，zhPrompt 标签 = 不进目录、不翻） */
function rewriteBrief(theme: string, segs: RewriteSeg[]): string {
  const lines = segs.map((s, i) => {
    const shot = shotLineOf(s.shot);
    const title = s.title || zhPrompt`（无）`;
    const plot = s.plot || zhPrompt`（空）`;
    return (
      zhPrompt`${i + 1}. 标题：${title} 时长：${Math.round(s.durationSec)}秒` +
      (shot ? zhPrompt` 镜头：${shot}` : "") +
      (s.cards.length ? zhPrompt` 卡：${s.cards.join("、")}` : "") +
      zhPrompt`\n原剧情：${plot}`
    );
  });
  return zhPrompt`新主题：${theme}\n\n流水线（共 ${segs.length} 段）：\n${lines.join("\n")}`;
}

/**
 * 模型输出 → 形状检查（不可信输入）。段数必须等于送进去的段数：少一段整发作废（不落地，钱已扣）；
 * 每段 plot 非空、按 VIDEO_PROMPT_MAX 截。
 * ★ 方舟 chat 偶尔把数组写成一个对象里重复的键（少了 `},{`，JSON.parse 只留最后一对，memory ark-api-facts）——
 *   解析出来段数不够时按原文把 `"title"…"plot"` 成对捞回（与 cutProject.linePairs 同一招）。
 */
export function parseRewritePlan(raw: string, segs: RewriteSeg[]): RewritePlan {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let list: { title: string; plot: string }[] = [];
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) {
      try {
        data = JSON.parse(m[0]);
      } catch {
        data = null;
      }
    }
  }
  const arr = Array.isArray(data) ? data : data && typeof data === "object" ? (data as { segments?: unknown }).segments : null;
  if (Array.isArray(arr)) {
    list = arr.map((o) => {
      const r = o && typeof o === "object" ? (o as Record<string, unknown>) : {};
      return { title: typeof r.title === "string" ? r.title : "", plot: typeof r.plot === "string" ? r.plot : "" };
    });
  }
  if (list.length !== segs.length) {
    // 重复键那一档：按原文成对捞
    const pairs: { title: string; plot: string }[] = [];
    const re = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"plot"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) pairs.push({ title: unescapeJson(m[1]), plot: unescapeJson(m[2]) });
    if (pairs.length === segs.length) list = pairs;
  }
  if (list.length !== segs.length) {
    throw new Error(t`模型回的段数对不上（要 ${segs.length} 段，回了 ${list.length} 段），这一次没有写回——再试一次，或把主题写具体些`);
  }
  const items: RewriteItem[] = segs.map((s, i) => {
    const plot = list[i].plot.trim().slice(0, VIDEO_PROMPT_MAX);
    if (!plot) throw new Error(t`第 ${s.index + 1} 段改写出来是空的，这一次没有写回——再试一次`);
    const title = list[i].title.trim().slice(0, 40) || s.title;
    return { nodeId: s.nodeId, proposalId: s.proposalId, index: s.index, title, plot };
  });
  return { items };
}

function unescapeJson(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
}

/** 演示构建（没配 ARK_API_KEY）的本地降级：把主题标在每段开头，只为让流程能走通看形状，**不冒充模型**（面板标「演示」） */
function localRewrite(theme: string, segs: RewriteSeg[]): RewritePlan {
  return {
    items: segs.map((s) => ({
      nodeId: s.nodeId,
      proposalId: s.proposalId,
      index: s.index,
      title: s.title,
      plot: `【${theme}】${s.plot}`.slice(0, VIDEO_PROMPT_MAX),
    })),
  };
}

/**
 * 跑「按主题改写」到确认之前：门禁（长度 / 余额）→ 模型（段多分几发）→ 每发成功扣一次钱 → 形状检查。
 * onStep 报每一步的开始。失败整句 throw（铁律八）；几发里前面成功的那几发照样计费，话里要说清。
 */
export async function runThemeRewrite(theme: string, segs: RewriteSeg[], onStep: (kind: SkillStepKind) => void): Promise<RewritePlan> {
  const th = theme.trim().slice(0, THEME_MAX);
  if (th.length < THEME_MIN) throw new Error(t`主题太短（至少 ${THEME_MIN} 字）`);
  if (!segs.length) throw new Error(t`没有可改的段：已出片的段与白模段不会改`);
  const calls = rewriteCalls(segs.length);
  const price = CHAT_TURN_TOKENS * calls;
  if (AI_REAL && !canAfford(price)) {
    const p = fmtTokens(price);
    throw new Error(frozenNote() ?? t`改写要 ${p} token，余额不够——去「我的」页充值`);
  }
  onStep("model");
  if (!AI_REAL) {
    onStep("check");
    return localRewrite(th, segs);
  }
  const items: RewriteItem[] = [];
  for (let c = 0; c < calls; c += 1) {
    const chunk = segs.slice(c * REWRITE_SEGMENTS_PER_CALL, (c + 1) * REWRITE_SEGMENTS_PER_CALL);
    const { text: raw, truncated } = await skillChat(REWRITE_SYS, rewriteBrief(th, chunk), { maxTokens: REWRITE_MAX_TOKENS, timeoutMs: SCRIPT_SHOTS_TIMEOUT_MS });
    spendTokens(CHAT_TURN_TOKENS); // 这一发请求成功才扣；截断 / 形状检查失败不退也不再扣
    if (truncated) {
      const done = c;
      throw new Error(
        done > 0
          ? t`第 ${done + 1} 发写到一半被截断了（前 ${done} 发已经计费、这一发也计费了），这一次没有写回——把主题写短些再试`
          : t`模型写到一半被截断了，这一次已经计费、没有写回——把主题写短些再试`,
      );
    }
    onStep("check");
    items.push(...parseRewritePlan(raw, chunk).items);
  }
  return { items };
}

/** 确认之后：把勾选的段写回（只改 title / plot，认 node.id 与 proposal.id）。返回真写回的段数（世界会变：已出片 / 不在了的跳过） */
export function applyRewrite(plan: RewritePlan, picked: Set<string>, nodes: FlowNode[], update: (nodeId: string, patch: Partial<Proposal>, proposalId: string) => void): number {
  let n = 0;
  for (const it of plan.items) {
    if (!picked.has(it.nodeId)) continue;
    const node = nodes.find((x) => x.id === it.nodeId);
    if (!node || nodeDone(node) || node.status === "generating") continue;
    if (!node.proposals.some((p) => p.id === it.proposalId)) continue;
    update(it.nodeId, { title: it.title, plot: it.plot }, it.proposalId);
    n += 1;
  }
  return n;
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

// ── 官方技能三：「一场戏 → 多镜头」（2026-10-04，跟着做 B「主角定妆 · 多镜头」第③步，方案 docs/guided-modes-design.md §二 B）──
//
// 一两句话的一场戏 → **一段**视频里的 2~4 个镜头（景别 / 运镜 / 画面 / 台词挂说话人），落进分镜表逐格可改，点了才出片。
// 与「剧本 → 分镜」的分别：那条拆成好几**段**（各出各的片），这条是一段之内的几个镜头（一条出，updream 的做法）。
// ★ 与前两条同一副骨架（步骤 / 形状检查 / 确认点 / 价签），同一条钱的规矩：请求成功那一拍扣一次，截断 / 形状检查失败不退也不再扣。
// ★ 输入输出的规则在 data/sceneShots（纯函数，构建里 check-scene-shots.mjs 实跑）；几个镜头拼成一段话只走 shotScript.joinShots。

export const SCENE_TO_SHOTS = {
  id: "official.scene-to-shots",
  title: msg`一场戏 → 多镜头`,
  intro: msg`一两句话写一场戏，拆成一段视频里的 2~4 个镜头（景别 / 运镜 / 画面 / 台词），逐格可改再出片`,
  steps: [
    { kind: "input", title: msg`写这场戏`, hint: msg`一两句话（${SCENE_MIN}~${SCENE_MAX} 字）：在哪、谁做了什么、谁说了什么` },
    { kind: "model", title: msg`拆镜头`, hint: msg`模型按镜头写：景别 / 运镜 / 画面 / 台词（挂说话人）` },
    { kind: "check", title: msg`形状检查`, hint: msg`形状不对整发不认；多出来的镜头不收` },
    { kind: "confirm", title: msg`你来点头`, hint: msg`落进分镜表逐格可改，点了才出片` },
    { kind: "apply", title: msg`出片`, hint: msg`人物图直接给视频模型、不画帧，一条出` },
  ] satisfies readonly SkillStep[],
  confirmAt: ["confirm"] satisfies readonly SkillStepKind[],
  /** 一次 chat 的定额（服务端按调用收） */
  cost: CHAT_TURN_TOKENS,
} as const;

/**
 * 拆镜头那一发的输出上限（token）。按形状估：4 个镜头 ×（画面 60 字 + 两句台词各 20 字 + 景别运镜）+ 交代 40 字 ≈ 450 字，
 *   包上 JSON 约 600~800 token；取 1500 封顶。上限只是封顶，没写满的部分谁都不花钱（服务端按调用定额收）。
 * ★ 2026-10-05 B 付费验证实测一发：两个人、3 个镜头、2 句台词 → 输出 158 token（输入 336），远在上限之内。
 *   只量了一发，上限先不收：截断的代价是整发作废、钱已花，而上限高一点不多花一分钱。
 *   以后量够几发（照 SCRIPT_SHOTS_MAX_TOKENS 的量法，含 4 个镜头 + 英文）再收口；截断时如实说「被截断、已计费」，不去解析半截 JSON。
 */
const SCENE_SHOTS_MAX_TOKENS = 1500;

export interface SceneShotsResult {
  /** 落进分镜表的那一段话（整体交代 + 「镜头N：…」，shotScript.joinShots 拼的） */
  text: string;
  /** 收的时候处理掉的事（多出来的镜头、空画面、陌生说话人），界面说成句子 */
  notes: SceneNote[];
  /** 演示构建：本地按句号切的，不是模型写的（面板标「演示」） */
  demo: boolean;
}

/** 形状不对的那几种（data/sceneShots 抛 code）→ 人话。这一次都已经计费（请求成功那一拍扣过） */
function sceneShotsErrorText(code: SceneShotsErrorCode): string {
  switch (code) {
    case "noJson":
      return t`模型没有按格式回分镜，这一次已经计费——再拆一次，或把这场戏写具体些`;
    case "badJson":
      return t`模型回的分镜读不出来，这一次已经计费——再拆一次`;
    case "noShots":
      return t`拆出来的镜头一个都没写画面，这一次已经计费——把这场戏写具体些再拆`;
    case "dupKeys":
      return t`模型回的格式有问题（几个镜头或几句台词挤进了同一格），这一次已经计费——再拆一次`;
  }
}

/** 演示构建（没配 ARK_API_KEY）的本地降级：按句号切成最多两个镜头，只为让流程走通看形状，**不冒充模型**（面板标「演示」） */
function localScene(scene: string): string {
  const parts = scene
    .split(/(?<=[。！？!?.\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return scene;
  const half = Math.ceil(parts.length / 2);
  return joinShots({ lead: "", shots: [parts.slice(0, half).join(" "), parts.slice(half).join(" ")] });
}

/**
 * 跑「一场戏 → 多镜头」到确认之前：门禁（长度 / 余额）→ 模型 → 扣一次钱 → 形状检查 → 拼成一段话 → 核提示词上限。
 * 失败整句 throw（铁律八）；网络那一档的错原样抛，钱上的话由调用方经 ai/failCharge 说。
 * @param cast 出场人物的卡名（模型只用这几个名字写人物与说话人）
 */
export async function runSceneToShots(o: { scene: string; cast: readonly string[]; tierId: string; durationSec: number }): Promise<SceneShotsResult> {
  const scene = o.scene.trim().slice(0, SCENE_MAX);
  if (scene.length < SCENE_MIN) throw new Error(t`这场戏写得太短（至少 ${SCENE_MIN} 个字）——写清在哪、谁做了什么、谁说了什么`);
  if (AI_REAL && !canAfford(CHAT_TURN_TOKENS)) {
    const price = fmtTokens(CHAT_TURN_TOKENS);
    throw new Error(frozenNote() ?? t`拆镜头要 ${price} token，余额不够——去「我的」页充值`);
  }
  if (!AI_REAL) return { text: localScene(scene), notes: [], demo: true };
  const lang = sceneLang(scene);
  const { text: raw, truncated } = await skillChat(SCENE_SHOTS_SYS, sceneShotsBrief({ scene, cast: o.cast, durationSec: o.durationSec, lang }), {
    maxTokens: SCENE_SHOTS_MAX_TOKENS,
    timeoutMs: SCRIPT_SHOTS_TIMEOUT_MS,
  });
  spendTokens(CHAT_TURN_TOKENS); // 请求成功才扣（与另两条技能同口径）；截断 / 形状检查失败都不退也不再扣
  if (truncated) {
    const limit = SCENE_SHOTS_MAX_TOKENS;
    throw new Error(t`模型写到一半被截断了（输出超过 ${limit} token 的上限），这一次已经计费——把这场戏写短些再拆`);
  }
  let plan;
  try {
    plan = parseSceneShots(raw, o.cast, SHOT_MAX);
  } catch (e) {
    if (e instanceof SceneShotsError) throw new Error(sceneShotsErrorText(e.code));
    throw e;
  }
  const text = joinShots({ lead: leadOf(plan, lang), shots: plan.shots.map((s) => shotBodyOf(s, lang)) });
  // 拼出来的整段要放得进这一档的出片提示词（economy.promptMaxOf，与分镜表输入框同一个上限）：超了就别落进去 ——
  // 落进去之后输入框打不了字、出片时从正文那头被截掉一截（CLAUDE.md「输入框忘了 maxLength」那一格）
  const max = promptMaxOf(o.tierId);
  if (text.length > max) {
    const len = text.length;
    throw new Error(t`拆出来的分镜有 ${len} 字，超过这一档出片提示词的上限 ${max} 字，这一次已经计费——把这场戏写短些再拆`);
  }
  return { text, notes: plan.notes, demo: false };
}
