// 人格制作向导（/support/personas/new）的**全部**表单状态与长活 —— 活在 store 里，不活在组件里。
//
// ★★ 为什么（CLAUDE.md「长活登记进 data/jobs」那条，与 customCardStore 同一个理由）：这一页有两件
//   分钟级的活 —— AI 分析素材 + 生成草稿（两次模型调用，各自都可能十几秒）与试聊 SSE。Promise 本身
//   不会因为页面卸载而停，但它跑完之后 `setState` 打在一个已经不存在的组件上 = **生成好的草稿静默丢掉**，
//   用户回来看到的是一张空表单，而且屏幕上没有任何一个字说发生过什么。所以：任务照旧在 Promise 里跑，
//   结果写进这个 store；人不在页上时由全局胶囊（GenerationPill ← data/jobs）通知；人回来时页面从 store
//   原样画出来（连"走到第几步"都在）。
//
// ★★ 素材原文（可能几万字）**不进这个 store**，停在模块级的 `materialTexts` 里，store 只存元信息
//   （第几条、什么类型、多少字）。三个理由，第二条是硬的：
//     ① 界面从来不需要把原文画出来 —— 只需要"这条多少字""认出了哪些说话人"；
//     ② 这个 store 与 customCardStore 同形，而那一支已经有往本地库落盘的先例；几万字聊天记录一旦
//        跟着状态被写进 IndexedDB / localStorage，就直接违反了我们在界面上对用户的承诺
//        **「素材只用于生成，不入库不公开」**（设计正本 §4.3 第 2 步）—— 那不是性能问题，是承诺问题；
//     ③ 原文只在"送去分析"那一拍被读一次，放在 store 里只会让每一次无关的 setState 都把它带一遍。
//   ⚠ 模块级意味着它随进程活着：`resetPersonaWizard()` **必须**把它一起清掉，否则下一次做人格会把
//     上一次的素材偷偷带进去（零报错，只会生成出一个"不像"的人格）。
//
// ★ 名字避开 "draft"：`PersonaDraft` 已经是服务端回的那份草稿了。这里的整份表单叫 wizard，
//   `resetPersonaWizard` / `wizardDirty` / `wizardBusy` / `useWizardField`（形状与 customCardStore 逐条对应）。
// ★ 依赖方向：api → store → 组件。这里只认 api/companion、companion/personaWizard、data/jobs。
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { create } from "zustand";
import {
  analyzePersonaMaterials,
  companionErrorText,
  createPersona,
  generatePersonaDraft,
  streamPersonaPreviewChat,
  updateCompanionSettings,
  type MarketPersona,
  type PersonaAnalysis,
  type PersonaBasics,
  type PersonaDraft,
  type PersonaDraftField,
  type PersonaMaterialKind,
  type PersonaQuestionnaire,
} from "../api/companion";
import { normalizeAction, normalizeFace, type CompanionAction, type CompanionFace } from "../companion/protocol";
import {
  clampMaterials,
  defaultQuestionnaire,
  detectSpeakers,
  linesOfSpeaker,
  PERSONA_LIMITS,
  type SpeakerStat,
} from "../companion/personaWizard";
import { currentRoute, startJob } from "../data/jobs";
// ★ id 生成器全仓只有 types.uid 一份，别在 store 里另写一个自增的（铁律六）
import { uid } from "../types";

/** 7 步（设计正本 §4.3）。地址栏不写步数：向导是一条线，深链进第 5 步而手里没有草稿只会是白屏 */
export const PERSONA_STEPS = [
  { key: "basics", label: "基本设定" },
  { key: "materials", label: "素材" },
  { key: "quiz", label: "问卷" },
  { key: "generate", label: "生成" },
  { key: "preview", label: "试聊" },
  { key: "tune", label: "微调" },
  { key: "publish", label: "发布" },
] as const;
export type PersonaStep = (typeof PERSONA_STEPS)[number]["key"];

