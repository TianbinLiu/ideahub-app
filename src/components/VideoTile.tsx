// 双列作品卡（2026-10-21 按 B 站 / 小红书的卡片结构重排，调研在 docs/ui-benchmark-2026-10.md 第三节）—— 分区页的网格与作品页的「更多推荐」共用这一份
// （2026-10-26 视频详情页 P0-1 从 DiscoverPage 原样搬出来：两处各写一份，哪天加一枚角标就只加到一边）。
// 封面底部一条渐变，左下「▶ 播放量」、右下时长；「AI 生成」在右上角（合规标识必须在，判据只有 isAigcWork）；封面下面两行标题 + 一行「头像 · 作者 · ♥ 点赞」。
import { Trans } from "@lingui/react/macro";
import { Link } from "react-router";
import AigcBadge, { isAigcWork } from "./AigcBadge";
import Avatar from "./Avatar";
import Icon from "./Icon";
import SeedBadge from "./SeedBadge";
import { authorAvatarOf, authorDisplayName, isSeedWork } from "../data/videos";
import { formatDuration, formatPlays, segsTotal, type VideoItem } from "../types";

export default function VideoTile({ video: v }: { video: VideoItem }) {
  return (
    <Link to={`/video/${v.id}`} className="group">
      <div className="relative overflow-hidden rounded-xl">
        <img src={v.cover} alt={v.title} loading="lazy" decoding="async" className="aspect-[3/4] w-full object-cover" />
        {/* 底部渐变托住两行小字：封面多半是亮的 AI 图，白字直接压上去读不清 */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/70 to-transparent" />
        <span className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 text-[10px] font-medium text-white [text-shadow:0_0_3px_rgba(0,0,0,.6)]">
          <Icon name="play" size={10} filled />
          {formatPlays(v.plays)}
        </span>
        <span className="absolute bottom-1.5 right-1.5 text-[10px] tabular-nums text-white/90 [text-shadow:0_0_3px_rgba(0,0,0,.6)]">
          {formatDuration(segsTotal(v.segments))}
        </span>
        {/* 「AI 生成」标识：这一格是"发布内容周边"的第四个面，而封面默认就是
            segments[0].firstFrame —— 一张**没过 drawAigcBadge** 的 AI 图，
            所以这里不是可有可无（见 components/AigcBadge 的 ★★）。2026-10-21 起放右上（左下给了播放量）。 */}
        {isAigcWork(v) && (
          <span className="absolute right-1.5 top-1.5">
            <AigcBadge tone="overlay" />
          </span>
        )}
        {/* 左上角这一排：「示例 · 离线」「互动」并排，**flex-wrap** 兜住 —— 英文下这几枚比中文宽不少。右边留出 AI 标识的位置（right-14）。
            ★ 想过在这里加「N 人做了同款」（B 站式推荐理由），但列表端点不带 remixCount（契约：只有详情端点算，videos.recipeBits 头上），
            这里的作品全是列表那一跳来的 —— 摆上去永远不会出现。要做得先让服务端在列表里聚合（docs/ui-benchmark-2026-10.md 第三节「没做的」） */}
        <span className="absolute left-1.5 right-14 top-1.5 flex flex-wrap items-start gap-1">
          {isSeedWork(v) && <SeedBadge tone="overlay" />}
          {v.branchTree && (
            <span className="rounded bg-brand/85 px-1.5 py-0.5 text-[9px] font-semibold text-ink">
              <Trans>互动</Trans>
            </span>
          )}
        </span>
      </div>
      <div className="mt-1.5 line-clamp-2 text-xs font-medium text-slate-200">{v.title}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
        <Avatar name={v.author} label={authorDisplayName(v.author, v.authorId)} src={authorAvatarOf(v)} size={16} />
        <span className="min-w-0 flex-1 truncate">{authorDisplayName(v.author, v.authorId)}</span>
        <span className="flex flex-none items-center gap-0.5">
          <Icon name="heart" size={10} />
          {formatPlays(v.likes)}
        </span>
      </div>
    </Link>
  );
}
