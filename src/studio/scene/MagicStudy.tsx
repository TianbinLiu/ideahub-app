// 魔法书房环境：KayKit Dungeon Remastered（CC0）资产搭建的昏暗神秘书房。
// 书架/拱窗石墙/雕花柱/挂旗环绕，桌上烛台药水，烛光摇曳 + 冷月光 + 魔法紫辉。
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const FLOOR_Y = -2.4;
const M = (n: string) => `/models/dungeon/${n}.glb`;

interface PropSpec {
  n: string;
  p: [number, number, number];
  ry?: number;
  s?: number;
  /** 材质暗化系数（KayKit 石墙等原生偏亮，压暗贴合昏暗基调） */
  dim?: number;
}

// 房间布置（世界坐标：桌面 y=0，NPC 侧 z<0；地面 y=-2.4）
const ROOM: PropSpec[] = [
  // ── 背墙（NPC 身后）：石墙 + 中央拱窗 + 内嵌书架墙 ──
  { n: "wall", p: [-9.6, FLOOR_Y, -7.2], s: 1.6, dim: 0.45 },
  { n: "wall_shelves", p: [-4.2, FLOOR_Y, -7.2], s: 1.6, dim: 0.5 },
  { n: "wall_archedwindow_open", p: [0.6, FLOOR_Y, -7.2], s: 1.6, dim: 0.45 },
  { n: "wall_shelves", p: [4.6, FLOOR_Y, -7.2], s: 1.6, dim: 0.5 },
  { n: "wall", p: [9.8, FLOOR_Y, -7.2], s: 1.6, dim: 0.45 },
  // ── 大书架（拱窗两侧，压出层次） ──
  { n: "shelves", p: [-3.3, FLOOR_Y, -6.3], s: 2.1, dim: 0.6 },
  { n: "shelf_large", p: [3.5, FLOOR_Y, -6.4], s: 2.1, dim: 0.6 },
  { n: "shelf_small_candles", p: [-5.9, FLOOR_Y, -6.5], s: 2.0, ry: 0.15, dim: 0.6 },
  // ── 雕花石柱 ──
  { n: "pillar_decorated", p: [-6.9, FLOOR_Y, -6.9], s: 1.9, dim: 0.5 },
  { n: "pillar_decorated", p: [6.9, FLOOR_Y, -6.9], s: 1.9, dim: 0.5 },
  // ── 挂旗 ──
  { n: "banner_patternA_blue", p: [-1.9, FLOOR_Y + 0.1, -7.0], s: 1.7 },
  { n: "banner_thin_blue", p: [2.9, FLOOR_Y + 0.1, -7.0], s: 1.7 },
  // ── 壁挂火把（暖光源随后配） ──
  { n: "torch_mounted", p: [-4.6, FLOOR_Y + 2.6, -7.0], s: 1.5 },
  { n: "torch_mounted", p: [5.1, FLOOR_Y + 2.6, -7.0], s: 1.5 },
  // ── 地面木板（背墙前的可见地带） ──
  { n: "floor_wood_large_dark", p: [-4, FLOOR_Y, -5.5], s: 1.6 },
  { n: "floor_wood_large_dark", p: [0, FLOOR_Y, -5.5], s: 1.6 },
  { n: "floor_wood_large_dark", p: [4, FLOOR_Y, -5.5], s: 1.6 },
  // ── 侧景杂物（宽屏可见） ──
  { n: "chest", p: [-8.6, FLOOR_Y, -3.2], ry: 0.5, s: 1.7, dim: 0.55 },
  { n: "barrel_small_stack", p: [8.4, FLOOR_Y, -2.6], s: 1.7, dim: 0.55 },
  { n: "trunk_large_A", p: [-8.8, FLOOR_Y, 0.8], ry: -0.4, s: 1.7, dim: 0.55 },
  { n: "box_stacked", p: [8.8, FLOOR_Y, 0.6], ry: 0.3, s: 1.7, dim: 0.5 },
  { n: "keg_decorated", p: [6.6, FLOOR_Y, -5.8], s: 1.8, dim: 0.55 },
  { n: "coin_stack_medium", p: [-6.2, FLOOR_Y, -4.6], s: 1.8, dim: 0.7 },
  // ── 桌面陈设（避开卡区：链 z0.95 / 市场 z-1..-2.35 / NPC 手肘 x±1 z-3） ──
  { n: "candle_triple", p: [1.55, 0, -3.34], s: 0.38, dim: 0.8 },
  { n: "candle_lit", p: [-1.6, 0, -3.36], s: 0.38, dim: 0.8 },
  { n: "bottle_A_labeled_green", p: [-1.36, 0, -3.44], s: 0.38, dim: 0.85 },
  { n: "bottle_C_brown", p: [-1.2, 0, -3.28], s: 0.38, dim: 0.85 },
];

function Prop({ spec }: { spec: PropSpec }) {
  const gltf = useLoader(GLTFLoader, M(spec.n));
  const obj = useMemo(() => {
    const o = gltf.scene.clone(true);
    if (spec.dim != null) {
      o.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && mesh.material) {
          const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
          mat.color.multiplyScalar(spec.dim!);
          mesh.material = mat;
        }
      });
    }
    return o;
  }, [gltf, spec]);
  return <primitive object={obj} position={spec.p} rotation={[0, spec.ry ?? 0, 0]} scale={spec.s ?? 1} />;
}

/** 摇曳的暖光（烛台/火把） */
function Flicker({
  position,
  color = "#ffb066",
  intensity = 7,
  distance = 10,
}: {
  position: [number, number, number];
  color?: string;
  intensity?: number;
  distance?: number;
}) {
  const ref = useRef<THREE.PointLight>(null);
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (ref.current)
      ref.current.intensity =
        intensity * (0.86 + 0.1 * Math.sin(t * 9 + seed) + 0.06 * Math.sin(t * 23 + seed * 2));
  });
  return <pointLight ref={ref} position={position} color={color} intensity={intensity} distance={distance} decay={1.7} />;
}

function Props() {
  return (
    <group>
      {ROOM.map((spec, i) => (
        <Prop key={i} spec={spec} />
      ))}
    </group>
  );
}

export default function MagicStudy() {
  return (
    <group>
      {/* 石质地面（大面积暗色，木板铺可见带） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y - 0.01, 0]}>
        <planeGeometry args={[60, 40]} />
        <meshStandardMaterial color="#0a0d18" roughness={0.95} />
      </mesh>

      {/* 烛光（桌上两组）与火把（背墙两支）——暖光主导 */}
      <Flicker position={[1.52, 0.45, -3.3]} intensity={5} distance={7} />
      <Flicker position={[-1.58, 0.4, -3.32]} intensity={4.5} distance={6.5} />
      <Flicker position={[-4.6, 1.1, -6.6]} color="#ff9a3c" intensity={12} distance={13} />
      <Flicker position={[5.1, 1.1, -6.6]} color="#ff9a3c" intensity={12} distance={13} />
      {/* 拱窗冷月光 + 魔法紫辉（弱，点缀） */}
      <pointLight position={[0.6, 1.6, -6.4]} color="#7f9dff" intensity={8} distance={14} decay={1.6} />
      <pointLight position={[0, 0.6, -5.2]} color="#8b5cf6" intensity={4} distance={8} decay={1.8} />

      <Suspense fallback={null}>
        <Props />
      </Suspense>
    </group>
  );
}