/** 试聊聊几轮（设计正本"聊 5 轮"）。服务端另有 messages ≤20 的硬限，5 轮 = 10 条，够不着 */
export const PREVIEW_ROUNDS_MAX = 5;

/** 一条素材的元信息。原文按 id 停在模块级 `materialTexts` 里（见文件头 ★★） */
export interface MaterialMeta {
  id: string;
  kind: PersonaMaterialKind;
  /** 显示用：文件名，或「粘贴的文本」 */
  label: string;
  /** 原文字数（界面上就显示它，不显示原文） */
  chars: number;
}

/** 试聊的一条消息。face / action 只做标签展示 —— 这里没有 Live2D 舞台，不演出 */
export interface PreviewMsg {
  id: string;
  role: "user" | "assistant";
  text: string;
  face?: CompanionFace;
  action?: CompanionAction;
  streaming?: boolean;
}

/** 页面内三色横幅（emerald 成功 / amber 提醒 / rose 失败）。这一页唯一的整句反馈形状 */
export interface WizardBanner {
  kind: "ok" | "warn" | "bad";
  text: string;
}

export interface PersonaWizardState {
  step: PersonaStep;

  // ① 基本设定
  name: string;
  /** 定位：PERSONA_ROLES 里的 label，或用户自己写的那个词 */
  role: string;
  /** 定位选的是不是「自定义」（决定要不要摆那个输入框） */
  roleCustom: boolean;
  relation: string;
  intro: string;
  addressUser: string;
  coverEmoji: string;

  // ② 素材（原文不在这儿，见文件头）
  materials: MaterialMeta[];
  /** 聊天记录里认出来的说话人（合并全部 chat 类素材后算一次） */
  speakers: SpeakerStat[];
  /** 用户点选的"哪个是 TA"；空 = 不筛，整段一起分析 */
  speaker: string;
  /** 正在读文件（解码几万字要一两拍，得让人看见） */
  reading: string;
  materialErr: string;

  // ③ 问卷
  questionnaire: PersonaQuestionnaire;

  // ④ 生成
  analysis: PersonaAnalysis | null;
  /**
   * `analysis` 是**照着哪一批素材**算出来的（指纹：每条素材的 id + 字数，加上"哪个是 TA"）。
   *
   * ★★ 为什么不能只判 `!analysis`（2026-09-07 补）：加/删素材、换说话人之后 `analysis` 还在，
   *   于是重新生成时「送去分析」那一步整个被跳过，新素材**一次都没有被读过**，发出去的还是上一份分析。
   *   零报错，界面上那句「读过你的素材」还理直气壮。而反过来"素材一变就清掉 analysis"又会毁掉
   *   analyze/generate 分两步的**本意**（重生成不重读素材、不再烧一格 5 次/分钟的额度）——
   *   指纹同时满足这两件事：没变就复用，变了才重跑。
   */
  analyzedKey: string;
  draft: PersonaDraft | null;
  /** 正在跑的那一步的人话（空 = 没在跑）；同时也是"生成键要不要转圈" */
  genBusy: string;
  /** 正在单独重生成哪个字段（「只换这个」）；null = 没有 */
  genOnly: PersonaDraftField | null;
  genErr: string;

  // ⑤ 试聊
  chat: PreviewMsg[];
  chatBusy: boolean;
  chatErr: string;

  // ⑦ 发布
  shared: boolean;
  /** 价格用字符串存：输入框里允许中间态（空串、"0"），提交时才取整 */
  priceText: string;
  agreed: boolean;
  pubBusy: boolean;
  pubErr: string;
  /** 发布成了的那条（成功页读它） */
  published: MarketPersona | null;
  /**
   * 成功页那颗「装备为当前人格」的在途 / 回执。
   * ★ 放 store 不放组件 state（2026-09-07 收口）：与这两份 store 文件头讲的是同一件事 ——
   *   人点完就退出去，`setState` 打在已卸载的组件上 = 回执静默丢掉，回来时那颗键像从没点过。
   *   这一发很短，不值得登记一张 job 票；但结果落 store 之后"退出去再回来还看得见"是白拿的。
   */
  equipBusy: boolean;
  equipMsg: WizardBanner | null;

