// 卡片工坊页（竖屏优先）：3D 画布 + 投影窗 + NPC 底部抽屉 + 提示条
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useNavigate, useSearchParams } from "react-router";
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
// 对局大厅（2026-11-23）：进对局之前先选开局方式（4 人匹配 / 8 人匹配 / 自定义房间）。
// 它与 GameLayer 是**前后两屏**：大厅在"还没有 state"的那一拍，对局 UI 在有了 state 之后。
import Lobby from "./game/ui/Lobby";
// 对局内设置（2026-11-24）：顶栏 ⚙ 打开，整屏盖住对局 UI（音量 / 画质 / 语言 / 操作提示 / 退出游戏）。
// 它挂在**页面**这一层而不是 GameLayer 里：选风格那一屏 GameLayer 是早退的（只画 StylePick），
// 挂在那儿的话在那一屏点 ⚙ 会"点了没反应"。
import GameSettings from "./game/ui/GameSettings";
// 本局战绩 + 回放（2026-11-24）：整屏浮层，入口在结束屏与大厅（最近一局）。
// ★ 与大厅 / 设置页同一条理由挂在页面这一层：从结束屏进来时对局还在，从大厅进来时已经收掉，
//   两个入口看到的是同一份；它也把 3D 桌面停帧（canvasCovered）。
import MatchHistory from "./game/ui/MatchHistory";
import { useHistory } from "./game/historyStore";
// 退出对局那一下（退房 + 收局 + 开大厅）的唯一实现，与设置页的「退出游戏」共用
import { quitGameToLobby } from "./game/ui/quitGame";
import { useLobby } from "./game/lobbyStore";
import { useGame } from "./game/store";
// 对局那份「跟着做一局」的重看入口（2026-11-24）：顶栏那颗 `?`。
// ★ 不放在 GameLayer 里：那一层在选风格那一屏是早退的，而 `?` 该在整局里都在。
import HelpButton from "../components/guide/HelpButton";
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
   * 大厅开着没有（2026-11-23）：顶栏「▶ 开局」不再直接开局，而是先开大厅。
   * ★ 它同时是"3D 停帧"的判据之一：大厅是铺满舞台的实底、里面一张卡都没有，
   *   而它开着的那几秒里桌面仍会每帧画 NPC / 卡面轮播（看不见，电照烧）——
   *   所以进 canvasCovered（与画布浮层同一条理由，时钟由 SceneClockKeeper 接住）。
   */
  const lobbyOpen = useLobby((s) => s.open);
  /**
   * 离开 `/studio`（路由卸载）时把大厅收掉（2026-11-24 视觉 P0，docs/game-lobby-ui-benchmark.md §1.4 顺手修）：
   * ★ 症状：`lobbyStore.open` 是个**持久值**（store 活在整场会话里）。带 `?lobby=1` 进来后按系统返回键
   *   离开 `/studio` 时，StudioPage 卸载了、大厅那层却还开着 —— 下次从「我的仓库 / 回炉重做 / 发布后回工坊」
   *   不带标记进来，屏幕直接盖着大厅，3D 桌面永远见不到。
   * ★ 为什么是"卸载"而不是"关大厅"：关大厅那条路（closeLobby）本来就清；漏的是**没点关就离开**。
   *   这里调 closeLobby 而不是只把 open 置 false —— 离开页面时队列 / 服务端房间也该收掉，
   *   否则下一次进来会撞 ALREADY_IN_ROOM（`release()` 做这件事）。
   * ★★ 为什么要延迟一拍再判：React StrictMode 在 dev 里把 effect 走一遍「挂载 → 卸载 → 挂载」，
   *   直接在 cleanup 里 close 会把刚用 `?lobby=1` 打开的大厅当场收掉（dev 里表现为"点了入口没反应"）。
   *   定时器跑的时候若已经重新挂上（alive 又变 true）就什么都不做。
   *
   * ★ 战绩 / 回放浮层用**同一个清理点**（2026-11-24 晚，上一轮遗留）：`historyStore.open` 与大厅一样是
   *   持久值 —— 从上一次对局的结束屏点开回放、没关就按系统返回键离开 `/studio`，下次进来屏幕直接盖着
   *   上一局的回放（而且那一局的 `code` 还在 store 里，看着像"这一局"）。两处都收在同一个 setTimeout 里：
   *   只有真离开（alive 仍为 false）才动手，StrictMode 的假卸载照旧什么都不做。
   *   ★ 这里调 `close()`（不是只把 open 置 false）：它同时把 code / history / 失败原因清掉，并让
   *     seq 自增作废晚到的回包 —— 否则下一次进来会看到上一局的回放条。
   */
  const studioAlive = useRef(false);
  useEffect(() => {
    studioAlive.current = true;
    return () => {
      studioAlive.current = false;
      window.setTimeout(() => {
        if (studioAlive.current) return;
        if (useLobby.getState().open) useLobby.getState().closeLobby();
        if (useHistory.getState().open) useHistory.getState().close();
      }, 0);
    };
  }, []);
  /**
   * 对局内的设置页（2026-11-24）：只在横屏且开着一局时才有入口（顶栏那颗 ⚙）。
   * ★ 放页面本地 state、不进 game store：它同时决定两件事 —— 盖不盖这一屏、以及 3D 桌面停不停帧
   *   （canvasCovered 与大厅同一条理由）。搬进 store 只会多出一份"结束对局时要记得清"的值。
   */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * 战绩 / 回放浮层开着没有（2026-11-24）。与设置页同一个理由进 canvasCovered：
   * 它也是整屏实底，盖着的时候桌面还在每帧画 NPC（看不见、电照烧）。
   */
  const historyOpen = useHistory((s) => s.open);
  /**
   * 「开始做完整作品」那条入口（src/pages/CreatePage）落到 `/studio?lobby=1`：进来就直接开大厅。
   * ★ 为什么是地址里的一个标记、不新造一条路由：大厅本来就是这块 3D 舞台上的一个浮层
   *   （lobbyStore.open），另开路由会把模型与场景整整挂两遍。
   * ★ 标记**用完就抹掉**（与 /me?wallet=1 同一个做法）：留着的话关掉大厅一刷新又弹出来；而
   *   「我的仓库 / 回炉重做 / 发布之后回工坊」这些不带标记的入口必须照旧落在 3D 桌面上 ——
   *   这条是主人点名要保住的（3D 工坊桌面仍可单独进入）。
   * ★ 已经开着一局时不抢：那一局还在跑，把大厅盖上去等于把人从牌桌上拽走（Lobby 也会按 inGame 隐身）。
   */
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("lobby") !== "1") return;
    if (!useGame.getState().state) useLobby.getState().openLobby();
    const next = new URLSearchParams(searchParams);
    next.delete("lobby");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  /**
   * 画布浮层 / 大厅盖着没有：与下面挂 FlowCanvas、挂 Lobby 的判据是同一个值。
   * ★ G4 第 1 步起桌面上的节点卡撤了（换成对局卡位），**画布就是新建流水线的入口** ——
   *   空流水线也照开（FlowCanvas 自带空态 + 「对画布说话」输入条，见 EmptyPipelineHint）。
   *   以前 0 段时这颗键只吐一句"先点虚线卡位"，而那条虚线卡位现在不存在了。
   * ★ 大厅也算"盖着"（2026-11-23）：不进对局的那几屏不挂 3D —— 大厅铺满舞台、纯 2D 入口卡。
   * ★ 对局设置页也算（2026-11-24）：它同样是整屏实底，盖着的时候桌面还在每帧画 NPC（看不见、电照烧）。
   */
  const canvasCovered = canvasOpen || lobbyOpen || settingsOpen || historyOpen;
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
  // 这一局没了（结束对局 / 认输退出 / 服务端判结束）就把设置页一并收掉：它只在"有一局"时才成立，
  // 留着的话下一局开局会莫名其妙停在一张设置页上（而那一页上的"返回游戏"看着像能点）。
  useEffect(() => {
    if (!inGame) setSettingsOpen(false);
  }, [inGame]);
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
              onClick={() => {
                // 2026-11-23 起「▶ 开局」**先开大厅**（4 人 / 8 人匹配、自定义房间都在那一屏），
                // 再由大厅里的开局把对局建起来（ui/startFromLobby）。这一颗键不再知道人数。
                // 2026-11-24 起结束对局走 ui/quitGame 那一份（退房 + 收局 + 开大厅）：与设置页的
                // 「退出游戏」同一条路，联机时不会把账号留在服务端那间房里。
                if (inGame) quitGameToLobby();
                else useLobby.getState().openLobby();
              }}
              // 键面就是状态：没开局是实心主键，开局后变成"结束对局"的灰键（与删掉的那条右栏同一个动作）
              className={`h-9 rounded-full px-3 text-xs font-bold backdrop-blur ${
                inGame ? "bg-panel/85 text-slate-200" : "bg-brand text-ink"
              }`}
            >
              {inGame ? <Trans>✕ 结束对局</Trans> : <Trans>▶ 开局</Trans>}
            </button>
          )}
          {/* 「? 玩法说明」（2026-11-24）：把对局面板那一份引导再放一遍（tours.tsx 的 ingame 六步）。
              ★ 只在开局时摆（`isLand && inGame`）：那一份讲的全是局内的面板，没开局时点开是一片
                "这些面板长什么样"的空话；大厅自己那颗 ? 在大厅顶栏上（ui/Lobby）。
              ★ 摆在 ⚙ 旁边（都是"这一局"的键）；大厅盖着时这一层本来就被盖住，不会与大厅那颗同时出现。 */}
          {isLand && inGame && <HelpButton tour="ingame" />}
          {/* ⚙ 设置（2026-11-24）：**只在开着一局时**摆 —— 音量 / 退出游戏这些字段都是对局里的东西，
              没开局时它只会是一颗空页入口（画质与语言在「我的 → 设置」里也有，但那是另一套页面）。
              位置紧跟「✕ 结束对局」：两颗都是"这一局"的键，放一起才不会被当成工坊的设置。 */}
          {isLand && inGame && (
            <button
              onClick={() => setSettingsOpen(true)}
              title={t`设置：音量 / 画质 / 语言 / 操作提示 / 退出游戏`}
              aria-label={t`设置`}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-panel/85 text-slate-100 backdrop-blur"
            >
              <Icon name="settings" size={18} />
            </button>
          )}
          {/* 「🧩 工作流」：**对局里 = 纯预览**（G4 施工单 §2 第三条：只展示本局每段视频的信息，
              删掉修改 / 重新生成片段那些操作，见 game/ui/GenPreview）；不在对局里 = 原来的画布。
              ★ 为什么分两种：画布是**新建流水线唯一的门**（G4 第 1 步把桌面节点卡撤了，见 canvasCovered
                的 ★）。对局外也做成只读的话，工坊就再也做不出自己的片了 —— 而施工单这一条
                说的是"桌面（对局）右上那颗键"。
              不在对局里时：空流水线也照开，画布里有空态与「对画布说话」输入条。 */}
          <button
            onClick={() =>
              inGame ? useGame.getState().setPreviewOpen(true) : setCanvasOpen(true)
            }
            title={inGame ? t`工作流：本局每段的预览（只让看不让改）` : t`工作流画布：同一条流水线的另一面`}
            aria-label={inGame ? t`工作流预览` : t`工作流画布`}
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
      {/* 大厅（2026-11-23）：横屏才挂（与对局一致；竖屏一个像素都不出现）。
          它自己判 lobbyStore.open 与"有没有开着局"（对局中不出现），所以这里不重复判。
          层级 z-40：盖住顶栏那颗「▶ 开局」（大厅里有自己的「✕ 返回工坊」）。 */}
      {isLand && <Lobby />}
      {/* 对局设置页（2026-11-24）：z-50，盖住对局 UI 与顶栏那一排键。
          ★ 挂在这一层而不是 GameLayer 里：选风格那一屏 GameLayer 会早退（只画 StylePick），
            挂在那儿的话在那一屏点 ⚙ 点了没反应（铁律八）。
          ★ 只在这一局还开着时挂（inGame）：认输退出之后这一页当场消失，不用等一个 effect 去收。 */}
      {isLand && inGame && settingsOpen && <GameSettings onClose={() => setSettingsOpen(false)} />}
      {/* 本局战绩 + 回放（2026-11-24）：两个入口都写 historyStore.open，这里只负责挂。
          在设置页之后挂 → 同一层级（z-50）时它盖在上面；结束屏上不会同时开设置页。 */}
      {isLand && <MatchHistory />}
      {/* 竖屏 + 大厅：大厅那一屏只在横屏挂（与对局一致），而「开始做完整作品」可能落在竖屏窗口里
          （dev 浏览器拖成竖的）。不说这一句的话，点进来看见的是 3D 桌面，像是在"没落地"。 */}
      {!isLand && lobbyOpen && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-40 flex -translate-y-1/2 justify-center px-6">
          <div className="rounded-xl bg-panel/95 px-4 py-3 text-center text-xs leading-relaxed text-slate-200 ring-1 ring-white/10">
            <Trans>对局大厅是横屏的：把手机横过来就能开局。</Trans>
          </div>
        </div>
      )}
      <StudioLoader />
      {/* ── 工作流画布：同一条流水线的另一个面，就地铺满这一屏（2026-08-30 合并）──
          ★ 它自带 z-40 全屏 portal，所以挂在这里不影响上面那些浮层的层级关系。
          ★ 那三件页级活儿（存草稿 / 组稿 / 挂卡）实现只有一份：存草稿与组稿在
            hooks/useFlowActions，挂卡入参在 FlowPage.castEditorState（回程 useCastReturn
            两页共用）—— 画布照旧只借按钮与状态，工坊这一面不抄第二份（铁律六）。
          ★ ✕ 与「🎴 工坊」都是关掉浮层回到桌面：合并之后它们不再是"去另一页"。
          ★ 判据是 **canvasOpen**（不是 canvasCovered）：后者 2026-11-23 起也含大厅
            （大厅开着同样要停帧），而大厅开着时不该把画布一起铺上来。 */}
      {canvasOpen && (
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
