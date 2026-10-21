// 首页：TikTok 式全屏上下滑视频流。每屏一支，进入视口自动播放、离开暂停。
// 互动视频（带 branchTree）在流里播开场段，点"进入互动"跳详情页做分支选择。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import EmptyState from "../components/EmptyState";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNavigate } from "react-router";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
// 收藏取两边之长：**状态**用账号库（挂在用户对象上，刷新/换账号都还在），
// **计数**用 videos 的 saves（TikTok 版式右栏要显示数字）。
// videos 那套的 savedIds 是模块级 Set，刷新即丢，单用它收藏态会莫名消失；
// 账号库那套又不维护计数，单用它右栏没数字可显示。
import {
  PLAY_MIN_SEC,
  addPlay,
  authorAvatarOf,
  authorDisplayName,
  authorSentinelOf,
  commentCountOf,
  hasCountedPlay,
  isLiked,
  isMyVideo,
  isSeedWork,
  listFollowingVideos,
  listVideos,
  refreshFeed,
  refreshFollowingFeed,
  profileHref,
  setLike,
  setSave,
} from "../data/videos";
import { danmakuNeedsLogin, danmakuOn, danmakuSessionPending, subscribeDanmaku } from "../data/danmaku";
import { hasPurchased, isCollected, isFollowing, toggleCollect, toggleFollow } from "../data/account";
import { fmtTokens } from "../data/economy";
import { useAuthState, useCurrentUser } from "../hooks/useAccount";
import { requestLandscape } from "../hooks/useOrientationLock";
import { useVideosVersion } from "../hooks/useVideos";
import Avatar from "../components/Avatar";
import CommentSheet from "../components/CommentSheet";
import ShareSheet from "../components/ShareSheet";
import DanmakuGlyph from "../components/DanmakuGlyph";
import DanmakuInput from "../components/DanmakuInput";
import DanmakuLayer from "../components/DanmakuLayer";
import AigcBadge, { isAigcWork } from "../components/AigcBadge";
import SeedBadge from "../components/SeedBadge";
import Icon, { type IconName } from "../components/Icon";
import CharacterPerch, { usePerchBurst, type PerchPose } from "../components/CharacterPerch";
import { remakeNodesOf, remakeableOf, useFlow } from "../studio/flowStore";
import { showToast } from "../data/toast";
import { useApplyTemplate } from "../components/flow/useApplyTemplate";
import { VideoAspect, VideoItem, aspectFromSize, aspectOf, formatDuration, formatPlays, segsTotal, videoCategoryLabel } from "../types";
import { useMediaUrl } from "../utils/mediaUrl";
import FeedActionSheet, { type FeedSpeed } from "../components/FeedActionSheet";
// 长按判定的几个数（多久算长按、两侧多宽、临时几倍速）在 data/feedGestures：新手引导也要插同一个数
import { EDGE_ZONE, HOLD_SPEED, LONG_PRESS_MS } from "../data/feedGestures";

/**
 * 这一下是不是按在这一条作品**自己的画面**上（DOM 后代），而不是它名下某个 portal 出去的浮层上。
 * ★ React 合成事件沿**组件树**冒泡，portal 到 body 的东西（评论抽屉、弹幕输入条、举报框、做同款那张
 *   「丢弃流水线」确认卡）一样会冒到这个 section 上：不挡的话，在确认卡上按久一点就开出长按菜单 / 两侧快进，
 *   在评论框里长按粘贴，系统那条「粘贴」也被这里的 onContextMenu 吞掉（2026-10-21 评审抓到）。
 *   portal 出去的节点不是 DOM 后代，问一句 contains 就分得开，以后新加的浮层也自动算在外面。
 */
const onOwnPicture = (e: React.SyntheticEvent) => (e.currentTarget as Node).contains(e.target as Node);

/**
 * 长按开出菜单之后，抬手那一下 click 吞掉。
 * ★ 菜单是**按着的时候**就开的（450ms，与抖音一样不用等抬手），抽屉当场画在手指底下。安卓 Chrome 只要在
 *   它自己的长按判定（系统长按时长：安卓 12 起 400ms，开了无障碍「触摸并按住延迟」会到 1~1.5 秒）之前抬手，
 *   就把这一按当成一次轻触，在抬手的位置补一个 click —— 落在抽屉的遮罩上就是「刚开出来就关了」，
 *   落在某一行上就是替人点了那一行（2026-10-21 发版前复核抓到）。
 * ★ 在 window 捕获阶段拦：比 React 挂在 body / #root 上的监听都早，抽屉的 onClick 一个都收不到。
 *   抬手（或手势被取消）之后再等 400ms 就撤掉，不会吞掉人接下来真正的那一下。
 */
function swallowLiftClick() {
  let timer: number | undefined;
  const eat = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    stop();
  };
  const lifted = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(stop, 400);
  };
  function stop() {
    window.clearTimeout(timer);
    window.removeEventListener("click", eat, true);
    window.removeEventListener("pointerup", lifted, true);
    window.removeEventListener("pointercancel", lifted, true);
  }
  window.addEventListener("click", eat, true);
  window.addEventListener("pointerup", lifted, true);
  window.addEventListener("pointercancel", lifted, true);
}

/** 一次双击点赞的爆心：位置、随机倾角（±15°，抖音式，连击时几颗心不叠成同一个角度） */
type Burst = { x: number; y: number; k: number; rot: number };

/**
 * 爆心外圈的品牌粒子：四颗金色四角星（看板娘的星形发夹）+ 四颗品牌青光点，交错排成一圈向外飞。
 * ★ 角度与距离固定（不随机）：每次都一样才像「这个 App 的点赞」，随机的话就只是噪点。
 */
const BURST_PARTS = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
  const r = i % 2 === 0 ? 70 : 54;
  return { dx: Math.round(Math.cos(a) * r), dy: Math.round(Math.sin(a) * r), star: i % 2 === 0 };
});

function LikeBurst({ b }: { b: Burst }) {
  return (
    <span className="pointer-events-none absolute z-10" style={{ left: b.x, top: b.y }}>
      {BURST_PARTS.map((p, i) =>
        p.star ? (
          <svg
            key={i}
            viewBox="0 0 24 24"
            width={16}
            height={16}
            aria-hidden
            className="burst-fly absolute left-0 top-0 text-gold"
            style={{ ["--dx" as string]: `${p.dx}px`, ["--dy" as string]: `${p.dy}px`, filter: "drop-shadow(0 0 4px rgba(251,191,36,.7))" }}
          >
            <path fill="currentColor" d="M12 2l2.4 6.2a2 2 0 0 0 1.4 1.4L22 12l-6.2 2.4a2 2 0 0 0-1.4 1.4L12 22l-2.4-6.2a2 2 0 0 0-1.4-1.4L2 12l6.2-2.4a2 2 0 0 0 1.4-1.4z" />
          </svg>
        ) : (
          <span
            key={i}
            aria-hidden
            className="burst-fly absolute left-0 top-0 h-1.5 w-1.5 rounded-full bg-brand"
            style={{ ["--dx" as string]: `${p.dx}px`, ["--dy" as string]: `${p.dy}px`, boxShadow: "0 0 6px rgba(56,189,248,.9)" }}
          />
        ),
      )}
      {/* 心本身照旧是通用红心（调研第五节：别把点赞画成星 / 灯泡）；倾角挂在外层，里层的 heart-burst 关键帧自己动 transform */}
      <span className="absolute left-0 top-0" style={{ transform: `rotate(${b.rot}deg)` }}>
        <Icon name="heart" size={96} filled className="heart-burst absolute left-0 top-0 text-rose-500" />
      </span>
    </span>
  );
}

/**
 * 带声音的自动播放被浏览器拒过一次吗。
 *
 * ★★ 默认**有声**。原生壳里不需要任何前置手势 —— 冷启动、一次触摸都没有的情况下
 *   解除静音并 play()，实测直接成功（Capacitor 的 WebView 关掉了
 *   mediaPlaybackRequiresUserGesture）。所以 App 里**不该有**"点击开启声音"
 *   这种提示：有没有声音是手机音量键的事，多一句话只会让人以为哪儿设错了。
 *
 * ★ 这个开关只为**网页版**兜底：桌面/移动浏览器的自动播放策略确实会拒绝带声音的
 *   自动播放（NotAllowedError）。被拒一次就整条流先静音，等用户第一次碰屏幕再开 ——
 *   全程不出文案，因为在那个环境里用户本来就知道"网页要点一下才有声"。
 * ★ 模块级而不是每个 FeedItem 各存一份：被拒是**浏览器**的态度，不是某一条视频的，
 *   划到下一条不该再撞一次墙。
 */
