// 魔法书房（写实向）：Poly Haven（CC0）扫描资产 + PBR 石墙/木地板 + 夜景 HDRI 环境光。
// 哥特书柜/五斗柜环绕，桌上黄铜烛台/提灯/高脚杯，烛光摇曳，昏暗神秘。
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { applyCameraFade } from "./cameraFade";

const FLOOR_Y = -2.4;
const M = (s: string) => `/models/study/${s}/${s}.gltf`;
const T = (f: string) => `/models/study/tex/${f}.jpg`;

interface PropSpec {
  n: string;
  p: [number, number, number];
  ry?: number;
  s?: number;
}

// 房间布置（世界坐标：桌面 y=0，NPC 侧 z<0；地面 y=-2.4）
const ROOM: PropSpec[] = [
  // 背景家具（NPC 身后一排）
  { n: "GothicCabinet_01", p: [-3.4, FLOOR_Y, -6.6], ry: 0.06, s: 2.4 },
  { n: "GothicCabinet_01", p: [3.5, FLOOR_Y, -6.7], ry: -0.06, s: 2.4 },
  { n: "GothicCommode_01", p: [0.35, FLOOR_Y, -6.9], s: 2.4 },
  { n: "Barrel_01", p: [-6.6, FLOOR_Y, -5.6], s: 2.0 },
  { n: "Barrel_01", p: [6.8, FLOOR_Y, -5.2], ry: 0.9, s: 2.0 },
  // 柜面/地面陈设
  { n: "book_encyclopedia_set_01", p: [-5.4, FLOOR_Y, -6.2], ry: 0.3, s: 2.0 },
  // 桌面陈设（避开卡区：链 z0.95 / 市场 z-1..-2.35 / NPC 手肘 x±1 z-3）
  { n: "brass_candleholders", p: [1.6, 0, -3.32], s: 1.25 },
  { n: "brass_candleholders", p: [-1.65, 0, -3.36], ry: 1.2, s: 1.25 },
  { n: "Lantern_01", p: [-1.18, 0, -3.38], s: 1.5 },
  { n: "brass_goblets", p: [0.98, 0, -3.46], ry: 0.5, s: 1.1 },
];

function Prop({ spec }: { spec: PropSpec }) {
  const gltf = useLoader(GLTFLoader, M(spec.n));
  const obj = useMemo(() => {
    const o = gltf.scene.clone(true);
    applyCameraFade(o); // 自由视角镜头穿过柜子/烛台时近处网点淡出，不再糊满屏
    return o;
  }, [gltf]);
  return <primitive object={obj} position={spec.p} rotation={[0, spec.ry ?? 0, 0]} scale={spec.s ?? 1} />;
}

/** DEV：打印各模型原始包围盒，便于摆位调参 */
function MeasureLog() {
  const names = useMemo(() => [...new Set(ROOM.map((r) => r.n))], []);
  const gltfs = useLoader(GLTFLoader, names.map(M));
  useEffect(() => {
    gltfs.forEach((g, i) => {
      const size = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3());
      console.log(`[study] ${names[i]}: ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`);
    });
  }, [gltfs, names]);
  return null;
}

/** 夜景 HDRI 环境光（弱强度，只作氛围与 PBR 反射） */
function StudyEnv() {
  const tex = useLoader(RGBELoader, "/models/study/night.hdr");
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = tex;
    scene.environmentIntensity = 0.35;
    return () => {
      scene.environment = null;
    };
  }, [tex, scene]);
  return null;
}

