// 视频编辑页的「舞台」：一块按视频真实比例摆好的画面 + 一条播放控制。
// 白模化（框选+裁剪）与套用（挂卡）两种模式共用它 —— 两边的宿主不同、状态形状也不同，
// 所以这里**只收 props**（PlanBoard 同款约束），不认识任何 store。
//
// ★★ 为什么要把画面盒子的尺寸算出来、而不是直接 `object-contain` 铺满一块方框：
//   裁剪框的坐标是**源视频像素**，画到屏幕上要乘一个 scale。object-contain 会留出上下
//   或左右的黑边，那时"容器坐标"与"画面坐标"差着一个偏移量 —— 少算这个偏移，用户框住的
//   和真正裁到的就不是同一块地方，而这件事**在屏幕上完全看不出来**（框还是那个框），
//   要等付费出片回来才发现水印还在。所以这里把画面盒子量成正好等于画面本身：
//   盒子内的 (0,0) 就是画面的 (0,0)，覆盖层只需要一个 scale。
//
// ★ 一切等媒体事件的地方**必须带超时**（CLAUDE.md「看不见的窗口」那条）：页面切到后台
//   时浏览器挂起解码，`loadedmetadata` 永远不来。没有超时这里就是一个永远转圈、
//   且自己好不了的页面 —— 与 videoFrames.sampleFrames / 提取器的 probeVideoMeta 同一个理由。
import {
  ReactNode,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
} from "react";
import Icon from "../Icon";
import { formatDuration } from "../../types";
import type { VideoNatural } from "./arkVideoRules";

/** 等 `loadedmetadata` 的上限。与 videoFrames / probeVideoMeta 同口径（15s）：
 *  慢网上首包确实可能要十几秒，短了会把正常的加载判成失败。 */
const LOAD_TIMEOUT_MS = 15_000;

/** 等一次 seek + 解码出画面的上限。★ 比加载短得多（元数据已经在手、多半只是几十毫秒的
 *  seek），但**必须有**：页面切到后台时系统暂停解码，`seeked` 永远不来 ——
 *  没有这个上限，「标记这一帧」就是一颗按下去永远转圈、且自己好不了的按钮
 *  （CLAUDE.md「在看不见的窗口里测」那条坑）。 */
const CAPTURE_TIMEOUT_MS = 6_000;

/** 缩略图长边（CSS 像素级）。★ 只是给人认"这是哪一帧"用的，画大了没有信息量，
 *  却要按 dataURL 塞进 React state（一条 1440×2560 的 JPEG 就是 MB 级）。 */
const THUMB_MAX_EDGE = 200;

const TIMEOUT_MSG =
  "视频加载超时。应用切到后台时系统会暂停视频解码（这时页面看着像卡住了）——回到前台后点「重试」。";

/** 抓下来的一帧。`thumb` 为空串 = 画面读不出来（跨域视频的 canvas 被污染），
 *  但**时刻仍然作数** —— 见 VideoStageHandle.capture 的 ★ */
export interface CapturedFrame {
  /** 真正定格在的时刻（秒，绝对时间轴）。★ 以 `<video>` 自己报的为准，不是我们要求的那个 */
  atSec: number;
  /** JPEG dataURL，或空串（读不出来时） */
  thumb: string;
}

/** 宿主能对舞台做的事。★ 只开这一个口子（而不是把 `<video>` 元素交出去）：
 *  元素一旦交出去，外面就能改 src / 调 play / 装事件，舞台里那套加载看门狗、
 *  首帧预热、选段回环就全成了两个人在管同一个元素。 */
export interface VideoStageHandle {
  /**
   * 定格到 `atSec` 并把那一帧抓成缩略图（`<canvas>` 本机抓，**不向服务端要**）。
   *
   * ★★ 抓的必须是**将要提交的那一帧**：先 seek 到目标秒、等 `seeked`，再画。
   *   直接画当前画面、却按目标秒提交，缩略图与服务端真正会看的帧就不是同一张 ——
   *   用户照着一张不存在的画面做决定，而屏幕上完全看不出来。
   * ★ 会**暂停播放**：用户点的是"标记这一帧"，画面继续往前跑才是意外。
   * ★ 跨域素材（https 的模板视频）画到 canvas 上会污染画布，`toDataURL` 抛
   *   SecurityError —— 那时**照样返回这一帧**，只是 `thumb` 为空：时刻是真的，
   *   缺的只是小图。为这个把整次标记判成失败，是拿一个显示问题去毁掉功能本身。
   * @throws Error（整句中文，可直接显示）：解码没跟上/超时/画不出来
   */
  capture(atSec: number): Promise<CapturedFrame>;
}

