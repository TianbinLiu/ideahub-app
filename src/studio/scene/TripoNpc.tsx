// Tripo 图生 3D 铸卡师（AI 生成高模，?npc=tripo 启用）：
// mixamo 骨架每帧摆慵懒对坐姿势；引擎侧赛璐璐化（Toon ramp + 反壳描边）；
// 左手抬起持 AI 推荐卡（卡面挂 LeftHand 骨）。
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { useStudio } from "../studioStore";
import { cardFaceTexture } from "./cardTexture";

const cardPos = new THREE.Vector3();

const POSE_KEYS = {
  spine1: "mixamorigSpine1",
  spine2: "mixamorigSpine2",
  neck: "mixamorigNeck",
  head: "mixamorigHead",
  lArm: "mixamorigLeftArm",
  lFore: "mixamorigLeftForeArm",
  lHand: "mixamorigLeftHand",
  rArm: "mixamorigRightArm",
  rFore: "mixamorigRightForeArm",
} as const;

// 赛璐璐化：PBR 材质 → 三阶 Toon ramp（保留原贴图），并给每个 mesh 造反壳描边
// width 是 mesh 局部空间的法线外扩量——不同模型的量化缩放/场景缩放不同，需按最终屏幕效果各自调
export function toonify(scene: THREE.Object3D, width = 0.0045) {
  const ramp = new THREE.DataTexture(
    new Uint8Array([120, 120, 120, 255, 215, 215, 215, 255, 255, 255, 255, 255]),
    3,
    1,
  );
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x241a12, side: THREE.BackSide });
  outlineMat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace(
      "#include <skinning_vertex>",
      `#include <skinning_vertex>\n\ttransformed += objectNormal * ${width.toFixed(5)};`,
    );
  };
  const targets: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (mesh.isMesh && !mesh.userData.__isOutline && !mesh.userData.__toonified) targets.push(mesh);
  });
  for (const mesh of targets) {
    mesh.userData.__toonified = true;
    const old = mesh.material as THREE.MeshStandardMaterial;
    mesh.material = new THREE.MeshToonMaterial({ map: old.map, gradientMap: ramp });
    old.dispose();
    let shell: THREE.Mesh;
    if (mesh.isSkinnedMesh) {
      const s = new THREE.SkinnedMesh(mesh.geometry, outlineMat);
      s.bind(mesh.skeleton, mesh.bindMatrix);
      s.bindMode = mesh.bindMode;
      shell = s;
    } else {
      shell = new THREE.Mesh(mesh.geometry, outlineMat);
    }
    shell.userData.__isOutline = true;
    shell.frustumCulled = false;
    // 挂本体之下继承全部变换（量化反缩放在 mesh 自身 scale 上）
    mesh.add(shell);
  }
}

