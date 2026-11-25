// 对局结束屏上的「收尾」区块（2026-11-24 晚；任务：打完一局问一句这一局的片子要不要留下）。
//
// ★★ 三颗键，一颗都不许是摆设：
//   · 「⬇️ 保存到本地」→ 走 `data/videoDownload`（保存到本地的**唯一实现**），计划由
//     `planClipDownload` 给；多段 = 逐段存（每回合一条独立短片，见那个函数的 ★）。
//   · 「🚀 发布」→ 现有发布流程（`/publish`）：把这一局最好的那一段翻成一份合成稿塞进
//     `studioStore.draft`（`wrapup.wrapupDraftOf`），发布页上标题 / 封面 / 简介已经填好。
//   · 「先不存」→ 关掉（写进 game store 的 `wrapupClosed`，离开这一页再回来不会重问）。
// ★★ 片子从哪儿来（任务点名）：联机局是本机**打完那一拍**留下的那份战绩（`rounds/history`
//   的缓存，historyCache 存完会广播一次，这里跟着重读）；本机局是本机战绩（`localHistory`）。
//   两条路都经 `wrapup.wrapupPickOf` 判"这一份是不是这一局"——**绝不拿上一局顶替**。
// ★★ 占位片不提供保存：一颗按下去必然失败的键比没有键更坏，"这一段是占位片，没有成片"
//   才是玩家能懂的那句话（判据在 `wrapup.wrapupOf`）。
// ★ 这一屏**不算任何数**：名次 / 点赞 / 票来自 history（服务端那一份或本机落盘那一份），
//   能不能存来自 videoDownload，能不能发来自"有没有真片"。它只负责摆键与说结果。
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { useGame } from "../store";
import { subscribeHistoryCache, captureOnlineHistory } from "../historyCache";
import { readLatestLocalGame, readLocalGameOfRoom } from "../localHistory";
import { localGameOwner } from "../localHistoryOwner";
import { clipIdOf, wrapupDraftOf, wrapupOf, wrapupPickOf, type Wrapup } from "../wrapup";
import { DEFAULT_VIDEO_CATEGORY } from "../../../types";
import { useStudio } from "../../studioStore";
import { probeDuration } from "../../../utils/videoFrames";
import GameBtn from "./GameBtn";
import WrapupSheet, { type WrapupSheetMode } from "./WrapupSheet";

/** 没有记录时的空壳（`wrapupOf` 在同一份判据下也回这个，这里只给 JSX 一个初值） */
const NO_CLIPS: Wrapup = { clips: [], best: null, placeholderRounds: [], myRounds: 0 };

/**
 * 「先不存」答过的那一局（**模块级**，只活在这一场会话里）。
 *
 * ★★ 为什么不写进 game store：这一格必须和"哪一局"绑在一起 —— 新开一局要重新问一次。
 *   `seed` 就是那一局的身份证（开局 / 🔁 再来一局时它会变），比"什么时候清标志"更靠得住：
 *   写 store 的话，`startGame` / `endGame` / 重连三条路都得记得归位，漏一条就是"下一局不问"
 *   （零报错）。存的是 seed 而不是布尔，新的一局自然对不上。
 * ★ 为什么不是 `useState`：点「🚀 发布」会把人带去 `/publish`，回来时这一层是**重新挂载**的，
 *   组件 state 一重挂载就归零 —— 玩家回来会看到同一块收尾再问一遍，而他刚答过。
 * ★ 只活在这一场会话：App 重启 / 刷新之后这一局本来也没了（对局状态只在内存里），
 *   所以不需要跨进程记住。
 */
let answeredSeed: number | null = null;

