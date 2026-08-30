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
import { AI_REAL, VIDEO_PROMPT_MAX, canvasAgentChat } from "../ai";
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
  /** 1 起。**只用来说人话**（"第 N 段"）；真正认哪一段看 nodeId */
  seg: number;
  /**
   * 摆这张卡时那一段的 node.id。
   * ★★ 认 id 不认下标（2026-08-21 对抗评审确认的 high）：卡摆着的时候用户可以在画布里
   *   删掉前面的段，下标会**整体前移** —— 那时按 `nodes[seg-1]` 取到的是**另一段**。
   *   三道闸一条都拦不住：越界检查过得去、status 无关、连价签复核也过得去
   *   （addNode 把 durationSec/videoTier/aspect 整套从上一段抄下来，兄弟段的价常常
   *   逐 token 相等）。后果是 genNode 打在用户没点头的那一段上：扣真钱、覆盖它已经
   *   花过钱的成片，回执还写着"第 3 段开始生成了"，全程零报错。
   */
  nodeId: string;
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
  /** local = 这条是**本地降级档**的正则分出来的（模型那条路不带）。applyOps 据此决定敢不敢
   *  覆盖已经写好的要求 —— 见那一支的 ★★ */
  | { op: "require"; seg: number; text: string; local?: boolean }
  | { op: "template"; seg: number; title: string }
  | { op: "untemplate"; seg: number }
  | { op: "cards"; seg: number; add?: string[]; remove?: string[] }
  | { op: "add_segment"; n?: number }
  | { op: "remove_segment"; seg: number }
  | { op: "focus"; seg: number }
  | { op: "cast"; seg: number; map: Record<string, string> }
  | { op: "derive"; seg: number }
  | { op: "generate"; seg: number };

/**
 * 「/」唤起面板的指令句式（AgentBar 用，2026-08-29，backlog 2.8-⑤ 的交互半：
 * updream 在对话里按 "/" 唤技能的形——这里唤起的是**本 agent 真听得懂的句式**）。
 *
 * ★★ 铁律六 + 铁律五的合订本：这张表必须与上面的 Op 白名单**同文件同批改**——
 *   句式只许覆盖 Op 里真有的动作。改 Op 时对着这张表过一遍；**绝不**把「改时长/换画幅/
 *   调画质」这类词条加进来：Op 里没有对应操作，两档都只能拒 —— 摆一个点了必拒的
 *   选项，就是 CLAUDE.md「永远点不动的选项」在词表上的变体（那三样的家在编辑窗 ⚙，
 *   agent 被问到时会指路过去）。
 * ★ 填空句是**起手**不是成品：插进输入框后用户接着改（补内容/换段号），所以句式停在
 *   自然的接写点上（「第N段拍」后面就是要写的画面）。
 * ★ seg 传 1 起的段号（调用方拿 cursor+1）。
 */
export const AGENT_PHRASES: ReadonlyArray<{ label: string; make: (seg: number) => string; hint: string }> = [
  { label: "✎ 拍摄要求", make: (s) => `第${s}段拍`, hint: "接着写这一段的画面" },
  { label: "🧪 套模板", make: (s) => `第${s}段套模板「」`, hint: "引号里填模板名（下面可直接点）" },
  { label: "🧪 摘掉模板", make: (s) => `第${s}段摘掉模板`, hint: "退回普通段" },
  { label: "🃏 挂卡换人", make: (s) => `第${s}段挂卡：角色位=卡名`, hint: "白模段用，改成真实角色位与卡名" },
  { label: "＋ 加一段", make: () => "加一段", hint: "在末尾追加" },
  { label: "🗑 删掉某段", make: (s) => `删掉第${s}段`, hint: "会先摆确认" },
  { label: "🎲 重演方案", make: (s) => `重新推演第${s}段的方案`, hint: "花钱操作，会先摆确认卡" },
  { label: "⚡ 生成本段", make: (s) => `生成第${s}段`, hint: "花钱操作，会先摆确认卡" },
];

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
            // ★ 与两个面的输入框同一个上限（VIDEO_PROMPT_MAX）：同一件事此前三个数
            //   （人手输入无上限、模型 300、线性 400），而这一串最终都进同一个提示词
            if (seg >= 1 && typeof o.text === "string" && o.text.trim())
              ops.push({ op: "require", seg, text: o.text.trim().slice(0, VIDEO_PROMPT_MAX) });
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

