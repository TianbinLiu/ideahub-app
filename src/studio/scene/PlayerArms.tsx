// 玩家第一人称手臂：按所选形象（男/女）加载 Tripo 绑骨模型，
// 摆"双臂前伸伏在桌沿"姿势，身体沉在镜头外、只露前臂与手。
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { toonify } from "./TripoNpc";
import { useStudio } from "../studioStore";
import { DECK_CAM } from "./layout";
import { PlayerAvatar, playerModelUrl } from "../quality";
import { loaderFor } from "../secureAssets";

const BONES = {
  spine1: "mixamorigSpine1",
  neck: "mixamorigNeck",
  head: "mixamorigHead",
  lArm: "mixamorigLeftArm",
  lFore: "mixamorigLeftForeArm",
  rArm: "mixamorigRightArm",
  rFore: "mixamorigRightForeArm",
} as const;

type PoseTable = Record<keyof typeof BONES, [number, number, number] | null>;

// FPS 姿势表按 rig 家族分：Tripo 自产模型 与 MMD 移植模型（骨骼局部轴系不同，实测定稿）
const TRIPO_POSE: PoseTable = {
  spine1: [0.6, 0, 0],
  neck: [0.35, 0, 0],
  head: [0.35, 0, 0],
  lArm: [1.55, -0.35, 0],
  lFore: [0.3, -0.1, 0],
  rArm: [0, -1.38, 0],
  rFore: [0.25, 0, 1.6],
};
// MMD 系轴向实测（rest-relative 增量）：臂 -z=前摆、±x=展/收、y=扭转；脊柱 +x=前倾
const MMD_POSE: PoseTable = {
  spine1: [0.35, 0, 0],
  neck: [0.2, 0, 0],
  head: [0.25, 0, 0],
  lArm: [-0.42, 0, -0.92],
  lFore: [0, 0.5, -0.18],
  rArm: [0.42, 0, -0.92],
  rFore: [0, -0.5, -0.18],
};

// 每形象装配参数：MMD 系 glTF 导出后面朝 +Z（Tripo 系是 Root 修正后朝 +X）。
// deckY=卡组视角整体下沉（站姿 MMD 模型比 Tripo think 前倾姿势高得多，脸会出画；
// Tripo 系有烘焙 think 动画不需要）
const RIGS: Record<
  PlayerAvatar,
  { yaw: number; scale: number; y: number; z: number; deckY?: number; pose: PoseTable }
> = {
  m: { yaw: Math.PI / 2, scale: 4.3, y: -2.9, z: 4.95, pose: TRIPO_POSE },
  f: { yaw: Math.PI / 2, scale: 4.3, y: -2.9, z: 4.95, pose: TRIPO_POSE },
  rin: { yaw: Math.PI, scale: 4.3, y: -2.9, z: 4.95, deckY: -5.3, pose: MMD_POSE },
  gratia: { yaw: Math.PI, scale: 4.1, y: -2.9, z: 4.95, deckY: -5.8, pose: MMD_POSE },
};

