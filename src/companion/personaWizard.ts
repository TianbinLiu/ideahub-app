/**
 * @file personaWizard.ts — 人格制作向导的**纯数据与纯函数**那一半（定位选项、12 项问卷的唯一定义、
 *   聊天记录说话人识别、素材量的裁剪规则、各字段字数上限）。
 * @category Utility
 *
 * 设计正本 docs/digital-human-creator-center.md §4.3（向导 7 步）。页面在 pages/SupportPersonaNewPage.tsx，
 * 表单状态在 studio/personaWizardStore.ts —— 这里**不认 React、不认 zustand、不发请求**，只是被那两处 import 的一份规则。
 *
 * ★★ 为什么问卷定义要单独放这儿（铁律六）：问卷有三个面 —— 界面上画的控件、发给服务端的
 *   `questionnaire` 键、以及"没答就用默认值"这条。抄成两份的后果是**零症状**：键名拼错一个字，
 *   服务端那个 record 照收不误（它收任意键），只是模型少喂了一项，生成出来的人格"差一点点"，
 *   而屏幕上没有任何地方会说这件事。所以键从 api/companion.ts 的 `PersonaQuestionKey` 取，
 *   这里只负责给每个键配一句人话与默认值，并在编译期钉住"12 个键一个都不能少"（见 QUESTION_KEYS_COVERED）。
 * ★ 滑杆的值直接发**数字**（0~100）：12 个键的名字本身就是那一极（extroversion = 外向程度），
 *   所以「70」对模型是自解释的，不必再拼一句话发过去。⚠ 但界面上必须把两端写清楚（左「很内向」右「很外向」）——
 *   数字自解释是给模型看的，不是给人看的。
 */
import type { PersonaMaterial, PersonaMaterialKind, PersonaQuestionKey, PersonaQuestionnaire } from "../api/companion";

// ── 第 1 步：定位 ────────────────────────────────────────────────────────────

/**
 * 定位（设计正本 §4.3 第 1 步的五档）。`custom` 让用户自己写一个词；
 * 发给服务端的 `basics.role` 一律是**那个词本身**而不是这里的 key —— 服务端只当自然语言读。
 */
export const PERSONA_ROLES = [
  { key: "chat", label: "陪聊", hint: "闲聊、倾诉、随时接得住话" },
  { key: "support", label: "客服", hint: "答疑、指路、说清楚怎么办" },
  { key: "teacher", label: "老师", hint: "讲知识、出题、纠错" },
  { key: "roleplay", label: "角色扮演", hint: "扮成某个设定里的人物" },
  { key: "custom", label: "自定义", hint: "自己写一个" },
] as const;
export type PersonaRoleKey = (typeof PERSONA_ROLES)[number]["key"];

/** 封面 emoji 的备选（点一下就换，也能自己敲一个） */
export const PERSONA_COVER_EMOJIS = ["🎭", "🌙", "☕", "🐱", "🔥", "🌸", "🧊", "📚", "🎧", "🍀", "⚡", "🫧"] as const;

// ── 第 3 步：12 项性格问卷 ───────────────────────────────────────────────────

/** 滑杆：0~100，两端各有一句人话。值发数字（见文件头 ★） */
export interface SliderQuestion {
  key: PersonaQuestionKey;
  kind: "slider";
  label: string;
  /** 0 那一端 / 100 那一端 */
  low: string;
  high: string;
  fallback: number;
}
/** 单选：值就是选项的文字（发给模型的是中文本身，不是内部 key） */
export interface ChoiceQuestion {
  key: PersonaQuestionKey;
  kind: "choice";
  label: string;
  options: readonly string[];
  /** 选项之外还能自己写一个（"怎么称呼你"那项） */
  freeform?: boolean;
  fallback: string;
}
/** 自填一行 */
export interface TextQuestion {
  key: PersonaQuestionKey;
  kind: "text";
  label: string;
  placeholder: string;
  maxLen: number;
  fallback: string;
}
/** 多选 + 自填（禁忌话题） */
export interface TagsQuestion {
  key: PersonaQuestionKey;
  kind: "tags";
  label: string;
  options: readonly string[];
  fallback: readonly string[];
}
export type PersonaQuestion = SliderQuestion | ChoiceQuestion | TextQuestion | TagsQuestion;

