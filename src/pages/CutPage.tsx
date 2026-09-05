// 剪辑页（发布前的必经站）：全屏三段式布局，对标剪映/CapCut 的手机剪辑器——
//   顶栏：‹ 返回 · ? 说明 · 导出分辨率 · 下一步
//   中区：预览画面 + 时间码 + 播放键（画面之外全黑，注意力全在片子上）
//   底部：工具面板，三个页签
//        剪辑 —— 缩略图时间轴：选中/✂️分割/🗑删除/拖拽或◀▶换序
//        圈选 —— ⭕在任意帧圈出物体写要求，跨帧跨段累积，一键按全部要求重生成
//        音频 —— 本地 BGM，音量可调，合并时混进成片
// 最后「下一步」把时间轴按顺序与裁剪范围重编码成单条视频，进发布页。
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import FrameAnnotator, { drawAigcBadge, drawCover, loadImg } from "../components/FrameAnnotator";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import Icon from "../components/Icon";
import { AI_REAL, refineFrame, regenSegment } from "../ai";
import { isArkAssetUrl, transferArkVideo } from "../ai/arkClient";
import { canAfford, spendTokens, walletOf } from "../data/account";
import { idbSet } from "../data/db";
import { annRedrawCost, fmtTokens, segTokens } from "../data/economy";
import { publishedExit, useStudio } from "../studio/studioStore";
import { VideoSegment, aspectOf, formatDuration, uid } from "../types";
import { resolveMediaUrl, useMediaUrl } from "../utils/mediaUrl";
import { loadVideoAt } from "../utils/videoFrames";

/** 时间轴上的一个片段：引用草稿段 + 裁剪范围（分割产生的子片段各占一段区间） */
interface Clip {
  id: string;
  segIndex: number;
  start: number;
  end: number;
}

/** 圈选标注：哪个片段的哪一帧 + 标注图（带红圈）+ 修改要求 */
interface Ann {
  id: string;
  segIndex: number;
  atSec: number;
  frame: string;
  req: string;
}

/** 导出档位。存的是【长边】像素而不是写死的 w×h：竖屏 720P 是 720×1280，
 *  横屏是 1280×720——写死 1280×720 的话，竖屏成片会被 drawCover 拦腰裁成横的。 */
const RESOLUTIONS = [
  { id: "720", label: "720P", long: 1280, note: "与素材同分辨率，最快" },
  { id: "1080", label: "1080P", long: 1920, note: "由 720P 素材放大，文件更大但不会更清晰" },
];

/** 档位 + 画幅 → 输出画布尺寸 */
function outSize(long: number, portrait: boolean): { w: number; h: number } {
  const short = Math.round((long * 9) / 16);
  return portrait ? { w: short, h: long } : { w: long, h: short };
}

type Tab = "cut" | "mark" | "audio";

function clipDur(c: Clip): number {
  return Math.max(0.1, c.end - c.start);
}

