// 跟着做 L「唱一段」向导的**全部**状态 —— 活在 store 里，不活在组件里（2026-10-31，方案 docs/canvas-platforms-ecosystem-research.md §五 L、第十节的付费探测）。
//
// ★★ 为什么（与 effectDraftStore / dialogueDraftStore 同一个理由）：向导里有一件花钱的活 —— AI 写歌词（一次对话）。画布那一面的向导是个抽屉，
//   点一下遮罩就关了；工坊那一面退回选法屏它就卸了。结果写进组件 state 的话，付过钱的那几行歌词静默丢掉。放在这里：关了再开原样还在。
// ★ 唱的人用 leadDraftStore 的那一份（castIds，与 B / C / G / I 同一批人）：只取先点的那一位；这里只多一张场景卡（可选）。
// ★ 表单是**谁的**（gridDraftStore 同一招）：换账号那一拍把上一个人的收进暗格；写到一半换了账号，写好的歌词写回开工那个人的那份。
// ★ 落成的是一段**参考图直出段**（direct：人物图直接给视频模型、不画帧，出片规则与 A / G 同一份 data/drawPlan）：没有关键帧、不承接上一段。
// ★ 依赖方向：data → store → 组件。这里认 ai / data / structuredSkills（它们都不认组件）。
import { t } from "@lingui/core/macro";
import { create } from "zustand";
import { chargeNote, chargeOnFail } from "../ai";
import { onOwnerSwitch, workOwner } from "../data/deviceOwner";
import { CHAT_TURN_TOKENS } from "../data/economy";
import { currentRoute, startJob } from "../data/jobs";
import { lyricsIssue, parseLyrics, songLang, songPrompt, type SongMoodId, type SongStyleId } from "../data/songShots";
import { uid, type Card, type Proposal, type VideoAspect } from "../types";
import type { AppendSpec } from "./flowStore";
import { runLyrics } from "./structuredSkills";

/** 向导的三步：谁来唱 → 歌词 + 曲风 → 出片 */
export type SongStep = "cast" | "lyrics" | "go";
export const SONG_STEPS: readonly SongStep[] = ["cast", "lyrics", "go"];

export interface SongDraft {
  step: SongStep;
  /** 场景卡（可选）。唱的人在 leadDraftStore.castIds（先点的那一位） */
  placeId: string | null;
  styleId: SongStyleId;
  moodId: SongMoodId;
  /** 歌词正文（一行一句；parseLyrics 切） */
  lyrics: string;
  /** 让 AI 写歌词的那句主题 */
  theme: string;
  /** 歌词是 AI 写的（false = 自己写的 / 改过）：那颗键说「重新写」还是「AI 写」 */
  linesAi: boolean;
  linesDemo: boolean;
  /** 模型多写了几行（没收）；0 = 没什么要说 */
  dropped: number;
  writing: boolean;
  writeErr: string;
  aspect: VideoAspect | null;
  /** 时长；null = 缺省（songShots.SONG_DEFAULT_SEC 按档位夹） */
  durationSec: number | null;
  /** 向导此刻挂着没有（后台任务票据此决定要不要弹通知） */
  mounted: boolean;
}

export function initialSongDraft(): SongDraft {
  return {
    step: "cast",
    placeId: null,
    styleId: "ballad",
    moodId: "tender",
    lyrics: "",
    theme: "",
    linesAi: false,
    linesDemo: false,
    dropped: 0,
    writing: false,
    writeErr: "",
    aspect: null,
    durationSec: null,
    mounted: false,
  };
}

export const useSongDraft = create<SongDraft>()(() => initialSongDraft());

let draftOwner = "";
function ownerOfDraft(): string {
  if (!draftOwner) draftOwner = workOwner();
  return draftOwner;
}
const parked = new Map<string, SongDraft>();

onOwnerSwitch((prev, next) => {
  const cur = useSongDraft.getState();
  const dirty = !!cur.lyrics || !!cur.theme || cur.writing || !!cur.placeId;
  if (dirty) parked.set(prev, { ...cur, mounted: false });
  const back = parked.get(next);
  parked.delete(next);
  useSongDraft.setState({ ...(back ?? initialSongDraft()), mounted: cur.mounted }, true);
  draftOwner = next;
});

function writeFor(who: string, patch: Partial<SongDraft>): void {
  if (who === ownerOfDraft()) {
    useSongDraft.setState(patch);
    return;
  }
  const p = parked.get(who);
  if (p) parked.set(who, { ...p, ...patch });
}

export function setSong(patch: Partial<SongDraft>): void {
  useSongDraft.setState(patch);
}

