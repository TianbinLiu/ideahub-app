// 卡片工坊页（竖屏优先）：3D 画布 + 投影窗 + NPC 底部抽屉 + 提示条
import { useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Link, useNavigate } from "react-router-dom";
import TableScene from "./scene/TableScene";
import { composable, placeholderVisible, useStudio } from "./studioStore";
import { DEFAULT_CAM, SPREAD } from "./scene/layout";
import NpcDialog from "./ui/NpcDialog";
import ProjectionWindow from "./ui/projection";
import { CardDetailModal, ComposeOverlay } from "./ui/modals";

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
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3">
        <Link
          to="/"
          className="pointer-events-auto rounded-full bg-panel/80 px-3 py-1.5 text-xs text-slate-300 backdrop-blur"
        >
          ← 首页
        </Link>
        <div className="rounded-full bg-panel/80 px-3 py-1.5 text-xs font-semibold text-brand backdrop-blur">
          🎴 卡片工坊
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
    </div>
  );
}
