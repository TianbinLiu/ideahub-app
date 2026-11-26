// GS 测地场景的独立预览页（**不进 App 构建**，和 design/ 下别的离线工具同一条规矩）：
//   只放 splat 房间 + 旧场景那张长桌（米制 2.50×1.17 + 光毯）+ 月光/真火 + 几张假卡，
//   相机抄游戏里的 GS_CAM。
// 为什么单开一页而不是直接在工坊里试（docs/gs-step0-plan.md §3.4）：TableScene 的相机是演出机位
//   （CameraRig 每帧按 aspect 选机位），混上 splat 出了问题是相机还是资产分不清。
//
// 用法（dev 服务器，/studio 那条路要登录，这一页不用）：
//   npm run dev
//   http://localhost:5173/design/gs-preview.html?gs=1
// 相机可以走地址栏临时摆：?gs=1&cx=0.95&cy=1.15&cz=2.15&lx=-0.15&ly=0.02&lz=-0.75&fov=50
// 尺度/朝向/平移也可以临时拧（读的是 src/studio/scene/gsStep0.ts 里那几个 dev 覆盖）：
//   &gsScale=1&gsYaw=20.15&gsTilt=0&gsX=0&gsY=0&gsZ=0
import { StrictMode, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { GS_CAM, GS_CARD, GS_TABLE } from "../src/studio/scene/layout";
import { GsStep0Environment } from "../src/studio/scene/GsStep0Environment";
import { GS_FIRE_LIGHT, useGsPhase } from "../src/studio/scene/gsStep0";
import WorkshopTable from "../src/studio/scene/WorkshopTable";


const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const raw = q.get(k);
  if (raw === null || raw === "") return d;
  const v = Number(raw);
  return Number.isFinite(v) ? v : d;
};

const CAM = {
  pos: [num("cx", GS_CAM.pos[0]), num("cy", GS_CAM.pos[1]), num("cz", GS_CAM.pos[2])] as [number, number, number],
  look: [num("lx", GS_CAM.look[0]), num("ly", GS_CAM.look[1]), num("lz", GS_CAM.look[2])] as [number, number, number],
  fov: num("fov", 50),
};

/** 与 TableScene 同一套判定：开着且没失败才挂米制桌面；失败就只留今天的房间（不黑屏） */
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
      {gsOn && <WorkshopTable T={GS_TABLE} height={GS_TABLE.height} metric />}
      <FakeCards />
      {/* 铸卡师的**占位体**（0.45 × 1.7 × 0.25 的盒子，脚踩地板 y=-0.775、站在 z=-1.5）：
          预览页不加载受保护模型（.glbx 要 App 的解密层），这里只用它量"人 / 桌 / 房"的比例。 */}
      <mesh position={[0, -0.785 + 0.875, -1.9]}>
        <boxGeometry args={[0.45, 1.75, 0.25]} />
        <meshStandardMaterial color="#8a6a8a" roughness={0.9} />
      </mesh>
    </>
  );
}

/** 固定机位：抄 GS_CAM（相机由地址栏覆盖），不做任何跟随 */
function FixedCam() {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    camera.position.set(...CAM.pos);
    camera.lookAt(new THREE.Vector3(...CAM.look));
  }, [camera]);
  return null;
}

/** 几张桌面假卡（米制 0.30×0.45，贴 y=GS_CARD.lift）：验"卡陷进桌面 / 被 splat 挡住 / 闪烁" */
function FakeCards() {
  // 与 GameTableSlots 同一套卡位（4 角色一排 + 场景位在远端），颜色只是肉眼可分辨
  const spots: [number, number, number][] = [
    [-0.4425, -0.35, 0],
    [-0.1475, -0.35, 1],
    [0.1475, -0.35, 2],
    [0.4425, -0.35, 3],
    [0, -1.0, 4],
  ];
  return (
    <>
      {spots.map(([x, z, i]) => (
        <mesh key={i} position={[x, GS_CARD.lift, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[GS_CARD.w, GS_CARD.h]} />
          <meshStandardMaterial
            color={["#e8c46a", "#7fc9d8", "#d98cb0", "#9fd88c", "#c8b0e8"][i]}
            roughness={0.7}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </>
  );
}

/** 调试用：在火的位置放一颗洋红小球（?fire=1），对"炉膛到底在哪"很有用 */
function FireMarker({ pos }: { pos: [number, number, number] }) {
  if (q.get("fire") !== "1") return null;
  // 一排探针：从墙（x≈-2.06）往房间里每 0.3 m 一颗，看哪一颗落在炉膛开口里
  const probes = [-2.0, -1.7, -1.4, -1.1, -0.8, -0.5].map((x, i) => ({
    x,
    color: ["#ff00ff", "#ff0000", "#ffff00", "#00ff00", "#00ffff", "#ffffff"][i],
  }));
  return (
    <>
      {probes.map((p) => (
        <mesh key={p.x} position={[p.x, pos[1], pos[2]]} renderOrder={999}>
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshBasicMaterial color={p.color} depthTest={false} />
        </mesh>
      ))}
    </>
  );
}

// 想按真机画幅（800×363，aspect 2.245）看构图就加 &w=800&h=363 —— 画布跟着容器走，
// 与 App 里 Canvas 按容器量尺寸的行为一致（x 百分比与 aspect 强相关，y 百分比与它无关）。
const VW = Number(q.get("w")) || 0;
const VH = Number(q.get("h")) || 0;
const wrap = VW && VH ? { width: `${VW}px`, height: `${VH}px`, margin: "0 auto" } : { width: "100%", height: "100%" };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div style={wrap}>
      <Canvas shadows camera={{ fov: CAM.fov, near: 0.1, far: 400, position: CAM.pos }}>
        <FixedCam />
        <Scene />
        <FireMarker pos={GS_FIRE_LIGHT.position} />
      </Canvas>
    </div>
  </StrictMode>,
);