let autoplayBlocked = false;

/**
 * 画面怎么塞进这一屏。
 * 横屏（含正方）留黑边**不裁**，竖屏铺满——不做"与屏幕比例差多少"的相对判断：
 * 手机高矮不一（18:9 到 21:9 都有），相对阈值会让同一条 9:16 的片子在瘦长手机上
 * 被判成"该留黑边"，看着就像竖屏功能没生效。绝对判据只有一条线，行为可预期。
 */
function fitOf(a: VideoAspect): "contain" | "cover" {
  return a === "landscape" ? "contain" : "cover";
}

/** 右侧操作栏单键。固定 28×28 的 SVG + 至少 56px 高，间距由盒模型保证——
 *  原来用 emoji 时三个字形高度各不相同（🤍 方、💬 带气泡尾、▶️ 带彩色底板），
 *  所以怎么调 gap 都对不齐。
 *
 *  点亮的【那一下】会有个角色跳上来演一段再缩回去（见 CharacterPerch）。
 *  是一次性演出而不是常驻标记——常驻既挡视频，也让"已激活"被说两遍
 *  （实心红心/金书签已经说过了）。 */
function RailBtn({
  icon,
  glyph,
  filled,
  tint,
  label,
  name,
  pressed,
  perch,
  className = "",
  guide,
  onClick,
}: {
  icon?: IconName;
  /** icon 的替代：自带排版的标记（发弹幕那个「弹」字方框，见 DanmakuGlyph）。
   *  它的主体是汉字，做不成 Icon 那种 stroke 描边的 path —— 描边汉字在 28px 上糊成一团 */
  glyph?: ReactNode;
  filled?: boolean;
  tint?: string;
  label?: string;
  /** 无障碍名。★ 点赞 / 评论那两颗的 label 是**数字**（计数），读屏读出来只是「3」——名字另给一个 */
  name?: string;
  /** 切换键（点赞 / 收藏）的开关态 → aria-pressed：填色只有眼睛看得见，读屏要靠这一位才知道「已点过」
   *  （2026-10-15 教材人格评审，WCAG 2.2 · 4.1.2）。只给真能切换的那两颗；评论 / 分享不传，免得读屏把它们也念成切换键 */
  pressed?: boolean;
  /** 给了姿势名，【激活的那一下】角色跳上来演一段再缩回去。
   *  姿势同时决定贴图、翻页帧和进出场动画（见 CharacterPerch）。 */
  perch?: PerchPose;
  className?: string;
  /** 新手引导的锚点名（落到 `data-guide`）。★ 这一颗**必须显式收一个 prop**：
   *  RailBtn 不透传 `...rest`，直接写 data-guide 会被 TS 挡下；而在外面包一层 span
   *  会改变这一栏的高度 —— 那是量出来的（整栏 512px + 底 104px，640 高的屏只剩 24px 余量，
   *  超了会被 section 的 overflow-hidden 把最上面的头像裁掉，见下面 mt-8 那段注释）。 */
  guide?: string;
  onClick: () => void;
}) {
  // 只在 false→true 的跳变时播一次；划回一条早就点过赞的视频不该重播（见 usePerchBurst）
  const perchOn = usePerchBurst(!!filled);
  return (
    <button
      onClick={onClick}
      data-guide={guide}
      aria-label={name ?? label}
      aria-pressed={pressed}
      /* ★ mt-8 挂在【有角色演出的键】自己身上，而不是整栏一个大 gap。
         激活态的角色会从图标顶沿向上探出约 45px，压住**上一个键的计数数字**
         （实测收藏后评论数「3」整个消失，计数是信息，装饰盖掉信息就是回退）。
         需要的净空是 40px：整栏 gap-2（8px）+ 这里的 mt-8（32px）正好。
         取值靠量：净空 36px 时仍有 1px 重叠，40px 后归零；换角色贴图要重新量。

         为什么不像原来那样整栏 gap-10 一刀切：加上发弹幕键之后，一刀切要 608px，
         而现在这样是 512px（都是量出来的）。整栏底沿在 104px，608 那一版在
         640 高的小屏上会顶出屏幕，**被 section 的 overflow-hidden 把头像裁掉**。
         只有会探头的两个键需要让位，其余四个不需要。 */
      className={`flex min-h-[56px] w-14 flex-col items-center justify-center gap-1 transition active:scale-90 ${
        perch ? "mt-8" : ""
      } ${className}`}
    >
      {/* relative 容器只包图标：角色要相对【图标】定位，包住文字的话会偏高。
          isolate：角色用负 z-index 沉到图标下面，必须有独立层叠上下文兜住，
          否则它会一路穿到整条右侧栏背后，跑到别的按钮和计数下面去。 */}
      <span className="relative isolate flex items-center justify-center">
        {/* key={perchOn}：连点两下时若不换 key，元素不重挂载，CSS 动画不会重播 */}
        {perch && perchOn > 0 && <CharacterPerch key={perchOn} pose={perch} size={28} />}
        {glyph ? (
          <span
            className={`flex h-7 items-center justify-center ${filled && tint ? tint : "text-white"}`}
            style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.55))" }}
          >
            {glyph}
          </span>
        ) : (
          <Icon
            name={icon!}
            size={28}
            filled={filled}
            className={filled && tint ? tint : "text-white"}
            style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.55))" }}
          />
        )}
      </span>
      {label !== undefined && (
        <span className="text-[11px] tabular-nums text-white/90 [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">{label}</span>
      )}
    </button>
  );
}

