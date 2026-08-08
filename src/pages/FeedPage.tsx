// 首页：TikTok 式全屏上下滑视频流。每屏一支，进入视口自动播放、离开暂停。
// 互动视频（带 branchTree）在流里播开场段，点"进入互动"跳详情页做分支选择。
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
// 收藏取两边之长：**状态**用账号库（挂在用户对象上，刷新/换账号都还在），
// **计数**用 videos 的 saves（TikTok 版式右栏要显示数字）。
// videos 那套的 savedIds 是模块级 Set，刷新即丢，单用它收藏态会莫名消失；
// 账号库那套又不维护计数，单用它右栏没数字可显示。
import { addPlay, isLiked, isMyAuthor, listVideos, setLike, setSave } from "../data/videos";
import { hasPurchased, isCollected, isFollowing, toggleCollect, toggleFollow } from "../data/account";
import { fmtTokens } from "../data/economy";
import { useCurrentUser } from "../hooks/useAccount";
import { useVideosVersion } from "../hooks/useVideos";
import Avatar from "../components/Avatar";
import CommentSheet from "../components/CommentSheet";
import Icon, { type IconName } from "../components/Icon";
import CharacterPerch, { usePerchBurst, type PerchPose } from "../components/CharacterPerch";
import { VideoItem, formatDuration } from "../types";
import { useMediaUrl } from "../utils/mediaUrl";

/** 声音开关全流共享：一条视频上解除静音，后面每条都该有声（对标抖音/TikTok） */
let soundOn = typeof sessionStorage !== "undefined" && sessionStorage.getItem("feed.sound") === "1";

/** 右侧操作栏单键。固定 28×28 的 SVG + 至少 56px 高，间距由盒模型保证——
 *  原来用 emoji 时三个字形高度各不相同（🤍 方、💬 带气泡尾、▶️ 带彩色底板），
 *  所以怎么调 gap 都对不齐。
 *
 *  点亮的【那一下】会有个角色跳上来演一段再缩回去（见 CharacterPerch）。
 *  是一次性演出而不是常驻标记——常驻既挡视频，也让"已激活"被说两遍
 *  （实心红心/金书签已经说过了）。 */
function RailBtn({
  icon,
  filled,
  tint,
  label,
  perch,
  onClick,
}: {
  icon: IconName;
  filled?: boolean;
  tint?: string;
  label?: string;
  /** 给了姿势名，【激活的那一下】角色跳上来演一段再缩回去。
   *  姿势同时决定贴图、翻页帧和进出场动画（见 CharacterPerch）。 */
  perch?: PerchPose;
  onClick: () => void;
}) {
  // 只在 false→true 的跳变时播一次；划回一条早就点过赞的视频不该重播（见 usePerchBurst）
  const perchOn = usePerchBurst(!!filled);
  return (
    <button
      onClick={onClick}
      className="flex min-h-[56px] w-14 flex-col items-center justify-center gap-1 transition active:scale-90"
    >
      {/* relative 容器只包图标：角色要相对【图标】定位，包住文字的话会偏高。
          isolate：角色用负 z-index 沉到图标下面，必须有独立层叠上下文兜住，
          否则它会一路穿到整条右侧栏背后，跑到别的按钮和计数下面去。 */}
      <span className="relative isolate flex items-center justify-center">
        {/* key={perchOn}：连点两下时若不换 key，元素不重挂载，CSS 动画不会重播 */}
        {perch && perchOn > 0 && <CharacterPerch key={perchOn} pose={perch} size={28} />}
        <Icon
          name={icon}
          size={28}
          filled={filled}
          className={filled && tint ? tint : "text-white"}
          style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.55))" }}
        />
      </span>
      {label !== undefined && (
        <span className="text-[11px] tabular-nums text-white/90 [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">{label}</span>
      )}
    </button>
  );
}

