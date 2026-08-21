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
import { CHAT_TURN_TOKENS, fmtTokens, proposalsCost } from "../data/economy";
import { browseTemplates, myTemplates } from "../data/templates";
import type { Card, VideoTemplate } from "../types";
import { chosenOf, clampCursor, nodeCost, nodeDone, planOf, tplOfNode, useFlow, type FlowNode } from "./flowStore";

/**
 * 会花钱/有后果的操作走**提案**：模型只许把它摆成一张确认卡（带价钱或后果原文），
 * 用户点了「执行」才真跑（executeAgentProposal）。
 * ★ cast 的 costLabel 不是价钱而是后果：合成点名句那一次 chat **明文不收费**
 *   （flowStore.applyCast 里那段 ★——两仓价目表逐条相等，不许单方面扣一笔），
 *   但它会整表覆盖映射并重写点名句，这才是要用户点头的原因。
 */
export interface AgentProposal {
  kind: "cast" | "derive" | "generate";
  /** 1 起。执行时按下标现取节点（提案挂着期间流水线可能被改，取不到就整句拒绝） */
  seg: number;
  /** cast 专用：本次**新增/改动**的映射（label → cardId）。执行时与该段现挂的合并 */
  map?: Record<string, string>;
  /** 确认卡正文 */
  display: string;
  /** 执行按钮上的价签（真花钱的）或后果（免费但覆盖） */
  costLabel: string;
  /**
   * 摆这张卡时算出的**报价数值**（cast 为 0：那一次合成明文不收费）。
   * ★★ 存数值而不只是那句字符串，是因为它会**过期**：卡摆着不关，用户可以去方案台
   *   把时长 5s 改成 10s、换首尾帧、换一套方案 —— 计价输入全变了，而卡上的数字不会动。
   *   执行前用同一把尺重算一次，对不上就整句拒（executeAgentProposal 里那道闸）。
   *   报价 = 实扣是本仓铁律，一次点击扣掉标价两倍的钱是绝不能有的（对抗评审确认）。
   */
  cost: number;
}

