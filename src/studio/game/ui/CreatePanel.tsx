// 创作面板（G3 起，G4 第 3 步重做）：桌面摆好的卡 + 一句提示词 → 出片 / 交片。
//
// ★ G4 第 3 步起**没有虚框了**：一期作品的素材 = 桌面上的卡（4 角色位 + 1 场景）+ 挂在角色身上的
//   道具（rules.castCardsOf）。所以这一屏不再"点背包里的卡放进三个框"，而是把桌面上**现在有什么**
//   如实列一遍 —— 要换卡，去拖动（背包条 → 卡位；右侧道具栏 → 角色卡）。
// ★ 提示词住 store.createPrompt（生成小窗读同一份，见 store 的 ★），上限问 rules.promptLimitOf
//   （基础 80 字，事件「灵感爆发」+50%）：界面不自己乘，也**真正判拒的是 rules.submitRoundEntry**。
// ★ 两个出口：
//   ① 「🎬 视频生成」= 真出片（花 token）：开 GenSheet，先画首帧、满意了再出片，出完点「用这一条交片」；
//   ② 「用占位片交片」= 不花钱的那一条：展映要全员有片才能开，玩家没钱 / 不想花时也得走得下去。
// ★ 交过片之后这一屏只说"交过了"并允许重交（改提示词 / 重摆卡）；显示的是**已经写进去的那一份**
//   还是**现在桌面这一份**必须在句子里分开 —— 混成一句就会"看着是 A、展映放的是 B"。
import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ROUND_PROMPT_MAX } from "../../../api/game/rounds";
import { VIDEO_SECONDS, promptLimitOf } from "../rules";
import { gameCardName } from "../labels";
import { useGame } from "../store";
import { useRounds } from "../roundsStore";
import { roundViewOf, type GameView } from "../view";
import { entryPayloadOf } from "./entryPayload";
import GenSheet from "./GenSheet";
import GameBtn from "./GameBtn";
import GameCardTile from "./GameCardTile";