  banner: WizardBanner | null;
  /** 页面此刻挂着没有（结局分叉：页在 → 就地画；页不在 → 走胶囊通知） */
  mounted: boolean;
}

export function initialWizardState(): PersonaWizardState {
  return {
    step: "basics",
    name: "",
    role: "",
    roleCustom: false,
    relation: "",
    intro: "",
    addressUser: "",
    coverEmoji: "🎭",
    materials: [],
    speakers: [],
    speaker: "",
    reading: "",
    materialErr: "",
    questionnaire: defaultQuestionnaire(),
    analysis: null,
    analyzedKey: "",
    draft: null,
    genBusy: "",
    genOnly: null,
    genErr: "",
    chat: [],
    chatBusy: false,
    chatErr: "",
    shared: false,
    priceText: "0",
    agreed: false,
    pubBusy: false,
    pubErr: "",
    published: null,
    equipBusy: false,
    equipMsg: null,
    banner: null,
    mounted: false,
  };
}

export const usePersonaWizard = create<PersonaWizardState>()(() => initialWizardState());

// ── 素材原文：模块级，不进 store（见文件头 ★★）─────────────────────────────
const materialTexts = new Map<string, string>();

/** 认一遍说话人：全部 chat 类素材拼起来算一次（跨文件的同一个人要能合并计数） */
function recountSpeakers(metas: MaterialMeta[]): SpeakerStat[] {
  const chat = metas
    .filter((m) => m.kind === "chat")
    .map((m) => materialTexts.get(m.id) ?? "")
    .join("\n");
  return chat.trim() ? detectSpeakers(chat) : [];
}

/** 加一条素材。返回它的 id（调用方一般用不上，失败时返回空串） */
export function addMaterial(kind: PersonaMaterialKind, label: string, text: string): string {
  const body = String(text || "").trim();
  if (!body) return "";
  const id = uid("mat");
  materialTexts.set(id, body);
  const metas = [...usePersonaWizard.getState().materials, { id, kind, label, chars: body.length }];
  const speakers = recountSpeakers(metas);
  usePersonaWizard.setState((s) => ({
    materials: metas,
    speakers,
    // 认出来的人里已经没有原先选中的那位了（把那条素材删了）→ 撤掉选择，别留一个指向空气的筛选
    speaker: speakers.some((sp) => sp.name === s.speaker) ? s.speaker : "",
    materialErr: "",
  }));
  return id;
}

export function removeMaterial(id: string): void {
  materialTexts.delete(id);
  const metas = usePersonaWizard.getState().materials.filter((m) => m.id !== id);
  const speakers = recountSpeakers(metas);
  usePersonaWizard.setState((s) => ({
    materials: metas,
    speakers,
    speaker: speakers.some((sp) => sp.name === s.speaker) ? s.speaker : "",
  }));
}

/**
 * 「这一份 analysis 是照着哪批素材算的」的指纹（见 `analyzedKey` 的 ★★）。
 * ★ 用 id + 字数而不是原文哈希：原文不进 store，而 id 是每条素材唯一的、字数一变就是另一条内容 ——
 *   这两样足够回答"送去分析的那一份变了没有"，也不用把几万字再走一遍。
 * ★ speaker 进指纹：只改「哪个是 TA」不动素材，送出去的正文也完全不同（`linesOfSpeaker` 筛过）。
 */
function analyzeKeyOf(s: PersonaWizardState): string {
  return `${s.materials.map((m) => `${m.id}:${m.chars}`).join("|")}@${s.speaker}`;
}

/** 素材一共多少字（界面上那个"已导入 n 字"）。原文不出 store，所以由这里算 */
export function materialChars(): number {
  return usePersonaWizard.getState().materials.reduce((n, m) => n + m.chars, 0);
}

