// 视频编辑页【模式一 · 白模化前】：作者选好一段原视频，在这里框出要处理的那一段、
// 把水印裁到画面外，确认报价与风险后交给上层去开炼。
//
// 交出去的是 `{ startSec, durSec, crop:{x,y,w,h} }` 四组整数，**不是 URL** ——
// Cloudinary 变换地址由服务端拿这四组数自己拼（方案 A3-2）。客户端碰得到那个 URL，
// 就等于让用户自己改 `du_` 改计价时长。
//
// ★ 只收 props、只往上报数据，不认识任何 store（PlanBoard 同款约束）：这一屏的宿主
//   不止一个（独立路由页 / 将来可能直接嵌在提取器里），状态形状也不同。
//
// ── 这一屏必须说清的四件事（少一件就是把成本或风险藏起来）─────────────
//  ① **差在哪**：不满足方舟输入窗口时，当场一句话说明差多少、该往哪拖（不是灰按钮）；
//  ② **要花多少**：白模化是**真实付费出片**（看帧 + r2v edit 两笔），开炼前整句报出；
//  ③ **可能白花**：F11 —— 含真人面孔的视频**受理之后**才失败，那时算力已经消耗，
//     费用不退。这句必须在按钮**上方**常驻，不能藏进"了解更多"；
//  ④ **AI 看哪几帧**（2026-08-15 加）：看漏了人，画面上照样会站着一个白人偶，但清单里
//     没有他的位置 —— 谁的卡都挂不上去，而且他还会把别人的「从左数第几个」挤歪一位
//     （老编号方案下的形态是"他身上没有编号"）。默认按时长自动取帧；人数会变的素材由作者自己标 ——
//     交互在 `VisionFramePicker`，帧数同时是报价的一半，所以两者必须读同一个来源。
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import CropOverlay from "./CropOverlay";
import TrimBar from "./TrimBar";
import VideoStage, { type VideoStageHandle } from "./VideoStage";
import VisionFramePicker, { type FrameMark, type VisionMode } from "./VisionFramePicker";
import TokenCost from "../TokenCost";
import {
  BLOCKOUT_INPUT_RULES,
  frameTimesOf,
  fullFrameCrop,
  initialSelection,
  selectableSeconds,
  selectionIssue,
  selectionSummary,
  type BlockoutSelection,
  type VideoNatural,
} from "./arkVideoRules";
import {
  blockoutTemplateCost,
  blockoutTier,
  blockoutizeCost,
  blockoutizeIssue,
  fmtTokens,
  modelLabel,
  r2vTokens,
} from "../../data/economy";
import { autoVisionFrames, visionFrameCount } from "../../data/templates";

/** 本机解出来的时长与登记值差多少算"对不上"（秒）。
 *  ★ 登记值是 Cloudinary 回执里**取整**过的秒数，本机是浮点 —— 正常就能差 0.5。
 *    1.5 秒是留了三倍余量的门槛：低于它是取整差异，高于它就是两边在说两条不同的视频。 */
const DUR_TOLERANCE_SEC = 1.5;

