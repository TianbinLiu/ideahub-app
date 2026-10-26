// 「这一段怎么拍」的选法屏 —— 工坊铸段窗第①步与画布「＋ 加一段」**共用的唯一实现**（2026-10-04「跟着做」模式第一期，
// 方案 docs/guided-modes-design.md）。
//
// ★ 先选出片模型，再挑模式（主人 10-04：「六个模式也需要根据用户选择的模型来选择性显示」）。模式能不能用只问
//   data/guidedModes.modeBlock（按档位能力判），这里只画它的答案：用不了的不摆，底下用一句话说清「换到哪一档就有」——
//   不说的话，人在 1.0 档上找不到「参考图直出」，只会以为它被删了。
// ★ 只收 props、不认任何 store（与 PlanBoard / CustomFrameSlots 同一条约束）：选了哪一档、挑了哪个模式由宿主落地。
// ★ 价钱只摆「这一步大概花多少」（参考图直出 = 只有视频；推演三套 = 推演那一笔），算法都是 economy 里报价用的那几个函数。
import type { MessageDescriptor } from "@lingui/core";
import Icon, { type IconName } from "../Icon";
import Warn from "../Warn";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { memberTiersLine, tierBlockReason, tierNamesFor, tierOffered } from "../../data/account";
import { CHAT_TURN_TOKENS, CHECKED_PANEL_TOKENS, clampDuration, fmtTokens, IMAGE_TOKENS, segTokens, tierModelId, tierModelLabel, tierOf, VIDEO_TIERS } from "../../data/economy";
import { useAccountVersion } from "../../hooks/useAccount";
import UpgradeLink from "../UpgradeLink";
import { GUIDED_GROUPS, GUIDED_MODES, modeBlock, type GuidedGroup, type GuidedModeId, type ModeTier } from "../../data/guidedModes";
import { GRID_DEFAULT_SEC } from "../../data/gridShots";
import { LEAD_DEFAULT_SEC } from "../../data/sceneShots";

const GROUP_LABEL: Record<GuidedGroup, MessageDescriptor> = {
  basic: msg`基础`,
  pro: msg`跟着高手做`,
  replica: msg`复刻 · 同款`,
};

const MODE_TEXT: Record<GuidedModeId, { icon: IconName; title: MessageDescriptor; tag: MessageDescriptor; desc: MessageDescriptor }> = {
  // ★ 说明只讲「你要做什么、会得到什么」（2026-10-14 按 CSCI 187 UX 课的「信息要简洁、无行话」收口）：
  //   原来几条末尾挂着「LibTV / updream 作者的做法」—— 对标记录归 docs，用户不认识那两个站，摆在选项上只是噪音。
  direct: {
    icon: "image",
    title: msg`参考图直出`,
    tag: msg`不画帧`,
    desc: msg`挑几张参考图（人物 / 场景卡）＋ 写提示词，人物图直接给视频模型`,
  },
  custom: { icon: "pen", title: msg`自定义`, tag: msg`全按你的来`, desc: msg`传一段示例视频，或自己给首尾帧` },
  lead: {
    icon: "drama",
    title: msg`主角定妆 · 多镜头`,
    tag: msg`先定人、再拆镜头`,
    desc: msg`选好（或现做）主角，写一场戏，AI 拆成 2~4 个镜头带台词，一条出`,
  },
  grid: {
    icon: "grid",
    title: msg`九宫格分镜`,
    tag: msg`先出一组画面`,
    desc: msg`写一场戏，AI 写成 4~9 格分镜、一次画出整组画面；挑几格，每格变成一段`,
  },
  dialogue: {
    icon: "comment",
    title: msg`对话正反打`,
    tag: msg`你一句我一句`,
    desc: msg`两个人＋一个场景，写几句对白，AI 画出双人镜头和两个过肩镜头，一句一段、按卡上的声音说出来。影视对话戏的标准拍法`,
  },
  cards: { icon: "cards", title: msg`AI 推演三套`, tag: msg`先看关键画面`, desc: msg`挑卡＋写要求，AI 出三套带关键画面的方案，挑一套再出片` },
  effect: {
    icon: "sparkle",
    title: msg`特效同款`,
    tag: msg`换上你的主角就出`,
    desc: msg`挑一个特效（时间冻结、环绕亮相、走出壁画、产品亮相……），换上你的人物或产品，一段 5~6 秒的大片`,
  },
  // 「白模 / 人偶挂卡」是模板那一屏才教的词，这里先用人话说清结果：换的是人，场景与运镜照模板
  template: { icon: "file", title: msg`套模板`, tag: msg`换人不换景`, desc: msg`挑一条模板片，把画面里的人换成你的角色，场景与运镜照它走（模板按这个模型筛）` },
};

/** economy.VideoTier → 判定要的那几位能力（判据只在 guidedModes.modeBlock） */
export function modeTierOf(tierId: string): ModeTier {
  const tier = tierOf(tierId);
  return { refImg: tier.refImg, startOnly: tier.startOnly, audio: tier.audio };
}