export default function PlayerArms({ avatar }: { avatar: PlayerAvatar }) {
  // think 版 = 绑骨模型 + Blender matrix 法烘的"低头看镜头手摸下巴"1 帧动画
  // （欧拉直设导出参考系会错乱使弯腰过深头贴桌面——matrix 法烘焙；模型按画质分级选档）
  // 开发试穿档（rin/gratia）是加密 glbx，loaderFor 自动切解密加载器；无 think 动画走 FPS 姿势兜底
  const rig = RIGS[avatar];
  const modelUrl = playerModelUrl(avatar);
  const gltf = useLoader(loaderFor(modelUrl), modelUrl, (loader) => {
    (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder);
  });
  const bones = useRef<Record<string, THREE.Object3D | null>>({});
  const mixer = useMemo(() => new THREE.AnimationMixer(gltf.scene), [gltf]);
  const thinkAction = useMemo(() => {
    const clip = THREE.AnimationClip.findByName(gltf.animations, "think");
    if (!clip) return null;
    // 只保留旋转轨道：Blender 烘的 location 轨道会把骨骼 rest 位置压塌
    clip.tracks = clip.tracks.filter((tr) => !tr.name.endsWith(".position") && !tr.name.endsWith(".scale"));
    return mixer.clipAction(clip);
  }, [gltf, mixer]);

  const restQ = useRef<Record<string, THREE.Quaternion>>({});
  useMemo(() => {
    gltf.scene.traverse((o) => {
      o.frustumCulled = false;
    });
    for (const [k, name] of Object.entries(BONES)) {
      const b = gltf.scene.getObjectByName(name) ?? null;
      bones.current[k] = b;
      // MMD 系骨骼 rest 局部旋转非零（Blender 骨自带朝向）——绝对欧拉写入会抹掉 rest 直接炸姿势。
      // 记录加载时（未播动画=rest）的四元数，姿势表统一改为"相对 rest 的增量"（Tripo 系 rest≈单位，语义不变）
      if (b) restQ.current[k] = b.quaternion.clone();
    }
    toonify(gltf.scene, 0.0012);
    // 朝向修正按 rig 家族：玩家背对镜头面向 NPC（-Z 方向）
    gltf.scene.rotation.set(0, rig.yaw, 0);
  }, [gltf, rig]);

  // DEV 可调姿势表（__playerPose）：双臂前伸伏桌，头微低（避免后脑勺入画）
  const pose = useMemo(() => {
    // 实测定稿（俯视 FPS：无头、肩臂入画、双手悬在桌沿上方作施法/操作势）
    const p = {
      ...rig.pose,
      y: rig.y,
      z: rig.z,
      freeze: false,
    };
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      w.__playerPose = p;
      w.__player = {
        scene: gltf.scene,
        bones: bones.current,
        mixer,
        thinkAction,
        anims: gltf.animations.map((a) => `${a.name}:${a.tracks.length}`),
      };
    }
    return p;
  }, [gltf, mixer, thinkAction, rig]);

  const group = useRef<THREE.Group>(null);
  // 注视镜头系统：思考姿势本身凝视 DECK_CAM 位置——当实际镜头偏离（自由视角拖拽）时，
  // 间歇性地把头转向镜头（限幅+缓入缓出），给"角色突然注意到你"的存在感
  const headBase = useRef<THREE.Quaternion | null>(null);
  const glance = useRef({ nextAt: 4, start: 0, until: 0 });
  const gv = useMemo(
    () => ({
      headPos: new THREE.Vector3(),
      baseDir: new THREE.Vector3(),
      camDir: new THREE.Vector3(),
      qDelta: new THREE.Quaternion(),
      qParent: new THREE.Quaternion(),
      qTmp: new THREE.Quaternion(),
      qId: new THREE.Quaternion(),
      ePose: new THREE.Euler(),
      qPose: new THREE.Quaternion(),
    }),
    [],
  );

  useFrame(({ clock, camera }) => {
    const w = (import.meta.env.DEV && (window as unknown as Record<string, unknown>).__playerPose) as
      | typeof pose
      | false;
    const p2 = w || pose;
    if (p2.freeze) return;
    const t = clock.elapsedTime;
    const st = useStudio.getState();
    // 卡组视角或自由视角都露脸+保持思考姿势（自由视角下用户可能拖到能看到自己的位置）
    const showSelf = st.deckView || st.freeCam;
    const breathe = Math.sin(t * 1.15 + 1.7) * 0.01;
    if (showSelf && thinkAction) {
      // 思考姿势：钉在 clip 末帧（首 key 是 rest）。paused 的 mixer 只保证首帧写入、
      // 后续可能跳采样——因此绝不在骨骼上做叠加（会累积卷塌），呼吸改由 group 整体浮动表达。
      // 坑：paused 的 action isRunning()===false 但仍占据 mixer 激活位——不先 stop() 彻底
      // 反激活，二次进入时 reset().play() 不会重新触发首帧采样，骨骼保留退出时的
      // FPS 低头姿势 → 头埋到桌面
      if (!thinkAction.isRunning() && !thinkAction.paused) {
        thinkAction.stop();
        thinkAction.reset().play();
        thinkAction.time = thinkAction.getClip().duration;
        thinkAction.paused = true;
        headBase.current = null; // 重新采样后基准失效，下帧重取
      }
      mixer.update(0.000001);
      // ── 头部注视：mixer 采样后以基准四元数为底、按目光窗口叠加限幅转头 ──
      const head = bones.current.head;
      if (head) {
        if (!headBase.current) headBase.current = head.quaternion.clone();
        else head.quaternion.copy(headBase.current);
        const gl2 = glance.current;
        let weight = 0;
        if (gl2.until === 0 && t >= gl2.nextAt) {
          gl2.start = t;
          gl2.until = t + 2.0 + (Math.sin(gl2.nextAt * 7.31) * 0.5 + 0.5) * 1.3;
        }
        if (gl2.until > 0) {
          if (t >= gl2.until) {
            // 伪随机排下一次注视（确定性可复现）
            const h = Math.abs(Math.sin(gl2.until * 12.9898) * 43758.5453) % 1;
            gl2.nextAt = t + 3.5 + h * 4.5;
            gl2.until = 0;
          } else {
            // 缓入缓出：窗口两端 0.5s 渐变
            const aIn = Math.min(1, (t - gl2.start) / 0.5);
            const aOut = Math.min(1, (gl2.until - t) / 0.5);
            const m = Math.min(aIn, aOut);
            weight = m * m * (3 - 2 * m);
          }
        }
        if (weight > 0.001) {
          head.updateWorldMatrix(true, false);
          gv.headPos.setFromMatrixPosition(head.matrixWorld);
          gv.baseDir.set(DECK_CAM.pos[0], DECK_CAM.pos[1], DECK_CAM.pos[2]).sub(gv.headPos).normalize();
          gv.camDir.copy(camera.position).sub(gv.headPos).normalize();
          gv.qDelta.setFromUnitVectors(gv.baseDir, gv.camDir);
          // 限幅 0.5 rad：只转头不拧脖子
          const ang = 2 * Math.acos(Math.min(1, Math.abs(gv.qDelta.w)));
          if (ang > 0.5) gv.qDelta.slerp(gv.qId, 1 - 0.5 / ang);
          gv.qDelta.slerp(gv.qId, 1 - weight);
          // 世界系增量 → 头骨局部系：local' = P⁻¹·Δ·P·local
          head.parent!.getWorldQuaternion(gv.qParent);
          gv.qTmp.copy(gv.qParent).invert().multiply(gv.qDelta).multiply(gv.qParent);
          head.quaternion.premultiply(gv.qTmp);
        }
      }
    } else {
      if (thinkAction && (thinkAction.isRunning() || thinkAction.paused)) thinkAction.stop();
      headBase.current = null;
      for (const k of Object.keys(BONES) as (keyof typeof BONES)[]) {
        const n = bones.current[k];
        const v = p2[k] as [number, number, number] | null;
        if (n && v) {
          gv.ePose.set(v[0] + (k === "spine1" ? breathe : 0), v[1], v[2]);
          const rest = restQ.current[k];
          if (rest) n.quaternion.copy(rest).multiply(gv.qPose.setFromEuler(gv.ePose));
          else n.rotation.set(gv.ePose.x, gv.ePose.y, gv.ePose.z);
        }
      }
    }
    // 头部：默认 FPS 隐藏；镜头可能拍到玩家时恢复显示
    const head = bones.current.head;
    if (head) {
      const s = showSelf ? 1 : 0.001;
      if (head.scale.x !== s) head.scale.set(s, s, s);
    }
    const baseY = showSelf && rig.deckY !== undefined ? rig.deckY : p2.y;
    if (group.current) group.current.position.set(0, baseY + (showSelf ? breathe * 0.6 : 0), p2.z);
  });

  return (
    <group ref={group} position={[0, pose.y, pose.z]}>
      <primitive object={gltf.scene} scale={rig.scale} />
      {/* 玩家侧补光：烛光都在桌北，肩臂需要一点暖光才可读 */}
      <pointLight position={[0, 4.2, -0.6]} intensity={6} distance={7} color="#ffdbb0" />
    </group>
  );
}
