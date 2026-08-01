// 玩家第一人称手臂：按所选形象（男/女）加载 Tripo 绑骨模型，
// 摆"双臂前伸伏在桌沿"姿势，身体沉在镜头外、只露前臂与手。
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { toonify } from "./TripoNpc";

const BONES = {
  spine1: "mixamorigSpine1",
  neck: "mixamorigNeck",
  head: "mixamorigHead",
  lArm: "mixamorigLeftArm",
  lFore: "mixamorigLeftForeArm",
  rArm: "mixamorigRightArm",
  rFore: "mixamorigRightForeArm",
} as const;

export default function PlayerArms({ avatar }: { avatar: "m" | "f" }) {
  const gltf = useLoader(GLTFLoader, `/models/preview/player-${avatar}-rigged-opt.glb`, (loader) => {
    (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder);
  });
  const bones = useRef<Record<string, THREE.Object3D | null>>({});

  useMemo(() => {
    gltf.scene.traverse((o) => {
      o.frustumCulled = false;
    });
    for (const [k, name] of Object.entries(BONES)) bones.current[k] = gltf.scene.getObjectByName(name) ?? null;
    toonify(gltf.scene, 0.0012);
    // 与 NPC 同构：Root 骨自带立正修正；玩家背对镜头面向 NPC（-Z 方向）→ yaw +90°
    gltf.scene.rotation.set(0, Math.PI / 2, 0);
    // FPS 惯例：隐藏自己的头（缩没 head 骨蒙皮），画面里只留肩臂
    gltf.scene.getObjectByName("mixamorigHead")?.scale.set(0.001, 0.001, 0.001);
  }, [gltf]);

  // DEV 可调姿势表（__playerPose）：双臂前伸伏桌，头微低（避免后脑勺入画）
  const pose = useMemo(() => {
    // 实测定稿（俯视 FPS：无头、肩臂入画、双手悬在桌沿上方作施法/操作势）
    const p = {
      spine1: [0.6, 0, 0] as [number, number, number] | null,
      neck: [0.35, 0, 0] as [number, number, number] | null,
      head: [0.35, 0, 0] as [number, number, number] | null,
      lArm: [1.55, -0.35, 0] as [number, number, number] | null,
      lFore: [0.3, -0.1, 0] as [number, number, number] | null,
      rArm: [0, -1.38, 0] as [number, number, number] | null,
      rFore: [0.25, 0, 1.6] as [number, number, number] | null,
      y: -2.9,
      z: 4.95,
      freeze: false,
    };
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      w.__playerPose = p;
      w.__player = { scene: gltf.scene, bones: bones.current };
    }
    return p;
  }, [gltf]);

  const group = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const w = (import.meta.env.DEV && (window as unknown as Record<string, unknown>).__playerPose) as
      | typeof pose
      | false;
    const p2 = w || pose;
    if (p2.freeze) return;
    const t = clock.elapsedTime;
    const breathe = Math.sin(t * 1.15 + 1.7) * 0.01;
    for (const k of Object.keys(BONES) as (keyof typeof BONES)[]) {
      const n = bones.current[k];
      const v = p2[k] as [number, number, number] | null;
      if (n && v) n.rotation.set(v[0] + (k === "spine1" ? breathe : 0), v[1], v[2]);
    }
    if (group.current) group.current.position.set(0, p2.y, p2.z);
  });

  return (
    <group ref={group} position={[0, pose.y, pose.z]}>
      <primitive object={gltf.scene} scale={4.3} />
      {/* 玩家侧补光：烛光都在桌北，肩臂需要一点暖光才可读 */}
      <pointLight position={[0, 4.2, -0.6]} intensity={6} distance={7} color="#ffdbb0" />
    </group>
  );
}