/**
 * 12 项，顺序就是界面上的顺序。
 * ★ 全部有默认值（设计正本点名"都有默认值"）：滑杆默认在正中，选择题默认挑最常见的那一项 ——
 *   一道题都不答也能直接生成，问卷是"想调就调"，不是"必须填完"的表单。
 * ★ `satisfies` 而不是 `: readonly PersonaQuestion[]`：加了类型标注就会把每一项的 key 拓宽成整个
 *   联合类型，下面那道"少一个键就编译不过"的闸也就跟着失效了。
 */
export const PERSONA_QUESTIONS = [
  { key: "extroversion", kind: "slider", label: "外向程度", low: "很内向", high: "很外向", fallback: 50 },
  { key: "rationality", kind: "slider", label: "理性程度", low: "很感性", high: "很理性", fallback: 50 },
  { key: "formality", kind: "slider", label: "正式程度", low: "很随意", high: "很正式", fallback: 50 },
  { key: "humor", kind: "slider", label: "幽默感", low: "一本正经", high: "很爱开玩笑", fallback: 50 },
  { key: "talkative", kind: "slider", label: "话多程度", low: "惜字如金", high: "话很多", fallback: 50 },
  { key: "politeness", kind: "slider", label: "敬语程度", low: "从不用敬语", high: "句句敬语", fallback: 50 },
  { key: "emotional", kind: "slider", label: "情绪外露度", low: "不动声色", high: "喜怒写在脸上", fallback: 50 },
  { key: "catchphrase", kind: "text", label: "口头禅", placeholder: "比如「确实」「好耶」，可以写好几个", maxLen: 120, fallback: "" },
  { key: "addressUser", kind: "choice", label: "怎么称呼你", options: ["你", "您", "叫我的名字", "起个昵称"], freeform: true, fallback: "你" },
  { key: "language", kind: "choice", label: "说什么语言", options: ["中文", "英文", "中英混说"], fallback: "中文" },
  { key: "emoji", kind: "choice", label: "emoji 用量", options: ["不用", "偶尔用", "经常用"], fallback: "偶尔用" },
  { key: "taboos", kind: "tags", label: "不聊什么", options: ["政治", "宗教", "收入和隐私", "病情", "感情经历", "别家产品"], fallback: [] },
] as const satisfies readonly PersonaQuestion[];

/**
 * "12 个键一个都不能少"的编译期证据：漏掉任何一个键，`Exclude<…>` 就不是 `never`，
 * 这个类型退化成 `never`，下面那行 `= true` 当场编译失败。
 * ★ 这道闸不是装饰：漏一项在运行时**毫无症状**（服务端收任意键、界面上少一块也不报错），
 *   只有 tsc 能替我们发现。
 */
export type PersonaQuestionCoverage = Exclude<PersonaQuestionKey, (typeof PERSONA_QUESTIONS)[number]["key"]> extends never ? true : never;
export const QUESTION_KEYS_COVERED: PersonaQuestionCoverage = true;

export function defaultQuestionnaire(): PersonaQuestionnaire {
  const out: PersonaQuestionnaire = {};
  for (const q of PERSONA_QUESTIONS) out[q.key] = q.kind === "tags" ? [...q.fallback] : q.fallback;
  return out;
}

/** 用户动过几项（界面上标一句"已调整 n 项"，让人知道问卷不是白填的） */
export function questionnaireTouched(q: PersonaQuestionnaire): number {
  let n = 0;
  for (const def of PERSONA_QUESTIONS) {
    const v = q[def.key];
    if (def.kind === "tags") {
      if (Array.isArray(v) && v.length > 0) n++;
    } else if (v !== undefined && v !== def.fallback) n++;
  }
  return n;
}

// ── 第 2 步：素材 ────────────────────────────────────────────────────────────

/** 服务端硬限（docs/api-contract.md「客服」一节）：一次最多 10 条、合计 ≤60000 字 */
export const MATERIAL_TOTAL_MAX = 60000;
export const MATERIAL_ITEMS_MAX = 10;

/** 能读进来的文本文件（`<input accept>` 用它，一处实现） */
export const MATERIAL_FILE_ACCEPT = ".txt,.md,.json,.csv";

export const MATERIAL_KIND_LABEL: Record<PersonaMaterialKind, string> = {
  chat: "聊天记录",
  posts: "发过的文案",
  notes: "笔记 / 自述",
};