/** PBR 贴图面板（石墙/地板） */
function TexturedPanel({
  tex,
  position,
  rotation = [0, 0, 0],
  width,
  height,
  repeat,
  color = "#8a8f9e",
}: {
  tex: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  width: number;
  height: number;
  repeat: [number, number];
  color?: string;
}) {
  const [diff, nor, rough] = useLoader(THREE.TextureLoader, [T(`${tex}_diff`), T(`${tex}_nor`), T(`${tex}_rough`)]);
  const maps = useMemo(() => {
    const mk = (t: THREE.Texture, srgb: boolean) => {
      const c = t.clone();
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(repeat[0], repeat[1]);
      if (srgb) c.colorSpace = THREE.SRGBColorSpace;
      c.needsUpdate = true;
      return c;
    };
    return { d: mk(diff, true), n: mk(nor, false), r: mk(rough, false) };
  }, [diff, nor, rough, repeat]);
  useEffect(() => () => Object.values(maps).forEach((m) => m.dispose()), [maps]);
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial map={maps.d} normalMap={maps.n} roughnessMap={maps.r} color={color} />
    </mesh>
  );
}

/** 摇曳的暖光 + 烛焰光点 */
function Flicker({
  position,
  color = "#ffb066",
  intensity = 6,
  distance = 9,
  flame = true,
}: {
  position: [number, number, number];
  color?: string;
  intensity?: number;
  distance?: number;
  flame?: boolean;
}) {
  const ref = useRef<THREE.PointLight>(null);
  const flameRef = useRef<THREE.Mesh>(null);
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const f = 0.86 + 0.1 * Math.sin(t * 9 + seed) + 0.06 * Math.sin(t * 23 + seed * 2);
    if (ref.current) ref.current.intensity = intensity * f;
    if (flameRef.current) flameRef.current.scale.setScalar(0.85 + 0.25 * f);
  });
  return (
    <group position={position}>
      <pointLight ref={ref} color={color} intensity={intensity} distance={distance} decay={1.7} />
      {flame && (
        <mesh ref={flameRef}>
          <sphereGeometry args={[0.045, 8, 8]} />
          <meshBasicMaterial color="#ffd9a0" />
        </mesh>
      )}
    </group>
  );
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
      {/* 木地板 */}
      <TexturedPanel
        tex="dark_wooden_planks"
        position={[0, FLOOR_Y - 0.01, -2]}
        rotation={[-Math.PI / 2, 0, 0]}
        width={44}
        height={30}
        repeat={[10, 7]}
        color="#6d6f78"
      />
      {/* 背墙 + 两侧短墙（城堡石砖） */}
      <TexturedPanel tex="castle_brick_07" position={[0, FLOOR_Y + 4.4, -7.5]} width={30} height={9.5} repeat={[6.5, 2.1]} color="#7c828f" />
      <TexturedPanel
        tex="castle_brick_07"
        position={[-11.5, FLOOR_Y + 4.4, -1]}
        rotation={[0, Math.PI / 2, 0]}
        width={15}
        height={9.5}
        repeat={[3.2, 2.1]}
        color="#7c828f"
      />
      <TexturedPanel
        tex="castle_brick_07"
        position={[11.5, FLOOR_Y + 4.4, -1]}
        rotation={[0, -Math.PI / 2, 0]}
        width={15}
        height={9.5}
        repeat={[3.2, 2.1]}
        color="#7c828f"
      />

      {/* 烛光（桌上烛台/提灯）与背景暖光 */}
      <Flicker position={[1.6, 0.62, -3.32]} intensity={6} distance={8} />
      <Flicker position={[-1.65, 0.62, -3.36]} intensity={5} distance={7.5} />
      <Flicker position={[-1.16, 0.55, -3.36]} intensity={4} distance={6} flame={false} />
      <Flicker position={[0.35, FLOOR_Y + 3.6, -6.6]} color="#ff9a3c" intensity={10} distance={13} flame={false} />
      {/* 冷月光 + 魔法紫辉（弱，点缀） */}
      <pointLight position={[0, 2.2, -6.2]} color="#7f9dff" intensity={7} distance={14} decay={1.6} />
      <pointLight position={[0, 0.6, -5.2]} color="#8b5cf6" intensity={4} distance={8} decay={1.8} />

      <Suspense fallback={null}>
        <StudyEnv />
        <Props />
        {import.meta.env.DEV && <MeasureLog />}
      </Suspense>
    </group>
  );
}
