// 「正对窗 + 一圈墙」高清抓图页（**不进 App 构建**，与 design/ 下别的离线工具同一条规矩）。
//
// 为什么要单开一页：`/studio` 那条路要登录 + 走大厅，且 Camvas 按容器尺寸定分辨率，
//   普通截图只能拿到窗口尺寸那点像素。这一页把画布**直接设成 1536×1536 CSS、dpr 2**
//   （= 3072×3072 后备缓冲），再开 `preserveDrawingBuffer`，所以可以 `canvas.toDataURL()`
//   拿到完整分辨率的 PNG —— 这是"从原 splat 场景抓一张尽量高清的窗"唯一不依赖显示器的那条路。
//
// 用法（dev 服务器，仓库根目录 = app/）：
//   node node_modules/vite/bin/vite.js --port 5199
//   http://localhost:5199/design/gs-window-shot.html
// 相机/画幅都可以走地址栏（缺省值 = 正对窗、距窗 1.6 m、平视窗心、fov 65）：
//   ?cx=-0.0467&cy=0.6592&cz=-2.0298&lx=-0.0467&ly=0.6592&lz=-3.6298&fov=65&css=1536&dpr=2
//
// 页面暴露两个钩子（抓图与量窗洞都用它们，别在控制台里手算）：
//   `window.__shot()`  → PNG dataURL（当前后备缓冲分辨率，默认 3072×3072）
//   `window.__probe()` → 窗洞（直径 0.9 m 的圆）在当前分辨率下的像素矩形 + 相机参数
//
// ★ 窗的世界坐标**不手抄**：读 `moonGeometry.WINDOW.center`（它自己由 gsStep0 的落位常量现算）。
// ★ 只挂 GsStep0Environment（splat 房间 + 灯组）：不挂桌子/NPC/卡牌 —— 相机在窗前 1.6 m 处
//   朝 −z 看，桌子在相机背后，本来也进不了画面；少挂几样 = 抓图不会因为别的东西闪而变。
import { StrictMode, Suspense, lazy, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { GsStep0Environment } from "../src/studio/scene/GsStep0Environment";
import { GS_DAY, useGsPhase } from "../src/studio/scene/gsStep0";
import { WINDOW } from "../src/studio/scene/moonGeometry";
import { setSceneKindForced } from "../src/studio/scene/sceneSplit";
import { GS_CARD, GS_ROWS, GS_TABLE } from "../src/studio/scene/layout";
import WorkshopTable from "../src/studio/scene/WorkshopTable";

const GsStep0Room = lazy(() => import("../src/studio/scene/GsStep0Room"));
// ★ 2026-11-27（`feat/gs-scene-split`）：SparkRenderer 从 GsStep0Room 挪到了 `GsSparkStage`
//   （两套场景共用一台）。这个页面的 `moon=0` 分支直接挂 GsStep0Room，所以也得把它挂上，
//   否则是一张"只有背景色"的图（splat 没人画）。
const GsSparkStage = lazy(() => import("../src/studio/scene/GsSparkStage"));

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const raw = q.get(k);
  if (raw === null || raw === "") return d;
  const v = Number(raw);
  return Number.isFinite(v) ? v : d;
};

const [wx, wy, wz] = WINDOW.center;

/** 默认机位：窗正前方 +z 侧 1.6 m（房间在 +z，见 moonGeometry.WINDOW.normal）、平视窗心 */
const CAM = {
  pos: [num("cx", wx), num("cy", wy), num("cz", wz + 1.6)] as [number, number, number],
  look: [num("lx", wx), num("ly", wy), num("lz", wz)] as [number, number, number],
  fov: num("fov", 65),
};
const CSS = num("css", 1536);
const DPR = num("dpr", 2);
/** 挂不挂 App 那层程序化明月窗（`MoonWindow`：夜空球 + 月盘 + 补的窗框窗棂）。
 *  `moon=0` → 只画 splat 本身 = **原始**的磨砂圆窗（AI 改图要的"原图"就是它）；
 *  `moon=1` → App 里真实看到的样子（贴在场景里的预览用它）。 */
const MOON = q.get("moon") !== "0";
/** 挂不挂桌子和桌面卡（只给"贴进场景"的预览底图用；`table=1` 时挂） */
const TABLE = q.get("table") === "1";

// ★ 2026-11-27（`feat/gs-scene-split`）：场景拆成"大厅（窗景 splat）/ 房间（窗洞平贴图）"两套之后，
//   窗景 splat **只在大厅那一档挂**（房间那一档主人拍板用平贴图）。这个抓图页要拍的正是 splat，
//   所以把场景强制钉在 lobby —— 否则这里只能拍到平贴图，`?moon=0` 那条"原始磨砂窗"也没了。
//   （强制只对 dev 抓图页有效；正式包里没有人写它。）
if (MOON) setSceneKindForced("lobby");