export interface ClampedMaterials {
  materials: PersonaMaterial[];
  /** 被截掉的字数（0 = 一个字都没截） */
  droppedChars: number;
  /** 整条被丢掉的素材数（超过 10 条那部分） */
  droppedItems: number;
}

/**
 * 把用户攒的素材裁到服务端收得下的量。
 *
 * ★ **从最前面截**、保留最后那一段：聊天记录越靠后越接近"现在的说话方式"，截尾会把最像 TA 的
 *   那部分丢掉。同理超过 10 条时丢掉**最早**加的那几条。
 * ★ 裁剪结果必须能被界面如实说出来（droppedChars / droppedItems），不许静默截断 ——
 *   静默截断的症状是"生成出来的人格不像"，而用户永远不会知道是素材没发全（铁律八）。
 */
export function clampMaterials(items: Array<{ kind: PersonaMaterialKind; text: string }>): ClampedMaterials {
  const kept = items.slice(-MATERIAL_ITEMS_MAX);
  const droppedItems = items.length - kept.length;
  let budget = MATERIAL_TOTAL_MAX;
  let droppedChars = 0;
  const out: PersonaMaterial[] = [];
  // 从后往前填预算：最后一条一定进得去，最早那几条挨刀
  for (let i = kept.length - 1; i >= 0; i--) {
    const text = kept[i].text;
    if (budget <= 0) {
      droppedChars += text.length;
      continue;
    }
    if (text.length <= budget) {
      out.unshift({ kind: kept[i].kind, text });
      budget -= text.length;
    } else {
      out.unshift({ kind: kept[i].kind, text: text.slice(text.length - budget) });
      droppedChars += text.length - budget;
      budget = 0;
    }
  }
  for (const it of items.slice(0, droppedItems)) droppedChars += it.text.length;
  return { materials: out.filter((m) => m.text.trim().length > 0), droppedChars, droppedItems };
}

// ── 聊天记录：认出说话人 ─────────────────────────────────────────────────────

export interface ChatEntry {
  speaker: string;
  text: string;
}
export interface SpeakerStat {
  name: string;
  /** 说了几条 */
  lines: number;
  /** 一共多少字（不含空白） */
  chars: number;
}

/** 名字里出现这些就不是名字，是正文（挡掉「今天真累：我去了…」这种误判） */
const NOT_A_NAME = /[。！？；…“”"]/;
/** 整行就是一个网址：`https://…` 的 `https` 会被误当成昵称 */
const URL_LINE = /^[a-z][a-z0-9+.-]*:\/\//i;
/** 纯数字（含时间）不是昵称：`12:30 好的` 里的 `12` */
const ALL_DIGITS = /^[\d\s./-]+$/;
/** QQ 导出的表头：`2026-01-02 12:00:00 昵称(1234567)` / `… 昵称<a@b.c>` */
const QQ_HEADER = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s+(.{1,32}?)\s*$/;
/** 微信/通用两行式的表头：`昵称 2026-01-02 12:00` 或 `昵称 12:00` */
const NAME_TIME_HEADER = /^(.{1,24}?)\s+(?:\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*$/;
/** 单行式：`昵称: 内容`（半角/全角冒号都认，冒号必须落在前 24 个字里） */
const NAME_COLON_LINE = /^([^\s:：][^:：]{0,23})[:：]\s*(.*)$/;

/** 表头里的 `(12345)` / `<a@b.c>` / `（备注）` 尾巴剥掉，只留昵称 */
function tidyName(raw: string): string {
  return raw
    .replace(/\s*[（(<［[][^）)>］\]]*[）)>］\]]\s*$/, "")
    .trim()
    .slice(0, 24);
}

function looksLikeName(raw: string): boolean {
  const n = raw.trim();
  return n.length > 0 && !NOT_A_NAME.test(n) && !ALL_DIGITS.test(n);
}

/**
 * 聊天记录 → 逐条 `{说话人, 内容}`。**唯一一处解析**：`detectSpeakers` 与 `linesOfSpeaker`
 * 都从它出发 —— 两份解析一旦分叉，用户会看到"列表里说 TA 有 300 条"、送去分析的却只有 12 条，
 * 而两边都不报错。
 *
 * ★ 认三种常见导出格式（QQ 时间戳行 / 昵称+时间两行式 / 昵称冒号单行式）。认不出的行**归给上一位
 *   说话人**（多行消息很常见）；一位都还没出现过时归给空名字，由调用方当"整段无名文本"处理。
 */
