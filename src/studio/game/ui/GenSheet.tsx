// 生成小窗（G4 施工单 §2：摆完卡 → 点「视频生成」→ 弹小窗输入提示词 → 用桌面上的卡 + 提示词出片）。
//
// ★ 两步保留：**先画首帧看一眼（① 画首帧）→ 满意了再出片（② 出片）**。这不是新做的规矩 ——
//   快速模式（QuickModePage，2026-11-22 阶段 A）那一条就是它：首帧不对时不用等 5 分钟视频出来
//   才发现（真机上被审核拒的那次就白等了一整条）。两步各自问同一个报价函数（redrawCost / nodeCost）。
// ★ 这里**不写一条出片实现**：画帧走 flowStore.regenProposal、出片走 flowStore.genNode，
//   发的契约由 game/gen.gameSegmentSpec 拼（模型/档位/素材/要求都在那一处，铁律六）。
// ★ 提示词里带上卡名：素材卡的 `name` 走 segmentGen.materialText 现有的那句
//   「本段固定素材设定……人物卡「名字」」进视频提示词 —— 卡名能被模型认出来靠的就是它，
//   这里不再自己拼一句"参考这几张卡"（那是第二套点火话术）。
// ★ 钱如实说（G4 收尾 2026-11-23 接上服务端游戏券）：三种状态三种说法，判据只在 data/gameTicketRules
//   （能力位 + 余额 + perGeneration）：
//     · 有券   → 「这一发用游戏券（剩余 N）」：出片扣一张券、不扣 token；**画首帧照旧按 token**（券只认出片）；
//     · 用完   → 「这一发按 token 结算」+ 几号刷新（券买不到，说"去充值"是死路 —— 服务端 NO_GAME_TICKET 也这么说）；
//     · 没有/没读到 → 「这一发按 token 结算」：老服务端（没有 gameTickets 能力位）不摆券数，也不带券头，与改版前逐字节相同。
//   绝不写"免费"：券是花掉了的一张额度，而首帧那笔 token 是真的。
// ★ 带券那一发交给 genNode 的 opts（payWithTicket / rejectText）：带不带由 flowStore 再问一次
//   `canPayWithTicket()`（券可能刚被另一发用掉），四个拒绝码的人话在 studio/game/reasons.gameRejectText。
// ★ 出片完成不自动交片：玩家可能想先看一遍。看完点「用这一条交片」才写进这一期作品
//   （rules.submitRoundEntry 只认桌面上的卡 + 这句提示词，视频地址是 patch 进去的）。
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { fmtTokens, tierOf } from "../../../data/economy";
import { resetDayOf } from "../../../data/gameTicketRules";
import { refreshGameTickets } from "../../../data/gameTickets";
import { useGameTickets } from "../../../hooks/useGameTickets";
import { chosenOf, nodeDone, realVideoOfNode, useFlow } from "../../flowStore";
import { useGame } from "../store";
import { useRounds } from "../roundsStore";
import { gameGenQuote, gameGenQuoteOf, gameNodeOfRound, gameSegmentSpec, seedGameSegment } from "../gen";
import { gameRejectText } from "../reasons";
import type { GameView } from "../view";
import { entryPayloadOf } from "./entryPayload";
import GameBtn from "./GameBtn";