export interface BlockoutTrimmerProps {
  /** 原视频的**本机可播地址**（本地文件的 objectURL，或已经在线的 https）。只用于播放取景 */
  src: string;
  /**
   * 画面尺寸与时长的**权威值**（服务端登记值 = Cloudinary 读出来的那份）。
   *
   * ★ 缺省 = 还没上传过（V2 主路就是这样：提取器把 File 交过来，上传发生在开炼那一步），
   *   这时退回用 `<video>` 本机解出来的值画时间轴与裁剪框，并把这件事**说出来**。
   * ★ 有登记值就一定要传：服务端拼变换 URL、复核裁后元数据、按 `du_` 计价用的都是那一份，
   *   两边不是同一组数就会变成"用户按 A 报价、服务端按 B 结算"。传了之后这里还会**比对**
   *   本机值，对不上当场停（见 sizeMismatch 的 ★）。
   */
  natural?: VideoNatural;
  /** 提交中：所有交互禁掉（不隐藏——藏起来用户会以为页面坏了） */
  busy?: boolean;
  /** 提交中的进度话（"正在上传原始视频…"/"AI 正在看帧…"），整句显示 */
  busyNote?: string;
  /** 上一次失败的整句原因（服务端 message 原文透传）。★ 一律显示，不吞 */
  error?: string;
  /**
   * 关掉「**AI 看哪几帧**」那一块。
   *
   * ★★ 它只服务「AI 把人换成白模人偶」那条路：那一步是**先看后点名** —— 抽几帧列出
   *   画面里有谁，再照这份清单写白模化提示词。而「本来就是白模片，直接用」那条路
   *   **根本不做白模化**，它要挑的是"认人量框看哪几帧"，那是另一块（BoxFramePicker），
   *   由提取器摆在同一屏的 extra 里。
   * ★ 两块同时出现时，同一屏上会有两个叫法几乎一样的「看哪几帧 / 分析哪几帧」，
   *   而它们的上限、时机、后果都不同 —— 用户没有任何办法分辨该改哪一个。
   */
  hideVisionFrames?: boolean;
  submitLabel?: string;
  /** 宿主往按钮上方塞的自定义表单（标题/补充说明之类）。组件自己不认识那些字段 */
  extra?: ReactNode;
  /**
   * 选段的裁决权 —— 不给就用白模化那组判词（selectionIssue + selectionSummary，原行为）。
   *
   * ★★ 为什么要有这个口子（2026-08-20）：这一屏的宿主已经不止白模化一条路，而
   *   「自带参考视频」那条路对同一份选段的裁决**真的不同**（像素门豁免 —— 那条路的
   *   服务端会放大；>30 秒不再是拒绝而是换走分段登记）。判词写在 arkVideoRules 里
   *   （ownRefSingleVerdict / ownRefSplitVerdict），本组件只负责把 issue 画红、ok 画绿 ——
   *   在这里塞一个 route 开关自己分支，就是把"哪条路怎么判"抄进组件（它不该认识路）。
   */
  judge?: (sel: BlockoutSelection, natural: VideoNatural) => { issue: string | null; ok: string };
  /**
   * 报价区的替换渲染 —— 不给就出白模化那两笔（blockoutizeCost）+「受理后失败不退费」。
   *
   * ★★ 给了就**连 F11 那句一起换掉**：那句说的是 r2v「受理之后才拒绝、算力已耗、费用
   *   不退」，是白模化那条路独有的风险档 ——「自带参考视频」不出片，挂着它就是拿别条路
   *   的风险话术吓自己的用户。宿主给的 pricing 节点要自己负责说清这条路的钱与风险。
   * ★ 同时跳过 blockoutizeIssue/blockoutizeCost 那两道门（它们是白模化价目的就绪检查，
   *   报价都不归这里了，还拿它们拦提交就是"别条路的价目没就绪、这条路也不让走"）。
   */
  pricing?: ReactNode;
  /**
   * 时间轴徽章上「允许 N~M 秒」的窗口 —— 不给就是白模化输入那份 [5,30]。
   * ownRef 分段路允许拉满整条（上限 = min(全片, 12×30)），不换这个数的话，
   * 用户拖到 34 秒时徽章红着说「允许 5~30 秒」、判词却放行 —— 同一屏自相矛盾。
   */
  trimWindow?: { minSec: number; maxSec: number };
  /** 每次框选变化都报一次（宿主要镜像/存草稿时用）。不给就纯内部状态 */
  onSelectionChange?: (sel: BlockoutSelection) => void;
  /**
   * 挂载时恢复成这一份选段（不给 = `initialSelection(geo)` 的默认框）。
   *
   * ★ 给「先框选、再标帧」那种**两步页**用（2026-09-05 提取器的自带白模片路拆成了两步）：
   *   第 2 步把本组件卸掉，用户点「上一步」回来时不该看到裁剪框与选段全部归零 ——
   *   那等于把他刚做的事丢了，且零报错。
   * ★ 只在几何就绪 / 换素材那一拍读一次（ref），之后由内部状态接管：宿主每次渲染传一个
   *   新对象进来不会把用户正在拖的框顶掉。
   * ★ 这里会核一遍它装不装得进 geo，装不进就退默认：宿主换了素材却忘了清它的话，
   *   上一条素材的选段套在新素材上是一个一上来就错的框（提取器在 dropReceipt 里清）。
   * ★ 恢复时 `frameTimes` 一律抹掉：visionMode 同一拍退回「自动」，而自动模式的契约是
   *   **一个字段都不带**（见 outSel 的 ★）—— 带着上一轮的 frameTimes 就是"界面说自动、
   *   请求体却是自己挑"。
   */
  initial?: BlockoutSelection | null;
  onSubmit: (sel: BlockoutSelection) => void;
  onCancel?: () => void;
}