function FeedItem({ video, active, dist }: { video: VideoItem; active: boolean; dist: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // 初值从库里取：划走再划回来时点赞态不该丢（isLiked 之前一直没人调用）
  const [liked, setLiked] = useState(() => isLiked(video.id));
  const [likes, setLikes] = useState(video.likes);
  // 收藏态取自账号库（划走再划回来、乃至刷新后都还在），计数取自作品自身
  const [saved, setSaved] = useState(() => isCollected(video.id));
  const [saves, setSaves] = useState(video.saves ?? 0);
  const [cmtOpen, setCmtOpen] = useState(false);
  const [following, setFollowing] = useState(() => isFollowing(video.author));
  const [paused, setPaused] = useState(false);
  const [burst, setBurst] = useState<{ x: number; y: number; k: number } | null>(null);
  const [muted, setMuted] = useState(!soundOn);
  // 缓冲提示（对标抖音底缘细线）：waiting 后延迟 200ms 才亮，
  // 微卡顿（解码抖一下就恢复）不闪灯，真加载才提示
  const [buffering, setBuffering] = useState(false);
  const bufTimer = useRef<number | undefined>(undefined);
  const bufferOn = () => {
    if (bufTimer.current != null) return;
    bufTimer.current = window.setTimeout(() => {
      bufTimer.current = undefined;
      setBuffering(true);
    }, 200);
  };
  const bufferOff = () => {
    if (bufTimer.current != null) {
      clearTimeout(bufTimer.current);
      bufTimer.current = undefined;
    }
    setBuffering(false);
  };
  useEffect(() => () => {
    if (bufTimer.current != null) clearTimeout(bufTimer.current);
  }, []);
  // 播放进度（对标抖音底部细进度条）：常驻可见，拖动跳转，拖动中中央显示大字时间
  const [prog, setProg] = useState({ t: 0, d: 0 });
  const [scrub, setScrub] = useState<number | null>(null); // 拖动中的目标比例；null=未拖
  const barRef = useRef<HTMLDivElement>(null);
  const ratioAt = (clientX: number) => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  function scrubStart(e: React.PointerEvent) {
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 合成事件/已失效指针没有可捕获的 pointerId——拖动本身不受影响 */
    }
    setScrub(ratioAt(e.clientX));
  }
  function scrubMove(e: React.PointerEvent) {
    if (scrub == null) return;
    e.stopPropagation();
    setScrub(ratioAt(e.clientX));
  }
  function scrubEnd(e: React.PointerEvent) {
    if (scrub == null) return;
    e.stopPropagation();
    // 全局进度 → 段 + 段内偏移；跨段时切段并挂起待 seek（新元素 loadedmetadata 后落位）
    const target = scrub * durTotal;
    let acc = 0;
    let j = 0;
    let local = 0;
    for (let k = 0; k < video.segments.length; k++) {
      const d = video.segments[k].durationSec;
      if (target < acc + d || k === video.segments.length - 1) {
        j = k;
        local = Math.max(0, target - acc);
        break;
      }
      acc += d;
    }
    const v = videoRef.current;
    if (j === si && v) v.currentTime = Math.min(local, v.duration || local);
    else {
      pendingSeek.current = local;
      setSi(j);
    }
    setScrub(null);
  }
  const countedRef = useRef(false);
  const tapRef = useRef<{ x: number; y: number; t: number; last: number }>({ x: 0, y: 0, t: 0, last: 0 });
  const user = useCurrentUser();
  const navigate = useNavigate();
  // 多段顺序连播：si=当前段（播完切下一段，最后一段回到 0 循环）。
  // 新作品经剪辑页合并成单条视频后天然只有一段；这里保证老的多段作品也能播完整
  const [si, setSi] = useState(0);
  const seg = video.segments[Math.min(si, video.segments.length - 1)];
  const multiSeg = video.segments.length > 1;
  const durTotal = video.segments.reduce((s, x) => s + x.durationSec, 0);
  const durBefore = video.segments.slice(0, si).reduce((s, x) => s + x.durationSec, 0);
  const pendingSeek = useRef<number | null>(null);
  const isInteractive = !!video.branchTree;
  const mine = isMyAuthor(video.author);
  // 付费未解锁：流里只出封面（不给白嫖流量费），点它去详情页解锁
  const lockPrice = video.pricing?.mode === "paid" ? (video.pricing.partPrices[0] ?? 0) : 0;
  const locked = lockPrice > 0 && !mine && !hasPurchased(video.id, 0);

  // 只有当前屏和相邻一屏挂 src：全部同时挂会在首屏并发拉 N 条流，
  // 而且 Android WebView 的硬解码器通常只有 4-8 个，超了直接黑屏。
  const wantSrc = dist <= 1;
  // 媒体地址解析：idb: 合并视频 / TOS 远端经代理取 blob；解析完成前出封面
  const resolvedSrc = useMediaUrl(!locked && wantSrc ? seg?.videoUrl : undefined);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) {
      setPaused(false);
      void v.play().catch(() => {});
      if (!countedRef.current) {
        countedRef.current = true;
        addPlay(video.id);
      }
    } else {
      v.pause();
      v.currentTime = 0;
      bufferOff(); // 划走的屏不留缓冲灯
      setScrub(null);
      setSi(0); // 划走归零：回来从头看
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, video.id]);

  function likeOn() {
    if (liked) return; // 双击只加不减：连点两下绝不该变成取消
    setLiked(true);
    setLikes(setLike(video.id, true));
    navigator.vibrate?.(10);
  }

  function toggleLike() {
    const on = !liked;
    setLiked(on);
    setLikes(setLike(video.id, on));
    navigator.vibrate?.(10);
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().catch(() => {});
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
  }

  // 用 pointer 事件而不是 onClick：onClick 会和 snap 滚动的惯性抢事件
  function onDown(e: React.PointerEvent) {
    tapRef.current = { ...tapRef.current, x: e.clientX, y: e.clientY, t: Date.now() };
  }
  function onUp(e: React.PointerEvent) {
    const r = tapRef.current;
    const dt = Date.now() - r.t;
    const moved = Math.hypot(e.clientX - r.x, e.clientY - r.y);
    if (dt > 250 || moved > 10) return; // 是滑动不是点击
    const now = Date.now();
    if (now - r.last < 260) {
      // 双击点赞
      tapRef.current.last = 0;
      likeOn();
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setBurst({ x: e.clientX - box.left, y: e.clientY - box.top, k: now });
      setTimeout(() => setBurst((b) => (b && b.k === now ? null : b)), 620);
      return;
    }
    tapRef.current.last = now;
    // 首次单击只解除静音——正好满足浏览器"必须有用户手势"的解锁要求
    if (muted && !soundOn) {
      soundOn = true;
      sessionStorage.setItem("feed.sound", "1");
      setMuted(false);
      return;
    }
    togglePlay();
  }

  function share() {
    const url = `${location.origin}${location.pathname}#/video/${video.id}`;
    if (navigator.share) void navigator.share({ title: video.title, url }).catch(() => {});
    else void navigator.clipboard?.writeText(url);
  }

  return (
    <section
      className="relative h-full w-full snap-start snap-always overflow-hidden bg-black"
      onPointerDown={onDown}
      onPointerUp={onUp}
    >
      {/* 画面：有真实视频用 video，否则封面兜底。远处的屏只放封面图，不挂视频源；
          付费未解锁只出封面 + 解锁引导 */}
      {locked ? (
        <>
          <img src={video.cover} alt={video.title} className="absolute inset-0 h-full w-full object-cover blur-[3px] brightness-[.45]" />
          <button
            onClick={() => navigate(`/video/${video.id}`)}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2"
          >
            <span className="text-3xl">🔒</span>
            <span className="rounded-full bg-gold px-4 py-1.5 text-sm font-bold text-ink">
              ⚡ {fmtTokens(lockPrice)} token 解锁
            </span>
            <span className="text-[11px] text-white/70">付费作品 · 点击进入解锁</span>
          </button>
        </>
      ) : resolvedSrc && wantSrc ? (
        <video
          key={`${video.id}:${si}`}
          ref={videoRef}
          src={resolvedSrc}
          poster={si === 0 ? video.cover : seg?.firstFrame}
          className="absolute inset-0 h-full w-full object-cover"
          loop={!multiSeg}
          muted={muted}
          playsInline
          preload={active ? "auto" : "metadata"}
          onWaiting={bufferOn}
          onStalled={bufferOn}
          onSeeking={bufferOn}
          onPlaying={bufferOff}
          onCanPlay={bufferOff}
          onSeeked={bufferOff}
          onEnded={() => {
            // 播完切下一段；最后一段回到开头循环（对齐单段 loop 行为）
            if (multiSeg) setSi((s) => (s + 1 < video.segments.length ? s + 1 : 0));
          }}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (pendingSeek.current != null) {
              v.currentTime = Math.min(pendingSeek.current, v.duration || pendingSeek.current);
              pendingSeek.current = null;
            }
            setProg({ t: v.currentTime, d: v.duration || 0 });
          }}
          onLoadedData={(e) => {
            // 段间切换的新元素要接着播（autoPlay 属性在解除静音后可能被拦，走显式 play）
            if (active && !paused) void e.currentTarget.play().catch(() => {});
          }}
          onTimeUpdate={(e) => setProg({ t: e.currentTarget.currentTime, d: e.currentTarget.duration || 0 })}
        />
      ) : (
        <img src={video.cover} alt={video.title} className="absolute inset-0 h-full w-full object-cover" />
      )}

      {/* 上下定高遮罩：只压住文字所在的两条带，中间画面保持干净 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/55 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />

      {/* 缓冲提示（元数据未就绪、还没有进度条时的独立形态）：底缘细线从中心拉宽淡出 */}
      {active && buffering && !paused && prog.d === 0 && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 flex justify-center"
          style={{ bottom: "var(--tabbar-h)" }}
        >
          <div className="feed-buffer-line" />
        </div>
      )}

      {/* 进度条（对标抖音）：底缘常驻细条 + 右下角小字 当前/总时长；
          可拖动跳转，拖动中变粗并在画面中央显示大字时间；缓冲时进度条位置改播脉冲线 */}
      {active && seg?.videoUrl && wantSrc && prog.d > 0 && (
        <div className="absolute inset-x-0 z-20" style={{ bottom: "calc(var(--tabbar-h) - 0.375rem)" }}>
          <div className="mb-0.5 flex justify-end pr-3">
            <span className="text-[10px] tabular-nums text-white/70 [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
              {formatDuration(scrub != null ? scrub * durTotal : durBefore + prog.t)} / {formatDuration(durTotal)}
            </span>
          </div>
          <div
            ref={barRef}
            className="relative mx-2 h-5 touch-none"
            onPointerDown={scrubStart}
            onPointerMove={scrubMove}
            onPointerUp={scrubEnd}
            onPointerCancel={scrubEnd}
          >
            {buffering && scrub == null ? (
              <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
                <div className="feed-buffer-line" />
              </div>
            ) : (
              <div
                className={`absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-white/25 transition-[height] ${
                  scrub != null ? "h-[5px]" : "h-[2.5px]"
                }`}
              >
                <div
                  className="h-full rounded-full bg-white/90"
                  style={{ width: `${(scrub != null ? scrub : Math.min(1, (durBefore + prog.t) / durTotal)) * 100}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 拖动进度时的中央大字时间（抖音式） */}
      {scrub != null && durTotal > 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="text-2xl font-semibold tabular-nums text-white [text-shadow:0_2px_8px_rgba(0,0,0,.7)]">
            {formatDuration(scrub * durTotal)} <span className="text-white/55">/ {formatDuration(durTotal)}</span>
          </div>
        </div>
      )}

      {/* 暂停指示 */}
      {paused && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Icon name="play" size={72} filled className="text-white/75 drop-shadow-lg" />
        </div>
      )}

      {/* 双击点赞的心 */}
      {burst && (
        <Icon
          name="heart"
          size={96}
          filled
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 text-rose-500 heart-burst"
          style={{ left: burst.x, top: burst.y }}
        />
      )}

      {/* 静音提示：解除之前明确告诉用户点一下有声 */}
      {active && muted && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/55 px-3 py-1.5 text-xs text-white/90 backdrop-blur">
          点击开启声音
        </div>
      )}

      {/* 右侧竖排操作：头像+关注 / 赞 / 评论 / 收藏 / 分享。
          对齐 TikTok：头像带 + 号在最上方（原来在左下角），四个按钮一律显示【数字】而非文字标签——
          「收藏」「分享」这种字在一列数字里会打断竖向的节奏，也说不出量级。
          播放量下沉：TikTok 不在视频上显示播放量，它属于作者后台而非观众决策信息。
          pointer 事件在这里截住：点操作键不该同时触发画面的暂停/解静音/双击点赞 */}
      <div
        /* gap-10 而不是更紧凑的 gap-4：激活态的角色会从图标顶沿向上探出约 45px，
           gap-4（16px）时它正好压住【上一个按钮的计数数字】——实测收藏后评论数「3」
           整个消失。计数是信息，装饰盖掉信息就是回退。
           取值靠量：gap-9（36px）时仍有 1px 重叠，gap-10（40px）后归零。
           换角色贴图（改高度）时要重新量一遍，别照抄这个数。 */
        className="absolute right-2 z-10 flex flex-col items-center gap-10"
        style={{ bottom: "calc(var(--tabbar-h) + 1.25rem)" }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        {/* 头像 + 关注：未关注时下挂一个 + 号，点了变对勾后淡出（TikTok 同款反馈） */}
        <div className="relative mb-1">
          <button onClick={() => navigate(`/video/${video.id}`)} className="block active:scale-95">
            <span className="block rounded-full ring-2 ring-white/90">
              <Avatar name={video.author} src={mine ? user?.avatar : undefined} size={44} />
            </span>
          </button>
          {user && !mine && !following && (
            <button
              onClick={() => setFollowing(toggleFollow(video.author))}
              aria-label="关注"
              className="absolute -bottom-2 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full bg-rose-500 text-white transition active:scale-90"
            >
              <Icon name="plus" size={12} strokeWidth={3} />
            </button>
          )}
        </div>

        <RailBtn icon="heart" filled={liked} tint="text-rose-500" label={String(likes)} perch="like" onClick={toggleLike} />
        {/* 评论就地滑出抽屉（对标短视频 App），不跳详情页打断刷视频的节奏 */}
        <RailBtn icon="comment" label={String(video.comments.length)} onClick={() => setCmtOpen(true)} />
        <RailBtn
          icon="bookmark"
          filled={saved}
          tint="text-gold"
          label={String(saves)}
          perch="save"
          onClick={() => {
            // 收藏要认人：未登录先去登录，否则"收藏了"只是一个划走就没的错觉
            if (!user) {
              navigate("/login?next=/");
              return;
            }
            const on = toggleCollect(video.id); // 账号库为准
            setSaved(on);
            setSaves(setSave(video.id, on)); // 只借它维护计数
            navigator.vibrate?.(10);
          }}
        />
        <RailBtn icon="share" label={String(video.shares ?? 0)} onClick={share} />
      </div>

      {cmtOpen && <CommentSheet video={video} onClose={() => setCmtOpen(false)} />}

      {/* 左下信息：作者名 + 标题 + 简介。
          按 TikTok 精简掉了三样——头像/关注（移到右侧栏顶部）、#分类胶囊、▶播放量。
          分类不再单独做胶囊：TikTok 把话题写进描述文字里（#fyp #messy），
          单独的胶囊在全出血画面上会切出一个突兀的实心块。 */}
      <div
        className="absolute inset-x-0 bottom-0 z-10 pl-4 pr-20"
        style={{ paddingBottom: "calc(var(--tabbar-h) + 0.75rem)" }}
      >
        <div className="mb-1.5 text-sm font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
          @{video.author}
        </div>
        <div className="mb-1 text-base font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,.7)]">{video.title}</div>
        <p className="line-clamp-2 text-xs leading-relaxed text-white/85 [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
          {video.description} <span className="text-white/70">#{video.category}</span>
        </p>
        {isInteractive && (
          <button
            onClick={() => navigate(`/video/${video.id}`)}
            className="mt-2 inline-flex min-h-[28px] items-center gap-1 rounded-full bg-gold/90 px-3 text-[11px] font-semibold text-ink active:scale-95"
          >
            <Icon name="branch" size={13} strokeWidth={2.25} />
            互动 · 你来选
          </button>
        )}
      </div>

    </section>
  );
}

export default function FeedPage() {
  const user = useCurrentUser();
  const version = useVideosVersion();
  const [feed, setFeed] = useState<"recommend" | "following">("recommend");
  const all = useMemo(() => listVideos(), [version]);
  const videos = useMemo(() => {
    if (feed !== "following") return all;
    const set = new Set(user?.following ?? []);
    return all.filter((v) => set.has(v.author));
  }, [all, feed, user?.following]);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const firstRun = useRef(true);

  // 切流后回到顶部并重置当前屏（首次挂载不算切流，否则会覆盖掉恢复的位置）
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    wrapRef.current?.scrollTo({ top: 0 });
    setActiveIdx(0);
  }, [feed]);

  // 判定当前屏：IntersectionObserver 多阈值取占比最大的一条；
  // 单阈值在快速甩动时会整批漏判（表现为划过去了新视频不播、旧的还在响），
  // 再用 scrollend 兜一次底。
  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        let best = -1;
        let bestRatio = 0.5;
        for (const e of entries) {
          if (e.intersectionRatio > bestRatio) {
            const idx = Number((e.target as HTMLElement).dataset.idx);
            if (!Number.isNaN(idx)) {
              best = idx;
              bestRatio = e.intersectionRatio;
            }
          }
        }
        if (best >= 0) setActiveIdx(best);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    root.querySelectorAll("[data-idx]").forEach((el) => io.observe(el));
    const onScrollEnd = () => {
      if (root.clientHeight > 0) setActiveIdx(Math.round(root.scrollTop / root.clientHeight));
    };
    root.addEventListener("scrollend", onScrollEnd);
    return () => {
      io.disconnect();
      root.removeEventListener("scrollend", onScrollEnd);
    };
  }, [videos.length]);

  const tabs = (
    <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center pt-2">
      {/* 纯文字 + 下划线：胶囊底色在全出血画面上会切出一个实心矩形，
          抖音/TikTok/小红书四家一致用的是文字态 */}
      <div className="pointer-events-auto flex items-center gap-6">
        {(["following", "recommend"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFeed(f)}
            className={`relative min-h-[36px] px-1 text-[15px] transition ${
              feed === f ? "font-semibold text-white" : "text-white/65"
            } [text-shadow:0_1px_3px_rgba(0,0,0,.6)]`}
          >
            {f === "following" ? "关注" : "推荐"}
            {feed === f && (
              <span className="absolute inset-x-1 -bottom-0.5 h-0.5 rounded-full bg-white" />
            )}
          </button>
        ))}
      </div>
    </div>
  );

  if (videos.length === 0) {
    return (
      <div className="fixed inset-0 bg-black">
        {tabs}
        <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
          <Icon name={feed === "following" ? "user" : "play"} size={40} className="text-slate-600" />
          <p className="text-sm">
            {feed === "following"
              ? user
                ? "关注的创作者还没有新作品"
                : "登录后可以关注喜欢的创作者"
              : "还没有作品"}
          </p>
          {feed === "following" ? (
            <button onClick={() => setFeed("recommend")} className="rounded-full bg-panel px-4 py-2 text-sm text-slate-300">
              去推荐流看看
            </button>
          ) : (
            <Link to="/studio" className="rounded-full bg-brand px-4 py-2 text-sm font-bold text-ink">
              去卡片工坊创作
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    // fixed inset-0 而不是 h-[calc(100vh-4rem)]：视频要全出血到屏幕边缘（底栏浮在渐变上），
    // 同时绕开 100vh 在 WebView 地址栏伸缩时导致 snap 错位的老问题
    <div className="fixed inset-0 z-0 bg-black">
      {tabs}
      <div
        ref={wrapRef}
        className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain"
        style={{ scrollbarWidth: "none" }}
      >
        {videos.map((v, i) => {
          const dist = Math.abs(i - activeIdx);
          return (
            <div key={v.id} data-idx={i} className="h-full w-full">
              {/* 远处的屏保留同样的 data-idx 和高度（snap 与 IO 都依赖它），只是不渲染内容 */}
              {dist <= 2 ? <FeedItem video={v} active={i === activeIdx} dist={dist} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