function FeedItem({
  video,
  active,
  dist,
  immersive,
  onEnterFull,
  onAspect,
  speed,
  onSpeed,
}: {
  video: VideoItem;
  active: boolean;
  dist: number;
  /** 沉浸/全屏态由 FeedPage 持有：关注/推荐页签、底栏、退出键都不归本组件管 */
  immersive: boolean;
  onEnterFull: () => void;
  /** 把本屏的真实画幅报上去：转不转屏、全屏键写什么字都看它 */
  onAspect: (a: VideoAspect) => void;
  /** 倍速（长按菜单里选的，这次会话里划到下一条照旧）。FeedPage 持有 */
  speed: FeedSpeed;
  onSpeed: (s: FeedSpeed) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // 初值从库里取：划走再划回来时点赞态不该丢（isLiked 之前一直没人调用）
  const [liked, setLiked] = useState(() => isLiked(video.id));
  const [likes, setLikes] = useState(video.likes);
  // 收藏态取自账号库。2026-08-31 起收藏**跟着账号走**（服务端有端点了），
  // 换设备、重装都还在；本机那份只做离线兜底与冷启动首帧。
  // ★ 计数那一半 2026-08-30 撤了（见下面 RailBtn 的 ★★）：服务端没有收藏端点，
  //   本地自增出来的数不是"多少人收藏了"。`setSave` 仍然照调 —— 它维护的是本机库里
  //   那个字段，个人页的「收藏」页签还靠账号库的 collects 列人。
  const [saved, setSaved] = useState(() => isCollected(video.id));
  const [cmtOpen, setCmtOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  /** 弹幕输入条 / 评论抽屉开着时右侧栏整列退场（量法与理由见右侧栏 className 上那段 ★★） */
  const railAway = dmOpen || cmtOpen;
  // 弹幕总开关是**用户级**偏好，不跟作品走：在这一条上关掉，划到下一条也该是关的。
  // 订阅而不是 useState(danmakuOn())，否则同屏三个 FeedItem 的开关会各说各话
  const dmOn = useSyncExternalStore(subscribeDanmaku, danmakuOn, () => true);
  const [following, setFollowing] = useState(() => isFollowing(video.author));
  const [paused, setPaused] = useState(false);
  // 双击点赞的爆心可以叠好几颗（连点时一颗接一颗，原来只有一个状态位，后一颗把前一颗顶掉）
  const [bursts, setBursts] = useState<Burst[]>([]);
  /** 长按菜单开着没有 */
  const [menuOpen, setMenuOpen] = useState(false);
  /** 正按着两侧临时 2 倍速 */
  const [fastHold, setFastHold] = useState(false);
  const pressTimer = useRef<number | undefined>(undefined);
  /** 这一按已经算长按了（抬手时别再当单击 / 双击处理） */
  const longFired = useRef(false);
  // 默认有声。只有"这个浏览器已经拒过一次带声音的自动播放"时才先静音（见 autoplayBlocked）
  const [muted, setMuted] = useState(autoplayBlocked);
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
  /** 全局进度（0~1）→ 段 + 段内偏移：同一段直接 seek，跨段时切段并挂起待 seek（新元素 loadedmetadata 后落位）。拖动与键盘共用 */
  function seekRatio(ratio: number) {
    const target = ratio * durTotal;
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
  }
  function scrubEnd(e: React.PointerEvent) {
    if (scrub == null) return;
    e.stopPropagation();
    seekRatio(scrub);
    setScrub(null);
  }
  /**
   * 键盘 / 读屏的替代（wcag-a11y-i18n-2 的一半，2026-10-15 拍板）：进度条是 role=slider，左右键 5 秒、Home / End 到头。
   * ★ 触控盒的几何（h-5、底缘 50 / 86 / 104 三个联动量过的数）这一轮**不动**：那要在真机上一起重量再改，见 CLAUDE.md「动了首页底缘」那格。
   */
  function onBarKey(e: React.KeyboardEvent) {
    if (durTotal <= 0) return;
    const now = durBefore + prog.t;
    const step = 5;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(durTotal, now + step);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(0, now - step);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = durTotal;
    if (next == null) return;
    e.preventDefault();
    e.stopPropagation();
    seekRatio(next / durTotal);
  }
  /**
   * 播放量：**真看够 PLAY_MIN_SEC 秒**才记，而且一次会话只记一次（去重在 videos.ts）。
   *
   * ★ 原来是「这一屏成了当前屏」就 addPlay，两头都不对：
   *   ① 首页是甩着刷的，一划掠过三四屏，每屏都会短暂成为当前屏 —— 一趟甩下来
   *      给四条作品各记一次播放，而用户一条都没看清；
   *   ② FeedItem 划出两屏就卸载，划回来重挂载又是新的 countedRef ——
   *      上下蹭十趟播放量就涨十次，作者页那个「播放」数字直接失真。
   * ★ 累计用的是 **currentTime 的增量**而不是墙上时钟：暂停、切后台、缓冲的时候
   *   currentTime 不走，那些时间本来就不该算成"看过"。单次增量夹到 1 秒以内，
   *   拖进度条跳过去的那一大段不会被当成看过了。
   */
  const watchRef = useRef({ prev: 0, sum: 0 });
  const countedRef = useRef(false);
  /** toggled：上一次单击切过播放 / 暂停（双击的第二下要把它撤回来，见 onUp） */
  const tapRef = useRef<{ x: number; y: number; t: number; last: number; toggled: boolean }>({ x: 0, y: 0, t: 0, last: 0, toggled: false });
  const user = useCurrentUser();
  // ★ 右侧栏那几个键要区分「没登录」和「还不知道」：冷启动后立刻点收藏/发弹幕的人
  //   多半是登录着的，只是会话还没认领上。判 `!user` 会把他弹去登录页（见 useAuthState）。
  const auth = useAuthState();
  const navigate = useNavigate();
  const { t } = useLingui();
  // 登录态还没结论时的一句话回执。★ 不能"点了没反应"——那和坏了分不出来（铁律八）。
  const [authTip, setAuthTip] = useState("");
  const authTipTimer = useRef(0);
  function sessionBusy(): boolean {
    if (auth !== "pending") return false;
    setAuthTip(t`正在确认登录状态…`);
    window.clearTimeout(authTipTimer.current);
    authTipTimer.current = window.setTimeout(() => setAuthTip(""), 1800);
    return true;
  }
  // 多段顺序连播：si=当前段（播完切下一段，最后一段回到 0 循环）。
  // 新作品经剪辑页合并成单条视频后天然只有一段；这里保证老的多段作品也能播完整
  const [si, setSi] = useState(0);
  const seg = video.segments[Math.min(si, video.segments.length - 1)];
  const multiSeg = video.segments.length > 1;
  // 进度条也按实测时长（types.segsTotal 一处实现）：申报值短于成片时，进度条会在片子还没放完时就走到头
  const durTotal = segsTotal(video.segments);
  const durBefore = segsTotal(video.segments.slice(0, si));
  const pendingSeek = useRef<number | null>(null);
  const isInteractive = !!video.branchTree;
  // ★ 按 userId 判（isMyVideo），不是按展示名 —— 这一格喂的是下面那道**付费墙**，
  //   判错就是整段付费成片在信息流里直接自动播，一分钱不付、零报错。
  //   2026-09-08 复核补：上一轮只换了详情页那一处 locked，漏了信息流这一处。
  const mine = isMyVideo(video);
  // 付费未解锁：流里只出封面（不给白嫖流量费），点它去详情页解锁
  const lockPrice = video.pricing?.mode === "paid" ? (video.pricing.partPrices[0] ?? 0) : 0;
  const locked = lockPrice > 0 && !mine && !hasPurchased(video.id, 0);

  // 只有当前屏和相邻一屏挂 src：全部同时挂会在首屏并发拉 N 条流，
  // 而且 Android WebView 的硬解码器通常只有 4-8 个，超了直接黑屏。
  const wantSrc = dist <= 1;
  // 媒体地址解析：idb: 合并视频 / TOS 远端经代理取 blob；解析完成前出封面
  const resolvedSrc = useMediaUrl(!locked && wantSrc ? seg?.videoUrl : undefined);

  // 倍速：按住两侧时临时 2×，否则用这次会话里选的那一档。★ 换段 / 换作品会重建 <video>（playbackRate 回到 1），
  //   所以依赖里带 si 与地址，onLoadedData 那一拍也再设一次。
  // ★ 播放量照旧按 currentTime 的增量记（PLAY_MIN_SEC 是「内容看够 3 秒」，2 倍速下墙钟 1.5 秒就够 —— 记的是内容，不是墙钟）
  const rate = fastHold ? HOLD_SPEED : speed;
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = rate;
  }, [rate, si, resolvedSrc]);

  // 画幅：段上存的只是**排版提示**（画面还没解码时先按它铺），拿到真实宽高就改用真值。
  // 存的字段会缺（画幅可选之前的老作品）、会过时（改了设置没重新出片），也可能被
  // 服务端当未知字段丢掉——只有解码出来的像素不会骗人。
  const [detected, setDetected] = useState<VideoAspect | null>(null);
  useEffect(() => setDetected(null), [si, video.id]); // 换段/换作品都要重新判
  const shownAspect = detected ?? aspectOf(seg?.aspect).id;
  const fit = fitOf(shownAspect);
  useEffect(() => {
    if (active) onAspect(shownAspect);
  }, [active, shownAspect, onAspect]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) {
      setPaused(false);
      // ★ 先按**有声**起播。被浏览器拒了（只会发生在网页版）就静音重试 ——
      //   静音自动播放是任何浏览器都允许的，所以这一步不会再失败；
      //   同时记下这台浏览器的态度，后面每一条都直接先静音，别一条条撞墙。
      //   不弹任何提示：原生壳里根本走不到这儿，网页版用户也知道要点一下。
      void v.play().catch(() => {
        autoplayBlocked = true;
        v.muted = true;
        setMuted(true);
        void v.play().catch(() => {});
      });
      // 这一屏重新开始计时。本会话已经记过的就不用再数了（去重的权威在 videos.ts，
      // 这里问一句只是为了省掉后面每帧的累加）
      watchRef.current = { prev: v.currentTime, sum: 0 };
      countedRef.current = hasCountedPlay(video.id);
    } else {
      v.pause();
      v.currentTime = 0;
      bufferOff(); // 划走的屏不留缓冲灯
      setScrub(null);
      setSi(0); // 划走归零：回来从头看
      // 长按到一半被划走（按着两侧又往上推 = 滚动）：临时快进与还没触发的长按一并撤掉
      window.clearTimeout(pressTimer.current);
      setFastHold(false);
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

  /** 收掉一次按压的长按状态：没触发的计时器撤掉，正在临时快进的恢复原速 */
  function endPress() {
    window.clearTimeout(pressTimer.current);
    pressTimer.current = undefined;
    setFastHold(false);
  }
  // 临时快进期间在 window 上（捕获阶段）等抬手：用鼠标按住右侧那一条、挪到右侧栏上松开时，栏截住了 pointerup、
  // 指针又没离开 section（pointerleave 不来），section 自己永远收不到这一下 —— 视频就一直 2× 放下去。
  // 触屏有隐式指针捕获，不会这样；捕获阶段是因为 React 在栏上 stopPropagation 之后，原生冒泡到根就停了
  useEffect(() => {
    if (!fastHold) return;
    const up = () => {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = undefined;
      setFastHold(false);
    };
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, [fastHold]);

  // 用 pointer 事件而不是 onClick：onClick 会和 snap 滚动的惯性抢事件
  function onDown(e: React.PointerEvent) {
    if (!onOwnPicture(e)) return; // 从 portal 出去的浮层冒上来的（见 onOwnPicture）：不是按在画面上
    tapRef.current = { ...tapRef.current, x: e.clientX, y: e.clientY, t: Date.now() };
    longFired.current = false;
    window.clearTimeout(pressTimer.current);
    // 锁着的（付费未解锁）与不是当前这一条的不给长按：前者画面上只有封面，后者看不见
    if (!active || locked || e.button !== 0) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fx = box.width > 0 ? (e.clientX - box.left) / box.width : 0.5;
    const edge = fx < EDGE_ZONE || fx > 1 - EDGE_ZONE;
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = undefined;
      longFired.current = true;
      navigator.vibrate?.(12);
      // 两侧：按住临时 2 倍速（暂停着就先接着放，按住快进的意思就是"让它动起来"）；中间：长按菜单
      if (edge) {
        const v = videoRef.current;
        if (v?.paused) {
          void v.play().catch(() => {});
          setPaused(false);
        }
        setFastHold(true);
      } else {
        swallowLiftClick();
        setMenuOpen(true);
      }
    }, LONG_PRESS_MS);
  }
  function onMove(e: React.PointerEvent) {
    if (pressTimer.current == null) return;
    const r = tapRef.current;
    // 手指挪动超过 10px 就是在滑（上下翻页），不再算长按
    if (Math.hypot(e.clientX - r.x, e.clientY - r.y) > 10) endPress();
  }
  function onUp(e: React.PointerEvent) {
    // 浮层上抬手不算画面上的单击 / 双击（原来在「丢弃流水线」确认卡上点一下，背后的视频会跟着暂停）
    if (!onOwnPicture(e)) return;
    const wasLong = longFired.current;
    endPress();
    if (wasLong) return; // 这一按是长按：抬手只负责收掉快进，不当单击 / 双击
    const r = tapRef.current;
    const dt = Date.now() - r.t;
    const moved = Math.hypot(e.clientX - r.x, e.clientY - r.y);
    if (dt > 250 || moved > 10) return; // 是滑动不是点击
    const now = Date.now();
    if (now - r.last < 260) {
      // 双击点赞。★ 第一下已经当单击切过一次播放 / 暂停了：这里撤回去，双击点赞不该顺手把视频停住
      //   （抖音 / TikTok 双击都是边放边点赞；原来点完赞画面停在那儿，2026-10-21 浏览器里实测）
      tapRef.current.last = 0;
      if (r.toggled) togglePlay();
      tapRef.current.toggled = false;
      likeOn();
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const b: Burst = { x: e.clientX - box.left, y: e.clientY - box.top, k: now, rot: Math.round(Math.random() * 30 - 15) };
      setBursts((list) => [...list.slice(-3), b]);
      setTimeout(() => setBursts((list) => list.filter((x) => x.k !== now)), 640);
      return;
    }
    tapRef.current.last = now;
    tapRef.current.toggled = false;
    // ★ 只有"被浏览器拒过、正静着音"的时候，首次单击才拿去解除静音（正好满足
    //   浏览器"必须有用户手势"的解锁要求）。原生壳里 muted 一开始就是 false，
    //   这一段走不到 —— 点一下就是暂停，符合直觉。
    if (muted) {
      autoplayBlocked = false;
      setMuted(false);
      return;
    }
    togglePlay();
    tapRef.current.toggled = true;
  }

  /** 作者主页：自己的作品进「我的」，别人的按 userId 进 /user/<id>（拿不到 id 才退回名字）。
   *  规则本体在 data/videos.profileHref 一处——评论里的 @提及、分区页搜人也走它（铁律六） */
  const authorHref = profileHref({ id: video.authorId, name: video.author });
  /** 画在界面上的作者名：只翻 **app 自己填进去的那几个名字**（离线的「我」/ 兜底「匿名」两个哨兵，
   *  外加三条离线演示作品的作者）——判据只有 data/videos.authorDisplayName 一处。
   *  ★ 只给显示用 —— 关注、跳转、Avatar 的 name（取色）认的仍是 video.author 原值。
   *  ★ 名字叫 display：头像键的读屏名与个人页分享标题是同一句「{display} 的主页」，一个意思一个 msgid */
  const display = authorDisplayName(video.author, video.authorId);
  /** 作者就是正在看的人（离线的「我」）时，读屏名整句换成「我的主页」那句（英文 "Me's profile" 不成话）；判据同一处 */
  const authorSentinel = authorSentinelOf(video.author, video.authorId);
  /** 画面上的按钮要把 pointer 截住：不截的话点一下既跳转、又顺带触发了
   *  外层 section 的单击（暂停/解除静音）——手指抬起来时视频已经停了 */
  const stopTap = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onPointerUp: (e: React.PointerEvent) => e.stopPropagation(),
  };

  // 做同款（第八条整表覆盖入口，守卫与套模板同一份实现）。付费未解锁的不给：
  // 配方（分段剧本）是付费内容的一部分，锁着的只出封面
  const canRemake = !locked && remakeableOf(video.segments);
  const { guard: remakeGuard, dialog: remakeDialog } = useApplyTemplate();
  /** 做同款被就地拒时那句话（flowStore.err 只画在工作流页，这里不接就没人看得见）。
   *  几秒后自清：feed 上没有常驻错误位，这行是临时的 */
  const [remakeErr, setRemakeErr] = useState("");
  function remake() {
    remakeGuard(
      () => {
        const built = remakeNodesOf(video.segments, video.deck?.cards ?? []);
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
          setRemakeErr(useFlow.getState().err || t`现在铺不了（可能有一段正在生成中），稍后再试`);
          window.setTimeout(() => setRemakeErr(""), 5000);
        }
        return ok;
      },
      {
        label: t`做同款（丢弃上面那条流水线）`,
        noun: t({ message: "做同款", context: "丢弃确认卡里「…再回来X」的那个动作（英文用小写动词短语）" }),
      },
    );
  }

  /** 开分享面板（QQ / 微信占位 / 复制预览链接）。
   *  ★ 此前这里直接 navigator.share 一个 `${location.origin}/#/video/…`——
   *    APK 里 origin 是 https://localhost，发出去是死链。现在链接一律出自
   *    utils/shareLink.previewUrlOf（官网 /v/:id 预览页），面板见 ShareSheet。 */
  function share() {
    setShareOpen(true);
  }

  return (
    <section
      // select-none + 关掉 touch-callout / contextmenu：长按画面时别让 WebView 弹出选字或「保存图片」那一套
      className="relative h-full w-full snap-start snap-always overflow-hidden bg-black select-none [-webkit-touch-callout:none]"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      // 滚动接管了手势（上下翻页）、或者系统把这一按拿走了：长按与临时快进一起撤
      onPointerCancel={endPress}
      onPointerLeave={endPress}
      // 只关画面自己的系统菜单：评论框 / 弹幕框 / 举报框是 portal，它们的长按粘贴要留着（onOwnPicture）
      onContextMenu={(e) => {
        if (onOwnPicture(e)) e.preventDefault();
      }}
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
            <Icon name="lock" size={32} className="text-white/90" />
            <span className="rounded-full bg-gold px-4 py-1.5 text-sm font-bold text-ink">
              <Trans>⚡ {fmtTokens(lockPrice)} token 解锁</Trans>
            </span>
          </button>
        </>
      ) : resolvedSrc && wantSrc ? (
        <video
          key={`${video.id}:${si}`}
          ref={videoRef}
          src={resolvedSrc}
          poster={si === 0 ? video.cover : seg?.firstFrame}
          className="absolute inset-0 h-full w-full"
          // ★ 横屏片一律 contain：以前写死 object-cover，16:9 的片子在 9:16 的屏上
          //   左右各要切掉 40% 以上——人物经常只剩半张脸。留黑边才是完整画面。
          style={{ objectFit: fit }}
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
            // 真实解码尺寸一到手就以它为准（0 = 还没解出来，别拿去判）
            if (v.videoWidth && v.videoHeight) setDetected(aspectFromSize(v.videoWidth, v.videoHeight));
            if (pendingSeek.current != null) {
              v.currentTime = Math.min(pendingSeek.current, v.duration || pendingSeek.current);
              pendingSeek.current = null;
            }
            setProg({ t: v.currentTime, d: v.duration || 0 });
          }}
          onLoadedData={(e) => {
            // 新元素的 playbackRate 是 1：倍速在这一拍补上（见上面 rate 那段）
            e.currentTarget.playbackRate = rate;
            // 段间切换的新元素要接着播（autoPlay 属性在解除静音后可能被拦，走显式 play）
            if (active && !paused) void e.currentTarget.play().catch(() => {});
          }}
          onTimeUpdate={(e) => {
            const now = e.currentTarget.currentTime;
            setProg({ t: now, d: e.currentTarget.duration || 0 });
            if (countedRef.current || !active) return;
            // 单次增量夹在 [0,1]：拖进度条一跳几十秒、或者切段后 currentTime 归零，
            // 都不该被算成"看过了"
            const w = watchRef.current;
            w.sum += Math.min(1, Math.max(0, now - w.prev));
            w.prev = now;
            if (w.sum >= PLAY_MIN_SEC) {
              countedRef.current = true;
              addPlay(video.id);
            }
          }}
        />
      ) : (
        <img src={video.cover} alt={video.title} className="absolute inset-0 h-full w-full" style={{ objectFit: fit }} />
      )}

      {/* 上下定高遮罩：只压住文字所在的两条带，中间画面保持干净。
          沉浸态下没有文字要压，压边只会把画面上下两头压暗 */}
      {!immersive && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/55 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
        </>
      )}

      {/* 弹幕层。挂在画面上、排在右侧栏**前面**：两者同为 z-10，同层级下后来者居上，
          反过来的话弹幕会盖住点赞/收藏那一列（它自己是 pointer-events-none，
          挡不住点击，但视觉上压着一列图标一样难受）。
          沉浸态下顶上没有页签了，轨道可以往上提一截。 */}
      {active && dmOn && !locked && (
        <DanmakuLayer
          videoId={video.id}
          time={durBefore + prog.t}
          paused={paused}
          top={`calc(env(safe-area-inset-top, 0px) + ${immersive ? 20 : 62}px)`}
        />
      )}

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
      {active && !immersive && seg?.videoUrl && wantSrc && prog.d > 0 && (
        <div data-guide="feed-progress" className="absolute inset-x-0 z-20" style={{ bottom: "calc(var(--tabbar-h) - 0.375rem)" }}>
          <div className="mb-0.5 flex justify-end gap-1.5 pr-3">
            {/* 选了倍速时在同一行写一句（行内，不加高度 —— 底缘几何是联动量过的）：不写的话人会以为视频本身就这么快 */}
            {speed !== 1 && (
              <span className="text-[10px] font-semibold tabular-nums text-brand [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">{speed}×</span>
            )}
            <span className="text-[10px] tabular-nums text-white/70 [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
              {formatDuration(scrub != null ? scrub * durTotal : durBefore + prog.t)} / {formatDuration(durTotal)}
            </span>
          </div>
          {/* 读屏 / 键盘上它是真滑杆（值与右上角的读数同源）；几何没动，见 onBarKey 的 ★ */}
          <div
            ref={barRef}
            role="slider"
            tabIndex={0}
            aria-label={t`播放进度`}
            aria-valuemin={0}
            aria-valuemax={Math.round(durTotal)}
            aria-valuenow={Math.round(scrub != null ? scrub * durTotal : durBefore + prog.t)}
            aria-valuetext={formatDuration(scrub != null ? scrub * durTotal : durBefore + prog.t)}
            onKeyDown={onBarKey}
            className="relative mx-2 h-5 touch-none outline-none focus-visible:ring-2 focus-visible:ring-white/60"
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

      {/* 双击点赞的心 + 品牌粒子（可以叠几颗：连点时一颗接一颗） */}
      {bursts.map((b) => (
        <LikeBurst key={b.k} b={b} />
      ))}

      {/* 按住两侧临时快进的回执（抖音「2倍速播放中」/ Instagram 底部 2× 那一类）：放在页签下面一指，抬手就消失 */}
      {fastHold && (
        <div
          className="pointer-events-none absolute inset-x-0 z-20 flex justify-center"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 56px)" }}
        >
          <span className="flex items-center gap-1 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
            <Icon name="play" size={12} filled />
            <Icon name="play" size={12} filled className="-ml-1.5" />
            <Trans>{HOLD_SPEED}× 快进中</Trans>
          </span>
        </div>
      )}

      {/* ★ 这里原来常驻一句「点击开启声音」。删掉了：原生壳里视频**本来就有声**
          （实测冷启动零手势即可带声播放），那句话只会让人以为哪儿设错了 ——
          有没有声音是手机音量键的事。网页版被自动播放策略拦下时也不再出文案，
          第一次碰屏幕就自动开声（见 onUp）。 */}

      {/* 右侧竖排操作：头像+关注 / 赞 / 评论 / 收藏 / 分享。
          对齐 TikTok：头像带 + 号在最上方（原来在左下角），四个按钮一律显示【数字】而非文字标签——
          「收藏」「分享」这种字在一列数字里会打断竖向的节奏，也说不出量级。
          播放量下沉：TikTok 不在视频上显示播放量，它属于作者后台而非观众决策信息。
          pointer 事件在这里截住：点操作键不该同时触发画面的暂停/解静音/双击点赞 */}
      <div
        /* ★★ 弹幕输入条 / 评论抽屉开着的时候整列退场（railAway）。2026-10-21 Pixel 8 模拟器（API 36，412×840 CSS px）量的：
             · 键盘一弹，**布局视口**本身缩到 528（innerHeight 与 visualViewport.height 都是 528 —— 是 adjustResize，
               不只是视觉视口平移）。这一栏照旧 bottom 104、高 512，顶沿落到 −88：头像（−88…−44）与「+」整个出界，
               弹那一颗卡在上沿（−32…24），「发弹幕」那行字压在状态栏底下。评论抽屉里点输入框是同一个数（抽屉顶 200.6）。
             · **挪不下**：顶上页签行底在 50，输入条顶在 461.7，中间只有约 412px，而这一栏 512（去掉全屏键也要 432）。
               贴着 visualViewport 重新定位只能再砍键或缩放 —— 而砍下来的那几颗本来也点不到（下一条）。
             · **点不到**：两个浮层都是 fixed inset-0，露在屏幕里的每颗键，中心的 elementFromPoint 都落在浮层上
               （上半截是浮层「点一下收起」那一条，下半截是输入条 / 抽屉本身）；adb 真触屏点露在外面的那颗心，
               结果是输入条收起、赞数不变。这时右侧栏只是一列画，留着只剩被裁的那半截。
             · **节拍**（两轮 rAF 逐帧采样）：打开时 dmOpen 在按下后 12~35ms 就翻真，视口要再过 300~480ms 才缩 ⇒ 退场一定
               赶在挤压之前，所以退场是瞬时的（duration-0）。收起时反过来：dmOpen 先翻假，视口 22~30ms 后才长回 840 ⇒
               立刻显示会闪一两帧被裁的整列，所以回来时先等 150ms 再淡入 200ms（余量约 5 倍，给比模拟器收键盘慢的机器留的；
               改后实测：视口长回时这一列仍是 hidden / 0，163ms 起才开始淡入）。只动 opacity + visibility，不碰布局：
               底缘那一串锁死的数改前改后实测同一个（进度条 50 / 时长文字顶沿 87 / 本栏底 104）。
             · invisible 而不只是 opacity-0：退场期间这一列也不该被读屏读到、被焦点走到。 */
        className={`absolute right-2 z-10 flex flex-col items-center transition-[opacity,visibility] ${immersive ? "hidden" : ""} ${
          railAway ? "invisible opacity-0 duration-0" : "opacity-100 delay-150 duration-200"
        }`}
        /* ★ 3rem 是量出来的，不是估的。底缘那一串东西的位置是死的：
             进度条容器 bottom = var(--tabbar-h) - 0.375rem（离屏幕底 50px），
             容器里自上而下是「时长文字 14px + 2px + 进度条 20px」——
             也就是说**时长文字的顶沿在离屏幕底 86px 处**。
             原值 1.25rem 让整栏底沿落在 76px，全屏键（min-h 56px）正好压在
             76–86px 这一段上，把时长的右半截盖掉了（用户报的就是这个）。
             取 3rem → 底沿 104px，比时长文字顶沿再高 18px，留出一指的空气。
             改进度条的排版时这两个数要一起重新算。 */
        style={{ bottom: "calc(var(--tabbar-h) + 3rem)" }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <div
          /* gap-2 是**基准**净空；会探头的键（点赞/收藏）自己再加 mt-8 补到 40px，
             见 RailBtn 里的说明。按键本身 min-h 56px、内容只有 46px，
             所以 8px 的 gap 读出来其实是 18px 的空气，不挤。 */
          // ★★ 只给**当前这一条**挂锚点（与下面 feed-progress 同款门控）：首页同时渲染
          //   前后各两屏的 FeedItem，而 `document.querySelector` 取的是 DOM 里**第一个** ——
          //   用户划到第 N 条再点那颗 ?，圈会画在当前项上面两屏、也就是视口外。
          //   而"找不到锚点就退成居中卡片"那条兜底**不会救**：元素是存在的，
          //   off-screen 元素的 getBoundingClientRect 照样返回非零宽高。
          {...(active ? { "data-guide": "feed-rail" } : {})}
          className="flex flex-col items-center gap-2"
        >
          {/* 登录态还没结论时的回执。挂在栏内而不是屏幕中央：用户的视线就在这几个键上，
              而且首页任何居中浮层都会盖住画面。max-w 收窄避免把视频压掉半屏。 */}
          {authTip && (
            <span className="mb-1 max-w-[7.5rem] rounded-full px-2.5 py-1 bg-black/75 text-center text-[11px] leading-tight text-white">
              {authTip}
            </span>
          )}
          {/* 头像 + 关注：未关注时下挂一个 + 号，点了变对勾后淡出（TikTok 同款反馈）。
              点头像去【作者主页】而不是作品详情页——这是 TikTok/抖音的通用心智，
              也是唯一能走到别人主页的入口。详情页改由下方标题进入。 */}
          <div className="relative mb-1">
            <button
              onClick={() => navigate(authorHref)}
              aria-label={
                authorSentinel === "me"
                  ? t({ message: "我 的主页", context: "首页头像键的读屏名：这条作品是正在看的人自己发的，点进去是自己的主页" })
                  : t`${display} 的主页`
              }
              className="block active:scale-95"
            >
              <span className="block rounded-full ring-2 ring-white/90">
                {/* 「自己的用活的那份、别人的用快照」这条规则收在 videos.authorAvatarOf 一处 */}
                <Avatar name={video.author} label={display} src={authorAvatarOf(video)} size={44} />
              </span>
            </button>
            {/* 没登录也摆（抖音同款）：点了先去登录。★ 判 auth === "out" 不判 !user —— 会话还没认领上的那段窗口里
                user 也是空的，那时把登录着的人送去登录页是 CLAUDE.md「拿 !currentUser() 当没登录」那格坑；pending 时不摆 */}
            {(user || auth === "out") && !mine && !following && (
              <button
                onClick={() => {
                  if (!user) {
                    navigate("/login?next=/");
                    return;
                  }
                  setFollowing(toggleFollow(video.author));
                }}
                aria-label={t({ message: "关注", context: "作者头像下那颗关注按钮（动作：关注这个人）" })}
                // 画着 20px、命中区放到 44px（after 伪元素外扩 12px）：它贴着头像键，点偏一点就进了主页（2026-10-14 UX 课走查）
                className="absolute -bottom-2 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full bg-rose-500 text-white transition after:absolute after:-inset-3 after:content-[''] active:scale-90"
              >
                <Icon name="plus" size={12} strokeWidth={3} />
              </button>
            )}
          </div>

          {/* 发弹幕：排在点赞上面（B 站同位）。它是"参与"而不是"表态"，
              和下面四个计数键不是一类，所以不显示数字，只写字。
              弹幕显示关掉时这里划一道斜杠——不然用户会以为发出去的弹幕没生效 */}
          <RailBtn
            glyph={<DanmakuGlyph size={26} off={!dmOn} />}
            // ★ 图标下那行短字与无障碍名分开给（2026-09-17）：英文整句「Send a bullet comment」在 56px 宽的栏里折成三行，
            //   整栏高出 25px —— 640 高的小屏上最上面的头像被顶出屏幕上沿（这一栏的高度是量过的，见 RailBtn 里那段）。
            //   中文两条都是「发弹幕」，逐字不变。
            label={t({ message: "发弹幕", context: "首页右侧栏图标下的短标签（一行放得下）" })}
            name={t`发弹幕`}
            onClick={() => {
              // ★ 在这儿挡住未登录，而不是让 POST 去吃 401：client.ts 收到 401 会把用户
              //   **直接登出**，"我只是想发条弹幕，怎么账号退了"是最莫名其妙的一种失败。
              //   （与上面收藏键同一条处理。）
              if (danmakuSessionPending()) {
                sessionBusy();
                return;
              }
              if (danmakuNeedsLogin()) {
                navigate("/login?next=/");
                return;
              }
              setDmOpen(true);
            }}
          />
          {/* 计数一律折「万」（types.formatPlays 一处）：12345 原样写会把 56px 宽的栏撑宽、也读不出量级 */}
          <RailBtn icon="heart" filled={liked} pressed={liked} tint="text-rose-500" label={formatPlays(likes)} name={t`点赞`} perch="like" onClick={toggleLike} />
          {/* 评论就地滑出抽屉（对标短视频 App），不跳详情页打断刷视频的节奏 */}
          {/* ★ 走 commentCountOf，不读 comments.length：列表接口不返回 comments，
              直接读长度的话，没点进去过的作品评论数永远是 0（真机上抓到的） */}
          <RailBtn icon="comment" label={formatPlays(commentCountOf(video))} name={t`评论`} onClick={() => setCmtOpen(true)} />
          {/* ★★ 收藏**不显示数字**（2026-08-30）：服务端根本没有收藏端点，`setSave` 只在
              这台设备的本地库里自增 —— 那个数既不是"多少人收藏了"，也不会跟着账号走
              （种子作品上更是 mock 里手打的 786/604/341）。**显示一个骗人的数比不显示更糟**：
              作者会拿它判断作品受不受欢迎，而它只反映他自己点了几下。
              图标本身仍然照常填充/取消 —— "我收没收藏"是本机真相，那一半是真的。
              ⇒ 等服务端补了 /saves 再把数字接回来（接法照 setLike 的 remoteOn() 分支）。 */}
          <RailBtn
            icon="bookmark"
            filled={saved}
            pressed={saved}
            tint="text-gold"
            label={t`收藏`}
            perch="save"
            onClick={() => {
              // 收藏要认人：未登录先去登录，否则"收藏了"只是一个划走就没的错觉。
              // ★ 但"还不知道"不算未登录 —— 那一段先等着，别把登录着的人弹去登录页
              if (sessionBusy()) return;
              if (!user) {
                navigate("/login?next=/");
                return;
              }
              const on = toggleCollect(video.id); // 账号库为准
              setSaved(on);
              setSave(video.id, on); // 维护本机库那个字段（界面上不再拿它当计数显示）
              navigator.vibrate?.(10);
            }}
          />
          {/* ★★ 分享数同理，而且更彻底：`VideoItem.shares` **全仓没有任何地方写过它**
              （`rg "\.shares"` 只命中 mock 种子与这一行）—— 也就是说真实作品上它恒为 0，
              而种子作品上是手打的假数。摆一个恒 0 的计数只会让作者以为"没人分享过"。 */}
          <RailBtn icon="share" label={t`分享`} onClick={share} />
        </div>

        {/* 全屏键挂在整栏最下面：它不属于"对这条作品做点什么"那一组，
            所以比组内间距再多留一截（mt-6 = 24px，是组内基准 8px 的三倍）把它分出去。
            整栏是 bottom 定位的 flex-col，多出这一枚，上面几个自然被顶上去。
            两种画幅点下去做的事不同，字也就不同：横屏转屏占满，竖屏收起边角元素。 */}
        <RailBtn
          icon="expand"
          guide={active ? "feed-fullscreen" : undefined}
          label={shownAspect === "landscape" ? t`转屏` : t`全屏`}
          className="mt-6"
          onClick={onEnterFull}
        />
      </div>

      {cmtOpen && <CommentSheet video={video} onClose={() => setCmtOpen(false)} />}
      {/* ★ saveLocal={null} = 「保存到本地」这个入口**在首页不存在**：这颗键只拿到 video，
          没有"当前第几集"的上下文（多 P 作品要存哪一集问不出来）；下载又是低频动作，
          走一次点击进详情页就有全套面板 —— 与举报键放详情页的取舍同类。 */}
      {shareOpen && <ShareSheet video={video} onClose={() => setShareOpen(false)} saveLocal={null} />}
      {/* 长按菜单（倍速 / 清屏 / 保存到本地 / 举报）。只在当前这一条上开得出来（onDown 判 active） */}
      {menuOpen && (
        <FeedActionSheet
          video={video}
          mine={mine}
          speed={speed}
          onSpeed={(s) => {
            onSpeed(s);
            setMenuOpen(false);
            // 回执落在进度条那一行（选了非 1× 才有字），这里不另弹 toast：多一句话就多盖一次画面
          }}
          immersive={immersive}
          landscape={shownAspect === "landscape"}
          onClearScreen={onEnterFull}
          onClose={() => setMenuOpen(false)}
        />
      )}
      {/* 发弹幕时视频**不暂停**：弹幕的意思就是"此刻"，停下来发就名不副实了。
          附在哪一秒由输入条按下发送时现取（getTime），不是打开时定死的 */}
      {dmOpen && (
        <DanmakuInput
          videoId={video.id}
          getTime={() => durBefore + (videoRef.current?.currentTime ?? prog.t)}
          onClose={() => setDmOpen(false)}
        />
      )}

      {/* 左下信息：作者名 + 标题 + 简介。
          按 TikTok 精简掉了三样——头像/关注（移到右侧栏顶部）、#分类胶囊、▶播放量。
          分类不再单独做胶囊：TikTok 把话题写进描述文字里（#fyp #messy），
          单独的胶囊在全出血画面上会切出一个突兀的实心块。 */}
      <div
        /* ★ pointer-events-none：这个块 inset-x-0 满宽、还有 200 多 px 高，DOM 里又排在
           右侧栏后面——不关掉命中，它会把**盖在它矩形内的右侧栏按钮整个吃掉**。
           2026-08-10 真机实测：分享键与全屏键点了毫无反应，elementFromPoint 落在这个 div 上。
           （pr-20 只是内边距，盒子该多宽还是多宽，挡不住。）
           ⚠ 浏览器里用 el.click() 测**发现不了**这个问题——那是绕过命中测试直接派发。
           交互键各自 pointer-events-auto 收回点击；描述文字保持穿透，点它就是点画面暂停。 */
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 pl-4 pr-20 ${immersive ? "hidden" : ""}`}
        style={{ paddingBottom: "calc(var(--tabbar-h) + 0.75rem)" }}
      >
        <button
          {...stopTap}
          onClick={() => navigate(authorHref)}
          className="pointer-events-auto mb-1.5 block max-w-full truncate text-left text-sm font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,.6)] active:opacity-60"
        >
          {/* ★ 这里**不带 `@` 前缀**：`video.author` 是**显示名**，而本 app 的 @ 句柄是
              不可改的 username（见 utils/mention 与 MentionInput）。给显示名前面加个 @
              就是在告诉用户"@ 这串能 @ 到他"，而那串多半 @ 不到 —— 首页是曝光量最大的
              一屏，这条口径错在这儿传播得最快。要显示真句柄得把 author.username 一路
              接进 VideoItem，那是另一件事；在此之前，不写比写错好。 */}
          {display}
        </button>
        {/* 标题接管了原来头像那个「进详情页」的职责。详情页不是可有可无的：
            本片卡组、分段剧情、多 P 选集都只在那儿，头像改指主页后必须另留一个门 */}
        <button
          {...stopTap}
          {...(active ? { "data-guide": "feed-title" } : {})}
          onClick={() => navigate(`/video/${video.id}`)}
          className="pointer-events-auto mb-1 block max-w-full text-left text-base font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,.7)] active:opacity-60"
        >
          <span className="line-clamp-2">
            {video.title}
            <Icon name="chevron" size={14} className="ml-0.5 inline-block align-[-2px] text-white/60" />
          </span>
        </button>
        <p className="line-clamp-2 text-xs leading-relaxed text-white/85 [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
          {/* ★ 「AI 生成」标识挂在描述**行内**，不另起一行：底缘那 100px 里的四样东西
              （进度条 / 时长 / 右侧栏 / 底栏挂件）位置是联动算出来的，纵向多堆一行就得
              把那几个数重算一遍（CLAUDE.md 那格坑）。行内 chip 高度变化为 0。
              合规位置要求的是"播放画面周边的显著位置"，这里正是抖音同款的落点。 */}
          {isAigcWork(video) && <AigcBadge tone="overlay" className="mr-1 align-[1px]" />}
          {/* 「示例 · 离线」与 AI 标识并排、同样走**行内**：底缘那 100px 里四样东西的位置是联动算出来的
              （CLAUDE.md 那格坑），纵向多堆一行就得把那几个数重算一遍。判据只有 videos.isSeedWork 一处。 */}
          {isSeedWork(video) && <SeedBadge tone="overlay" className="mr-1 align-[1px]" />}
          {video.description} <span className="text-white/70">#{videoCategoryLabel(video.category)}</span>
        </p>
        {(isInteractive || canRemake) && (
          <div className="mt-2 flex items-center gap-2">
            {isInteractive && (
              <button
                {...stopTap}
                onClick={() => navigate(`/video/${video.id}`)}
                className="pointer-events-auto inline-flex min-h-[28px] items-center gap-1 rounded-full bg-gold/90 px-3 text-[11px] font-semibold text-ink active:scale-95"
              >
                <Icon name="branch" size={13} strokeWidth={2.25} />
                <Trans>互动 · 你来选</Trans>
              </button>
            )}
            {/* 做同款（backlog 2.8-②）：从流里一键把这条片的分段剧本+卡组铺成自己的
                工作流（可灵/即梦的做同款闭环）。与互动 chip 同排同高——底缘几何是
                量出来的联动值，只加横向内容不改纵向堆叠。守卫三件套在 remake() 里 */}
            {canRemake && (
              <button
                {...stopTap}
                // 新手引导锚点：只挂在当前这一支上（同 feed-title），这一支没有这颗时那一步退成居中卡片
                {...(active ? { "data-guide": "feed-remake" } : {})}
                onClick={remake}
                className="pointer-events-auto inline-flex min-h-[28px] items-center gap-1 rounded-full bg-white/20 px-3 text-[11px] font-semibold text-white backdrop-blur-sm active:scale-95"
              >
                {/* 启梦的招牌字形（两张叠着的塔罗卡 + 四角星，Icon「remix」）代替原来的 ⚡ emoji：
                    ⚡ 在全 app 是「token / 要花钱」的意思，而做同款这一下是铺流水线、不花钱 */}
                <Icon name="remix" size={14} />
                <Trans>做同款</Trans>
              </button>
            )}
          </div>
        )}
        {remakeErr && (
          <p className="mt-1.5 rounded-lg bg-black/60 px-2.5 py-1 text-[11px] leading-relaxed text-amber-300">
            {remakeErr}
          </p>
        )}
        {remakeDialog}
      </div>

    </section>
  );
}

/**
 * 首页整份重拉的最小间隔。★ 不是拍脑袋：底栏在首页/分区/工坊/我的之间来回点是几秒一次的事，
 * 每次挂载都打一发就是把列表接口当心跳；而"别人刚发的作品一分钟后才出现"没有人会觉得慢。
 */
const FEED_STALE_MS = 60_000;

export default function FeedPage() {
  const user = useCurrentUser();
  const auth = useAuthState(); // 三态：只有 "out" 才能把人送去登录页（下面关注流那颗键）
  const version = useVideosVersion();
  const { t } = useLingui();
  const navigate = useNavigate();
  const [feed, setFeed] = useState<"recommend" | "following">("recommend");
  /** 倍速（长按菜单里选）。这一层持有：划到下一条照旧是这一档；不落盘，下次打开 App 回到 1×（见 FeedActionSheet 头上） */
  const [speed, setSpeed] = useState<FeedSpeed>(1);
  const all = useMemo(() => listVideos(), [version]);
  const followingRemote = useMemo(() => listFollowingVideos(), [version]);
  const videos = useMemo(() => {
    if (feed !== "following") return all;
    // ★ 服务端按关注表筛的那份优先（不受推荐首屏 30 条限制）；离线 / 还没拉到时才退回
    //   本机按作者名筛 —— 见 videos.listFollowingVideos 的 ★★
    if (followingRemote) return followingRemote;
    const set = new Set(user?.following ?? []);
    return all.filter((v) => set.has(v.author));
  }, [all, followingRemote, feed, user?.following]);
  // ★★ 会话内刷新（2026-09-05 巡检补）：回到首页且距上次整份拉取超过 FEED_STALE_MS 就重拉，
  //   关注页签切进来同理。挂载那一拍 activeIdx 必然是 0，整份替换不会把人甩到别的位置。
  useEffect(() => {
    void refreshFeed({ minAgeMs: FEED_STALE_MS });
  }, []);
  useEffect(() => {
    if (feed === "following") void refreshFollowingFeed({ minAgeMs: FEED_STALE_MS });
  }, [feed]);
  // 第一次进首页强制放一遍引导。★★ 两条都要紧：
  //   ① 必须写在下面那个 `if (videos.length === 0) return` **之前** —— 那是提前返回，
  //      写在它后面就是条件调用 hook，React 当场报错；
  //   ② `enabled` 挂空态：空态那一支没有右侧栏、没有进度条、也没有标题，
  //      五步里四步的锚点都不存在，对着一屏空白讲"点这里"没有意义。
  useAutoGuide("feed", videos.length > 0);
  const [activeIdx, setActiveIdx] = useState(0);
  // 从后台回来也重拉一次，但**只在停在第一条时**：中途整份换掉列表，用户正看的那条会
  // 被顶到别处（甚至消失），比看到旧列表更像坏了。用 ref 读当下的下标与页签，
  // 监听器只挂一次。
  const activeIdxRef = useRef(0);
  activeIdxRef.current = activeIdx;
  const feedRef = useRef(feed);
  feedRef.current = feed;
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible" || activeIdxRef.current !== 0) return;
      void refreshFeed({ minAgeMs: FEED_STALE_MS });
      if (feedRef.current === "following") void refreshFollowingFeed({ minAgeMs: FEED_STALE_MS });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRun = useRef(true);
  // 沉浸/全屏态。放在页面这层而不是单条视频里：关注/推荐页签、底部 TabBar、退出键
  // 都不归 FeedItem 管，而它们必须一起消失
  const [immersive, setImmersive] = useState(false);
  const [activeAspect, setActiveAspect] = useState<VideoAspect>("portrait");

  const enterFull = async () => {
    // 真·全屏优先：它才能一并遮住系统/浏览器界面，也是安卓返回键能退出的那一层。
    // 不支持或被拒都不致命——下面的沉浸态照样把边角元素收起来
    try {
      await rootRef.current?.requestFullscreen?.();
    } catch {
      /* WebView 版本老 / 被策略拒绝：降级成"只收边角元素"，仍比什么都不做强 */
    }
    setImmersive(true);
  };
  const exitFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    setImmersive(false);
  };

  // 转屏只对横屏片做，且必须在进入全屏之后——两个平台都只允许全屏态下锁方向。
  // 跟着 activeAspect 走：全屏里划到一条竖屏片，屏幕转回来，不然竖片横躺着看。
  // ★ 只表达意图，不自己去锁：真正下手的是 useOrientationLock（App 级的全局竖屏锁）。
  //   它每次切路由都会 lock(portrait)，这里再各自锁一次必然打架——真机上就是
  //   "点了转屏没反应"。方向只能有一个主人。
  useEffect(() => {
    requestLandscape(immersive && activeAspect === "landscape");
  }, [immersive, activeAspect]);

  // 用安卓返回键 / Esc / 系统手势退出全屏时把沉浸态一起收掉，
  // 否则页面停在"什么按钮都没有"的样子，只剩那一枚退出键能脱身
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setImmersive(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // 底栏在 TabLayout 里、不归本页渲染——用 body 上的标记让它一起隐身（见 index.css）。
  // 离开首页/卸载必须清掉，否则底栏在别的页面也跟着消失
  useEffect(() => {
    if (immersive) document.body.dataset.immersive = "1";
    else delete document.body.dataset.immersive;
  }, [immersive]);
  useEffect(
    () => () => {
      delete document.body.dataset.immersive;
      // 横屏请求也必须撤：不撤的话离开首页后整个 App 还锁在横屏里
      requestLandscape(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    },
    [],
  );

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

  const tabs = immersive ? null : (
    <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-3 px-3 pt-2">
      {/* ★★ 那颗 ? 放**左上**，跟页签同一层、同一个沉浸态开关。
          绝不放底缘：底缘 100px 里叠着进度条(50px)/时长文字(86px)/右侧栏(104px)/底栏(56px)，
          位置是互相咬着算出来的，CLAUDE.md 记过两次"动了首页底缘就悄悄盖住别的元素"的事故。
          也不放右侧栏：那一栏 512px + 底 104px，640 高的屏只剩 24px 余量，再加一枚就被裁掉。
          外壳是 pointer-events-none，所以这里要自己开 auto。
        ★★★ **不能用 `absolute top-2`**（第一版就是，真机上点了没反应，那一下直接穿透
          到画面的"点击暂停"上）：绝对定位算的是**padding box**，而 `safe-top` 那圈安全区
          正是 padding —— `top-2` 于是把按钮摆到了 padding **之上**，也就是系统状态栏底下，
          那一带的触摸被系统 UI 吃掉。改成走正常流（flex 项），它自然落在安全区之下。
        ★ 右边补一个同宽占位，让「关注 / 推荐」保持真正居中（否则会被 ? 挤偏 14px）。 */}
      <div className="pointer-events-auto flex-none">
        <HelpButton tour="feed" circleClassName="border-white/50 bg-black/35 text-white backdrop-blur" />
      </div>
      {/* 纯文字 + 下划线：胶囊底色在全出血画面上会切出一个实心矩形，
          抖音/TikTok/小红书四家一致用的是文字态 */}
      <div className="pointer-events-auto mx-auto flex items-center gap-6">
        {(["following", "recommend"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFeed(f)}
            className={`relative min-h-[36px] px-1 text-base transition ${
              feed === f ? "font-semibold text-white" : "text-white/65"
            } [text-shadow:0_1px_3px_rgba(0,0,0,.6)]`}
          >
            {f === "following" ? t({ message: "关注", context: "首页顶部的关注流页签（名词：我关注的人发的作品）" }) : t`推荐`}
            {feed === f && (
              <span className="absolute inset-x-1 -bottom-0.5 h-0.5 rounded-full bg-white" />
            )}
          </button>
        ))}
      </div>
      {/* 右上角搜索（抖音 / TikTok / YouTube Shorts 的通行位置，调研第二节）。★ 与左边那颗 ? 同宽（28px 圈、命中区 44px），
          页签靠 mx-auto 居中、两侧必须等宽；原来这里就是一个同宽的空占位。去分区页并把焦点放进搜索框 */}
      <button
        onClick={() => navigate("/discover", { state: { focusSearch: true } })}
        aria-label={t`搜索`}
        className="pointer-events-auto relative flex h-7 w-7 flex-none items-center justify-center rounded-full border border-white/50 bg-black/35 text-white backdrop-blur after:absolute after:-inset-2 after:content-[''] active:scale-95"
      >
        <Icon name="search" size={15} strokeWidth={2.25} />
      </button>
    </div>
  );

  if (videos.length === 0) {
    return (
      <div className="fixed inset-0 bg-black">
        {tabs}
        <EmptyState
          className="h-full justify-center"
          icon={feed === "following" ? "user" : "play"}
          text={
            feed === "following"
              ? auth !== "out"
                ? t`关注的创作者还没有新作品`
                : t`登录后可以关注喜欢的创作者`
              : t`还没有作品`
          }
          cta={
            feed === "following"
              ? auth !== "out"
                ? { label: t`去推荐流看看`, onClick: () => setFeed("recommend") }
                // 没登录时那句说的是「登录后…」，键就该是登录（原来给的是「去推荐流」，话和键对不上；2026-10-14 UX 课走查）。
                // ★ 判 auth === "out" 不判 !user（2026-10-15 发版前复核抓到）：冷启动会话还没认领上的那段窗口 user 也是空的，
                //   那时把登录着的人送去登录页就是 CLAUDE.md「拿 !currentUser() 当没登录」那格坑
                : { label: t`登录`, to: "/login?next=%2F", primary: true }
              : { label: t`去卡片工坊创作`, to: "/studio", primary: true }
          }
        />
      </div>
    );
  }

  return (
    // fixed inset-0 而不是 h-[calc(100vh-4rem)]：视频要全出血到屏幕边缘（底栏浮在渐变上），
    // 同时绕开 100vh 在 WebView 地址栏伸缩时导致 snap 错位的老问题
    <div ref={rootRef} className="fixed inset-0 z-0 bg-black">
      {tabs}

      {/* 退出键：沉浸态下唯一留在画面上的控件，必须常驻——真全屏没申请成功时
          既没有 Esc 也没有系统返回可用，没有它用户就困在这一屏里了。
          压到半透明，不抢画面 */}
      {immersive && (
        <button
          onClick={exitFull}
          aria-label={t`退出全屏`}
          className="safe-top absolute right-3 top-0 z-30 mt-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-white/80 backdrop-blur-sm transition active:scale-90"
        >
          <Icon name="shrink" size={22} />
        </button>
      )}

      <div
        ref={wrapRef}
        className="no-scrollbar h-full snap-y snap-mandatory overflow-y-auto overscroll-contain"
      >
        {videos.map((v, i) => {
          const dist = Math.abs(i - activeIdx);
          return (
            <div key={v.id} data-idx={i} className="h-full w-full">
              {/* 远处的屏保留同样的 data-idx 和高度（snap 与 IO 都依赖它），只是不渲染内容 */}
              {dist <= 2 ? (
                <FeedItem
                  video={v}
                  active={i === activeIdx}
                  dist={dist}
                  immersive={immersive}
                  onEnterFull={() => void enterFull()}
                  onAspect={setActiveAspect}
                  speed={speed}
                  onSpeed={setSpeed}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