/**
 * 送去分析的那一份：按"哪个是 TA"筛过、按服务端上限裁过。
 * ★ 筛人只对 `chat` 那几条做（发过的文案 / 笔记本来就只有 TA 一个人写的，筛了会全空）。
 */
export function materialsForAnalyze(): ReturnType<typeof clampMaterials> {
  const { materials, speaker } = usePersonaWizard.getState();
  const items = materials.map((m) => {
    const raw = materialTexts.get(m.id) ?? "";
    return { kind: m.kind, text: m.kind === "chat" && speaker ? linesOfSpeaker(raw, speaker) : raw };
  });
  return clampMaterials(items);
}

// ── 长活：生成 / 试聊 / 发布 ────────────────────────────────────────────────

/** 试聊那条 SSE 的闸：换一句话、离开向导、清空重来都要把在途那条掐掉 */
let previewAbort: AbortController | null = null;

/**
 * 送出去之前把草稿里**没填完的示例对话**滤掉。**一处实现**，试聊与发布共用。
 *
 * ★★ 为什么必须在这里而不只是界面上提醒（2026-09-07 补）：服务端 `exampleSchema` 对 `user` / `reply`
 *   都是 `min(1)`，而「加一组」插进去的就是一对空串 —— 点了「加一组」还没填完就去试聊或发布，
 *   整条请求 400，而 zod 的长度错在 server `middleware/error.js` 里被糊成一句英文 "Validation error"，
 *   不说是哪个字段。`previewChatBody.draft` 与 `createBody.style` 用的是同一个 `styleBody`，
 *   所以第 ⑤ 步和第 ⑦ 步会一起坏。空组本来就没有意义，滤掉不损失任何东西。
 * ★ 只在**送出去**那一拍滤：草稿本身留着空组，用户回微调那一步还看得见自己加了一行没填。
 */
export function draftForServer(draft: PersonaDraft): PersonaDraft {
  const examples = draft.style.examples ?? [];
  const kept = examples.filter(exampleFilled);
  if (kept.length === examples.length) return draft;
  return { ...draft, style: { ...draft.style, examples: kept } };
}

/**
 * 「这一组填完了没有」的**唯一判据**：滤掉它的这一处与界面上把它说出来的那一处必须同一句话，
 * 各写一份的话，界面说"这组没问题"而送出去时被滤掉（或反过来）都是零报错的。
 */
export function exampleFilled(e: { user: string; reply: string }): boolean {
  return !!e.user.trim() && !!e.reply.trim();
}

function basicsOf(s: PersonaWizardState): PersonaBasics | undefined {
  const b: PersonaBasics = {};
  if (s.name.trim()) b.name = s.name.trim();
  if (s.role.trim()) b.role = s.role.trim();
  if (s.relation.trim()) b.relation = s.relation.trim();
  if (s.intro.trim()) b.intro = s.intro.trim();
  if (s.addressUser.trim()) b.addressUser = s.addressUser.trim();
  return Object.keys(b).length > 0 ? b : undefined;
}

/**
 * 「基本设定都空着」时不能发 generate —— 服务端要求 chatText / analysis / basics **至少一个**，
 * 一个都没有是 400。这里提前判死，让按钮灰着并说清为什么（ui-copy-grammar 第 4 条）。
 */
export function generateBlockedReason(s: PersonaWizardState): string {
  if (basicsOf(s) || s.analysis || s.materials.length > 0) return "";
  return "至少填一样：名字、定位、简介，或者导入一点素材。";
}

/**
 * 第 4 步：（有素材就先分析）→ 生成草稿。第 5 步的「整体再来一版」/「只换这个」走的也是它。
 *
 * ★ analyze 与 generate 分成两拍是刻意的：重生成只重跑 generate —— 素材可能几万字，重读一遍
 *   既慢又多烧一次限流额度（5 次/分钟）。已经分析过就直接复用 `analysis`。
 * ★ `only` 必须与 `draft` 同发（服务端硬要求），所以手里没草稿时它会被忽略、退回整份生成。
 */
