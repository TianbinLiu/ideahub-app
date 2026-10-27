// 做同款 —— 首页与作品详情页共用一份（2026-10-26 视频详情页 P0-1：原来两页各写一份，几乎一样又不完全一样）。
// 第八条「整表换掉 nodes」的入口：守卫走 useApplyTemplate（先问在途流水线、成了再断旧草稿，CLAUDE.md 那三件事），
// 铺法只有 flowStore.remakeNodesOf → seed（同款署名 remixOf 一起写），换了档（原作用的是会员档 / 已停用的档）当面说一句。
// ★ 两页原来的差别都留着：付费没解锁的不给做（配方是付费内容的一部分，首页那条 !locked）；被就地拒的那句话几秒后自清
//   （首页没有常驻错误位；详情页原来一直挂着，跟首页一个口径）。
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useApplyTemplate } from "../components/flow/useApplyTemplate";
import { showToast } from "../data/toast";
import { remakeNodesOf, remakeableOf, useFlow } from "../studio/flowStore";
import type { VideoItem, VideoSegment } from "../types";

/** 被拒那句话挂多久（首页原来的数） */
const ERR_MS = 5000;

export function useRemake(
  /** null = 作品还没到（详情页的 hook 排在「不存在」那一屏的早退之前） */
  video: Pick<VideoItem, "id" | "title" | "author" | "deck"> | null,
  /** 照哪几段做（详情页的多 P 老作品传当前那一 P 的段；其余传 video.segments） */
  segments: VideoSegment[],
  /** 付费没解锁：不给做（必填 —— 漏传零症状，锁着的作品就能把配方铺出来） */
  locked: boolean,
): { canRemake: boolean; remake: () => void; err: string; dialog: ReactNode } {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { guard, dialog } = useApplyTemplate();
  const [err, setErr] = useState("");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const canRemake = !!video && !locked && remakeableOf(segments);

  function remake() {
    if (!canRemake || !video) return;
    guard(
      () => {
        const built = remakeNodesOf(segments, video.deck?.cards ?? []);
        const ok = useFlow.getState().seed(built.nodes, {
          mode: "workflow",
          origin: "solo",
          // 同款署名（2026-10-02）：发布时随稿子上行，原作页据它记一次「N 人做了同款」
          remixOf: { videoId: video.id, title: video.title, author: video.author },
        });
        // 换了档（原作用的是会员档 / 已停用的档）要说出来（remakeNodesOf 的 ★）
        if (ok && built.notes.length) showToast(built.notes.join(t({ message: "；", comment: "几条「第 N 段换了档」的说明连成一行时的分隔符" })), 6000);
        if (ok) navigate("/flow");
        else {
          setErr(useFlow.getState().err || t`现在铺不了（可能有一段正在生成中），稍后再试`);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setErr(""), ERR_MS);
        }
        return ok;
      },
      {
        label: t`做同款（丢弃上面那条流水线）`,
        noun: t({ message: "做同款", context: "丢弃确认卡里「…再回来X」的那个动作（英文用小写动词短语）" }),
      },
    );
  }

  return { canRemake, remake, err, dialog };
}
