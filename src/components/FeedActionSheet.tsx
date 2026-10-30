// 首页长按菜单（2026-10-21，docs/ui-benchmark-2026-10.md 第二节）。
//
// ★ 为什么要有：抖音 / TikTok / YouTube Shorts 2022 年以来都把次要动作（倍速、清屏、保存、举报）收进「长按」，
//   右侧栏只留四五颗正向动作 —— 我们的右侧栏高度是量死的（512px + 底 104px，640 高的屏只剩 24px），
//   再往上加键只会把头像顶出屏幕，所以这几样只能来这里。
// ★ 只摆**真能用**的（CLAUDE.md「界面上摆一个永远点不动的选项」）：
//   · 「不感兴趣」**不摆** —— 服务端没有负反馈端点，点了什么都不会变；
//   · 「保存到本地」只在原生壳里摆（downloadSupport），而且是**去详情页**存：能不能存、存哪几集、叫什么名字只有
//     data/videoDownload.planDownload 一处判，详情页那颗键就是它的画法，这里不另写一份；
//   · 「举报」离线时整行不画（ReportButton 自己判 isRemoteMode），自己的作品也不画。
// ★ 倍速是**这次会话里的偏好**（FeedPage 持有，划到下一条照旧），不落盘：下次打开 App 回到 1×，
//   免得人忘了自己调过、以为视频「播快了」。
// ★ 必须截住 pointer 事件：Sheet portal 到了 body，可 React 合成事件仍沿**组件树**冒泡回 FeedItem 的
//   onPointerDown/Up（暂停 / 双击点赞），点一下倍速就会顺手把视频暂停了（CommentSheet 同一条）。
import { Trans, useLingui } from "@lingui/react/macro";
import Sheet from "./Sheet";
import Icon from "./Icon";
import ReportButton from "./ReportButton";
import BlockButton from "./BlockButton";
import { CloseButton } from "./IconTapButton";
import { downloadSupport } from "../data/videoDownload";
import type { VideoItem } from "../types";

/** 倍速档。0.75 给看不清对白的人，2 与长按两侧的临时快进同档 */
export const FEED_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
export type FeedSpeed = (typeof FEED_SPEEDS)[number];

export default function FeedActionSheet({
  video,
  mine,
  speed,
  onSpeed,
  immersive,
  landscape,
  onClearScreen,
  onClose,
  host,
  onSaveLocal,
  block,
  onNotInterested,
}: {
  video: VideoItem;
  /** 自己的作品：不摆举报 */
  mine: boolean;
  speed: FeedSpeed;
  onSpeed: (s: FeedSpeed) => void;
  /** 已经在清屏 / 全屏里：那一行不摆（再点一次什么都不会变，就是一个点不动的选项） */
  immersive: boolean;
  /** 这一条是横屏片：同一个动作会把手机转过来（右侧栏那颗键在横屏片上写的也是「转屏」），话要照实说 */
  landscape: boolean;
  /** 进清屏（沉浸态，与右侧栏那颗全屏键同一个动作） */
  onClearScreen: () => void;
  onClose: () => void;
  /**
   * 谁打开的（2026-10-26 视频详情页 P0-4 起两种宿主共用这一份）：话按宿主说 ——
   * 首页那一行「清屏观看」是收起按钮和文字，详情页是全屏；首页的「保存到本地」是去详情页里选，详情页就是当场开面板。必填：漏传就说错话。
   */
  host: "feed" | "detail";
  /** 「保存到本地」那一行点下去做什么；null = 不摆（原生壳之外、或宿主不给）。首页传「去详情页」，详情页传「开下载面板 / 说为什么存不了」 */
  onSaveLocal: (() => void) | null;
  /** 拉黑作者那一行（详情页传，首页传 null —— 首页的拉黑在作者主页）。BlockButton 自己判摆不摆 */
  block: { userId: string; userName: string } | null;
  /**
   * 「不感兴趣」（2026-10-30；抖音 / TikTok 的长按菜单与分享面板都有）。null = 不摆：自己的作品、没登录、离线、
   * 服务端没有 videoHide 能力位（点了什么都不会变的选项不摆）—— 判在宿主（FeedPage）。
   */
  onNotInterested: (() => void) | null;
}) {
  const { t } = useLingui();
  const canSave = downloadSupport().ok && !!onSaveLocal;
  const stop = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onPointerUp: (e: React.PointerEvent) => e.stopPropagation(),
  };
  return (
    <div {...stop}>
      <Sheet onClose={onClose} label={t`更多操作`}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-100">
            <Trans>更多操作</Trans>
          </span>
          <CloseButton chip="sm" size={13} align="end" onClick={onClose} />
        </div>

        {/* 倍速：常规芯片那一档（CLAUDE.md「页签与筛选芯片两档」） */}
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
          <Icon name="gauge" size={14} className="text-slate-400" />
          <Trans>倍速</Trans>
        </div>
        <div className="mb-4 flex gap-1.5 no-scrollbar overflow-x-auto" role="group" aria-label={t`倍速`}>
          {FEED_SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => onSpeed(s)}
              aria-pressed={speed === s}
              className={`flex-none rounded-full px-3.5 py-1.5 text-xs tabular-nums ${
                speed === s ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="-mx-1 border-t border-slate-700/60 pt-1">
          {!immersive && (
            <button
              onClick={() => {
                onClose();
                onClearScreen();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-slate-200 active:bg-white/5"
            >
              <Icon name="expand" size={18} className="text-slate-400" />
              <span className="min-w-0 flex-1">
                {landscape ? <Trans>转屏观看</Trans> : host === "feed" ? <Trans>清屏观看</Trans> : <Trans>全屏观看</Trans>}
              </span>
              <span className="text-[11px] text-slate-400">
                {landscape ? <Trans>横过来占满屏幕</Trans> : host === "feed" ? <Trans>收起按钮和文字</Trans> : <Trans>铺满屏幕</Trans>}
              </span>
            </button>
          )}
          {canSave && (
            <button
              onClick={() => {
                onClose();
                onSaveLocal?.();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-slate-200 active:bg-white/5"
            >
              <Icon name="download" size={18} className="text-slate-400" />
              <span className="min-w-0 flex-1">
                <Trans>保存到本地</Trans>
              </span>
              {host === "feed" && (
                <span className="flex items-center text-[11px] text-slate-400">
                  <Trans>在详情页里选</Trans>
                  <Icon name="chevron" size={12} />
                </span>
              )}
            </button>
          )}
          {onNotInterested && (
            <button
              onClick={() => {
                onClose();
                onNotInterested();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-slate-200 active:bg-white/5"
            >
              <Icon name="close" size={18} className="text-slate-400" />
              <span className="min-w-0 flex-1">
                <Trans>不感兴趣</Trans>
              </span>
              <span className="text-[11px] text-slate-400">
                <Trans>这条不再出现</Trans>
              </span>
            </button>
          )}
          <ReportButton row targetType="video" targetId={video.id} mine={mine} />
          {block && <BlockButton row userId={block.userId} userName={block.userName} mine={mine} />}
        </div>
      </Sheet>
    </div>
  );
}