export async function runGeneratePersona(opts: { only?: PersonaDraftField[] } = {}): Promise<void> {
  const s0 = usePersonaWizard.getState();
  if (s0.genBusy) return;
  const only = opts.only?.length && s0.draft ? opts.only : undefined;
  const blocked = generateBlockedReason(s0);
  if (blocked && !only) {
    usePersonaWizard.setState({ genErr: blocked });
    return;
  }

  const job = startJob({
    kind: "persona-generate",
    title: only ? "重写人格的一个字段" : "AI 生成人格",
    page: currentRoute(),
    progress: "准备中…",
  });
  usePersonaWizard.setState({ genBusy: "准备中…", genOnly: only?.[0] ?? null, genErr: "", banner: null });
  const step = (text: string) => {
    usePersonaWizard.setState({ genBusy: text });
    job.update(text);
  };

  try {
    // ① 分析素材（只在有素材、且**这一批**还没分析过、且不是"只换某个字段"时跑）
    // ★ 判据是指纹不是 `!analysis`：见 `analyzedKey` 的 ★★ —— 判 `!analysis` 的话改过的素材会被静默丢掉。
    let analysis = s0.analysis;
    const wantKey = analyzeKeyOf(s0);
    if (!only && s0.analyzedKey !== wantKey && s0.materials.length > 0) {
      const { materials, droppedChars, droppedItems } = materialsForAnalyze();
      if (materials.length > 0) {
        step("正在读你给的素材…");
        const r = await analyzePersonaMaterials({ materials, speaker: s0.speaker || undefined });
        analysis = r.analysis;
        usePersonaWizard.setState({ analysis, analyzedKey: wantKey });
        if (droppedChars > 0 || droppedItems > 0) {
          // 截了就要说（铁律八）：不说的话症状是"生成出来的不像"，而用户查不到原因
          usePersonaWizard.setState({
            banner: {
              kind: "warn",
              text: `素材超了上限，最前面的 ${droppedChars} 字${droppedItems > 0 ? `和最早的 ${droppedItems} 条` : ""}没有送去分析。`,
            },
          });
        }
      }
    }

    // ② 生成草稿
    step(only ? "正在重写这一处…" : "正在写说话风格…");
    const s = usePersonaWizard.getState();
    // ★ 指纹对不上的那一份**不发**：素材被删光时 `materials.length === 0`，上面那一步整个跳过，
    //   而 `analysis` 还留在 store 里 —— 照发的话就是"用一批已经不存在的素材写出来的人格"。
    const fresh = s.analyzedKey === wantKey ? analysis : null;
    const r = await generatePersonaDraft({
      basics: basicsOf(s),
      questionnaire: s.questionnaire,
      analysis: fresh ?? undefined,
      only,
      draft: only ? (s.draft ?? undefined) : undefined,
    });
    usePersonaWizard.setState({ draft: r.draft, genBusy: "", genOnly: null });
    // ★ 整份换了一版草稿 ⇒ 上一版的试聊记录作废（`only` 只改一处，不清）。不清的话有两件坏事：
    //   ① 第 ⑤ 步一进去就是满 5 轮、再也聊不动（此前唯一的出路是整份「重新开始」）；
    //   ② 更实的一件：`sendPreviewMessage` 把 `history` 原样发出去 —— 上一版草稿的回答会被当成
    //      这一版"说过的话"喂给模型，试出来的像不像根本不作数。
    if (!only) clearPreview();

    const back = usePersonaWizard.getState();
    if (back.mounted) {
      // 人就在这一页上：页面自己会把草稿画出来，胶囊再弹一条是重复
      job.done({ silent: true });
      usePersonaWizard.setState({ banner: { kind: "ok", text: only ? "换好了。" : "草稿写好了，往下可以试聊。" } });
    } else {
      job.done({ msg: only ? "人格的那一处重写好了" : "人格草稿写好了", route: "/support/personas/new" });
    }
  } catch (e) {
    const msg = companionErrorText(e, "生成失败了，稍后再试。");
    usePersonaWizard.setState({ genBusy: "", genOnly: null, genErr: msg });
    // ★ 与成功那一支同一个口径（也与 live2dUploadStore 的两处失败同形）：人就在这一页上时，
    //   `genErr` 那行红字已经把话说完了，胶囊再报一条 = 同一件事说两遍（CLAUDE.md「长活登记」那条）。
    if (usePersonaWizard.getState().mounted) job.done({ silent: true });
    else job.fail(msg, "/support/personas/new");
  }
}

