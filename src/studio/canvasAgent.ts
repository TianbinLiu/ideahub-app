// 画布指挥（「对画布说话」）：自然语言 → 工作流流水线操作。updream/LibTV 那类
// agent 画布的对齐件——差异在语汇：这里的指令单位是**模板与卡**（套模板、挂素材卡）。
//
// 三条不动摇的规则：
// · **只做不花钱的事**（写要求 / 套摘模板 / 挂摘素材卡 / 加删段 / 选段）。会花钱的
//   （推演、挂卡合成、出片）一律不代按——模型只能在回话里指路，按钮上都标着价钱。
//   模型的输出是不可信输入，钱上的闸必须在这一层（白名单 op 表），不能指望提示词。
// · **落地只走 flowStore 既有 action**：顺序门禁、已出片拒改、生成中拒改都在 store
//   里只有一处实现（铁律六），这里被拒就把 store 的整句原样报给用户，不另判一遍。
// · **降级不封口**：mock 构建 / 余额不足 / 回复解析不出来，都退到本地直白句式解析
//   （localParse）——能办多少办多少，并说清自己是哪一档（铁律八：不静默）。
import { AI_REAL, canvasAgentChat } from "../ai";
import { canAfford, myCards, spendTokens } from "../data/account";
import { CHAT_TURN_TOKENS } from "../data/economy";
import { browseTemplates, myTemplates } from "../data/templates";
import type { Card, VideoTemplate } from "../types";
import { chosenOf, nodeDone, planOf, tplOfNode, useFlow, type FlowNode } from "./flowStore";

export interface AgentOutcome {
  /** 给用户的一句话（模型的 say，或本地档的说明） */
  say: string;
  /** 落地成功的操作，每条一句人话 */
  applied: string[];
  /** 被拒绝的操作 + 整句原因（store 的原话优先） */
  refused: string[];
  /** 让 UI 打开某段编辑窗（0 起） */
  focusSeg?: number;
  /** 这一句真扣了钱（AI_REAL 且余额够且请求成功） */
  paid: boolean;
}

type Op =
  | { op: "require"; seg: number; text: string }
  | { op: "template"; seg: number; title: string }
  | { op: "untemplate"; seg: number }
  | { op: "cards"; seg: number; add?: string[]; remove?: string[] }
  | { op: "add_segment"; n?: number }
  | { op: "remove_segment"; seg: number }
  | { op: "focus"; seg: number };

/** 流水线现状 → 紧凑 JSON（进提示词）。截断都在这里做，别把整条 plot 灌给模型 */
function snapshot(): string {
  const s = useFlow.getState();
  const segs = s.nodes.map((n, i) => {
    const tpl = tplOfNode(n);
    const p = chosenOf(n);
    return {
      段: i + 1,
      模式: tpl?.refVideo ? `模板:${tpl.title}` : "自选",
      已出片: nodeDone(n),
      生成中: n.status === "generating",
      方案: tpl?.refVideo ? undefined : (planOf(n) ?? "还没推演"),
      要求: (tpl?.refVideo ? p.plot : (n.requirement ?? "")).slice(0, 40) || "（空）",
      素材卡: (n.materials ?? []).map((c) => c.name).slice(0, 8),
      ...(tpl?.roles?.length ? { 角色位: tpl.roles.length } : {}),
    };
  });
  const seen = new Set<string>();
  const tpls = [...myTemplates(), ...browseTemplates("")]
    .filter((t) => t.refVideo && !seen.has(t.id) && (seen.add(t.id), true))
    .slice(0, 15)
    .map((t) => t.title);
  const cards = myCards()
    .slice(0, 30)
    .map((c) => c.name);
  return JSON.stringify({ 流水线: segs, 可套的白模模板: tpls, 我的卡: cards });
}