export default function CreatePanel({ view }: { view: GameView }) {
  const { t } = useLingui();
  const meId = useGame((s) => s.meId);
  const state = useGame((s) => s.state);
  const prompt = useGame((s) => s.createPrompt);
  const online = useGame((s) => s.online);
  const snapshot = useRounds((s) => s.snapshot);
  const session = useRounds((s) => s.session);
  const memberHp = useRounds((s) => s.memberHp);
  const roundView = state ? roundViewOf(state, meId) : null;
  const [genOpen, setGenOpen] = useState(false);

  // ★ 联机版提示词上限取**服务端与规则里更严的那个**（服务端只挡 80，规则带事件加成能到 120）：
  //   照本机那个显示的话，玩家写着 100 字，交片那一发被 PROMPT_TOO_LONG 拒掉（一句看不见上限的红字）。
  const localLimit = promptLimitOf(view.player);
  const limit = online ? Math.min(localLimit, ROUND_PROMPT_MAX) : localLimit;
  const length = Array.from(prompt.trim()).length;
  const tableRoles = view.table.roles.filter((card): card is NonNullable<typeof card> => Boolean(card));
  const roleCount = tableRoles.length;
  const itemCount = tableRoles.reduce((sum, card) => sum + (view.equippedOnRole[card.id]?.length ?? 0), 0);
  const mySubmitted = Boolean(online && snapshot?.entries.some((entry) => entry.userId === online.myUserId));
  const submittedCount = snapshot?.entries.length ?? 0;
  // 同桌还活着几个人：hp 读 roundsStore 的**跨回合**记录（开局房间快照 + 每次结算覆盖，见 memberHp 的 ★）
  const aliveCount = session ? session.members.filter((member) => (memberHp[member.userId] ?? member.hp) > 0).length : 0;
  const eliminated = view.player.eliminated;

  /** 占位片：先写本机这一期（单机的展映 / 结算也要它），再交给服务端（联机） */
  const submitPlaceholder = () => {
    if (eliminated) return;
    useGame.getState().saveEntry();
    if (!online) return;
    void useRounds.getState().submit(entryPayloadOf(view, prompt)).then((ok) => {
      if (ok) useGame.getState().markOnlineSubmitted();
    });
  };

  return (
    <div className="pointer-events-auto w-full max-w-[46rem] rounded-xl bg-panel/90 p-1.5 ring-1 ring-white/10 backdrop-blur">
      {genOpen && <GenSheet view={view} onClose={() => setGenOpen(false)} />}

      {!genOpen && (
        <div className="flex items-start gap-2">
          {/* 桌面那一份：4 个角色位 + 1 个场景位（要换卡去拖，这一屏不点选） */}
          <div className="flex flex-none items-start gap-1">
            {view.table.roles.map((card, index) => (
              <div key={`role-${index}`} className="w-[clamp(2.2rem,4.6vw,3.2rem)]">
                {card ? (
                  <div title={t`角色位 ${index + 1}：${gameCardName(card)}`}>
                    <GameCardTile card={card} />
                    <div className="mt-0.5 text-center text-[8px] leading-tight text-cyan-200">
                      <Trans>道具 {view.equippedOnRole[card.id]?.length ?? 0}/{view.itemLimit}</Trans>
                    </div>
                  </div>
                ) : (
                  <div className="flex aspect-[2/3] w-full items-center justify-center rounded-lg border border-dashed border-white/20 text-[8px] text-slate-500">
                    <Trans>空位</Trans>
                  </div>
                )}
              </div>
            ))}
            <div className="w-[clamp(1.8rem,3.8vw,2.7rem)]">
              {view.table.scene ? (
                <div title={t`场景位：${gameCardName(view.table.scene)}`}>
                  <GameCardTile card={view.table.scene} />
                </div>
              ) : (
                <div className="flex aspect-[2/3] w-full items-center justify-center rounded-lg border border-dashed border-white/20 text-center text-[8px] leading-tight text-slate-500">
                  <Trans>场景位</Trans>
                </div>
              )}
            </div>
          </div>

          {/* 提示词 + 两个出口 */}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <input
              value={prompt}
              onChange={(event) => useGame.getState().setCreatePrompt(event.target.value)}
              maxLength={limit}
              placeholder={t`一句话：这一段拍什么？（例如：雨夜里一个女孩回头）`}
              aria-label={t`这一段的提示词`}
              className="w-full rounded-lg bg-ink/60 px-2 py-1 text-[11px] text-slate-100 ring-1 ring-white/10 placeholder:text-slate-500 focus:outline-none focus:ring-brand/50"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`text-[10px] ${length > limit ? "text-danger-200" : "text-slate-500"}`}>
                <Trans>
                  提示词 {length}/{limit} 字
                </Trans>
              </span>
              <span className="text-[10px] text-slate-500">
                <Trans>· {roleCount} 角色 / {view.table.scene ? 1 : 0} 场景 / {itemCount} 道具</Trans>
              </span>
              <GameBtn onClick={() => setGenOpen(true)} tone="primary" className="ml-auto" disabled={eliminated}>
                <Trans>🎬 视频生成</Trans>
              </GameBtn>
              <GameBtn onClick={submitPlaceholder} title={t`不花 token：用占位片交这一期`} disabled={eliminated}>
                <Trans>用占位片交片</Trans>
              </GameBtn>
            </div>
            <div className="text-[9px] leading-snug text-slate-500">
              {roundView?.mine ? (
                roundView.mine.entry.videoUrl ? (
                  <Trans>
                    这一期已经交过了（真出片的那一条，{Math.round(roundView.mine.entry.seconds)} 秒）——改了提示词 / 重摆卡之后可以再交一次。
                  </Trans>
                ) : (
                  <Trans>这一期已经交过一条占位片（{VIDEO_SECONDS} 秒）——想要真片子就点「🎬 视频生成」。</Trans>
                )
              ) : (
                <Trans>摆好卡、写好提示词：点「🎬 视频生成」真出片（先看首帧）；不想花 token 就交占位片。</Trans>
              )}
            </div>
            {online && (
              <div className="text-[9px] font-semibold leading-snug text-brand-200">
                {eliminated ? (
                  <Trans>你已经被淘汰——这一局只能看别人打，交片 / 点赞 / 投票都不再收你的。</Trans>
                ) : mySubmitted ? (
                  <Trans>
                    ✅ 已交片，等其他人（{submittedCount}/{aliveCount} 已交）——全员交片后房主才能开始展映。
                  </Trans>
                ) : (
                  <Trans>联机房间：交片会同步给所有人；提交之后这里会写「已交片，等其他人」。</Trans>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 道具挂在谁身上：这一行是"右侧道具栏拖到哪儿去了"的回执（没摆卡时说清楚先摆卡） */}
      {!genOpen && (
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[9px] leading-tight text-slate-400">
          {roleCount === 0 ? (
            <span>
              <Trans>桌面上还没有角色卡——从下面的背包条把角色卡拖进空位。</Trans>
            </span>
          ) : (
            tableRoles.map((card) => {
              const items = view.equippedOnRole[card.id] ?? [];
              return (
                <span key={card.id} className="rounded bg-white/[0.06] px-1 py-0.5">
                  {gameCardName(card)}
                  {items.length > 0 ? `：${items.map((item) => gameCardName(item)).join("、")}` : t`：（没挂道具）`}
                </span>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
