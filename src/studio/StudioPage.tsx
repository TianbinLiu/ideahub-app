// 卡片工坊页（竖屏优先）：3D 画布 + 投影窗 + NPC 底部抽屉 + 提示条
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useNavigate } from "react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import ErrorBoundary from "../components/ErrorBoundary";
import TableScene from "./scene/TableScene";
import { AI_REAL } from "../ai";
import { myCards } from "../data/account";
import { useStudio } from "./studioStore";
import { useFlow } from "./flowStore";
import { defaultCamFor, sceneLayout } from "./scene/layout";
import { revealIntroCam } from "./scene/introCam";
import NpcDialog from "./ui/NpcDialog";
import ProjectionWindow from "./ui/projection";
import { CardDetailModal } from "./ui/modals";
import AvatarPicker from "./ui/AvatarPicker";
import AvatarSwapButton from "./ui/AvatarSwapButton";
// 对局态（G2 第二块）：HUD / 商店 / 背包 / 风格卡那一层 2D 覆盖层。只在横屏且真的开了一局时挂载，
// 竖屏与没开局时这一行等于不存在（施工单"竖屏沿用现有布局"）。
import GameLayer from "./game/ui/GameLayer";
import { useGame } from "./game/store";
import { cancelPendingStop, stopSpeakingSoon } from "./speech";
import { useCastReturn } from "../hooks/useCastReturn";
import { useFlowActions } from "../hooks/useFlowActions";
import { useIsLandscape } from "../hooks/useIsLandscape";
// 工作流画布现在是工坊里的一层全屏浮层（2026-08-30 合并：创作入口不再有「工作流模式」）
import FlowCanvas from "../components/flow/FlowCanvas";
import { castEditorState } from "../pages/FlowPage";
import { autoQualityOnFirstVisit, qualityLabel, type Quality } from "./quality";
import Icon from "../components/Icon";

// 入场加载过渡：盖住模型/贴图流式加载过程（不然首页跳转进来会看到模型逐个蹦出+卡顿）。
// 进度来自 THREE.DefaultLoadingManager；资源全命中内存缓存时无事件——1.5s 静默兜底收起。
function StudioLoader() {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"loading" | "fading" | "gone">("loading");
  const finishedRef = useRef(false);
  const sawEventRef = useRef(false);
  useEffect(() => {
    const mgr = THREE.DefaultLoadingManager;
    const started = performance.now();
    const finish = () => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      const wait = Math.max(0, 900 - (performance.now() - started));
      setTimeout(() => {
        setProgress(100);
        setPhase("fading");
        setTimeout(() => {
          setPhase("gone");
          // ★ 开场运镜（scene/introCam，G1 施工单 §4）从**加载层撤掉的这一拍**才开始走。
          //   在挂载那一刻就开走的话，最短 0.9 秒 + 0.5 秒淡出全盖在加载层底下，用户真正
          //   看见桌面时俯冲已经走完一半，像"进来就已经落好了"，那一段运镜等于白做。
          //   运镜在这之前一直停在起点（高处俯视），所以亮起来的第一帧就是那一台。
          revealIntroCam();
        }, 500);
      }, wait);
    };
    mgr.onProgress = (_url, loaded, total) => {
      sawEventRef.current = true;
      if (!finishedRef.current) setProgress(Math.round((loaded / Math.max(1, total)) * 100));
    };
    mgr.onLoad = finish;
    const guard = setTimeout(() => {
      if (!sawEventRef.current) finish();
    }, 1500);
    const hardGuard = setTimeout(finish, 15000);
    return () => {
      clearTimeout(guard);
      clearTimeout(hardGuard);
      mgr.onLoad = () => {};
      mgr.onProgress = () => {};
    };
  }, []);
  if (phase === "gone") return null;
  return (
    <div
      className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-ink transition-opacity duration-500 ${
        phase === "fading" ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {/* 法阵旋转环 */}
      <div className="relative mb-6 h-20 w-20">
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-cyan-300/80 border-r-cyan-300/30" style={{ animationDuration: "1.6s" }} />
        <div className="absolute inset-2 animate-spin rounded-full border border-transparent border-b-warn-300/70" style={{ animationDuration: "2.4s", animationDirection: "reverse" }} />
        <div className="absolute inset-0 flex items-center justify-center text-brand"><Icon name="workshop" size={28} /></div>
      </div>
      <div className="mb-3 text-sm font-semibold tracking-widest text-slate-200"><Trans>正在点亮魔法书房…</Trans></div>
      <div className="h-1 w-40 overflow-hidden rounded-full bg-slate-700/60">
        <div className="h-full rounded-full bg-cyan-300/80 transition-all duration-300" style={{ width: `${Math.max(8, progress)}%` }} />
      </div>
    </div>
  );
}

