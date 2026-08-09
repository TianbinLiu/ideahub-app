// 卡片工坊页（竖屏优先）：3D 画布 + 投影窗 + NPC 底部抽屉 + 提示条
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { useNavigate } from "react-router";
import TableScene from "./scene/TableScene";
import { AI_REAL } from "../ai";
import { myCards } from "../data/account";
import { backLabelOf, composable, placeholderVisible, useStudio } from "./studioStore";
import { useFlow } from "./flowStore";
import { DEFAULT_CAM, SPREAD } from "./scene/layout";
import NpcDialog from "./ui/NpcDialog";
import ProjectionWindow from "./ui/projection";
import { CardDetailModal } from "./ui/modals";
import AvatarPicker from "./ui/AvatarPicker";
import AvatarSwapButton from "./ui/AvatarSwapButton";
import { cancelPendingStop, stopSpeakingSoon } from "./speech";
import { useStudioBack } from "./useStudioBack";
import { autoQualityOnFirstVisit, QUALITY_LABELS, type Quality } from "./quality";
import Icon from "../components/Icon";
import { MARKET } from "./scene/layout";

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
        setTimeout(() => setPhase("gone"), 500);
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
      className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#05070f] transition-opacity duration-500 ${
        phase === "fading" ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {/* 法阵旋转环 */}
      <div className="relative mb-6 h-20 w-20">
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-cyan-300/80 border-r-cyan-300/30" style={{ animationDuration: "1.6s" }} />
        <div className="absolute inset-2 animate-spin rounded-full border border-transparent border-b-amber-300/70" style={{ animationDuration: "2.4s", animationDirection: "reverse" }} />
        <div className="absolute inset-0 flex items-center justify-center text-2xl">🎴</div>
      </div>
      <div className="mb-3 text-sm font-semibold tracking-widest text-slate-200">正在点亮魔法书房…</div>
      <div className="h-1 w-40 overflow-hidden rounded-full bg-slate-700/60">
        <div className="h-full rounded-full bg-cyan-300/80 transition-all duration-300" style={{ width: `${Math.max(8, progress)}%` }} />
      </div>
    </div>
  );
}

function useHint(): string {
  const deckLen = useStudio((s) => s.deck.length);
  const root = useStudio((s) => s.root);
  const projection = useStudio((s) => s.projection);
  const focus = useStudio((s) => s.focus);
  const marketOpen = useStudio((s) => s.market.open);
  const spreadOpen = useStudio((s) => s.spreadOpen);
  if (projection === "editor") return "填入素材与要求，AI 将推演三种走向";
  if (projection === "proposals") return "点开投影中的方案卡，选定后卡片落回桌面";
  if (projection === "decks") return "小窗右上角可在「卡组 / 卡片」间切换，单击卡片看详情";
  if (focus) return "点击卡片之外的桌面区域可拉远视角";
  if (marketOpen) return "点桌上的市场卡放大查看，喜欢就收进卡组";
  if (spreadOpen) return "拖卡片到虚线卡位铸段 · 单点看详情";
  if (!root && deckLen === 0) return "先把素材交给铸卡师炼卡，或让 TA 摊开市场";
  if (!root) return "点击虚线卡位，铸造第一段视频节点";
  // 「金色圆台」这个说法在圆台改成法阵后就对不上了（它现在暗着的时候是冷灰的）；
  // 统一叫「法阵」，与台前铭牌上的「生成成片 · 点亮法阵」同一套词
  if (placeholderVisible(root) && composable(root)) return "点虚线卡位延展下一段 · 点亮法阵可逐段推演成片";
  return "点击节点卡可重新查看三种走向";
}

