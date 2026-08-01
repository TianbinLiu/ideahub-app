// 市场热门卡 3D 实体化：详情单左侧的全息展台（自转 + 浮动 + 光环底座）。
// 无映射的卡由调用方回退封面图。
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { toonify } from "../scene/TripoNpc";
import { hasAssetKey, loaderFor } from "../secureAssets";

/** 卡名 → 3D 模型。凛卡是加密管线的端到端示例：构建带密钥时走 .glbx 解密加载 */
export const CARD_MODELS: Record<string, string> = {
  "赛博侦探·凛": hasAssetKey() ? "/models/protected/rin-opt.glbx" : "/models/cards/rin-opt.glb",
  "剑修·白无衣": "/models/cards/baiwuyi-opt.glb",
  "废土信使小满": "/models/cards/xiaoman-opt.glb",
  "AI 管家 T-7": "/models/cards/t7-opt.glb",
  "会说谎的罗盘": "/models/cards/compass-opt.glb",
};

function Model({ url }: { url: string }) {
  const gltf = useLoader(loaderFor(url), url, (l) => {
    (l as GLTFLoader).setMeshoptDecoder(MeshoptDecoder);
  });
  const group = useRef<THREE.Group>(null);
  const { scale, y } = useMemo(() => {
    gltf.scene.traverse((o) => {
      o.frustumCulled = false;
    });
    toonify(gltf.scene, 0.006);
    // 量化反缩放在 mesh.scale 上：量 bbox 前必须刷新矩阵
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const h = box.getSize(new THREE.Vector3()).y || 1;
    const s = 1.7 / h;
    return { scale: s, y: -box.min.y * s - 0.85 };
  }, [gltf]);
  useFrame(({ clock }) => {
    const g = group.current;
    if (g) {
      g.rotation.y = clock.elapsedTime * 0.6;
      g.position.y = y + Math.sin(clock.elapsedTime * 1.4) * 0.03;
    }
  });
  return (
    <group ref={group} position={[0, y, 0]}>
      <primitive object={gltf.scene} scale={scale} />
    </group>
  );
}

export default function CardHologram({ url }: { url: string }) {
  return (
    <Canvas dpr={[1, 2]} camera={{ fov: 30, position: [0, 0.3, 3.6] }} gl={{ alpha: true }}>
      <hemisphereLight args={["#e8f8ff", "#1a2436", 1.5]} />
      <directionalLight position={[2, 3, 2]} intensity={1.7} color="#fff2dd" />
      <directionalLight position={[-2, 1, -2]} intensity={0.6} color="#67e8f9" />
      <Suspense fallback={null}>
        <Model url={url} />
      </Suspense>
      {/* 全息底座光环 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.87, 0]}>
        <ringGeometry args={[0.55, 0.78, 48]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.32} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.87, 0]}>
        <circleGeometry args={[0.55, 48]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.08} />
      </mesh>
    </Canvas>
  );
}
