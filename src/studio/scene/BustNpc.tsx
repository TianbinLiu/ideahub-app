// Tripo 半身胸像铸卡师（npc-bust.png 直出，?npc=bust 启用）：
// 无骨骼——截断处藏桌沿下，整体呼吸浮动 + 微倾模拟活人感；持卡走 DialogTableCards 固定位。
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { toonify } from "./TripoNpc";
import { useStudio } from "../studioStore";

export default function BustNpc() {
  // 优化版：96.7万→27万三角 + meshopt + webp 贴图（29.4MB→1.9MB）
  const gltf = useLoader(GLTFLoader, "/models/preview/tripo-bust-opt.glb", (loader) => {
    (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder);
  });
  const group = useRef<THREE.Group>(null);

  const { scale, y } = useMemo(() => {
    gltf.scene.traverse((o) => {
      o.frustumCulled = false;
    });
    toonify(gltf.scene);
    // meshopt/quantize 版的反量化缩放在 node scale 上——量 bbox 前必须刷新矩阵
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const h = box.getSize(new THREE.Vector3()).y || 1;
    // 胸像（帽顶→胸底）目标世界高 2.3；底部沉到桌面下藏截断
    const s = 2.3 / h;
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__bust = { scene: gltf.scene, box: box.getSize(new THREE.Vector3()) };
    return { scale: s, y: -0.3 - box.min.y * s };
  }, [gltf]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const { dialogView } = useStudio.getState();
    const g = group.current;
    if (!g) return;
    // 呼吸：轻微浮沉 + 前倾摆动；对话时更贴近桌沿
    g.position.y = y + Math.sin(t * 1.1) * 0.018;
    g.position.z = dialogView ? -3.72 : -3.9;
    g.rotation.x = 0.06 + Math.sin(t * 1.1 + 0.7) * 0.008;
  });

  return (
    <group ref={group} position={[0, y, -3.9]}>
      <primitive object={gltf.scene} rotation={[0, -Math.PI / 2, 0]} scale={scale} />
    </group>
  );
}