/**
 * 第 5 步：拿草稿试聊一句（SSE）。
 * ★ 服务端要求 `messages` 最后一条必须是 user，所以**先把用户这句写进 chat 再发**，
 *   发出去的就是 chat 本身（不另拼一份 —— 拼错顺序的症状是 400，而 400 只说 "Invalid input"）。
 * ★ 助手那条先摆一个空壳（streaming），逐句往上填：文字先上屏是市面客服的通行做法。
 */
export async function sendPreviewMessage(text: string): Promise<void> {
  const body = text.trim();
  const s = usePersonaWizard.getState();
  if (!body || s.chatBusy || !s.draft) return;
  if (!s.draft.name.trim()) {
    usePersonaWizard.setState({ chatErr: "草稿还没有名字，回上一步补一个再试聊。" });
    return;
  }

  const userMsg: PreviewMsg = { id: uid("m"), role: "user", text: body };
  const botId = uid("m");
  const history = [...s.chat, userMsg];
  usePersonaWizard.setState({
    chat: [...history, { id: botId, role: "assistant", text: "", streaming: true }],
    chatBusy: true,
    chatErr: "",
  });

  previewAbort?.abort();
  const ctrl = new AbortController();
  previewAbort = ctrl;
  try {
    await streamPersonaPreviewChat(
      {
        // 空的示例对话会让整条请求 400（见 draftForServer 的 ★★）
        draft: draftForServer(s.draft),
        messages: history.map((m) => ({ role: m.role, content: m.text })),
        lang: "zh",
      },
      {
        onSentence: (sentence) => {
          // ★ `sentence.text` 服务端已经把 [情绪][face][action] 标签剥干净了（客服页读的也是它）——
          //   这里不再自己写一遍正则；face / action 走 protocol 的 normalize，未知值退回 normal/none。
          usePersonaWizard.setState((st) => ({
            chat: st.chat.map((m) =>
              m.id === botId
                ? {
                    ...m,
                    text: m.text ? `${m.text} ${sentence.text}` : sentence.text,
                    face: normalizeFace(sentence.face),
                    action: normalizeAction(sentence.action),
                  }
                : m,
            ),
          }));
        },
      },
      ctrl.signal,
    );
    usePersonaWizard.setState((st) => ({
      chat: st.chat.map((m) => (m.id === botId ? { ...m, streaming: false } : m)),
      chatBusy: false,
    }));
  } catch (e) {
    if (ctrl.signal.aborted) return;
    // 一个字都没吐出来的那条空壳直接撤掉（留着是一个永远不会有内容的气泡）
    usePersonaWizard.setState((st) => ({
      chat: st.chat.filter((m) => m.id !== botId || m.text).map((m) => (m.id === botId ? { ...m, streaming: false } : m)),
      chatBusy: false,
      chatErr: companionErrorText(e, "试聊失败了，稍后再试。"),
    }));
  } finally {
    if (previewAbort === ctrl) previewAbort = null;
  }
}

