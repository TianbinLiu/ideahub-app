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
import { GS_CAM, GS_CARD, GS_MARKET, GS_ROWS, GS_SLOTS, GS_TABLE } from "../src/studio/scene/layout";
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
      {gsOn && <WorkshopTable T={GS_TABLE} height={GS_TABLE.height} metric splatLen={GS_TABLE.splatLen} />}
      <FakeCards />
      {/* 铸卡师的**占位体**（0.25 × 1.5 × 0.45 的盒子，站在**壁炉那一侧** = NPC 侧一排之外
          x=−1.05 / z=0.10，面朝玩家 +x）。尺寸按 `TableScene.GS_MILLTINA_CFG` 这一版：
          身高 1.50 m、再整体下沉 0.28 m（腰线压到桌沿的遮挡线上，画面里只露腰以上）。
          预览页不加载受保护模型（.glbx 要 App 的解密层），这里只用它量"人 / 桌 / 房"的比例。 */}
      <mesh position={[-1.05, -0.785 - 0.22 + 0.75, 0.55]}>
        <boxGeometry args={[0.25, 1.5, 0.45]} />
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

/** 几张桌面假卡（米制 0.28×0.42 **平放**，与 TableScene 同一套朝向 GS_ROWS.flatRotZ）：
 *  验"两排卡分居中线两侧 / 中线整条露出来 / 卡不重叠 / 不出桌"。 */
function FakeCards() {
  const y = 0.02;
  const rotZ = GS_ROWS.flatRotZ;
  const player = GS_ROWS.zs.map((z, i) => ({ p: [GS_SLOTS.roleAlong, y, z] as [number, number, number], i }));
  const npc = GS_MARKET.rows.flatMap((x, row) =>
    GS_ROWS.zs.map((z, col) => ({ p: [x, y, z] as [number, number, number], i: 4 + row * 4 + col })),
  );
  const scene = {
    p: [GS_SLOTS.sceneX, y, GS_SLOTS.sceneZ] as [number, number, number],
    i: 12,
  };
  const colors = ["#e8c46a", "#7fc9d8", "#d98cb0", "#9fd88c", "#c8b0e8", "#f0a868", "#8fd8c8", "#e88f8f"];
  const Card = ({ p, i, r }: { p: [number, number, number]; i: number; r: number }) => (
    <mesh position={p} rotation={[-Math.PI / 2, 0, r]}>
      <planeGeometry args={[GS_CARD.w, GS_CARD.h]} />
      <meshStandardMaterial color={colors[i % colors.length]} roughness={0.7} side={THREE.DoubleSide} />
    </mesh>
  );
  return (
    <>
      {player.map((c) => (
        <Card key={`p${c.i}`} p={c.p} i={c.i} r={rotZ} />
      ))}
      {npc.map((c) => (
        <Card key={`n${c.i}`} p={c.p} i={c.i} r={rotZ} />
      ))}
      <Card p={scene.p} i={scene.i} r={-rotZ} />
    </>
  );
}

/** 调试用：在火的位置放一颗洋红小球（?fire=1），对"炉膛到底在哪"很有用 */
function FireMarker({ pos }: { pos: [number, number, number] }) {
  // ?probe=[#rrggbb:]x,y,z;... —— 任意点位探针（炉膛/木柴的位置这样量）。
  //   写 `probesolid=1` 时开深度测试：只有落在**空腔里**的球才看得见（被肉/石挡住的会消失），
  //   这就是"炉膛开口在哪、有多深"的量法；不写则一律画在最上面（只看得见投影位置）。
  const raw = q.get("probe");
  if (raw) {
    const palette = ["#ff00ff", "#ff0000", "#ffff00", "#00ff00", "#00ffff", "#ffffff"];
    const pts = raw
      .split(";")
      .map((s) => {
        const m = /^(?:#([0-9a-f]{6}):)?(.*)$/i.exec(s.trim());
        const a = m![2].split(",").map(Number);
        if (a.length !== 3 || !a.every(Number.isFinite)) return null;
        return { p: a as [number, number, number], c: m![1] ? `#${m![1]}` : null };
      })
      .filter((x): x is { p: [number, number, number]; c: string | null } => !!x);
    const solid = q.get("probenodepth") !== "1";
    return (
      <>
        {pts.map((pt, i) => (
          <mesh key={i} position={pt.p} renderOrder={999}>
            <sphereGeometry args={[Number(q.get("prober") ?? 0.03), 12, 12]} />
            <meshBasicMaterial color={pt.c ?? palette[i % palette.length]} depthTest={!solid} />
          </mesh>
        ))}
      </>
    );
  }
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