// ── 市场翻页箭头：屏幕两侧竖直居中，56px 热区（比卡组那对 36px 的大一圈，
//    因为它在 3D 画布上、周围没有别的可点物，够大才不会误触到桌面）──
function MarketArrow({ dir, disabled, side }: { dir: 1 | -1; disabled: boolean; side: "left" | "right" }) {
  return (
    <button
      onClick={() => useStudio.getState().shiftMarket(dir)}
      disabled={disabled}
      aria-label={dir < 0 ? "上一页" : "下一页"}
      className={`absolute top-[46%] z-10 flex h-14 w-14 items-center justify-center rounded-full bg-panel/75 text-2xl text-slate-200 backdrop-blur transition-opacity disabled:opacity-25 ${
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
      <div className="rounded-full bg-black/70 px-3.5 py-1.5 text-center text-[11px] text-slate-300 backdrop-blur">
        已按你的设备自动选择「{QUALITY_LABELS[q].name}」画质 · 可在「我的 → 设置」里改
      </div>
    </div>
  );
}

export default function StudioPage() {
  const navigate = useNavigate();
  const editTarget = useStudio((s) => s.editTarget);
  const initGreet = useStudio((s) => s.initGreet);
  const spreadOpen = useStudio((s) => s.spreadOpen);
  const deckLen = useStudio((s) => s.deck.length);
  const shiftSpread = useStudio((s) => s.shiftSpread);
  const hint = useHint();
  const onBack = useStudioBack();
  // 按钮文案随当前层级变——去掉对话气泡的 ✕ 之后，"按返回能退出什么"全靠它说
  const backLabel = useStudio(backLabelOf);
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

  // 点金色圆台 → 铺成工作流后跳 /flow（逐段生成逐段确认，全部满意才进剪辑页）。
  // 只在"节点数从 0 变成有"的那一刻跳，避免从工作流返回工坊时又被弹走
  const flowLen = useFlow((s) => s.nodes.length);
  const prevFlowLen = useRef(flowLen);
  useEffect(() => {
    if (prevFlowLen.current === 0 && flowLen > 0) navigate("/flow");
    prevFlowLen.current = flowLen;
  }, [flowLen, navigate]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink">
      <Canvas
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true }}
        camera={{ fov: 50, position: DEFAULT_CAM.pos, near: 0.1, far: 80 }}
      >
        <TableScene />
      </Canvas>

      {/* 顶栏。返回按钮是**层层退出**的唯一入口：有浮层先关浮层、在对话里先退对话、
          在卡组视角先退卡组，都没有了才回首页（见 studioStore.backStepOf）。
          热区 48px：原来的「← 首页」是 px-3 py-1.5 的小胶囊（约 24px 高），
          手机上够不着；44px 是移动端热区下限，这里给到 48。
          ⚠ safe-top 写在 @tailwind utilities 之后，同特异性下会**覆盖** p-3 的
          padding-top——所以竖排间距靠 pt-* 单独给，别指望 p-3 */}
      <div className="safe-top pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between px-3 pb-3 pt-3">
        <button
          onClick={onBack}
          className="pointer-events-auto flex h-12 items-center gap-1 rounded-full bg-panel/85 pl-2.5 pr-4 text-slate-200 backdrop-blur active:bg-panel"
          aria-label={backLabel}
        >
          <Icon name="back" size={20} />
          <span className="text-xs">{backLabel}</span>
        </button>
        <div className="pointer-events-auto flex items-center gap-2 pt-2">
          {/* 只在演示模式亮牌。「● 真实 AI」是常态，天天挂在那儿只是噪音；
              而没配 Key 时全程 mock——用户以为在测 Seedance、产物却全是本地占位，
              这一条必须留着。标题栏的「🎴 卡片工坊」也去掉了：画面本身就是工坊 */}
          {!AI_REAL && (
            <div
              className="rounded-full bg-panel/80 px-3 py-1.5 text-xs text-amber-300 backdrop-blur"
              title="未配置 ARK_API_KEY：产物为本地模拟，仅演示流程"
            >
              ○ 演示模式
            </div>
          )}
        </div>
      </div>

      {/* 回炉编辑横幅：不亮出来的话，用户忘了自己在编辑模式，合成时会疑惑为什么没有新作品 */}
      {editTarget && (
        <div className="safe-top pointer-events-none absolute inset-x-0 top-[4.5rem] flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/15 px-3.5 py-1.5 text-xs text-amber-200 backdrop-blur">
            <span className="truncate">🛠 正在编辑《{editTarget.videoTitle}》· {editTarget.partName}——生成后保存到该作品</span>
            <button
              onClick={() => useStudio.getState().exitEdit()}
              className="flex-none rounded-full bg-black/30 px-2 py-0.5 text-amber-100 hover:bg-black/50"
            >
              退出
            </button>
          </div>
        </div>
      )}

      {/* 提示条（NPC 气泡栏上方） */}
      <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center px-4">
        <div className="rounded-full bg-panel/75 px-4 py-1.5 text-center text-xs text-slate-300 backdrop-blur">{hint}</div>
      </div>

      {/* 市场翻页箭头：市场种子有 19 张，一页摆 6 张 → 4 页。放在屏幕两侧竖直居中，
          与卡组展开排那对箭头（左下角）错开位置，不会打架 */}
      {marketOpen && marketLen > MARKET.perPage && (
        <>
          <MarketArrow dir={-1} disabled={marketPage === 0} side="left" />
          <MarketArrow dir={1} disabled={(marketPage + 1) * MARKET.perPage >= marketLen} side="right" />
          <div className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center">
            <span className="rounded-full bg-black/45 px-2.5 py-0.5 text-[11px] text-slate-300 backdrop-blur">
              {marketPage + 1} / {Math.ceil(marketLen / MARKET.perPage)}
            </span>
          </div>
        </>
      )}

      {/* 返回被拒绝之类的瞬时提示（投影窗盖着时铸卡师说话用户看不见，只能走这里） */}
      <Toast notice={notice} />
      {autoQ && <AutoQualityHint q={autoQ} />}

      {/* 卡组展开翻页箭头 */}
      {spreadOpen && deckLen > SPREAD.maxVisible && (
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
      <StudioLoader />
    </div>
  );
}
