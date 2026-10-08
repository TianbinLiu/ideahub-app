// 「✨ 一键成片」（2026-09-30，docs/cut-autoedit-research.md 的 P2a）：结构化技能的第二份实例 ——
// 模型看一遍时间轴上的片段，写一个片头标题、每个片段一句旁白、挑出该闪黑的接缝；人在确认卡上看一遍、改两句，
// 点头之后写进剪辑工程，再接着批量配音。对标的是 WorkBuddy 那一类 Agent「把分镜拼成片」时替人干的包装活。
//
// 形状照 studio/structuredSkills 的第一份实例（步骤 / 形状检查 / 确认点 / 价签四件齐）：
//   输入（时间轴，现成的）→ 模型 → 形状检查 → 确认（人点头）→ 落地。
// ★ 这里只管「问模型」这一段：清单长什么样、回话里哪些能信、信了之后怎么写进工程，都在 data/cutProject
//   （autoBrief / parseAutoPlan / applyAutoPlan，纯函数，构建里实跑）；确认卡在 components/cut/AutoEditSheet。
// ★ 钱：一次运行 = 一次 chat = CHAT_TURN_TOKENS（服务端按调用定额收，写多写少都是它）。之后的配音不收 token、每天限量
//   （服务端认 purpose 标记，见 studio/cutNarration 头上那段）。失败时钱花没花，由调用方交给 ai/failCharge 说 —— 所以这里的失败要抛对类型：
//   **回包拿到了却用不上**（被截断 / 读不出 JSON / 一句能用的都没有）抛 ArkBadReply（远端模式下这一发已经结算），
//   离线账本则只在整件事成了之后才记（failCharge 文件头规定的次序：先成、后扣）。
import { msg, t } from "@lingui/core/macro";
import { AI_REAL, skillChat } from "../ai";
import { ArkBadReply } from "../ai/arkClient";
import { zhPrompt } from "../ai/prompts/zhPrompt";
import { canAfford, frozenNote, spendTokens } from "../data/account";
import { autoBrief, briefLang, capWords, demoAutoPlan, parseAutoPlan, type AutoBriefClip, type AutoPlan, type CutProject } from "../data/cutProject";
import { CHAT_TURN_TOKENS, fmtTokens } from "../data/economy";
import type { SkillStep, SkillStepKind } from "./structuredSkills";

/**
 * 这一发的输出上限（token）。★ 量出来的（2026-10-01 直连方舟，同一份 SYS）：
 *   3 个片段 95~98、6 个 151~169、9 个 196~203；最坏的情形 —— 24 个片段（原生合成器的上限）、每段 10 秒、
 *   画面描述写满 —— 851 / 871。折下来一个片段 22~36 token；就算 24 句都顶着 48 个字的上限写，也只到 1,500 左右。
 * ★ 取 2400：给最坏情形留六成余量。上限只是封顶 —— 方舟按实际输出计费、服务端按调用定额收，没写满的部分谁都不花钱。
 *   顶到上限时如实说「被截断、这一次已经计费」，不去解析半截 JSON。
 */
const AUTO_EDIT_MAX_TOKENS = 2400;
/** 超时：实测 3.5~6.5 秒（个位数片段）、15~16 秒（24 个片段）。取 170 秒只因为必须比服务端 /api/ark 的 150 秒长 ——
 *  客户端先放弃的话，服务端照样跑完、照样计费，人却收到一句失败 */
const AUTO_EDIT_TIMEOUT_MS = 170_000;

/** 这条技能的形状（面板照它画步骤栏；价签与余额门读同一个 cost） */
export const AUTO_EDIT = {
  id: "official.cut-auto-edit",
  title: msg`一键成片`,
  intro: msg`看一遍你排好的片段：起个片头标题、每段写一句旁白（也是字幕）、挑出该转场的地方——你看过、改过再用`,
  steps: [
    { kind: "input", title: msg`读时间轴`, hint: msg`按现在的顺序与时长，把每个片段的画面讲给模型听` },
    { kind: "model", title: msg`写旁白`, hint: msg`模型写：片头标题、每段一句话、哪几处换了场` },
    { kind: "check", title: msg`形状检查`, hint: msg`编号对不上的、写重了的丢掉；转场只留在确实换了场的接缝上` },
    { kind: "confirm", title: msg`你来点头`, hint: msg`逐句都能改；太长念不完的会标出来` },
    { kind: "apply", title: msg`写进剪辑台`, hint: msg`一步撤销得回去；要配音的话接着一句一句合成` },
  ] satisfies readonly SkillStep[],
  confirmAt: ["confirm"] satisfies readonly SkillStepKind[],
  cost: CHAT_TURN_TOKENS,
} as const;