/**
 * 顺序门禁只问 `clampCursor`（唯一实现，铁律六）：还没轮到的段不接付费/挂卡提案。
 * ★ 模块级而不是藏在 applyOps 里：**摆卡时问一次、点「执行」前还要再问一次**
 *   （见 executeAgentProposal 里的 ★★）—— 两处必须是同一个判断，各写一份就会分叉。
 */
const lockedAt = (seg: number) => clampCursor(useFlow.getState().nodes, seg - 1) !== seg - 1;

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

/**
 * 「这句说的是**段的属性**，不是画面」的判据 —— 本地档办不了属性（时长/画幅/画质在编辑窗
 * 右上角的 ⚙ 里，删段在编辑窗底部），所以宁可说没听懂，也别把它当拍摄要求写进去。
 *
 * ★★ 判法是**剥词法**，不是匹配整句、更不是在句中找关键词（前两版各栽一次）：
 *   把"改动动词 + 属性名 + 属性值 + 语气助词"全部剥掉，**剩不下东西**才算属性指令。
 *   - 第一版在句中找关键词 → 「拍一只猫在**高清**屏幕前打滚」这类正常句子被整句打掉；
 *   - 第二版整句锚定但只允许一个属性词、前缀必须在句首 → 「时长改成8秒」「把画质改成电影级」
 *     「换成 1080p」全漏，而漏了就掉进 require **静默覆盖用户写好的一整段要求**。
 *   剥词法两头都稳：属性句剥完必然为空（它本来就只由这些词组成），而描述画面的句子
 *   剥完一定还剩主体（「镜头**横屏**移动」剩「镜头移动」、「**删掉**画面里的路人」剩「画面里路人」）。
 * ★ 判错的代价不对称，所以宁可漏判成"要求"也不能误判成"属性"？**反了** —— 恰恰相反：
 *   误判成属性只是白拒一次（用户一个字没丢，而且下面 attrSay 会告诉他去哪儿改）；
 *   漏判成要求会**静默整段覆盖**他写好的东西，不可撤销。所以剥词表宁可多收几个词。
 */
/**
 * 属性词表。★★ 必须是**正则字面量**，不许写成字符串再 new RegExp（第四轮验证栽过一次）：
 *   字符串里的 `\d` 在 JS 里是转义序列，运行时退化成字母 `d` —— 于是"数字+秒"那一档
 *   整个是死的，而且**没有任何症状**（构建过、类型过，只是永远匹配不上）。
 * ★ 带 `i`：不带的话「4K」「1080P」「10S」一个都不剥。
 */
const ATTR_TOKENS =
  /(时长|画幅|画质|清晰度|分辨率|竖屏|横屏|极速|标准|高清|超清|标清|原画|电影级|1080p|720p|2k|4k|删掉|删除|删了|去掉|短一?点|长一?点|\d+\s*(?:秒|s)|[一二两三四五六七八九十]+\s*秒)/gi;
/** 「这句里到底有没有属性词」。★ 从上面那条**派生**（`.source`），不是另抄一份 —— 带 `g`
 *  的正则 test 会推进 lastIndex，不能直接复用；而抄一份就是同一条规则的第二处实现。 */
const ATTR_HIT = new RegExp(ATTR_TOKENS.source, "i");
/** 改动动词与语气词。★ 只收**功能词**：像「画面」「视频」这种内容词一旦收进来，
 *  「删掉画面里的路人」会被剥成「里路人」而误判成属性指令。 */
const ATTR_VERBS =
  /(改成|换成|变成|设成|调成|设置成|设置为|设为|改为|换为|调到|加到|减到|弄成|调整成|改|换|设|调|弄|把|成|的|吧|了|呗|啊|嘛|请|麻烦|谢谢|帮我|给我|要|想|需要|稍微|大概|左右|再|一下)/gi;
/** 剥完还剩什么；只剩空白/标点 = 这句话整个就是一条属性指令 */
function attrLeftover(rest: string): string {
  return rest.replace(ATTR_TOKENS, "").replace(ATTR_VERBS, "").replace(/[\s，。、,.!！?？：:；;]/g, "");
}