export default function ModePicker({
  tierId,
  onTier,
  onPick,
  derivePrice,
}: {
  /** 现在选着的出片档位（economy.VideoTier.id） */
  tierId: string;
  /** 换档（宿主落地；套餐点不动的档这里已经灰掉了） */
  onTier: (id: string) => void;
  /** 挑定一个模式 */
  onPick: (id: GuidedModeId) => void;
  /**
   * 「AI 推演三套」那行估价，由宿主按**将要落的那一段**算一次传进来（必填：漏传是零症状的，所以不给缺省）。
   * ★ 2026-10-15 教材人格评审（norman-interaction-4）：原来这里自己按 proposalsCost(false) 报不承接的上限 —— 从第 2 段起真正的价
   *   （承接上段尾帧、三套共用开头帧、只画尾帧）是它的一半，同一笔钱选法屏印一个数、下一屏方案台印另一个数；而且同屏其它模式都带「约」，
   *   唯独这条没有。宿主怎么算：画布按 proposalsCost(!!chosenOf(last)?.lastFrame)（新段 chain 恒为 !!prev，与 flowStore.deriveCostOf 同一条件），
   *   工坊按 studioStore.nextStartFrame（真扣那一处读的就是它）。carried 为真时这里顺带说一句「承接、只画尾帧」。
   */
  derivePrice: { tokens: number; carried: boolean };
}) {
  const { t } = useLingui();
  // 套餐 / 付没付过钱 / 服务端能力位都是异步到的：订阅账号的版本号，到了就重画
  useAccountVersion();
  const tier = tierOf(tierId);
  const caps = modeTierOf(tierId);
  /** 套餐点不动的那几档并成一句（account.memberTiersLine，与 TierRow 同一句）+「去升级」 */
  const memberLine = memberTiersLine();
  /**
   * 宿主递进来的这一档本身就用不了（会员档 / 已停用 / 服务端不支持）—— 宿主的默认档本来都按 usableTierId 给，这里是最后一道：
   * 把原因说在最上面，并把下面的模式全灰掉 —— 不然挑了模式就进向导，写分镜 / 画画面的钱先花出去，出片那一步才被拦下。
   */
  const tierIssue = tierBlockReason(tier);
  /** 摆哪几档：停用的、服务端不支持的不摆（account.tierOffered）；正选着的那一档例外（藏起来就不知道自己在哪一档） */
  const shown = VIDEO_TIERS.filter((x) => tierOffered(x) || x.id === tier.id);
  const hidden = GUIDED_MODES.filter((m) => modeBlock(m.id, caps) !== null);
  /** 「换到哪一档就有」：按这个人用得了的说（account.tierNamesFor）；一档都用不了时说那几档是会员档 */
  const refNames = tierNamesFor((x) => x.refImg);
  // 「要能出声的模型」指去带得了声音样本的那几档（VideoTier.refAudio）：对话正反打按卡上的声音说台词
  const audioNames = tierNamesFor((x) => x.refAudio);
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 text-xs font-semibold text-slate-300"><Trans>① 先选出片模型</Trans></div>
        {/* ★ 换行排，不横向滚（2026-10-26，与 TierRow 同一种排法）：原来是一行 no-scrollbar overflow-x-auto，六档摆不下时后面几颗
            被挤出屏幕、滚动条又藏着 —— 排在最后的正是「真人」，人看不见、也不知道还能往右划。
            量法（2026-10-26，开发服务器的真样式里摆同样六颗芯片量 getBoundingClientRect）：360 宽的手机上，画布「＋ 加一段」的抽屉
            （Sheet p-4）内容宽 328px、工坊铸段窗（inset-x-2 + 边框 + p-3）318px；六颗常规档芯片（px-3.5 text-xs、gap-1.5）中文一行要 354px
            （第一屏只露出前五颗，「真人」整颗在外面）、英文 446px（只露出前四颗，「Cinematic」「Real-person」都在外面）。
            换行之后两处都是两行、六颗全在屏上（高 62px，原来 28px）；11-24 极速 / 标准停用之后剩四颗（中文 238px、英文 303px），自动回到一行。 */}
        <div className="flex flex-wrap gap-1.5">
          {/* ★ 回调参数叫 x 不叫 t：t 是 useLingui 给的翻译函数，同名会把它遮住 */}
          {shown.map((x) => {
            const blocked = !!tierBlockReason(x);
            return (
              <button
                key={x.id}
                onClick={() => onTier(x.id)}
                disabled={blocked}
                title={tierModelId(x)}
                // 常规档的芯片（px-3.5 py-1.5 text-xs）：这排是这一屏的第一个决定，紧凑档 22px 高手指点不准（2026-10-14 UX 课收口）
                className={`rounded-full px-3.5 py-1.5 text-xs transition active:opacity-60 disabled:opacity-40 ${
                  x.id === tier.id ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"
                }`}
              >
                {x.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[10px] text-slate-500">
          <Trans>这一段交给 {tierModelLabel(tier)} 生成</Trans>
        </p>
        {tierIssue && <Warn compact className="mt-0.5">{tierIssue}</Warn>}
        {memberLine && (
          <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
            {memberLine}
            {"　"}
            <UpgradeLink />
          </p>
        )}
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
                // 九宫格分镜 = 写分镜那一次对话 + 每格一张画面与画完 AI 看一遍（按实际画出的张数收）+ 每格一段的视频（逐段出、逐段报）
                // ★ 九宫格每格、对话正反打每个机位的价只读 economy.CHECKED_PANEL_TOKENS（一张图 + 画完 AI 看一遍；向导的组图报价、单格重画、
                //   画机位那颗键也读它）。特效同款的关键帧不看一遍，仍是只有图的价
                const chatPrice = fmtTokens(CHAT_TURN_TOKENS);
                const panelPrice = fmtTokens(IMAGE_TOKENS);
                const gridPanelPrice = fmtTokens(CHECKED_PANEL_TOKENS);
                const gridSec = clampDuration(GRID_DEFAULT_SEC, tier.id);
                const gridVideo = fmtTokens(segTokens(gridSec, tier.id));
                const leadSec = clampDuration(LEAD_DEFAULT_SEC, tier.id);
                const leadVideo = fmtTokens(segTokens(leadSec, tier.id));
                // 特效同款 = 一张关键帧 + 一段视频（真人档没有关键帧、按发计价）；对话正反打 = 写对白一次对话 + 三张画面 + 三段
                const fxSec = clampDuration(5, tier.id);
                const fxVideo = fmtTokens(segTokens(fxSec, tier.id));
                const price =
                  m.id === "direct"
                    ? t`约 ${fmtTokens(segTokens(5, tier.id))} / 5 秒，只有视频`
                    : m.id === "lead"
                      ? t`拆镜头 ${chatPrice}，视频约 ${leadVideo} / ${leadSec} 秒`
                      : m.id === "grid"
                      ? t`写分镜 ${chatPrice}，画面每格 ${gridPanelPrice}（含 AI 看一遍），每格一段约 ${gridVideo} / ${gridSec} 秒`
                      : m.id === "dialogue"
                      ? t`写对白 ${chatPrice}，三个机位每张 ${gridPanelPrice}（含 AI 看一遍），每句一段约 ${gridVideo} / ${gridSec} 秒`
                      : m.id === "effect"
                      ? caps.startOnly
                        ? t`照片起拍，视频约 ${fxVideo} / 一发`
                        : t`关键帧 ${panelPrice}，视频约 ${fxVideo} / ${fxSec} 秒`
                      : m.id === "cards"
                      ? derivePrice.carried
                        ? t`推演约 ${fmtTokens(derivePrice.tokens)}（承接上段尾帧，三套共用开头帧、只画尾帧），出片另算`
                        : t`推演约 ${fmtTokens(derivePrice.tokens)}，出片另算`
                      : null;
                return (
                  <button
                    key={m.id}
                    onClick={() => onPick(m.id)}
                    disabled={!!tierIssue}
                    className="flex w-full items-start gap-2.5 rounded-xl border border-slate-700/70 bg-panel p-3 text-left active:opacity-60 disabled:opacity-40"
                  >
                    <Icon name={text.icon} size={20} className="mt-0.5 flex-none text-slate-300" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-100">{t(text.title)}</span>
                        <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] text-brand">{t(text.tag)}</span>
                        <span className="rounded-full bg-slate-700/70 px-2 py-0.5 text-[10px] text-slate-300"><Trans>{steps} 步</Trans></span>
                      </span>
                      <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">
                        {m.id === "direct" && caps.startOnly ? t`真人卡的照片起拍，写一句话直接出片` : t(text.desc)}
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
              const why = modeBlock(m.id, caps);
              // 档名按能力现算、按这个人用不用得了分两种说法（2026-10-07：原来写死「高清或电影级」，免费用户被指去两个点不动的档）
              const names = why === "refImg" ? refNames : why === "audio" ? audioNames : null;
              if (names && !names.usable && names.member) {
                const member = names.member;
                return (
                  <p key={m.id}>
                    {why === "refImg"
                      ? t`「${title}」要收参考图的模型：「${member}」才有（会员档）`
                      : t`「${title}」要能出声的模型（台词得说出来）：「${member}」才有（会员档）`}
                    {"　"}
                    <UpgradeLink />
                  </p>
                );
              }
              const usable = names?.usable ?? "";
              return (
                <p key={m.id}>
                  {why === "refImg"
                    ? t`「${title}」要收参考图的模型：换到「${usable}」就有`
                    : why === "audio"
                      ? t`「${title}」要能出声的模型（台词得说出来）：换到「${usable}」就有`
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