const SYSTEM = `你是「启梦」App 工作流画布的指挥助手。用户对一条多段 AI 视频流水线下自然语言指令，你翻译成操作并回一句话。
只输出一个 JSON 对象（不要代码块、不要多余文字）：{"say":"...","ops":[...]}
可用操作（都不花钱；seg 从 1 数）：
{"op":"require","seg":1,"text":"这一段拍什么"} 给自选段写拍摄要求
{"op":"template","seg":2,"title":"模板名"} 给一段套白模模板（title 用「可套的白模模板」里的字样）
{"op":"untemplate","seg":2} 摘掉模板改自选
{"op":"cards","seg":1,"add":["卡名"],"remove":["卡名"]} 自选段挂/摘素材卡（用「我的卡」里的名字）
{"op":"add_segment","n":1} 在末尾加段
{"op":"remove_segment","seg":3} 删一段（已出片的会被拒）
{"op":"focus","seg":2} 打开某段编辑窗给用户看
会花钱的事你不能替用户按，只能在 say 里指路（按钮都标着价）：自选段写好要求后点编辑窗底部「🎲 推演三套方案」；推演完点顶栏「≡ 线性」进方案台挑一套；模板段换人点「给 N 个人偶挂上你的角色卡」；最后点「⚡ 生成本段」。
规则：信息不够或办不到就只回 say 说清楚，别猜。say 不超过 80 字，口语化，别复述 JSON。`;

/** 模型回复 → ops。找第一个 { 到最后一个 }，逐条按白名单验形；坏的丢掉不执行 */
function parseReply(raw: string): { say: string; ops: Op[] } | null {
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const j = JSON.parse(raw.slice(a, b + 1)) as { say?: unknown; ops?: unknown };
    const say = typeof j.say === "string" ? j.say.slice(0, 200) : "";
    const ops: Op[] = [];
    if (Array.isArray(j.ops)) {
      for (const o of j.ops as Array<Record<string, unknown>>) {
        if (!o || typeof o !== "object") continue;
        const seg = typeof o.seg === "number" ? o.seg : NaN;
        switch (o.op) {
          case "require":
            if (seg >= 1 && typeof o.text === "string" && o.text.trim()) ops.push({ op: "require", seg, text: o.text.trim().slice(0, 300) });
            break;
          case "template":
            if (seg >= 1 && typeof o.title === "string" && o.title.trim()) ops.push({ op: "template", seg, title: o.title.trim() });
            break;
          case "untemplate":
            if (seg >= 1) ops.push({ op: "untemplate", seg });
            break;
          case "cards": {
            const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 8) : undefined);
            const add = names(o.add);
            const remove = names(o.remove);
            if (seg >= 1 && (add?.length || remove?.length)) ops.push({ op: "cards", seg, add, remove });
            break;
          }
          case "add_segment":
            ops.push({ op: "add_segment", n: typeof o.n === "number" ? Math.min(5, Math.max(1, Math.floor(o.n))) : 1 });
            break;
          case "remove_segment":
            if (seg >= 1) ops.push({ op: "remove_segment", seg });
            break;
          case "focus":
            if (seg >= 1) ops.push({ op: "focus", seg });
            break;
        }
      }
    }
    return { say, ops: ops.slice(0, 10) };
  } catch {
    return null;
  }
}

/** 中文数字 → int（本地句式档用；只到十几，够指段号） */
function cnInt(s: string): number {
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return n;
  const M: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (s === "十") return 10;
  if (s.length === 2 && s[0] === "十") return 10 + (M[s[1]] ?? 0);
  if (s.length === 2 && s[1] === "十") return (M[s[0]] ?? 0) * 10;
  return M[s] ?? 0;
}

/** 离线/降级档：只认直白句式，能办多少办多少。规则窄一点没关系，**说清楚**最重要 */
function localParse(text: string): { say: string; ops: Op[] } {
  const ops: Op[] = [];
  // 「第N段 摘掉模板 / 换成XX模板 / 拍…」逐句拆（分号/句号/换行分隔）
  for (const part of text.split(/[;；。\n]/)) {
    const m = part.match(/第\s*([0-9一二两三四五六七八九十]+)\s*段\s*[:：,，]?\s*(.*)/);
    if (m) {
      const seg = cnInt(m[1]);
      const rest = m[2].trim();
      if (!seg || !rest) continue;
      const tplM = rest.match(/(?:换成|套上?|用)\s*(.+?)\s*(?:模板)?$/);
      if (/摘掉?模板|不用模板/.test(rest)) ops.push({ op: "untemplate", seg });
      else if (/模板/.test(rest) && tplM) ops.push({ op: "template", seg, title: tplM[1] });
      else ops.push({ op: "require", seg, text: rest });
      continue;
    }
    if (/加\s*([0-9一二两三]*)\s*段/.test(part)) {
      const n = cnInt(part.match(/加\s*([0-9一二两三]*)\s*段/)![1] || "1") || 1;
      ops.push({ op: "add_segment", n });
    }
  }
  return {
    say: ops.length
      ? "（本地档）按直白句式帮你办了下面这些。"
      : "（本地档）现在只认「第N段 拍什么」「第N段换成XX模板」「第N段摘掉模板」「加一段」这类直白句式。",
    ops,
  };
}