export default function GenSheet({ view, onClose }: { view: GameView; onClose: () => void }) {
  const { t } = useLingui();
  const nodes = useFlow((s) => s.nodes);
  const busy = useFlow((s) => s.busy);
  const flowErr = useFlow((s) => s.err);
  const prompt = useGame((s) => s.createPrompt);
  const online = useGame((s) => s.online);
  const eliminated = useGame((s) => s.state?.players.find((player) => player.id === s.meId)?.eliminated ?? false);
  const round = view.hud.round;
  const [drawing, setDrawing] = useState(false);
  /** 券：有券 / 用完 / 这台服务器没有 / 还没读到 —— 三句钱的说明与那一发带不带券头都读它 */
  const ticket = useGameTickets();

  // 打开小窗就读一次余额（别拿上一回合的旧数决定"用不用券"；读不到就按 token 走，服务端会兜底）
  useEffect(() => {
    void refreshGameTickets();
  }, []);

  const node = gameNodeOfRound(nodes, round);
  const index = node ? nodes.findIndex((candidate) => candidate.id === node.id) : -1;
  const prop = node ? chosenOf(node) : null;
  const frame = prop?.firstFrame ?? "";
  const video = node ? realVideoOfNode(node) : undefined;
  // 还没铺段时也要报价：拿 appendedNode 造一份**真会落下的那一段**再问价（不落段、不花钱）
  const quote = node && index >= 0 ? gameGenQuote(node, index) : gameGenQuoteOf(view.player, prompt, round);
  const done = node ? nodeDone(node) : false;
  const tierLabel = node ? tierOf(node.videoTier).label : "";

  /** 铺段（不花钱）+ 把玩家这一刻的提示词写进这一段（改过词再点也照新的来） */
  const prepare = (): string | null => {
    const existing = gameNodeOfRound(useFlow.getState().nodes, round);
    if (existing) {
      // 提示词改过：requirement 与剧情都跟着改（剧情才是真正发出去的那一句）
      useFlow.getState().updateNode(existing.id, { requirement: prompt });
      const chosenId = chosenOf(existing).id;
      useFlow.getState().updateProposal(existing.id, { plot: prompt }, chosenId);
      return existing.id;
    }
    return seedGameSegment(gameSegmentSpec(view.player, prompt, round));
  };

  const drawFrame = async () => {
    if (drawing || busy) return;
    const id = prepare();
    if (!id) return; // 铺失败：原因在 flowErr（下面那行直接摆出来）
    setDrawing(true);
    try {
      await useFlow.getState().regenProposal(id);
    } catch (error) {
      // 不 catch 的话失败只表现为"按钮弹回原样"，一句话都没有（快速模式真机踩过）
      console.error(error);
    } finally {
      setDrawing(false);
    }
  };

  const generate = async () => {
    if (drawing || busy) return;
    const id = prepare();
    if (!id) return;
    setDrawing(true);
    // 流程机：真的开始出片那一发打上 generating（画首帧不打；见 game/store 的 beginGenerating）
    useGame.getState().beginGenerating();
    try {
      // 带券出片：带不带由 flowStore 再核一次（见文件头）；四个拒绝码的人话在 reasons.gameRejectText
      await useFlow.getState().genNode(id, { payWithTicket: ticket.canPay, rejectText: gameRejectText });
    } catch (error) {
      console.error(error);
    } finally {
      // 成功 / 失败都回摆卡格：失败要能改词重试，成功要能看到"用这一条交片"
      useGame.getState().endGenerating();
      setDrawing(false);
      // 券在服务端扣 / 退：这一发之后立刻重读余额（flowStore 的 finally 也读一次，这里兜"根本没铺成段"的那条路）
      void refreshGameTickets(true);
    }
  };

  const submit = () => {
    if (!node || eliminated) return;
    const url = realVideoOfNode(node);
    if (!url) return;
    const seconds = prop?.realDurationSec ?? prop?.durationSec;
    // 本机这一期先写（单机的展映 / 结算要它）；联机再交给服务端（同一份卡名 / 提示词 / 档位，见 entryPayload）
    // 首帧一并交给本机那一期当封面（本机战绩的回放条读它；不给就是一块占位色）
    useGame.getState().saveEntry({ videoUrl: url, posterUrl: frame || undefined, seconds });
    if (online) {
      void useRounds
        .getState()
        .submit(entryPayloadOf(view, useGame.getState().createPrompt, { videoUrl: url, posterUrl: frame || undefined }))
        .then((ok) => {
          if (ok) useGame.getState().markOnlineSubmitted();
        });
    }
    onClose();
  };

  /** 这一发扣几张券（服务端说，别在界面上写死 1） */
  const perGen = ticket.tickets?.perGeneration ?? 1;
  /** 下一次刷新的日子（几号）—— 服务端给的是下个月 1 日 00:00 UTC，句子跟着回包走 */
  const resetDay = resetDayOf(ticket.tickets?.nextResetAt ?? "");

  return (
    <div className="pointer-events-auto w-full max-w-[40rem] rounded-xl bg-panel/95 p-2 ring-1 ring-brand/40 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-slate-100">
          <Trans>第 {round} 回合 · 视频生成</Trans>
        </span>
        <span className="text-[9px] text-slate-400">
          <Trans>用桌面上的卡（{view.table.roles.filter(Boolean).length} 角色 / {view.table.scene ? 1 : 0} 场景）+ 这句提示词</Trans>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t`关掉生成小窗`}
          className="ml-auto rounded px-1.5 text-[11px] text-slate-400 active:bg-white/10"
        >
          ✕
        </button>
      </div>

      {/* 提示词就在这一行（创作面板上那个输入框是同一份 store.createPrompt：两处各存一份会发错句子） */}
      <div className="mt-1 flex items-center gap-1.5">
        <span className="flex-none text-[9px] text-slate-400">
          <Trans>提示词</Trans>
        </span>
        <span className="min-w-0 flex-1 truncate rounded bg-ink/50 px-1.5 py-0.5 text-[10px] text-slate-200">
          {prompt.trim() || <Trans>（还没写：回创作面板写一句"这一段拍什么"）</Trans>}
        </span>
        {node && (
          <span className="flex-none text-[9px] text-slate-400" title={t`这一段的出片档位（来自你的模型等级）`}>
            {tierLabel}
          </span>
        )}
      </div>

      {/* 钱：照实说。三种状态 —— 有券 / 券用完了 / 这台服务器没有（或还没读到） */}
      <div className="mt-1 rounded bg-ink/40 px-1.5 py-1 text-[9px] leading-snug text-slate-300">
        {ticket.mode === "ticket" ? (
          <Trans>
            这一发用游戏券（剩余 {ticket.tickets?.left ?? 0}）：出片扣 {perGen} 张券、不扣 token；画首帧照旧按 token 结算（约{" "}
            {fmtTokens(quote.frame)}）。远端模式下以服务器结算为准。
          </Trans>
        ) : ticket.mode === "empty" ? (
          <Trans>
            这一发按 token 结算：本月的游戏券用完了（{resetDay} 号刷新，做任务也能领券）；画首帧约 {fmtTokens(quote.frame)}、出片约{" "}
            {fmtTokens(quote.video)}。远端模式下以服务器结算为准。
          </Trans>
        ) : ticket.mode === "unknown" ? (
          <Trans>
            这一发按 token 结算（游戏券的余额还没读到）：画首帧约 {fmtTokens(quote.frame)}、出片约 {fmtTokens(quote.video)}。远端模式下以服务器结算为准。
          </Trans>
        ) : (
          <Trans>
            这一发按 token 结算（这台服务器没有开通游戏券）：画首帧约 {fmtTokens(quote.frame)}、出片约 {fmtTokens(quote.video)}。远端模式下以服务器结算为准。
          </Trans>
        )}
      </div>

      {/* 首帧：画出来就摆在这儿让人看一眼，再决定要不要花视频的钱 */}
      {frame && (
        <div className="mt-1 flex items-start gap-2">
          <img
            src={frame}
            alt={t`这一段的首帧`}
            className="h-[clamp(3.6rem,7.6vw,5rem)] w-auto rounded ring-1 ring-white/20"
          />
          <span className="text-[9px] leading-snug text-slate-400">
            <Trans>这是会发出去的开头画面——不对就再点一次「换一张」，满意了再出片（视频那一笔比图贵得多）。</Trans>
          </span>
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-1.5">
        {!frame && (
          <GameBtn onClick={() => void drawFrame()} tone="primary" disabled={drawing || busy}>
            {drawing ? <Trans>正在画首帧…</Trans> : <Trans>① 先画首帧（约 {fmtTokens(quote.frame)}）</Trans>}
          </GameBtn>
        )}
        {frame && !done && (
          <>
            <GameBtn onClick={() => void drawFrame()} disabled={drawing || busy}>
              <Trans>换一张</Trans>
            </GameBtn>
            <GameBtn onClick={() => void generate()} tone="primary" disabled={drawing || busy}>
              {drawing || busy ? (
                <Trans>正在出片…</Trans>
              ) : ticket.canPay ? (
                <Trans>② 出片（用 {perGen} 张游戏券）</Trans>
              ) : (
                <Trans>② 出片（约 {fmtTokens(quote.video)}）</Trans>
              )}
            </GameBtn>
          </>
        )}
        {done && video && (
          <>
            <video src={video} controls playsInline className="h-[clamp(3.6rem,7.6vw,5rem)] rounded ring-1 ring-white/20" />
            <GameBtn onClick={submit} tone="gold" disabled={eliminated}>
              <Trans>用这一条交片</Trans>
            </GameBtn>
            <GameBtn onClick={() => void generate()} disabled={drawing || busy}>
              <Trans>重拍一次</Trans>
            </GameBtn>
          </>
        )}
        <span className="ml-auto text-[9px] text-slate-500">
          {busy ? <Trans>生成中…可以关掉这个窗，进度在流水线上</Trans> : <Trans>两步：先看首帧，再出片</Trans>}
        </span>
      </div>

      {/* 失败原因：flowStore 那一条原话（规则/供应商回什么就说什么，不在这里另编） */}
      {flowErr && (
        <div role="alert" className="mt-1 rounded bg-danger/15 px-1.5 py-1 text-[9px] leading-snug text-danger-100">
          {flowErr}
        </div>
      )}
    </div>
  );
}
