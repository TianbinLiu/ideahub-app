// 白模化前那一屏里的「**AI 看哪几帧**」。
//
// ══ 为什么会有这一块（2026-08-15 真机实测）══════════════════════════
// 白模化那一步是**先看后点名**：抽几帧 → chat vision 列出「画面里有哪些人」→ 按这份清单
// 点名写进白模化提示词。看帧数量原来写死 3 帧，于是一段 4 秒的素材（前段 2 人、后段围坐
// 群戏人更多）只认出 2 个人 —— 登记的角色位是 1、2，而方舟出片时看到更多人，
// **自己往下编到了 3**。结果画面上站着一个 3 号，角色位列表里却没有第 3 项：
// 用户挂不上它，只会以为坏了，而全程零报错。
//
// ⇒ 两条对策，这一块是它们的入口：
//   ① **自动**（默认）：帧数按时长走（每 1.5 秒一帧、下限 3 上限 8）。一帧几百 token，
//      很便宜，换的是"人别漏"；
//   ② **自己挑**：给「画面里人数会变」的素材用 —— 只有看得见画面的人知道谁在第几秒入场、
//      谁又走了，在变化的前后各标一帧，AI 才认得全。
// ★ 全白方案下这条对策**变得更要紧了**：清单之外的人照样会被换成白人偶（提示词说的是
//   "画面里所有人"），而他在画面上与一个角色位**长得一模一样** —— 于是他不但挂不了卡，
//   还会把他右边所有位子的「从左数第几个」挤歪一位。颜色时代靠"清单之外一律纯白"能一眼
//   分出路人与角色位，全白之后这个手段没了，这是本次有意接受的代价：
//   兜底从"提示词里区分"挪到了**作者核对那一屏**（他数一遍就看得出来）。
//
// ── 这一块只收 props，不认识任何 store（与 BlockoutTrimmer / PlanBoard 同款约束）───
// ★ 缩略图从**本机 `<video>`** 抓（宿主给的 `onCapture` → VideoStage.capture），不向服务端
//   要：那是一次要花钱的抽帧，而这里只是给人看"我标的是哪一帧"。
// ★ 标记按**绝对秒**存（用户是对着画面标的），换算成提交用的 `frameTimes`（相对选段起点）
//   只有 `arkVideoRules.frameTimesOf` 一处 —— 选段之后还会被拖动，存相对秒的话拖一下
//   起点，同一条标记就悄悄指向了另一帧，而缩略图还停在旧画面上。
import { useState } from "react";
import { BLOCKOUTIZE_FRAME_MAX, BLOCKOUTIZE_FRAME_MIN, BLOCKOUTIZE_FRAME_EVERY_SEC } from "../../data/templates";
import { formatDuration } from "../../types";
import { markInSelection, type BlockoutSelection } from "./arkVideoRules";
import type { CapturedFrame } from "./VideoStage";

export type VisionMode = "auto" | "manual";

/** 一条标记：绝对秒 + 本机抓的缩略图（`thumb` 可能是空串，见 VideoStage.capture 的 ★）。
 *  ★ 形状就是 VideoStage 抓回来的那一条，不另起一个 —— 两个形状会各自漂 */
export type FrameMark = CapturedFrame;

export interface VisionFramePickerProps {
  mode: VisionMode;
  onModeChange: (m: VisionMode) => void;
  /** 当前选段（标记的合法区间、以及"相对第几秒"都按它算） */
  sel: Pick<BlockoutSelection, "startSec" | "durSec">;
  /** 自动模式下这一段会看几帧（由宿主从 data/templates.autoVisionFrames 取，别在这里再算一遍） */
  autoFrames: number;
  marks: FrameMark[];
  onMarksChange: (next: FrameMark[]) => void;
  /** 播放头（绝对秒）。「标记这一帧」标的就是它所在的那一秒 */
  playheadSec: number;
  /** 请求宿主把播放头挪到某个绝对秒（复用编辑页那一条 seekTo） */
  onSeek: (sec: number) => void;
  /** 抓一帧（宿主转给 VideoStage.capture）。★ 必须带超时——后台页解码会挂起 */
  onCapture: (atSec: number) => Promise<CapturedFrame>;
  disabled?: boolean;
}

/** 播放头落在选段里的第几秒（整数，夹进 [0, durSec-1]）—— 标记与滑杆共用这一个换算 */
function relSecOf(playheadSec: number, sel: Pick<BlockoutSelection, "startSec" | "durSec">): number {
  const last = Math.max(0, Math.round(sel.durSec) - 1);
  return Math.max(0, Math.min(last, Math.round(playheadSec) - Math.round(sel.startSec)));
}

