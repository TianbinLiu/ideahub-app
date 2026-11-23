// 工作流面板（G4 施工单 §2 第三条）：**纯预览** —— 只展示玩家当前每段视频的信息，
// 「修改 / 重新生成片段」那些操作一件都不摆。
//
// ★ 这就是原来桌面节点卡的列表视图：节点卡从桌面上撤掉（G4 第 1 步）之后，"这一局拍过哪几段"
//   要有地方看。它是同一条流水线的**只读一面**：数据来自 flowStore.nodes（按 gameRound 过滤出
//   这一局出的段），不另存一份。
// ★ 为什么去掉"改"：对局里的段是**花了钱的一次性产物**，一局之内重拍要再付一次出片钱，
//   而这一版（G4）还没接券、也没定"重拍谁付钱"—— 与其摆一颗会花掉玩家 token 的键，
//   不如把"看"做好：段号 / 状态 / 首帧 / 成片 / 那句提示词 / 用的卡 / 档位。
//   ⚠ 想改的出口仍然存在：出片小窗里的「重拍一次」（那是**这一回合**的生成入口，钱说得清）。
// ★ 不在对局里时这一颗键仍然是画布（StudioPage 的判据）：画布是新建流水线唯一的门，
//   把它改成只读就等于工坊再也做不出自己的片。
import { Trans, useLingui } from "@lingui/react/macro";
import { tierOf } from "../../../data/economy";
import { chosenOf, nodeDone, realVideoOfNode, useFlow } from "../../flowStore";
import { useGame } from "../store";
import { gameNodesOf } from "../gen";

export default function GenPreview() {
  const { t } = useLingui();
  const nodes = useFlow((s) => s.nodes);
  const list = gameNodesOf(nodes);

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col bg-ink/95 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-white/10 px-2 py-1.5">
        <span className="text-[11px] font-semibold text-slate-100">
          <Trans>工作流 · 本局每段</Trans>
        </span>
        <span className="text-[9px] text-slate-400">
          <Trans>纯预览：这里只让你看，改 / 重新生成在出片小窗里做</Trans>
        </span>
        <button
          type="button"
          onClick={() => useGame.getState().setPreviewOpen(false)}
          aria-label={t`关掉工作流面板`}
          className="ml-auto rounded px-2 py-0.5 text-[11px] text-slate-200 active:bg-white/10"
        >
          <Trans>✕ 关掉</Trans>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {list.length === 0 && (
          <div className="rounded-lg bg-panel/70 px-3 py-4 text-center text-[11px] leading-relaxed text-slate-400">
            <Trans>这一局还没有出过片——摆好卡，点「🎬 视频生成」先画首帧，再出片。</Trans>
          </div>
        )}
        <ol className="flex flex-col gap-1.5">
          {list.map((node) => {
            const prop = chosenOf(node);
            const video = realVideoOfNode(node);
            const done = nodeDone(node);
            // ★ 带占位符的文案只能传**局部变量**：`{node.gameRound}` 这种成员表达式 Lingui 编译不了，
            //   整条译文会退回中文原文（英文界面上蹦中文，构建里只有一行 warning —— 已踩过）。
            const roundNo = node.gameRound ?? 0;
            const status = node.status === "generating"
              ? t`正在出片…`
              : done && video
                ? t`已出片`
                : done
                  ? t`出片了（地址是 mock）`
                  : node.status === "failed"
                    ? t`出片失败`
                    : node.status === "pending"
                      ? t`没接到结果`
                      : t`还没出片`;
            return (
              <li key={node.id} className="rounded-lg bg-panel/85 p-1.5 ring-1 ring-white/10">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="font-semibold text-gold-200">
                    <Trans>第 {roundNo} 回合</Trans>
                  </span>
                  <span className="text-slate-300">{status}</span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-400" title={t`这一段的出片档位`}>
                    {tierOf(node.videoTier).label}
                  </span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-400">
                    <Trans>{Math.round(prop.durationSec)} 秒</Trans>
                  </span>
                </div>
                <div className="mt-1 flex items-start gap-2">
                  {/* 首帧 / 成片：有就摆出来，没有就说清楚"还没画"（别用色块冒充画面） */}
                  {video ? (
                    <video src={video} controls playsInline className="h-[clamp(3.6rem,7.6vw,5rem)] rounded ring-1 ring-white/20" />
                  ) : prop.firstFrame ? (
                    <img
                      src={prop.firstFrame}
                      alt={t`第 ${roundNo} 回合的首帧`}
                      className="h-[clamp(3.6rem,7.6vw,5rem)] w-auto rounded ring-1 ring-white/20"
                    />
                  ) : (
                    <div className="flex h-[clamp(3.6rem,7.6vw,5rem)] w-[clamp(2.6rem,5.4vw,3.6rem)] items-center justify-center rounded border border-dashed border-white/15 text-[8px] text-slate-500">
                      <Trans>还没有画面</Trans>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    {/* 那句提示词：这一段到底拍的是什么（requirement 是玩家自己的话） */}
                    <p className="text-[10px] leading-snug text-slate-200">{node.requirement || prop.plot || <Trans>（没写提示词）</Trans>}</p>
                    {/* 用的卡：这一段点名了谁（卡名进提示词靠的是同一份素材卡）。
                        ★ 这里读的是**流水线上的素材卡**（types.Card），不是对局的卡（没有 quality）——
                          所以只报卡名，别套 gameCardName（那是按对局的卡画的）。 */}
                    <p className="mt-0.5 truncate text-[9px] leading-snug text-slate-500">
                      {(node.materials ?? []).map((card) => card.name).join(" · ") || <Trans>（没有卡：空镜）</Trans>}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
