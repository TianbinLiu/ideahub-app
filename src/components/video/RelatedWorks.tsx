// 作品详情页的相关区（2026-10-26 视频详情页 P0-6）：「照这条做的同款」（2026-10-29，有人做过才摆）+「TA 的更多作品」+「同分区」。
// ★ 进视口才问（IntersectionObserver）：不拖首屏，也不为没往下滑的人多打两发请求。
// ★ 「谁发了什么」只有 videos.fetchAuthorWorks 一处（CLAUDE.md「拿 listVideos() 筛我的 / 他的」那一格：全站最新 30 条里筛出来的不是真相）；
//   离线才退回本机那份。结果四档照实说：partial 照样画、failed 说「没取到」并给重试、一条都没有就整块不画。
// ★ effect 依赖里放 remoteOn() 的**渲染值**（CLAUDE.md「时机型布尔」那格）：挂载那一拍它可能还是 false。
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import EmptyState from "../EmptyState";
import VideoTile from "../VideoTile";
import { fetchAuthorWorks, fetchRemixes, listVideos, profileHref, remoteOn, searchVideos } from "../../data/videos";
import { videoCategoryLabel, type VideoItem } from "../../types";

/** 两块各摆几条（双列网格：4 = 两行、6 = 三行） */
const AUTHOR_MAX = 4;
const CATEGORY_MAX = 6;
/** 照这条做的同款摆几条（一行两条 × 两行；remixCount 更多时标题写总数） */
const REMIX_MAX = 4;

type Block = { state: "loading" } | { state: "ok"; items: VideoItem[]; note: string } | { state: "failed"; error: string };

export default function RelatedWorks({ video }: { video: VideoItem }) {
  const { t } = useLingui();
  const boxRef = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [author, setAuthor] = useState<Block>({ state: "loading" });
  const [cat, setCat] = useState<Block>({ state: "loading" });
  // 同款：只在详情说过「有人做了同款」（remixCount > 0）时才问；老服务端 / 离线不认 remixOf 时整块不摆（fetchRemixes 的 ★）
  const [remix, setRemix] = useState<VideoItem[]>([]);
  const remixCount = video.remixCount ?? 0;
  const [retry, setRetry] = useState(0);
  const remoteLive = remoteOn();

  // 进视口才开问
  useEffect(() => {
    const el = boxRef.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  useEffect(() => {
    if (!seen) return;
    let alive = true;
    setAuthor({ state: "loading" });
    setCat({ state: "loading" });
    setRemix([]);
    if (remixCount > 0) {
      void fetchRemixes(video.id, REMIX_MAX).then((r) => {
        if (alive && r.status === "ok") setRemix(r.items.filter((v) => v.id !== video.id).slice(0, REMIX_MAX));
      });
    }
    void (async () => {
      // ① TA 的更多作品
      let authorItems: VideoItem[] = [];
      if (remoteLive && video.authorId) {
        const r = await fetchAuthorWorks(video.authorId, 8);
        if (!alive) return;
        if (r.status === "failed") setAuthor({ state: "failed", error: r.error });
        else {
          authorItems = r.status === "offline" ? [] : r.items.filter((v) => v.id !== video.id).slice(0, AUTHOR_MAX);
          setAuthor({ state: "ok", items: authorItems, note: "" });
        }
      } else {
        authorItems = listVideos()
          .filter((v) => v.id !== video.id && (video.authorId ? v.authorId === video.authorId : v.author === video.author))
          .slice(0, AUTHOR_MAX);
        setAuthor({ state: "ok", items: authorItems, note: "" });
      }
      // ② 同分区（离线 / 没连上服务器时 searchVideos 自己退回本机，并说明原因）
      if (!video.category) {
        setCat({ state: "ok", items: [], note: "" });
        return;
      }
      const r2 = await searchVideos({ category: video.category, limit: 12 });
      if (!alive) return;
      const shown = new Set([video.id, ...authorItems.map((v) => v.id)]);
      setCat({
        state: "ok",
        items: r2.items.filter((v) => !shown.has(v.id)).slice(0, CATEGORY_MAX),
        note: r2.reason ? t`没连上服务器，下面是这台设备上已有的几条` : "",
      });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只认这几个值：remoteLive 翻真那一拍要重问一次
  }, [seen, video.id, video.authorId, video.category, remoteLive, retry, remixCount]);

  const title = "mb-2 text-sm font-semibold text-slate-300";
  return (
    <div ref={boxRef} className="mt-6 space-y-6 px-4">
      {remix.length > 0 && (
        <section>
          <h2 className={title}>
            <Trans>照这条做的同款 · {remixCount}</Trans>
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {remix.map((v) => (
              <VideoTile key={v.id} video={v} />
            ))}
          </div>
        </section>
      )}
      {!seen ? null : author.state === "loading" ? (
        <EmptyState loading compact text={t`正在取 TA 的其他作品…`} />
      ) : author.state === "failed" ? (
        <EmptyState compact error text={t`没取到 TA 的其他作品`} cta={{ label: t`重试`, onClick: () => setRetry((n) => n + 1) }} />
      ) : author.items.length > 0 ? (
        <section>
          <div className="flex items-baseline gap-2">
            <h2 className={`min-w-0 flex-1 ${title}`}>
              <Trans>TA 的更多作品</Trans>
            </h2>
            <Link to={profileHref({ id: video.authorId, name: video.author })} className="flex-none text-xs text-slate-400 underline underline-offset-2">
              <Trans>去 TA 的主页 ›</Trans>
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {author.items.map((v) => (
              <VideoTile key={v.id} video={v} />
            ))}
          </div>
        </section>
      ) : null}

      {!seen || author.state === "loading" ? null : cat.state === "loading" ? (
        <EmptyState loading compact text={t`正在取同分区的作品…`} />
      ) : cat.state === "ok" && cat.items.length > 0 ? (
        <section>
          <h2 className={title}>
            <Trans>同分区 · {videoCategoryLabel(video.category)}</Trans>
          </h2>
          {cat.note && <p className="-mt-1 mb-2 text-[11px] text-slate-400">{cat.note}</p>}
          <div className="grid grid-cols-2 gap-3">
            {cat.items.map((v) => (
              <VideoTile key={v.id} video={v} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
