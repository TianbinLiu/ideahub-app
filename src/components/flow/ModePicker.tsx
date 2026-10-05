// 「这一段怎么拍」的选法屏 —— 工坊铸段窗第①步与画布「＋ 加一段」**共用的唯一实现**（2026-10-04「跟着做」模式第一期，
// 方案 docs/guided-modes-design.md）。
//
// ★ 先选出片模型，再挑模式（主人 10-04：「六个模式也需要根据用户选择的模型来选择性显示」）。模式能不能用只问
//   data/guidedModes.modeBlock（按档位能力判），这里只画它的答案：用不了的不摆，底下用一句话说清「换到哪一档就有」——
//   不说的话，人在 1.0 档上找不到「参考图直出」，只会以为它被删了。
// ★ 只收 props、不认任何 store（与 PlanBoard / CustomFrameSlots 同一条约束）：选了哪一档、挑了哪个模式由宿主落地。
// ★ 价钱只摆「这一步大概花多少」（参考图直出 = 只有视频；推演三套 = 推演那一笔），算法都是 economy 里报价用的那几个函数。
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { tierBlockReason } from "../../data/account";
import { CHAT_TURN_TOKENS, clampDuration, fmtTokens, modelLabel, proposalsCost, segTokens, tierOf, VIDEO_TIERS } from "../../data/economy";
import { GUIDED_GROUPS, GUIDED_MODES, modeBlock, type GuidedGroup, type GuidedModeId, type ModeTier } from "../../data/guidedModes";
import { LEAD_DEFAULT_SEC } from "../../data/sceneShots";

const GROUP_LABEL: Record<GuidedGroup, MessageDescriptor> = {
  basic: msg`基础`,
  pro: msg`跟着高手做`,
  replica: msg`复刻`,
};

const MODE_TEXT: Record<GuidedModeId, { icon: string; title: MessageDescriptor; tag: MessageDescriptor; desc: MessageDescriptor }> = {
  direct: {
    icon: "🖼",
    title: msg`参考图直出`,
    tag: msg`不画帧`,
    desc: msg`挑几张参考图（人物 / 场景卡）＋ 写提示词，人物图直接给视频模型。LibTV 作者最常用的做法`,
  },
  custom: { icon: "✍", title: msg`自定义`, tag: msg`全按你的来`, desc: msg`传一段示例视频，或自己给首尾帧` },
  lead: {
    icon: "🎭",
    title: msg`主角定妆 · 多镜头`,
    tag: msg`先定人、再拆镜头`,
    desc: msg`选好（或现做）主角，写一场戏，AI 拆成 2~4 个镜头带台词，一条出。updream 作者的做法`,
  },
  cards: { icon: "🃏", title: msg`AI 推演三套`, tag: msg`先看关键画面`, desc: msg`挑卡＋写要求，AI 出三套带关键画面的方案，挑一套再出片` },
  template: { icon: "🧪", title: msg`套模板`, tag: msg`白模复刻`, desc: msg`套一个模板，给人偶挂卡换人（模板按这个模型筛）` },
};

/** economy.VideoTier → 判定要的那几位能力（判据只在 guidedModes.modeBlock） */
export function modeTierOf(tierId: string): ModeTier {
  const tier = tierOf(tierId);
  return { refImg: !!tier.refImg, flat: !!tier.flatCost };
}

