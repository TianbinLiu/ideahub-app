// GS 第 0 步的独立预览页（**不进 App 构建**，和 design/ 下别的离线工具同一条规矩）：
//   只放 splat 房间 + 桌面盖板 + 白天一档 + 几张假卡，相机抄游戏里的 LAND_CAM。
// 为什么单开一页而不是直接在工坊里试（docs/gs-step0-plan.md §3.4）：TableScene 的相机是演出机位
//   （CameraRig 每帧按 aspect 选机位），混上 splat 出了问题是相机还是资产分不清。
//
// 用法（dev 服务器，/studio 那条路要登录，这一页不用）：
//   npm run dev
//   http://localhost:5173/design/gs-preview.html?gs=1
// 相机可以走地址栏临时摆：?gs=1&cx=0&cy=3.9&cz=7.4&lx=0&ly=0&lz=0&fov=50
// 尺度/朝向/平移也可以临时拧（读的是 src/studio/scene/gsStep0.ts 里那几个 dev 覆盖）：
//   &gsScale=8.49&gsYaw=-127.46&gsX=0&gsY=0&gsZ=0
import { StrictMode, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { LAND_CAM } from "../src/studio/scene/layout";
import { GsStep0Environment, GsTableCover } from "../src/studio/scene/GsStep0Environment";
import { useGsPhase } from "../src/studio/scene/gsStep0";

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const raw = q.get(k);
  if (raw === null || raw === "") return d;
  const v = Number(raw);
  return Number.isFinite(v) ? v : d;
};

const CAM = {
  pos: [num("cx", LAND_CAM.pos[0]), num("cy", LAND_CAM.pos[1]), num("cz", LAND_CAM.pos[2])] as [number, number, number],
  look: [num("lx", LAND_CAM.look[0]), num("ly", LAND_CAM.look[1]), num("lz", LAND_CAM.look[2])] as [number, number, number],
  fov: num("fov", 50),
};

/** 与 TableScene 同一套判定：开着且没失败才挂盖板；失败就只留今天的房间（不黑屏） */
function Scene() {
  const phase = useGsPhase();
  // ★ 阶段写进左下角那行字：这一页唯一的"读数"，截图就能证明它到底是 ready 还是回落了
  useLayoutEffect(() => {
    const el = document.getElementById("hud");
    if (el) el.textContent = `gsPhase=${phase}  cam ${CAM.pos.join(",")} → ${CAM.look.join(",")}  fov ${CAM.fov}`;
  }, [phase]);
  const gsOn = phase === "loading" || phase === "ready";
  return (
    <>
      <GsStep0Environment />
      {gsOn && <GsTableCover />}
      <FakeCards />
    </>
  );
}

/** 固定机位：抄 LAND_CAM（相机由地址栏覆盖），不做任何跟随 */
function FixedCam() {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    camera.position.set(...CAM.pos);
    camera.lookAt(new THREE.Vector3(...CAM.look));
  }, [camera]);
  return null;
}

/** 几张桌面假卡（1.1 × 1.65，贴 y=0.02 的 CARD.lift）：验"卡陷进桌面 / 被 splat 挡住 / 闪烁" */
function FakeCards() {
  const spots: [number, number][] = [
    [-3, 2.2],
    [0, 1.1],
    [3, 0.2],
    [-3.2, -1.6],
    [2.8, -2.4],
  ];
  return (
    <>
      {spots.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1.1, 1.65]} />
          <meshStandardMaterial color={["#e8c46a", "#7fc9d8", "#d98cb0", "#9fd88c", "#c8b0e8"][i]} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Canvas shadows camera={{ fov: CAM.fov, near: 0.1, far: 400, position: CAM.pos }}>
      <FixedCam />
      <Scene />
    </Canvas>
  </StrictMode>,
);
