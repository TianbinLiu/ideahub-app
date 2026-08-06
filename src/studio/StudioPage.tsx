// 卡片工坊页（竖屏优先）：3D 画布 + 投影窗 + NPC 底部抽屉 + 提示条
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { Link, useNavigate } from "react-router-dom";
import TableScene from "./scene/TableScene";
import { AI_REAL } from "../ai";
import { composable, placeholderVisible, useStudio } from "./studioStore";
import { DEFAULT_CAM, SPREAD } from "./scene/layout";
import NpcDialog from "./ui/NpcDialog";
import ProjectionWindow from "./ui/projection";
import { CardDetailModal, ComposeOverlay } from "./ui/modals";
import AvatarPicker from "./ui/AvatarPicker";
import QualityPicker from "./ui/QualityPicker";

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
  if (projection === "editor") return "填入素材与要求，AI 将推演三种走向";
  if (projection === "proposals") return "点开投影中的方案卡，选定后卡片落回桌面";
  if (focus) return "点击卡片之外的桌面区域可拉远视角";
  if (marketOpen) return "点桌上的市场卡放大查看，喜欢就收进卡组";
  if (!root && deckLen === 0) return "先把素材交给铸卡师炼卡，或让 TA 摊开市场";
  if (!root) return "点击虚线卡位，铸造第一段视频节点";
  if (placeholderVisible(root) && composable(root)) return "点虚线卡位延展下一段，或点金色圆台合成完整视频";
  return "点击节点卡可重新查看三种走向";
}

export default function StudioPage() {
  const navigate = useNavigate();
  const draft = useStudio((s) => s.draft);
  const composing = useStudio((s) => s.composing);
  const initGreet = useStudio((s) => s.initGreet);
  const spreadOpen = useStudio((s) => s.spreadOpen);
  const deckLen = useStudio((s) => s.deck.length);
  const shiftSpread = useStudio((s) => s.shiftSpread);
  const hint = useHint();
  const [qualityOpen, setQualityOpen] = useState(false);

  useEffect(() => {
    initGreet();
  }, [initGreet]);

  // 仅在“合成刚结束”那一刻跳转发布页，避免回到工坊被再次弹走
  const prevComposing = useRef(false);
  useEffect(() => {
    if (prevComposing.current && !composing && draft) navigate("/publish");
    prevComposing.current = composing;
  }, [composing, draft, navigate]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink">
      <Canvas
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true }}
        camera={{ fov: 50, position: DEFAULT_CAM.pos, near: 0.1, far: 80 }}
      >
        <TableScene />
      </Canvas>

      {/* 顶栏（竖屏紧凑） */}
      <div className="safe-top pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3">
        <Link
          to="/"
          className="pointer-events-auto rounded-full bg-panel/80 px-3 py-1.5 text-xs text-slate-300 backdrop-blur"
        >
          ← 首页
        </Link>
        <div className="pointer-events-auto flex items-center gap-2">
          {/* 真实/演示一目了然：此前跑在没配 Key 的目录里全程 mock，
              用户以为在测 Seedance，实际产物全是本地占位——必须把模式亮出来 */}
          <div
            className={`rounded-full bg-panel/80 px-3 py-1.5 text-xs backdrop-blur ${AI_REAL ? "text-emerald-300" : "text-amber-300"}`}
            title={AI_REAL ? "已连接火山方舟：剧情/首尾帧/视频均真实生成" : "未配置 ARK_API_KEY：产物为本地模拟，仅演示流程"}
          >
            {AI_REAL ? "● 真实 AI" : "○ 演示模式"}
          </div>
          <div className="rounded-full bg-panel/80 px-3 py-1.5 text-xs font-semibold text-brand backdrop-blur">
            🎴 卡片工坊
          </div>
          <button
            onClick={() => useStudio.getState().setAvatarPickerOpen(true)}
            className="rounded-full bg-panel/80 px-3 py-1.5 text-xs text-slate-300 backdrop-blur"
            title="选择形象"
          >
            👤 形象
          </button>
          <button
            onClick={() => setQualityOpen(true)}
            className="rounded-full bg-panel/80 px-3 py-1.5 text-xs text-slate-300 backdrop-blur"
            title="画面质量"
          >
            ⚙️ 画质
          </button>
        </div>
      </div>

      {/* 提示条（NPC 气泡栏上方） */}
      <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center px-4">
        <div className="rounded-full bg-panel/75 px-4 py-1.5 text-center text-xs text-slate-300 backdrop-blur">{hint}</div>
      </div>

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
      <ComposeOverlay />
      <AvatarPicker />
      <QualityPicker open={qualityOpen} onClose={() => setQualityOpen(false)} />
      <StudioLoader />
    </div>
  );
}
