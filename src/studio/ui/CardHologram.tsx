// 市场热门卡 3D 实体化：详情单左侧的全息展台（自转 + 浮动 + 光环底座）。
// 无映射的卡由调用方回退封面图。
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { idbGet } from "../../data/db";
import { toonify } from "../scene/TripoNpc";
import { loaderFor } from "../secureAssets";

/** 一次全息预览要用的模型：`url` 为 null 就是**没有可显示的建模**，调用方不要画那个框 */
export interface HologramModel {
  url: string | null;
  /** 还在从本机 blob 仓里取。true 时先别下"没有建模"的结论 */
  loading: boolean;
}

/**
 * 卡上的 modelUrl → 真正能喂给 three 的地址。
 *
 * `idb:` 指针 → objectURL：Seed3D 派生建模（36MB 级 GLB）存 IndexedDB blob 仓，
 * 卡片 JSON 里只有指针。其余 URL 原样通过。
 *
 * ★★ **取不到 blob 时必须让调用方知道**，不能只 console.warn。2026-08 起 modelUrl
 *   会跟着卡片存到服务端（自己那份记录的一部分），于是「在 A 手机上炼的卡，在 B 手机
 *   上打开」这条路真实存在：指针在、blob 不在。老代码在这种情况下照样把那个
 *   「✦ 全息实体 3D 建模」的框画出来，里面**永远是空的** —— 答应了又不给，
 *   比一开始就不显示更糟（在 modelUrl 还被服务端 strip 掉的年代，这个框压根不会出现）。
 *   现在返回 url=null，由调用方退回封面图 / 不画这一栏。
 */
export function useHologramModel(raw: string | undefined | null): HologramModel {
  const url = raw || "";
  const isPointer = url.startsWith("idb:");
  const [real, setReal] = useState<string | null>(isPointer ? null : url || null);
  const [loading, setLoading] = useState(isPointer);
  useEffect(() => {
    if (!url) {
      setReal(null);
      setLoading(false);
      return;
    }
    if (!url.startsWith("idb:")) {
      setReal(url);
      setLoading(false);
      return;
    }
    let alive = true;
    let obj: string | null = null;
    setReal(null);
    setLoading(true);
    void idbGet<Blob>(url.slice(4)).then((blob) => {
      if (!alive) return;
      setLoading(false);
      if (!blob) {
        // 别人的设备炼的（或本机缓存被清了）：这台机器上永远取不到，当作"没有建模"
        console.warn("[hologram] 建模 blob 不在本机库:", url);
        return;
      }
      obj = URL.createObjectURL(blob);
      setReal(obj);
    });
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [url]);
  return { url: real, loading };
}

/**
 * 卡名 → 3D 模型。没有映射的卡不显示全息实体，调用方各自有 `modelUrl ? … : …` 的兜底。
 *
 * ★★ 「赛博侦探·凛」这一条 2026-08-11 删了：它挂的是**有版权的第三方模型**，
 *   不能随包分发（也不该躺在一个公开仓库里）。卡本身留着 —— 卡面、简介都是原创，
 *   只是没有 3D 预览了。
 *   ⚠️ 别因为"加密了就没事"再把它加回来：.glbx 只是让文件不能被直接打开，
 *   解密密钥就在同一个包里，分发的仍然是那个模型。
 *   当初这条被写成"加密管线的端到端示例"，示例价值不值得拿版权去换；
 *   要留示例，用一个自有模型走同一条 .glbx 路径即可。
 */
export const CARD_MODELS: Record<string, string> = {
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

/** 全息展台。`url` 必须是**已经解析过**的地址（走 useHologramModel 拿） */
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