function findTemplate(title: string): { t?: VideoTemplate; issue?: string } {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, "");
  const key = norm(title);
  if (!key) return { issue: "模板名是空的" };
  const seen = new Set<string>();
  const all = [...myTemplates(), ...browseTemplates("")].filter(
    (t) => t.refVideo && !seen.has(t.id) && (seen.add(t.id), true),
  );
  const hits = all.filter((t) => norm(t.title).includes(key) || key.includes(norm(t.title)));
  if (hits.length === 1) return { t: hits[0] };
  if (hits.length === 0) return { issue: `没找到叫「${title}」的白模模板` };
  return {
    issue: `「${title}」有 ${hits.length} 个候选：${hits.slice(0, 3).map((t) => t.title).join("、")}${hits.length > 3 ? "…" : ""}。分段组的每段是独立模板，说全名（含第几段）再来`,
  };
}

function findCard(name: string): { c?: Card; issue?: string } {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, "");
  const key = norm(name);
  const hits = myCards().filter((c) => norm(c.name).includes(key) || key.includes(norm(c.name)));
  if (hits.length === 1) return { c: hits[0] };
  if (hits.length === 0) return { issue: `你的卡库里没有「${name}」` };
  return { issue: `「${name}」对上了 ${hits.length} 张卡（${hits.slice(0, 3).map((c) => c.name).join("、")}），说全名` };
}

/** 逐条落地。每条都现取 store（上一条可能改了段数），被拒就收 store 的整句 */
function applyOps(ops: Op[]): { applied: string[]; refused: string[]; focusSeg?: number } {
  const applied: string[] = [];
  const refused: string[] = [];
  let focusSeg: number | undefined;
  const nodeAt = (seg: number): FlowNode | null => useFlow.getState().nodes[seg - 1] ?? null;
  const storeErr = () => useFlow.getState().err || "被拒绝了（原因没说清——这是个 bug，请反馈）";

  for (const o of ops) {
    if (o.op === "add_segment") {
      for (let k = 0; k < (o.n ?? 1); k += 1) {
        const before = useFlow.getState().nodes.length;
        useFlow.getState().addNode();
        if (useFlow.getState().nodes.length > before) applied.push(`加了第 ${before + 1} 段`);
        else {
          refused.push(`加段：${storeErr()}`);
          break;
        }
      }
      continue;
    }
    if (o.op === "focus") {
      if (nodeAt(o.seg)) focusSeg = o.seg - 1;
      else refused.push(`选中第 ${o.seg} 段：流水线只有 ${useFlow.getState().nodes.length} 段`);
      continue;
    }
    const node = nodeAt(o.seg);
    if (!node) {
      refused.push(`第 ${o.seg} 段不存在（现在共 ${useFlow.getState().nodes.length} 段）`);
      continue;
    }
    const tpl = tplOfNode(node);
    switch (o.op) {
      case "require": {
        if (tpl?.refVideo) {
          refused.push(`第 ${o.seg} 段套着模板，要求由挂卡合成——想全手写就先说「第 ${o.seg} 段摘掉模板」`);
          break;
        }
        useFlow.getState().setRequirement(node.id, o.text);
        applied.push(`第 ${o.seg} 段：要求已写`);
        break;
      }
      case "template": {
        const f = findTemplate(o.title);
        if (!f.t) {
          refused.push(`第 ${o.seg} 段套模板：${f.issue}`);
          break;
        }
        if (useFlow.getState().setNodeTemplate(node.id, f.t)) applied.push(`第 ${o.seg} 段：套上「${f.t.title}」`);
        else refused.push(`第 ${o.seg} 段套模板：${storeErr()}`);
        break;
      }
      case "untemplate": {
        if (!tpl?.refVideo) {
          applied.push(`第 ${o.seg} 段本来就没套模板`);
          break;
        }
        if (useFlow.getState().setNodeTemplate(node.id, null)) applied.push(`第 ${o.seg} 段：摘掉模板，改为自选`);
        else refused.push(`第 ${o.seg} 段摘模板：${storeErr()}`);
        break;
      }
      case "cards": {
        // 与线性视图素材窗口同一条闸：V2 白模（有角色位）的 materials ≡ 挂卡结果，
        // 手动加删会造出「有图没人点名/有名没图」的静默换错人（FlowPage matWindow 的 ★★）
        if (tpl?.refVideo && tpl.roles?.length) {
          refused.push(`第 ${o.seg} 段是带角色位的白模段，素材由挂卡决定——用编辑窗里的挂卡入口`);
          break;
        }
        if (nodeDone(node)) {
          refused.push(`第 ${o.seg} 段已出片，改素材不会改变已生成的视频——想重做先在编辑窗重新生成`);
          break;
        }
        for (const name of o.add ?? []) {
          const f = findCard(name);
          if (!f.c) {
            refused.push(`第 ${o.seg} 段挂卡：${f.issue}`);
            continue;
          }
          const n2 = useFlow.getState().addMaterials(node.id, [f.c]);
          applied.push(n2 > 0 ? `第 ${o.seg} 段：挂上「${f.c.name}」` : `第 ${o.seg} 段：「${f.c.name}」本来就挂着`);
        }
        for (const name of o.remove ?? []) {
          const cur = nodeAt(o.seg)?.materials ?? [];
          const norm = (x: string) => x.toLowerCase().replace(/\s+/g, "");
          const hit = cur.find((c) => norm(c.name).includes(norm(name)) || norm(name).includes(norm(c.name)));
          if (!hit) {
            refused.push(`第 ${o.seg} 段没挂着「${name}」`);
            continue;
          }
          useFlow.getState().removeMaterial(node.id, hit.id);
          applied.push(`第 ${o.seg} 段：摘下「${hit.name}」`);
        }
        break;
      }
      case "remove_segment": {
        if (nodeDone(node)) {
          refused.push(`第 ${o.seg} 段已经出片：删掉它成片就没了，这一步不代劳——要删去线性视图自己按「🗑 删除本段」`);
          break;
        }
        useFlow.getState().removeNode(node.id);
        if (nodeAt(o.seg)?.id !== node.id) applied.push(`删掉了第 ${o.seg} 段`);
        else refused.push(`删第 ${o.seg} 段：${storeErr()}`);
        break;
      }
    }
  }
  return { applied, refused, focusSeg };
}