/**
 * 画布浮层盖着时 3D 桌面停帧（Canvas 的 frameloop 开关，见下面 Canvas 处的 ★），这个组件负责把场景时钟**暂停**而不是归零。
 * ★★ 为什么要它：r3f 9.6.1 的 setFrameloop 每次切换都 clock.stop() + elapsedTime = 0 再 start()
 *   （node_modules/@react-three/fiber/dist/events-*.esm.js:1087-1100，frameloop 从 prop 变过去就走这里）。场景里有按**绝对**
 *   elapsedTime 记起点的活：TableScene.FlightCard 的 start.current（炼出的卡飞入卡组）与 cameraOrbit.clampRadiusByScene 的
 *   collidersAt（1 秒一次的碰撞体重采）—— 时钟归零后前者要等 elapsedTime 重新爬到原来的值才飞（卡在桌边不见几分钟，
 *   landFlight 也跟着晚）、后者在那之前一直拿旧碰撞体，两件都零报错。其余读 elapsedTime 的都是 sin(t) 呼吸 / 自转，跳一拍也无妨。
 *   所以每帧记下 elapsedTime，恢复那一拍写回去：对场景而言浮层开着的那段时间不存在（暂停语义），飞卡接着飞、呼吸不跳。
 * ★ useLayoutEffect 而不是 useEffect：要赶在恢复后的第一帧之前写回（r3f 在 set({ frameloop }) 的 store 订阅里就排了一帧 rAF）。
 *   写回之后 THREE.Clock.getDelta 从这个值往上累加（它只 += diff），所以后面的 delta 仍是真实帧长，弹簧骨不会吃到一个大步长。
 * ★ DEV 的 __r3fCapture（TableScene.CaptureHook）也切 never/always，这里一并接住，离屏捕帧照旧。
 */
function SceneClockKeeper() {
  const clock = useThree((s) => s.clock);
  const frameloop = useThree((s) => s.frameloop);
  const last = useRef(0);
  useFrame(({ clock: c }) => {
    last.current = c.elapsedTime;
  });
  useLayoutEffect(() => {
    if (frameloop !== "never") clock.elapsedTime = last.current;
  }, [frameloop, clock]);
  return null;
}

function useHint(): string {
  const { t } = useLingui();
  const deckLen = useStudio((s) => s.deck.length);
  const nodes = useFlow((s) => s.nodes);
  const projection = useStudio((s) => s.projection);
  const focus = useStudio((s) => s.focus);
  const marketOpen = useStudio((s) => s.market.open);
  const marketEmpty = useStudio((s) => s.market.open && !s.market.loading && s.market.items.length === 0);
  const spreadOpen = useStudio((s) => s.spreadOpen);
  if (projection === "editor") return t`填入素材与要求，AI 将推演三套走向`;
  if (projection === "proposals") return t`挑一套方案 → 可换首尾帧/改剧情 → 生成本段视频`;
  if (projection === "decks") return t`小窗右上角可在「卡组 / 卡片」间切换，单击卡片看详情`;
  if (focus) return t`点击卡片之外的桌面区域可拉远视角`;
  // ★ 空市场不许照念"点桌上的市场卡"——桌上一张都没有（卡片系统 V2 清掉了离线种子），
  //   指着空桌说"点卡"是在骗人。空态说清哪里能来卡。
  // ★★ 这句原来是「市场还空着——用「从视频提取」圈几张卡，**分享后这里就会有**」。
  //   后半句是假的（2026-08-30 查实）：桌面市场读的是 `ai.searchMarket`，而它 2026-08-24
  //   起就硬写成 `async () => []`；分享出去的卡落在**服务端广场**（browseSharedCards），
  //   这张桌子根本不去取它 —— 照着做的人会分享一张、回来发现还是空的，然后怀疑分享没成功。
  //   把桌面市场接到广场是另一条工单；在那之前，这句话只说**真的能拿到卡**的那条路。
  if (marketEmpty) return t`这张桌子上还没有卡——去「创意工坊」的市场装几张，或在「我的仓库」用「从视频提取」现做`;
  if (marketOpen) return t`点桌上的市场卡放大查看，喜欢就收进卡组`;
  if (spreadOpen) return t`点一张卡看详情`;
  if (nodes.length === 0 && deckLen === 0) return t`先把素材交给铸卡师做卡，或让 TA 摊开市场`;
  // G4：桌面上的卡位现在是**对局的 5 个位子**（4 角色 + 1 场景），不再是视频节点卡；
  // 摆卡/拖卡是第 3 步，这一拍只把"卡会从哪儿来"说清楚（说"把卡拖上去"就是骗人）。
  return t`开局后，背包里的角色卡与场景卡会摊到桌面的 5 个卡位上`;
}