/* i18n-frozen: 后期剪辑师模型的系统提示词（规定输出的 JSON 形状），冻结中文 */
const SYS =
  `你是短视频的后期剪辑师，给一条已经排好顺序的成片配旁白。用户先说明用哪种语言写，再按播放顺序给出每个片段：编号、时长、这一段的旁白最多写多长、` +
  `它与上一段的关系（同一个镜头接着拍 / 换了场 / 不确定）、以及这一段画面里发生的事。请你：` +
  `① 起一个片头标题：中文不超过 12 个字，英文不超过 6 个单词，不带标点、引号和书名号；` +
  `② 给每个片段写一句旁白（它同时会作为字幕烧在画面上）：口语化，像在给人讲这个故事，前后几句连起来是一段通顺的讲述；` +
  `不要照抄画面描述，不要出现"镜头""画面""特写""景别"这类拍摄用语；长度不要超过该片段的上限；` +
  `实在没话可说的片段给空字符串；` +
  `③ 挑出适合在开头加"闪黑"转场的片段编号：只挑时间或地点明显换了的地方，整条片子最多三处，可以一处都不挑；` +
  `标着"同一个镜头接着拍"或"不确定"的片段不许挑，第 1 个片段不许挑；` +
  `④ 给一句配乐建议：情绪或风格，中文 10 个字以内，英文 5 个单词以内。` +
  `标题、旁白、配乐建议都用用户指定的那种语言写（指定英文就全部写英文、用英文标点）。` +
  `只输出 JSON，不要解释：{"title":"…","lines":[{"clip":1,"text":"…"}],"fades":[3],"music":"…"}`;

/* i18n-frozen: 给模型看的片段清单里的固定说法（「它与上一段的关系」那一格、没有画面描述时的占位），与 SYS 的措辞对应，冻结中文 */
const BRIEF_ZH = {
  seam: {
    first: "开场",
    "same-shot": "同一个镜头接着拍",
    "scene-change": "换了场",
    unknown: "不确定",
  } satisfies Record<AutoBriefClip["seam"], string>,
  noPlot: "（没有描述）",
  langZh: "【语言】中文",
  langEn: "【语言】英文（标题、旁白、配乐建议全部用英文写）",
};

/**
 * 清单 → 给模型的那段话：第一行说用哪种语言写，之后一个片段两行（编号｜时长｜上限｜接缝，然后是画面）。
 * ★ 语言由这里**明说**（cutProject.briefLang 按画面描述判），不让模型自己看着办：2026-10-01 实测画面描述是英文时，
 *   它 3 次里 3 次照样写中文旁白。英文的上限折成单词数（capWords）—— 模型数不准"字母 × 0.4"，数得准单词。
 */
function briefText(brief: ReadonlyArray<AutoBriefClip>): string {
  const en = briefLang(brief) === "en";
  const rows = brief.map((b) => {
    const limit = en ? zhPrompt`最多${capWords(b.cap)}个英文单词` : zhPrompt`最多${b.cap}字`;
    return zhPrompt`片段${b.n}｜${b.durSec.toFixed(1)}秒｜${limit}｜${BRIEF_ZH.seam[b.seam]}\n画面：${b.plot || b.title || BRIEF_ZH.noPlot}`;
  });
  return [en ? BRIEF_ZH.langEn : BRIEF_ZH.langZh, ...rows].join("\n");
}

export interface AutoEditRun {
  plan: AutoPlan;
  brief: AutoBriefClip[];
  /** 这一版是演示档出的（没有真模型）：面板要标出来，不冒充模型 */
  demo: boolean;
}

/**
 * 跑到确认之前：门禁（时间轴上有没有东西 / 余额）→ 模型 → 形状检查。`onStep` 报每一步开始（面板的步骤栏据此亮灯）。
 * 失败整句 throw（铁律八）；类型见文件头（调用方拿 ai/failCharge 说钱）。
 */
export async function runAutoEdit(
  project: CutProject,
  segs: ReadonlyArray<{ title?: string; plot?: string; carried?: boolean } | undefined>,
  lens: ReadonlyArray<number>,
  onStep: (kind: SkillStepKind) => void,
): Promise<AutoEditRun> {
  const brief = autoBrief(project, segs, lens);
  if (brief.length === 0) throw new Error(t`时间轴上还没有片段，没有可写的`);
  if (AI_REAL && !canAfford(AUTO_EDIT.cost)) {
    const price = fmtTokens(AUTO_EDIT.cost);
    throw new Error(frozenNote() ?? t`一键成片要 ${price} token，余额不够——去「我的」页充值`);
  }
  onStep("model");
  if (!AI_REAL) {
    onStep("check");
    return { plan: demoAutoPlan(brief), brief, demo: true };
  }
  const { text: raw, truncated } = await skillChat(SYS, briefText(brief), { maxTokens: AUTO_EDIT_MAX_TOKENS, timeoutMs: AUTO_EDIT_TIMEOUT_MS });
  onStep("check");
  // ★ 顶到上限就别去解析半截 JSON：说清是"被截断"（钱上的那半句由调用方的 failCharge 补）
  if (truncated) throw new ArkBadReply(t`模型写到一半被截断了（片段太多、旁白太长）——删掉几句不需要旁白的片段再试`);
  const r = parseAutoPlan(raw, brief);
  if (!r.ok) {
    throw new ArkBadReply(
      r.issue === "empty"
        ? t`模型这一次没写出能用的旁白（编号对不上，或者一句都没写）——再试一次`
        : t`模型这一次的回话读不出来（不是约定的格式）——再试一次`,
    );
  }
  // 整件事成了才记离线账本（远端模式下这是空操作：钱由服务端在那一发请求上结算过了）
  spendTokens(AUTO_EDIT.cost);
  return { plan: r.plan, brief, demo: false };
}