export function parseChatLog(text: string): ChatEntry[] {
  const out: ChatEntry[] = [];
  let speaker = "";
  const append = (body: string) => {
    const last = out[out.length - 1];
    if (last && last.speaker === speaker) last.text = last.text ? `${last.text}\n${body}` : body;
    else out.push({ speaker, text: body });
  };
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const qq = QQ_HEADER.exec(line);
    if (qq && looksLikeName(tidyName(qq[1]))) {
      speaker = tidyName(qq[1]);
      out.push({ speaker, text: "" });
      continue;
    }
    const nt = NAME_TIME_HEADER.exec(line);
    if (nt && looksLikeName(tidyName(nt[1]))) {
      speaker = tidyName(nt[1]);
      out.push({ speaker, text: "" });
      continue;
    }
    if (!URL_LINE.test(line)) {
      const nc = NAME_COLON_LINE.exec(line);
      if (nc && looksLikeName(nc[1])) {
        speaker = tidyName(nc[1]);
        append(nc[2].trim());
        continue;
      }
    }
    append(line);
  }
  return out.filter((e) => e.text.trim().length > 0);
}

/** 一次只列这么多候选：误判出来的"说话人"（正文里带冒号的行）会拖一长串，让人找不到真的那个 */
export const SPEAKER_LIST_MAX = 12;

/**
 * 认出聊天记录里都有谁，按条数从多到少排。**没认出任何人时返回空数组** ——
 * 调用方据此说"没认出说话人，会把整段一起分析"，而不是画一个空列表让人以为坏了。
 */
export function detectSpeakers(text: string): SpeakerStat[] {
  const byName = new Map<string, SpeakerStat>();
  for (const e of parseChatLog(text)) {
    if (!e.speaker) continue;
    const hit = byName.get(e.speaker) ?? { name: e.speaker, lines: 0, chars: 0 };
    hit.lines += 1;
    hit.chars += e.text.replace(/\s+/g, "").length;
    byName.set(e.speaker, hit);
  }
  return [...byName.values()].sort((a, b) => b.lines - a.lines).slice(0, SPEAKER_LIST_MAX);
}

/** 只留 TA 说的话（第 2 步点选"哪个是 TA"之后送去分析的就是它）。没选人就原样返回 */
export function linesOfSpeaker(text: string, speaker: string): string {
  if (!speaker) return text;
  return parseChatLog(text)
    .filter((e) => e.speaker === speaker)
    .map((e) => e.text)
    .join("\n");
}

// ── 第 6 步：字数上限 ────────────────────────────────────────────────────────

/**
 * 微调那一步每个字段的上限。
 *
 * ★ summary / catchphrase / tone / addressUser / greeting / example(s) / boundaries 这几项是
 *   **服务端 persona.schemas.js 的数**（docs/api-contract.md「客服」一节登记过），超了会 400 ——
 *   所以要**当场**在输入框旁边提示，别等提交回来一句「Invalid input」。
 * ⚠ name / description / tag / boundary 单条这几项，服务端的确切上限没有在契约里登记，这里取的是
 *   保守值（比服务端只会更严，撞不到 400）；等契约补齐后改这一处即可。
 */
export const PERSONA_LIMITS = {
  name: 40,
  description: 300,
  summary: 2000,
  catchphrase: 120,
  catchphrases: 12,
  tone: 300,
  addressUser: 60,
  greeting: 300,
  example: 300,
  examples: 12,
  boundary: 120,
  boundaries: 12,
  /** 0 = 免费；App 内没有支付，标价只影响别人在官网买 */
  price: 100000,
} as const;

/** 人格的标签口径（与作品标签 types.VIDEO_TAG_* 刻意各自具名、互不 import —— 两条不同的规则） */
export const PERSONA_TAG_MAX = 6;
export const PERSONA_TAG_LEN = 10;

/** 超限了给一句人话，没超返回空串（输入框下面直接画它） */
export function overLimitText(value: string, max: number): string {
  const n = value.length;
  return n > max ? `超了 ${n - max} 字（最多 ${max} 字）` : "";
}
