// Tripo v3 图生 3D 铸卡师（AI 生成高模试验版，?npc=tripo 启用）：
// mixamo 骨架（无表情/物理），每帧摆慵懒对坐姿势——前倾、双臂垂下、左前臂抬起持卡。
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const POSE_KEYS = {
  spine1: "mixamorigSpine1",
  spine2: "mixamorigSpine2",
  neck: "mixamorigNeck",
  head: "mixamorigHead",
  lArm: "mixamorigLeftArm",
  lFore: "mixamorigLeftForeArm",
  rArm: "mixamorigRightArm",
  rFore: "mixamorigRightForeArm",
} as const;

export default function TripoNpc() {
  const gltf = useLoader(GLTFLoader, "/models/preview/tripo-v3-rigged.glb");
  const bones = useRef<Record<string, THREE.Object3D | null>>({});

  const { scale, y } = useMemo(() => {
    gltf.scene.traverse((o) => {
      o.frustumCulled = false;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const m = mesh.material as THREE.MeshStandardMaterial;
        // 昏暗场景补偿：肤色贴图偏灰，抬一点环境响应
        m.envMapIntensity = 1.4;
      }
    });
    for (const [k, name] of Object.entries(POSE_KEYS)) bones.current[k] = gltf.scene.getObjectByName(name) ?? null;
    // 立正靠 Root 骨自带的 (-90°,0,90°) 修正（勿动）；scene 只转 yaw -90° 面向镜头。
    // 实测：身高≈0.85 归一化 → scale 4.6；bbox 受 bind pose 干扰，直接用实测值。
    gltf.scene.rotation.set(0, -Math.PI / 2, 0);
    return { scale: 4.6, y: -2.55 };
  }, [gltf]);

  // 姿势表：DEV 下挂 window.__tripoPose 实时调参（javascript_tool 改值立即生效），调定后写死
  const pose = useMemo(() => {
    // 实测定稿（俯身对坐·抬头看镜头·右手扶桌·左臂垂放）：轴向经 Root(-90°,0,90°) 链，勿按直觉改
    const p = {
      lean: 0.28,
      spine1: [0.28, 0, 0],
      spine2: [0, 0, 0],
      neck: [-0.35, 0, 0],
      head: [-0.4, 0, 0],
      lArm: [-1.05, 0, 0],
      lFore: [0, 0, 0],
      rArm: [0.1, 0, -1.15],
      rFore: [0, 0, 0],
      freeze: false,
    };
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      w.__tripoPose = p;
      w.__tripo = { scene: gltf.scene, bones: bones.current };
    }
    return p;
  }, [gltf]);

  useFrame(({ clock }) => {
    // DEV 调参：优先读 window 挂载的表（StrictMode/HMR 下闭包引用可能不同源）
    const w = (import.meta.env.DEV && (window as unknown as Record<string, unknown>).__tripoPose) as typeof pose | false;
    const p2 = w || pose;
    if (p2.freeze) return;
    const t = clock.elapsedTime;
    const b = bones.current;
    const breathe = Math.sin(t * 1.1) * 0.015;
    for (const k of Object.keys(POSE_KEYS) as (keyof typeof POSE_KEYS)[]) {
      const n = b[k];
      const v = p2[k] as [number, number, number];
      if (n && v) n.rotation.set(v[0] + (k === "spine1" ? breathe : 0), v[1], v[2]);
    }
  });

  return <primitive object={gltf.scene} position={[0, y, -3.9]} scale={scale} />;
}
