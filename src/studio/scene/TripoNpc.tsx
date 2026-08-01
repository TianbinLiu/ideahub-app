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

export default function TripoNpc({
  url = "/models/preview/tripo-v3-rigged-opt.glb",
  bust = false,
  full = false,
}: {
  url?: string;
  bust?: boolean;
  full?: boolean;
}) {
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder);
  });
  const bones = useRef<Record<string, THREE.Object3D | null>>({});
  const morphMesh = useRef<THREE.Mesh | null>(null);
  // 随机眨眼时刻表：{ 下次眨眼的动画时钟时刻, 是否双眨 }
  const blinkPlan = useRef({ next: 2.5, double: false, phase: -1 });
  // 演出动画（wave 招手 / deal 发牌）：Blender IK 烘焙，只保留左臂链轨道避免覆盖程序姿势
  const mixer = useMemo(() => new THREE.AnimationMixer(gltf.scene), [gltf]);
  const perfActions = useMemo(() => {
    const out: Record<string, THREE.AnimationAction> = {};
    for (const name of ["wave", "deal"]) {
      const clip = THREE.AnimationClip.findByName(gltf.animations, name);
      if (!clip) continue;
      clip.tracks = clip.tracks.filter(
        (tr) => /Left(Arm|ForeArm|Hand)\.quaternion$/.test(tr.name),
      );
      const act = mixer.clipAction(clip);
      act.setLoop(THREE.LoopOnce, 1);
      out[name] = act;
    }
    return out;
  }, [gltf, mixer]);
  const prevDialog = useRef(false);
  const cardMeshRef = useRef<THREE.Mesh | null>(null);
  const cardIdRef = useRef<string | null>(null);
  const recommend = useStudio((s) => s.recommendCard);

  const { scale, y } = useMemo(() => {
    gltf.scene.traverse((o) => {
      o.frustumCulled = false;
      const m = o as THREE.Mesh;
      if (m.isMesh && m.morphTargetDictionary && !m.userData.__isOutline) morphMesh.current = m;
    });
    for (const [k, name] of Object.entries(POSE_KEYS)) bones.current[k] = gltf.scene.getObjectByName(name) ?? null;
    toonify(gltf.scene, full ? 0.0016 : bust ? 0.003 : 0.0012);
    // 立正靠 Root 骨自带的 (-90°,0,90°) 修正（勿动）；scene 只转 yaw -90° 面向镜头。
    gltf.scene.rotation.set(0, -Math.PI / 2, 0);
    // full：全身落地裙站姿（身高 1 归一化 → 4.35 世界），脚踩地站在桌后
    // bust：帽顶→胸底≈1 归一化，目标世界高 2.3，截断底沉桌沿下；
    // z 后移让身体前缘退到 rail 之后（-3.9 时胸/帽穿桌穿护栏）
    return full ? { scale: 4.35, y: -2.55 } : bust ? { scale: 2.3, y: -0.42 } : { scale: 4.6, y: -2.55 };
  }, [gltf, bust, full]);

  // 实测定稿（俯身对坐·抬头看镜头·右手扶桌/扶帽·左手抬起持卡）：轴向经 Root(-90°,0,90°) 链，勿按直觉改
  const pose = useMemo(() => {
    // full：站姿保持 rest（扶帽+垂手烘在模型里），仅头颈微动
    // bust：右臂保持 rest（扶帽姿势烘在模型里，动了会拉扯帽子顶点）；前倾量小
    const p = full
      ? {
          spine1: [0.05, 0, 0] as [number, number, number] | null,
          spine2: null as [number, number, number] | null,
          neck: [-0.16, 0, 0] as [number, number, number] | null,
          head: [-0.2, 0, 0] as [number, number, number] | null,
          lArm: null as [number, number, number] | null,
          lFore: null as [number, number, number] | null,
          lHand: null as [number, number, number] | null,
          rArm: null as [number, number, number] | null,
          rFore: null as [number, number, number] | null,
          freeze: false,
        }
      : bust
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
  }, [gltf, bust, full]);

  useFrame(({ clock }, dt) => {
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
    const st = useStudio.getState();
    // 表情 morph：随机间隔眨眼（偶发双眨）+ npcSay 驱动口型 + 情绪事件驱动笑意 + 胸部压桌
    const mm = morphMesh.current;
    if (mm && mm.morphTargetDictionary && mm.morphTargetInfluences) {
      const speaking = st.speakingUntil > Date.now();
      const bp = blinkPlan.current;
      let blink = 0;
      if (t >= bp.next) {
        const ph = t - bp.next; // 眨眼动画相位（0.28s 一次闭合）
        if (ph < 0.28) {
          blink = Math.sin((ph / 0.28) * Math.PI);
        } else if (bp.double) {
          bp.double = false;
          bp.next = t + 0.25; // 双眨：紧跟第二次
        } else {
          // 排下一次：2.2~5.8s 伪随机（按次数哈希，确定性可复现）
          bp.phase++;
          const h = Math.abs(Math.sin(bp.phase * 12.9898) * 43758.5453) % 1;
          bp.next = t + 2.2 + h * 3.6;
          bp.double = h > 0.78;
        }
      }
      if (import.meta.env.DEV) {
        const fb = (window as unknown as Record<string, unknown>).__forceBlink;
        if (typeof fb === "number") blink = fb;
      }
      const dict = mm.morphTargetDictionary;
      const inf = mm.morphTargetInfluences;
      if (dict.blink !== undefined) inf[dict.blink] = blink;
      if (dict.mouthOpen !== undefined)
        inf[dict.mouthOpen] = speaking ? Math.max(0, Math.sin(t * 9.5)) * 0.55 : 0;
      if (dict.smile !== undefined) {
        // 情绪脉冲优先（入组/出炉笑意拉满；素材不合格/作废收敛），否则说话加深/常态浅笑
        const moodActive = st.moodUntil > Date.now();
        const target = moodActive
          ? st.mood > 0
            ? 0.25 + st.mood * 0.7
            : Math.max(0, 0.22 + st.mood * 0.35)
          : speaking
            ? 0.5 + Math.sin(t * 1.3) * 0.12
            : 0.22;
        inf[dict.smile] += (target - inf[dict.smile]) * Math.min(1, dt * 6);
      }
      // 胸部撑桌：squish 仅 bust 压桌姿势启用；其它模式显式归零（glTF 可能携带非零默认权重）
      if (dict.squish !== undefined)
        inf[dict.squish] = bust ? 0.72 + Math.sin(t * 1.1) * 0.18 : 0;
    }
    // 演出触发：进入对话视角→招手；推荐卡刷新→发牌（挥卡）
    if (bust || full) {
      if (st.dialogView && !prevDialog.current && perfActions.wave) {
        perfActions.deal?.stop();
        perfActions.wave.reset().play();
      }
      prevDialog.current = st.dialogView;
    }
    // 演出动画先应用（LoopOnce 播放期间覆盖左臂程序姿势，播完自动交还），
    // 再读手骨位置更新持卡——发牌挥动时卡精确跟手
    mixer.update(dt);
    gltf.scene.updateMatrixWorld(true);
    // 持卡：世界空间正立卡跟随左手（不继承手骨旋转，永远面向镜头；可点击查看详情）
    // 仅对话视角且市场未摊开时展示——默认俯视角不该有卡悬在空中
    const card = cardMeshRef.current;
    const hand = b.lHand;
    if (card && hand) {
      if (recommend && cardIdRef.current !== recommend.id) {
        cardIdRef.current = recommend.id;
        (card.material as THREE.MeshBasicMaterial).map = cardFaceTexture(recommend);
        (card.material as THREE.MeshBasicMaterial).needsUpdate = true;
        // 发牌演出：新卡递出时左手挥卡
        if ((bust || full) && st.dialogView && perfActions.deal && !perfActions.wave?.isRunning()) {
          perfActions.deal.reset().play();
        }
      }
      card.visible = !!recommend && st.dialogView && !st.market.open;
      hand.getWorldPosition(cardPos);
      if (full) card.position.set(cardPos.x + 0.1, cardPos.y + 0.15, cardPos.z + 0.2);
      else if (bust) card.position.set(cardPos.x + 0.05, cardPos.y + 0.1, cardPos.z + 0.15);
      else card.position.set(cardPos.x - 0.3, cardPos.y + 0.18, cardPos.z + 0.12);
    }
  });

  return (
    <group>
      {/* full 站在桌后（落地裙）；bust z：胸前缘恰好压上桌沿 rail，配合 squish 呈"撑在桌面"贴合 */}
      <primitive object={gltf.scene} position={[0, y, full ? -4.35 : bust ? -4.28 : -3.9]} scale={scale} />
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