export default function TripoNpc({ url = "/models/preview/tripo-v3-rigged-opt.glb", bust = false }: { url?: string; bust?: boolean }) {
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder);
  });
  const bones = useRef<Record<string, THREE.Object3D | null>>({});
  const cardMeshRef = useRef<THREE.Mesh | null>(null);
  const cardIdRef = useRef<string | null>(null);
  const recommend = useStudio((s) => s.recommendCard);

  const { scale, y } = useMemo(() => {
    gltf.scene.traverse((o) => {
      o.frustumCulled = false;
    });
    for (const [k, name] of Object.entries(POSE_KEYS)) bones.current[k] = gltf.scene.getObjectByName(name) ?? null;
    toonify(gltf.scene, bust ? 0.003 : 0.0012);
    // 立正靠 Root 骨自带的 (-90°,0,90°) 修正（勿动）；scene 只转 yaw -90° 面向镜头。
    gltf.scene.rotation.set(0, -Math.PI / 2, 0);
    // 胸像：帽顶→胸底≈1 归一化，目标世界高 2.3，截断底沉桌沿下
    return bust ? { scale: 2.3, y: -0.45 } : { scale: 4.6, y: -2.55 };
  }, [gltf]);

  // 实测定稿（俯身对坐·抬头看镜头·右手扶桌/扶帽·左手抬起持卡）：轴向经 Root(-90°,0,90°) 链，勿按直觉改
  const pose = useMemo(() => {
    // bust：右臂保持 rest（扶帽姿势烘在模型里，动了会拉扯帽子顶点）；前倾量小
    const p = bust
      ? {
          spine1: [0.06, 0, 0] as [number, number, number] | null,
          spine2: [0, 0, 0] as [number, number, number] | null,
          neck: [-0.05, 0, 0] as [number, number, number] | null,
          head: [-0.04, 0, 0] as [number, number, number] | null,
          lArm: [1.3, 0.15, 0] as [number, number, number] | null,
          lFore: [0, 0.1, -2.0] as [number, number, number] | null,
          lHand: [0, 0, 0] as [number, number, number] | null,
          rArm: null as [number, number, number] | null,
          rFore: null as [number, number, number] | null,
          freeze: false,
        }
      : {
          spine1: [0.28, 0, 0] as [number, number, number] | null,
          spine2: [0, 0, 0] as [number, number, number] | null,
          neck: [-0.35, 0, 0] as [number, number, number] | null,
          head: [-0.4, 0, 0] as [number, number, number] | null,
          lArm: [0.55, 0.35, 0] as [number, number, number] | null,
          lFore: [0, 0.25, -1.35] as [number, number, number] | null,
          lHand: [0, 0, 0] as [number, number, number] | null,
          rArm: [0.1, 0, -1.15] as [number, number, number] | null,
          rFore: [0, 0, 0] as [number, number, number] | null,
          freeze: false,
        };
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      w.__tripoPose = p;
      w.__tripo = { scene: gltf.scene, bones: bones.current };
    }
    return p;
  }, [gltf, bust]);

  useFrame(({ clock }) => {
    // DEV 调参：优先读 window 挂载的表（StrictMode/HMR 下闭包引用可能不同源）
    const w = (import.meta.env.DEV && (window as unknown as Record<string, unknown>).__tripoPose) as
      | typeof pose
      | false;
    const p2 = w || pose;
    if (p2.freeze) return;
    const t = clock.elapsedTime;
    const b = bones.current;
    const breathe = Math.sin(t * 1.1) * 0.015;
    for (const k of Object.keys(POSE_KEYS) as (keyof typeof POSE_KEYS)[]) {
      const n = b[k];
      const v = p2[k] as [number, number, number] | null;
      if (n && v) n.rotation.set(v[0] + (k === "spine1" ? breathe : 0), v[1], v[2]);
    }
    // 持卡：世界空间正立卡跟随左手（不继承手骨旋转，永远面向镜头；可点击查看详情）
    const card = cardMeshRef.current;
    const hand = b.lHand;
    if (card && hand) {
      if (recommend && cardIdRef.current !== recommend.id) {
        cardIdRef.current = recommend.id;
        (card.material as THREE.MeshBasicMaterial).map = cardFaceTexture(recommend);
        (card.material as THREE.MeshBasicMaterial).needsUpdate = true;
      }
      card.visible = !!recommend;
      hand.getWorldPosition(cardPos);
      if (bust) card.position.set(cardPos.x + 0.05, cardPos.y + 0.1, cardPos.z + 0.15);
      else card.position.set(cardPos.x - 0.3, cardPos.y + 0.18, cardPos.z + 0.12);
    }
  });

  return (
    <group>
      <primitive object={gltf.scene} position={[0, y, -3.9]} scale={scale} />
      <mesh
        ref={cardMeshRef}
        rotation={[-0.18, -0.12, 0.05]}
        visible={false}
        onClick={(e) => {
          e.stopPropagation();
          const rec = useStudio.getState().recommendCard;
          if (rec) useStudio.getState().viewCardDetail(rec);
        }}
      >
        <planeGeometry args={[0.62, 0.87]} />
        <meshBasicMaterial transparent side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
