// 剪辑页（发布前的必经站）：全屏三段式布局，对标剪映/CapCut 的手机剪辑器——
//   顶栏：‹ 返回 · ? 说明 · 导出分辨率 · 下一步
//   中区：预览画面 + 时间码 + 播放键（画面之外全黑，注意力全在片子上）
//   底部：工具面板，三个页签
//        剪辑 —— 缩略图时间轴：选中/✂️分割/🗑删除/拖拽或◀▶换序
//        圈选 —— ⭕在任意帧圈出物体写要求，跨帧跨段累积，一键按全部要求重生成
//        音频 —— 本地 BGM，音量可调，合并时混进成片
// 最后「下一步」把时间轴按顺序与裁剪范围重编码成单条视频，进发布页。
//
// ★★ 时间轴 / 圈选 / 配乐 / 导出档位不是这一页的 useState，是一份**剪辑工程**（data/cutProject 的 CutProject，
//   运行时那一份在 studio/cutStore）：离开这一页再回来原样还在、随剪辑稿落盘、每一步都能撤销，
//   合并之后源段留底、可以「回去改」。这一页只管把它画出来、把手势翻成 cutProject 里的改法。
import { useEffect, useMemo, useRef, useState } from "react";
import Spinner from "../components/Spinner";
import { startJob } from "../data/jobs";
import { MAX_DIRECT_MEDIA_BYTES } from "../api/uploads";
import PageHeader from "../components/PageHeader";
import { useLocation, useNavigate } from "react-router";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import FrameAnnotator, { drawCover } from "../components/FrameAnnotator";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import Icon from "../components/Icon";
import { AI_REAL, ArkTaskFailed, ArkTaskUnknown, SegmentGenFailed, chargeNote, chargeOnFail, refineFrame, regenSegment, unwrapFailure } from "../ai";
import { ANN_CLAUSE } from "../studio/segmentGen";
import { isArkAssetUrl, requestArkTransfer, transferStatus } from "../ai/arkClient";
import { canAfford, frozenNote, isRemoteMode, spendTokens, tierBlockReason, walletOf } from "../data/account";
import { idbSet } from "../data/db";
import { dropVideoJob } from "../data/videoJobs";
import { ownerEpoch } from "../data/deviceOwner";
import { annRedrawCost, fmtTokens, segTokens, tierOf } from "../data/economy";
import { publishedExit, useStudio } from "../studio/studioStore";
import { useCut } from "../studio/cutStore";
import {
  BED_GAIN,
  BGM_DUCK,
  SPEEDS,
  TITLE_MAX_CHARS,
  addAnn,
  clipEnd,
  clipOutDur,
  clipSpeed,
  clipTrimmed,
  clipVolume,
  compileTimeline,
  dropAnnsOfSeg,
  hasSibling,
  LINE_MAX_CHARS,
  lineCap,
  lineUnits,
  markMerged,
  moveClip as moveClipOp,
  removeAnn,
  removeClip as removeClipOp,
  missingSegs,
  reorderClip,
  resetClip,
  restoreSeg,
  sanitizeClips,
  seamContinuous,
  segSig,
  setAudio as setAudioOp,
  setAudioVolume,
  setCaptionsOn,
  setClipFade,
  setClipLine,
  setClipSpeed,
  setClipVoice,
  setClipVolume,
  setEndFade,
  setRes,
  setTitle,
  setVoiceId,
  splitClip,
  timelinePlan,
  timelineTouched as timelineTouchedOf,
  trimClip,
  voiceStale,
  type CutAnn,
  type CutClip,
  type CutProject,
  type CutResult,
} from "../data/cutProject";
import { NarrationError, listNarrators, narratorOf, synthLine, type Narrator } from "../studio/cutNarration";
import CutPreviewLayer from "../components/cut/CutPreviewLayer";
import AutoEditSheet from "../components/cut/AutoEditSheet";
import CutAgentSheet from "../components/cut/CutAgentSheet";
import { AUTO_EDIT } from "../studio/cutAutoEdit";
import { runCutAgent, type CutAgentCtx, type CutAgentOutcome } from "../studio/cutAgent";
import { cutIssueText } from "../studio/cutIssues";
import { VideoSegment, aspectOf, formatDuration, segLen, uid } from "../types";
import { resolveMediaUrl, useMediaUrl } from "../utils/mediaUrl";
import { captureVideoFrame, loadVideoAt, probeDuration } from "../utils/videoFrames";
import { Capacitor } from "@capacitor/core";
// 合并走原生硬件编解码器（见 utils/nativeMerge 头部的 ★★）
import {
  cancelNativeMerge,
  mergeSupported,
  mergeUnsupportedText,
  mergedFileToBlob,
  runNativeMerge,
  stageLocalAudio,
  type MergeClip,
  type MergeVoice,
} from "../utils/nativeMerge";
import { aigcBadgeSpec } from "../data/aigcLabel";

/** 时间轴上的一个片段 / 一处圈选 —— 形状在 data/cutProject（这一页原来各自定义过一份，已收过去） */
type Clip = CutClip;
type Ann = CutAnn;

/**
 * 已经合好的稿子：时间轴上只有成片这一条。
 * ★ 这时**不能**拿工程里的片段表来画 —— 那张表指的是合并之前的源段（留底在 project.merged.sources），
 *   而稿子的 segments 已经换成了单段成片，按下标去取会取到成片头上。
 */
const MERGED_CLIPS: Clip[] = [{ id: "merged", segIndex: 0, start: 0 }];
// 稳定的空数组：没有工程的那几拍别每次渲染都给 useMemo 一个新引用
const NO_CLIPS: Clip[] = [];
const NO_ANNS: Ann[] = [];

/** 导出档位。存的是【长边】像素而不是写死的 w×h：竖屏 720P 是 720×1280，
 *  横屏是 1280×720——写死 1280×720 的话，竖屏成片会被 drawCover 拦腰裁成横的。 */
const RESOLUTIONS: Array<{ id: string; label: string; long: number; note: MessageDescriptor }> = [
  { id: "720", label: "720P", long: 1280, note: msg`与素材同分辨率，最快` },
  { id: "1080", label: "1080P", long: 1920, note: msg`由 720P 素材放大，文件更大但不会更清晰` },
];

/** 档位 + 画幅 → 输出画布尺寸 */
function outSize(long: number, portrait: boolean): { w: number; h: number } {
  const short = Math.round((long * 9) / 16);
  return portrait ? { w: short, h: long } : { w: long, h: short };
}

type Tab = "cut" | "text" | "mark" | "audio";