export default function VisionFramePicker({
  mode,
  onModeChange,
  sel,
  autoFrames,
  marks,
  onMarksChange,
  playheadSec,
  onSeek,
  onCapture,
  disabled,
}: VisionFramePickerProps) {
  /** 抓帧失败的整句原因（超时、解不开）。★ 一律显示，不吞：吞掉的表现是"点了没反应" */
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const start = Math.round(sel.startSec);
  const last = Math.max(0, Math.round(sel.durSec) - 1);
  const rel = relSecOf(playheadSec, sel);
  /** 落在选段外的标记：**不会被提交**（frameTimesOf 会滤掉），所以必须画出来让用户处理，
   *  不能装作没有 —— 否则他数着 5 帧、实际只发上去 3 帧，报价与实收也就此分家 */
  const outside = marks.filter((m) => !markInSelection(m.atSec, sel));
  const inside = marks.filter((m) => markInSelection(m.atSec, sel));
  const already = inside.some((m) => Math.round(m.atSec) - start === rel);
  const full = inside.length >= BLOCKOUTIZE_FRAME_MAX;

  /** 「标记这一帧」现在点不动的原因（null = 点得动）。★ 灰按钮必须配一句话 */
  const markBlock = disabled
    ? null
    : full
      ? `已经标满 ${BLOCKOUTIZE_FRAME_MAX} 帧了（再多也只是买重复的画面）——先删掉一帧再标。`
      : already
        ? "这一秒已经标过了。把播放头挪到别处再标（人物入场/离场的前后各一帧最有用）。"
        : null;

  async function mark() {
    if (busy || disabled || markBlock) return;
    setErr("");
    setBusy(true);
    try {
      // ★ 抓的是**将要提交的那一帧**（对齐到整数秒）：服务端收的 frameTimes 是整数秒，
      //   抓 2.37 秒却提交第 2 秒的话，缩略图就是一张服务端根本不会看的画面
      const got = await onCapture(start + rel);
      const at = Math.round(got.atSec);
      if (marks.some((m) => Math.round(m.atSec) === at)) {
        setErr("这一秒已经标过了（播放头刚好落回同一帧）。");
        return;
      }
      onMarksChange([...marks, { atSec: at, thumb: got.thumb }].sort((a, b) => a.atSec - b.atSec));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const tab = (m: VisionMode, label: string) => (
    <button
      key={m}
      onClick={() => onModeChange(m)}
      disabled={disabled}
      className={`flex-1 rounded-lg py-1.5 text-xs font-semibold disabled:opacity-40 ${
        mode === m ? "bg-brand text-ink" : "bg-slate-700/70 text-slate-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-2 rounded-lg border border-slate-700/70 bg-panel/60 px-3 py-2.5">
      <p className="text-[11px] font-bold text-slate-200">AI 看哪几帧</p>
      <p className="text-[10px] leading-relaxed text-slate-500">
        白模化前，AI 先看几帧、列出<b className="text-slate-300">画面里有哪些人</b>，再按这份清单
        逐个点名替换成<b className="text-slate-300">一模一样的纯白人偶</b>。
        <b className="text-amber-300">看漏了人，他照样会被换成白人偶</b>
        ——但清单里没有他的位置，所以挂不了卡，而且<b className="text-amber-300">他还会把别人的
        「从左数第几个」挤歪一位</b>。
      </p>
      {/* ★★ 命中率：这一屏是**花钱之前的最后一屏**，目的是让作者多标几帧 / 减少人数。
          与提取器那一屏逐字同源，同样**不给具体数字**（旧的那句"7 发 4 发全对"是颜色方案
          那一版提示词的实测，那一版已经删了 —— 理由见提取器那一处的 ⚠）。 */}
      <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[10px] leading-relaxed text-amber-200/90">
        <b className="font-bold">这一步不是每次都全对。</b>
        实测每隔几发就会有 1~2 个人<b className="font-bold">根本没被换成人偶</b>（还是原来的样子）
        —— 最常出错的是<b className="font-bold">画面正中央、看起来最像主角的那一个</b>。
        出片之后你要对着画面从左往右数一遍：对不上的位子删掉就行（不用重炼、不花钱），
        要全对上只能重炼（<b className="font-bold">重炼要再花一次钱</b>）。
        <b className="font-bold">画面里的人越少越准</b>，也可以在下面多标几帧让 AI 少看漏人。
      </p>

      <div className="flex gap-2">
        {tab("auto", "自动（推荐）")}
        {tab("manual", "自己挑")}
      </div>

      {mode === "auto" ? (
        <p className="text-[11px] leading-relaxed text-slate-400">
          按这一段的时长自动取帧：现在是 <b className="text-slate-200">{autoFrames} 帧</b>
          （每 {BLOCKOUTIZE_FRAME_EVERY_SEC} 秒一帧，最少 {BLOCKOUTIZE_FRAME_MIN} 帧、最多 {BLOCKOUTIZE_FRAME_MAX} 帧）。
          <b className="text-slate-300">拖时间轴改选段长度，帧数和下面的报价都会跟着变。</b>
        </p>
      ) : (
        <>
          <p className="text-[11px] leading-relaxed text-slate-400">
            <b className="text-slate-200">画面里人数会变（有人入场 / 离场）时用这个</b>：在变化的
            <b className="text-slate-200">前后各标一帧</b>，AI 才认得全。其余情况用「自动」就够了。
          </p>

          {/* 定位：复用同一个播放器与播放头，这里只提供"按秒对齐"的那一层 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSeek(start + Math.max(0, rel - 1))}
              disabled={disabled || rel <= 0}
              className="flex-none rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200 disabled:opacity-40"
            >
              −1s
            </button>
            <input
              type="range"
              min={0}
              max={last}
              step={1}
              value={rel}
              onChange={(e) => onSeek(start + Number(e.target.value))}
              disabled={disabled}
              className="min-w-0 flex-1 accent-sky-400 disabled:opacity-40"
              aria-label="把播放头挪到选段里的第几秒"
            />
            <button
              onClick={() => onSeek(start + Math.min(last, rel + 1))}
              disabled={disabled || rel >= last}
              className="flex-none rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200 disabled:opacity-40"
            >
              +1s
            </button>
            <span className="flex-none text-[11px] tabular-nums text-slate-400">
              第 {rel} 秒
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void mark()}
              disabled={disabled || busy || !!markBlock}
              className="flex-1 rounded-xl border border-sky-500/60 bg-sky-500/10 py-2 text-xs font-bold text-sky-200 disabled:opacity-40"
            >
              {busy ? "正在取这一帧…" : "＋ 标记这一帧"}
            </button>
            <span className="flex-none text-[11px] tabular-nums text-slate-400">
              已标 {inside.length}/{BLOCKOUTIZE_FRAME_MAX}
            </span>
          </div>

          {/* 点不动就说清为什么（本仓禁止"灰着且不说话"） */}
          {markBlock && <p className="text-[10px] leading-relaxed text-amber-300">{markBlock}</p>}
          {err && <p className="text-[10px] leading-relaxed text-rose-300">{err}</p>}

          {marks.length === 0 ? (
            <p className="text-[10px] leading-relaxed text-slate-500">
              还没标任何一帧。至少要标 1 帧才能开炼——拖上面的滑杆到有人的地方，点「标记这一帧」。
            </p>
          ) : (
            <div className="flex gap-1.5 no-scrollbar overflow-x-auto pb-1">
              {marks.map((m) => {
                const at = Math.round(m.atSec);
                const ok = markInSelection(at, sel);
                return (
                  <div key={at} className="relative flex-none">
                    <button
                      onClick={() => onSeek(at)}
                      disabled={disabled}
                      className={`block overflow-hidden rounded-lg border ${ok ? "border-sky-500/60" : "border-rose-500/70"}`}
                      aria-label={`跳到第 ${at} 秒`}
                    >
                      {m.thumb ? (
                        <img src={m.thumb} alt="" className="h-14 w-auto max-w-[7rem] object-cover" />
                      ) : (
                        // 缩略图抓不到（跨域素材污染了画布）时不留白：这一帧照样作数，
                        // 只是没有小图 —— 空着会让人以为标记没成功
                        <span className="flex h-14 w-20 items-center justify-center bg-slate-800 text-[10px] text-slate-400">
                          无预览
                        </span>
                      )}
                      <span
                        className={`block px-1 py-0.5 text-center text-[10px] tabular-nums ${
                          ok ? "bg-black/60 text-slate-200" : "bg-rose-500/25 text-rose-200"
                        }`}
                      >
                        {ok ? `第 ${at - start} 秒` : "不在选段内"}
                      </span>
                    </button>
                    <button
                      onClick={() => onMarksChange(marks.filter((x) => Math.round(x.atSec) !== at))}
                      disabled={disabled}
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/90 text-[11px] text-slate-200 ring-1 ring-slate-600 disabled:opacity-40"
                      aria-label={`删掉第 ${at} 秒这一帧`}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {outside.length > 0 && (
            <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-rose-200">
              有 {outside.length} 帧落在选段外面（选段后来被拖动过），
              <b>不会被采用、也不计费</b>——把它们删掉，或者把选段拖回去（它们在原片的第{" "}
              {outside.map((m) => formatDuration(Math.round(m.atSec))).join(" / ")} 处）。
            </p>
          )}
        </>
      )}
    </div>
  );
}