// ── 市场翻页箭头：屏幕两侧竖直居中，56px 热区（比卡组那对 36px 的大一圈，
//    因为它在 3D 画布上、周围没有别的可点物，够大才不会误触到桌面）──
// `perPage` 必须由页面给：横屏一页 8 张、竖屏 6 张，store 的 shiftMarket 只负责夹页
function MarketArrow({
  dir,
  disabled,
  side,
  perPage,
}: {
  dir: 1 | -1;
  disabled: boolean;
  side: "left" | "right";
  perPage: number;
}) {
  const { t } = useLingui();
  return (
    <button
      onClick={() => useStudio.getState().shiftMarket(dir, perPage)}
      disabled={disabled}
      aria-label={dir < 0 ? t`上一页` : t`下一页`}
      className={`absolute top-[46%] z-10 flex h-14 w-14 items-center justify-center rounded-full bg-panel/75 text-2xl text-slate-200 backdrop-blur transition-opacity disabled:opacity-40 ${
        side === "left" ? "left-2" : "right-2"
      }`}
    >
      {dir < 0 ? "‹" : "›"}
    </button>
  );
}

/** 瞬时提示条。key 用 notice.at，同一句话连按两次也会重新播一遍动画 */
function Toast({ notice }: { notice: { text: string; at: number } | null }) {
  const [shown, setShown] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    if (!notice) return;
    setShown(notice);
    const t = setTimeout(() => setShown(null), 2400);
    return () => clearTimeout(t);
  }, [notice]);
  if (!shown) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-24 z-40 flex justify-center px-6">
      <div className="rounded-full bg-black/75 px-4 py-2 text-center text-xs text-slate-100 backdrop-blur">
        {shown.text}
      </div>
    </div>
  );
}

/** 自动定档只提示一次，且**不给"改一下"的按钮**——改画质在设置页，
 *  这里再放一个入口就又回到"画质散落在两处"的老问题上了 */
function AutoQualityHint({ q }: { q: Quality }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGone(true), 4200);
    return () => clearTimeout(t);
  }, []);
  if (gone) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex justify-center px-6">
      <div className="rounded-full px-2.5 py-1 bg-black/70 text-center text-[11px] text-slate-300 backdrop-blur">
        <Trans>已自动选「{qualityLabel(q).name}」画质 · 设置里可改</Trans>
      </div>
    </div>
  );
}