export default function CutPage() {
  const navigate = useNavigate();
  const { t } = useLingui();
  const draft = useStudio((s) => s.draft);
  const segEdit = useStudio((s) => s.segEdit);
  /**
   * 模板原声的地址（组稿那一拍算的，见 studioStore.draftAudioHint）。
   * ★ 音频页签靠它摆一颗**可点的候选** —— 在这之前那一页只有"挑本地文件"一个入口：
   *   预置一旦被 ✕ 掉、或者一开始就没预置上（取回段 / 老剪辑稿），用户**没有任何办法**
   *   把模板原声拿回来，而屏幕上也没有一个字提过它曾经存在。
   */
  const audioHint = useStudio((s) => s.draftAudioHint);
  const segs = draft?.segments ?? [];
  /**
   * 这条稿子**已经合好了**（`merged:true` 是合并那一拍写的，`idb:` 兜住老稿子）。
   *
   * ★★ 为什么必须单列一格（2026-09-07 核查抓到，主人当时正踩在上面）：合并产物的地址是
   *   `idb:merged:…`，而 mergeAndGo 里那道 `^https?:` 闸会把它判成"还没转存"，抛出
   *   「第 N 段还不是永久地址，合成用不了——**回到工作流等它转存完再来**」——
   *   而这条出路**根本不存在**：片子已经合好了，没有什么可等的，工作流也早被 reset 清空了。
   *   于是从个人页「接着剪」回来的成片**再也发不出去**，屏幕上还指着一个假出口。
   *   ⇒ 已经合好的稿子这一步不该是"合并"，而是**直接去发布**。
   */
  const alreadyMerged = !!draft?.merged || (segs.length === 1 && (segs[0]?.videoUrl || "").startsWith("idb:"));

  /**
   * 剪辑工程（见文件头的 ★★）。进页时由下面那个 effect 对上稿子（cutStore.ensure）；
   * 已经合好的稿子没有留底时它是 null，那时这一页只剩「去发布」。
   */
  const project = useCut((s) => s.project);
  const canUndo = useCut((s) => s.past.length > 0);
  const canRedo = useCut((s) => s.future.length > 0);
  const clips = alreadyMerged ? MERGED_CLIPS : (project?.clips ?? NO_CLIPS);
  const anns = alreadyMerged ? NO_ANNS : (project?.anns ?? NO_ANNS);
  /** 合好的稿子还能不能回到合并之前接着改（工程里留着源段才行；2026-09-30 之前合的老稿没有） */
  const canReopen = alreadyMerged && !!project?.merged?.sources.length;
  const [sel, setSel] = useState<string | null>(null);
  const [annOpen, setAnnOpen] = useState<{ segIndex: number; atSec: number; frame: string } | null>(null);
  // ★ 分段模板组：默认把**原片音轨**预置进来（用户点名要的：白模复刻的成片保留原视频
  //   音频）。白模出片本身是无声的（**是 app 自己钉的** —— `arkClient.BLOCKOUT_TASK` 的
  //   `generate_audio:false`，版权拦截换来的；服务端那边 2026-08-15 起按模型能力放行，
  //   别再把它当成"服务端不让"），合并时从原片解音轨混进去。
  //   线索读 studioStore.draftAudioHint（搭草稿的车）：「完成视频」会清空 flow store，
  //   这里挂载时 nodes 已经空了（2026-08-20 dev 实测，读 flow 那版永远落空）。
  //   用户在音频 tab 随时能换掉/去掉，所以是"预置"不是"锁定"。
  // ★ 工程里记的只是「用的是预置那条 / 用户自己挑的那条」+ 音量（cutProject.CutAudio）：预置的地址读 audioHint，
  //   本地那条读本地库里的 blob。预置那条对不上地址（audioHint 没还原上）就当没有 —— 别摆一条点了没声音的配乐。
  const rawAudioSpec = alreadyMerged ? null : (project?.audio ?? null);
  const audioSpec = rawAudioSpec?.kind === "preset" && !audioHint ? null : rawAudioSpec;
  const localAudioRef = audioSpec?.kind === "local" ? audioSpec.ref : null;
  /** 本地那条配乐解析出来的可播地址。`failed` = 本地库里那份 blob 读不出来了（被清理过 / 库出了问题） */
  const [localAudio, setLocalAudio] = useState<{ ref: string; url: string | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!localAudioRef) {
      setLocalAudio(null);
      return;
    }
    // 存不进本地库时退成的会话内 blob: 地址：本身就能播，不用解析
    if (!localAudioRef.startsWith("idb:")) {
      setLocalAudio({ ref: localAudioRef, url: localAudioRef, failed: false });
      return;
    }
    let alive = true;
    setLocalAudio({ ref: localAudioRef, url: null, failed: false });
    void resolveMediaUrl(localAudioRef)
      .then((u) => {
        if (alive) setLocalAudio({ ref: localAudioRef, url: u, failed: !u });
      })
      .catch(() => {
        if (alive) setLocalAudio({ ref: localAudioRef, url: null, failed: true });
      });
    return () => {
      alive = false;
    };
  }, [localAudioRef]);
  /** 现在真能播 / 真能混进成片的那条配乐（地址已经解析好）。配乐还在解析、或者读不出来时是 null */
  const audioUrl =
    audioSpec?.kind === "preset" ? audioHint : localAudio && localAudio.ref === localAudioRef ? localAudio.url : null;
  const audioName = audioSpec ? (audioSpec.kind === "preset" ? t`原视频音轨` : audioSpec.name) : "";
  const audio = useMemo(
    () => (audioSpec && audioUrl ? { name: audioName, url: audioUrl, volume: audioSpec.volume } : null),
    [audioSpec, audioUrl, audioName],
  );
  const [tab, setTab] = useState<Tab>("cut");
  /** 正在合成配音的片段（id）：这几句的「配音」键转圈、不许重复点 */
  const [voicing, setVoicing] = useState<ReadonlySet<string>>(() => new Set());
  /** 正在试听哪一段的配音（片段 id） */
  const [auditioning, setAuditioning] = useState<string | null>(null);
  /** 「✨ 一键成片」的面板开着没有 */
  const [autoOpen, setAutoOpen] = useState(false);
  /** 「💬 对剪辑台说」的面板开着没有 */
  const [agentOpen, setAgentOpen] = useState(false);
  const auditionRef = useRef<HTMLAudioElement | null>(null);
  /** 可选的旁白音色（服务端目录，进「字幕」页签时取一次）。null = 还没取到 */
  const [narrators, setNarrators] = useState<Narrator[] | null>(null);
  const [narratorErr, setNarratorErr] = useState("");
  /** 配音要打服务端的语音合成：离线 / 演示构建里没有它（字幕照常能用） */
  const canVoice = isRemoteMode();
  useEffect(() => {
    if (tab !== "text" || narrators || !canVoice) return;
    let alive = true;
    listNarrators()
      .then((list) => {
        if (alive) setNarrators(list);
      })
      .catch((e) => {
        if (alive) setNarratorErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [tab, narrators, canVoice]);
  // 离开这一页：试听的那一句收声
  useEffect(
    () => () => {
      auditionRef.current?.pause();
    },
    [],
  );
  const resId = project?.resId ?? "720";
  const [resOpen, setResOpen] = useState(false);
  const [busy, setBusy] = useState("");
  /** 合并的防重入闸。★ 用 ref 不用 busy：setBusy 异步生效，挡不住同一帧内的第二次点击 */
  const mergingRef = useRef(false);
  /**
   * 合并进度（秒）。★★ 原来只显示「合并中 · 片段 i/N」——那会儿合并还是实时录屏：
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
  /**
   * 各段**实测**时长（秒）。★★ 申报时长（durationSec）只是下单时写的数：白模复刻 / 参考视频直出
   * 的成片长度跟着参考走（20 秒的模板出 20 秒的片），可片段出点一直按申报值铺 —— 2026-09-05 主人真机：
   * 20 秒的片子进剪辑页只剩 5 秒，合并也只录了 5 秒。出片时截帧那一步会把实测时长记进
   * segment.realDurationSec；没记上的（老草稿 / 截帧失败）在这里从播放器与截帧流的 metadata 里补。
   */
  const [realDur, setRealDur] = useState<Record<number, number>>({});
  const probedRef = useRef(new Set<number>());
  /**
   * 各段现在按多长算（实测优先，没实测过按 types.segLen）。片段的出点、时长、合成器那张表都拿它算
   * （cutProject 里的函数不自己算长度，由这里传进去）。
   */
  const lens = useMemo(() => segs.map((sg, i) => realDur[i] ?? segLen(sg)), [segs, realDur]);
  const lenOf = (i: number): number => lens[i] ?? 0;
  /** 这个片段在**成片**里占多长（变速之后）。时间轴总长、播放头、缩略图的宽度都按它算；下刀（分割 / 裁剪）按片内时间，不用它 */
  const durOf = (c: Clip): number => clipOutDur(c, lens);
  const endOf = (c: Clip): number => clipEnd(c, lens);
  /**
   * 学到一段的真实时长。
   * ★ 只记长度、不回头改片段：没裁过尾巴的片段出点是缺省的（= 片尾，见 cutProject.CutClip.end 的 ★★），
   *   长度一变它自己就跟着走。原来这里要把"出点还停在申报值上"的片段改写一遍。
   */
  function learnRealDur(i: number, real: number) {
    if (!Number.isFinite(real) || real <= 0) return;
    // ★ 量到了就记下来，哪怕它与申报值一样（2026-09-30 改：原来差不到 0.25 秒就不记）。「量过」本身是一条信息：
    //   闪黑与片尾收声只在每一段的长度都量过时才做（cutProject.timelinePlan 的 exact）—— 不记的话，
    //   申报 5 秒、实际也是 5 秒的普通段永远算"没量过"，转场就永远不出。同一个数再量到一次不重复写（别白白重渲染）
    setRealDur((m) => (m[i] !== undefined && Math.abs(m[i] - real) < 0.01 ? m : { ...m, [i]: real }));
  }
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
    // 换了一条视频（圈选重拍 / 稿子在合并前后翻面）：上一条量出来的长度不作数，新的截帧流到了再量一次
    probedRef.current.delete(i);
    setRealDur((m) => {
      if (!(i in m)) return m;
      const n = { ...m };
      delete n[i];
      return n;
    });
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

  // 截帧流一到就读一次 metadata 把实测时长学进来（播放器只在轮到那一段时才知道，而合并
  // 可能在那之前就开始）。★ 带超时、读完就释放；失败无所谓，播放器 / 合并那两处还会再学
  useEffect(() => {
    for (const [k, src] of Object.entries(srcMap)) {
      const i = Number(k);
      if (probedRef.current.has(i)) continue;
      probedRef.current.add(i);
      const v = document.createElement("video");
      v.muted = true;
      v.preload = "metadata";
      const timer = window.setTimeout(() => {
        v.src = "";
      }, 15_000);
      v.onloadedmetadata = () => {
        window.clearTimeout(timer);
        if (aliveRef.current) learnRealDur(i, v.duration);
        v.src = "";
      };
      v.onerror = () => window.clearTimeout(timer);
      v.src = src;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcMap]);

  /**
   * 眼前这份稿子的"身份"：没合（各段都在）/ 合好了（只剩单段成片）+ 各段的指纹（cutProject.segSig）。
   * 进页、合并那一拍、「回去改」那一拍、以及稿子被整个换成另一份时它会变 —— 变了就要重新对一次工程、
   * 重取各段的截帧流。圈选重拍与方舟直链转存只换成片地址，不动它。
   */
  const draftSig = useMemo(() => (draft ? `${alreadyMerged ? "m" : "s"}${segSig(segs)}` : ""), [draft, alreadyMerged, segs]);
  // 对上剪辑工程。
  // ★ 现有工程配得上这份稿子就原样留着（离开这一页又回来 / 个人页「接着剪」还原出来的），配不上才按稿子重开一份。
  //   合并与「回去改」都是**先改工程、再换稿子**（见 mergeAndGo 与 studioStore.reopenCut）：反过来的话，
  //   这里会在两步之间看到一份对不上的工程，把它当成别人的丢掉 —— 丢的是时间轴或者合并留底。
  // ★ 依赖里带着「现在有没有工程」：这一页挂着的时候工程被别处清掉（cutStore.load(null)）也要当场补开一份，
  //   否则时间轴上一个片段都没有、每一颗键都点不动，而屏幕上一个字都不说（2026-09-30 浏览器里实测撞到）
  const hasProject = !!project;
  useEffect(() => {
    if (!draft) return;
    useCut.getState().ensure(draft.segments, alreadyMerged, !!useStudio.getState().draftAudioHint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSig, hasProject]);
  // 稿子换了身份：选中与播放头归位，后台预取各段的截帧流（播放不等它，见 loadCaptureSrc 的 ★★）
  useEffect(() => {
    if (!draft) return;
    setSel(null);
    setActiveIdx(0);
    draft.segments.forEach((sg, i) => {
      if (sg.videoUrl) loadCaptureSrc(i, sg.videoUrl);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSig]);

  // 渲染用的片段列表：过滤掉指向不存在段的 clip。
  // 合并导出会把草稿换成"单段成片"，而 clips 还指着旧段号——zustand 的外部 store
  // 更新会同步重渲染本页，抢在 navigate 生效之前，于是 segs[c.segIndex] 为 undefined
  // 直接崩在 .firstFrame 上（实测控制台捕获到）。稳态下 view 与 clips 完全相同。
  const view = useMemo(() => clips.filter((c) => segs[c.segIndex]), [clips, segs]);
  /**
   * 时间轴动过没有（裁过 / 删过 / 换过序）。**判据只有 cutProject.timelineTouched 一处**：预置音轨会不会错位、
   * 提示要不要摆、合完之后那句话要不要说，读的都是它 —— 抄第二份必然与这份分叉。
   */
  const timelineTouched = useMemo(
    () => !alreadyMerged && !!project && timelineTouchedOf(project, segs.length),
    [alreadyMerged, project, segs.length],
  );

  /**
   * 各段**量出来的**真实长度（没量过的那一格是 undefined）—— 只给下面"收拾越界片段"用。
   * ★ 别拿 lens 顶替：lens 在没量过时退回申报值，而申报值比真实长度短得多的片子（白模复刻）上，
   *   按申报值收拾会把用户裁好的片段当成越界的毁掉（见 cutProject.sanitizeClips 的 ★★）。
   */
  const realLens = useMemo(() => segs.map((sg, i) => realDur[i] ?? sg.realDurationSec), [segs, realDur]);
  // 量到的长度变了（重拍换来一条更短的片子）：出点 / 入点落到片尾之外的片段收拾掉。不记撤销，而且撤销栈一并作废 ——
  // 栈里那些快照是按旧长度裁的，撤回去又是一个落在片尾之外的片段
  useEffect(() => {
    if (!project || alreadyMerged) return;
    const fixed = sanitizeClips(project, realLens);
    if (fixed === project) return;
    useCut.getState().apply(fixed, { undo: false });
    useCut.getState().clearHistory();
  }, [project, realLens, alreadyMerged]);

  /**
   * 工程一动就落盘（稍等一拍，别一拖音量滑杆就写几十次：一份剪辑稿连帧带图有几 MB）。
   *
   * ★ 单段编辑（segEdit）不落这个键 —— 那份稿子的真相在流水线上（studioStore.persistCutDraft 的 ★★）。
   * ★ 存不住要说出来（铁律八）：不说的话，人以为剪了半天的东西都在，切走再回来是一条没动过的时间轴。
   *   但它不是"钱没了"那一档，所以单列一条琥珀色的提示，不占 err 那一格（那里随时可能是一句更要紧的话）。
   */
  const savedProjRef = useRef<CutProject | null>(null);
  const liveProjRef = useRef<CutProject | null>(null);
  liveProjRef.current = project;
  const [saveWarn, setSaveWarn] = useState("");
  useEffect(() => {
    if (!project || segEdit) return;
    // 进页时手上那一份：要么刚从盘上还原出来，要么刚按稿子开出来、还没人动过 —— 都不用写
    if (savedProjRef.current === null) {
      savedProjRef.current = project;
      return;
    }
    if (savedProjRef.current === project) return;
    const timer = window.setTimeout(() => {
      savedProjRef.current = project;
      void useStudio
        .getState()
        .persistCutDraft()
        .then((why) => {
          if (aliveRef.current) setSaveWarn(why ?? "");
        });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [project, segEdit]);
  // 离开这一页时还有没落盘的改动（上面那个定时器被卸载清掉了）：补存一次，即发即忘
  useEffect(
    () => () => {
      const live = liveProjRef.current;
      if (!live || !savedProjRef.current || live === savedProjRef.current) return;
      if (useStudio.getState().segEdit || !useStudio.getState().draft) return;
      void useStudio.getState().persistCutDraft();
    },
    [],
  );
  /**
   * 用的是**自动预置**那条原片音轨，而画面时间轴被动过 ⇒ 音画必然对不上。
   *
   * ★★ 这句话要摆在**合并之前**（2026-09-08）：那条音轨是按原片从 0 秒混进去的
   *   （分段组取的更是整条源片），而裁剪 / 删段 / 换序改的全是画面这一侧，两边没有任何
   *   对齐机制。合完再说也说了（发布页那条），但那时片子已经出来了 —— 而此刻他还能
   *   换一条自己的音频、或者把片段改回原样，代价是零。
   * ★ 只对**自动预置**那条报：用户自己挑的 BGM 本来就与画面无关，对它说"会错位"是胡说。
   */
  const presetAudioDrift = !!audio && audioSpec?.kind === "preset" && timelineTouched;
  const total = view.reduce((s, c) => s + durOf(c), 0);
  const active = view[Math.min(activeIdx, Math.max(0, view.length - 1))] ?? null;
  const activeSeg: VideoSegment | undefined = active ? segs[active.segIndex] : undefined;
  /** 播放用地址：https 直连（同步拿到）、idb: 换 objectURL（异步）。不是截帧流（见 loadCaptureSrc） */
  const playSrc = useMediaUrl(activeSeg?.videoUrl);
  const res = RESOLUTIONS.find((r) => r.id === resId) ?? RESOLUTIONS[0];
  // 整条成片的画幅取**时间轴上的第一段**：各段本该是同一个画幅（铸段时就跟着上一段走），
  // 真混排了也只能挑一个——合并只有一块画布，另一种必然被裁或补边。
  // ★★ 认 `view[0]` 不认 `segs[0]`：这两个经常不是同一段 —— 用户在剪辑页把第 1 段删掉、
  //   或拖到后面去，`segs[0]` 就成了一个**根本不在成片里**的段，而整条片子还按它的画幅归一，
  //   归一走的是 LAYOUT_SCALE_TO_FIT_WITH_CROP ⇒ 剩下那些段被硬裁掉两边，全程零报错。
  //   （套白模模板会改写那一段的 aspect，所以混排是真会发生的。）
  const portrait = aspectOf((segs[view[0]?.segIndex] ?? segs[0])?.aspect).id === "portrait";
  const out = outSize(res.long, portrait);
  /**
   * 渲染计划：每个片段在成片里的起止、哪一秒出哪句字幕、每句配音从第几秒念、闪黑多长、配乐压到几成。
   * ★ **只在 cutProject.timelinePlan 出**：这一页的预览（CutPreviewLayer / 播放速度 / 原声音量）照它，
   *   合并那一拍交给原生合成器的也是它（mergeAndGo 里重新出一份，那时各段的长度量得更全）。
   */
  const plan = useMemo(
    () => (project && !alreadyMerged ? timelinePlan(project, lens, realLens, { w: out.w, h: out.h }, segs.length) : null),
    [project, alreadyMerged, lens, realLens, out.w, out.h, segs.length],
  );
  /** 这份工程用哪个音色配音 */
  const voiceId = narratorOf(project);
  // 预览要念的那几句配音：本地库里的 blob → 能播的地址（读不出来的那几句不在表里：预览没声音，字幕照出）
  const voiceRefKey = plan ? plan.voices.map((v) => v.ref).join("|") : "";
  const [voiceUrls, setVoiceUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const refs = voiceRefKey ? voiceRefKey.split("|") : [];
    if (refs.length === 0) {
      setVoiceUrls((m) => (Object.keys(m).length === 0 ? m : {}));
      return;
    }
    let alive = true;
    void Promise.all(refs.map(async (r) => [r, await resolveMediaUrl(r).catch(() => null)] as const)).then((pairs) => {
      if (!alive) return;
      const next: Record<string, string> = {};
      for (const [r, u] of pairs) if (u) next[r] = u;
      setVoiceUrls(next);
    });
    return () => {
      alive = false;
    };
  }, [voiceRefKey]);
  // 正在播的这一段按几倍速放、原声出几成 —— 与合成器照的是同一处判定（cutProject.clipSpeed / clipVolume）
  const activeSpeed = active ? clipSpeed(active) : 1;
  const activeVolume = active ? clipVolume(active) : 1;
  useEffect(() => {
    const v = vref.current;
    if (!v) return;
    v.playbackRate = activeSpeed;
    v.volume = activeVolume;
  }, [activeSpeed, activeVolume, playSrc, active?.id]);
  /**
   * **还在成片里**的那些圈选 —— 计价、按钮上的数、重拍三处都只准用这一份。
   *
   * ★★ 2026-08-30 修：`anns` 是按 `segIndex` 攒的，而删片段（`removeClip`）只动 `clips`。
   *   于是"在第 3 段圈了 5 处、又把第 3 段整个删掉"之后，按钮上仍写着 5 处、
   *   报价里仍含着那一段的 `segTokens + annRedrawCost(5)`，点下去**真扣钱、真重拍**
   *   一段根本不会出现在成片里的画面（铁律六：报价与实扣必须是同一把尺，
   *   而它们当时是同一把**错的**尺——两处各自从 anns 聚合）。
   * ★ 不在这里顺手删掉那些 ann：用户可能只是先删段、待会儿再撤销（撤回来那一段的圈选就还在）。
   *   它们只是**不参与计价与重拍**。
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
        // 画幅跟着这一段（480p 的每秒数按画幅不同；regenSegment 发的是同一个 aspect）
        (s, [i, n]) => s + (segs[i] ? segTokens(segs[i].durationSec, segs[i].videoTier, aspectOf(segs[i].aspect).ratio) + annRedrawCost(n) : 0),
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
  const bgmGain = plan?.bgmGain ?? 1;
  useEffect(() => {
    // 换了曲子/去掉了：把上一个收掉
    bgmRef.current?.pause();
    bgmRef.current = null;
    if (!audio) return;
    const el = new Audio(audio.url);
    el.loop = true; // 与合并那边一致：BGM 短于成片时循环补齐
    el.volume = Math.max(0, Math.min(1, audio.volume * bgmGain));
    bgmRef.current = el;
    return () => {
      el.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio?.url]);

  // 音量滑杆实时生效（这正是这一整段存在的理由）；有配音时配乐自动压低（计划里的 bgmGain），预览里也照压
  useEffect(() => {
    if (bgmRef.current && audio) bgmRef.current.volume = Math.max(0, Math.min(1, audio.volume * bgmGain));
  }, [audio?.volume, bgmGain]);

  // 合成 / 重拍期间预览整个停下来：预览现在是带声音的（原声 / 配音 / 配乐），别让它们在「合成中」的遮罩后面接着响
  useEffect(() => {
    if (!busy) return;
    vref.current?.pause();
    bgmRef.current?.pause();
    auditionRef.current?.pause();
    setPlaying(false);
  }, [busy]);
  /** 各段现在按多长算 —— 给跑在这一页卸载之后还活着的长活（配音）读最新的那份，别用闭包里的旧值 */
  const lensRef = useRef(lens);
  lensRef.current = lens;
  /**
   * 「对剪辑台说话」等模型回话的那几秒里，这几样都可能变：回话到的时候要读**最新**的（见 studio/cutAgent 文件头的 ★），
   * 所以各留一个 ref，不用闭包里那一拍的值。
   */
  const realLensRef = useRef(realLens);
  realLensRef.current = realLens;
  const selRef = useRef(sel);
  selRef.current = sel;
  const voicingRef = useRef(false);
  voicingRef.current = voicing.size > 0;
  const busyRef = useRef(false);
  busyRef.current = !!busy;


  if (!draft) return null;

  /** 当前播放头（成片时间轴上的秒）：前面片段在成片里的时长之和 + 这一段片内走了多远 ÷ 速度 */
  const playhead =
    view.slice(0, activeIdx).reduce((s, c) => s + durOf(c), 0) +
    (active ? Math.max(0, (vref.current?.currentTime ?? active.start) - active.start) / clipSpeed(active) : 0);

  function seekGlobal(sec: number) {
    let acc = 0;
    for (let i = 0; i < view.length; i++) {
      const d = durOf(view[i]);
      if (sec < acc + d || i === view.length - 1) {
        // 成片时间 → 片内时间：变速的片段里一秒成片对应 speed 秒素材
        const local = view[i].start + Math.min(d, Math.max(0, sec - acc)) * clipSpeed(view[i]);
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

  /**
   * 正在播的片段到出点了：接着播时间轴上的下一个，最后一个则停。
   * ★ 两处会来叫（预览那一层逐帧看到的、播放器的 timeupdate 兜底的），可能前后脚各叫一次 —— 所以它是幂等的：
   *   两次读到的都是同一拍的 activeIdx，置成同一个下一格。
   */
  function advanceClip() {
    if (activeIdx + 1 < view.length) {
      pendingSeek.current = view[activeIdx + 1].start;
      setActiveIdx(activeIdx + 1);
    } else {
      // ★ 播到时间轴末尾：**连 BGM 一起停**。只停 video 的话音乐会一直循环，
      //   而 togglePlay 判的是 v.paused（已经是暂停态）—— 再也停不下来
      stopPlayback();
    }
  }

  /**
   * 让预览播起来 —— **带声音**（2026-09-30：原来这颗播放器写死 muted，原声的音量滑杆等于盲调）。
   * 带声音的播放被拒（没有手势时个别 WebView 会拦）就退成静音再试一次：别把"能不能播"赌在"能不能出声"上
   * （与发布页 / 详情页播放器同一条，见 CLAUDE.md「播放器上写死 muted」那格）。
   */
  function playVideo(v: HTMLVideoElement) {
    v.muted = false;
    void v.play().catch(() => {
      v.muted = true;
      void v.play().catch(() => {});
    });
  }

  function togglePlay() {
    const v = vref.current;
    if (!v) return;
    if (v.paused) {
      playVideo(v);
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
  /**
   * 把一次改动写回工程：成了记一步撤销，不成就把原因摆出来（铁律八：说清为什么点不动）。
   * ★ 时间轴的每一种改法都走这一处 —— 手点的与「对剪辑台说话」办的（studio/cutAgent），都是 cutProject 里同一批函数的结果；
   *   改不成的那句话也只有一份（studio/cutIssues）。
   */
  function commit(r: CutResult, opts?: { coalesce?: string }): boolean {
    if (!r.ok) {
      setErr(cutIssueText(r.issue));
      return false;
    }
    setErr("");
    useCut.getState().apply(r.project, opts);
    return true;
  }

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
      setErr(t`播放头不在选中的片段里——先点一下这个片段（它会从头开始播），再操作。`);
      return null;
    }
    return { clip: target, at: vref.current.currentTime };
  }

  function splitAtPlayhead() {
    const pt = cutPoint();
    if (!pt || !project) return;
    commit(splitClip(project, pt.clip.id, pt.at, uid("clip"), lens));
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
    if (!pt || !project) return;
    commit(trimClip(project, pt.clip.id, edge, pt.at, lens));
  }

  /**
   * 还原这一段的裁剪（回到整段）。有了撤销之后它仍然留着：撤销是"退回上一步"，这颗是"这一段不裁了"，
   * 中间隔着别的操作时只有它办得到。
   * ★ 分割出来的片段回不到整段（会与另一半重叠、同一截播两遍）—— 判据与那句话在 cutProject.resetClip。
   */
  function resetTrim() {
    if (!project || !sel) return;
    commit(resetClip(project, sel));
  }

  function removeClip(id: string) {
    if (!project) return;
    if (commit(removeClipOp(project, id)) && sel === id) setSel(null);
  }

  function moveClip(id: string, dir: 1 | -1) {
    if (!project) return;
    commit(moveClipOp(project, id, dir));
  }

  /**
   * 把一个被删光了片段的段加回时间轴。
   * ★ 必须有这条**不靠撤销**的路：时间轴现在会落盘，删掉的段不再是离开这一页就自动复原的；撤销栈只活在内存里，
   *   App 一重启就没了 —— 没有这颗键，一段花钱炼出来的成片会在这一页上彻底够不着（见 cutProject.missingSegs 的 ★★）。
   */
  function restoreSegment(segIndex: number) {
    const cur = useCut.getState().project;
    if (!cur) return;
    setErr("");
    useCut.getState().apply(restoreSeg(cur, segIndex, uid("clip")));
  }

  function undo() {
    setErr("");
    useCut.getState().undo();
  }

  function redo() {
    setErr("");
    useCut.getState().redo();
  }

  /** 改配乐（换一条 / 去掉 / 调音量）：同样记一步撤销；滑杆一路拖过去只算一步 */
  function applyAudio(next: CutProject, coalesce?: string) {
    useCut.getState().apply(next, coalesce ? { coalesce } : undefined);
  }

  /**
   * 挑了一条本地音频当配乐。
   * ★ 文件先存进本地库、工程里记它的指针：只留一个 `blob:` 地址的话，App 一重启这条配乐就没了
   *   （原来正是这样 —— 从个人页「接着剪」回来，音频页签是空的）。
   * ★ 存不进去不拦着用：这一次照常能混进成片，只是说清楚它活不过离开这一页。
   */
  async function pickLocalAudio(f: File) {
    const key = `cutbgm:${uid("bgm")}`;
    const stored = await idbSet(key, f);
    const cur = useCut.getState().project;
    if (!cur) return;
    applyAudio(setAudioOp(cur, { kind: "local", name: f.name, ref: stored ? `idb:${key}` : URL.createObjectURL(f), volume: 0.8 }));
    setErr(stored ? "" : t`这条音频没能存进本地库（存储空间不足？）——这一次照常能用，但离开剪辑页之后要重新挑一次。`);
  }

  /** 对选中的片段做一处包装层的改动（速度 / 原声 / 转场）。`coalesce`：滑杆一路拖过去只记一步撤销 */
  function editSel(fn: (p: CutProject, clipId: string) => CutResult, coalesce?: string) {
    const cur = useCut.getState().project;
    if (!cur || !sel) return;
    commit(fn(cur, sel), coalesce ? { coalesce } : undefined);
  }

  /** 改工程级的一格（片头标题 / 字幕烧不烧 / 音色 / 片尾淡出） */
  function editProject(fn: (p: CutProject) => CutProject, coalesce?: string) {
    const cur = useCut.getState().project;
    if (!cur) return;
    setErr("");
    useCut.getState().apply(fn(cur), coalesce ? { coalesce } : undefined);
  }

  /** 写某个片段的字幕 / 旁白。一路打字只记一步撤销（输入框失焦时封口） */
  function editLine(clipId: string, text: string) {
    const cur = useCut.getState().project;
    if (!cur) return;
    commit(setClipLine(cur, clipId, text), { coalesce: `line:${clipId}` });
  }

  /**
   * 给这几个片段的字幕配音（一句一句合成，写回各自的片段）。
   *
   * ★ 这是一件能活过页面卸载的长活（一句一两秒，一条片子十来句）：多句时领一张票（data/jobs，退出登录被拦、
   *   人走开了胶囊里看得见）；每一句写回之前问两件事 —— 中途换过账号没有（deviceOwner.ownerEpoch）、
   *   store 里的工程还是不是开工时那份稿子的（指纹）。对不上就收手：合成好的那一句不写进别人的 / 别的稿子里。
   * ★ 写回按**片段 id**找、读最新的工程（不是闭包里那一份）：合成期间人可以接着剪 —— 片段被删了，这一句就不要了；
   *   字被改了，配音照样挂上去，但它立刻是"过期"的（voiceStale），界面会标出来。
   * ★ 一批只记一步撤销。失败的那几句把原因说出来；登录失效 / 限流 / 断网这几种后面的句子也一样会失败，当场停。
   */
  async function runVoices(ids: string[]) {
    const start = useCut.getState().project;
    // ★ 认 ref 不认闭包里的 voicing：「对剪辑台说话」是等完模型回话才走到这里的，闭包里那份可能是几秒之前的
    if (ids.length === 0 || !start || voicingRef.current) return;
    voicingRef.current = true;
    const epochAtStart = ownerEpoch();
    const sigAtStart = start.sig;
    const many = ids.length > 1;
    const total = ids.length;
    const job = many ? startJob({ kind: "cut-voice", title: t`配音`, page: "/cut", progress: t`准备中…` }) : null;
    const batch = uid("vb");
    setErr("");
    setVoicing(new Set(ids));
    let done = 0;
    let failed = 0;
    let why = "";
    try {
      for (let k = 0; k < ids.length; k++) {
        const id = ids[k];
        const cur = useCut.getState().project;
        if (ownerEpoch() !== epochAtStart || !cur || cur.sig !== sigAtStart || cur.merged) break;
        const clip = cur.clips.find((c) => c.id === id);
        const text = clip?.line?.text ?? "";
        if (clip && text.trim()) {
          const n = k + 1;
          job?.update(t`第 ${n}/${total} 句…`);
          try {
            const voice = await synthLine(text, narratorOf(cur), clipOutDur(clip, lensRef.current));
            const now = useCut.getState().project;
            if (ownerEpoch() !== epochAtStart || !now || now.sig !== sigAtStart || now.merged) break;
            const r = setClipVoice(now, id, voice);
            if (r.ok) {
              useCut.getState().apply(r.project, { coalesce: `voice:${batch}` });
              done++;
            }
          } catch (e) {
            failed++;
            if (!why) why = e instanceof Error ? e.message : String(e);
            // 这几种不是这一句的问题：后面的句子也一样会失败，别一句一句撞过去（限流那种还会越撞越久）
            if (e instanceof NarrationError && ["auth", "rate", "unsupported", "network"].includes(e.kind)) {
              failed += ids.length - k - 1;
              break;
            }
          }
        }
        if (aliveRef.current) {
          setVoicing((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
      }
    } finally {
      useCut.getState().seal();
      if (aliveRef.current) setVoicing(new Set());
      const line =
        failed > 0
          ? many
            ? t`有 ${failed} 句没配上：${why}`
            : why
          : "";
      if (aliveRef.current) {
        if (line) setErr(line);
        job?.done({ silent: true });
      } else {
        // ★ 人已经不在这一页了：这一页那个"工程一动就落盘"的 effect 没在跑，合成好的配音只在内存里 ——
        //   App 这时被系统回收，它们就没了（字还在、声音得重配一遍，而每一句都是一次真的语音合成）。当场存一次。
        //   换过账号 / 换了稿子的不存：那时 store 里已经不是这份工程了，上面的循环也早就收手了
        const now = useCut.getState().project;
        if (done > 0 && ownerEpoch() === epochAtStart && now && now.sig === sigAtStart && !useStudio.getState().segEdit) {
          void useStudio.getState().persistCutDraft();
        }
        if (job) {
          if (line) job.fail(line, "/cut");
          else job.done({ msg: t`${done} 句配音合成好了，回剪辑页听听`, route: "/cut" });
        }
      }
    }
  }

  /** 试听某一段的配音（再点一下停）。预览正在播的话先停下来 —— 两条声音叠着听不出配音本身 */
  async function audition(clipId: string, ref: string) {
    auditionRef.current?.pause();
    auditionRef.current = null;
    if (auditioning === clipId) {
      setAuditioning(null);
      return;
    }
    const url = voiceUrls[ref] ?? (await resolveMediaUrl(ref).catch(() => null));
    if (!url) {
      setErr(t`这句配音的文件读不出来了（可能被清理过）——重新配一次。`);
      return;
    }
    stopPlayback();
    const a = new Audio(url);
    auditionRef.current = a;
    setAuditioning(clipId);
    a.onended = () => setAuditioning((cur) => (cur === clipId ? null : cur));
    void a.play().catch(() => setAuditioning(null));
  }

  /**
   * 「✨ 一键成片」点了头：把那一版写回工程（整件事只记一步撤销），要配音的话接着一句一句配。
   * ★ 写回的是面板里用 cutProject.applyAutoPlan 算好的那份 —— 这里不再改它一个字（看到的就是写进去的）。
   */
  function applyAuto(next: CutProject, opts: { voice: boolean }) {
    setAutoOpen(false);
    setErr("");
    useCut.getState().apply(next);
    setTab("text");
    if (!opts.voice) return;
    const vid = narratorOf(next);
    const ids = next.clips
      .filter((c) => {
        const text = (c.line?.text ?? "").trim();
        if (!text || Math.ceil(lineUnits(text)) > lineCap(clipOutDur(c, lens))) return false;
        return !c.line?.voice || voiceStale(c.line, vid);
      })
      .map((c) => c.id);
    void runVoices(ids);
  }

  /**
   * 「对剪辑台说话」要的现状 —— 每次**现读**（等模型回话的那几秒里人可以接着手剪）。
   * 这会儿改不了时间轴就回 null：正在合成 / 重拍（这一炉的素材在开工那一拍已经定死，改了不进这一炉）、
   * 稿子已经合好、单段编辑（那条路不合成，包装层没处落）、工程不在了（换过账号）。
   */
  function agentCtx(): CutAgentCtx | null {
    const p = useCut.getState().project;
    const st = useStudio.getState();
    if (!p || p.merged || busyRef.current || st.segEdit || !st.draft || st.draft.merged) return null;
    return {
      project: p,
      lens: lensRef.current,
      realLens: realLensRef.current,
      segCount: st.draft.segments.length,
      selectedId: selRef.current,
      voiceId: narratorOf(p),
      voice: !canVoice ? "offline" : voicingRef.current ? "busy" : "ok",
      newId: () => uid("clip"),
    };
  }

  /**
   * 「对剪辑台说话」：一句话 → 时间轴上的改动。听懂在 studio/cutGrammar、落地在 cutProject.applyCutOps、
   * 调模型与说人话在 studio/cutAgent —— 这里只管**写回**：
   * ★ 整句话一次写回、只记一步撤销（说错了一句「撤销」就回去）。
   * ★ 写回之前核对 store 里还是不是算这份结果时用的那份工程：对不上就不写（照旧工程算的结果会盖掉中间的改动）。
   * ★ 撤销 / 重做按**真的退了几步**报：栈里没有那么多步时，回执说的是实际的数，一步都退不了就说退不了。
   */
  async function runAgent(text: string): Promise<CutAgentOutcome> {
    setErr("");
    const out = await runCutAgent(text, agentCtx);
    // ★ 等模型回话的时候人已经离开了剪辑页：这一句不落地。工程在全局 store 里，照写是写得进去的 —— 可那是一处
    //   没人看见回执的改动（面板随页面一起没了），而且这一页那个"工程一动就落盘"的 effect 已经不在跑。宁可不办
    if (!aliveRef.current) return { ...out, applied: [], next: null, voiceIds: [], undo: 0, redo: 0, openAuto: false };
    const store = useCut.getState();
    const refused = [...out.refused];
    let applied = out.applied;
    let voiceIds = out.voiceIds;
    if (out.next || voiceIds.length > 0) {
      if (store.project !== out.base) {
        applied = [];
        voiceIds = [];
        refused.push(t`时间轴刚好在这一拍被改过，这一句没有落地——再说一次`);
      } else if (out.next) {
        store.apply(out.next);
      }
    }
    let undone = 0;
    for (let i = 0; i < out.undo && useCut.getState().past.length > 0; i++) {
      useCut.getState().undo();
      undone++;
    }
    let redone = 0;
    for (let i = 0; i < out.redo && useCut.getState().future.length > 0; i++) {
      useCut.getState().redo();
      redone++;
    }
    if (out.undo > 0 && undone === 0) refused.push(t`没有可以撤销的步骤了`);
    if (out.redo > 0 && redone === 0) refused.push(t`没有可以重做的步骤了`);
    // 选中的片段被这一句删了（或者被撤销回去之前还不存在）：选中态跟着清掉，别留一个指着空气的选中
    const after = useCut.getState().project;
    setSel((cur) => (cur && after && !after.clips.some((c) => c.id === cur) ? null : cur));
    if (voiceIds.length > 0) void runVoices(voiceIds);
    if (out.openAuto) {
      setAgentOpen(false);
      setTab("text");
      setAutoOpen(true);
    }
    return { ...out, applied, refused, voiceIds, undo: undone, redo: redone };
  }

  /** 把合好的稿子还原到合并之前（见 studioStore.reopenCut）。还原之后这一页会按源段重新铺开 */
  function reopen() {
    if (useStudio.getState().reopenCut()) {
      setErr("");
      setTab("cut");
    } else {
      setErr(t`这条成片回不到合并之前了：它没有留下合并前的片段。直接去发布，或回工作流重做一条。`);
    }
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
          ? t`圈选要先取到这一段的截帧流，刚才没取到：${why} —— 点预览下方的「重试」`
          : t`这一段的截帧流还在取（成片有 20MB 级，稍等几秒再点圈选）`,
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
      const why = e instanceof Error ? e.message : String(e);
      setErr(t`截取当前画面失败：${why}`);
    }
  }

  /** ✨ 按全部圈选标注重新生成：逐段合并该段所有要求，改首/尾帧 + 重拍 */
  async function regenerateAll() {
    // ★ 与报价同一份输入（liveAnns）：删掉的段上那些圈选不计价、也不重拍
    if (busy || liveAnns.length === 0) return;
    const bySeg = new Map<number, Ann[]>();
    for (const a of liveAnns) bySeg.set(a.segIndex, [...(bySeg.get(a.segIndex) ?? []), a]);
    // ★ 档位门禁（2026-10-07 免费档限制）：重拍是真出片，而这几段的档这个人现在用不了（会员档 / 已停用）的话，
    //   改图的钱先花出去、重拍那一发才被服务端 403。判据只在 account.tierBlockReason（工作流出片问的是同一句）
    for (const segIndex of bySeg.keys()) {
      const blocked = segs[segIndex] ? tierBlockReason(tierOf(segs[segIndex].videoTier)) : null;
      if (blocked) {
        const segNo = segIndex + 1;
        setErr(t`第 ${segNo} 段重拍不了：${blocked}`);
        return;
      }
    }
    if (AI_REAL && !canAfford(annCost)) {
      const w = walletOf();
      const segCount = bySeg.size;
      const need = fmtTokens(annCost);
      const have = fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0));
      setErr(frozenNote() ?? t`重生成 ${segCount} 段约需 ${need} token，余额 ${have} 不足——去「我的」页充值`);
      return;
    }
    setErr("");
    // ★★ 这是一件分钟级、逐段花钱的长活（2026-09-18 复核抓到）：原来不领票，退出登录拦不住它 ——
    //   A 走开去退出、B 登录之后，循环接着发改图 / 重拍，每一发都现取 token、记在 **B** 的账上，做完还把 A 的段
    //   写进 B 的剪辑稿。现在领一张票（退出登录被 studio/signOutGuard 拦住；人走开了胶囊里也看得见它还在跑），
    //   另外每一发请求之前问一句「中途换过人没有」—— 登录失效后换人登录那一种拦不住，靠这一句收手
    //   （已经受理的那一发凭据记在 A 名下、不在这里结案，A 回来从取回卡领）。按换人代数判：A → B → A 之后
    //   剪辑稿已经被清过，再往下写就是拿空稿子盖掉 A 的剪辑稿（见 deviceOwner.ownerEpoch）。
    const epochAtStart = ownerEpoch();
    /**
     * 这一轮写回的是**哪一份稿子**：开头是剪辑页上这一份，每写回一段就换成新写的那份。store 里那份不再是它 =
     * 稿子被关掉或换成了别的（2026-09-18 发版复核抓到：重做期间用返回键退出单段编辑、去剪另一段，原来循环照样往下写 ——
     * 把这一段付过钱的成片写进**另一段**的稿子，还把服务端那一发结了案）。只判「清空了」不够：换成别的稿子时它不是空的。
     */
    let own = useStudio.getState().draft;
    /** submitted = 这一段的重拍已经交出去了：不结案，服务端登记表里那一发下次进创作入口会被补成取回卡 */
    const stopIfMoved = (submitted: boolean) => {
      if (ownerEpoch() !== epochAtStart) throw new Error(t`中途换了账号，剩下的段没有重做`);
      if (useStudio.getState().draft === own) return;
      throw new Error(
        submitted && isRemoteMode()
          ? t`剪辑中的稿子已经关掉或换成了别的：这一段重拍好的成片没有写进去（下次进创作入口，它会出现在「取回」卡上）；剩下的段没有重做`
          : t`剪辑中的稿子已经关掉或换成了别的，剩下的段没有重做`,
      );
    };
    const job = startJob({ kind: "cut-regen", title: t`按圈选重做`, page: "/cut", progress: t`准备中…` });
    /** 屏幕与票说同一句话 */
    const say = (line: string) => {
      setBusy(line);
      job.update(line);
    };
    /** 最近一段视频的报价（失败时钱上那句话用；见下面 catch） */
    let lastVideoTokens = 0;
    try {
      const nextSegs = own!.segments.slice();
      let n = 0;
      for (const [segIndex, list] of bySeg) {
        n++;
        const segNo = segIndex + 1;
        const segTotal = bySeg.size;
        const seg = { ...nextSegs[segIndex] };
        const half = lenOf(segIndex) / 2;
        // 逐个标注改帧：前半段的圈选改首帧、后半段的改尾帧（Seedance 只收首尾帧），
        // 同一帧多个标注串行叠加（上一次的修改结果作为下一次的底图）
        for (let k = 0; k < list.length; k++) {
          const a = list[k];
          const step = k + 1;
          const steps = list.length;
          stopIfMoved(false);
          say(t`第 ${segNo} 段 · 按圈选改画面 ${step}/${steps}…`);
          // 圈选改图那句全仓一处（segmentGen.ANN_CLAUSE）：出片前改帧、这里的圈选重拍、出片之前就地圈着改帧共用
          const edited = await refineFrame(`${a.req}${ANN_CLAUSE}`, a.frame, seg.aspect);
          if (a.atSec < half) seg.firstFrame = edited;
          else seg.lastFrame = edited;
        }
        stopIfMoved(false);
        say(t`第 ${segNo} 段 · 重拍视频（${n}/${segTotal} 段）…`);
        const reqAll = list.map((a) => a.req).join("；");
        /** 这一段视频那一半的价（与下面成功时记账、按钮上那个数同源）：失败时钱上那句话「可能扣了」按它说 */
        lastVideoTokens = segTokens(seg.durationSec, seg.videoTier, aspectOf(seg.aspect).ratio);
        const { url, lastFrame, poster, taskId } = await regenSegment(seg, reqAll, (s) => say(t`第 ${segNo} 段 · ${s}`)).catch((e: unknown) => {
          // 视频那一发失败了：包一层带上这一段刚改好的画面张数（list.length 次改图，每次各自结算）—— 钱上的话要把它们单独说
          // （ai/failCharge 的 SegmentGenFailed）。没接到结果（ArkTaskUnknown）不包：它不是失败，凭据留着
          throw e instanceof ArkTaskUnknown ? e : new SegmentGenFailed(e, list.length);
        });
        stopIfMoved(true);
        // ★ 成片到手，这一发结案（2026-09-18）：服务端登记表不知道谁取回了哪一发，不结案的话下次进创作入口
        //   它会被补成一张「还没取回」的卡（data/videoJobs.importServerVideoJobs）
        if (taskId) dropVideoJob(taskId);
        seg.videoUrl = url;
        if (lastFrame) seg.lastFrame = lastFrame;
        seg.poster = poster; // 没截到就清掉：别让缩略图挂着上一发的画面
        // ★ 必须判 AI_REAL：演示模式下根本没调方舟，却照样扣本地余额，
        //   用户在 mock 里点几次就"没钱"了，还查不出钱花在哪
        // ★ 与按钮上那个数同源：视频那一半 + 每处圈选一张改图（annRedrawCost 唯一实现）
        if (AI_REAL) spendTokens(segTokens(seg.durationSec, seg.videoTier, aspectOf(seg.aspect).ratio) + annRedrawCost(list.length));
        nextSegs[segIndex] = seg;
        // ★★ **每段一落地**（2026-08-21 第九轮扫描的 high）：原来整轮跑完才 setState 一次，
        //   中途失败（第 3 段撞上敏感词/超时）前面两段**钱已经扣了**，成片却随
        //   nextSegs 一起丢弃，圈选也没清 —— 用户点「重试」对同一份内容再收一遍。
        //   逐段写回 + 逐段清掉这一段的圈选：失败时前面付过的钱全都留在成片里。
        const nextDraft = { ...own!, segments: nextSegs.slice() };
        useStudio.setState({ draft: nextDraft });
        own = nextDraft;
        // ★ 钱刚扣过（segTokens + annRedrawCost）：这一段落盘，别让一次切后台把它烧掉。
        //   与 useFlowActions 那条「又炼出一段就自动存盘」是同一条规则、同一个理由。
        // ★ null = 存住了；有句子就原样说出去（segEdit 那条路说的是另一件事，见 store）
        // 这一段的圈选已经兑现成新的成片了：从工程里清掉（与稿子**同一次**落盘，见下面那句 persist）。
        // ★ 不记撤销，而且撤销栈一并作废：栈里的快照还带着这几处圈选，撤回去就能对着已经改好的画面再收一遍钱
        const curProj = useCut.getState().project;
        if (curProj) {
          useCut.getState().apply(dropAnnsOfSeg(curProj, segIndex), { undo: false });
          useCut.getState().clearHistory();
        }
        const why = await useStudio.getState().persistCutDraft();
        savedProjRef.current = useCut.getState().project;
        if (why) setErr(t`这一段已经改好、钱也扣过了，但${why}`);
        loadCaptureSrc(segIndex, url);
      }
      setBusy("");
      if (aliveRef.current) job.done({ silent: true });
      else job.done({ msg: t`按圈选重做好了，回剪辑页看看`, route: "/cut" });
    } catch (e) {
      setBusy("");
      const inner = unwrapFailure(e);
      // ★ 上游明说没出成：这一发结案（没有成片可取了）—— 不结案的话服务端登记表下次会把它补成一张取回卡
      //   （老服务端那种钱没退的也结案：失败那句话就在这里说给人听了，取回卡只会对着它再说一遍）
      if (inner instanceof ArkTaskFailed) dropVideoJob(inner.taskId);
      // ★ 说清"前面几段已经保住了"：不说的话用户以为整轮白花，会再点一次（再收一遍）
      const why = (inner instanceof ArkTaskFailed ? inner.reason : e instanceof Error ? e.message : String(e)).slice(0, 110);
      // ★ 钱上那句话（2026-10-07）：只认类型、只走 ai/failCharge —— 受理之后上游明说失败的那一发现在会退回，
      //   这一段刚改好的画面另说（它们各自结算过）。视频那一发之前的失败（改图本身失败）按一张图的价说
      const fc = chargeOnFail(e);
      const money = chargeNote(fc, fc.video ? lastVideoTokens : annRedrawCost(1));
      const moneyLine = money?.line ?? "";
      const line = money
        ? t`重新生成中断：${why}。${moneyLine}已经改好的段已经保住了（它们的圈选也清掉了），再点一次只会重做剩下的那几段`
        : t`重新生成中断：${why}。已经改好的段已经保住了（它们的圈选也清掉了），再点一次只会重做剩下的那几段`;
      setErr(line);
      if (aliveRef.current) job.done({ silent: true });
      else job.fail(line, "/cut");
    }
  }

  /** 🎬 合并导出：按时间轴顺序/裁剪范围重编码成单条 webm（混入音频轨）→ 发布页 */
  async function mergeAndGo() {
    // ★★ 防重入用 ref 不用 state：setBusy 是异步生效的，同一帧里的第二次点击照样进得来。
    //   进来之后就是两条 MediaRecorder 实时录同一块画布、两条 AudioContext 解同一条音轨，
    //   两次写库、两次 navigate —— 后完成的那次会把用户已经在发布页看到的成片换成
    //   它自己那条录得更烂的（2026-08-21 对抗评审确认）。
    if (busy || mergingRef.current) return;
    // ★ 纵深：已经合好的稿子直接去发布（理由见 alreadyMerged 的 ★★）。
    //   UI 上那颗键这时本来就写着「去发布」，这里只是不让别的调用路绕过去。
    if (alreadyMerged) {
      leftRef.current = true;
      navigate("/publish");
      return;
    }
    mergingRef.current = true;
    // 合成期间换过人（2026-09-18 复核抓到）：登录失效后另一个人登录，合完的成片不许写进新账号的剪辑稿 ——
    // persistCutDraft 按 workOwner 落盘 = 落在新账号名下，个人页横幅就会把 A 付过钱的成片摆给 B、能以 B 的名义发。
    // A 的剪辑稿还是合之前那一份，回来再合一次即可（合成本身不花钱）。主动退出会被 signOutGuard 拦住（下面领了票）。
    // 按换人代数判（A → B → A 也算换过：剪辑稿在中间被清过，见 deviceOwner.ownerEpoch）
    const epochAtStart = ownerEpoch();
    const ownerMoved = () => ownerEpoch() !== epochAtStart;
    /**
     * 这一炉写回的是哪一份稿子（写一次换一次，同 regenerateAll 的 own）。合成能活过页面卸载，人走开之后可能打开了
     * 别的稿子 / 单段编辑 —— 那时 store 里已经不是这一份了，合好的成片不许盖上去（2026-09-18 发版复核抓到）
     */
    let own = useStudio.getState().draft;
    const draftMoved = () => useStudio.getState().draft !== own;
    /**
     * 这一炉合的是**哪一份时间轴**。合成吃的片段表在下面一次定死；人走开又回来（这一页重新挂上、
     * 「合成中」的遮罩没了）再裁一刀，合出来的成片就与时间轴对不上了 —— 那时不许把它接上去、更不许拿
     * 改过的时间轴去配这条成片的留底。
     */
    const projAtStart = useCut.getState().project;
    const projMoved = () => useCut.getState().project !== projAtStart;
    /**
     * ★★ 合成是一件**能活过页面卸载**的长活（屏幕上那句话就写着「可以切走」），
     *   所以它必须领一张票（本仓约定：长活登记进 data/jobs，胶囊只有一颗）。
     *   不领票有两个后果，都真发生过：① 人走了之后没有任何地方显示它还在跑；
     *   ② 跑完那一拍直接 `navigate("/publish")` —— 把正在别的页面上的人**无预警拽走**
     *   （HashRouter 的 navigate 在组件卸载后照样生效，没有 cleanup 拦得住它）。
     * ★ 人还在这一页时票走 `silent`：页面自己会画结果，别再弹一次通知。
     */
    const job = startJob({ kind: "merge", title: t`合成成片`, page: "/cut", progress: t`准备中…` });
    let settled = false;
    /** 屏幕与票说同一句话 —— 两处各写各的必然分叉 */
    const say = (line: string) => {
      setBusy(line);
      job.update(line);
    };
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
    // ★★ 合并成功之后这一页立刻 navigate 走，`setErr` 写的话**一个都显示不出来**
    //   （本仓那格坑：话要说在用户接下来会看的那一屏上）。所以凡是"合完才知道、
    //   又值得让人知道"的事都攒进这里，随导航带去发布页。
    const warns: string[] = [];
    /**
     * 转存之后**仍然**是方舟临时链接的那几段（第几段，1 起）。
     * ★ 失败时要靠它把话说准：方舟的链接只活 24 小时，过了就是 403 —— 而那时
     *   合成器给的原话是三行英文（`Asset loader error ← Source error ← Response code: 403`），
     *   用户读不出"哪一段""为什么""接下来怎么办"。
     */
    const stillArk: number[] = [];
    try {
      // ★ 老草稿自救：还是方舟直链的段先转存成永久地址（服务端拉，全球 CDN）。
      //   出片那一刻的转存 2026-08-20 才上线，在那之前炼的段揣的还是 TOS 直链 ——
      //   而原生合成器是**流式**拉源片的，跨境直连 TOS 又慢又容易断。转存失败不挡合并，
      //   照旧拿直链碰运气。
      //
      // ★★ 走**受理式 + 短轮询**，不走阻塞式（2026-09-07 真机实拍换掉的）：
      //   阻塞式 `transferArkVideo` 要在一个请求里等服务端搬完，而 Cloudflare 的读超时是
      //   125 秒 —— 这一发等满约 145 秒、整发作废、静默退回方舟直链，然后 Media3 只好跨境
      //   拉 TOS。**服务端那边其实一直搬得好好的**（后台任务，与请求生死无关），只是没人回来问。
      //   受理式把等待拆成一串几百毫秒的请求，一个都碰不到那堵墙，还能被「取消合并」打断。
      let mergeSegs = segs;
      const arkAt = segs.map((s, i) => (isArkAssetUrl(s.videoUrl) ? i : -1)).filter((i) => i >= 0);
      if (arkAt.length > 0) {
        const next = segs.slice();
        for (const i of arkAt) {
          // ★ 每一轮开头先看一眼（本仓那格坑）：只在 await 处判的话，点了取消之后
          //   剩下每段照样各等一发 120 秒 —— 用户点的是「取消」、收到的是「转存超时」
          if (cancelRef.current) break;
          const src = next[i].videoUrl!;
          // ★★ 这一步会真的花上一两分钟（跨境搬 20~80MB），所以**文案必须一直在动**：
          //   2026-09-07 真机实拍到它一动不动地停了 108 秒 —— 屏幕上分不出"还在搬"与"卡死了"，
          //   也分不出卡在**提交**那一发还是**等搬完**（这两件事的排查方向完全不同）。
          const tf0 = Date.now();
          const waited = () => Math.round((Date.now() - tf0) / 1000);
          const segNo = i + 1;
          say(t`第 ${segNo} 段成片转存中（换成永久地址）…`);
          try {
            let got = await requestArkTransfer(src);
            // ★ 上限 120 秒：搬 20~80MB 在服务端那头通常十几秒。到点还没好就先用直链走
            //   （成不成都不挡合并），后台那份不会白搬 —— 下次再问就是现成的。
            const until = Date.now() + 120_000;
            while (got.state === "pending" && Date.now() < until && !cancelRef.current) {
              const secs = waited();
              say(t`第 ${segNo} 段成片转存中（换成永久地址）· 已等 ${secs} 秒…`);
              await new Promise((r) => setTimeout(r, 3_000));
              const st = await transferStatus([src]).catch(() => null);
              const hit = st?.[src];
              // ★ `none` = 服务端没有这条的登记（老服务端 / 受理那一发其实没落地）——
              //   它不是一种进展，别写回 got（写回去循环就当"搬完了"退出来了）
              if (hit && hit.state !== "none") {
                got = { state: hit.state, ...(hit.url ? { url: hit.url } : {}), ...(hit.message ? { message: hit.message } : {}) };
              }
            }
            if (got.state === "done" && got.url) next[i] = { ...next[i], videoUrl: got.url };
          } catch {
            /* 见上：失败照旧 */
          }
          // 转存没换成永久地址 ⇒ 这一段接下来会拿临时链接去拉，过了 24 小时就是 403
          if (isArkAssetUrl(next[i].videoUrl)) stillArk.push(i + 1);
        }
        if (cancelRef.current) {
          setBusy("");
          setErr(t`已取消合并。片段、圈选和配乐都还在，随时可以重新开始。`);
          return;
        }
        mergeSegs = next;
        if (!ownerMoved() && !draftMoved()) {
          // 写回草稿：预览、重试合并、发布都用转存后的地址，别让下一步再拉一次跨境
          const nextDraft = { ...own!, segments: next };
          useStudio.setState({ draft: nextDraft });
          own = nextDraft;
          // 跨境转存的成果，不值得再拉一遍
          void useStudio.getState().persistCutDraft();
        }
      }
      // ★ 音轨与画布准备是**同步长活**（预置的原片音轨是整条原视频，几十 MB、跨境要十几秒）：
      //   不先点亮 busy 的话，这段时间按钮亮着、屏幕上一个字都没有 = 用户眼里的"点了没反应"
      // ── 合并：交给系统硬件编解码器（原生 Media3 Transformer）────────────────
      // ★★ 这里原来是 `canvas.captureStream(30)` + `MediaRecorder` **实时录屏**（2026-09-07 整条撤掉）。
      //   撤的理由不是慢一点，是四条各自都能毁掉成片的硬伤：① 耗时恒等于片长；② 把已经压过一次的
      //   素材再编一遍；③ 机器一忙 captureStream 就掉帧（本机实测同一次合并比墙钟短 26%）；
      //   ④ 产出的 WebM **没有 Duration 元素**，全 app 没有任何消费者能从文件本身问出时长 ——
      //   2026-09-06 那次「前 12 秒全黑、后 12 秒播不到」有一半就是它。
      //   手机剪辑软件从来不这么做：它们走 MediaCodec / AVFoundation。我们是 Capacitor，够得到。
      // ★ 段落直接把**公网地址**交过去：它们在出片那一刻就转存到图床了，让 Media3 自己流式取，
      //   不必先把几十兆下载到手机再喂进去（那正是老路最慢、也最容易超时的一段）。
      if (!mergeSupported()) throw new Error(mergeUnsupportedText());
      if (!projAtStart) throw new Error(t`时间轴还没准备好，稍等一下再点「下一步」`);
      say(t`准备素材…`);
      // ── 先把各段的真实长度量出来（只在工程里有"长在时间上"的东西时：字幕 / 配音 / 闪黑 / 变速 / 配乐）──
      // ★★ 这些东西按**成片时间轴**定位（第 7 秒出这句字幕、第 12.3 秒开始淡出），而成片时间轴是把各段的长度
      //   一段一段加起来的。有一段的长度还停在申报值上（申报 5 秒、实际 20 秒的白模段），它后面的字幕、配音、
      //   淡入淡出就全错位了 —— 所以长度靠不住时计划里干脆不做闪黑与片尾收声（cutProject.timelinePlan 的 ★★），
      //   这里先尽力把它量出来。只读 metadata，一段几百毫秒；量不到不挡合成，如实说一句。
      const mergeReal = realLens.slice();
      const pre = timelinePlan(projAtStart, lens, mergeReal, out, mergeSegs.length);
      if (pre.timed && !pre.exact) {
        for (const pc of pre.clips) {
          if (cancelRef.current) break;
          const i = pc.segIndex;
          const url = mergeSegs[i]?.videoUrl;
          if (mergeReal[i] !== undefined || !url || !/^https?:/i.test(url)) continue;
          const segNo = i + 1;
          say(t`量第 ${segNo} 段的时长…`);
          try {
            const d = await probeDuration(url);
            mergeReal[i] = d;
            if (aliveRef.current) learnRealDur(i, d);
          } catch (e) {
            console.warn(`[cut] 第 ${segNo} 段的时长没量到:`, e);
          }
        }
        if (cancelRef.current) {
          setBusy("");
          setErr(t`已取消合并。片段、圈选和配乐都还在，随时可以重新开始。`);
          return;
        }
      }
      const mergeLens = mergeSegs.map((sg, i) => mergeReal[i] ?? segLen(sg));
      // 时间轴 → 合成器吃的那张表（**只在 cutProject.compileTimeline 出**，预览照的是同一份计划）。
      // 没有长在时间上的东西时，没裁过尾巴的片段不带出点 —— 原生那边不设结束点、一直取到片尾
      const tl = compileTimeline(projAtStart, mergeSegs, mergeLens, mergeReal, out);
      if (!tl.ok) {
        const segNo = tl.segNo;
        throw new Error(
          tl.issue === "no-video"
            ? // ★ 渐变段（没出片、只有首尾帧）这条路做不了：原生拼的是视频，不是两张图。
              //   与其悄悄跳过它（成片里少一段，零报错），不如整句说清楚。
              t`第 ${segNo} 段还没有视频（只有设定帧），合成做不了——先把这一段炼出来`
            : // ★ 分两种情况说，别让一句话指向不存在的出口（`idb:` 那种上面 alreadyMerged 已经拦掉了，
              //   落到这里的只可能是"多段里混着一段本机文件"这种不该出现的形状）
              tl.issue === "local-merged"
              ? t`第 ${segNo} 段是已经合好的本机成片，不能再合一次——去发布页发它，或回工作流重做一条`
              : t`第 ${segNo} 段还不是永久地址，合成用不了——回到工作流等它转存完再来`,
        );
      }
      if (tl.clips.length === 0) throw new Error(t`时间轴上没有可合成的片段`);
      const plan = tl.plan;
      // ★ 包装层的几格只在**不是缺省值**时才带：一条什么都没加的稿子，交给原生的参数与包装层出现之前逐字相同
      const clips: MergeClip[] = tl.clips.map((c) => ({
        url: c.url,
        startSec: c.startSec,
        ...(c.endSec !== undefined ? { endSec: c.endSec } : {}),
        ...(c.speed !== 1 ? { speed: c.speed } : {}),
        ...(c.volume !== 1 ? { volume: c.volume } : {}),
        ...(c.fadeInSec > 0 || c.fadeOutSec > 0
          ? { outStartSec: c.outStartSec, outDurSec: c.outDurSec, fadeInSec: c.fadeInSec, fadeOutSec: c.fadeOutSec }
          : {}),
      }));
      /** 真正进了成片的那几段（稿子里的段号，按时间轴顺序）—— 下面查画幅 / 剧情 / 有没有声音都认它 */
      const order = tl.clips.map((c) => c.segIndex);
      // 计划里那几件"排不上 / 对不上"的事：合完才说也要说（这一页马上要跳走，话随导航带去发布页 —— 那里有「回剪辑页改一改」）
      if (plan.timed && !plan.exact) {
        const unsure = [...new Set(plan.clips.filter((pc) => mergeReal[pc.segIndex] === undefined && !pc.endExplicit).map((pc) => pc.segIndex + 1))];
        const segList = unsure.join(t({ message: "、", comment: "列举几个段号时的分隔符（第 1、3 段）" }));
        warns.push(
          t`第 ${segList} 段的真实时长没量到：字幕和配音是按申报的时长排的，时间可能对不上；闪黑与片尾淡出这一次没有做。回剪辑页把这几段各播一下（播过就量到了），再合一次。`,
        );
      }
      if (plan.dropped.length > 0) {
        const n = plan.dropped.length;
        warns.push(t`有 ${n} 句字幕 / 配音没排上：片段太短，或者被上一句配音挤到了片尾之外。`);
      }
      const staleCount = projAtStart.clips.filter((c) => voiceStale(c.line, narratorOf(projAtStart))).length;
      if (staleCount > 0) {
        warns.push(t`有 ${staleCount} 句配音还是改字（或换音色）之前合成的那一版——成片里念的和字幕对不上。回剪辑页的「字幕」重新配一次，再合一次。`);
      }
      const cutShort = plan.voices.filter((v) => v.playSec < v.durSec - 0.05).length;
      if (cutShort > 0) warns.push(t`最后一句配音没念完就到片尾了（成片里它在片尾被掐掉）。把这一句改短，或者把最后一段留长一点。`);

      // BGM：本地挑的那份在 Web 侧是 blob:，原生打不开，先落盘（几 MB 级，段落视频绝不走这条）
      let audioArg: { url: string; volume: number } | undefined;
      if (audio) {
        try {
          say(t`准备配乐…`);
          // 有配音时配乐自动压低（plan.bgmGain，配音为主）；没有配音时这个系数是 1
          audioArg = { url: await stageLocalAudio(audio.url), volume: audio.volume * plan.bgmGain };
        } catch (e) {
          // ★ 音轨拿不到**不许拖垮整条成片**（2026-08-21 对抗评审确认的老规矩，这次沿用）
          console.warn("[cut] 音轨取不到:", e);
          const audioName = audio.name;
          const why = t`音轨没能取下来（${audioName}）——这一条先按无声导出。想要声音就换一条本地音频再重试合并。`;
          setErr(why);
          warns.push(why); // 合并成功就要跟着去发布页，否则这句话谁都看不到

        }
      } else if (audioSpec) {
        // 工程里记着一条配乐，可它的文件现在读不出来（本地库里那份没了 / 还在读）：别悄悄合成一条没配乐的
        // （音频页签上那一行还亮着，人会以为它进去了）
        const lostName = audioName;
        warns.push(t`配乐「${lostName}」没能读出来——这一条先按没有配乐导出。想要它就回剪辑页的「音频」重新挑一次，再合一次。`);
      }

      // 配音：本地库里的 blob → 本机文件（与本地配乐同一条路：原生打不开 blob:）。
      // ★ 一句取不到不拖垮整条成片（与配乐同一条老规矩），但要说出来 —— 字幕还在画面上，人会以为它有声音
      const voiceArgs: MergeVoice[] = [];
      if (plan.voices.length > 0) {
        say(t`准备配音…`);
        let lost = 0;
        for (const v of plan.voices) {
          if (cancelRef.current) break;
          try {
            const src = await resolveMediaUrl(v.ref);
            if (!src) throw new Error("voice blob gone");
            voiceArgs.push({ url: await stageLocalAudio(src), atSec: v.atSec, durSec: v.durSec, volume: v.volume });
          } catch (e) {
            lost++;
            console.warn("[cut] 配音取不到:", e);
          }
        }
        if (lost > 0) {
          warns.push(t`有 ${lost} 句配音的文件读不出来了（可能被清理过）——这几句在成片里没有声音。回剪辑页的「字幕」重新配一次，再合一次。`);
        }
      }

      // ★ 配乐落盘那几秒里点了取消：别再开合成（2026-09-18 发版复核抓到：原来只在合成**之后**问一次，
      //   取消了照样把整条合完，几十秒白跑，而屏幕上写着「正在停止」）
      if (cancelRef.current) {
        setBusy("");
        setErr(t`已取消合并。片段、圈选和配乐都还在，随时可以重新开始。`);
        return;
      }
      say(t`合成中…`);
      const merged = await runNativeMerge(
        {
          clips,
          width: out.w,
          height: out.h,
          ...(audioArg ? { audio: audioArg } : {}),
          // ★ 显式标识的**政策**在这里定，不在原生里（合规口径会变，变的时候不该动原生代码）。
          //   口径与出处见 data/aigcLabel.ts。
          badge: aigcBadgeSpec(),
          // 字幕 / 标题：行与时间都是计划里排好的，版式那几个比例也是（cutProject.captionLayout）—— 原生只照着画
          ...(plan.captions.length > 0
            ? {
                captions: {
                  items: plan.captions.map((c) => ({ startSec: c.startSec, endSec: c.endSec, lines: c.lines, kind: c.kind })),
                  sizeRatio: plan.layout.sizeRatio,
                  bottomRatio: plan.layout.bottomRatio,
                  maxWidthRatio: plan.layout.maxWidthRatio,
                  titleScale: plan.layout.titleScale,
                  titleTopRatio: plan.layout.titleTopRatio,
                },
              }
            : {}),
          ...(voiceArgs.length > 0 ? { voices: voiceArgs } : {}),
          ...(plan.tailFadeSec > 0 ? { tailFadeSec: plan.tailFadeSec } : {}),
          // 成片总长：配音不许把成片撑长、片尾收声从哪儿开始，原生都认它
          ...(voiceArgs.length > 0 || plan.tailFadeSec > 0 ? { totalSec: tl.total } : {}),
        },
        (frac) => setMergeDone(tl.total * frac),
      );
      if (cancelRef.current) {
        setBusy("");
        setErr(t`已取消合并。片段、圈选和配乐都还在，随时可以重新开始。`);
        return;
      }

      say(t`写入本地库…`);
      // 原生产物是本机文件；成片下游整条链认的是 `idb:` 指针，这里搬一次省掉全 app 改造
      const blob = await mergedFileToBlob(merged.uri);
      const key = `merged:${uid("mv")}`;
      if (!(await idbSet(key, blob))) throw new Error(t`成片写入本地库失败（存储配额？）`);
      // 成片第一帧（本机文件，解码一帧很便宜）。截不到不挡发布，缩略图退回段的设定帧
      let poster = "";
      try {
        poster = await captureVideoFrame(Capacitor.convertFileSrc(merged.uri), 0.05);
      } catch (e) {
        console.warn("[cut] 成片首帧没截到:", e);
      }
      const orderedPlots = [...new Set(order.map((i) => segs[i].plot))];
      const first = segs[order[0]];
      const last = segs[order[order.length - 1]];
      /**
       * 成片的**真实**长度：**由合成器直接给**（ExportResult.durationMs），不再自己解码去量。
       * ★★ 这一位为什么必须是真值（2026-09-06 主人真机）：以前写的是申报总和，而成片实际更长 ——
       *   播放器、封面截帧、首页进度条读的都是我们申报的这个数，申报短了后面那截就永远播不到。
       * ★ 老路（MediaRecorder/WebM）连文件自己都答不出时长（没有 Duration 元素），只能靠 seek 到
       *   1e101 硬扫；换成原生输出标准 mp4 之后，这个问题从根上没有了 —— 合成器报多少就是多少。
       * ★ `durationSec` 取整后写的是真值：服务端 `segmentBody` 是 z.object，`realDurationSec`
       *   不在它的声明里，发布时会被静默 strip（CLAUDE.md 那格坑）。能过河的只有 durationSec 这一位。
       */
      const recordedSec = merged.durationSec > 0.5 ? merged.durationSec : tl.total;
      const mergedSeg: VideoSegment = {
        title: t`成片`,
        plot: orderedPlots.join("\n"),
        firstFrame: first.firstFrame,
        lastFrame: last.lastFrame,
        // 成片第一帧：白模段没有设定帧，全靠它（发布页封面候选、剪辑页缩略图都读 poster || firstFrame）。
        // ★ 从**合好的成片**里截，不是抄第一段的 —— 成片经过画幅归一与叠标，抄来的那张与它对不上。
        ...(poster ? { poster } : {}),
        durationSec: Math.max(1, Math.round(recordedSec)),
        realDurationSec: recordedSec,
        videoUrl: `idb:${key}`,
        // 合并后就只剩这一段了：画幅必须跟着走，否则首页拿不到画幅提示，
        // 而且回炉重制时新拍的段会退回默认画幅
        // ★ 与输出尺寸同一把尺（上面 portrait 那一行的 ★★）：认时间轴上的第一段 `first`，不认 segs[0] ——
        //   用户删掉 / 挪走第 1 段时两者不是同一段，标签就与合出来的画面对不上（2026-09-18 发版复核抓到：370f719 只改了一半）。
        //   ★ 也别退到 segs[0]：first 没记画幅时输出按缺省画幅出（aspectOf(undefined)），标签跟着留空才对得上
        aspect: first.aspect,
      };
      // 换过账号：成片不落进新账号（见 epochAtStart 的注释）；票在换人那一拍已经被清掉了
      if (ownerMoved()) return;
      // 合成期间稿子被关掉 / 换成了别的：不盖上去，票上如实说一句（合成不花钱，回那份稿子再合一次就是了）
      if (draftMoved()) {
        settled = true;
        job.done({ msg: t`成片合好了，但剪辑中的稿子已经关掉或换成了别的，这一条没有接上——回到那份稿子再合一次（合成不花钱）` });
        return;
      }
      // 合成期间时间轴又被改过（人走开又回来裁了一刀，见 projAtStart 的注释）：这条成片配不上现在的时间轴，
      // 不接上去。合成不花钱，照现在的时间轴再合一次就是了
      if (projMoved()) {
        settled = true;
        const line = t`成片合好了，但合成期间时间轴又改过，这一条和现在的时间轴对不上，没有接上——回剪辑页再合一次（合成不花钱）`;
        if (aliveRef.current) {
          setErr(line);
          job.done({ silent: true });
        } else {
          job.done({ msg: line, route: "/cut" });
        }
        return;
      }
      leftRef.current = true;
      // ★★ **先**把源段留底进工程，**再**把稿子换成单段成片（2026-09-30）：稿子里的 segments 这一拍之后就只剩成片了，
      //   源段不留底，这条片子就再也回不到合并之前（原来正是这样：发布页听出配乐不对，只能回工作流重做一条）。
      //   顺序不能反 —— 这一页那个「对一下工程」的 effect 见到「稿子合好了、工程没留底」会把工程当成对不上的丢掉。
      // ★ 不记撤销，也不用清撤销栈：留底不在快照的管辖里（cutStore 的 carryOver 换快照时一律保持现状），
      //   「回去改」之后合并之前那几步照样撤得回去
      useCut.getState().apply(markMerged(projAtStart, own!.segments, own!.branchTree), { undo: false });
      useStudio.setState({ draft: { ...own!, segments: [mergedSeg], branchTree: undefined, merged: true } });
      // ★★ 这一拍把 `idb:merged:` 指针钉到盘上 —— 在此之前那条几十 MB 的成片
      //   **只被内存里的 store 引用着**，磁盘上找不到任何指针（cacheSweep 文件头记的
      //   正是这个洞，它靠 24h 时间闸门兜着）。实时录制几分钟的成果，不能只活在内存里。
      // ★ 合并那一拍的回执也要判（模块契约就是这么写的）：这时候刚录完几分钟的成片，
      //   指针只在内存里 —— 存不住而不吭声，正是最贵的那种静默失败
      // ★ 留底的源段随同一次落盘一起写（persistCutDraft 把稿子与工程一次写完）
      const cutWhy = await useStudio.getState().persistCutDraft();
      savedProjRef.current = useCut.getState().project;
      if (cutWhy) warns.push(t`成片已经合好了，但${cutWhy}`);
      // ★★ 成片是哑的就当面说一句（2026-09-07 主人真机：「原本有声音的又没声音了」）。
      //   「没有声音」在界面上**不构成任何报错** —— 音轨本来就是可选的，于是一条哑片
      //   会一路走到发布页、发出去，全程没人吭声。而白模复刻段的画面天生无声
      //   （generate_audio:false 是版权拦截换来的），声音全靠音频页签那条预置混进去。
      //   ★ 判**否定**：老插件不报这一位（undefined = 不知道），只有明确 false 才说。
      // 预置的"原视频音轨"其实是条无声视频（白模模板常见）——原生那边已经跳过，这里如实说
      if (merged.bgmSkipped) warns.push(merged.bgmSkipped);
      // 成片太大：在**素材还在**的时候就说（见 MAX_DIRECT_MEDIA_BYTES 的 ★）。
      // ★ 只提醒不拦：真正作数的是上传票上那个数，我们这份只是提前量。
      if (merged.sizeBytes > MAX_DIRECT_MEDIA_BYTES * 0.95) {
        const sizeMb = Math.round(merged.sizeBytes / 1024 / 1024);
        const capMb = Math.round(MAX_DIRECT_MEDIA_BYTES / 1024 / 1024);
        warns.push(
          t`这条成片有 ${sizeMb}MB，接近服务器上限（约 ${capMb}MB），可能传不上去。传失败的话回剪辑页删几段、或把导出分辨率降一档再合一次——片段和配乐都还在。`,
        );
      }
      /**
       * 用的是**自动预置**的原片音轨，而画面时间轴被动过 ⇒ 音画必然对不上。
       * ★ 预置那条音轨是按**原片从 0 秒**混进去的（分段组取的更是整条源片），
       *   而剪辑页的裁剪 / 删段 / 换序改的全是画面这一侧 —— 两边没有任何对齐机制。
       *   真要对齐得给音轨也做一份时间轴映射，那是另一件事；在那之前**至少要说出来**，
       *   否则用户拿到一条音画错位的成片，只会以为是合成质量的问题。
       */
      if (audioArg && presetAudioDrift) {
        warns.push(
          t`配乐用的是自动预置的原片音轨，而你裁过/删过/换过片段顺序——声音是按原片从头混进去的，会和画面对不上。想对齐就换一条自己的音频，或者把片段改回原样再合一次。`,
        );
      }
      /**
       * 这条成片到底会不会响。**两个来源，谁先答得准算谁**：
       * ① 合成器（`merged.hasAudio`）—— 单段时可信；多段开了 forceAudioTrack 之后它答不准，
       *    所以那时它干脆不发这一位（见 nativeMerge.MergeResult.hasAudio 的 ★★）。
       * ② **输入侧**（`VideoSegment.hasAudio`，组稿那一拍算好的）—— 参与合并的那几段
       *    **全部**明确无声，那整条就是哑的。这一条正是补上①的盲区：默认 std 档 audio:false、
       *    白模钉死 generate_audio:false ⇒ **多段全哑是常态，不是边角**。
       * ★ 判否定：只要有一段是 `undefined`（老草稿没有这一位）就当"不知道"，一个字都不说。
       * ★ 看的是 `view`（真正进了成片的那几段）不是 `segs` —— 删掉/没排进时间轴的段不算数。
       */
      // 配音与配乐一样算「我们自己送进去的声音」：有它成片就一定会响
      const bgmIn = (!!audioArg && !merged.bgmSkipped) || voiceArgs.length > 0;
      const partAudio = order.map((i) => mergeSegs[i]?.hasAudio);
      const allSilent = partAudio.length > 0 && partAudio.every((x) => x === false);
      if (!bgmIn && (merged.hasAudio === false || allSilent)) {
        warns.push(
          t`这条成片没有声音：素材本身不带音轨，合成时也没有加配乐。想要声音就回剪辑页的「音频」加一条，再合一次。`,
        );
      }
      settled = true;
      if (aliveRef.current) {
        job.done({ silent: true }); // 人就在这一页上，下面这行自己会把他带过去
        navigate("/publish", warns.length ? { state: { warn: warns.join("\n") } } : undefined);
      } else {
        // ★★ 人已经离开这一页了 —— **不许**把他从别的地方拽到发布页（那正是"无预警跳页"）。
        //   换成一张可点的票：他什么时候想去，点通知就过去。
        //   ⚠ `warns` 必须跟着走：里面装着「这条成片没有声音」这类只有这一次能说的话，
        //   不带上就等于悄悄写完什么都不说（本仓那格坑的同款形状）。
        job.done({ msg: warns.length ? warns.join("\n") : t`成片合好了，去发布吧`, route: "/publish" });
      }
    } catch (e) {
      // ★ 取消可能正好按在某一段的 await 中途（取流/加载/播放）——那时抛出来的异常
      //   是"因为取消"，不是失败。报成失败就是对用户说了假话（铁律八）。
      const code = (e as { code?: string } | null)?.code;
      const raw = (e instanceof Error ? e.message : String(e)).slice(0, 160);
      if (cancelRef.current) {
        setErr(t`已取消合并。片段、圈选和配乐都还在，随时可以重新开始。`);
      } else if (code === "BUSY") {
        // ★ 这**不是失败**：那一炉好好地在跑（原生那句话自带出路）。加"合并失败："
        //   等于报一次并不存在的失败，还把用户推向最不该走的那条路 —— 再合一次。
        setErr(raw);
      } else {
        settled = true;
        // ★★ 把「取不到源片」翻成人话，并指一条**真实存在**的出口（2026-09-08 真机撞到）：
        //   合成器给的原话是 `Asset loader error ← Source error ← Response code: 403` ——
        //   三行英文，说不出"哪一段""为什么""接下来怎么办"。而这一档最常见的原因只有一个：
        //   那一段揣的还是方舟临时链接（转存没成），而它**只活 24 小时**。
        //   ⚠ 只在**我们自己知道**有段没转存成（stillArk 非空）时才这么说 —— 否则同样的 403
        //   可能来自别的地址，硬套一个原因就是换了一种骗人。
        const http = /Response code:\s*(\d{3})/.exec(raw)?.[1];
        const segList = stillArk.join(t({ message: "、", comment: "列举几个段号时的分隔符（第 1、3 段）" }));
        const failMsg =
          (http === "403" || http === "404") && stillArk.length
            ? t`合并失败：第 ${segList} 段的视频取不到了（HTTP ${http}）。这几段揣的还是方舟的临时链接、当初没能转存成永久地址，而那种链接只活 24 小时——过期之后合成器也拉不到。这条片子现在合不了：回工作流把这几段重新出片（会再花一次钱），或者删掉它们再合。`
            : t`合并失败：${raw}`;
        if (aliveRef.current) {
          setErr(failMsg);
          job.done({ silent: true }); // 这一页自己会画这句话，不用再弹一次
        } else {
          job.fail(failMsg, "/cut"); // 人不在，结局只能留在票上
        }
      }
    } finally {
      // 取消 / BUSY 这些早退分支：票没结过就撤掉，别在胶囊里挂一张永远转圈的
      if (!settled) job.done({ silent: true });
      setBusy("");
      document.removeEventListener("visibilitychange", onHidden);
      mergingRef.current = false;
    }
  }

  /** 写了字幕的片段数（「字幕」页签上的角标） */
  const lineCount = view.filter((c) => (c.line?.text ?? "").trim()).length;
  /**
   * 包装层（字幕 / 配音 / 变速 / 原声 / 转场）在这份稿子上用不用得上。
   * ★ 单段编辑（从节点卡「编辑本段」进来）用不上：那条路不合成，「保存本段」只把帧与成片写回流水线
   *   （studioStore.closeSegmentEdit），片段上挂的这些东西没有地方落 —— 摆出来就是一排改了不作数的键。
   */
  const packaging = !segEdit;
  const TABS: Array<{ id: Tab; label: string; badge?: number }> = [
    { id: "cut", label: t`剪辑` },
    ...(packaging ? [{ id: "text" as const, label: t`字幕`, badge: lineCount || undefined }] : []),
    { id: "mark", label: t`圈选`, badge: anns.length || undefined },
    { id: "audio", label: t`音频`, badge: audioSpec ? 1 : undefined },
  ];
  /** 音色 id → 名字（目录还没取到 / 目录里没有这一个时退回 id 本身，别画一个空的下拉项） */
  const narratorName = (id: string): string =>
    narrators?.find((n) => n.id === id)?.name ?? (id === narratorOf(null) ? t`知性女声` : id);
  /** 该配音而还没配（或配音过期了）的那几句：有字、字数没超这一段放得下的 */
  const voiceTodo = view.filter((c) => {
    const text = (c.line?.text ?? "").trim();
    if (!text || Math.ceil(lineUnits(text)) > lineCap(durOf(c))) return false;
    return !c.line?.voice || voiceStale(c.line, voiceId);
  });
  /** 紧凑小键（选中 / 没选中两态） */
  const chip = (on: boolean) =>
    `rounded-full px-2.5 py-1.5 text-[11px] ${on ? "bg-brand font-semibold text-ink" : "bg-slate-700/70 text-slate-200"}`;

  return (
    <div className="fixed inset-0 flex flex-col bg-black">
      {/* ── 顶栏 ── */}
      <PageHeader
        className="flex-none px-4"
        title={t`剪辑`}
        onBack={() => {
            // 单段编辑的返回 = 放弃这次改动（不写回方案），得先把单段草稿清掉，
            // 否则那份一段的 draft 会被后面的组稿流程当成真草稿
            if (segEdit) {
              leftRef.current = true;
              useStudio.getState().closeSegmentEdit(false);
              navigate("/studio");
            } else navigate(-1);
        }}
        right={
          <>
        <HelpButton tour="cut" />
        {/* 已经合好的稿子不摆导出档位：这一步不再合成，选了也不作数（想换档位先「回去改」） */}
        {!alreadyMerged && (
        <div className="relative">
          <button
            onClick={() => setResOpen((v) => !v)}
            className="flex items-center gap-1 rounded-full bg-slate-700/70 px-3 py-1.5 text-sm font-semibold text-slate-100"
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
                    // 导出档位记在工程里（随剪辑稿落盘），但不算一步撤销：它不是对时间轴的改动
                    const cur = useCut.getState().project;
                    if (cur) useCut.getState().apply(setRes(cur, r.id), { undo: false });
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
                  <div className="text-[10px] text-slate-400">{t(r.note)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        )}
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
            className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-ink disabled:opacity-40"
          >
            <Trans>保存本段</Trans>
          </button>
        ) : (
          <button
            data-guide="cut-next"
            onClick={() => {
              // 已经合好的就直接去发布 —— 再合一次既没有意义，也做不到（见 alreadyMerged 的 ★★）
              if (alreadyMerged) {
                leftRef.current = true;
                navigate("/publish");
                return;
              }
              void mergeAndGo();
            }}
            disabled={!!busy}
            className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-ink disabled:opacity-40"
          >
            {alreadyMerged ? t`去发布` : t`下一步`}
          </button>
        )}
          </>
        }
      />

      {/* ── 预览区 ── */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* relative：字幕 / 闪黑那一层（CutPreviewLayer）按播放器在这个容器里的位置贴上去 */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          {activeSeg?.videoUrl ? (
            playSrc ? (
              <video
                key={`${active!.id}:${playSrc}`}
                ref={vref}
                src={playSrc}
                playsInline
                className="max-h-full max-w-full"
                // ★ 播放器自己的失败也要上屏（地址过期 / 解码失败），否则又是一块沉默的黑
                onError={(e) => {
                  const code = e.currentTarget.error?.code;
                  const codeText = code ?? "?";
                  setPlayErr(t`这一段播不出来（错误码 ${codeText}）——成片地址可能已经过期或网络不通，回工作流重新打开草稿会重新取一遍`);
                }}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  // 真实时长与申报值对不上：没裁过的片段跟着真实时长走（见 learnRealDur 的 ★★）
                  if (active) learnRealDur(active.segIndex, v.duration);
                  v.currentTime = pendingSeek.current ?? active!.start;
                  pendingSeek.current = null;
                  // 每换一个片段播放器是新的：速度与原声音量要重新交代一遍（见 activeSpeed 那个 effect）
                  v.playbackRate = activeSpeed;
                  v.volume = activeVolume;
                  if (playing) playVideo(v);
                }}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  setT(v.currentTime);
                  // 到达片段出点：跳下一片段接着播（时间轴顺序），最后一个则停。
                  // 预览那一层逐帧也在看（CutPreviewLayer.onClipEnd，更准）；这里留着兜底 —— 页面不可见时那一层的 rAF 不跑
                  if (active && v.currentTime >= endOf(active) - 0.03) advanceClip();
                }}
                onClick={togglePlay}
              />
            ) : (
              <span className="text-xs text-slate-500"><Trans>视频载入中…</Trans></span>
            )
          ) : activeSeg ? (
            <img src={activeSeg.poster || activeSeg.firstFrame} alt="" className="max-h-full max-w-full" />
          ) : null}
          {/* 字幕 / 标题 / 闪黑 / 配音跟着播放头走。合成期间收起（那会儿预览是停的，别让配音在遮罩后面响） */}
          <CutPreviewLayer
            videoRef={vref}
            plan={busy ? null : plan}
            clipId={active?.id ?? null}
            playing={playing}
            voiceUrls={voiceUrls}
            onClipEnd={advanceClip}
          />
        </div>
        {/* 取流/播放失败一律说在预览正下方（用户正盯着的那块），并给一条真能走的路 */}
        {activeSeg?.videoUrl && (playErr || srcErr[active!.segIndex]) && (
          <div className="mx-3 mb-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-rose-200">
            {playErr && <p>{playErr}</p>}
            {srcErr[active!.segIndex] && (
              <p>
                <Trans>圈选与合并要用的截帧流没取到：{srcErr[active!.segIndex]}</Trans>
                <button
                  onClick={() => loadCaptureSrc(active!.segIndex, activeSeg.videoUrl!)}
                  className="ml-2 rounded bg-rose-500/30 px-2 py-0.5 font-semibold text-rose-100"
                >
                  <Trans>重试</Trans>
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
            aria-label={playing ? t`暂停` : t`播放`}
          >
            <Icon name={playing ? "pause" : "play"} size={26} filled />
          </button>
          {/* 「对剪辑台说话」的入口：放在预览这一行（不进某个页签）—— 它管的是整条时间轴，哪个页签开着都用得上。
              合好的稿子与单段编辑没有它：前者改不了时间轴，后者不合成、包装层没处落（见 packaging） */}
          {packaging && !alreadyMerged && project && (
            <button
              data-guide="cut-agent"
              onClick={() => setAgentOpen(true)}
              disabled={!!busy}
              className="ml-auto flex flex-none items-center gap-1 rounded-full bg-slate-700/70 px-3 py-1.5 text-[11px] text-slate-100 disabled:opacity-40"
            >
              <Trans>💬 说一句</Trans>
            </button>
          )}
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
              <Spinner size="lg" />
              <span className="text-center text-xs text-slate-200">{busy}</span>
              {/* ★ 真百分比。2026-09-07 起这个数来自**原生合成器**报的进度（Transformer.getProgress），
                  不再是"已录秒数 / 总秒数" —— 硬件编码通常快于实时，按秒数推算会一直显示得太慢。 */}
              {mergingRef.current && total > 0 && (
                <>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-white/25">
                    <div
                      className="h-full rounded-full bg-brand transition-all duration-200"
                      style={{ width: `${Math.min(100, Math.round((mergeDone / total) * 100))}%` }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums text-slate-400">
                    <Trans>{Math.min(100, Math.round((mergeDone / total) * 100))}% · 还剩约 {formatDuration(Math.max(0, total - mergeDone))}</Trans>
                  </span>
                  {/* ★★ 2026-09-07 这句话跟着实现改了：合并已经**不是录屏**了（原生 Media3 Transformer，
                      走系统硬件编解码器），切到别的应用**不会**再把画面录成卡住的一截。
                      ⚠ 但也别反过来许"随便切"：系统仍可能把 App 冻住甚至杀掉，那会让合成变慢或中断——
                      区别在于**中断会明确报错**，不会像录屏那样悄悄给你一条坏片。
                      ⚠⚠ 主人 2026-09-07 真机反馈"提示还是实时录屏"并据此以为录屏没撤 —— 文案与实现不一致
                      本身就是一次事故（铁律八）：改实现时**必须同一拍改掉描述它的话**。 */}
                  <p className={`text-center text-[10px] leading-relaxed ${hiddenWarn ? "text-amber-300" : "text-slate-500"}`}>
                    {hiddenWarn
                      ? t`刚才切到后台了——合成不会因此录坏画面，但可能被系统拖慢；真断了会明确告诉你`
                      : t`合成走系统硬件编解码，不再录屏——可以切走，只是系统可能把它拖慢`}
                  </p>
                  <button
                    onClick={() => {
                      cancelRef.current = true;
                      setBusy(t`正在停止…`);
                      // 原生那一炉也要真的停下来（Transformer.cancel），不然它照样把片子编完
                      void cancelNativeMerge();
                    }}
                    className="rounded-full border border-slate-500 px-4 py-1.5 text-[11px] text-slate-200"
                  >
                    <Trans>取消合并</Trans>
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
          <Trans>{res.label} 是由 720P 素材放大的 —— 文件更大、合并更久，但<b className="text-amber-100">不会</b>更清晰</Trans>
        </div>
      )}

      {/* ★ B20：面板高度随内容走，不再固定 46%。
          固定值的代价是两头都不舒服：3 个片段时浪费近一半屏，而「圈选」这一页
          恰恰是最需要大画面的（要看清要圈的东西）。
          ⚠ 只改高度上限，不动"面板收起时 `<video>` 会不会进不可见状态"那条 ——
            圈选取帧走的正是"等 seeked"那条路，画面真被隐藏就永远等不到。 */}
      {/* ★★ 合成期间这一整块**禁掉**（2026-09-08）：那层「合成中」的遮罩是 `absolute inset-0`、
          挂在预览容器里，**盖不到这里** —— 于是合成跑着的时候还能切页签、换配乐、删片段，
          而这一炉的素材在点「下一步」那一拍就已经定死了（clips / audioArg 都是闭包里的值）。
          改了不生效、屏幕上也不说，正是本仓最不待见的那种"看起来能点其实没用"。
          ⚠ 只禁这一块，**顶栏不禁**：离开这一页现在是安全的（合成领了票、跑完不会把人拽走），
          用户想走就该走得掉。 */}
      <div
        className={`safe-bottom flex flex-none flex-col border-t border-slate-700/60 bg-[#141821] ${
          tab === "mark" ? "max-h-[38%]" : "max-h-[52%]"
        } ${busy ? "pointer-events-none opacity-40" : ""}`}
        aria-disabled={!!busy}
      >
        {busy ? (
          <div className="flex-none px-4 pt-2 text-center text-[11px] leading-relaxed text-slate-400">
            <Trans>合成中——这里的改动不会进这一炉</Trans>
          </div>
        ) : null}
        {/* 见 presetAudioDrift 的 ★★：合并之前说，此刻改还来得及 */}
        {!busy && presetAudioDrift ? (
          <div className="mx-4 mt-2 flex-none rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-100">
            <Trans>你动过片段（裁剪 / 删段 / 换序），而配乐是自动预置的原片音轨——它按原片从头混，合出来会和画面对不上。想对齐就在「音频」里换一条自己的，或把片段改回原样。</Trans>
          </div>
        ) : null}
        {/* 剪辑改动没存住（见 saveWarn 那个 effect 的 ★）：说清楚后果是什么 —— 不是钱没了，是离开这一页会丢 */}
        {!busy && saveWarn ? (
          <div className="mx-4 mt-2 flex-none rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-100">
            <Trans>刚才的剪辑改动这一页上还在，但{saveWarn}——离开剪辑页之前先处理一下，否则这些改动会丢。</Trans>
          </div>
        ) : null}
        {alreadyMerged ? (
          // ── 已经合好的稿子：这一步不再合成，只剩两条路 —— 去发布，或者回到合并之前接着改 ──
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
            {err && (
              <div className="mb-2.5 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                <span className="min-w-0 flex-1">{err}</span>
                <button onClick={() => setErr("")} className="flex-none">
                  <Icon name="close" size={14} />
                </button>
              </div>
            )}
            <div className="rounded-xl border border-slate-700/70 bg-panel p-3">
              <div className="mb-1.5 text-xs font-semibold text-slate-300"><Trans>这条成片已经合好了</Trans></div>
              <p className="text-[11px] leading-relaxed text-slate-400">
                {canReopen ? (
                  <Trans>右上角可以直接去发布。想再改片段、圈选或配乐，就回到合并之前接着剪——原来的时间轴都还在，改完重新合一次（合成不花钱）。</Trans>
                ) : (
                  <Trans>右上角可以直接去发布。这条成片没有留下合并之前的片段（它是旧版本合的），要改只能回工作流重做一条。</Trans>
                )}
              </p>
              {canReopen && (
                <button
                  onClick={reopen}
                  className="mt-2.5 w-full rounded-xl bg-slate-700/70 py-2.5 text-sm font-bold text-slate-100"
                >
                  <Trans>↩ 回去改</Trans>
                </button>
              )}
            </div>
          </div>
        ) : (
        <>
        <div data-guide="cut-tabs" className="flex flex-none items-center justify-center gap-7 px-4 pt-3">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`relative pb-1.5 text-sm ${
                tab === tb.id ? "border-b-2 border-brand font-bold text-white" : "text-slate-400"
              }`}
            >
              {tb.label}
              {tb.badge != null && (
                <span className="absolute -right-3.5 -top-0.5 rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                  {tb.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
          {err && (
            <div className="mb-2.5 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              <span className="min-w-0 flex-1">{err}</span>
              <button onClick={() => setErr("")} className="flex-none">
                <Icon name="close" size={14} />
              </button>
            </div>
          )}

          {tab === "cut" && (
            <>
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                <span><Trans>{view.length} 个片段 · 共 {formatDuration(total)}</Trans></span>
                {/* 撤销 / 重做：管的是片段、圈选与配乐的改动（导出档位不算一步）。合并、重拍落地之后栈会清空 ——
                    那两件事之前的时间轴已经不是"上一步"了 */}
                <span className="flex flex-none items-center gap-1.5">
                  <button
                    onClick={undo}
                    disabled={!canUndo}
                    className="rounded-full bg-slate-700/70 px-2.5 py-1 text-[11px] text-slate-200 disabled:opacity-40"
                  >
                    <Trans>↶ 撤销</Trans>
                  </button>
                  <button
                    onClick={redo}
                    disabled={!canRedo}
                    className="rounded-full bg-slate-700/70 px-2.5 py-1 text-[11px] text-slate-200 disabled:opacity-40"
                  >
                    <Trans>↷ 重做</Trans>
                  </button>
                </span>
              </div>
              <div data-guide="cut-timeline" className="flex gap-1 no-scrollbar overflow-x-auto rounded-xl bg-black/40 p-1.5">
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
                        const cur = useCut.getState().project;
                        if (!from || from === c.id || !cur) return;
                        // 一路拖过去会触发很多次：整趟拖拽只记一步撤销（coalesce），松手时封口
                        const r = reorderClip(cur, from, c.id);
                        if (r.ok) useCut.getState().apply(r.project, { coalesce: "drag" });
                      }}
                      onDragEnd={() => {
                        dragClip.current = null;
                        useCut.getState().seal();
                      }}
                      onClick={() => {
                        setSel(c.id);
                        pendingSeek.current = c.start;
                        setActiveIdx(i);
                      }}
                      style={{ width: `${Math.max(11, (durOf(c) / Math.max(0.01, total)) * 100)}%` }}
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
                      <span className="absolute left-1 top-0.5 flex items-center gap-1 rounded bg-black/65 pr-1 text-[9px] text-slate-200">
                        {/* ★ 一个片段两个数，长得不一样：亮底的是**从左数的位置**（「对剪辑台说话」认的「片段 2」就是它），
                            后面的「段 N」是它出自稿子的第几段。换过序 / 切过 / 删过之后两个数对不上 —— 只标「段 N」的话，
                            人照着缩略图说「第 3 段」，办到的却是从左数第 3 个（cutProject.segRefClip 的 ★） */}
                        <b className="rounded-l bg-brand px-1 font-bold text-ink">{i + 1}</b>
                        <span>
                          <Trans>段{c.segIndex + 1} · {durOf(c).toFixed(1)}s</Trans>
                          {/* ★ 裁过要看得出来：否则"这段怎么短了"只能靠回忆，而裁剪是可还原的 */}
                          {clipTrimmed(c) && <span className="ml-0.5">✂</span>}
                        </span>
                      </span>
                      {/* 这一段挂着什么包装也要看得出来（变速 / 从黑里进来 / 有字幕 / 有配音）：不然"这段怎么变快了"
                          同样只能靠回忆，而它们都藏在选中之后才出现的那块面板里 */}
                      {(clipSpeed(c) !== 1 || c.fade || c.line?.text.trim()) && (
                        <span className="absolute bottom-0.5 left-1 rounded bg-black/65 px-1 text-[9px] text-slate-200">
                          {c.fade ? "◐ " : ""}
                          {clipSpeed(c) !== 1 ? `${clipSpeed(c)}× ` : ""}
                          {c.line?.text.trim() ? (c.line.voice ? "🔊" : "💬") : ""}
                        </span>
                      )}
                      {nAnn > 0 && (
                        <span className="absolute right-1 top-0.5 rounded-full bg-rose-500/90 px-1 text-[9px] font-bold text-white">
                          ⭕{nAnn}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-1 text-[10px] text-slate-500"><Trans>拖拽换序 · 点击选中</Trans></p>
              {/* 被删光了片段的段：摆出来、一点就加回（见 restoreSegment 的 ★）。没有缺的段时这一行不占地方 */}
              {(() => {
                const missing = project ? missingSegs(project, segs.length) : [];
                return missing.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-slate-500"><Trans>不在时间轴上的段，点一下加回来：</Trans></span>
                    {missing.map((i) => (
                      <button
                        key={i}
                        onClick={() => restoreSegment(i)}
                        className="rounded-full bg-slate-700/70 px-2.5 py-1 text-[11px] text-slate-200"
                      >
                        <Trans>＋ 段{i + 1}</Trans>
                      </button>
                    ))}
                  </div>
                ) : null;
              })()}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <button
                  onClick={splitAtPlayhead}
                  disabled={!sel}
                  className="rounded-full bg-slate-700/70 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-40"
                >
                  <Trans>✂️ 播放头处分割</Trans>
                </button>
                <button
                  onClick={() => sel && moveClip(sel, -1)}
                  disabled={!sel}
                  className="rounded-full bg-slate-700/70 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-40"
                >
                  <Trans>◀ 前移</Trans>
                </button>
                <button
                  onClick={() => sel && moveClip(sel, 1)}
                  disabled={!sel}
                  className="rounded-full bg-slate-700/70 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-40"
                >
                  <Trans>后移 ▶</Trans>
                </button>
                <button
                  onClick={() => sel && removeClip(sel)}
                  disabled={!sel || view.length <= 1}
                  className="rounded-full bg-rose-500/15 px-2.5 py-1.5 text-[11px] text-rose-300 disabled:opacity-40"
                >
                  <Trans>🗑 删除片段</Trans>
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
                  className="rounded-full bg-slate-700/70 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-40"
                >
                  <Trans>⇤ 从这里开始</Trans>
                </button>
                <button
                  onClick={() => trimTo("end")}
                  disabled={!sel}
                  className="rounded-full bg-slate-700/70 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-40"
                >
                  <Trans>到这里结束 ⇥</Trans>
                </button>
                {/* 只在**真裁过**时才出现：没裁过的时候它是一颗永远没反应的键 */}
                {(() => {
                  const tc = view.find((c) => c.id === sel);
                  // ★ 「分割出来的」不算"裁过"：两半的 start/end 天然不等于整段，
                  //   照这个表达式判会把分割也标成裁剪、并摆出一颗按下去必被拒的「还原整段」。
                  const trimmed = !!tc && !!project && !hasSibling(project, tc) && clipTrimmed(tc);
                  return trimmed ? (
                    <button
                      onClick={resetTrim}
                      className="rounded-full border border-slate-600 px-2.5 py-1.5 text-[11px] text-slate-300"
                    >
                      <Trans>还原整段</Trans>
                    </button>
                  ) : null;
                })()}
              </div>
              {!sel && <p className="mt-1.5 text-[10px] text-slate-500"><Trans>先点上面的片段选中，再用这排按钮</Trans></p>}
              {/* 包装层（2026-09-30）：选中的这一段自己的三样 —— 速度 / 原声 / 转场，外加整条片子的片尾淡出。
                  ★ 改的都是 cutProject 里那几格，预览当场照着变（播放速度、原声音量、黑场遮罩），合成器照的是同一份计划 */}
              {project &&
                packaging &&
                (() => {
                  const sc = view.find((c) => c.id === sel) ?? null;
                  const seg = sc ? segs[sc.segIndex] : undefined;
                  const vol = sc ? clipVolume(sc) : 1;
                  // 这一段与上一段之间是不是同一个镜头在延续（接着上一段尾帧拍的 / 分割出来的两半）：是的话加转场会把接缝撕开
                  const seam = sc ? seamContinuous(project, project.clips.findIndex((c) => c.id === sc.id), segs) : false;
                  const fadeUnsure = !!plan && !plan.exact && (!!project.endFade || project.clips.some((c) => c.fade));
                  return (
                    <div className="mt-2 rounded-xl bg-black/40 p-2.5">
                      {sc ? (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="w-8 flex-none text-[10px] text-slate-500"><Trans>速度</Trans></span>
                            <div className="flex min-w-0 gap-1 no-scrollbar overflow-x-auto rounded-full bg-panel p-0.5">
                              {SPEEDS.map((s) => (
                                <button
                                  key={s}
                                  onClick={() => editSel((p, id) => setClipSpeed(p, id, s))}
                                  className={`flex-none rounded-full px-3 py-1 text-[11px] ${
                                    clipSpeed(sc) === s ? "bg-brand font-semibold text-ink" : "text-slate-300"
                                  }`}
                                >
                                  {s}×
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="w-8 flex-none text-[10px] text-slate-500"><Trans>原声</Trans></span>
                            {seg?.hasAudio === false ? (
                              // 判否定：只有明确知道这一段没声音才这么说（老剪辑稿没有这一位 = 不知道，照常给滑杆）
                              <span className="text-[11px] text-slate-500"><Trans>这一段的画面本身没有声音</Trans></span>
                            ) : (
                              <>
                                <input
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={vol}
                                  onChange={(e) => editSel((p, id) => setClipVolume(p, id, Number(e.target.value)), `vol:${sc.id}`)}
                                  onPointerUp={() => useCut.getState().seal()}
                                  onKeyUp={() => useCut.getState().seal()}
                                  aria-label={t`这一段原声的音量`}
                                  className="min-w-0 flex-1 accent-brand"
                                />
                                <span className="w-9 flex-none text-right text-[10px] tabular-nums text-slate-400">{Math.round(vol * 100)}%</span>
                                {sc.volume !== undefined && sc.line?.voice ? (
                                  <button
                                    onClick={() => editSel((p, id) => setClipVolume(p, id, null))}
                                    className="flex-none rounded-full bg-slate-700/70 px-2.5 py-1 text-[11px] text-slate-200"
                                  >
                                    <Trans>交回自动</Trans>
                                  </button>
                                ) : null}
                              </>
                            )}
                          </div>
                          {sc.volume === undefined && sc.line?.voice && seg?.hasAudio !== false ? (
                            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                              <Trans>这一段有配音：原声自动压到 {Math.round(BED_GAIN * 100)}%（配音为主）。拖一下滑杆就按你定的来。</Trans>
                            </p>
                          ) : null}
                        </>
                      ) : null}
                      <div className={`flex flex-wrap items-center gap-1.5 ${sc ? "mt-2" : ""}`}>
                        <span className="w-8 flex-none text-[10px] text-slate-500"><Trans>转场</Trans></span>
                        {sc ? (
                          <button onClick={() => editSel((p, id) => setClipFade(p, id, !sc.fade))} className={chip(!!sc.fade)}>
                            <Trans>◐ 这一段从黑里进来</Trans>
                          </button>
                        ) : null}
                        <button onClick={() => editProject((p) => setEndFade(p, !p.endFade))} className={chip(!!project.endFade)}>
                          <Trans>◑ 片尾淡出</Trans>
                        </button>
                      </div>
                      {!sc && (
                        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                          <Trans>选中一个片段，还能调它的速度、原声音量，或者让它从黑里淡入。</Trans>
                        </p>
                      )}
                      {sc?.fade && seam === true ? (
                        <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200">
                          <Trans>这一段是接着上一段拍的（同一个镜头在延续）——在这儿加转场会把接缝撕开。想要换场的感觉，加在别的接缝上更合适。</Trans>
                        </p>
                      ) : null}
                      {fadeUnsure ? (
                        <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200">
                          <Trans>有一段的真实时长还没量到，转场的位置定不准，预览里先不显示——把每一段各播一下就量到了。</Trans>
                        </p>
                      ) : null}
                    </div>
                  );
                })()}
            </>
          )}

          {tab === "text" && project && packaging && (
            <>
              {/* ✨ 一键成片（结构化技能，studio/cutAutoEdit）：模型写底稿，人在确认卡上看过、改过才落进来 */}
              <button
                onClick={() => setAutoOpen(true)}
                disabled={voicing.size > 0}
                className="mb-2.5 flex w-full items-center gap-2 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2.5 text-left disabled:opacity-40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-brand"><Trans>✨ 一键成片</Trans></span>
                  <span className="block text-[10px] leading-relaxed text-slate-400">
                    <Trans>片头标题、每段一句旁白、换场的转场，一次写好——你看过、改过再用</Trans>
                  </span>
                </span>
                <span className="flex-none text-[11px] text-slate-300">{AI_REAL ? fmtTokens(AUTO_EDIT.cost) : t`演示`}</span>
              </button>
              <input
                value={project.title ?? ""}
                maxLength={TITLE_MAX_CHARS}
                onChange={(e) => editProject((p) => setTitle(p, e.target.value), "title")}
                onBlur={() => useCut.getState().seal()}
                placeholder={t`片头标题（可不填；写了会烧在成片开头几秒）`}
                aria-label={t`片头标题`}
                className="w-full rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
              />
              <div className="mt-2 flex items-center gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-slate-300">
                  <input
                    type="checkbox"
                    className="accent-brand"
                    checked={!project.capOff}
                    onChange={(e) => editProject((p) => setCaptionsOn(p, e.target.checked))}
                  />
                  <Trans>字幕烧进画面</Trans>
                </label>
                {canVoice ? (
                  <select
                    value={voiceId}
                    onChange={(e) => editProject((p) => setVoiceId(p, e.target.value))}
                    aria-label={t`配音音色`}
                    className="max-w-[10rem] flex-none rounded-lg border border-slate-700 bg-panel px-2 py-1.5 text-[11px] text-slate-200 outline-none"
                  >
                    {/* 目录还没取到 / 目录里没有现在这一个：先把它自己摆出来，别让下拉框显示成空的 */}
                    {!narrators?.some((n) => n.id === voiceId) && <option value={voiceId}>{narratorName(voiceId)}</option>}
                    {narrators && (
                      <>
                        <optgroup label={t`女声`}>
                          {narrators.filter((n) => n.group === "female").map((n) => (
                            <option key={n.id} value={n.id}>{n.name}</option>
                          ))}
                        </optgroup>
                        <optgroup label={t`男声`}>
                          {narrators.filter((n) => n.group === "male").map((n) => (
                            <option key={n.id} value={n.id}>{n.name}</option>
                          ))}
                        </optgroup>
                      </>
                    )}
                  </select>
                ) : null}
              </div>
              {!project.capOff ? null : (
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  <Trans>字幕不烧进画面：成片里只有配音（没配音的那几句就什么都没有）。</Trans>
                </p>
              )}
              {narratorErr ? (
                <p className="mt-1 text-[10px] leading-relaxed text-amber-200">
                  <Trans>音色目录没取到（{narratorErr}）——先用现在这个音色。</Trans>
                </p>
              ) : null}
              {plan && plan.timed && !plan.exact ? (
                <p className="mt-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-100">
                  <Trans>有一段的真实时长还没量到，字幕和配音的时间可能排得不准——把每一段各播一下就量到了（合成前也会再量一次）。</Trans>
                </p>
              ) : null}
              <div className="mt-2 space-y-2">
                {view.map((c, i) => {
                  const text = c.line?.text ?? "";
                  const cap = lineCap(durOf(c));
                  // 这一句念出来有多长（一个汉字算 1、一个字母算 0.4，见 cutProject.lineUnits）—— 与这一段念得完的量比
                  const chars = Math.ceil(lineUnits(text));
                  const v = c.line?.voice;
                  const stale = voiceStale(c.line, voiceId);
                  const pv = plan?.voices.find((x) => x.clipId === c.id);
                  const dropped = !!plan?.dropped.includes(c.id);
                  const making = voicing.has(c.id);
                  const seg = segs[c.segIndex];
                  const cutShort = pv ? pv.durSec - pv.playSec : 0;
                  return (
                    <div
                      key={c.id}
                      className={`rounded-xl border bg-black/40 p-2 ${i === activeIdx ? "border-cyan-400/60" : "border-transparent"}`}
                    >
                      <div className="mb-1.5 flex items-center gap-2">
                        <button
                          onClick={() => {
                            setSel(c.id);
                            pendingSeek.current = c.start;
                            setActiveIdx(i);
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          {seg.poster || seg.firstFrame ? (
                            <img src={seg.poster || seg.firstFrame} alt="" className="h-7 w-7 flex-none rounded object-cover" />
                          ) : (
                            <span className="h-7 w-7 flex-none rounded bg-ink/60" />
                          )}
                          {/* 与时间轴缩略图上同一个编号（从左数的位置，见那边的 ★） */}
                          <b className="flex-none rounded bg-brand px-1 text-[10px] font-bold text-ink">{i + 1}</b>
                          <span className="truncate text-[11px] text-slate-300">
                            <Trans>段{c.segIndex + 1} · {durOf(c).toFixed(1)}s</Trans>
                          </span>
                        </button>
                        <span className={`flex-none text-[10px] tabular-nums ${chars > cap ? "text-amber-300" : "text-slate-500"}`}>
                          {chars}/{cap}
                        </span>
                      </div>
                      <textarea
                        rows={2}
                        value={text}
                        maxLength={LINE_MAX_CHARS}
                        onChange={(e) => editLine(c.id, e.target.value)}
                        onBlur={() => useCut.getState().seal()}
                        placeholder={t`这一段的字幕 / 旁白（一句话）`}
                        className="w-full resize-none rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
                      />
                      {text.trim() ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {making ? (
                            <span className="flex items-center gap-1.5 text-[11px] text-slate-300">
                              <Spinner size="xs" />
                              <Trans>配音合成中…</Trans>
                            </span>
                          ) : v ? (
                            <>
                              <button onClick={() => void audition(c.id, v.ref)} className={chip(auditioning === c.id)}>
                                {auditioning === c.id ? t`■ 停` : t`▶ 试听 ${v.durSec.toFixed(1)}s`}
                              </button>
                              <button
                                onClick={() => void runVoices([c.id])}
                                disabled={!canVoice || voicing.size > 0 || chars > cap}
                                className={`${stale ? "rounded-full bg-amber-400/90 px-2.5 py-1.5 text-[11px] font-semibold text-ink" : chip(false)} disabled:opacity-40`}
                              >
                                <Trans>↻ 重新配音</Trans>
                              </button>
                              <button
                                onClick={() => {
                                  const cur = useCut.getState().project;
                                  if (cur) commit(setClipVoice(cur, c.id, null));
                                }}
                                className="rounded-full bg-rose-500/15 px-2.5 py-1.5 text-[11px] text-rose-300"
                              >
                                <Trans>去掉配音</Trans>
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => void runVoices([c.id])}
                              disabled={!canVoice || voicing.size > 0 || chars > cap}
                              className={`${chip(false)} disabled:opacity-40`}
                            >
                              <Trans>🔊 配音</Trans>
                            </button>
                          )}
                        </div>
                      ) : null}
                      {chars > cap ? (
                        <p className="mt-1 text-[11px] leading-relaxed text-amber-200">
                          <Trans>这一句比这一段放得下的字数多了（{chars}/{cap}），配不了音——改短一点，或者把这一段留长 / 放慢。</Trans>
                        </p>
                      ) : null}
                      {stale ? (
                        <p className="mt-1 text-[11px] leading-relaxed text-amber-200">
                          <Trans>字（或音色）改过了，这句配音还是之前合成的那一版——重新配一次，否则成片里念的和字幕对不上。</Trans>
                        </p>
                      ) : null}
                      {pv && cutShort > 0.05 ? (
                        <p className="mt-1 text-[11px] leading-relaxed text-amber-200">
                          <Trans>这一句念不完：到片尾还差 {cutShort.toFixed(1)} 秒，成片里会在片尾被掐掉。改短一点，或者把这一段留长。</Trans>
                        </p>
                      ) : pv && pv.overSec > 0.05 ? (
                        <p className="mt-1 text-[11px] leading-relaxed text-amber-200">
                          <Trans>这一句要念 {pv.durSec.toFixed(1)} 秒，比这一段长 {pv.overSec.toFixed(1)} 秒——会念到下一段里（后面的配音跟着往后顺）。改短一点，或者把这一段放慢 / 留长。</Trans>
                        </p>
                      ) : null}
                      {pv && pv.lateSec > 0.05 ? (
                        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                          <Trans>上一句还没念完，这一句晚 {pv.lateSec.toFixed(1)} 秒开始。</Trans>
                        </p>
                      ) : null}
                      {dropped ? (
                        <p className="mt-1 text-[11px] leading-relaxed text-rose-300">
                          <Trans>这一句排不上：片段太短，或者被上一句配音挤到了片尾之外——成片里不会有它。</Trans>
                        </p>
                      ) : null}
                      {v?.rate && !stale ? (
                        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                          <Trans>为了在这一段里念完，语速提到了 {(1 + v.rate / 100).toFixed(2)} 倍。</Trans>
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {canVoice ? (
                // 没有该配的句子时这颗键不摆「给 0 句配音」：要么还一句字幕都没写（先说该干什么），要么都配好了（说配好了）
                lineCount === 0 ? (
                  <p className="mt-2.5 text-center text-[11px] leading-relaxed text-slate-500">
                    <Trans>先给上面的片段写一句话，就能把它配成声音。</Trans>
                  </p>
                ) : (
                  <button
                    onClick={() => void runVoices(voiceTodo.map((c) => c.id))}
                    disabled={voiceTodo.length === 0 || voicing.size > 0}
                    className="mt-2.5 w-full rounded-xl bg-cyan-500/85 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
                  >
                    {voicing.size > 0
                      ? t`配音合成中…`
                      : voiceTodo.length > 0
                        ? t`🔊 给 ${voiceTodo.length} 句配音（现在免费）`
                        : t`✓ 能配的句子都配好了`}
                  </button>
                )
              ) : (
                <p className="mt-2.5 rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-400">
                  <Trans>配音要连上服务器才能合成（离线 / 演示模式下用不了）。字幕照常能写、能烧进画面。</Trans>
                </p>
              )}
              <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                <Trans>一段一句，字数按这一段的时长封顶。有配音时，配乐会自动压到 {Math.round(BGM_DUCK * 100)}%、这一段的原声压到 {Math.round(BED_GAIN * 100)}%（配音为主）。</Trans>
              </p>
            </>
          )}

          {tab === "mark" && (
            <>
              <button
                onClick={openAnnotator}
                disabled={!!busy}
                className="w-full rounded-xl bg-slate-700/70 py-2.5 text-sm font-semibold text-slate-100 disabled:opacity-40"
              >
                <Trans>⭕ 圈选当前这一帧</Trans>
              </button>
              {/* 一句精华，展开讲在引导（tours 的 cut）里 */}
              <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                <Trans>可跨帧跨段圈多处，最后一次性重新生成——那一步才计费。</Trans>
              </p>
              {anns.length > 0 && (
                <>
                  <div className="mt-2.5 flex gap-2 no-scrollbar overflow-x-auto pb-1">
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
                          {live ? t`段${a.segIndex + 1}` : t`段已删`} · {a.req}
                        </div>
                        <button
                          onClick={() => {
                            const cur = useCut.getState().project;
                            if (cur) useCut.getState().apply(removeAnn(cur, a.id));
                          }}
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
                    <Trans>✨ 按 {liveAnns.length} 处圈选重新生成（{annBySeg.size} 段 · {fmtTokens(annCost)}）</Trans>
                  </button>
                  {liveAnns.length < anns.length && (
                    <p className="mt-1 text-center text-[10px] text-slate-500">
                      <Trans>另有 {anns.length - liveAnns.length} 处落在已删掉的段上，不计费也不会重拍</Trans>
                    </p>
                  )}
                </>
              )}
            </>
          )}

          {tab === "audio" &&
            (audioSpec ? (
              <>
              <div className="flex items-center gap-2.5 rounded-xl bg-black/40 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-xs text-slate-200">🎵 {audioName}</span>
                <span className="flex-none text-[10px] text-slate-500"><Trans>音量</Trans></span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={audioSpec.volume}
                  onChange={(e) => {
                    const cur = useCut.getState().project;
                    if (cur) applyAudio(setAudioVolume(cur, Number(e.target.value)), "volume");
                  }}
                  // 松手 = 这一趟调音量到此为止：下一趟另记一步撤销
                  onPointerUp={() => useCut.getState().seal()}
                  onKeyUp={() => useCut.getState().seal()}
                  className="w-24 flex-none accent-brand"
                />
                <button
                  onClick={() => {
                    // ★ 不在这里回收地址 / 删本地库里那份：这一步能撤销，撤回来还要播它。
                    //   真没人引用了由 cacheSweep 收（见那边 SWEEPABLE 的 ★）
                    const cur = useCut.getState().project;
                    if (cur) applyAudio(setAudioOp(cur, null));
                  }}
                  aria-label={t`去掉这条配乐`}
                  className="flex-none text-rose-300"
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
              {/* 工程里记着这条配乐，可它的文件读不出来：说出来、给出路 —— 不说的话这一行亮着，人会以为它能进成片 */}
              {!audio && audioSpec.kind === "local" && localAudio?.failed ? (
                <p className="mt-1.5 text-[11px] leading-relaxed text-rose-300">
                  <Trans>这条音频的文件读不出来了（可能被清理过）——去掉它重新挑一条，否则合成时不会有配乐。</Trans>
                </p>
              ) : null}
              {/* 滑杆上写的是人定的音量；有配音时成片里还要再压一道（计划里的 bgmGain）—— 不说的话，滑杆 80% 而听到的只有两三成 */}
              {plan && plan.bgmGain < 1 ? (
                <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                  <Trans>这条片子有配音：配乐会在你定的音量上再压到 {Math.round(plan.bgmGain * 100)}%（配音为主），预览里听到的就是压过之后的。</Trans>
                </p>
              ) : null}
              </>
            ) : (
              <>
                {audioHint ? (
                  <button
                    onClick={() => {
                      const cur = useCut.getState().project;
                      if (cur) applyAudio(setAudioOp(cur, { kind: "preset", volume: 1 }));
                    }}
                    className="mb-2 w-full rounded-xl bg-panel py-2.5 text-sm font-bold text-slate-100"
                  >
                    <Trans>🔊 用模板原声</Trans>
                  </button>
                ) : null}
                <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-slate-600 py-3 text-xs text-slate-400 hover:border-brand">
                  <Trans>＋ 添加本地音频作为 BGM</Trans>
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void pickLocalAudio(f);
                    }}
                  />
                </label>
                {/* 「AI 画面本身没声音」挪进了引导第一步——这里留操作性的那一句就够 */}
                <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                  <Trans>合并时混进成片，短于成片会自动循环。</Trans>
                </p>
              </>
            ))}
        </div>
        </>
        )}
      </div>

      {autoOpen && project && (
        <AutoEditSheet
          project={project}
          segs={segs}
          lens={lens}
          canVoice={canVoice}
          voiceName={narratorName(voiceId)}
          onClose={() => setAutoOpen(false)}
          onApply={applyAuto}
        />
      )}

      {/* 合成 / 重拍期间收起：那会儿时间轴改了也不进这一炉（agentCtx 同样会拒，这里是别让人对着一个必被拒的输入框说话） */}
      {agentOpen && !busy && packaging && !alreadyMerged && project && (
        <CutAgentSheet onRun={runAgent} onClose={() => setAgentOpen(false)} />
      )}

      {annOpen && (
        <FrameAnnotator
          frame={annOpen.frame}
          hint={t`先存起来，圈完所有要改的地方再一次性重新生成`}
          onClose={() => setAnnOpen(null)}
          onSave={(frame, req) => {
            const cur = useCut.getState().project;
            if (cur) {
              useCut
                .getState()
                .apply(addAnn(cur, { id: uid("ann"), segIndex: annOpen.segIndex, atSec: annOpen.atSec, frame, req }));
            }
            setAnnOpen(null);
          }}
        />
      )}

    </div>
  );
}