export interface StageFit {
  /** 画面盒子在屏幕上的宽高（CSS 像素） */
  w: number;
  h: number;
  /** 每 1 源像素占几个显示像素。覆盖层的坐标换算只认这一个数 */
  scale: number;
}

export interface VideoStageProps {
  /** 本机可播地址：blob: / https 都行。★ 舞台只拿它播，**绝不把它交出去**——
   *  提交给服务端的是四组整数，变换 URL 由服务端自己拼（方案 A3-2） */
  src: string;
  /**
   * 只播这一段（模式一：预览框选的那一段）。null / 缺省 = 整条随便播。
   * ★ 播到出点自动停回入点，不是"播完整条"：用户要判断的是**这一段**够不够、
   *   水印在不在框外，让他自己盯着时间码手动暂停是把校对成本推给用户。
   */
  clip?: { startSec: number; durSec: number } | null;
  /** 本机解出来的元数据到手（宽/高/时长）。★ 只用来"画得对不对"与比对登记值，
   *  作数的永远是服务端登记值 —— 不信客户端报的任何数 */
  onMeta?: (m: VideoNatural) => void;
  /** 播放头（秒）。时间轴要用它画一条线 */
  onTime?: (sec: number) => void;
  /** 外部要求跳到第几秒（拖时间轴把手时用）。值变了才跳，不变不动 */
  seekTo?: number | null;
  /** 画面上的覆盖层（裁剪框）。参数是刚量好的画面盒子，坐标换算只用它 */
  overlay?: (fit: StageFit) => ReactNode;
  /**
   * 舞台高度（任意 CSS 长度）。手机上要给时间轴、整句校验、报价留地方。
   * ★ 默认 `min(320px, 38vh)` 而不是一个死数：宿主可能是一块 88vh 的贴底浮层，
   *   而 667 高的小屏上写死 320px 会把时间轴和报价一起顶到折叠线以下 ——
   *   报价看不见就等于没报（本仓最怕的方向）。
   */
  maxHeight?: number | string;
  /** 播放条右侧的自定义按钮（模式一放「铺满整幅」之类） */
  controlsExtra?: ReactNode;
  /** 提交中：控件一律禁掉（但**不隐藏**——藏起来用户会以为页面坏了） */
  disabled?: boolean;
}