export default function WrapupPanel() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const online = useGame((s) => s.online);
  const outcome = useGame((s) => s.localHistory);
  /** 这一局的身份证（开局 / 再来一局时变）；答过的那一局据此认出来 */
  const seed = useGame((s) => s.seed);
  /** 只为了"答完那一下"重渲一次（模块级变量本身不会触发渲染） */
  const [, setTick] = useState(0);

  /**
   * 联机那一份是**异步**落下来的：`useOnlineRounds` 在判出对局结束的那一拍发一发
   * `rounds/history` 存进本机（打完就必须存 —— 退出房间之后服务端只回 403）。
   * 所以这一屏刚出现时可能还读不到；`historyCache` 存好之后会广播一次，这里跟着重读。
   * ★ 用 state 计数当依赖，而不是把 localStorage 读进 effect 再 setState：读是同步的，
   *   只在"记录可能变了"的那几拍重读一次就够（每次渲染都读 = 每 2 秒解析一次 JSON）。
   */
  const [cacheTick, setCacheTick] = useState(0);
  useEffect(() => subscribeHistoryCache(() => setCacheTick((n) => n + 1)), []);

  const roomCode = online?.roomCode ?? null;
  /**
   * 这一屏该拿哪一份记录 + 能带走哪些片子。
   * ★ 整块算在一起（而不是三个 useMemo 各算一半）：clipId / createdAt 的稳定性依赖
   *   "这一份记录是哪一份"，分开算就有一次渲染里两者对不上的窗口。
   */
  const view = useMemo(() => {
    const roomRecord = roomCode ? readLocalGameOfRoom(localGameOwner(), roomCode) : null;
    const latest = readLatestLocalGame(localGameOwner());
    const pick = wrapupPickOf({ roomCode, localOutcome: outcome, latest, roomRecord });
    if (pick.kind === "denied") return { pick, wrapup: NO_CLIPS, clipId: "", createdAt: 0 };
    const savedAt = (roomRecord ? roomRecord.savedAt : latest.kind === "ok" ? latest.record.savedAt : 0) || 0;
    const finished = pick.history.room.finishedAt;
    const finishedAt = typeof finished === "string" ? Date.parse(finished) : Number.NaN;
    const createdAt = Number.isFinite(finishedAt) ? finishedAt : savedAt;
    return {
      pick,
      wrapup: wrapupOf(pick.history, pick.meId),
      clipId: clipIdOf({ roomCode, finishedAt: finished, savedAt }),
      createdAt,
    };
    // cacheTick 是"记录可能变了"的那一拍（联机那一份存好了）
  }, [roomCode, outcome, cacheTick]);

  /** 打开的是哪一张面板（null = 都关着） */
  const [sheet, setSheet] = useState<WrapupSheetMode | null>(null);
  /** 发布页正在准备（量时长那一发） */
  const [busy, setBusy] = useState(false);
  /** 发布这一下没走成的那句话（走到发布页之后才失败的由发布页自己说） */
  const [publishErr, setPublishErr] = useState("");

  /** 答过的那一局就是这一局（见 `answeredSeed` 的 ★） */
  const answered = answeredSeed !== null && answeredSeed === seed;
  if (answered) return null;
  /** 收掉这一块：把"这一局答过了"记在 seed 上，并重渲一次把这一块摘掉 */
  const closeWrapup = () => {
    answeredSeed = seed;
    setTick((n) => n + 1);
  };
  const canSave = view.wrapup.clips.length > 0;
  const roomMissing = view.pick.kind === "denied" && view.pick.denial === "room-missing";

  /** 「🚀 发布」：把这一局最好的那一段带进现有发布流程 */
  async function publish() {
    if (busy || view.pick.kind !== "ok" || !view.wrapup.best) return;
    const clip = view.wrapup.best;
    setBusy(true);
    setPublishErr("");
    // 量一段有多长（量不出来按 0：发布页那一行只是"共 N 秒"，不参与报价与播放判定）。
    // ★ 6 秒上限：这一发只是"锦上添花"的一格数，不许把"去发布"这件事挂住（probeDuration 的 ★）。
    let durationSec = 0;
    try {
      durationSec = await probeDuration(clip.url, "video", 6_000);
    } catch {
      durationSec = 0;
    }
    const title = t`工坊对局 · 第 ${clip.round} 回合`;
    useStudio.setState({
      draft: wrapupDraftOf(clip, { title, category: DEFAULT_VIDEO_CATEGORY, durationSec }),
      publishedWorkId: null,
      draftAudioHint: null,
    });
    setBusy(false);
    // ★ 点了「发布」= 这个问题答过了：从发布页回来（放弃 / 发完）不该再问一遍同一件事
    closeWrapup();
    navigate("/publish");
  }

  /**
   * 这一局的片子情况那一句。
   * ★ 三种"没有片子"分开说（本机战绩没写下来 / 联机那份还没读到 / 只有占位片）：
   *   合成一句会让玩家以为"这一局本来就没片子"，而其中两种是可以再试一次的（铁律八）。
   */
  const summary =
    view.pick.kind === "denied" ? (
      <span className="text-slate-400">
        {view.pick.denial === "local-missing"
          ? t`这一局的战绩没存下来，片子也找不回来了`
          : t`还没拿到这一局的片子（服务端的战绩没读到）`}
      </span>
    ) : view.wrapup.myRounds === 0 ? (
      <span className="text-slate-400">
        <Trans>这一局你没交过片</Trans>
      </span>
    ) : view.wrapup.clips.length === 0 ? (
      // 占位片：**不提供保存**（任务点名的原话）
      <span className="text-slate-400">
        <Trans>这一段是占位片，没有成片</Trans>
      </span>
    ) : view.wrapup.placeholderRounds.length > 0 ? (
      <span className="text-slate-400">
        <Trans>
          {view.wrapup.clips.length} 段成片能带走；{view.wrapup.placeholderRounds.length} 段是占位片
        </Trans>
      </span>
    ) : (
      <span className="text-slate-400">
        <Trans>{view.wrapup.clips.length} 段成片都能带走</Trans>
      </span>
    );

  return (
    <div className="mt-1 rounded-lg border border-slate-700/70 bg-black/25 px-2 py-1">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px]">
        <span className="font-semibold text-slate-200">
          <Trans>收尾：这一局的片子</Trans>
        </span>
        {summary}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {canSave ? (
          <>
            <GameBtn tone="gold" onClick={() => setSheet("save")}>
              {t`⬇️ 保存到本地`}
            </GameBtn>
            <GameBtn tone="primary" onClick={() => setSheet("publish")} disabled={busy}>
              {t`🚀 发布`}
            </GameBtn>
            <GameBtn onClick={closeWrapup}>{t`先不存`}</GameBtn>
          </>
        ) : (
          <>
            <GameBtn onClick={closeWrapup}>{t`知道了`}</GameBtn>
            {/* 联机那份还没读到：给人一条重试的路（本机写入失败重试没有意义，不摆） */}
            {roomMissing && roomCode && (
              <GameBtn onClick={() => void captureOnlineHistory(roomCode, online?.myUserId ?? null)}>
                {t`再试一次`}
              </GameBtn>
            )}
          </>
        )}
        {busy && <span className="text-[10px] text-slate-400">{t`正在准备发布页…`}</span>}
      </div>
      {publishErr && <p className="mt-1 text-[10px] leading-snug text-danger-300">{publishErr}</p>}

      {sheet && canSave && (
        <WrapupSheet
          mode={sheet}
          clipId={view.clipId}
          createdAt={view.createdAt}
          title={t`工坊对局 · 这一局的片子`}
          clips={view.wrapup.clips}
          best={view.wrapup.best}
          busy={busy}
          onClose={() => setSheet(null)}
          onPublish={() => {
            setSheet(null);
            void publish().catch((e) => {
              setBusy(false);
              setPublishErr(e instanceof Error ? e.message : String(e));
            });
          }}
        />
      )}
    </div>
  );
}