function Scene() {
  const phase = useGsPhase();
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);

  useLayoutEffect(() => {
    camera.position.set(...CAM.pos);
    camera.lookAt(new THREE.Vector3(...CAM.look));
    camera.updateMatrixWorld(true);
  }, [camera]);

  useLayoutEffect(() => {
    const el = document.getElementById("hud");
    if (el) {
      el.textContent =
        `gsPhase=${phase}  moon=${MOON ? 1 : 0}  dpr=${DPR}  fov=${CAM.fov}\n` +
        `cam ${CAM.pos.map((n) => n.toFixed(3)).join(", ")} → ${CAM.look.map((n) => n.toFixed(3)).join(", ")}\n` +
        `backing ${gl.domElement.width}×${gl.domElement.height}`;
    }
    // 窗洞投影：把 WINDOW 那个圆环（半径 0.45 m，在窗面 z 平面上）逐点投到像素空间取包围盒。
    // 圆在斜看时是椭圆，包围盒就是像素矩形 —— 蒙版也用它（圆心 + 半径）。
    const probe = () => {
      const [cx, cy, cz] = WINDOW.center;
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (let i = 0; i < 720; i++) {
        const a = (i / 720) * Math.PI * 2;
        const p = new THREE.Vector3(cx + Math.cos(a) * WINDOW.radius, cy + Math.sin(a) * WINDOW.radius, cz);
        p.project(camera);
        const px = ((p.x + 1) / 2) * gl.domElement.width;
        const py = ((1 - p.y) / 2) * gl.domElement.height;
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
      return {
        width: gl.domElement.width,
        height: gl.domElement.height,
        rect: { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) },
        circle: {
          cx: Math.round((x0 + x1) / 2),
          cy: Math.round((y0 + y1) / 2),
          r: Math.round((x1 - x0) / 2),
        },
        fov: CAM.fov,
        camPos: CAM.pos,
        camLook: CAM.look,
        windowCenter: WINDOW.center,
        windowRadius: WINDOW.radius,
        moon: MOON ? 1 : 0,
        phase,
      };
    };
    const w = window as unknown as Record<string, unknown>;
    w.__probe = probe;
    w.__shot = () => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/png");
    };
  }, [phase, gl, camera, scene]);

  if (MOON)
    return (
      <>
        <GsStep0Environment />
        {TABLE && <RoomProps />}
      </>
    );
  // 只要 splat 本身：背景色 + 雾 + 房间（灯组不挂 —— splat 不吃灯，而这里没有 mesh 可照）
  return (
    <>
      <color attach="background" args={[GS_DAY.bg]} />
      <fog attach="fog" args={[GS_DAY.bg, GS_DAY.fog[0], GS_DAY.fog[1]]} />
      <Suspense fallback={null}>
        <GsSparkStage />
        <GsStep0Room />
      </Suspense>
    </>
  );
}

/** 房间里的家具（只在 `table=1` 时挂）：抄 design/gs-preview.tsx 的同一套 ——
 *  米制 2.50×1.17 的长桌 + 几张桌面假卡。给"贴进场景"的预览当上下文用。 */
function RoomProps() {
  return (
    <>
      <WorkshopTable T={GS_TABLE} height={GS_TABLE.height} metric splatLen={GS_TABLE.splatLen} />
      {GS_ROWS.zs.flatMap((z, col) =>
        [-0.32, 0.32].map((x, row) => (
          <mesh key={`${row}-${col}`} position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, GS_ROWS.flatRotZ]}>
            <planeGeometry args={[GS_CARD.w, GS_CARD.h]} />
            <meshStandardMaterial
              color={["#e8c46a", "#7fc9d8", "#d98cb0", "#9fd88c", "#c8b0e8", "#f0a868", "#8fd8c8", "#e88f8f"][(row * 4 + col) % 8]}
              roughness={0.7}
              side={THREE.DoubleSide}
            />
          </mesh>
        )),
      )}
    </>
  );
}

const root = document.getElementById("root")!;
root.style.width = `${CSS}px`;
root.style.height = `${CSS}px`;

createRoot(root).render(
  <StrictMode>
    <Canvas
      shadows
      dpr={DPR}
      camera={{ fov: CAM.fov, near: 0.05, far: 400, position: CAM.pos }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
    >
      <Scene />
    </Canvas>
  </StrictMode>,
);