/**
 * 宿主要求恢复的那份选段，装得进这条素材就原样还回去（去掉 frameTimes），装不进回 null。
 * ★ 判"装得进"用与裁剪/时间轴同一组数（selectableSeconds / 登记宽高），别另立门槛。
 */
function restoredSelection(want: BlockoutSelection | null | undefined, geo: VideoNatural): BlockoutSelection | null {
  if (!want) return null;
  const w = Math.round(geo.width);
  const h = Math.round(geo.height);
  const { crop } = want;
  const fits =
    want.startSec >= 0 &&
    want.durSec > 0 &&
    want.startSec + want.durSec <= selectableSeconds(geo) &&
    crop.x >= 0 &&
    crop.y >= 0 &&
    crop.w > 0 &&
    crop.h > 0 &&
    crop.x + crop.w <= w &&
    crop.y + crop.h <= h;
  if (!fits) return null;
  return { startSec: want.startSec, durSec: want.durSec, crop: { ...crop } };
}

export default function BlockoutTrimmer({
  src,
  natural,
  busy,
  busyNote,
  error,
  submitLabel = "开始白模化",
  extra,
  hideVisionFrames = false,
  judge,
  pricing,
  trimWindow,
  onSelectionChange,
  initial,
  onSubmit,
  onCancel,
}: BlockoutTrimmerProps) {
  /** 本机 `<video>` 解出来的元数据。有登记值时只用来**比对**，没有时它就是唯一的依据 */
  const [probe, setProbe] = useState<VideoNatural | null>(null);
  /** 选段与裁剪框。★ 「看哪几帧」**不存在这里**：它按绝对秒存在 marks 里（见下） */
  const [sel, setSel] = useState<BlockoutSelection | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  /** 「AI 看哪几帧」的模式。**默认自动**：绝大多数素材人数不变，自动那条路帧数由服务端算 */
  const [visionMode, setVisionMode] = useState<VisionMode>("auto");
  /**
   * 自己挑的那些帧，按**绝对秒**存（用户是对着画面标的）。
   * ★ 换算成提交用的 `frameTimes`（相对选段起点）只有 `frameTimesOf` 一处：选段之后还会
   *   被拖动，存相对秒的话拖一下起点、同一条标记就悄悄指向了另一帧，而缩略图还停在旧画面上。
   * ★ 缩略图（dataURL）**只活在这里**，不进 `BlockoutSelection` —— 那个形状要穿过
   *   react-router 的 history state（structured clone），一条帧就是几十 KB 起。
   */
  const [marks, setMarks] = useState<FrameMark[]>([]);
  /** 抓帧要用的那个 `<video>`（VideoStage 只开这一个口子） */
  const stage = useRef<VideoStageHandle>(null);

  /** 画时间轴与裁剪框用的那组数。登记值优先（服务端按它裁），没有才退本机 */
  const geo = natural ?? probe;

  /** `initial` 的镜像（见 props 的 ★：只在初始化那一拍读，不进 effect 依赖） */
  const initialRef = useRef(initial);
  initialRef.current = initial;

  // 拿到几何就初始化选段；换了一条素材（宿主复用同一个实例）也重置 ——
  // 留着上一条的框会出现"框在画面外/选段超片尾"这种一上来就是错的状态
  useEffect(() => {
    setSel(geo ? restoredSelection(initialRef.current, geo) ?? initialSelection(geo) : null);
    // ★ 标记也必须一起清：它们是**上一条素材**里的秒数与缩略图，留着就是"标的是别的视频"
    //   ——而它们会真的被提交上去（帧数还决定报价）。模式退回默认同理。
    setMarks([]);
    setVisionMode("auto");
  }, [geo?.width, geo?.height, geo?.durationSec]);

  /**
   * 要交出去的那一份 —— 选段 + 裁剪框 + 「看哪几帧」。**唯一实现**：报价、校验、
   * onSubmit、onSelectionChange 读的都是它。
   * ★ 自动模式**一个字段都不带**（不是带一个空数组）：那是"帧数由服务端按时长算"的表达。
   */
  const outSel = useMemo<BlockoutSelection | null>(() => {
    if (!sel) return null;
    if (visionMode !== "manual") return sel;
    return { ...sel, frameTimes: frameTimesOf(marks.map((m) => m.atSec), sel) };
  }, [sel, visionMode, marks]);

  useEffect(() => {
    if (outSel) onSelectionChange?.(outSel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在选段真的变了时向上报；onSelectionChange 多半是调用方每次渲染新建的函数
  }, [outSel]);

  useEffect(() => {
    setProbe(null);
  }, [src]);

  /**
   * 登记值与本机解出来的画面**尺寸**不一致 —— 停下来，说清楚，不给开炼。
   *
   * ★ 为什么停：裁剪框的坐标按登记值画、服务端也按登记值裁。两边尺寸对不上时，用户框住的
   *   那块与真正裁到的那块**很可能不是同一块**，而屏幕上完全看不出来 —— 框还是那个框，
   *   水印还在那儿，要等付费出片回来才发现。而这条链路上钱是可能退不了的（F11：受理后失败
   *   不退）。所以按"宁可让他重来"处理。
   * ⚠ **未实测**：最常见的怀疑对象是手机竖拍视频的旋转标记（`<video>` 显示 1080×1920，
   *   而云端登记 1920×1080），但"Cloudinary 的 c_crop 到底在旋转前还是旋转后的坐标系上裁"
   *   没有人验证过。所以这里的判词只说"对不上、有风险"，**不许**写成"一定会裁错"。
   *   哪天拿真机竖拍视频实测清楚了：若证明云端会自动转正，这一条就该降级成黄字提醒。
   * ★ 没传登记值时这一条**判不了**（还没上传，没有登记值可比）。那种情况下风险由服务端兜：
   *   它按登记值复核裁剪框，越界会整句 400 且**受理前、不扣费** —— 代价是白传一次。
   */
  const sizeMismatch = useMemo(() => {
    if (!natural || !probe || probe.width <= 0 || probe.height <= 0) return null;
    const w = Math.round(natural.width);
    const h = Math.round(natural.height);
    if (probe.width !== w || probe.height !== h) {
      return `这台设备解出来的画面是 ${probe.width}×${probe.height}，服务器登记的却是 ${w}×${h}。两边对不上时，你在这里框住的位置很可能不是服务器真正裁到的那一块（常见于手机竖拍、带旋转标记的视频），而白模化这一步的钱在开始计算后是退不了的——为免白花，请换一个已经转正的 mp4 再来。`;
    }
    return null;
  }, [natural, probe]);

  /** 时长对不上：只黄字提醒不拦人（时间轴按登记值画、服务端也按它判，最坏是选到片尾之后
   *  的黑场；而"这条视频到底多长"两边都还说得通） */
  const durMismatch = useMemo(() => {
    if (!natural || !probe || probe.durationSec <= 0) return null;
    if (Math.abs(probe.durationSec - natural.durationSec) <= DUR_TOLERANCE_SEC) return null;
    return `这台设备解出来的时长是 ${probe.durationSec.toFixed(1)} 秒，服务器登记的是 ${natural.durationSec} 秒。时间轴按登记值画（服务端也按它判）——如果拖到后面播不出画面，就是这个差异，把选段往前挪。`;
  }, [natural, probe]);

  /** 元数据还没到（或视频解不开）。★ 与"选得不对"分开：它不是用户的错，不能画成红字 ——
   *  开屏那一两秒里满屏红叉，用户第一反应是"这文件坏了"然后就退出去了 */
  const loading = !geo || !outSel;
  /** 裁决（红字 issue / 绿字 ok）：judge 有就听它的（ownRef 那条路），没有就是白模化那组。
   *  ★ 两个字段一体拿：issue 与 ok 分开取的话会出现"红字按 A 路判、绿字按 B 路说" */
  const verdict =
    outSel && geo
      ? judge
        ? judge(outSel, geo)
        : { issue: selectionIssue(outSel, geo), ok: `这一段可以开炼：${selectionSummary(outSel, geo)}` }
      : null;
  const issue = verdict?.issue ?? null;

  // ── 报价：两笔，都是真钱 ────────────────────────────────────────
  // ★ 总数只从 blockoutizeCost 取。下面那两行拆解是把同一笔钱的两半说清楚，**不是**第二处
  //   求和 —— 在这儿手写 `视觉 + 出片` 就等于给报价开了第二条式子（本仓头号事故的形状）。
  // ★★ 帧数**不是常数了**（2026-08-15）：自动模式随选段时长变、自己挑时就是标了几帧。
  //   它必须与真正发上去的那一份（outSel.frameTimes）读同一个来源，所以走 visionFrameCount
  //   —— 在这里手数一次 marks.length，拖动选段把某一帧甩出去之后就会变成"页面报 5 帧、
  //   服务端按 3 帧扣"。
  const priceIssue = blockoutizeIssue();
  const tier = blockoutTier();
  const durSec = outSel?.durSec ?? 0;
  const autoFrames = autoVisionFrames(durSec);
  const frameCount = outSel ? visionFrameCount(durSec, outSel.frameTimes) : 0;
  const cost = outSel ? blockoutizeCost(frameCount, durSec) : null;
  const visionTokens = blockoutTemplateCost(frameCount);
  const videoTokens = outSel && tier ? r2vTokens(durSec, tier.id) : null;

  const blocked =
    sizeMismatch ??
    (loading ? "还在读这段视频" : null) ??
    issue ??
    // ★ 后两道是**白模化价目**的就绪检查：报价被宿主接管（pricing）时跳过 ——
    //   那条路的钱不从 blockoutizeCost 出，拿这两道拦它就是"别条路的价目拦了这条路"
    (pricing
      ? null
      : priceIssue ??
        (cost === null
          ? "白模化现在报不出价，先不能开炼（价目或开关没就绪）——这种情况请把这句话反馈给我们。"
          : null));

  return (
    <div className="space-y-3">
      {/* ★ trim-crop 锚点包住**画面台**（2026-08-28 从下面那段说明文字挪上来）：
          引导那步教的是"拖四个角"，四个角在 CropOverlay 上——圈说明文字等于指着解释
          说"拖它"。包一层中性 div，不影响 space-y 布局 */}
      <div data-guide="trim-crop">
      <VideoStage
        ref={stage}
        src={src}
        clip={sel ? { startSec: sel.startSec, durSec: sel.durSec } : null}
        onMeta={setProbe}
        onTime={setPlayhead}
        seekTo={seekTo}
        disabled={busy}
        overlay={
          geo && sel
            ? (fit) => (
                <CropOverlay
                  natural={geo}
                  scale={fit.scale}
                  value={sel.crop}
                  onChange={(crop) => setSel({ ...sel, crop })}
                  disabled={busy}
                />
              )
            : undefined
        }
        controlsExtra={
          geo && sel ? (
            <button
              onClick={() => setSel({ ...sel, crop: fullFrameCrop(geo) })}
              disabled={busy}
              className="flex-none rounded-full border border-slate-600 px-2.5 py-0.5 text-[10px] text-slate-300 disabled:opacity-40"
            >
              ⤢ 铺满整幅
            </button>
          ) : undefined
        }
      />
      </div>

      {/* 裁剪框是干什么用的，必须在框旁边说 —— 不说的话大多数人根本不会去动它，
          而它是水印唯一的解（F7 实测：提示词去不掉，edit 是逐帧复刻） */}
      <p className="text-[11px] leading-relaxed text-slate-400">
        拖四个角调整<b className="text-slate-200">裁剪框</b>，拖框身整体挪位。
        <b className="text-amber-300">台标 / 水印必须框到框外</b> —— AI 出片是逐帧复刻画面，
        提示词去不掉它（实测），裁掉是唯一的办法；而模板会被反复套用，留一个水印就是永久的。
      </p>

      {sizeMismatch && (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-200">
          ✗ {sizeMismatch}
        </p>
      )}
      {durMismatch && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
          ⚠ {durMismatch}
        </p>
      )}

      {/* ★ 引导锚点包在外面而不是当 prop 传给 TrimBar：自定义组件不会把
          不认识的 prop 透到 DOM 上，传了就是一个**找不到的锚点** ——
          而找不到不报错，只是那一步退成居中卡片，没人会发现圈没了。 */}
      {geo && sel && (
        <div data-guide="trim-range">
        <TrimBar
          totalSec={selectableSeconds(geo)}
          startSec={sel.startSec}
          durSec={sel.durSec}
          /* ★ 轨道下那句「允许 N~M 秒」说的是**输入**那一侧的窗口（下限 5，不是方舟的 4）
             —— 徽章变红的门槛也跟着它。判词与它读同一份对象（selectionIssue 的 ②），
             两处各写一个数的话，会出现"徽章是蓝的、按钮却点不动"这种自相矛盾的界面。
             trimWindow 就是同一条纪律的另一半：判词换了（judge），窗口数也得跟着换。 */
          minSec={trimWindow?.minSec ?? BLOCKOUT_INPUT_RULES.minSec}
          maxSec={trimWindow?.maxSec ?? BLOCKOUT_INPUT_RULES.maxSec}
          onChange={(startSec, durSecNext) => {
            setSel({ ...sel, startSec, durSec: durSecNext });
            // 拖把手时画面跟到入点：不跟的话用户看不到自己框的这一段从哪开始
            setSeekTo(startSec);
          }}
          playheadSec={playhead}
          onSeek={(s) => setSeekTo(s)}
          disabled={busy}
        />
        </div>
      )}

      {/* 「AI 看哪几帧」。★ 摆在时间轴**下面、校验与报价上面**是有意的：它复用同一条播放头，
          而它一改，下面那个报价当场就变（帧数就是钱的一半）。这一块自己不说"能不能开炼"
          —— 那句话由下面的 issue 一处说，两处各说一遍用户会以为出了两个错。 */}
      {geo && sel && !hideVisionFrames && (
        <VisionFramePicker
          mode={visionMode}
          onModeChange={setVisionMode}
          sel={sel}
          autoFrames={autoFrames}
          marks={marks}
          onMarksChange={setMarks}
          playheadSec={playhead}
          onSeek={(s) => setSeekTo(s)}
          onCapture={async (atSec) => {
            const api = stage.current;
            // 舞台还没挂上（理论上到不了：这一块在 geo 到手之后才渲染）。整句拒，不静默
            if (!api) throw new Error("播放器还没就绪，稍等一下再标这一帧。");
            return api.capture(atSec);
          }}
          disabled={busy}
        />
      )}

      {/* 校验：行就说清选中的是什么，不行就说清差在哪、往哪拖。两条都是整句 */}
      {loading ? (
        <p className="text-[11px] leading-relaxed text-slate-400">
          正在读取这段视频的画面尺寸与时长…（应用切到后台时系统会暂停解码，这一步会一直等着）
        </p>
      ) : issue && !sizeMismatch ? (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-200">
          ✗ {issue}
        </p>
      ) : (
        !sizeMismatch &&
        verdict && (
          <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-200">
            ✓ {verdict.ok}
          </p>
        )
      )}

      {/* 没有登记值时把"这些数是本机量的"说出来：服务端复核用的是它自己那份，
          两者万一不同（旋转标记等），会在受理前被整句拒 —— 不扣费，但白传一次 */}
      {!natural && geo && (
        <p className="text-[10px] leading-relaxed text-slate-500">
          画面尺寸（{Math.round(geo.width)}×{Math.round(geo.height)}）与时长是这台设备解出来的；
          上传后服务器会按它自己读到的值再核一次，对不上会在开始计算<b>之前</b>拒掉（不扣费）。
        </p>
      )}

      {/* 报价。★ pricing 给了就整块换成宿主那份（连下面 F11 一起，见 props 的 ★★）——
          默认这块报的是白模化那两笔，别条路挂着它就是「页面报 A 路的价、实收 B 路的钱」 */}
      {pricing ?? (
      <div className="rounded-lg border border-slate-700/70 bg-panel/60 px-3 py-2">
        {priceIssue ? (
          <p className="text-[11px] leading-relaxed text-amber-200">⚠ {priceIssue}</p>
        ) : (
          <>
            {/* ★ 帧数与它那半笔钱都是**当下这一份选择**算出来的（自动随时长变、自己挑时
                就是标了几帧）：写死一个数、或在这里另数一次 marks，都会让这句话与真正
                发上去的那一份分家 —— 而这句话就是用户认下这笔钱的依据。 */}
            <p className="text-[11px] leading-relaxed text-slate-400">
              {/* ★ 帧数与钱在这里是**两件事**：帧数决定认得准不准（多看几帧才不漏人），
                  而这一笔按"一次对话"收，与几帧无关（服务端 priceOf 对 chat 是定额）。
                  写成"看 N 帧 · N×单价"会得到一个 18 倍于实收的数 —— 那是句假话。 */}
              这一步花两笔：AI 看 {frameCount} 帧认出画面里有哪些人（
              {visionMode === "manual" ? "你自己挑的" : `按这 ${durSec} 秒自动取`}，多看几帧不额外收费 ·{" "}
              {fmtTokens(visionTokens)}）
              {videoTokens !== null && tier && (
                <>
                  {" "}
                  + 把这 {durSec} 秒整段换成白模人偶（{modelLabel(tier.model)} · {fmtTokens(videoTokens)}）
                </>
              )}
              。
            </p>
            {cost !== null && <TokenCost tokens={cost} note="白模化这一次的总消耗" className="mt-1" />}
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              这是<b>做模板</b>这一次的花费；以后每次有人套用这个模板出片，会按模板视频的时长另计一笔。
            </p>
          </>
        )}
      </div>
      )}

      {/* F11：受理后失败不退费。常驻，不折叠。★ 报价被宿主接管时一起换掉（见 pricing 的 ★★）：
          这句说的是 r2v 那条路的风险档，不出片的路挂着它是在吓错人 */}
      {!pricing && (
      <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
        ⚠ 视频里有<b>真人面孔</b>时，AI 可能在<b>受理之后</b>才拒绝这一发 —— 那时算力已经开始消耗，
        <b>这笔费用不退</b>（实测：创建时不拒，只能中途失败）。真人素材请自己掂量；动画、游戏画面、
        自己拍的白模预演不受影响。
      </p>
      )}

      {extra}

      {error && (
        <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-200">
          {error}
        </p>
      )}

      {/* ★ 兜底：走到这儿说明按钮点不动、而上面每一块都没把原因显示出来（按契约不该发生 ——
          blockoutizeCost 返回 null 时 blockoutizeIssue 必然有话说）。宁可多一行也不能让
          按钮"灰着且不说话"：那时用户唯一能做的就是反复点它。 */}
      {blocked && !sizeMismatch && !loading && !issue && !priceIssue && (
        <p className="text-[11px] leading-relaxed text-rose-200">{blocked}</p>
      )}

      <div className="flex gap-2">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-none rounded-xl border border-slate-600 px-4 py-2.5 text-sm text-slate-300 disabled:opacity-40"
          >
            取消
          </button>
        )}
        <button
          onClick={() => outSel && onSubmit(outSel)}
          disabled={!!blocked || !!busy}
          className="min-w-0 flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
        >
          {busy ? busyNote || "处理中…" : submitLabel}
        </button>
      </div>
      {busy && busyNote && <p className="text-center text-[11px] text-slate-400">{busyNote}</p>}
    </div>
  );
}