/**
 * 掐掉在途的试聊（用户点「停下」/ 离开向导 / 清空重来 / 回上一步重生成）。
 *
 * ★ 那条 SSE 的 catch 在 `signal.aborted` 时**直接 return**（它不知道是谁掐的、也不该在那儿说话），
 *   所以收拾现场归这里：一个字都没吐出来的空壳撤掉（留着是一个永远不会有内容的「…」气泡），
 *   吐了一半的那条留着但摘掉 `streaming`（那半句是真的，只是没说完）。
 */
export function abortPreview(): void {
  previewAbort?.abort();
  previewAbort = null;
  usePersonaWizard.setState((st) => ({
    chat: st.chat.filter((m) => m.role !== "assistant" || m.text || !m.streaming).map((m) => (m.streaming ? { ...m, streaming: false } : m)),
    chatBusy: false,
  }));
}

export function clearPreview(): void {
  abortPreview();
  usePersonaWizard.setState({ chat: [], chatErr: "" });
}

/** 已经聊了几轮（一问一答算一轮） */
export function previewRounds(s: PersonaWizardState): number {
  return s.chat.filter((m) => m.role === "user").length;
}

/**
 * 第 7 步：落库。
 * ★ 授权勾选目前**只是本地这一道闸**：服务端 persona.schemas.js 还没有 license / selfMade
 *   （治理 P5 才做），z.object 默认 strip，塞进 body 也是静默丢掉 —— 所以界面上不许说"已留痕"。
 * ★ price 取整并夹在 0~100000：服务端也校验，这里先夹住是为了别让用户填完一屏才吃 400。
 */
export async function publishPersona(): Promise<MarketPersona | null> {
  const s = usePersonaWizard.getState();
  if (s.pubBusy || !s.draft) return null;
  if (!s.agreed) {
    usePersonaWizard.setState({ pubErr: "先勾上那三条，才能发布。" });
    return null;
  }
  const name = s.draft.name.trim();
  if (!name) {
    usePersonaWizard.setState({ pubErr: "人格得有个名字，回上一步补一个。" });
    return null;
  }
  const price = Math.min(PERSONA_LIMITS.price, Math.max(0, Math.round(Number(s.priceText) || 0)));

  const wire = draftForServer(s.draft);

  usePersonaWizard.setState({ pubBusy: true, pubErr: "", banner: null });
  const job = startJob({ kind: "persona-publish", title: "发布人格", page: currentRoute(), progress: "提交中…" });
  try {
    const r = await createPersona({
      name,
      description: wire.description,
      coverEmoji: wire.coverEmoji || s.coverEmoji,
      tags: wire.tags,
      style: wire.style,
      shared: s.shared,
      price,
    });
    usePersonaWizard.setState({ pubBusy: false, published: r.persona });
    if (usePersonaWizard.getState().mounted) job.done({ silent: true });
    else job.done({ msg: `人格「${name}」发布好了`, route: "/support/personas" });
    return r.persona;
  } catch (e) {
    const msg = companionErrorText(e, "发布失败了，稍后再试。");
    usePersonaWizard.setState({ pubBusy: false, pubErr: msg });
    // 同上：页在就 silent，页不在才走胶囊
    if (usePersonaWizard.getState().mounted) job.done({ silent: true });
    else job.fail(msg, "/support/personas/new");
    return null;
  }
}

/**
 * 把刚发布出去的这个人格装到自己的数字人上（成功页那颗键）。
 * ★ 结果落 store（见 `equipBusy` 的 ★）：人点完退出去，回来还看得见装没装上。
 */
export async function equipPublishedPersona(): Promise<void> {
  const s = usePersonaWizard.getState();
  if (s.equipBusy || !s.published) return;
  usePersonaWizard.setState({ equipBusy: true, equipMsg: null });
  try {
    await updateCompanionSettings({ personaId: s.published._id });
    usePersonaWizard.setState({ equipBusy: false, equipMsg: { kind: "ok", text: "装上了，回客服页就是这个人格在说话。" } });
  } catch (e) {
    usePersonaWizard.setState({ equipBusy: false, equipMsg: { kind: "bad", text: companionErrorText(e, "装不上，稍后再试。") } });
  }
}

