// 作品详情页「做你自己的版本」卡（2026-10-26 视频详情页 P0-5）：这条片怎么做的（几段 / 多长 / 画幅 / 有没有声 / 哪一档）、
// 按谁的流程做的、随片卡组、查看制作过程 —— 原来散在页面里的一颗金色整宽键、一颗描边整宽键、一块「本片卡组」都收到这一张卡里。
// ★ 卡里一颗实心键都没有：全页唯一的实心主键是吸底栏那颗「做同款」（VideoDock）。卡组的两颗键降成文字键。
// ★ 参数行全部从这一 P 的段现算、不发请求；模型名只在地区问到了时写（account.tierShownModel，与档位那一排同一个出口），问不到只写档位名。
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Link } from "react-router";
import Warn from "../Warn";
import TarotCard from "../TarotCard";
import Icon from "../Icon";
import { addCards, myCards, tierShownModel, type AuthState } from "../../data/account";
import { tierOf } from "../../data/economy";
import { authorDisplayName } from "../../data/videos";
import { useStudio } from "../../studio/studioStore";
import { CARD_TYPE_LABELS, VIDEO_ASPECTS, formatDuration, segsTotal, type VideoItem, type VideoSegment } from "../../types";

export default function RemakeCard({
  video,
  segments,
  locked,
  auth,
  remakeErr,
  onGoStudio,
}: {
  video: VideoItem;
  /** 这一 P 的段（参数行照它算） */
  segments: VideoSegment[];
  /** 付费没解锁：制作过程不给看（配方是付费内容的一部分） */
  locked: boolean;
  /** 三态（收卡要登录）。★ 不收 `loggedIn: boolean` —— 水合期那一档会被写成"没登录" */
  auth: AuthState;
  /** 做同款被就地拒时那句话（useRemake 的 err） */
  remakeErr: string;
  /** 带着这套卡去工坊 */
  onGoStudio: () => void;
}) {
  const { t } = useLingui();
  const deck = video.deck && video.deck.cards.length > 0 ? video.deck : null;
  const recipe = !!video.recipePublic && !locked;

  // ── 参数行：几段 · 多长 · 画幅 · 有没有声 · 哪一档（模型名只在问得到地区时写） ──
  const sep = t({ message: " · ", comment: "参数行各项之间的分隔符" });
  const params: string[] = [];
  if (segments.length) params.push(t`${segments.length} 段`);
  if (segments.length) params.push(formatDuration(segsTotal(segments)));
  const aspect = segments[0]?.aspect;
  if (aspect) {
    const label = VIDEO_ASPECTS.find((a) => a.id === aspect)?.label;
    if (label) params.push(label);
  }
  // 声音：全部明说有 / 全部明说没有才写；有一段不知道（老作品没记这一位）就不写 —— 判否定，别编
  if (segments.length && segments.every((s) => s.hasAudio === true)) params.push(t`有声`);
  else if (segments.length && segments.every((s) => s.hasAudio === false)) params.push(t`无声`);
  const tierIds = [...new Set(segments.map((s) => s.videoTier).filter((x): x is string => !!x))];
  if (tierIds.length === 1) {
    const tier = tierOf(tierIds[0]);
    const model = tierShownModel(tier);
    const label = tier.label;
    params.push(model ? t`${label}（${model}）` : label);
  } else if (tierIds.length > 1) params.push(t`多个档位`);

  // ── 卡组：收入我的卡组（等结果，失败说「没同步」）—— 原来 VideoDeckSection 那一份，一行不改地搬过来 ──
  const loggedIn = auth === "in";
  const [got, setGot] = useState(() => {
    if (!deck) return false;
    const mine = new Set(myCards().map((c) => c.id));
    return deck.cards.every((c) => mine.has(c.id));
  });
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  /**
   * ★★ **要等结果**（2026-08-30 修）：`addCards` 的远端失败是它自己在返回值里说的（`synced:false`），扔掉返回值 =
   *   按钮当场变成「✓ 已在我的卡组」，而下次冷启动拿服务端那份整体覆盖 —— 卡一张不剩，全程零报错。
   * ★ 失败时把键**退回可点**并把原因写在旁边：卡在本机其实是有的，所以话要说准 —— 是"没同步到服务器"，不是"没收进来"。
   */
  async function collect(): Promise<boolean> {
    if (!deck || !loggedIn || adding) return false;
    setAdding(true);
    setAddErr(null);
    try {
      const r = await addCards(deck.cards);
      if (!r.synced) {
        const why = r.reason || t`这组卡没能同步到服务器`;
        setAddErr(t`${why}——卡在这台设备上有，但换台设备或重启后可能就没了，联网后再点一次。`);
        return false;
      }
      setGot(true);
      return true;
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="mx-4 mt-4 rounded-xl border border-slate-700/70 bg-panel p-3">
      <div className="flex items-baseline gap-2">
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-slate-300">
          <Trans>做你自己的版本</Trans>
        </h2>
        {/* 同款计数来自详情端点（不含作者自己）：判有值，老服务端 / 列表缓存没有这一位时一个字不出 */}
        {(video.remixCount ?? 0) > 0 && (
          <span className="flex-none text-[11px] text-slate-400">
            <Trans>{video.remixCount} 人做了同款</Trans>
          </span>
        )}
      </div>
      {params.length > 0 && <p className="mt-1 text-xs tabular-nums text-slate-400">{params.join(sep)}</p>}

      {/* 按谁的流程做的（只在原作对这个人可见时服务端才发）。有标题 / 没标题两句各写一份：书名号是中文标点，拼在占位符里英文读出来就是「process：《…》」 */}
      {video.remixOf && (
        <Link to={`/video/${video.remixOf.id}`} className="mt-1.5 block text-xs text-slate-400 underline underline-offset-2 active:opacity-60">
          {video.remixOf.title ? (
            <Trans>按 @{authorDisplayName(video.remixOf.author, video.remixOf.authorId)} 的流程做的同款：《{video.remixOf.title}》</Trans>
          ) : (
            <Trans>按 @{authorDisplayName(video.remixOf.author, video.remixOf.authorId)} 的流程做的同款</Trans>
          )}
        </Link>
      )}

      {/* 随片卡组：作者生成本片所用素材卡的快照。观众收入后用同一套素材进工坊，就能生成相似走向的视频 */}
      {deck && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-semibold text-slate-300">
            {deck.name ? <Trans>本片卡组 · {deck.name}</Trans> : <Trans>本片卡组 · {deck.cards.length} 张</Trans>}
          </div>
          <div className="flex gap-2 no-scrollbar overflow-x-auto pb-1">
            {deck.cards.map((c) => (
              // 点卡看详情：不在观众账号库里的卡经路由 state 带过去（详情页优先查账号库）
              <Link key={c.id} to={`/card/${c.id}`} state={{ card: c }} className="w-16 flex-none">
                <TarotCard cover={c.cover || null} title={c.name} sub={CARD_TYPE_LABELS[c.type]} type={c.type} />
              </Link>
            ))}
          </div>
          {/* ★ 真人卡的形象图被扣下时要说清楚为什么，不然用户只会觉得"这张卡坏了"（铁律八）。面向**观众**：说的是"你拿不到" */}
          {deck.cards.some((c) => c.portraitWithheld) && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              <Trans>这套卡里有声明过「真实人物」的卡，它的形象参考图只留给作者本人 —— 照片里的人授权的是作者用，不是所有人用。你仍然收得下这张卡的设定（名字、简介、身份句），但出片时得自己给形象。</Trans>
            </p>
          )}
          {addErr && (
            <Warn compact className="mt-1.5">
              {addErr}
            </Warn>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            <button
              onClick={() => void collect()}
              disabled={got || adding}
              title={loggedIn ? "" : auth === "pending" ? t`正在确认登录状态…` : t`登录后可收入卡组`}
              className="text-xs text-brand disabled:text-slate-400"
            >
              {got ? t`✓ 已在我的卡组` : adding ? t`收取中…` : addErr ? t`再试一次` : t`收入我的卡组`}
            </button>
            <button
              onClick={() => {
                // ★ 这条路**不等**收卡结果：用户要的是"去创作"，桌面那份是内存里的副本，同步与否不挡他开工；真没同步成功时上面那行提示会留在这一页
                void collect();
                // 并进工坊桌面（去重），进门就能直接拖卡铸节点
                useStudio.setState((s) => ({
                  deck: [...s.deck, ...deck.cards.filter((c) => !s.deck.some((d) => d.id === c.id))],
                }));
                onGoStudio();
              }}
              className="text-xs text-brand"
            >
              <Trans>带着这套卡去工坊</Trans>
            </button>
          </div>
        </div>
      )}

      {/* 查看制作过程（公开配方）：作者公开了才亮；付费未解锁的不给。制作过程页自带「按这个流程做同款」（比吸底栏那颗多了卡 / 空位 / 段模板） */}
      {recipe && (
        <Link to={`/video/${video.id}/recipe`} className="mt-3 flex items-center gap-1 text-sm text-brand active:opacity-60">
          <Icon name="branch" size={14} />
          <Trans>查看制作过程</Trans>
          <Icon name="chevron" size={14} />
        </Link>
      )}
      {remakeErr && (
        <Warn compact className="mt-2">
          {remakeErr}
        </Warn>
      )}
    </section>
  );
}