export interface AgentOutcome {
  /** 给用户的一句话（模型的 say，或本地档的说明） */
  say: string;
  /** 落地成功的操作，每条一句人话 */
  applied: string[];
  /** 被拒绝的操作 + 整句原因（store 的原话优先） */
  refused: string[];
  /** 等用户点头的提案（确认卡） */
  proposals: AgentProposal[];
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
  | { op: "focus"; seg: number }
  | { op: "cast"; seg: number; map: Record<string, string> }
  | { op: "derive"; seg: number }
  | { op: "generate"; seg: number };

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
      // 角色位给**名字表**不是个数：cast 提案要按这些字样点名（挂了几个也一并给）
      ...(tpl?.roles?.length
        ? { 角色位: tpl.roles.map((r) => r.label).slice(0, 9), 已挂: Object.keys(n.cast ?? {}).length }
        : {}),
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
下面三个是【提案】：发出后不会立刻执行，界面会摆一张带价钱/后果的确认卡，用户点了才真跑——所以该提就提，别拦着：
{"op":"cast","seg":2,"map":{"角色位":"卡名"}} 给模板段挂角色卡换人（角色位用该段状态里「角色位」列的字样，卡名用「我的卡」里的；免费，但会重新合成点名句）
{"op":"derive","seg":1} 自选段按要求推演三套方案（花钱）
{"op":"generate","seg":1} 生成这一段视频（花钱；白模段要先挂过卡，自选段要先挑定方案）
挑方案只能用户自己来：推演完让他在本段编辑窗点「🎬 挑一套方案」（画布里就能挑，不必去线性视图）。
规则：信息不够或办不到就只回 say 说清楚，别猜。say 不超过 80 字，口语化，别复述 JSON。状态永远以「当前流水线状态」为准；【最近对话】只是记忆，段落可能已经变了。`;

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
          case "cast": {
            if (seg >= 1 && o.map && typeof o.map === "object" && !Array.isArray(o.map)) {
              const map: Record<string, string> = {};
              for (const [k, v] of Object.entries(o.map as Record<string, unknown>)) {
                if (typeof v === "string" && v.trim() && k.trim()) map[k.trim()] = v.trim().slice(0, 40);
              }
              if (Object.keys(map).length) ops.push({ op: "cast", seg, map });
            }
            break;
          }
          case "derive":
            if (seg >= 1) ops.push({ op: "derive", seg });
            break;
          case "generate":
            if (seg >= 1) ops.push({ op: "generate", seg });
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

/** 逐条落地（免费操作）/ 成卡（提案）。每条都现取 store（上一条可能改了段数），
 *  被拒就收 store 的整句。提案的验形也在这一轮做——按序：同一句里「先写要求再推演」
 *  是常见组合，require 落完 derive 才验得过 */
function applyOps(ops: Op[]): { applied: string[]; refused: string[]; proposals: AgentProposal[]; focusSeg?: number } {
  const applied: string[] = [];
  const refused: string[] = [];
  const proposals: AgentProposal[] = [];
  let focusSeg: number | undefined;
  /** 顺序门禁只问 clampCursor（唯一实现，铁律六）：还没轮到的段不接付费/挂卡提案 */
  const lockedAt = (seg: number) => clampCursor(useFlow.getState().nodes, seg - 1) !== seg - 1;
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

      // ── 以下三种成**提案卡**，不落地。验形失败按普通拒绝报 ──
      case "cast": {
        if (!tpl?.refVideo || !tpl.roles?.length) {
          refused.push(`第 ${o.seg} 段没有角色位（不是可换人的白模段），挂不了角色卡`);
          break;
        }
        if (lockedAt(o.seg)) {
          refused.push(`第 ${o.seg} 段还没轮到（前面的段先炼完才解锁）`);
          break;
        }
        const labels = new Set(tpl.roles.map((r) => r.label));
        const resolved: Record<string, string> = {};
        const shown: string[] = [];
        for (const [rawLabel, cardName] of Object.entries(o.map)) {
          // 模型爱把「1」说成「位置1/编号1」——剥前缀再对；对不上就整句报可用位子
          const bare = rawLabel.replace(/^(位置|编号)\s*/, "").trim();
          const hit = labels.has(rawLabel) ? rawLabel : labels.has(bare) ? bare : null;
          if (!hit) {
            refused.push(`第 ${o.seg} 段挂卡：这个模板没有「${rawLabel}」这个位子（有的是：${[...labels].slice(0, 9).join("、")}）`);
            continue;
          }
          const f = findCard(cardName);
          if (!f.c) {
            refused.push(`第 ${o.seg} 段挂卡：${f.issue}`);
            continue;
          }
          resolved[hit] = f.c.id;
          shown.push(`${hit} → ${f.c.name}`);
        }
        if (Object.keys(resolved).length === 0) break; // 原因都已逐条报过
        proposals.push({
          kind: "cast",
          seg: o.seg,
          map: resolved,
          display: `第 ${o.seg} 段挂角色卡：${shown.join("；")}${Object.keys(node.cast ?? {}).length ? "（该段其余已挂的位子保持不变）" : ""}`,
          costLabel: "免费 · 会重新合成点名句（覆盖你改过的字）",
          cost: 0,
        });
        break;
      }
      case "derive": {
        if (tpl?.refVideo) {
          refused.push(`第 ${o.seg} 段套着模板，白模段不走推演——挂完卡直接生成`);
          break;
        }
        if (lockedAt(o.seg)) {
          refused.push(`第 ${o.seg} 段还没轮到（前面的段先炼完才解锁）`);
          break;
        }
        if (node.status === "generating") {
          refused.push(`第 ${o.seg} 段正在生成，等它跑完`);
          break;
        }
        if (!(node.requirement ?? "").trim()) {
          refused.push(`第 ${o.seg} 段还没写拍摄要求——先说「第 ${o.seg} 段 拍什么」`);
          break;
        }
        const prev = o.seg >= 2 ? chosenOf(useFlow.getState().nodes[o.seg - 2]) : null;
        const carried = !!(node.chain && prev?.lastFrame);
        proposals.push({
          kind: "derive",
          seg: o.seg,
          display: `第 ${o.seg} 段按要求推演三套方案${planOf(node) ? "（会替换现有那三套）" : ""}`,
          costLabel: AI_REAL ? fmtTokens(proposalsCost(carried)) : "演示",
          cost: proposalsCost(carried),
        });
        break;
      }
      case "generate": {
        if (lockedAt(o.seg)) {
          refused.push(`第 ${o.seg} 段还没轮到（前面的段先炼完才解锁）`);
          break;
        }
        if (node.status === "generating") {
          refused.push(`第 ${o.seg} 段已经在生成了`);
          break;
        }
        const chosen = chosenOf(node);
        if (tpl?.refVideo) {
          if (!chosen.plot.trim()) {
            refused.push(`第 ${o.seg} 段还没有点名句——先挂卡（比如「第 ${o.seg} 段把 ${tpl.roles?.[0]?.label ?? "1"} 挂成某张卡」）`);
            break;
          }
        } else if (planOf(node) !== "picked" && !nodeDone(node)) {
          refused.push(`第 ${o.seg} 段还没挑定方案——先推演，再去顶栏「≡ 线性」的方案台挑一套`);
          break;
        }
        const cost = nodeCost(useFlow.getState().nodes, o.seg - 1, useFlow.getState().mode);
        proposals.push({
          kind: "generate",
          seg: o.seg,
          display: nodeDone(node) ? `第 ${o.seg} 段重新生成视频（旧成片作废）` : `第 ${o.seg} 段生成视频`,
          costLabel: AI_REAL ? fmtTokens(cost) : "演示",
          cost,
        });
        break;
      }
    }
  }
  return { applied, refused, proposals, focusSeg };
}

/** 多轮记忆：存的是**结果摘要**而不是模型原话——模型看见的是 store 真相
 *  （落地了什么、被拒了什么、用户点没点确认），比它自己上一句的口嗨可靠。
 *  模块级、上限 6 条：跨面板开合存续；段落漂移由每轮重发的快照纠正（SYSTEM 里说明了）。 */
const past: string[] = [];
function remember(line: string) {
  past.push(line.slice(0, 240));
  while (past.length > 6) past.shift();
}
function rememberOutcome(userText: string, r: Pick<AgentOutcome, "say" | "applied" | "refused" | "proposals">) {
  remember(`用户：${userText}`);
  remember(
    `结果：${r.say.slice(0, 60)}｜落地=${r.applied.join("；") || "无"}｜拒=${r.refused.join("；") || "无"}｜待确认提案=${r.proposals.map((p) => p.display).join("；") || "无"}`,
  );
}

/** 入口。计费与 NPC 聊天同口径：AI_REAL 且付得起才走大模型，**成功才扣**；
 *  否则本地档（免费）。模型回复解析不出 JSON → 当它在闲聊，原文给用户、不执行任何操作。 */
export async function runCanvasAgent(text: string): Promise<AgentOutcome> {
  const t = text.trim().slice(0, 300);
  if (!t) return { say: "", applied: [], refused: [], proposals: [], paid: false };
  const paid = AI_REAL && canAfford(CHAT_TURN_TOKENS);
  if (!paid) {
    const local = localParse(t);
    const r = applyOps(local.ops);
    const why = AI_REAL ? "余额不够 AI 指挥（400/句）。" : "";
    const out = { say: why + local.say, ...r, paid: false };
    rememberOutcome(t, out);
    return out;
  }
  let raw: string;
  try {
    raw = await canvasAgentChat(
      SYSTEM + (past.length ? "\n【最近对话与结果】\n" + past.join("\n") : "") + "\n当前流水线状态：" + snapshot(),
      t,
    );
  } catch (e) {
    // 网络/上游挂了：退本地档，但要说清这不是"办不了"而是"这一句没连上"
    const local = localParse(t);
    const r = applyOps(local.ops);
    const msg = e instanceof Error ? e.message : String(e);
    const out = { say: `AI 指挥没连上（${msg.slice(0, 60)}），先按本地句式办了能办的。`, ...r, paid: false };
    rememberOutcome(t, out);
    return out;
  }
  spendTokens(CHAT_TURN_TOKENS); // 请求成功才扣（与 chatToNpc 同口径）
  const parsed = parseReply(raw);
  if (!parsed) {
    // 模型没按协议来：不执行任何操作（宁可少办不乱办），原话给用户
    const out: AgentOutcome = {
      say: raw.replace(/\s+/g, " ").trim().slice(0, 160) || "（这一句我没听懂）",
      applied: [],
      refused: [],
      proposals: [],
      paid: true,
    };
    rememberOutcome(t, out);
    return out;
  }
  const r = applyOps(parsed.ops);
  const out = { say: parsed.say || (r.applied.length ? "办好了。" : "（没有可办的）"), ...r, paid: true };
  rememberOutcome(t, out);
  return out;
}

/**
 * 用户点了提案卡的「执行」。到这一刻才真跑——而且**重新走一遍 store 的全部闸**
 * （提案挂着期间流水线可能已被改：段删了、模板换了、正在生成…提案卡不是免检票）。
 * derive/generate 是分钟级长活：点火 + 短暂探一下有没有被同步闸拦下就返回，
 * 后续进度由本段编辑窗的 GenTrace 与全局出片胶囊接手（它们本来就是干这个的）。
 */
export async function executeAgentProposal(p: AgentProposal): Promise<{ ok: boolean; note: string }> {
  const st = () => useFlow.getState();
  const node = st().nodes[p.seg - 1];
  const fin = (ok: boolean, note: string) => {
    remember(`用户点了确认「${p.display.slice(0, 40)}」→ ${ok ? "✓" : "✗"}${note.slice(0, 80)}`);
    return { ok, note };
  };
  if (!node) return fin(false, `第 ${p.seg} 段已经不存在了（流水线被改过）`);

  if (p.kind === "cast") {
    // applyCast 作用于**光标段**（分段组各挂各的）：先把光标真挪过去，被夹住 = 还锁着
    st().setCursor(p.seg - 1);
    if (st().cursor !== p.seg - 1) return fin(false, `第 ${p.seg} 段还没轮到（前面的段先炼完），挂不了`);
    // 整表覆盖是 applyCast 的语义：与该段现挂的合并，提案里只带新改的那几位
    const merged = { ...st().cast, ...(p.map ?? {}) };
    const ok = await st().applyCast(merged);
    const s1 = st();
    if (!ok) return fin(false, s1.castErr || s1.err || "挂卡没成功（原因没说清——这是个 bug，请反馈）");
    const plot = chosenOf(s1.nodes[p.seg - 1]).plot;
    // applyCast 成功后 err 里可能躺着「挂卡已记下，但现在还出不了片：…」——原样带上
    return fin(true, `第 ${p.seg} 段挂好了，点名句已合成：「${plot.slice(0, 42)}…」${s1.err ? `。${s1.err}` : ""}`);
  }

  if (node.status === "generating") return fin(false, `第 ${p.seg} 段正在生成，等它跑完`);

  // ★★ 价签复核：卡摆着的这段时间里，用户完全可能去方案台改了时长/首尾帧/选中的走向，
  //   而那三样正是计价输入（nodeCost / proposalsCost 读的就是它们）。不复核的话，
  //   点下去扣的是新价、屏幕上写的是旧价 —— 报价 ≠ 实扣，且零报错。
  //   复核用**同一把尺**（不是另写一份算法），对不上就整句拒并请用户重说一句。
  {
    const prev = p.seg >= 2 ? chosenOf(useFlow.getState().nodes[p.seg - 2]) : null;
    const now =
      p.kind === "derive"
        ? proposalsCost(!!(node.chain && prev?.lastFrame))
        : p.kind === "generate"
          ? nodeCost(useFlow.getState().nodes, p.seg - 1, useFlow.getState().mode)
          : 0;
    if (now !== p.cost) {
      return fin(
        false,
        `这一段在确认之前被改过了（时长/画面/选中的走向变了）：现在要 ${fmtTokens(now)}，卡上写的是 ${fmtTokens(p.cost)}——重说一句，我按新价再摆一张卡`,
      );
    }
  }

  if (p.kind === "derive") {
    if (tplOfNode(node)?.refVideo) return fin(false, `第 ${p.seg} 段现在套着模板，不走推演（提案已过期）`);
    void st().deriveProposals(node.id);
  } else {
    void st().genNode(node.id);
  }
  // 同步闸（余额不够/门口拒绝）在第一拍就落状态：探一下再回话，别把"没点着火"说成"开始了"
  await new Promise((r) => setTimeout(r, 700));
  const after = st().nodes[p.seg - 1];
  if (after?.status === "generating") {
    return fin(
      true,
      p.kind === "derive"
        ? `第 ${p.seg} 段开始推演——好了之后在本段编辑窗点「🎬 挑一套方案」`
        : `第 ${p.seg} 段开始生成（要几分钟，可以先去逛，出片有胶囊通知）`,
    );
  }
  // 演示构建/极快返回：真办成了也可能已经收工，按**结果**认（别按状态认）
  if (after && p.kind === "generate" && nodeDone(after)) return fin(true, `第 ${p.seg} 段出片了`);
  if (after && p.kind === "derive" && planOf(after) === "picking") {
    return fin(true, `第 ${p.seg} 段推演好了——在本段编辑窗点「🎬 挑一套方案」`);
  }
  // ★★ 探不到就当**没点着**（原来这里无条件报成功）：genNode/deriveProposals 撞上
  //   全局 busy 时会早退，那一段一个 token 都没花 —— 报绿勾等于告诉用户"两段都在炼"，
  //   而实际只有一段在跑（对抗评审确认的静默失败）。store 有整句就用它的。
  return fin(false, st().err || `第 ${p.seg} 段没能开始（多半是有别的段正在生成）——等它跑完再说一次`);
}