/** 挑 / 取下场景卡（只挑一张） */
export function toggleSongPlace(id: string): void {
  const s = useSongDraft.getState();
  useSongDraft.setState({ placeId: s.placeId === id ? null : id });
}

/** 人改了歌词：从此算自己写的（AI 那颗键回到「AI 写」），模型多写的那句提示也不再提 */
export function setLyrics(text: string): void {
  useSongDraft.setState({ lyrics: text, linesAi: false, linesDemo: false, dropped: 0 });
}

/** 写歌词多少钱（与真扣同一个数：请求成功才扣一次） */
export const LYRICS_TOKENS = CHAT_TURN_TOKENS;

/**
 * 让 AI 写歌词：一次对话（studio/structuredSkills.runLyrics：门禁 / 扣钱 / 形状检查都在那里）。
 * ★ 领一张后台任务票（data/jobs）：一次对话十几秒，人可能先关了抽屉 —— 写好 / 没写成由胶囊说，人就在向导里时不弹。
 * ★ 写到一半换了账号：结果写回开工那个人的那份（writeFor）。
 */
export async function writeLyrics(o: { singer: string; lines: number }): Promise<void> {
  const s0 = useSongDraft.getState();
  if (s0.writing) return;
  const who = ownerOfDraft();
  writeFor(who, { writing: true, writeErr: "" });
  const page = currentRoute();
  const job = startJob({ kind: "song-lyrics", title: t`唱一段 · 写歌词`, page, route: page, progress: t`正在写…` });
  try {
    const r = await runLyrics({ theme: s0.theme, singer: o.singer, styleId: s0.styleId, lines: o.lines });
    writeFor(who, { lyrics: r.lines.join("\n"), linesAi: true, linesDemo: r.demo, dropped: r.dropped, writing: false });
    job.done({ msg: t`歌词写好了`, silent: who === ownerOfDraft() && useSongDraft.getState().mounted });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    const money = chargeNote(chargeOnFail(e), LYRICS_TOKENS);
    const moneyLine = money?.line ?? "";
    writeFor(who, {
      writing: false,
      writeErr: money
        ? t({
            message: `歌词没写成：${why}。${moneyLine}`,
            comment: "why 是失败原因整句；moneyLine 是一句完整的、自带句号的话，说钱扣没扣（ai/failCharge.chargeNote）；英文在它前后各留一个空格",
          })
        : t`歌词没写成：${why}`,
    });
    job.fail(t`唱一段的歌词没写成，回去看原因`);
  }
}

/** 落成一段之后：清掉这一次的歌词与主题、回到第①步（曲风 / 情绪 / 场景卡留着：下一段多半还是这个味道） */
export function resetSong(): void {
  const s = useSongDraft.getState();
  useSongDraft.setState({ ...initialSongDraft(), styleId: s.styleId, moodId: s.moodId, placeId: s.placeId, aspect: s.aspect, mounted: s.mounted }, true);
}

/**
 * 交给 flowStore 落段的那一份（appendSpecs 落段、appendSpecsQuote 报价读的是同一份）。
 * ★ 落成一段**参考图直出段**（direct）：没有开头帧（人物图与场景图直接给视频模型，出片规则与 A 同一份 data/drawPlan）、**不承接**上一段
 *   （chain:false：唱一段是一条独立的片子，承接会拿上一段的尾帧当开头）。
 * ★ 素材：唱的人那张卡（卡上有声音样本的，segmentGen.voiceRefsFor 按台词里的名字带上）+ 场景卡（挑了的话）。
 * ★ 歌词配这个时长唱不完（songShots.lyricsIssue）就不落（回 null，界面已经在时长那排说了为什么）。
 * @param o.title 方案标题（存进作品，按作者当时的界面语言定下来，由向导传进来）
 */
export function songAppendSpec(
  d: Pick<SongDraft, "lyrics" | "styleId" | "moodId">,
  o: { singer: Card; place: Card | null; tierId: string; aspect: VideoAspect; durationSec: number; title: string },
): AppendSpec | null {
  const lines = parseLyrics(d.lyrics);
  if (lyricsIssue(lines, o.durationSec)) return null;
  const plot = songPrompt({ singer: o.singer.name, lines, styleId: d.styleId, moodId: d.moodId, place: o.place?.name ?? "", lang: songLang(d.lyrics) });
  const p: Proposal = {
    id: uid("prop"),
    title: o.title,
    plot,
    firstFrame: "",
    lastFrame: "",
    durationSec: o.durationSec,
  };
  const materials = o.place ? [o.singer, o.place] : [o.singer];
  return {
    proposals: [p],
    chosenId: p.id,
    materials,
    videoTier: o.tierId,
    aspect: o.aspect,
    requirement: o.title,
    chain: false,
    direct: true,
  };
}
