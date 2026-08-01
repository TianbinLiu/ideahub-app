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
export function toonify(scene: THREE.Object3D, width = 0.0045, wind?: { amp: number }) {
  const ramp = new THREE.DataTexture(
    new Uint8Array([120, 120, 120, 255, 215, 215, 215, 255, 255, 255, 255, 255]),
    3,
    1,
  );
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  // 描边壳材质：有贴图时用 贴图×暗色 调制——开壳模型手臂贴身折叠时镜头会经袖口
  // 看进身体腔内打到壳背面，纯黑呈"撕裂黑洞"，暗色织物则读作阴影
  const makeOutline = (map: THREE.Texture | null, extraGLSL = "") => {
    const m = new THREE.MeshBasicMaterial({
      color: map ? 0x5a4a40 : 0x241a12,
      side: THREE.BackSide,
      map: map ?? undefined,
    });
    m.onBeforeCompile = (s) => {
      s.uniforms.uWindT = { value: 0 };
      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uWindT;")
        .replace(
          "#include <skinning_vertex>",
          `#include <skinning_vertex>\n\ttransformed += objectNormal * ${width.toFixed(5)};${extraGLSL}`,
        );
      if (extraGLSL) ((scene.userData.__windUniforms ??= []) as { value: number }[]).push(s.uniforms.uWindT as { value: number });
    };
    return m;
  };
  const targets: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (mesh.isMesh && !mesh.userData.__isOutline && !mesh.userData.__toonified) targets.push(mesh);
  });
  for (const mesh of targets) {
    mesh.userData.__toonified = true;
    const old = mesh.material as THREE.MeshStandardMaterial;
    if (old.map) old.map.anisotropy = 8; // 近距斜视角（卡组机位拍脸）贴图不糊
    // 布料风摆：腰线以下正弦摆动、越向裙摆越大（用包围盒推导腰/摆位置，
    // 对量化与非量化 LOD 通用）——"下坠成一条线"的硬裙有了柔软呼吸感
    let windGLSL = "";
    if (wind) {
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox!;
      const h = bb.max.y - bb.min.y;
      const waist = bb.min.y + h * 0.5;
      const hem = bb.min.y + h * 0.06;
      const amp = h * wind.amp;
      windGLSL =
        `\n\tfloat windW = smoothstep(${waist.toFixed(3)}, ${hem.toFixed(3)}, position.y);` +
        `\n\ttransformed.x += sin(uWindT * 1.3 + position.y * 2.2) * ${amp.toFixed(4)} * windW;` +
        `\n\ttransformed.z += cos(uWindT * 0.9 + position.x * 2.6) * ${(amp * 0.6).toFixed(4)} * windW;`;
    }
    // DoubleSide：开壳模型（袖筒/裙摆）折叠时镜头会看进开口内侧——单面渲染时内壁
    // 透空露出描边壳黑色背面，呈大块黑色"撕裂"；双面让内壁显示织物贴图
    const toonMat = new THREE.MeshToonMaterial({ map: old.map, gradientMap: ramp, side: THREE.DoubleSide });
    if (windGLSL) {
      toonMat.onBeforeCompile = (s) => {
        s.uniforms.uWindT = { value: 0 };
        s.vertexShader = s.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uWindT;")
          .replace("#include <skinning_vertex>", `#include <skinning_vertex>${windGLSL}`);
        ((scene.userData.__windUniforms ??= []) as { value: number }[]).push(s.uniforms.uWindT as { value: number });
      };
    }
    mesh.material = toonMat;
    old.dispose();
    const shellMat = makeOutline(old.map ?? null, windGLSL);
    let shell: THREE.Mesh;
    if (mesh.isSkinnedMesh) {
      const s = new THREE.SkinnedMesh(mesh.geometry, shellMat);
      s.bind(mesh.skeleton, mesh.bindMatrix);
      s.bindMode = mesh.bindMode;
      shell = s;
    } else {
      shell = new THREE.Mesh(mesh.geometry, shellMat);
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
    // lean（全身俯身压桌托腮）拆两层：身体层（髋/脊柱/颈头/右臂撑桌）常驻；左臂层在 wave/deal 演出时让位
    const leanClip = THREE.AnimationClip.findByName(gltf.animations, "lean");
    if (leanClip) {
      const body = leanClip.tracks.filter((tr) =>
        /(Hips|Spine|Spine1|Spine2|Neck|Head|Right(Arm|ForeArm|Hand))\.quaternion$/.test(tr.name),
      );
      const arm = leanClip.tracks.filter((tr) => /Left(Arm|ForeArm|Hand)\.quaternion$/.test(tr.name));
      out.leanBody = mixer.clipAction(new THREE.AnimationClip("leanBody", leanClip.duration, body));
      out.leanArm = mixer.clipAction(new THREE.AnimationClip("leanArm", leanClip.duration, arm));
    }
    return out;
  }, [gltf, mixer]);
  const prevDialog = useRef(false);
  const dealWasRunning = useRef(false);
  // 进对话后延迟俯身：等相机走位到位（~1s）再开始过渡，玩家能完整看到动画
  const leanPendingAt = useRef(0);
  const cardMeshRef = useRef<THREE.Mesh | null>(null);
  const cardIdRef = useRef<string | null>(null);
  const shadowFeltRef = useRef<THREE.Mesh | null>(null);
  const shadowRailRef = useRef<THREE.Mesh | null>(null);
  const recommend = useStudio((s) => s.recommendCard);

  // 接触阴影贴片：俯拍机位下"压上桌"的重量感全靠它（径向渐变软边椭圆）
  const shadowTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(128, 64, 8, 128, 64, 122);
    g.addColorStop(0, "rgba(0,0,0,0.60)");
    g.addColorStop(0.55, "rgba(0,0,0,0.30)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(128, 64, 124, 60, 0, 0, Math.PI * 2);
    ctx.fill();
    return new THREE.CanvasTexture(c);
  }, []);

  const { scale, y } = useMemo(() => {
    gltf.scene.traverse((o) => {
      o.frustumCulled = false;
      const m = o as THREE.Mesh;
      if (m.isMesh && m.morphTargetDictionary && !m.userData.__isOutline) morphMesh.current = m;
    });
    for (const [k, name] of Object.entries(POSE_KEYS)) bones.current[k] = gltf.scene.getObjectByName(name) ?? null;
    // full 描边收窄：手臂贴身（托腮/垫胸）时外扩壳会从胸口表面戳出成黑斑，宽度减半；
    // full 开裙摆风摆（布料柔软感）
    toonify(gltf.scene, full ? 0.0009 : bust ? 0.003 : 0.0012, full ? { amp: 0.006 } : undefined);
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
    const st = useStudio.getState();
    // full：骨骼全程交 lean 动画（站姿=钉第 1 帧、对话=过渡/钉末帧）——程序手动 set 与动画
    // 混写是"一帧瞬移闪现"的根源（动画首帧 rest 与程序微姿态差一跳）
    const leanDriving = full;
    // lean 过渡进度（0 站姿 → 1 伏桌定格）：驱动 squish 接触门控与身体整体前移下沉
    let leanP = 0;
    if (full && perfActions.leanBody) {
      const lb = perfActions.leanBody;
      if (lb.isRunning() || lb.paused)
        leanP = Math.min(1, lb.time / Math.max(0.001, lb.getClip().duration));
    }
    if (!leanDriving) {
      for (const k of Object.keys(POSE_KEYS) as (keyof typeof POSE_KEYS)[]) {
        const n = b[k];
        const v = p2[k] as [number, number, number] | null;
        if (n && v) n.rotation.set(v[0] + (k === "spine1" ? breathe : 0), v[1], v[2]);
      }
    }
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
      // 胸部撑桌：bust 常驻；full 只在过渡后段胸口真正贴上桌沿时渐入，且封顶 0.58——
      // 过早/满值压扁悬空的胸部会显得模型变形
      if (dict.squish !== undefined) {
        let squish = 0;
        if (bust) squish = 0.72 + Math.sin(t * 1.1) * 0.18;
        else if (full) {
          const contact = Math.min(1, Math.max(0, (leanP - 0.55) / 0.45));
          const cEase = contact * contact * (3 - 2 * contact);
          squish = cEase * (0.5 + Math.sin(t * 1.1) * 0.08);
        }
        inf[dict.squish] = squish;
      }
    }
    // full 状态机：站立（无动画=rest）↔ 对话（播 lean 过渡：前倾压桌+托腮，clamp 停末帧）
    if (full && perfActions.leanBody) {
      const playLean = (a?: THREE.AnimationAction) => {
        if (!a) return;
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
        // 若正处于倒播/中途——从当前姿势顺播续上，不重置（避免瞬跳回站姿）
        const mid =
          (a.isRunning() || a.paused) && a.time > 0.001 && a.time < a.getClip().duration - 0.001;
        a.timeScale = 1;
        a.paused = false;
        if (mid) a.play();
        else a.reset().play();
      };
      if (st.dialogView && !prevDialog.current) {
        perfActions.wave?.stop();
        perfActions.deal?.stop();
        leanPendingAt.current = t + 0.9;
      } else if (!st.dialogView && prevDialog.current) {
        leanPendingAt.current = 0;
        // 退出对话：倒播过渡缓缓直起身（不瞬移回站姿）
        for (const a of [perfActions.leanBody, perfActions.leanArm]) {
          if (a && (a.isRunning() || a.paused) && a.time > 0.001) {
            a.paused = false;
            a.timeScale = -1.8;
            a.play();
          }
        }
        perfActions.deal?.stop();
      }
      // 站姿=钉 lean 第 1 帧（f1 已烘成站姿微姿态）：倒播结束后自然停在 0=站姿；
      // 首次加载/完全停止时主动钉上。注意 paused 陷阱：必须先 stop() 反激活再重新
      // play，否则 mixer 不重采样（PlayerArms 同款坑）
      if (!st.dialogView) {
        for (const a of [perfActions.leanBody, perfActions.leanArm]) {
          if (a && !a.isRunning() && !a.paused) {
            a.stop();
            a.setLoop(THREE.LoopOnce, 1);
            a.clampWhenFinished = true;
            a.timeScale = 1;
            a.reset().play();
            a.paused = true;
          }
        }
      }
      if (leanPendingAt.current > 0 && t >= leanPendingAt.current && st.dialogView) {
        leanPendingAt.current = 0;
        playLean(perfActions.leanBody);
        playLean(perfActions.leanArm);
      }
      // deal 发牌演出结束 → 左手过渡回托腮（重播 leanArm 的过渡段）
      const dealing = !!perfActions.deal?.isRunning();
      if (dealing && perfActions.leanArm?.isRunning()) perfActions.leanArm.stop();
      if (!dealing && dealWasRunning.current && st.dialogView) playLean(perfActions.leanArm);
      dealWasRunning.current = dealing;
      prevDialog.current = st.dialogView;
    } else if (bust) {
      // bust：进入对话→招手
      if (st.dialogView && !prevDialog.current && perfActions.wave) {
        perfActions.deal?.stop();
        perfActions.wave.reset().play();
      }
      prevDialog.current = st.dialogView;
    }
    // 裙摆风摆时钟
    const wu = gltf.scene.userData.__windUniforms as { value: number }[] | undefined;
    if (wu) for (const u of wu) u.value = t;
    // 伏桌时身体整体前移+下沉：关节弯曲只完成一半姿态，剩下靠重心挪——胸口落上桌沿。
    // 幅度=剪影下缘恰好与护栏顶相切（越过桌沿溢到桌毡会读作"前穿"而非"压在上面"）
    // （随 leanP 缓动，退出倒播时自动缩回；微幅正弦=伏桌呼吸起伏）
    if (full) {
      const le = leanP * leanP * (3 - 2 * leanP);
      gltf.scene.position.z = -4.35 + 0.22 * le;
      // 呼吸移到 group（骨骼全程动画驱动，骨上叠加会累积）：站姿轻微、伏桌稍明显
      gltf.scene.position.y = y - 0.02 * le + Math.sin(t * 1.1) * (0.004 + 0.008 * le);
      // 接触阴影渐显：俯拍机位下"重量压上去"的唯一廉价线索
      const sf = shadowFeltRef.current;
      const sr = shadowRailRef.current;
      if (sf) (sf.material as THREE.MeshBasicMaterial).opacity = 0.6 * le;
      if (sr) (sr.material as THREE.MeshBasicMaterial).opacity = 0.5 * le;
    }
    // 演出动画先应用（LoopOnce 播放期间覆盖左臂程序姿势，播完自动交还），
    // 再读手骨位置更新持卡——发牌挥动时卡精确跟手。
    // dt 钳制：页面从后台切回时 dt 可达 1s+，会把 2s 过渡两帧跳完
    mixer.update(Math.min(dt, 0.05));
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
        // 发牌演出：新卡递出时左手挥卡（用户已砍掉 full 的持卡展示，仅 bust 保留）
        if (bust && st.dialogView && perfActions.deal && !perfActions.wave?.isRunning()) {
          perfActions.deal.reset().play();
        }
      }
      // 用户定：full 版不要推荐卡悬浮在手上
      card.visible = !!recommend && st.dialogView && !st.market.open && !full;
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
      {/* 伏桌接触阴影：桌毡一片 + 护栏顶一片，透明度随 lean 进度渐入 */}
      {full && (
        <>
          <mesh ref={shadowFeltRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.072, -3.28]} renderOrder={2}>
            <planeGeometry args={[2.0, 0.9]} />
            <meshBasicMaterial map={shadowTex} transparent opacity={0} depthWrite={false} />
          </mesh>
          <mesh ref={shadowRailRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.262, -3.55]} renderOrder={2}>
            <planeGeometry args={[1.8, 0.5]} />
            <meshBasicMaterial map={shadowTex} transparent opacity={0} depthWrite={false} />
          </mesh>
        </>
      )}
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