function VideoStageImpl(
  {
    src,
    clip = null,
    onMeta,
    onTime,
    seekTo = null,
    overlay,
    maxHeight = "min(320px, 38vh)",
    controlsExtra,
    disabled,
  }: VideoStageProps,
  ref: ForwardedRef<VideoStageHandle>,
) {
  const vref = useRef<HTMLVideoElement>(null);
  const spaceRef = useRef<HTMLDivElement>(null);
  const [meta, setMeta] = useState<VideoNatural | null>(null);
  const [space, setSpace] = useState({ w: 0, h: 0 });
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [t, setT] = useState(0);
  const [err, setErr] = useState("");
  /** 重试计数：变了就换一个 <video> 元素（改 src 属性不保证重新走一遍加载） */
  const [reload, setReload] = useState(0);
  /** 元数据到没到手。用 ref 而不是读 state：超时回调是在闭包里跑的 */
  const settled = useRef(false);

  // 加载看门狗
  useEffect(() => {
    settled.current = false;
    setMeta(null);
    setErr("");
    setPlaying(false);
    const timer = setTimeout(() => {
      if (!settled.current) setErr(TIMEOUT_MSG);
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [src, reload]);

  // 可用空间：宽度随屏幕/父容器走，高度由 maxHeight 定。
  // ★ 用 ResizeObserver 而不是只在挂载时量一次：旋转屏幕、软键盘弹出、父面板展开都会改宽度，
  //   量一次的话裁剪框会停在旧比例上——框还在原处，画面已经不是那个画面了。
  useEffect(() => {
    const el = spaceRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSpace({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useMemo<StageFit | null>(() => {
    if (!meta || meta.width <= 0 || meta.height <= 0 || space.w <= 0 || space.h <= 0) return null;
    const scale = Math.min(space.w / meta.width, space.h / meta.height);
    return { w: meta.width * scale, h: meta.height * scale, scale };
  }, [meta, space]);

  // 外部要求跳转（时间轴把手）。★ 不等 `seeked` 事件：等它就得再配一个超时，而这里
  //   不需要结果——跳过去画面自己会变，跳不过去用户下一拍就看得见
  useEffect(() => {
    const v = vref.current;
    if (v && seekTo != null && Number.isFinite(seekTo)) v.currentTime = Math.max(0, seekTo);
  }, [seekTo]);

  // 抓帧能力交给宿主（「标记这一帧」用）。★ 实现放在这里而不是宿主：只有这一层
  //   握着那个 `<video>`，而"等 seek / 等解码 / 一律带超时"是它自己的规矩
  useImperativeHandle(
    ref,
    (): VideoStageHandle => ({
      async capture(atSec: number): Promise<CapturedFrame> {
        const v = vref.current;
        if (!v) throw new Error("播放器还没就绪，稍等一下再标这一帧。");
        if (!(v.videoWidth > 0 && v.videoHeight > 0)) {
          throw new Error("这段视频的画面还没解出来（应用切到后台时系统会暂停解码）——回到前台等画面出来再标。");
        }
        // 播着的时候抓，抓到的会是"下一帧"。先停下：用户点的是"标记这一帧"
        v.pause();
        const want = Math.max(0, Math.min(atSec, Math.max(0, (v.duration || atSec) - 0.05)));

        /** 等这几个事件里最先到的那一个，**一律带超时**（后台页解码挂起时它们永远不来） */
        const waitFor = (events: string[]) =>
          new Promise<void>((resolve, reject) => {
            let done = false;
            const finish = (fn: () => void) => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              for (const ev of events) v.removeEventListener(ev, ok);
              v.removeEventListener("error", bad);
              fn();
            };
            const ok = () => finish(resolve);
            const bad = () => finish(() => reject(new Error("这段视频在这个位置解不开，换一帧试试。")));
            const timer = setTimeout(
              () =>
                finish(() =>
                  reject(
                    new Error(
                      "取这一帧超时了。应用切到后台时系统会暂停视频解码——回到前台、让画面真的动起来之后再点「标记这一帧」。",
                    ),
                  ),
                ),
              CAPTURE_TIMEOUT_MS,
            );
            for (const ev of events) v.addEventListener(ev, ok);
            v.addEventListener("error", bad);
          });

        // ★★ 两件事分开等，别合成一个 `seeked`：**同值赋 currentTime 不产生 seek**
        //   （首帧预热那里踩过同一条），已经停在这一秒上时等 seeked 就是等一个永远不来的
        //   事件 —— 表现为"标记这一帧"转 6 秒然后报一句其实不存在的超时。
        if (Math.abs(v.currentTime - want) > 0.02) {
          const seeked = waitFor(["seeked"]);
          v.currentTime = want;
          await seeked;
        }
        // 位置对了但画面还没解出来（preload="metadata" 时会这样）：再等一次"有画面了"。
        // 这时 seeked 早过去了，所以听的是 loadeddata/canplay
        if (v.readyState < 2) await waitFor(["loadeddata", "canplay", "seeked"]);
        const at = v.currentTime;
        const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(v.videoWidth, v.videoHeight));
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(v.videoWidth * scale));
        cv.height = Math.max(1, Math.round(v.videoHeight * scale));
        const ctx = cv.getContext("2d");
        if (!ctx) return { atSec: at, thumb: "" };
        try {
          ctx.drawImage(v, 0, 0, cv.width, cv.height);
        } catch (e) {
          // 画不上去（极少见：解码器还没交出画面）。★ 不当整次失败：时刻是真的
          console.warn("[VideoStage] 抓帧画不出来（只影响缩略图）：", e);
          return { atSec: at, thumb: "" };
        }
        try {
          return { atSec: at, thumb: cv.toDataURL("image/jpeg", 0.6) };
        } catch (e) {
          // 跨域素材污染了画布（SecurityError）。缩略图没了，但这一帧照样能标
          console.warn("[VideoStage] 画布被跨域素材污染，这一帧没有缩略图：", e);
          return { atSec: at, thumb: "" };
        }
      },
    }),
    [],
  );

  function toggle() {
    const v = vref.current;
    if (!v) return;
    if (v.paused) {
      // 播之前先把播放头收进选段里：不然点播放会从上次停的地方（很可能在选段外）开始，
      // 用户以为自己框错了
      if (clip && (v.currentTime < clip.startSec || v.currentTime >= clip.startSec + clip.durSec)) {
        v.currentTime = clip.startSec;
      }
      // play() 会 reject（自动播放策略、解码失败）。吞掉就成了"点了没反应"（铁律八）
      void v.play().catch((e) => setErr(`没能开始播放：${e instanceof Error ? e.message : String(e)}`));
    } else {
      v.pause();
    }
  }

  return (
    <div className="space-y-1.5">
      <div
        ref={spaceRef}
        className="relative flex w-full items-center justify-center overflow-hidden rounded-xl bg-black"
        style={{ height: maxHeight }}
      >
        <div
          className="relative"
          style={fit ? { width: fit.w, height: fit.h } : { width: "100%", height: "100%" }}
        >
          <video
            key={reload}
            ref={vref}
            src={src}
            playsInline
            muted={muted}
            preload="metadata"
            className="h-full w-full bg-black object-contain"
            onLoadedMetadata={(e) => {
              settled.current = true;
              const v = e.currentTarget;
              const m = {
                width: v.videoWidth,
                height: v.videoHeight,
                durationSec: Number.isFinite(v.duration) ? v.duration : 0,
              };
              setMeta(m);
              setErr("");
              onMeta?.(m);
              // ★★ 逼它把第一帧真的画出来 —— 这一页的全部意义是「看着画面把水印框到
              //   裁剪框外面」，看不见画面就等于蒙着眼睛裁，而水印裁不掉会被逐帧复刻进
              //   **每一次**套用出片（2026-08-15 真机实测：不做这一步，元素上只有浏览器
              //   自带的灰色播放键占位符）。
              // ★ 两步缺一不可，都是实测出来的：
              //   ① `preload="metadata"` 只取宽高/时长、**一帧都不解码**，所以要赋 currentTime
              //      触发一次 seek（赋 0 无效——本来就是 0，同值不产生 seek，要给 epsilon）；
              //   ② **Android WebView 对"从未播放过"的 video 不渲染 seek 到的那一帧**，
              //      光 ① 屏幕上还是占位符。静音播一下再立刻暂停才会真的画出来
              //      （muted 自动播放不需要用户手势，这也是元素上 muted+playsInline 的原因之一）。
              //   代价是可能闪一下第一帧的画面，比看不见画面小得多。
              const at = clip ? clip.startSec : 0.05;
              if (v.currentTime !== at) v.currentTime = at;
              void v
                .play()
                .then(() => {
                  v.pause();
                  if (v.currentTime !== at) v.currentTime = at;
                })
                // 播不动就算了：占位符照旧，但报错条与其它功能一个都不少（不吞成静默失败，
                // 也不弹一句"预览失败"吓人——用户仍然能拖时间轴和裁剪框）
                .catch((e) => console.warn("[VideoStage] 首帧预热播放被拒（预览可能只有占位符）：", e));
            }}
            onError={() => {
              settled.current = true;
              setErr("这段视频浏览器解不开（白模模板只收 mp4 / mov；换个文件或转码后重试）。");
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              // 到出点就停回入点：只预览"这一段"
              if (clip && v.currentTime >= clip.startSec + clip.durSec) {
                v.pause();
                v.currentTime = clip.startSec;
              }
              setT(v.currentTime);
              onTime?.(v.currentTime);
            }}
          />
          {/* 覆盖层只在量好画面盒子之后才画：没有 fit 就没有 scale，
              这时候画出来的框位置一定是错的（而且错得看不出来） */}
          {fit && overlay?.(fit)}
        </div>

        {err && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 px-5 text-center">
            <p className="text-xs leading-relaxed text-rose-300">{err}</p>
            <button
              onClick={() => setReload((k) => k + 1)}
              className="rounded-full border border-slate-500 px-3 py-1 text-[11px] text-slate-200"
            >
              重试
            </button>
          </div>
        )}
        {!err && !meta && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-400">
            正在读取视频…
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggle}
          disabled={disabled || !!err || !meta}
          className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-slate-700/80 text-slate-100 disabled:opacity-40"
          aria-label={playing ? "暂停" : "播放"}
        >
          <Icon name={playing ? "pause" : "play"} size={16} filled />
        </button>
        <span className="flex-none text-[11px] tabular-nums text-slate-400">
          {formatDuration(t)} / {formatDuration(meta?.durationSec ?? 0)}
        </span>
        <button
          onClick={() => setMuted((m) => !m)}
          disabled={disabled || !meta}
          className="flex-none rounded-full border border-slate-600 px-2 py-0.5 text-[10px] text-slate-300 disabled:opacity-40"
        >
          {muted ? "🔇 静音中" : "🔊 有声"}
        </button>
        <div className="min-w-0 flex-1" />
        {controlsExtra}
      </div>
    </div>
  );
}

/** ★ forwardRef 只为了那一个 `capture`（「标记这一帧」）。宿主不传 ref 时行为与以前完全一致 */
const VideoStage = forwardRef<VideoStageHandle, VideoStageProps>(VideoStageImpl);
VideoStage.displayName = "VideoStage";
export default VideoStage;