/** 离线/降级档：只认直白句式，能办多少办多少。规则窄一点没关系，**说清楚**最重要 */
function localParse(text: string): { say: string; ops: Op[] } {
  const ops: Op[] = [];
  /** 认出是"第 N 段 …"、但那半句不敢当成拍摄要求的句子。宁可说没听懂，也别乱写（见下 ★★） */
  const unclear: string[] = [];
  /** 说的是段的属性（时长/画幅/画质/删段）—— 本地档办不了，但**知道去哪儿办**，要指路（铁律八） */
  const attrs: string[] = [];
  // 「第N段 摘掉模板 / 换成XX模板 / 拍…」逐句拆（分号/句号/换行分隔）
  for (const part of text.split(/[;；。\n]/)) {
    const m = part.match(/第\s*([0-9一二两三四五六七八九十]+)\s*段\s*[:：,，]?\s*(.*)/);
    if (m) {
      const seg = cnInt(m[1]);
      const rest = m[2].trim();
      if (!seg || !rest) continue;
      const tplM = rest.match(/(?:换成|套上?|用)\s*(.+?)\s*(?:模板)?$/);
      if (/(摘掉?|不用|去掉|去除|删掉|取消)模板/.test(rest)) ops.push({ op: "untemplate", seg });
      else if (/模板/.test(rest) && tplM) ops.push({ op: "template", seg, title: tplM[1] });
      // ★★ require **不是 catch-all**（2026-08-21 第六轮评审的完备性批评）：
      //   这一档不只在离线时走，`AI_REAL` 但**余额不足**也落到这里 —— 而那恰恰是用户
      //   最容易连说好几句的时候。原来凡是没命中模板关键词的一律当成"要求"，于是
      //   「第2段删掉」「第2段短一点」会把他精心写的那段要求整段替换成「删掉」，
      //   没有确认、没有撤销，回执还写着绿勾「按直白句式帮你办了下面这些」。
      //   ⚠ 光看开头那几个字不够（验证轮抓到）：「第2段**改成**10秒」「第2段**换成**高清」
      //   「第2段**变成**竖屏」说的是**这一段的属性**，不是画面 —— 而本地档办不了属性，
      //   于是照旧把整段要求替换成「改成10秒」。所以先按属性词判死，再谈是不是描述画面。
      // ★ 分档只问剥词法（见 ATTR_TOKENS 的 ★★）。原来那两条启发式（首字白名单
      //   `^(拍|画|讲|演|要)` 与 `length >= 8`）都已删掉：前者与「**画**质换成高清」
      //   「**要**删掉」正面撞车（首字命中就当要求，照旧静默覆盖），后者纯靠字数蒙
      //   （「去掉背景音乐」6 字被拒、「换成 1080p」8 字被当要求，两个方向都错）。
      else if (!ATTR_HIT.test(rest)) {
        // ★★ 一个属性词都没有 = 这就是在描述画面，**别再剥词**（第四轮验证抓到）：
        //   剥词表里有「把/画面/调/的」这些极常用的字，「把画面调暗」剥完只剩「暗」，
        //   会被判成"没听懂"而白拒 —— 而它是一句再正常不过的拍摄要求。
        if (rest.length >= 2) ops.push({ op: "require", seg, text: rest, local: true });
        else unclear.push(part.trim());
      } else {
        // ★★ 有属性词：看剥完还剩多少。**别指望剥完为空**（上一版注释里那句断言是错的，
        //   第四轮验证用一串自然说法证伪：「麻烦改成竖屏」剩「麻烦」、「时长加到10秒」剩
        //   「加到」、「画质设置为高清」剩「置为」）—— 剥词表是黑名单，漏一个字就掉进
        //   require **静默整段覆盖**用户写好的要求，而这一档正好在离线/余额不足时走。
        //   所以留一点余量：剩三个字以内仍按属性算。
        // ★ 两个方向的代价不对称：误判成属性 = 白拒一次 + 指路（可恢复）；
        //   漏判成要求 = setRequirement 整表覆盖，无历史无撤销。宁可多判几句属性。
        const left = attrLeftover(rest);
        if (left.length <= 3) attrs.push(`第 ${seg} 段`);
        else ops.push({ op: "require", seg, text: rest, local: true });
      }
      continue;
    }
    if (/加\s*([0-9一二两三]*)\s*段/.test(part)) {
      const n = cnInt(part.match(/加\s*([0-9一二两三]*)\s*段/)![1] || "1") || 1;
      ops.push({ op: "add_segment", n });
    }
  }
  const hint = "「第N段 拍什么」「第N段换成XX模板」「第N段摘掉模板」「加一段」";
  const unclearSay = unclear.length
    ? `没听懂这几句，怕改错就没动：${unclear.map((u) => `「${u}」`).join("、")}。`
    : "";
  // ★ 属性类单独说，而且**说清去哪儿办**：只回一句"没听懂"的话，用户只会换个说法再试一次，
  //   而本地档永远办不了这件事 —— 那就是一个说不出出路的死循环（铁律八的"给出路"那半）。
  // ★ 指路要指到**真有那颗按钮的地方**（第三轮验证抓到：原来写"卡片上的 ⚙"，而节点卡上
  //   根本没有 ⚙ —— 全 app 唯一那颗在编辑窗标题行右上角。指错路和功能坏了长得一模一样）
  const attrSay = attrs.length
    ? `${[...new Set(attrs)].join("、")}说的是这一段的设置：点开那一段的编辑窗，时长/画幅/画质在标题行右上角的 ⚙ 里，删段在编辑窗最底下。`
    : "";
  return {
    say: ops.length
      ? `（本地档）按直白句式帮你办了下面这些。${attrSay}${unclearSay}`
      : `（本地档）${attrSay}${unclearSay}现在只认${hint}这类直白句式。`,
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
        if (node.status === "generating") {
          refused.push(`第 ${o.seg} 段正在生成，等它跑完再改要求（现在改也来不及进这一炉）`);
          break;
        }
        // ★★ **本地档不许静默覆盖已经写好的要求**（第四轮验证的结论）：那一档的分档全靠
        //   几条正则，而它正好在**离线 / 余额不足**时走 —— 用户连说好几句的时候。
        //   分档判错一次的代价原来是"用户精心写的一整段被换成『改成10秒』，无确认无撤销"。
        //   把这条不可逆的后果堵死之后，分档再不准也只是白拒一次（说清楚就行）。
        //   模型那条路不加这道闸：它对意图的理解可靠得多，而且回执芯片会如实报出来。
        const prevReq = (node.requirement ?? "").trim();
        if (o.local && prevReq && prevReq !== o.text.trim()) {
          refused.push(
            `第 ${o.seg} 段已经写着「${prevReq.slice(0, 24)}${prevReq.length > 24 ? "…" : ""}」——` +
              `离线档不敢直接覆盖它。想换成「${o.text.slice(0, 16)}…」的话，在这一段的编辑窗里改` +
              `（那一段还锁着的话，得先把它前面的段炼出来），或者先把原来那段清空`,
          );
          break;
        }
        useFlow.getState().setRequirement(node.id, o.text);
        // ★★ 已出片的段**照写不误**（第一版在这里整句拒，验证轮判成回归）：两个理由 ——
        //   ① 两个面的要求框对已出片的段都是可编辑的（只 disable locked/generating），
        //      agent 比 UI 严 = 同一件事两种答复；
        //   ② 那时给的出路「♻ 重新生成」走的是 genNode，它读的是 chosenOf(node).plot、
        //      **根本不读 requirement** —— 照着做只会花钱重炼出同一段。
        //   但绿勾不能只写"要求已写"（那就是"答非所做"）：要说清它**什么时候才作数**。
        // ★★ 本地档**把写进去的那句话引出来**（第五轮验证的结论）：那一档的分档全靠正则，
        //   而"属性句被当成要求"这个方向在**要求原本是空的**那一段上没有闸拦得住
        //   （空的时候覆盖不掉东西，所以 local 那道闸不触发）。于是「第2段 这段没用，删了吧」
        //   会被原样写成要求，回执却只说一句"要求已写" —— 用户下一步点推演就按这句垃圾
        //   真花钱。引出来的话，判错当场就看得见（铁律八：让错误响，而不是让它安静地待着）。
        const wrote = o.local ? `：「${o.text.slice(0, 20)}${o.text.length > 20 ? "…" : ""}」` : "";
        applied.push(
          nodeDone(node)
            ? // ★ 指名道姓说在哪儿（旁边每句拒绝语都指了，就这句没指）：已出片的段编辑窗里
              //   没有直接的推演键，要先进「📋 看/改这一套方案」才见到「♻ 重新推演三套」
              `第 ${o.seg} 段：要求已写${wrote}（这一段已经出片，新要求要等重新推演才作数——编辑窗点「📋 看/改这一套方案」，里面有「♻ 重新推演三套」）`
            : `第 ${o.seg} 段：要求已写${wrote}`,
        );
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
        // ★★ 已出片的段**照改不误**（2026-08-21 通读拒绝语时抓到，与 require 那支同一形状）：
        //   ① 两个面的「选卡片」对已出片的段都是可点的（只 disable locked/generating），
        //      agent 比 UI 严 = 同一件事两种答复；
        //   ② 原来那句话还是个环：它拒掉改素材，却叫用户「先重新生成」—— 而重新生成用的是
        //      **当前** materials（genNode 真把 node.materials 透传给 generateSegment），
        //      不改素材就重炼，只会花钱得到同一段。
        //   所以照改，但绿勾要说清它什么时候才作数。
        if (node.status === "generating") {
          refused.push(`第 ${o.seg} 段正在生成，等它跑完再改素材（现在改也来不及进这一炉）`);
          break;
        }
        const doneNote = nodeDone(node) ? "（这一段已经出片，新素材要点「♻ 重新生成」才会用上）" : "";
        for (const name of o.add ?? []) {
          const f = findCard(name);
          if (!f.c) {
            refused.push(`第 ${o.seg} 段挂卡：${f.issue}`);
            continue;
          }
          const n2 = useFlow.getState().addMaterials(node.id, [f.c]);
          applied.push(
            n2 > 0 ? `第 ${o.seg} 段：挂上「${f.c.name}」${doneNote}` : `第 ${o.seg} 段：「${f.c.name}」本来就挂着`,
          );
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
          applied.push(`第 ${o.seg} 段：摘下「${hit.name}」${doneNote}`);
        }
        break;
      }
      case "remove_segment": {
        if (nodeDone(node)) {
          // ★ 别把人支去线性视图：画布与线性用的是**同一个** DeleteSegBtn（同一条
          //   「已出片要点两下」规则），两边都在编辑窗底部。指错路等于让用户以为画布做不到
          refused.push(`第 ${o.seg} 段已经出片：删掉它成片就没了，这一步不代劳——要删就自己在本段编辑窗底部按「🗑 删除本段」（已出片的要点两下）`);
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
          nodeId: node.id,
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
          nodeId: node.id,
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
          // ★ 同上：方案台在画布里就有（编辑窗那颗「🎬 挑一套方案」→ PlanSheet）。
          //   照着"去顶栏 ≡ 线性"做的用户会把画布整个收起来，而他本来就在能做这件事的地方
          refused.push(`第 ${o.seg} 段还没挑定方案——先推演，再在本段编辑窗点「🎬 挑一套方案」挑一套`);
          break;
        }
        const cost = nodeCost(useFlow.getState().nodes, o.seg - 1, useFlow.getState().mode);
        proposals.push({
          kind: "generate",
          seg: o.seg,
          display: nodeDone(node) ? `第 ${o.seg} 段重新生成视频（旧成片作废）` : `第 ${o.seg} 段生成视频`,
          costLabel: AI_REAL ? fmtTokens(cost) : "演示",
          cost,
          nodeId: node.id,
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
/**
 * 换一摊活时把记忆清掉（开新工作流 / 打开另一条草稿 / 组稿发布后）。
 * ★ 这是**模块级**变量，不跟着 store 走：不清的话，上一条片的「用户：第2段拍雪山」
 *   会跟着进下一条片的提示词，模型据此脑补出与当前流水线无关的走向。
 *   状态本身不会被带错（每轮都重发 snapshot()），串的是**内容**。
 */
export function forgetCanvasAgent() {
  past.length = 0;
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
  const t = text.trim().slice(0, VIDEO_PROMPT_MAX);
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
  // ★★ 下标可能已经指向**另一段**（摆卡之后用户删过段，后面的段整体前移）：
  //   认 id 是唯一可靠的判据，见 AgentProposal.nodeId 的 ★★
  if (node.id !== p.nodeId) {
    return fin(false, `这张卡说的那一段已经不在第 ${p.seg} 位了（流水线被改过）——重说一句，我按现在的样子再摆一张`);
  }

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

  // ★★ 顺序门禁也要**执行前再问一遍**（2026-08-21 第六轮对抗评审）：卡摆着的这段时间里，
  //   用户完全可能回前面某段去方案台换一套没炼过的走向 —— 那一段的 nodeDone 变假、
  //   frontier 前移，本段当场重新上锁（画布上都画出 🔒 了）。而 genNode / deriveProposals
  //   自己没有任何 frontier 判断（门禁只活在 clampCursor 与 UI 的 disabled 里），
  //   于是这张卡就成了绕过顺序门禁的唯一入口：屏幕上写着「🔒 还没解锁」，钱照扣，
  //   炼出来的还接着用户刚刚弃掉的那套走向的尾帧。
  //   问的是**同一处实现**（clampCursor），不是另写一份 frontier。
  if (lockedAt(p.seg)) {
    return fin(false, `第 ${p.seg} 段又锁上了（前面的段被改回未出片）——先把前面那段炼出来，再说一次`);
  }

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