export default function StudioPage() {
  const navigate = useNavigate();
  const { t } = useLingui();
  // 工坊的模板段面板也能发起挂卡（returnTo:"/studio"）——回程的收口与 /flow 同一份实现
  useCastReturn();
  /**
   * 工作流画布开着没有（2026-08-30 主人点名「工坊与工作流为一体」）。
   * ★ 它是**同一条流水线的另一个面**，不是另一页：所以做成浮层而不是 navigate ——
   *   跳页会把 3D 场景整个卸载再装回来（模型重新解码、镜头归位），而用户的心智是
   *   "把桌子换个看法"。
   * ★ 画布自带 z-40 全屏 portal，这里只管开关与那三件页级活儿（存草稿/组稿/挂卡）。
   */
  // 画布开着没有：**放 store**（studioStore.canvasOpen 那段 ★★）—— 去挂卡编辑页再回来时
  // 这一页会整个重挂，局部 state 归零，用户会从画布掉回 3D 桌面。它也因此进了返回栈。
  const canvasOpen = useStudio((s) => s.canvasOpen);
  const setCanvasOpen = useStudio((s) => s.setCanvasOpen);
  const flowActions = useFlowActions({ onLeave: () => setCanvasOpen(false) });
  const initGreet = useStudio((s) => s.initGreet);
  const spreadOpen = useStudio((s) => s.spreadOpen);
  const deckLen = useStudio((s) => s.deck.length);
  const shiftSpread = useStudio((s) => s.shiftSpread);
  const hint = useHint();
  const notice = useStudio((s) => s.notice);
  const marketOpen = useStudio((s) => s.market.open);
  const marketLen = useStudio((s) => s.market.items.length);
  const marketPage = useStudio((s) => s.market.page);

  // 首次进工坊按机型定档。用 useState 初始化器而不是 useEffect：模型 URL 在首帧
  // 渲染时就按 getQuality() 取好了，放进 effect 就晚了一帧、这次进入还是旧档
  const [autoQ] = useState(autoQualityOnFirstVisit);

  useEffect(() => {
    cancelPendingStop();
    initGreet();
    // 离开工坊必须掐掉语音：SpeechSynthesis 是全局队列，路由切走了它照念不误，
    // 用户会在首页听见铸卡师的声音从虚空里传来。
    // 用 Soon 版而非直接 stop：StrictMode 会 mount→cleanup→mount，直接掐会让
    // dev 下的开场白永远发不出声（见 speech.ts）
    return stopSpeakingSoon;
  }, [initGreet]);

  // 进工坊时空卡组自动装入账号里的卡：收藏/收入的卡组此前只躺在创意工坊页，
  // 到了铸卡桌面却两手空空——观众"用这套卡去创作"的闭环在这一步接上
  useEffect(() => {
    if (useStudio.getState().deck.length === 0) {
      const cards = myCards();
      if (cards.length > 0) useStudio.setState({ deck: cards });
    }
  }, []);

  // 法阵/铸段落地后的"去画布那一面"：store 里没有 router，意图记在 goFlowAt 上由这里执行
  const goFlowAt = useStudio((s) => s.goFlowAt);
  const goFlowSeen = useRef(goFlowAt);
  useEffect(() => {
    // 合并之后「去画布那一面」= 就地开浮层（此前是 navigate("/flow")）
    if (goFlowAt && goFlowAt !== goFlowSeen.current) setCanvasOpen(true);
    goFlowSeen.current = goFlowAt;
  }, [goFlowAt, navigate]);

  // 存草稿走 useFlowActions（本页已经在用它给画布浮层供状态）——此前这里还自持一份，
  // 同一颗按钮在工坊顶栏与画布顶栏各走各的实现（铁律六）
  /**
   * 画布浮层盖着没有：与下面挂 FlowCanvas 的判据是同一个值。
   * ★ G4 第 1 步起桌面上的节点卡撤了（换成对局卡位），**画布就是新建流水线的入口** ——
   *   空流水线也照开（FlowCanvas 自带空态 + 「对画布说话」输入条，见 EmptyPipelineHint）。
   *   以前 0 段时这颗键只吐一句"先点虚线卡位"，而那条虚线卡位现在不存在了。
   */
  const canvasCovered = canvasOpen;

  /**
   * 横屏宽布局（G1 施工单 docs/g1-scene-plan.md §2 A）：左右各一条常驻条，3D 桌面留在中间。
   * ★ 判据只有一份（hooks/useIsLandscape）：`(orientation: landscape)`，也就是画布宽 > 高。
   *   原生侧进这一页就把 Activity 钉成 landscape（hooks/useOrientationLock），浏览器里把窗口
   *   拖成横的也走同一条 —— 两种环境同一套判据，不需要两套布局。
   * ★ 竖屏分支必须**逐字节保持不变**：所有横屏样式都挂在 isLand 这个条件后面（多出来的只有
   *   flex 容器、gutter 与两条边栏），竖屏时这层 div 就是原来那个 relative/inset 全屏壳。
   */
  const isLand = useIsLandscape();
  /**
   * 有没有开着一局（G2 第二块）：只决定两件事 —— 底部那句工坊提示条让位给对局 UI、
   * 以及 GameLayer 挂不挂。对局状态本身在 game/store 里，切页 / 转屏都不会丢。
   */
  const inGame = useGame((s) => s.state !== null);
  /**
   * 横屏/竖屏两套桌面卡位（layout.sceneLayout）：市场一页几张、摊开排摆几张。
   * 判据与 isLand 同一个 —— 别再在这里判一次 `orientation`。
   */
  const L = sceneLayout(isLand);
  /**
   * 首帧相机用哪台：与 CameraRig 每帧求值的判据同一个（layout.defaultCamFor）。
   * 不这么做的话，横屏窗口会从俯视那台"飞"到落点机位（r3f 的 camera 初值就是 DEFAULT_CAM.pos），
   * 而竖屏窗口反过来 —— 两种情况都只在 StudioLoader 底下，但没必要。
   */
  const initCam = defaultCamFor(window.innerWidth / window.innerHeight);

  return (
    <div className={`relative h-full w-full overflow-hidden bg-ink ${isLand ? "p-1.5" : ""}`}>
      {/* ★ 舞台：3D 画布 + 所有 absolute 浮层（顶栏、提示条、投影窗、对话气泡、弹层）都挂在这一层。
          G4 起左右两条常驻条都删了（施工单 §2），舞台重新占满整窗；这一层壳留着，是因为画布与浮层的
          坐标系仍然是"舞台那一块"，以后加常驻栏时不用再动一两百行缩进。
          ⚠ 这一层里的缩进**刻意没有再加一层**：壳是后加的，把两百多行重新缩进会让这次 diff 变成噪音。 */}
      <div className={`relative h-full min-w-0 flex-1 overflow-hidden ${isLand ? "rounded-xl" : ""}`}>
      {/* ★ 渲染边界只包 Canvas 这一层（2026-10-15 教材人格评审，Nygard「崩溃边界」那条）：r3f 会把子树的渲染期抛错重抛到这里，
          受保护模型解不开 / hook 排在早退之后 / chosenOf(n).plot 空指针都接得住（2.51–2.55 那种「一进工坊整页白屏」就落在这一层）；
          useFrame 里抛的不经 React 树、接不到 —— 那一类仍只靠 camOk 式的先校验再用（CLAUDE.md「渲染循环里别信任外部状态的形状」）。
          full：这一屏整个就是这块画布，fallback 居中摆、多给一颗回首页；顶栏是 absolute 的兄弟节点，照旧能按返回。 */}
      <ErrorBoundary label={t`3D 桌面`} full>
        <Canvas
          dpr={[1, 2]}
          /* ★ preserveDrawingBuffer 只在 DEV 开（2026-10-15 教材人格评审）：正式包里没有谁读这块画布的像素 —— 全仓 gl.domElement.toDataURL
             只有 DEV 的 __r3fCapture（TableScene :1686 `import.meta.env.DEV && <CaptureHook/>`），导演台截图用的是它自己的 Canvas，
             挂卡合成预览（flowStore.makeCastPreview）拼的是图床抽帧不是这块画布。开着就是让浏览器每帧多做一次整屏拷贝。 */
          gl={{ preserveDrawingBuffer: import.meta.env.DEV }}
          /* ★ 画布浮层盖着时停帧（2026-10-15 教材人格评审，McConnell 性能那条）：FlowCanvas 是 z-40 不透明整屏（bg-ink），
             盖着的时候这里仍每帧画 NPC、弹簧骨、卡面轮播 —— 一帧都看不见、电却照烧。只关 frameloop、不卸场景（主人「画布是
             工坊里的浮层」那条决定不动：卸了再装要重解模型、镜头归位）；时钟由 SceneClockKeeper 接住（r3f 切 frameloop 会归零）。 */
          frameloop={canvasCovered ? "never" : "always"}
          /* ★ 画布的尺寸与 aspect **跟着这一层容器走**，不是跟着 window：r3f 9.6.1 用 react-use-measure
             （ResizeObserver）量容器，尺寸变了就走 updateCamera → camera.aspect = w/h + updateProjectionMatrix
             （node_modules/@react-three/fiber/dist/events-*.esm.js 的 updateCamera）。所以转屏、两条常驻条
             把中间挤窄，这里都不用手工重算；CameraRig 每帧按 camera.aspect 选机位也在同一拍跟上。 */
          camera={{ fov: 50, position: initCam.pos, near: 0.1, far: 80 }}
        >
          <SceneClockKeeper />
          <TableScene />
        </Canvas>
      </ErrorBoundary>

      {/* 顶栏（G4 施工单 §2）：左上退出、右上重命名 / 问号 / 保存**都删了**。
          留下的只有一件事的入口：那条流水线的另一个面（🧩 工作流画布），它在交片时有地方可去。
          ★ 对局的「▶ 开局 / ✕ 结束对局」从被删掉的右栏搬到这里：横屏才对局 UI 挂得起来，
            所以只在横屏摆；竖屏原样（开局入口本来就不在竖屏）。
          ⚠ safe-top 写在 @tailwind utilities 之后，同特异性下会**覆盖** p-3 的
          padding-top——所以竖排间距靠 pt-* 单独给，别指望 p-3 */}
      <div className="safe-top pointer-events-none absolute inset-x-0 top-0 flex items-start justify-end px-4 pb-3 pt-3">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2 pt-1.5">
          {isLand && (
            <button
              onClick={() => (inGame ? useGame.getState().endGame() : useGame.getState().startGame())}
              // 键面就是状态：没开局是实心主键，开局后变成"结束对局"的灰键（与删掉的那条右栏同一个动作）
              className={`h-9 rounded-full px-3 text-xs font-bold backdrop-blur ${
                inGame ? "bg-panel/85 text-slate-200" : "bg-brand text-ink"
              }`}
            >
              {inGame ? <Trans>✕ 结束对局</Trans> : <Trans>▶ 开局</Trans>}
            </button>
          )}
          {/* 「🧩 工作流」：同一条流水线换到画布那一面 —— 与画布顶栏「🎴 工坊」对称
              （2026-08-30 主人点名：此前只有画布→工坊单向有键，反向只剩法阵那条隐路）。
              G4 第 1 步起桌面节点卡撤了，**这颗键是新建流水线唯一的门**：空流水线也照开，
              画布里有空态和「对画布说话」输入条（见 canvasCovered 的 ★）。 */}
          <button
            onClick={() => setCanvasOpen(true)}
            title={t`工作流画布：同一条流水线的另一面`}
            aria-label={t`工作流画布`}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-panel/85 text-slate-100 backdrop-blur"
          >
            <Icon name="branch" size={18} />
          </button>
          {/* 只在演示模式亮牌。「● 真实 AI」是常态，天天挂在那儿只是噪音；
              而没配 Key 时全程 mock——用户以为在测 Seedance、产物却全是本地占位，
              这一条必须留着。标题栏的「🎴 卡片工坊」也去掉了：画面本身就是工坊 */}
          {!AI_REAL && (
            <div
              className="rounded-full bg-panel/80 px-3 py-1.5 text-xs text-warn-300 backdrop-blur"
              title={t`未配置 ARK_API_KEY：产物为本地模拟，仅演示流程`}
            >
              <Trans>○ 演示模式</Trans>
            </div>
          )}
        </div>
      </div>


      {/* 提示条（NPC 气泡栏上方）。横屏：屏幕矮（462 CSS px）、这句话在窄舞台里折成两行，
          bottom-16 会正好压在摊开排那三张卡上（真机 3C15CJ00C8V00000 实测）—— 落到贴底 8px。
          ★ 开了一局时撤掉：对局态的底部是背包条与商店（GameLayer），这句话会被压在底下面。
          没开局时逐字不动（竖屏也一样）。 */}
      {!inGame && (
        <div className={`pointer-events-none absolute inset-x-0 flex justify-center ${isLand ? "bottom-2 px-3" : "bottom-16 px-4"}`}>
          <div
            data-guide="studio-hint"
            className={`rounded-full bg-panel/75 text-center text-slate-300 backdrop-blur ${
              isLand ? "px-3 py-1 text-[11px]" : "px-4 py-1.5 text-xs"
            }`}
          >
            {hint}
          </div>
        </div>
      )}

      {/* 市场翻页箭头：市场种子有 19 张，一页摆 6 张 → 4 页。放在屏幕两侧竖直居中，
          与卡组展开排那对箭头（左下角）错开位置，不会打架 */}
      {marketOpen && marketLen > L.market.perPage && (
        <>
          <MarketArrow dir={-1} disabled={marketPage === 0} side="left" perPage={L.market.perPage} />
          <MarketArrow dir={1} disabled={(marketPage + 1) * L.market.perPage >= marketLen} side="right" perPage={L.market.perPage} />
          <div className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center">
            <span className="rounded-full px-2.5 py-1 bg-black/45 text-[11px] text-slate-300 backdrop-blur">
              {marketPage + 1} / {Math.ceil(marketLen / L.market.perPage)}
            </span>
          </div>
        </>
      )}


      {/* 返回被拒绝之类的瞬时提示（投影窗盖着时铸卡师说话用户看不见，只能走这里） */}
      <Toast notice={notice} />
      {autoQ && <AutoQualityHint q={autoQ} />}

      {/* 卡组展开翻页箭头 */}
      {spreadOpen && deckLen > L.spread.maxVisible && (
        <div className="absolute bottom-28 left-3 z-10 flex gap-2">
          <button
            onClick={() => shiftSpread(-1)}
            className="h-9 w-9 rounded-full bg-panel/90 text-slate-200 backdrop-blur"
          >
            ‹
          </button>
          <button
            onClick={() => shiftSpread(1)}
            className="h-9 w-9 rounded-full bg-panel/90 text-slate-200 backdrop-blur"
          >
            ›
          </button>
        </div>
      )}

      <NpcDialog />
      <ProjectionWindow />
      <CardDetailModal />
      <AvatarPicker />
      <AvatarSwapButton />
      {/* 对局覆盖层（G2 第二块）：只在横屏挂 —— 竖屏时它一个像素都不出现（施工单要求）。
          没有开局时组件自己 return null，所以这里不需要再判一次对局状态。 */}
      {isLand && <GameLayer />}
      <StudioLoader />
      {/* ── 工作流画布：同一条流水线的另一个面，就地铺满这一屏（2026-08-30 合并）──
          ★ 它自带 z-40 全屏 portal，所以挂在这里不影响上面那些浮层的层级关系。
          ★ 那三件页级活儿（存草稿 / 组稿 / 挂卡）实现只有一份：存草稿与组稿在
            hooks/useFlowActions，挂卡入参在 FlowPage.castEditorState（回程 useCastReturn
            两页共用）—— 画布照旧只借按钮与状态，工坊这一面不抄第二份（铁律六）。
          ★ ✕ 与「🎴 工坊」都是关掉浮层回到桌面：合并之后它们不再是"去另一页"。
          ★ 判据 canvasCovered 与上面 Canvas 的 frameloop 是同一个值（盖上才停帧，见那边的 ★）。 */}
      {canvasCovered && (
        <FlowCanvas
          onExit={() => setCanvasOpen(false)}
          onLinear={() => setCanvasOpen(false)}
          onCast={(tpl, value) => {
            const st = castEditorState(tpl, value, "/studio");
            if (st) navigate("/video-editor", { state: st });
          }}
          draft={{ state: flowActions.saveState, onSave: flowActions.saveNow }}
          finish={{
            allDone: flowActions.allDone,
            finalizing: flowActions.finalizing,
            note: flowActions.deckNote,
            onRun: flowActions.toCut,
            deckOn: !flowActions.deckOff,
            onDeckToggle: flowActions.toggleDeck,
          }}
        />
      )}
      </div>
    </div>
  );
}