export default function CutPage() {
  const navigate = useNavigate();
  const draft = useStudio((s) => s.draft);
  const segEdit = useStudio((s) => s.segEdit);
  const segs = draft?.segments ?? [];

  const [clips, setClips] = useState<Clip[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [anns, setAnns] = useState<Ann[]>([]);
  const [annOpen, setAnnOpen] = useState<{ segIndex: number; atSec: number; frame: string } | null>(null);
  // ★ 分段模板组：默认把**原片音轨**预置进来（用户点名要的：白模复刻的成片保留原视频
  //   音频）。白模出片本身是无声的（server 钉着 generate_audio 缺省），合并时从原片
  //   解音轨混进去 —— decodeAudioData 直接吃 mp4 容器里的 AAC。
  //   线索读 studioStore.draftAudioHint（搭草稿的车）：「完成视频」会清空 flow store，
  //   这里挂载时 nodes 已经空了（2026-08-20 dev 实测，读 flow 那版永远落空）。
  //   用户在音频 tab 随时能换掉/去掉，所以是"预置"不是"锁定"。
  const [audio, setAudio] = useState<{ name: string; url: string; volume: number } | null>(() => {
    const src = useStudio.getState().draftAudioHint;
    return src ? { name: "原视频音轨", url: src, volume: 1 } : null;
  });
  const [tab, setTab] = useState<Tab>("cut");
  const [resId, setResId] = useState("720");
  const [resOpen, setResOpen] = useState(false);
  const [busy, setBusy] = useState("");
  /** 合并的防重入闸。★ 用 ref 不用 busy：setBusy 异步生效，挡不住同一帧内的第二次点击 */
  const mergingRef = useRef(false);
  /**
   * 合并进度（秒）。★★ 原来只显示「合并中 · 片段 i/N」——而合并是**实时录屏**：
   *   成片多长就录多长，一条 30 秒的片子要等 30 秒，屏幕上那个 i/N 十几秒才跳一次，
   *   用户完全不知道还要多久、也不知道它是不是卡死了。
   */
  const [mergeDone, setMergeDone] = useState(0);
  /** 用户点了取消。★ 用 ref：录制循环在 rAF 里跑，读 state 拿到的是闭包里的旧值 */
  const cancelRef = useRef(false);
  /**
   * 合并期间页面被切走过。
   * ★★ 这不是"可能有影响"，是**这一炉基本就废了**：页面不可见时 `<video>` 不解码、
   *   rAF 被节流到约 1 帧/500ms（CLAUDE.md 那格坑量过）。录出来的会是一段卡住的画面，
   *   而且**不报错** —— 用户拿到一条几十秒的坏片，还以为是生成质量的问题。
   */
  const wentHiddenRef = useRef(false);
  const [hiddenWarn, setHiddenWarn] = useState(false);
  // ★ 组稿那一拍如果没能落盘，话是**随导航带过来的**（flowStore.err 活不过 reset()
  //   与换路由，见 useFlowActions 的 ★★）。这一页是用户接下来唯一会看的一屏。
  const loc = useLocation();
  const [err, setErr] = useState(() => {
    const st = loc.state as { warn?: unknown } | null;
    return typeof st?.warn === "string" ? st.warn : "";
  });
  const dragClip = useRef<string | null>(null);

  // 预览播放器：播当前片段的源视频（代理 blob 供圈选截帧），到出点自动跳下一片段
  const vref = useRef<HTMLVideoElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [srcMap, setSrcMap] = useState<Record<number, string>>({});
  /** 各段截帧流没取到的原因（按段号）。★ 必须上屏：以前只 console.warn，release 包连 logcat
   *  都不写控制台，真机上就是一句永远的「视频载入中…」（2026-09-04 主人真机撞见） */
  const [srcErr, setSrcErr] = useState<Record<number, string>>({});
  /** 直连播放器自己报的错（地址过期 / 解码失败），同样上屏 */
  const [playErr, setPlayErr] = useState("");
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true; // StrictMode 下 mount→unmount→mount，别让第一次 cleanup 把它永久关掉
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const [, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const pendingSeek = useRef<number | null>(null);

  // 没草稿时页面马上跳走（下面那个 effect），别对着一屏空白弹引导
  useAutoGuide("cut", !!draft);

  const leftRef = useRef(false);
  useEffect(() => {
    if (draft || leftRef.current) return;
    // ★★ 去哪儿要看草稿是**怎么**没的（判据只在 studioStore.publishedExit 一处，铁律六）：
    //   发布成功之后，这一格是流水线留下的死页 —— 安卓返回键（没注册 backButton 监听时
    //   就是 webView.goBack()）会正好退回这里，而当时 leftRef 是新挂载的 false、draft
    //   已被发布页清掉，于是"刚发完片的人被扔进他从没去过的 3D 工坊"。回工坊只对
    //   "直接输地址闯进来"那种情况成立。
    navigate(publishedExit() ?? "/studio", { replace: true });
  }, [draft, navigate]);

  /**
   * 取这一段的**截帧流**（代理/直连抓成 blob，canvas 才不被跨域污染）——只喂圈选与合并。
   * ★★ 播放**不等它**：播放器直连 https 地址（<video> 不受 CORS 限制，见 utils/mediaUrl）。
   *   以前播放也等这个 blob，于是取流一失败整页就是一句永远的「视频载入中…」，而失败原因
   *   只 console.warn —— release 包看不到控制台，用户与开发者都拿不到一个字（铁律八）。
   *   现在失败写进 srcErr 上屏并给重试；成片本身照常能看。
   * ★ 换过视频（圈选重拍）要先把旧 blob 清掉：不清的话圈选截的是上一发的画面。
   */
  function loadCaptureSrc(i: number, url: string) {
    setSrcMap((m) => {
      const n = { ...m };
      delete n[i];
      return n;
    });
    setSrcErr((m) => {
      const n = { ...m };
      delete n[i];
      return n;
    });
    void resolveMediaUrl(url, { forCapture: true })
      .then((u) => {
        if (aliveRef.current && u) setSrcMap((m) => ({ ...m, [i]: u }));
      })
      .catch((e) => {
        console.warn(`[cut] 第 ${i + 1} 段视频取流失败:`, e);
        if (aliveRef.current) setSrcErr((m) => ({ ...m, [i]: e instanceof Error ? e.message : String(e) }));
      });
  }

  // 初始化片段 + 后台预取各段的截帧流（播放不等它，见 loadCaptureSrc 的 ★★）
  useEffect(() => {
    if (!draft) return;
    setClips(draft.segments.map((sg, i) => ({ id: uid("clip"), segIndex: i, start: 0, end: sg.durationSec })));
    draft.segments.forEach((sg, i) => {
      if (sg.videoUrl) loadCaptureSrc(i, sg.videoUrl);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!draft]);

  // 渲染用的片段列表：过滤掉指向不存在段的 clip。
  // 合并导出会把草稿换成"单段成片"，而 clips 还指着旧段号——zustand 的外部 store
  // 更新会同步重渲染本页，抢在 navigate 生效之前，于是 segs[c.segIndex] 为 undefined
  // 直接崩在 .firstFrame 上（实测控制台捕获到）。稳态下 view 与 clips 完全相同。
  const view = useMemo(() => clips.filter((c) => segs[c.segIndex]), [clips, segs]);
  const total = view.reduce((s, c) => s + clipDur(c), 0);
  const active = view[Math.min(activeIdx, Math.max(0, view.length - 1))] ?? null;
  const activeSeg: VideoSegment | undefined = active ? segs[active.segIndex] : undefined;
  /** 播放用地址：https 直连（同步拿到）、idb: 换 objectURL（异步）。不是截帧流（见 loadCaptureSrc） */
  const playSrc = useMediaUrl(activeSeg?.videoUrl);
  const res = RESOLUTIONS.find((r) => r.id === resId) ?? RESOLUTIONS[0];
  // 整条成片的画幅取第一段：时间轴上各段本该是同一个画幅（铸段时就跟着上一段走），
  // 真混排了也只能挑一个——合并只有一块画布，另一种必然被裁或补边
  const portrait = aspectOf(segs[0]?.aspect).id === "portrait";
  const out = outSize(res.long, portrait);
  /**
   * **还在成片里**的那些圈选 —— 计价、按钮上的数、重拍三处都只准用这一份。
   *
   * ★★ 2026-08-30 修：`anns` 是按 `segIndex` 攒的，而删片段（`removeClip`）只动 `clips`。
   *   于是"在第 3 段圈了 5 处、又把第 3 段整个删掉"之后，按钮上仍写着 5 处、
   *   报价里仍含着那一段的 `segTokens + annRedrawCost(5)`，点下去**真扣钱、真重拍**
   *   一段根本不会出现在成片里的画面（铁律六：报价与实扣必须是同一把尺，
   *   而它们当时是同一把**错的**尺——两处各自从 anns 聚合）。
   * ★ 不在这里顺手删掉那些 ann：用户可能只是先删段、待会儿再撤销顺序（`clips` 是本地
   *   state，加回来那一段的圈选就还在）。它们只是**不参与计价与重拍**。
   */
  const liveSegs = useMemo(() => new Set(view.map((c) => c.segIndex)), [view]);
  const liveAnns = useMemo(() => anns.filter((a) => liveSegs.has(a.segIndex)), [anns, liveSegs]);
  const annBySeg = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of liveAnns) m.set(a.segIndex, (m.get(a.segIndex) ?? 0) + 1);
    return m;
  }, [liveAnns]);
  // ★★ 每段 = 重出一次片 + **每处圈选一张改图**（regenerateAll 里对每条 ann 跑一次
  //   refineFrame）。原来只算了视频那一半 —— 5 秒标准档圈 5 处，按钮印 108k、实扣约 175k，
  //   而按钮旁边还写着「这一步才计费」（2026-08-21 第九轮扫描的 high）。
  //   改图那笔与工作流出片共用同一个 annRedrawCost（唯一实现，铁律六）。
  const annCost = useMemo(
    () =>
      [...annBySeg.entries()].reduce(
        (s, [i, n]) => s + (segs[i] ? segTokens(segs[i].durationSec, segs[i].videoTier) + annRedrawCost(n) : 0),
        0,
      ),
    [annBySeg, segs],
  );

  /**
   * 预览用的 BGM。
   *
   * ★★ 为什么要有它：预览的 `<video muted>`，而 BGM 只在 `mergeAndGo` 那一次性混轨 ——
   *   也就是说**音量滑杆是盲调的**：调完对不对得上，要等几十秒的实时录制跑完、
   *   跳到发布页才知道；不合适就得整条重录一遍。
   * ★ 它**不进导出链路**：合并那边仍然走 AudioContext 混轨（那条才是成片里的声音）。
   *   这一份纯粹是"让耳朵先听见"，所以它出问题也不该影响导出（下面全都 catch 掉）。
   */
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    // 换了曲子/去掉了：把上一个收掉
    bgmRef.current?.pause();
    bgmRef.current = null;
    if (!audio) return;
    const el = new Audio(audio.url);
    el.loop = true; // 与合并那边一致：BGM 短于成片时循环补齐
    el.volume = Math.max(0, Math.min(1, audio.volume));
    bgmRef.current = el;
    return () => {
      el.pause();
    };
  }, [audio?.url]);

  // 音量滑杆实时生效（这正是这一整段存在的理由）
  useEffect(() => {
    if (bgmRef.current && audio) bgmRef.current.volume = Math.max(0, Math.min(1, audio.volume));
  }, [audio?.volume]);

  // 合并期间别让预览的 BGM 跟着响：那会儿在录屏，两条声音会让人以为混轨出了问题
  useEffect(() => {
    if (busy) bgmRef.current?.pause();
  }, [busy]);


  if (!draft) return null;

  /** 当前播放头（全局秒）：前面片段时长之和 + 片内偏移 */
  const playhead =
    view.slice(0, activeIdx).reduce((s, c) => s + clipDur(c), 0) +
    (active ? Math.max(0, (vref.current?.currentTime ?? active.start) - active.start) : 0);

  function seekGlobal(sec: number) {
    let acc = 0;
    for (let i = 0; i < view.length; i++) {
      const d = clipDur(view[i]);
      if (sec < acc + d || i === view.length - 1) {
        const local = view[i].start + Math.min(d, Math.max(0, sec - acc));
        if (i === activeIdx && vref.current) vref.current.currentTime = local;
        else {
          pendingSeek.current = local;
          setActiveIdx(i);
        }
        return;
      }
      acc += d;
    }
  }

  /**
   * 停下来 —— **唯一一处**（三条路共用：暂停键 / 播到末尾 / 圈选前）。
   *
   * ★★ 抽它是因为漏了两条就出过事（2026-08-30 发版前复核抓到）：BGM 是 `loop = true` 的，
   *   而"播到时间轴末尾"和"圈选前"两条只停了 `<video>`。于是视频停在末尾、音乐一直响，
   *   而 `togglePlay` 判的是 `v.paused` —— 视频已经是暂停态，再按只会走**播放**分支，
   *   暂停分支永远进不去：**音乐再也停不下来**，播放键还画着 ▶（界面说没在放，耳朵里在响）。
   *   用户唯一的出路是把 BGM 整个删掉或退出这一页 —— 而这个功能本来是为了让他边听边调音量。
   */
  function stopPlayback() {
    vref.current?.pause();
    bgmRef.current?.pause();
    setPlaying(false);
  }

  function togglePlay() {
    const v = vref.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      // ★ BGM 跟着画面走：播放头在哪儿，BGM 就从哪儿开始（成片里它是从 0 铺到尾的）
      const bgm = bgmRef.current;
      if (bgm) {
        try {
          bgm.currentTime = playhead % Math.max(0.1, bgm.duration || 1);
        } catch {
          /* duration 还没解出来：从头放，差几百毫秒不影响"听个响" */
        }
        void bgm.play().catch(() => {});
      }
      setPlaying(true);
    } else {
      stopPlayback();
    }
  }

  /**
   * 把**选中的**片段从播放头处切成两半。
   *
   * ★★ 2026-08-30 修：这颗按钮的 disabled 判的是 `sel`（选中的），函数体用的却是
   *   `active`（正在播的）—— 而 `onTimeUpdate` 播到出点会自动 `setActiveIdx(+1)`
   *   却**不动 `sel`**。于是屏幕上亮着边框的是第 2 段，剪刀落在第 3 段上；
   *   连那句"离边缘太近"也是拿另一段的边界算的。
   *   （CLAUDE.md「弹层按第几段记」那格坑的同型：`Clip.segIndex` 是下标、`sel` 是 id，
   *   两套身份混着用必然错位。一律认 id。）
   * ★ 播放头不在选中的那段里就整句拒 —— 这时候"在播放头处分割"本身没有意义，
   *   而默认切成正在播的那一段就是上面那个 bug 本身。
   */
  /** 一刀落在哪儿必须留够的余量（秒）。分割与裁剪**同一个数**：两处都是"别切出一个
   *  没法播的碎片"，各写一个数必然分叉成"能切但切完删不掉"。 */
  const MIN_CLIP_SEC = 0.4;

  /**
   * 「现在能不能对选中的片段下刀」——分割与裁头裁尾**共用这一处判断**。
   * @returns 能下刀时返回 {clip, at}；否则就地写错并返回 null（铁律八：说清为什么点不动）
   */
  function cutPoint(): { clip: Clip; at: number } | null {
    const target = view.find((c) => c.id === sel);
    if (!target || !vref.current) return null;
    // ★ 播放头不在选中的那段里就整句拒：`sel`（选中的）与 `active`（正在播的）会分开
    //   —— 播到出点会自动换 active 却不动 sel（2026-08-30 修过的那个错位）。
    if (!active || active.id !== target.id) {
      setErr("播放头不在选中的片段里——先点一下这个片段（它会从头开始播），再操作。");
      return null;
    }
    return { clip: target, at: vref.current.currentTime };
  }

  function splitAtPlayhead() {
    const pt = cutPoint();
    if (!pt) return;
    const { clip: target, at: cur } = pt;
    if (cur - target.start < MIN_CLIP_SEC || target.end - cur < MIN_CLIP_SEC) {
      setErr(`分割点离片段边缘太近（至少留 ${MIN_CLIP_SEC}s）`);
      return;
    }
    setErr("");
    setClips((cs) => {
      const i = cs.findIndex((c) => c.id === target.id);
      if (i < 0) return cs;
      const a = { ...cs[i], end: cur };
      const b = { ...cs[i], id: uid("clip"), start: cur };
      return [...cs.slice(0, i), a, b, ...cs.slice(i + 1)];
    });
  }

  /**
   * 裁头 / 裁尾：把选中片段的入点或出点挪到播放头。
   *
   * ★★ 为什么补这个：`Clip.start/end` **一直支持裁剪**，UI 上却只有"分割"一条路，
   *   而删除在只剩一个片段时是灰的 ⇒ **简约模式出来的单段作品根本裁不了**
   *   （想去掉开头两秒？做不到）。这是"能力在数据结构里、入口没做出来"的典型。
   * ★ 为什么不做拖拽把手：这条时间轴是**等宽故事板卡**（宽度不正比于时长，
   *   段数是个位数、时长在推演时就定死了，不上等比时间轴是有意的取舍）。
   *   在等宽卡上摆把手，"拖到一半"在视觉上不对应任何时长 —— 那才是骗人。
   *   入点/出点复用已经存在的播放头概念，单段作品也照样用得了。
   */
  function trimTo(edge: "start" | "end") {
    const pt = cutPoint();
    if (!pt) return;
    const { clip: target, at: cur } = pt;
    const next = edge === "start" ? { ...target, start: cur } : { ...target, end: cur };
    if (next.end - next.start < MIN_CLIP_SEC) {
      setErr(`这样裁完只剩不到 ${MIN_CLIP_SEC}s，片段太短了`);
      return;
    }
    setErr("");
    setClips((cs) => cs.map((c) => (c.id === target.id ? next : c)));
  }

  /** 还原这一段的裁剪（回到整段）。★ 必须有：裁剪不可撤销的话，用户不敢用它 */
  function resetTrim() {
    const target = view.find((c) => c.id === sel);
    const seg = target && segs[target.segIndex];
    if (!target || !seg) return;
    // ★★ 分割出来的兄弟片段**共用同一个 segIndex**，只靠 start/end 分区间（见 Clip 类型注释）。
    //   无条件回到整段 = 与旁边那一半重叠 ⇒ 合并循环按各自的 start/end 逐个录，
    //   **同一截会被录两遍**：A[0,10] + B[5,10] 出来是 15 秒、第 5~10 秒出现两次。
    //   而屏幕上两半共用同一张缩略图、没有任何重叠提示，合并又是几十秒的实时录制、
    //   录完直接进发布页 —— 用户很可能就这么发出去了，且本页没有撤销。
    if (view.some((c) => c.id !== target.id && c.segIndex === target.segIndex)) {
      setErr("这个片段是分割出来的，同一段还有另一半在时间轴上——回到整段会和它重叠，成片里同一截会播两遍。想撤销分割，先删掉另一半。");
      return;
    }
    setErr("");
    setClips((cs) => cs.map((c) => (c.id === target.id ? { ...c, start: 0, end: seg.durationSec } : c)));
  }

  function removeClip(id: string) {
    setClips((cs) => (cs.length <= 1 ? cs : cs.filter((c) => c.id !== id)));
    if (sel === id) setSel(null);
  }

  function moveClip(id: string, dir: 1 | -1) {
    setClips((cs) => {
      const i = cs.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cs.length) return cs;
      const next = cs.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  /**
   * ⭕ 圈选当前帧：从**截帧流**（blob）上离屏截图，不从播放器上截（无真视频的段用预览图顶替）。
   * ★ 播放器现在直连跨域地址，从它 drawImage 会污染画布、toDataURL 直接抛 SecurityError；
   *   截帧流还没到 / 没取到时整句说清（原因 + 去哪儿重试），别让按钮"点了没反应"（铁律八）。
   */
  async function openAnnotator() {
    if (!active || !activeSeg) return;
    const v = vref.current;
    if (!activeSeg.videoUrl || !v) {
      setAnnOpen({ segIndex: active.segIndex, atSec: active.start, frame: activeSeg.poster || activeSeg.firstFrame });
      return;
    }
    const blobSrc = srcMap[active.segIndex];
    if (!blobSrc) {
      const why = srcErr[active.segIndex];
      setErr(
        why
          ? `圈选要先取到这一段的截帧流，刚才没取到：${why} —— 点预览下方的「重试」`
          : "这一段的截帧流还在取（成片有 20MB 级，稍等几秒再点圈选）",
      );
      return;
    }
    stopPlayback(); // ★ 圈选前也要连 BGM 一起停（见 stopPlayback 的 ★★）
    const at = v.currentTime;
    try {
      const src = await loadVideoAt(blobSrc, at);
      // 标注底图要按本段画幅截：截成 16:9 再拿去图生图，改回来的设定帧也是 16:9，
      // 竖屏段就此被悄悄改横
      const shot = outSize(1280, portrait);
      const c = document.createElement("canvas");
      c.width = shot.w;
      c.height = shot.h;
      drawCover(c.getContext("2d")!, src, shot.w, shot.h);
      setAnnOpen({ segIndex: active.segIndex, atSec: at, frame: c.toDataURL("image/jpeg", 0.9) });
      setErr(""); // 上一次「截帧流还在取」那句到这里已经不成立，别挂着
    } catch (e) {
      setErr(`截取当前画面失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** ✨ 按全部圈选标注重新生成：逐段合并该段所有要求，改首/尾帧 + 重拍 */
  async function regenerateAll() {
    // ★ 与报价同一份输入（liveAnns）：删掉的段上那些圈选不计价、也不重拍
    if (busy || liveAnns.length === 0) return;
    const bySeg = new Map<number, Ann[]>();
    for (const a of liveAnns) bySeg.set(a.segIndex, [...(bySeg.get(a.segIndex) ?? []), a]);
    if (AI_REAL && !canAfford(annCost)) {
      const w = walletOf();
      setErr(
        `重生成 ${bySeg.size} 段约需 ${fmtTokens(annCost)} token，余额 ${fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0))} 不足——去「我的」页充值`,
      );
      return;
    }
    setErr("");
    try {
      const nextSegs = draft!.segments.slice();
      let n = 0;
      for (const [segIndex, list] of bySeg) {
        n++;
        const seg = { ...nextSegs[segIndex] };
        const half = seg.durationSec / 2;
        // 逐个标注改帧：前半段的圈选改首帧、后半段的改尾帧（Seedance 只收首尾帧），
        // 同一帧多个标注串行叠加（上一次的修改结果作为下一次的底图）
        for (let k = 0; k < list.length; k++) {
          const a = list[k];
          setBusy(`第 ${segIndex + 1} 段 · 按圈选改画面 ${k + 1}/${list.length}…`);
          const edited = await refineFrame(
            `${a.req}。参考图中红色圈线标注了目标物体：只对该物体做上述处理，并彻底去掉红色圈线本身`,
            a.frame,
            seg.aspect,
          );
          if (a.atSec < half) seg.firstFrame = edited;
          else seg.lastFrame = edited;
        }
        setBusy(`第 ${segIndex + 1} 段 · 重拍视频（${n}/${bySeg.size} 段）…`);
        const reqAll = list.map((a) => a.req).join("；");
        const { url, lastFrame, poster } = await regenSegment(seg, reqAll, (s) => setBusy(`第 ${segIndex + 1} 段 · ${s}`));
        seg.videoUrl = url;
        if (lastFrame) seg.lastFrame = lastFrame;
        seg.poster = poster; // 没截到就清掉：别让缩略图挂着上一发的画面
        // ★ 必须判 AI_REAL：演示模式下根本没调方舟，却照样扣本地余额，
        //   用户在 mock 里点几次就"没钱"了，还查不出钱花在哪
        // ★ 与按钮上那个数同源：视频那一半 + 每处圈选一张改图（annRedrawCost 唯一实现）
        if (AI_REAL) spendTokens(segTokens(seg.durationSec, seg.videoTier) + annRedrawCost(list.length));
        nextSegs[segIndex] = seg;
        // ★★ **每段一落地**（2026-08-21 第九轮扫描的 high）：原来整轮跑完才 setState 一次，
        //   中途失败（第 3 段撞上敏感词/超时）前面两段**钱已经扣了**，成片却随
        //   nextSegs 一起丢弃，圈选也没清 —— 用户点「重试」对同一份内容再收一遍。
        //   逐段写回 + 逐段清掉这一段的圈选：失败时前面付过的钱全都留在成片里。
        useStudio.setState({ draft: { ...useStudio.getState().draft!, segments: nextSegs.slice() } });
        // ★ 钱刚扣过（segTokens + annRedrawCost）：这一段落盘，别让一次切后台把它烧掉。
        //   与 useFlowActions 那条「又炼出一段就自动存盘」是同一条规则、同一个理由。
        // ★ null = 存住了；有句子就原样说出去（segEdit 那条路说的是另一件事，见 store）
        const why = await useStudio.getState().persistCutDraft();
        if (why) setErr(`这一段已经改好、钱也扣过了，但${why}`);
        setAnns((prev) => prev.filter((a) => a.segIndex !== segIndex));
        loadCaptureSrc(segIndex, url);
      }
      setBusy("");
    } catch (e) {
      setBusy("");
      // ★ 说清"前面几段已经保住了"：不说的话用户以为整轮白花，会再点一次（再收一遍）
      setErr(
        `重新生成中断：${(e instanceof Error ? e.message : String(e)).slice(0, 110)}` +
          `。已经改好的段已经保住了（它们的圈选也清掉了），再点一次只会重做剩下的那几段`,
      );
    }
  }

  /** 🎬 合并导出：按时间轴顺序/裁剪范围重编码成单条 webm（混入音频轨）→ 发布页 */
  async function mergeAndGo() {
    // ★★ 防重入用 ref 不用 state：setBusy 是异步生效的，同一帧里的第二次点击照样进得来。
    //   进来之后就是两条 MediaRecorder 实时录同一块画布、两条 AudioContext 解同一条音轨，
    //   两次写库、两次 navigate —— 后完成的那次会把用户已经在发布页看到的成片换成
    //   它自己那条录得更烂的（2026-08-21 对抗评审确认）。
    if (busy || mergingRef.current) return;
    mergingRef.current = true;
    cancelRef.current = false;
    wentHiddenRef.current = false;
    setHiddenWarn(false);
    setMergeDone(0);
    setErr("");
    // ★★ 合并期间页面被切走 = 这一炉基本就废了（不可见时 `<video>` 不解码、rAF 被节流到
    //   约 1 帧/500ms），而且**不报错**。记下来，结束时如实说一句 —— 不说的话用户拿到
    //   一条卡住的坏片，只会以为是生成质量的问题。
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        wentHiddenRef.current = true;
        setHiddenWarn(true);
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    let audioCtx: AudioContext | null = null;
    try {
      // ★ 老草稿自救：还是方舟直链的段先转存成永久地址（服务端拉，全球 CDN）。
      //   出片那一刻的转存 2026-08-20 才上线，在那之前炼的段揣的还是 TOS 直链 ——
      //   跨境网络下 120s 代理抓取拉不完 20MB，合并必超时（真机实拍）。转存失败不挡合并，
      //   照旧走代理抓取碰运气，resolveMediaUrl 的超时文案会说人话。
      let mergeSegs = segs;
      const arkAt = segs.map((s, i) => (isArkAssetUrl(s.videoUrl) ? i : -1)).filter((i) => i >= 0);
      if (arkAt.length > 0) {
        const next = segs.slice();
        for (const i of arkAt) {
          setBusy(`第 ${i + 1} 段成片转存中（换成永久地址）…`);
          try {
            next[i] = { ...next[i], videoUrl: await transferArkVideo(next[i].videoUrl!) };
          } catch {
            /* 见上：失败照旧 */
          }
        }
        mergeSegs = next;
        // 写回草稿：预览、重试合并、发布都用转存后的地址，别让下一步再拉一次跨境
        useStudio.setState({ draft: { ...draft!, segments: next } });
        // 跨境转存的成果，不值得再拉一遍
        void useStudio.getState().persistCutDraft();
      }
      // ★ 音轨与画布准备是**同步长活**（预置的原片音轨是整条原视频，几十 MB、跨境要十几秒）：
      //   不先点亮 busy 的话，这段时间按钮亮着、屏幕上一个字都没有 = 用户眼里的"点了没反应"
      setBusy("准备音轨与画布…");
      const canvas = document.createElement("canvas");
      canvas.width = out.w;
      canvas.height = out.h;
      const ctx = canvas.getContext("2d")!;
      const stream = canvas.captureStream(30);
      let mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
      // 音频轨：解码 → 循环播放进 MediaStreamDestination，与画布流合成一条带声成片
      if (audio) {
        // ★★ 音轨拉不到**不许拖垮整条成片**（2026-08-21 对抗评审确认）：这一句原来
        //   裸在大 try 里，一抛就整条导不出，而错误话里一个字都不提是音轨的锅 ——
        //   用户以为片子坏了。而它恰恰是最容易失败的一环：预置的「原视频音轨」是
        //   Cloudinary 上那条**完整原片**（几十 MB），跨境拉超时/断流是实测会发生的事。
        //   就地兜住：说清是音轨没拿到、这一条按无声导出，别让人白等一场重录。
        let buf: AudioBuffer | null = null;
        try {
          audioCtx = new AudioContext();
          buf = await audioCtx.decodeAudioData(await (await fetch(audio.url)).arrayBuffer());
        } catch (e) {
          console.warn("[cut] 音轨取不到:", e);
          setErr(`音轨没能取下来（${audio.name}）——这一条先按无声导出。想要声音就换一条本地音频，或等网络好些再重试合并。`);
          if (audioCtx) {
            void audioCtx.close().catch(() => {});
            audioCtx = null;
          }
        }
        if (buf && audioCtx) {
          const dest = audioCtx.createMediaStreamDestination();
          const srcN = audioCtx.createBufferSource();
          srcN.buffer = buf;
          srcN.loop = true; // BGM 短于成片时循环补齐
          const g = audioCtx.createGain();
          g.gain.value = audio.volume;
          srcN.connect(g);
          g.connect(dest);
          for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
          srcN.start();
          mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
        }
      }
      const rec = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: res.id === "1080" ? 10_000_000 : 6_000_000,
      });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      const stopped = new Promise<void>((r) => {
        rec.onstop = () => r();
      });
      // ★★ **开录之前先把画布画成"有内容的一帧"**（2026-09-03 核 backlog 那条 AIGC 角标时抓到）。
      //   时序：`captureStream(30)` 早在上面就挂上了，`rec.start()` 在这一行，而第一次
      //   `drawCover + drawAigcBadge` 要等到循环里 —— 那之前还有 `resolveMediaUrl`（走网络、
      //   带重试）与 `<video>` 的 load/seek 等待，**秒级**。这中间录进去的是透明/黑帧，
      //   **而且没有 AIGC 角标**。
      //   角标是法规要求的 AI 生成标识：成片开头那几帧没有它，等于那几帧是**没标识的**
      //   AI 生成内容。而它零报错、也不会在预览里被注意到（开头黑一下像是加载）。
      //   ⚠ 底色要自己铺：画布初始是透明的，编码器把它压成黑帧，但角标的半透明底衬
      //   在透明画布上读不出来 —— 铺一层黑再画，第 0 帧就是合规的。
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawAigcBadge(ctx, canvas.width, canvas.height);
      rec.start(250);
      for (let i = 0; i < view.length; i++) {
        // ★★ 取消要在**每一段开头**也判（2026-08-30 复核抓到）：rAF 里那两处只结束
        //   「当前这一段」，不 break 的话剩下每段照样 setBusy(`合并中 · 片段 i/N`)
        //   把按钮写的「正在停止…」顶掉、照样把进度条推到下一格，还要照样去
        //   resolveMediaUrl（它失败是**抛**不是返回 null，带重试，最坏 2×120s）——
        //   那些异常落进外层 catch，于是用户点的是「取消」、收到的却是「合并失败：取媒体超时」。
        //   我上次实测取消"停下来了"，是因为那条稿子只剩最后一段，正好掩住了这个洞。
        if (cancelRef.current) break;
        const clip = view[i];
        const seg = mergeSegs[clip.segIndex];
        const doneBefore = view.slice(0, i).reduce((sum, x) => sum + clipDur(x), 0);
        setMergeDone(doneBefore);
        setBusy(`合并中 · 片段 ${i + 1}/${view.length}`);
        if (seg.videoUrl) {
          const src = srcMap[clip.segIndex] ?? (await resolveMediaUrl(seg.videoUrl, { forCapture: true }));
          if (!src) throw new Error(`片段 ${i + 1} 视频取不到`);
          const v = document.createElement("video");
          v.muted = true;
          v.playsInline = true;
          v.src = src;
          // ★★ 这两个等待也要带上限（2026-08-31 补，同 VideoCardAnnotator 那两处）：
          //   合并是几十秒的实时录制，用户很容易在中途切出去；窗口不可见时解码被挂起，
          //   `canplaythrough` / `seeked` 永远不到 ⇒ 卡死在「合并中 · 片段 i/N」。
          //   ⚠ 循环开头那道 `cancelRef` 闸救不了这里 —— 卡在 await 里，取消轮不到判。
          //   超时按**失败**处理而不是硬往下走：往下走会把一段没解码好的画面录进成片，
          //   而这条路的产物直接进发布页、本页没有撤销。
          await new Promise<void>((resolve, reject) => {
            v.oncanplaythrough = () => resolve();
            v.onerror = () => reject(new Error(`片段 ${i + 1} 加载失败`));
            window.setTimeout(() => reject(new Error(`片段 ${i + 1} 载入超时（切到后台时视频会停止解码，回到这一页再试）`)), 60_000);
            v.load();
          });
          v.currentTime = clip.start;
          await new Promise<void>((resolve, reject) => {
            v.onseeked = () => resolve();
            window.setTimeout(() => reject(new Error(`片段 ${i + 1} 定位超时（切到后台时视频会停止解码，回到这一页再试）`)), 30_000);
          });
          await v.play();
          await new Promise<void>((resolve) => {
            const draw = () => {
              // ★ 取消要在**循环里**判：rAF 跑着的时候没有别的地方能打断它
              if (cancelRef.current || v.ended || v.currentTime >= clip.end) {
                v.pause();
                resolve();
                return;
              }
              drawCover(ctx, v, canvas.width, canvas.height);
              drawAigcBadge(ctx, canvas.width, canvas.height);
              setMergeDone(doneBefore + Math.max(0, v.currentTime - clip.start));
              requestAnimationFrame(draw);
            };
            draw();
          });
        } else {
          const [a, b] = await Promise.all([loadImg(seg.firstFrame), loadImg(seg.lastFrame)]);
          const t0 = performance.now();
          const dur = clipDur(clip) * 1000;
          await new Promise<void>((resolve) => {
            const draw = () => {
              const p = Math.min(1, (performance.now() - t0) / dur);
              drawCover(ctx, a, canvas.width, canvas.height);
              ctx.globalAlpha = p * p * (3 - 2 * p);
              drawCover(ctx, b, canvas.width, canvas.height);
              ctx.globalAlpha = 1;
              drawAigcBadge(ctx, canvas.width, canvas.height);
              setMergeDone(doneBefore + (p * dur) / 1000);
              if (cancelRef.current) {
                resolve();
                return;
              }
              if (p >= 1) {
                resolve();
                return;
              }
              requestAnimationFrame(draw);
            };
            draw();
          });
        }
      }
      rec.stop();
      await stopped;
      // ★ 取消：录到一半的这段不写库、不跳页。用户要的是"别录了"，不是"录个半截给我"
      if (cancelRef.current) {
        setBusy("");
        setErr("已取消合并。片段、圈选和配乐都还在，随时可以重新开始。");
        return;
      }
      // ★★ 切走过就**如实说**，别把一条卡住的坏片当成品交出去（铁律八）。
      //   不拦着他继续（片子已经录出来了，也许还能用），但那句话必须说在前面。
      if (wentHiddenRef.current) {
        setErr("合并过程中 App 被切到后台过——那段时间画面不会更新，成片里多半有一截是卡住的。建议回来重新合并一次（不花 token）。");
      }
      setBusy("写入本地库…");
      const blob = new Blob(chunks, { type: mime });
      const key = `merged:${uid("mv")}`;
      if (!(await idbSet(key, blob))) throw new Error("成片写入本地库失败（存储配额？）");
      const orderedPlots = [...new Set(view.map((c) => segs[c.segIndex].plot))];
      const first = segs[view[0].segIndex];
      const last = segs[view[view.length - 1].segIndex];
      const merged: VideoSegment = {
        title: "成片",
        plot: orderedPlots.join("\n"),
        firstFrame: first.firstFrame,
        lastFrame: last.lastFrame,
        durationSec: Math.round(total),
        videoUrl: `idb:${key}`,
        // 合并后就只剩这一段了：画幅必须跟着走，否则首页拿不到画幅提示，
        // 而且回炉重制时新拍的段会退回默认画幅
        aspect: segs[0]?.aspect,
      };
      leftRef.current = true;
      useStudio.setState({ draft: { ...draft!, segments: [merged], branchTree: undefined, merged: true } });
      // ★★ 这一拍把 `idb:merged:` 指针钉到盘上 —— 在此之前那条几十 MB 的成片
      //   **只被内存里的 store 引用着**，磁盘上找不到任何指针（cacheSweep 文件头记的
      //   正是这个洞，它靠 24h 时间闸门兜着）。实时录制几分钟的成果，不能只活在内存里。
      // ★ 合并那一拍的回执也要判（模块契约就是这么写的）：这时候刚录完几分钟的成片，
      //   指针只在内存里 —— 存不住而不吭声，正是最贵的那种静默失败
      const cutWhy = await useStudio.getState().persistCutDraft();
      if (cutWhy) setErr(`成片已经合好了，但${cutWhy}`);
      navigate("/publish");
    } catch (e) {
      // ★ 取消可能正好按在某一段的 await 中途（取流/加载/播放）——那时抛出来的异常
      //   是"因为取消"，不是失败。报成失败就是对用户说了假话（铁律八）。
      if (cancelRef.current) {
        setErr("已取消合并。片段、圈选和配乐都还在，随时可以重新开始。");
      } else {
        setErr(`合并失败：${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
      }
    } finally {
      void audioCtx?.close().catch(() => {});
      setBusy("");
      document.removeEventListener("visibilitychange", onHidden);
      mergingRef.current = false;
    }
  }

  const TABS: Array<{ id: Tab; label: string; badge?: number }> = [
    { id: "cut", label: "剪辑" },
    { id: "mark", label: "圈选", badge: anns.length || undefined },
    { id: "audio", label: "音频", badge: audio ? 1 : undefined },
  ];

  return (
    <div className="fixed inset-0 flex flex-col bg-black">
      {/* ── 顶栏 ── */}
      <header className="safe-top flex flex-none items-center gap-3 px-4 py-3">
        <button
          onClick={() => {
            // 单段编辑的返回 = 放弃这次改动（不写回方案），得先把单段草稿清掉，
            // 否则那份一段的 draft 会被后面的组稿流程当成真草稿
            if (segEdit) {
              leftRef.current = true;
              useStudio.getState().closeSegmentEdit(false);
              navigate("/studio");
            } else navigate(-1);
          }}
          className="text-slate-200"
        >
          <Icon name="back" size={22} />
        </button>
        <HelpButton tour="cut" />
        <div className="flex-1" />
        <div className="relative">
          <button
            onClick={() => setResOpen((v) => !v)}
            className="flex items-center gap-1 rounded-lg bg-slate-700/70 px-3 py-1.5 text-sm font-semibold text-slate-100"
          >
            {res.label}
            <span className="text-[10px]">▾</span>
          </button>
          {resOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-slate-700 bg-ink">
              {RESOLUTIONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    setResId(r.id);
                    setResOpen(false);
                  }}
                  className={`block w-full px-3 py-2 text-left ${r.id === resId ? "bg-slate-700/50" : ""}`}
                >
                  <div className="text-xs font-semibold text-slate-100">
                    {r.label}
                    <span className="ml-1 font-normal tabular-nums text-slate-400">
                      {outSize(r.long, portrait).w}×{outSize(r.long, portrait).h}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400">{r.note}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* 单段编辑模式（从节点卡的「编辑本段」进来）不合并不发片：
            改完写回这一段的方案，并把改好的尾帧交给下一段当起拍帧，然后回工坊 */}
        {segEdit ? (
          <button
            data-guide="cut-next"
            onClick={() => {
              leftRef.current = true;
              useStudio.getState().closeSegmentEdit(true);
              navigate("/studio");
            }}
            disabled={!!busy}
            className="rounded-lg bg-brand px-4 py-1.5 text-sm font-bold text-ink disabled:opacity-45"
          >
            保存本段
          </button>
        ) : (
          <button
            data-guide="cut-next"
            onClick={() => void mergeAndGo()}
            disabled={!!busy}
            className="rounded-lg bg-brand px-4 py-1.5 text-sm font-bold text-ink disabled:opacity-45"
          >
            下一步
          </button>
        )}
      </header>

      {/* ── 预览区 ── */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {activeSeg?.videoUrl ? (
            playSrc ? (
              <video
                key={`${active!.id}:${playSrc}`}
                ref={vref}
                src={playSrc}
                muted
                playsInline
                className="max-h-full max-w-full"
                // ★ 播放器自己的失败也要上屏（地址过期 / 解码失败），否则又是一块沉默的黑
                onError={(e) => {
                  const code = e.currentTarget.error?.code;
                  setPlayErr(`这一段播不出来（错误码 ${code ?? "?"}）——成片地址可能已经过期或网络不通，回工作流重新打开草稿会重新取一遍`);
                }}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  v.currentTime = pendingSeek.current ?? active!.start;
                  pendingSeek.current = null;
                  if (playing) void v.play().catch(() => {});
                }}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  setT(v.currentTime);
                  // 到达片段出点：跳下一片段接着播（时间轴顺序），最后一个则停
                  if (active && v.currentTime >= active.end - 0.03) {
                    if (activeIdx + 1 < view.length) {
                      pendingSeek.current = view[activeIdx + 1].start;
                      setActiveIdx(activeIdx + 1);
                    } else {
                      // ★ 播到时间轴末尾：**连 BGM 一起停**。只停 video 的话音乐会一直循环，
                      //   而 togglePlay 判的是 v.paused（已经是暂停态）—— 再也停不下来
                      stopPlayback();
                    }
                  }
                }}
                onClick={togglePlay}
              />
            ) : (
              <span className="text-xs text-slate-500">视频载入中…</span>
            )
          ) : activeSeg ? (
            <img src={activeSeg.poster || activeSeg.firstFrame} alt="" className="max-h-full max-w-full" />
          ) : null}
        </div>
        {/* 取流/播放失败一律说在预览正下方（用户正盯着的那块），并给一条真能走的路 */}
        {activeSeg?.videoUrl && (playErr || srcErr[active!.segIndex]) && (
          <div className="mx-3 mb-1 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-rose-200">
            {playErr && <p>{playErr}</p>}
            {srcErr[active!.segIndex] && (
              <p>
                圈选与合并要用的截帧流没取到：{srcErr[active!.segIndex]}
                <button
                  onClick={() => loadCaptureSrc(active!.segIndex, activeSeg.videoUrl!)}
                  className="ml-2 rounded bg-rose-500/30 px-2 py-0.5 font-semibold text-rose-100"
                >
                  重试
                </button>
              </p>
            )}
          </div>
        )}

        {/* 时间码 + 播放键（对齐参考稿：时间码贴左，播放键居中） */}
        <div className="relative flex flex-none items-center px-4 py-2.5">
          <span className="text-sm tabular-nums text-white">
            {formatDuration(playhead)}
            <span className="text-slate-500"> / {formatDuration(total)}</span>
          </span>
          <button
            onClick={togglePlay}
            className="absolute left-1/2 -translate-x-1/2 text-white"
            aria-label={playing ? "暂停" : "播放"}
          >
            <Icon name={playing ? "pause" : "play"} size={26} filled />
          </button>
        </div>

        {/* 全局播放头 */}
        <input
          type="range"
          min={0}
          max={Math.max(0.01, total)}
          step={0.03}
          value={Math.min(playhead, total)}
          onChange={(e) => seekGlobal(Number(e.target.value))}
          className="mx-4 mb-2 flex-none accent-brand"
        />

        {busy && (
          // ★ 合并时这一层**不能**是 pointer-events-none：取消键在里面
          <div className={`absolute inset-0 flex items-center justify-center bg-black/70 ${mergingRef.current ? "" : "pointer-events-none"}`}>
            <div className="flex w-full max-w-[16rem] flex-col items-center gap-3 px-6">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-brand" />
              <span className="text-center text-xs text-slate-200">{busy}</span>
              {/* ★★ 合并是**实时录屏**：成片多长就录多长。原来只有一句「片段 i/N」，
                  十几秒才跳一次 —— 用户既不知道还要多久，也不知道是不是卡死了。
                  这里给的是**真百分比**（已录秒数 / 成片总秒数）。 */}
              {mergingRef.current && total > 0 && (
                <>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-white/15">
                    <div
                      className="h-full rounded-full bg-brand transition-all duration-200"
                      style={{ width: `${Math.min(100, Math.round((mergeDone / total) * 100))}%` }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums text-slate-400">
                    {Math.min(100, Math.round((mergeDone / total) * 100))}% · 还剩约{" "}
                    {formatDuration(Math.max(0, total - mergeDone))}
                  </span>
                  {/* ★★ 这句要说在**前面**，不是事后：合并期间切走，画面不会更新
                      （不可见时 `<video>` 不解码、rAF 被节流到约 1 帧/500ms），
                      而且不报错 —— 用户会拿到一条有一截卡住的成片。 */}
                  <p className={`text-center text-[10px] leading-relaxed ${hiddenWarn ? "text-rose-300" : "text-slate-500"}`}>
                    {hiddenWarn
                      ? "刚才切到后台了——那段时间的画面没录上，建议取消后重来"
                      : "别切到别的应用：这一步是实时录屏，切走那几秒会录成卡住的画面"}
                  </p>
                  <button
                    onClick={() => {
                      cancelRef.current = true;
                      setBusy("正在停止…");
                    }}
                    className="rounded-full border border-slate-500 px-4 py-1.5 text-[11px] text-slate-200"
                  >
                    取消合并
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── 底部工具面板 ── */}
      {/* ★★ B18：选了 1080P 就**常驻**说明它不会更清晰（2026-08-30）。
          我们的素材只有 720P，1080P 是放大出来的 —— 而这句话原来只写在下拉项里，
          点完就看不见了。在最后一步给一个会误导的选项、又把唯一的说明藏起来，
          等于让用户为一个更大的文件多等一倍时间还以为画质更好了。 */}
      {res.id !== "720" && (
        <div className="flex-none bg-amber-500/10 px-4 py-1 text-center text-[10px] leading-relaxed text-amber-200/90">
          {res.label} 是由 720P 素材放大的 —— 文件更大、合并更久，但<b className="text-amber-100">不会</b>更清晰
        </div>
      )}

      {/* ★ B20：面板高度随内容走，不再固定 46%。
          固定值的代价是两头都不舒服：3 个片段时浪费近一半屏，而「圈选」这一页
          恰恰是最需要大画面的（要看清要圈的东西）。
          ⚠ 只改高度上限，不动"面板收起时 `<video>` 会不会进不可见状态"那条 ——
            圈选取帧走的正是"等 seeked"那条路，画面真被隐藏就永远等不到。 */}
      <div
        className={`safe-bottom flex flex-none flex-col border-t border-slate-800 bg-[#141821] ${
          tab === "mark" ? "max-h-[38%]" : "max-h-[52%]"
        }`}
      >
        <div data-guide="cut-tabs" className="flex flex-none items-center justify-center gap-7 px-4 pt-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative pb-1.5 text-sm ${
                tab === t.id ? "border-b-2 border-brand font-bold text-white" : "text-slate-400"
              }`}
            >
              {t.label}
              {t.badge != null && (
                <span className="absolute -right-3.5 -top-0.5 rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
          {err && (
            <div className="mb-2.5 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              <span className="min-w-0 flex-1">{err}</span>
              <button onClick={() => setErr("")} className="flex-none">
                <Icon name="close" size={14} />
              </button>
            </div>
          )}

          {tab === "cut" && (
            <>
              <div className="mb-1.5 flex items-center justify-between text-[10px] text-slate-500">
                <span>{view.length} 个片段 · 共 {formatDuration(total)}</span>
                <span>拖拽换序 · 点击选中</span>
              </div>
              <div data-guide="cut-timeline" className="flex gap-1 overflow-x-auto rounded-xl bg-black/40 p-1.5">
                {view.map((c, i) => {
                  const seg = segs[c.segIndex];
                  const isSel = sel === c.id;
                  const isActive = i === activeIdx;
                  const nAnn = annBySeg.get(c.segIndex) ?? 0;
                  return (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={() => {
                        dragClip.current = c.id;
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        const from = dragClip.current;
                        if (!from || from === c.id) return;
                        setClips((cs) => {
                          const fi = cs.findIndex((x) => x.id === from);
                          const ti = cs.findIndex((x) => x.id === c.id);
                          if (fi < 0 || ti < 0) return cs;
                          const next = cs.slice();
                          const [moved] = next.splice(fi, 1);
                          next.splice(ti, 0, moved);
                          return next;
                        });
                      }}
                      onDragEnd={() => {
                        dragClip.current = null;
                      }}
                      onClick={() => {
                        setSel(c.id);
                        pendingSeek.current = c.start;
                        setActiveIdx(i);
                      }}
                      style={{ width: `${Math.max(11, (clipDur(c) / Math.max(0.01, total)) * 100)}%` }}
                      className={`relative min-w-[68px] flex-none cursor-grab overflow-hidden rounded-lg border-2 ${
                        isSel ? "border-brand" : isActive ? "border-cyan-400/70" : "border-transparent"
                      }`}
                    >
                      {/* 白模/直出段可能两张图都没有：空串 src 会让浏览器把整页再请求一遍，不如画个底 */}
                      {seg.poster || seg.firstFrame ? (
                        <img src={seg.poster || seg.firstFrame} alt="" className="h-14 w-full object-cover" draggable={false} />
                      ) : (
                        <div className="h-14 w-full bg-ink/60" />
                      )}
                      <span className="absolute left-1 top-0.5 rounded bg-black/65 px-1 text-[9px] text-slate-200">
                        段{c.segIndex + 1} · {clipDur(c).toFixed(1)}s
                        {/* ★ 裁过要看得出来：否则"这段怎么短了"只能靠回忆，而裁剪是可还原的 */}
                        {(c.start > 0.01 || c.end < seg.durationSec - 0.01) && <span className="ml-0.5">✂</span>}
                      </span>
                      {nAnn > 0 && (
                        <span className="absolute right-1 top-0.5 rounded-full bg-rose-500/90 px-1 text-[9px] font-bold text-white">
                          ⭕{nAnn}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button
                  onClick={splitAtPlayhead}
                  disabled={!sel}
                  className="rounded-lg bg-slate-700/70 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-35"
                >
                  ✂️ 播放头处分割
                </button>
                <button
                  onClick={() => sel && moveClip(sel, -1)}
                  disabled={!sel}
                  className="rounded-lg bg-slate-700/70 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-35"
                >
                  ◀ 前移
                </button>
                <button
                  onClick={() => sel && moveClip(sel, 1)}
                  disabled={!sel}
                  className="rounded-lg bg-slate-700/70 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-35"
                >
                  后移 ▶
                </button>
                <button
                  onClick={() => sel && removeClip(sel)}
                  disabled={!sel || view.length <= 1}
                  className="rounded-lg bg-rose-500/15 px-2.5 py-1.5 text-[11px] text-rose-300 disabled:opacity-35"
                >
                  🗑 删除片段
                </button>
              </div>
              {/* 裁头裁尾。★★ 补它是因为 `Clip.start/end` 一直支持裁剪、UI 上却只有分割，
                  而删除在只剩一个片段时是灰的 ⇒ 简约模式出来的**单段作品根本裁不了**。
                  ★ 单独一排：上面那排是"这一段与别的段的关系"（切开/换位/删掉），
                    这一排是"这一段自己留哪一截"，混在一起点错的代价不一样。 */}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => trimTo("start")}
                  disabled={!sel}
                  className="rounded-lg bg-slate-700/70 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-35"
                >
                  ⇤ 从这里开始
                </button>
                <button
                  onClick={() => trimTo("end")}
                  disabled={!sel}
                  className="rounded-lg bg-slate-700/70 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-35"
                >
                  到这里结束 ⇥
                </button>
                {/* 只在**真裁过**时才出现：没裁过的时候它是一颗永远没反应的键 */}
                {(() => {
                  const t = view.find((c) => c.id === sel);
                  const seg = t && segs[t.segIndex];
                  // ★ 「分割出来的」不算"裁过"：两半的 start/end 天然不等于整段，
                  //   照这个表达式判会把分割也标成裁剪、并摆出一颗按下去必被拒的「还原整段」。
                  const hasSibling = !!t && view.some((c) => c.id !== t.id && c.segIndex === t.segIndex);
                  const trimmed =
                    !!t && !!seg && !hasSibling && (t.start > 0.01 || t.end < seg.durationSec - 0.01);
                  return trimmed ? (
                    <button
                      onClick={resetTrim}
                      className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-[11px] text-slate-300"
                    >
                      还原整段
                    </button>
                  ) : null;
                })()}
              </div>
              {!sel && <p className="mt-1.5 text-[10px] text-slate-500">先点上面的片段选中，再用这排按钮</p>}
            </>
          )}

          {tab === "mark" && (
            <>
              <button
                onClick={openAnnotator}
                disabled={!!busy}
                className="w-full rounded-xl bg-slate-700/70 py-2.5 text-sm font-semibold text-slate-100 disabled:opacity-40"
              >
                ⭕ 圈选当前这一帧
              </button>
              {/* 一句精华，展开讲在引导（tours 的 cut）里 */}
              <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                可跨帧跨段圈多处，最后一次性重新生成——那一步才计费。
              </p>
              {anns.length > 0 && (
                <>
                  <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1">
                    {anns.map((a) => {
                      // 这一处圈选所在的段还在不在成片里（删掉的段上那些不计价也不重拍）
                      const live = liveSegs.has(a.segIndex);
                      return (
                      <div
                        key={a.id}
                        className={`relative w-32 flex-none overflow-hidden rounded-lg bg-black/40 ${live ? "" : "opacity-40"}`}
                      >
                        <img src={a.frame} alt="" className="h-16 w-full object-cover" />
                        <div className="truncate px-1.5 py-1 text-[10px] text-slate-300" title={a.req}>
                          {live ? `段${a.segIndex + 1}` : "段已删"} · {a.req}
                        </div>
                        <button
                          onClick={() => setAnns((l) => l.filter((x) => x.id !== a.id))}
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[10px] text-slate-200"
                        >
                          ✕
                        </button>
                      </div>
                      );
                    })}
                  </div>
                  {/* ★ 数与钱都只认还在成片里的那些（见 liveAnns 的 ★★）。
                      被删段上的圈选留在上面那一排里、灰着，但不进这颗按钮 —— 直接抹掉
                      会让用户以为是自己点错删了圈选。 */}
                  <button
                    onClick={() => void regenerateAll()}
                    disabled={!!busy || liveAnns.length === 0}
                    className="mt-2 w-full rounded-xl bg-cyan-500/85 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
                  >
                    ✨ 按 {liveAnns.length} 处圈选重新生成（{annBySeg.size} 段 · {fmtTokens(annCost)}）
                  </button>
                  {liveAnns.length < anns.length && (
                    <p className="mt-1 text-center text-[10px] text-slate-500">
                      另有 {anns.length - liveAnns.length} 处落在已删掉的段上，不计费也不会重拍
                    </p>
                  )}
                </>
              )}
            </>
          )}

          {tab === "audio" &&
            (audio ? (
              <div className="flex items-center gap-2.5 rounded-xl bg-black/40 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-xs text-slate-200">🎵 {audio.name}</span>
                <span className="flex-none text-[10px] text-slate-500">音量</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={audio.volume}
                  onChange={(e) => setAudio({ ...audio, volume: Number(e.target.value) })}
                  className="w-24 flex-none accent-brand"
                />
                <button
                  onClick={() => {
                    URL.revokeObjectURL(audio.url);
                    setAudio(null);
                  }}
                  className="flex-none text-rose-300"
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
            ) : (
              <>
                <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-slate-600 py-3 text-xs text-slate-400 hover:border-brand">
                  ＋ 添加本地音频作为 BGM
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) setAudio({ name: f.name, url: URL.createObjectURL(f), volume: 0.8 });
                    }}
                  />
                </label>
                {/* 「AI 画面本身没声音」挪进了引导第一步——这里留操作性的那一句就够 */}
                <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                  合并时混进成片，短于成片会自动循环。
                </p>
              </>
            ))}
        </div>
      </div>

      {annOpen && (
        <FrameAnnotator
          frame={annOpen.frame}
          hint="先存起来，圈完所有要改的地方再一次性重新生成"
          onClose={() => setAnnOpen(null)}
          onSave={(frame, req) => {
            setAnns((l) => [...l, { id: uid("ann"), segIndex: annOpen.segIndex, atSec: annOpen.atSec, frame, req }]);
            setAnnOpen(null);
          }}
        />
      )}

    </div>
  );
}