/**
 * 这一版草稿到底有没有读过素材（成功页 / 生成页那句「读过你的素材」的唯一判据）。
 * ★ 不能只看 `analysis !== null`：素材改过之后那一份就不作数了（见 `analyzedKey` 的 ★★），
 *   照着它说「读过你的素材」是一句假话。
 */
export function analysisUsed(s: PersonaWizardState): boolean {
  return s.analysis !== null && s.analyzedKey === analyzeKeyOf(s);
}

// ── 清空 / 状态判定 / 字段 hook ─────────────────────────────────────────────

/**
 * 清空重来（发布成功后再做一个、或用户点「重新开始」）。`mounted` 原样保留。
 * ⚠ 素材原文停在模块级，必须在这里一起清（见文件头 ★★）。
 */
export function resetPersonaWizard(): void {
  abortPreview();
  materialTexts.clear();
  usePersonaWizard.setState({ ...initialWizardState(), mounted: usePersonaWizard.getState().mounted }, true);
}

/** 有没有做到一半的东西（顶栏「重新开始」只在这时候摆） */
export function wizardDirty(s: PersonaWizardState): boolean {
  return (
    s.step !== "basics" ||
    !!s.name ||
    !!s.role ||
    !!s.intro ||
    !!s.relation ||
    s.materials.length > 0 ||
    s.draft !== null ||
    s.chat.length > 0
  );
}

/**
 * 有活在跑 —— 这时不许清空（顶栏那颗「重新开始」按它灰掉）。
 *
 * ★★ `chatBusy` **刻意不在里面**（2026-09-07 改）：试聊既不花钱也不推字节，`resetPersonaWizard()`
 *   本来就会先 `abortPreview()` 把它掐掉，拦它没有任何意义；而拦它的代价很实 —— 上游卡住不回时
 *   `chatBusy` 就一直是真，那颗「重新开始」跟着永久灰掉，用户手上一颗能解开的键都没有
 *   （`abortPreview` / `clearPreview` 此前全仓没有任何调用点）。现在试聊那颗「发」在途时会换成
 *   「停下」，那是掐它的正路。
 */
export function wizardBusy(s: PersonaWizardState): boolean {
  return !!s.genBusy || s.pubBusy || !!s.reading;
}

/**
 * 像 useState 一样用的 store 字段：`const [name, setName] = useWizardField("name")`。
 * setter 支持函数式更新；身份随 key 稳定，可以放进依赖数组。（与 customCardStore.useDraftField 同形）
 */
export function useWizardField<K extends keyof PersonaWizardState>(
  key: K,
): [PersonaWizardState[K], Dispatch<SetStateAction<PersonaWizardState[K]>>] {
  const value = usePersonaWizard((s) => s[key]);
  const set = useCallback<Dispatch<SetStateAction<PersonaWizardState[K]>>>(
    (v) => {
      usePersonaWizard.setState(
        (s) =>
          ({
            [key]: typeof v === "function" ? (v as (prev: PersonaWizardState[K]) => PersonaWizardState[K])(s[key]) : v,
          }) as Partial<PersonaWizardState>,
      );
    },
    [key],
  );
  return [value, set];
}

/** 改草稿里的一个字段（微调那一步）。草稿还没生成时什么都不做 */
export function patchDraft(patch: Partial<PersonaDraft>): void {
  const { draft } = usePersonaWizard.getState();
  if (!draft) return;
  usePersonaWizard.setState({ draft: { ...draft, ...patch } });
}

/** 改草稿的 style 里的一个字段 */
export function patchStyle(patch: Partial<PersonaDraft["style"]>): void {
  const { draft } = usePersonaWizard.getState();
  if (!draft) return;
  usePersonaWizard.setState({ draft: { ...draft, style: { ...draft.style, ...patch } } });
}