/** 入口。计费与 NPC 聊天同口径：AI_REAL 且付得起才走大模型，**成功才扣**；
 *  否则本地档（免费）。模型回复解析不出 JSON → 当它在闲聊，原文给用户、不执行任何操作。 */
export async function runCanvasAgent(text: string): Promise<AgentOutcome> {
  const t = text.trim().slice(0, 300);
  if (!t) return { say: "", applied: [], refused: [], paid: false };
  const paid = AI_REAL && canAfford(CHAT_TURN_TOKENS);
  if (!paid) {
    const local = localParse(t);
    const r = applyOps(local.ops);
    const why = AI_REAL ? "余额不够 AI 指挥（400/句）。" : "";
    return { say: why + local.say, ...r, paid: false };
  }
  let raw: string;
  try {
    raw = await canvasAgentChat(SYSTEM + "\n当前流水线状态：" + snapshot(), t);
  } catch (e) {
    // 网络/上游挂了：退本地档，但要说清这不是"办不了"而是"这一句没连上"
    const local = localParse(t);
    const r = applyOps(local.ops);
    const msg = e instanceof Error ? e.message : String(e);
    return { say: `AI 指挥没连上（${msg.slice(0, 60)}），先按本地句式办了能办的。`, ...r, paid: false };
  }
  spendTokens(CHAT_TURN_TOKENS); // 请求成功才扣（与 chatToNpc 同口径）
  const parsed = parseReply(raw);
  if (!parsed) {
    // 模型没按协议来：不执行任何操作（宁可少办不乱办），原话给用户
    return { say: raw.replace(/\s+/g, " ").trim().slice(0, 160) || "（这一句我没听懂）", applied: [], refused: [], paid: true };
  }
  const r = applyOps(parsed.ops);
  return { say: parsed.say || (r.applied.length ? "办好了。" : "（没有可办的）"), ...r, paid: true };
}