export default function ModePicker({
  tierId,
  onTier,
  onPick,
}: {
  /** 现在选着的出片档位（economy.VideoTier.id） */
  tierId: string;
  /** 换档（宿主落地；套餐点不动的档这里已经灰掉了） */
  onTier: (id: string) => void;
  /** 挑定一个模式 */
  onPick: (id: GuidedModeId) => void;
}) {
  const { t } = useLingui();
  const tier = tierOf(tierId);
  const caps = modeTierOf(tierId);
  /** 套餐点不动的档各是为什么（印在页面上：手机没有 hover，与 TierRow 同一条理由） */
  const blocks = VIDEO_TIERS.map((x) => tierBlockReason(x)).filter((r): r is string => !!r);
  const hidden = GUIDED_MODES.filter((m) => modeBlock(m.id, caps) !== null);
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 text-xs font-semibold text-slate-300"><Trans>① 先选出片模型</Trans></div>
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {/* ★ 回调参数叫 x 不叫 t：t 是 useLingui 给的翻译函数，同名会把它遮住 */}
          {VIDEO_TIERS.map((x) => {
            const blocked = !!tierBlockReason(x);
            return (
              <button
                key={x.id}
                onClick={() => onTier(x.id)}
                disabled={blocked}
                title={x.model}
                className={`flex-none rounded-full px-3 py-1 text-[11px] disabled:opacity-40 ${
                  x.id === tier.id ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"
                }`}
              >
                {x.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[10px] text-slate-500">
          <Trans>这一段交给 {modelLabel(tier.model)} 生成</Trans>
        </p>
        {blocks.length > 0 && <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{blocks[0]}</p>}
      </div>

      <div className="space-y-2.5">
        <div className="text-xs font-semibold text-slate-300"><Trans>② 挑一种做法（每一种都是固定几步，跟着点就行）</Trans></div>
        {GUIDED_GROUPS.map((g) => {
          const modes = GUIDED_MODES.filter((m) => m.group === g && modeBlock(m.id, caps) === null);
          if (!modes.length) return null;
          return (
            <div key={g} className="space-y-1.5">
              <div className="text-[10px] font-semibold tracking-wide text-slate-500">{t(GROUP_LABEL[g])}</div>
              {modes.map((m) => {
                const text = MODE_TEXT[m.id];
                const steps = m.steps;
                // 只摆「这一步大概花多少」：参考图直出 = 只有视频（真人档按发计价）；推演三套 = 推演那一笔（出片另算）
                // 主角定妆 · 多镜头 = 拆镜头那一次对话 + 默认 12 秒的视频（现做主角要另花图钱，在向导里那颗键上报）
                const chatPrice = fmtTokens(CHAT_TURN_TOKENS);
                const leadSec = clampDuration(LEAD_DEFAULT_SEC, tier.id);
                const leadVideo = fmtTokens(segTokens(leadSec, tier.id));
                const price =
                  m.id === "direct"
                    ? t`约 ${fmtTokens(segTokens(5, tier.id))} / 5 秒，只有视频`
                    : m.id === "lead"
                      ? t`拆镜头 ${chatPrice}，视频约 ${leadVideo} / ${leadSec} 秒`
                      : m.id === "cards"
                      ? t`推演 ${fmtTokens(proposalsCost(false))}，出片另算`
                      : null;
                return (
                  <button
                    key={m.id}
                    onClick={() => onPick(m.id)}
                    className="flex w-full items-start gap-2.5 rounded-xl border border-slate-700/70 bg-panel p-3 text-left active:opacity-60"
                  >
                    <span className="flex-none text-lg leading-none">{text.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-100">{t(text.title)}</span>
                        <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] text-brand">{t(text.tag)}</span>
                        <span className="rounded-full bg-slate-700/70 px-2 py-0.5 text-[10px] text-slate-300"><Trans>{steps} 步</Trans></span>
                      </span>
                      <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">
                        {m.id === "direct" && caps.flat ? t`真人卡的照片起拍，写一句话直接出片` : t(text.desc)}
                      </span>
                      {price && <span className="mt-0.5 block text-[10px] text-slate-500">{price}</span>}
                    </span>
                    <span className="flex-none self-center text-slate-500">›</span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {/* 这一档上没有的模式：说清换到哪儿就有（判据 guidedModes.modeBlock 的两种原因） */}
        {hidden.length > 0 && (
          <div className="space-y-0.5 text-[10px] leading-relaxed text-slate-500">
            {hidden.map((m) => {
              const title = t(MODE_TEXT[m.id].title);
              return (
                <p key={m.id}>
                  {modeBlock(m.id, caps) === "refImg"
                    ? t`「${title}」要收参考图的模型：换到高清或电影级就有`
                    : t`「${title}」在真人档上没有：这一档本来就是写一句话直接出片`}
                </p>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
