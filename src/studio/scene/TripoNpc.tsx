// Tripo 图生 3D 铸卡师（AI 生成高模，?npc=tripo 启用）：
// mixamo 骨架每帧摆慵懒对坐姿势；引擎侧赛璐璐化（Toon ramp + 反壳描边）；
// 左手抬起持 AI 推荐卡（卡面挂 LeftHand 骨）。
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ThreeEvent, useFrame, useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { useStudio } from "../studioStore";
import { loaderFor } from "../secureAssets";
import { SpringBoneSim, type SphereCollider, type SpringOverrides } from "./springBones";
import { BreastPhysics, type PhysCollider } from "./breastPhysics";
import { applyCameraFade } from "./cameraFade";
import { RigidBoneSim, createRigidBoneSim } from "./rigidBones";
import { getQuality } from "../quality";
import { NPC_CAM } from "./layout";
import { NPC_HEAD, orbit } from "./cameraOrbit";
import { gazeDelta, type GazeLimits } from "./gazeDelta";

/** NPC 注视限幅：偏航 17°、抬头 10°、低头 4.6°。低头限得最死——脸前端到刘海外表面
 *  只有 0.0187 模型单位余量（实测），低头正是把脸往刘海里推的方向 */
const NPC_GAZE: GazeLimits = { yaw: 0.30, up: 0.18, down: 0.08 };

const _breastQ = new THREE.Quaternion();
const _breastEuler = new THREE.Euler(); // Breast 骨实测：x−=纯上抬（两侧同）、L y+/R y−=向外
const _breastDir = new THREE.Vector3();

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
export function toonify(
  scene: THREE.Object3D,
  width = 0.0045,
  wind?: { amp: number },
  look?: {
    /** 基色乘数：亮色贴图的购入模型在烛光暗房里过亮，用暖灰乘暗融入场景 */
    tint?: number;
    /** 描边纯色：浅色（白发）模型上"贴图×暗色"描边会发白，改用固定深色 */
    outlineColor?: number;
    /** 脸/皮肤专用乘色（动画惯例：脸保持明亮，官方宣传图即亮脸平光）——
     *  全局 tint 会把眼白/肤色压灰，眼周暗成"眼影"观感 */
    faceTint?: number;
    /** faceTint 作用的网格名子串（默认 face+body=脸与皮肤，防脖颈接缝色差） */
    faceMatch?: string[];
    /** 头发专用乘色：暖灰全局 tint 会把银白发染成粉米色（官方形象是冷银灰）——
     *  发色走冷调乘数、衣装保持暖调各自校准 */
    hairTint?: number;
    /** hairTint 作用的网格名子串（默认 hair+cow=头发与牛耳/角/尾，同材质防色差） */
    hairMatch?: string[];
    /** 不生成描边壳的网格名子串（默认 face）：睫毛/眼线是贴眼浮空 alpha 面片，
     *  反壳描边=整片实心深色轮廓包住眼睛（"黑眼圈"真凶）；动画惯例脸不描边 */
    noOutlineMatch?: string[];
  },
) {
  const ramp = new THREE.DataTexture(
    new Uint8Array([120, 120, 120, 255, 215, 215, 215, 255, 255, 255, 255, 255]),
    3,
    1,
  );
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  // 脸部专用近平光 ramp（动画惯例：脸不吃阴影渐变）——眼窝是凹面法线常年背光，
  // 三档 ramp 的 47% 暗档会把眼周贴图压成"黑眼影圈"（官方宣传图=平光亮脸）
  const faceRamp = new THREE.DataTexture(
    new Uint8Array([236, 236, 236, 255, 248, 248, 248, 255, 255, 255, 255, 255]),
    3,
    1,
  );
  faceRamp.minFilter = THREE.NearestFilter;
  faceRamp.magFilter = THREE.NearestFilter;
  faceRamp.needsUpdate = true;
  // 描边壳材质：有贴图时用 贴图×暗色 调制——开壳模型手臂贴身折叠时镜头会经袖口
  // 看进身体腔内打到壳背面，纯黑呈"撕裂黑洞"，暗色织物则读作阴影
  const makeOutline = (map: THREE.Texture | null, extraGLSL = "", alphaTest = 0) => {
    const m = look?.outlineColor
      ? new THREE.MeshBasicMaterial({ color: look.outlineColor, side: THREE.BackSide })
      : new THREE.MeshBasicMaterial({
          color: map ? 0x5a4a40 : 0x241a12,
          side: THREE.BackSide,
          map: map ?? undefined,
        });
  if (alphaTest > 0) m.alphaTest = alphaTest; // 反壳同样要裁切，否则发丝空隙被实心壳填死
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
    const nm = mesh.name.toLowerCase();
    const fm = look?.faceMatch ?? ["face", "body"];
    const hm = look?.hairMatch ?? ["hair", "cow"];
    const isFace = look?.faceTint !== undefined && fm.some((s) => nm.includes(s));
    const toonMat = new THREE.MeshToonMaterial({
      map: old.map,
      gradientMap: isFace ? faceRamp : ramp,
      side: THREE.DoubleSide,
    });
    const skinTint = isFace
      ? look!.faceTint
      : look?.hairTint !== undefined && hm.some((s) => nm.includes(s))
        ? look.hairTint
        : look?.tint;
    if (skinTint) toonMat.color.set(skinTint);
    // 购入模型的透明材质（睫毛/发影 alpha 层）保持透明混合
    if ((old as THREE.Material).transparent) {
      toonMat.transparent = true;
      toonMat.alphaTest = 0.05;
    }
    // alpha 裁切必须原样带过来。glTF 的 alphaMode:"MASK" 映射成 alphaTest>0 而
    // transparent 仍是 false——只判 transparent 会整个漏掉这类材质，于是"靠贴图
    // 切出形状"的发片/睫毛整片实心渲染，多层发片叠起来糊成一坨（接 Tsumire 实测）
    if (old.alphaTest > 0) toonMat.alphaTest = old.alphaTest;
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
    // 脸部不描边（隔离实验证实：眼周黑圈=睫毛/眼线 alpha 面片的实心反壳）。
    // 匹配串同时对**网格名和 baseColor 贴图名**生效：移植模型的网格常是
    // 建模软件自动命名（Tsumire 的脸就叫「平面001/_1/_2/_3」），按名字挑既认不出
    // 语义、重导一次就可能变；贴图名是稳定的语义锚点（tex_face.png）。
    const texNm = (old.map?.name ?? "").toLowerCase();
    const noShell = (look ? (look.noOutlineMatch ?? ["face"]) : []).some(
      (s) => nm.includes(s) || (!!texNm && texNm.includes(s))
    );
    if (noShell) continue;
    const shellMat = makeOutline(old.map ?? null, windGLSL, old.alphaTest);
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
  cfg,
  morphNames,
}: {
  url?: string;
  bust?: boolean;
  full?: boolean;
  /** 每模型摆位配置（购入模型比例/朝向各异）：优先于 bust/full 内置值；
   *  pose 覆盖默认 rest 站姿（如 FBX T-pose 需垂臂） */
  cfg?: {
    scale: number;
    y: number;
    z: number;
    yaw?: number;
    pose?: Partial<Record<keyof typeof POSE_KEYS, [number, number, number] | null>>;
    /** 弹簧骨链根名匹配（双马尾/牛耳/缎带物理），忽略大小写与符号 */
    springs?: string[];
    /** 弹簧手感（默认 stiffness 14/drag 0.32/gravity 1.6——按模型发型质感调） */
    springOpts?: { stiffness?: number; drag?: number; gravity?: number };
    /** 按链覆盖弹簧手感：刘海要贴头走（硬+高阻尼），长发要飘（软+低阻尼），
     *  一组参数满足不了两边 */
    springOverrides?: SpringOverrides;
    /** 弹簧骨球形碰撞体（防长发/丝带穿身）：骨名 + 世界半径 + 骨局部偏移（世界量纲，只随骨旋转） */
    springColliders?: Array<{ bone: string; radius: number; offset?: [number, number, number] }>;
    /** 外观：调暗/脸亮/发冷分调乘色 + 描边纯色（浅色模型）+ 脸部免描边 */
    look?: {
      tint?: number;
      outlineColor?: number;
      faceTint?: number;
      faceMatch?: string[];
      hairTint?: number;
      hairMatch?: string[];
      noOutlineMatch?: string[];
    };
    /** 半眯眨眼基线（此模型眼睑妆重时调低，默认 0.22；有 restMorphs 时应设 0） */
    blinkBase?: number;
    /** 常驻表情基线：模型自带表情键名→权重（如作者的 eye_nagomi 慵懒眼），
     *  引擎不再用 blink 半开模拟眯眼——部分闭眼会把眼睑妆压成黑圈 */
    restMorphs?: Record<string, number>;
    /** 常态浅笑基线（默认 0.22；restMorphs 已供气质时设 0 防叠加双重眯眼） */
    smileBase?: number;
    /** 俯身位移曲线：back=先整体后撤（撤步期，弯腰的横向空间），z/y=落定净位移
     *  ——90° 级深弯腰的胸前伸距离大，必须先退再弯才能正好落在桌沿上 */
    leanSlide?: { z: number; y: number; back?: number };
    /** 胸部软体物理：Breast 骨链弹簧 + 与前臂/桌沿/对侧胸/躯干碰撞——挤压避让由物理
     *  解出（breastLift 只提供"被托起"的 rest 目标，接触响应交给它） */
    breastPhys?: {
      stiffness?: number;
      drag?: number;
      gravity?: number;
      radii?: number[];
      /** 被顶起时胸根跟随上移的比例（真实软组织根部不钉死）+ 上限（锁骨下缘）+ 平滑速率 */
      rootLift?: number;
      rootLiftMax?: number;
      rootLiftSmooth?: number;
      /** 前臂碰撞胶囊半径（世界） */
      armRadius?: number;
      /** 桌沿圆柱：中心高/z 位/半径（世界，场景固定） */
      rail?: { y: number; z: number; radius: number };
      /** 躯干球半径（世界，防胸陷进身体） */
      torsoRadius?: number;
      /** 中缝保留：尾端与胸中线横距 ≥ 站姿 × 此系数（>1=比站姿更开，露出门襟扣子；
       *  0=关）。挤压时两团被前臂推向中线会把脊柱权重的门襟整条吞掉 */
      medialKeep?: number;
    };
    /** 接触托胸：胸底接触桌沿后 Breast 骨链上旋角（rad，负=抬起；childAngle 为二节；
     *  splay=向外分开角防两团向中聚拢重叠；sink=接触后身体下沉量（胸被托住不动，
     *  躯干沉入=重量压在胸上的读感）；swell=受压膨出（胸骨接触相位放大，
     *  参考图"被压得抬起上翘"的体积表达——纯旋转只会压扁贴身） */
    breastLift?: {
      angle: number;
      childAngle?: number;
      splay?: number;
      sink?: number;
      swell?: number;
      /** 沿胸骨自身轴向前顶出（臂托胸：胸底搁臂上、体积鼓向臂上前方越过臂线） */
      push?: number;
    };
  };
  /** 形键名映射（购入模型用原生键名，如 VRC 规格 "vrc.blink "——注意可能带尾随空格） */
  morphNames?: { blink?: string; mouthOpen?: string; smile?: string };
}) {
  const gltf = useLoader(loaderFor(url), url, (loader) => {
    (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder);
  });
  const bones = useRef<Record<string, THREE.Object3D | null>>({});
  const morphMeshes = useRef<THREE.Mesh[]>([]);
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
  const prevMoodUntil = useRef(0);
  // 进对话后延迟俯身：等相机走位到位（~1s）再开始过渡，玩家能完整看到动画
  const leanPendingAt = useRef(0);
  // 接触托胸的基准四元数/位置缓存（clamp 后 mixer 停写，复合必须基于基准防累积）
  const breastBase = useRef(new Map<string, THREE.Quaternion>());
  const breastPosBase = useRef(new Map<string, THREE.Vector3>());
  // 注视镜头系统（购入模型，移植自 PlayerArms）：定格姿势本身凝视 NPC_CAM 方向——
  // 实际镜头偏离（自由视角拖拽）时，间歇性把头转向镜头再收回（限幅+缓入缓出）。
  // 头骨全程被 lean 动画驱动：增量必须叠加在 mixer.update 之后。
  //
  // 基准怎么取：原来靠"动画状态切换时置空 + 等 2 帧重采样"，但状态判定依赖
  // lb.time/paused 这些会在边界反复横跳的量，一横跳就重采样、重采样期间头由动画
  // 驱动、之后又被按回旧基准——表现为头时不时向前抽一下并撞进刘海（用户实测）。
  // 改成精确判定：记下我们上一帧写进去的值，若这一帧读到的与它不同，说明 mixer
  // 刚写过，当前值就是新基准；若完全相同，说明 mixer 已停写（clamp 定格），沿用
  // 旧基准。这样无论动画在不在写都不会跳，也不需要任何状态机和等待帧。
  const headBase = useRef<THREE.Quaternion | null>(null);
  const headWritten = useRef<THREE.Quaternion | null>(null);
  const glance = useRef({ nextAt: 4, start: 0, until: 0 });
  /** 注视整体权重的缓变门（0=交还动画，1=允许叠加），防状态切换处硬跳 */
  const gazeGate = useRef(0);
  const gv = useMemo(
    () => ({
      headPos: new THREE.Vector3(),
      baseDir: new THREE.Vector3(),
      camDir: new THREE.Vector3(),
      qDelta: new THREE.Quaternion(),
      qParent: new THREE.Quaternion(),
      qTmp: new THREE.Quaternion(),
      qId: new THREE.Quaternion(),
    }),
    [],
  );
  const shadowFeltRef = useRef<THREE.Mesh | null>(null);
  const shadowRailRef = useRef<THREE.Mesh | null>(null);

  // 辅助骨物理（购入模型的双马尾/牛耳/缎带骨链）按画质分级：
  // 极致=MMD 刚体体系（Bullet 胶囊刚体+6DOF 弹簧约束+碰撞，懒加载失败回退）
  // 流畅/均衡=轻量弹簧骨 + 球形碰撞体
  const springColliders = useMemo<SphereCollider[]>(() => {
    const out: SphereCollider[] = [];
    for (const c of cfg?.springColliders ?? []) {
      const bone =
        gltf.scene.getObjectByName(c.bone) ?? gltf.scene.getObjectByName(c.bone.replace(/:/g, ""));
      if (bone)
        out.push({ bone, radius: c.radius, offset: c.offset ? new THREE.Vector3(...c.offset) : undefined });
    }
    return out;
  }, [gltf, cfg]);
  const springSim = useMemo(() => {
    if (!cfg?.springs?.length) return null;
    const sim = new SpringBoneSim(gltf.scene, cfg.springs, {
      ...cfg.springOpts,
      colliders: springColliders,
      overrides: cfg.springOverrides,
    });
    if (import.meta.env.DEV)
      console.log("[springs] joints:", sim.jointCount, "colliders:", springColliders.length);
    return sim.jointCount > 0 ? sim : null;
  }, [gltf, cfg, springColliders]);
  // 胸部软体物理（Breast 骨链 + 接触碰撞）：挤压/避让由物理解出
  const breastPhys = useMemo(() => {
    if (!cfg?.breastPhys) return null;
    const sim = new BreastPhysics(gltf.scene, cfg.breastPhys);
    if (import.meta.env.DEV) console.log("[breastPhys] joints:", sim.jointCount);
    return sim.jointCount > 0 ? sim : null;
  }, [gltf, cfg]);
  const physColliders = useRef<PhysCollider[]>([]);
  const collBones = useRef<Record<string, THREE.Object3D | null>>({});
  useEffect(() => {
    if (!cfg?.breastPhys) return;
    const g = (n: string) => gltf.scene.getObjectByName(n) ?? null;
    collBones.current = {
      lFore: g("mixamorigLeftForeArm"),
      lHand: g("mixamorigLeftHand"),
      rFore: g("mixamorigRightForeArm"),
      rHand: g("mixamorigRightHand"),
      spine1: g("mixamorigSpine1"),
    };
    const bp = cfg.breastPhys;
    const rail = bp.rail ?? { y: 0.08, z: -3.55, radius: 0.17 };
    physColliders.current = [
      { kind: "capsule", a: new THREE.Vector3(), b: new THREE.Vector3(), radius: bp.armRadius ?? 0.075 },
      { kind: "capsule", a: new THREE.Vector3(), b: new THREE.Vector3(), radius: bp.armRadius ?? 0.075 },
      {
        kind: "capsule",
        a: new THREE.Vector3(-8, rail.y, rail.z),
        b: new THREE.Vector3(8, rail.y, rail.z),
        radius: rail.radius,
      },
    ];
    if (bp.torsoRadius)
      physColliders.current.push({ kind: "sphere", center: new THREE.Vector3(), radius: bp.torsoRadius });
  }, [gltf, cfg]);
  const rigidSimRef = useRef<RigidBoneSim | null>(null);
  useEffect(() => {
    if (getQuality() !== "high" || !cfg?.springs?.length) return;
    let dead = false;
    createRigidBoneSim(gltf.scene, cfg.springs, springColliders)
      .then((sim) => {
        if (dead) return sim.dispose();
        rigidSimRef.current = sim;
        if (import.meta.env.DEV) {
          console.log("[rigid] MMD 刚体已启用（极致档）");
          (window as unknown as Record<string, unknown>).__rigidSim = sim;
        }
      })
      .catch((e) => console.warn("[rigid] Bullet 加载失败，回退弹簧骨", e));
    return () => {
      dead = true;
      rigidSimRef.current?.dispose();
      rigidSimRef.current = null;
    };
  }, [gltf, cfg, springColliders]);

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
    morphMeshes.current = [];
    gltf.scene.traverse((o) => {
      o.frustumCulled = false;
      const m = o as THREE.Mesh;
      if (m.isMesh && m.morphTargetDictionary && !m.userData.__isOutline) morphMeshes.current.push(m);
    });
    for (const [k, name] of Object.entries(POSE_KEYS)) bones.current[k] = gltf.scene.getObjectByName(name) ?? null;
    // full 描边收窄：手臂贴身（托腮/垫胸）时外扩壳会从胸口表面戳出成黑斑，宽度减半；
    // full 开裙摆风摆（布料柔软感）
    toonify(gltf.scene, cfg ? 0.002 : full ? 0.0009 : bust ? 0.003 : 0.0012, full ? { amp: 0.006 } : undefined, cfg?.look);
    // 相机穿模淡出：镜头贴近/穿过角色时近处片元网点渐隐（自由视角/环绕镜头穿身不再糊脸）
    applyCameraFade(gltf.scene);
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__npcGltf = gltf;
    // 立正靠 Root 骨自带的 (-90°,0,90°) 修正（勿动）；scene 只转 yaw -90° 面向镜头。
    // cfg 模型（购入资产）朝向各异，由 cfg.yaw 指定
    gltf.scene.rotation.set(0, cfg?.yaw ?? -Math.PI / 2, 0);
    // full：全身落地裙站姿（身高 1 归一化 → 4.35 世界），脚踩地站在桌后
    // bust：帽顶→胸底≈1 归一化，目标世界高 2.3，截断底沉桌沿下；
    // z 后移让身体前缘退到 rail 之后（-3.9 时胸/帽穿桌穿护栏）
    if (cfg) return { scale: cfg.scale, y: cfg.y };
    return full ? { scale: 4.35, y: -2.55 } : bust ? { scale: 2.3, y: -0.42 } : { scale: 4.6, y: -2.55 };
  }, [gltf, bust, full, cfg]);

  // 实测定稿（俯身对坐·抬头看镜头·右手扶桌/扶帽·左手抬起持卡）：轴向经 Root(-90°,0,90°) 链，勿按直觉改
  const pose = useMemo(() => {
    // cfg 模型（购入资产）：默认 rest，cfg.pose 覆盖（FBX T-pose 模型需垂臂等）
    // full：站姿保持 rest（扶帽+垂手烘在模型里），仅头颈微动
    // bust：右臂保持 rest（扶帽姿势烘在模型里，动了会拉扯帽子顶点）；前倾量小
    const p = cfg
      ? {
          spine1: null as [number, number, number] | null,
          spine2: null as [number, number, number] | null,
          neck: null as [number, number, number] | null,
          head: null as [number, number, number] | null,
          lArm: null as [number, number, number] | null,
          lFore: null as [number, number, number] | null,
          lHand: null as [number, number, number] | null,
          rArm: null as [number, number, number] | null,
          rFore: null as [number, number, number] | null,
          freeze: false,
          ...(cfg.pose ?? {}),
        }
      : full
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
      w.__tripo = {
        scene: gltf.scene,
        bones: bones.current,
        anims: gltf.animations.map((a) => `${a.name}:${a.tracks.length}`),
        acts: Object.keys(perfActions),
        trackSample: gltf.animations.flatMap((a) => a.tracks.slice(0, 4).map((tr) => tr.name)),
        leanBodyTracks: perfActions.leanBody ? perfActions.leanBody.getClip().tracks.length : -1,
        leanArmTracks: perfActions.leanArm ? perfActions.leanArm.getClip().tracks.length : -1,
        perfActions,
        mixer,
        glance: glance.current,
        springSim,
      };
    }
    return p;
  }, [gltf, bust, full, cfg]);

  useFrame(({ clock, camera }, dt) => {
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
    // full/带 lean 动画的购入模型：骨骼全程交 lean 动画（站姿=钉第 1 帧、对话=过渡/钉末帧）
    // ——程序手动 set 与动画混写是"一帧瞬移闪现"的根源；无动画的 cfg 模型退回 cfg.pose 手动姿势
    const leanDriving = full || (!!cfg && !!perfActions.leanBody);
    // lean 过渡进度（0 站姿 → 1 伏桌定格）：驱动 squish 接触门控与身体整体前移下沉
    let leanP = 0;
    if ((full || cfg) && perfActions.leanBody) {
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
    // 表情 morph：随机间隔眨眼（偶发双眨）+ npcSay 驱动口型 + 情绪事件驱动笑意 + 胸部压桌。
    // VRC 模型的脸常按材质拆成多个 primitive（面部本体+睫毛/眼线 alpha 层），形键同名
    // 各自独立——必须全部写入：只写其一=眼线层单独闭合盖在睁开的眼上（"黑眼影圈"根因）
    {
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
      for (const mm of morphMeshes.current) {
      const dict = mm.morphTargetDictionary!;
      const inf = mm.morphTargetInfluences!;
      // full HD 贴图眼睛全开——常驻 0.22 眨眼基线找回"半眯慵懒"设定气质
      // 形键名映射：自产模型用我们雕的键名，购入模型传原生键名（VRC 规格等）
      const nBlink = morphNames?.blink ?? "blink";
      const nMouth = morphNames?.mouthOpen ?? "mouthOpen";
      const nSmile = morphNames?.smile ?? "smile";
      if (dict[nBlink] !== undefined)
        inf[dict[nBlink]] = full || cfg ? Math.max(cfg?.blinkBase ?? 0.22, blink) : blink;
      if (dict[nMouth] !== undefined)
        inf[dict[nMouth]] = speaking ? Math.max(0, Math.sin(t * 9.5)) * 0.55 : 0;
      if (dict[nSmile] !== undefined) {
        // 情绪脉冲优先（入组/出炉笑意拉满；素材不合格/作废收敛），否则说话加深/常态浅笑
        const moodActive = st.moodUntil > Date.now();
        const target = moodActive
          ? st.mood > 0
            ? 0.25 + st.mood * 0.7
            : Math.max(0, 0.22 + st.mood * 0.35)
          : speaking
            ? 0.5 + Math.sin(t * 1.3) * 0.12
            : (cfg?.smileBase ?? 0.22);
        inf[dict[nSmile]] += (target - inf[dict[nSmile]]) * Math.min(1, dt * 6);
      }
      // 常驻表情基线：作者自带键直接置值（DEV 可 __restMorphs 现场调）
      const rest =
        (import.meta.env.DEV &&
          ((window as unknown as Record<string, unknown>).__restMorphs as
            | Record<string, number>
            | undefined)) ||
        cfg?.restMorphs;
      if (rest)
        for (const k of Object.keys(rest))
          if (dict[k] !== undefined) inf[dict[k]] = rest[k];
      // 胸部软性压桌：bust 版旧形键常驻；full 版=HD 重雕的小幅前缘轻压（无侧鼓），
      // 只在过渡末段胸口贴上桌沿时渐入，随呼吸微起伏
      if (dict.squish !== undefined) {
        let squish = 0;
        if (bust) squish = 0.72 + Math.sin(t * 1.1) * 0.18;
        else if (full) {
          const contact = Math.min(1, Math.max(0, (leanP - 0.6) / 0.4));
          squish = contact * contact * (3 - 2 * contact) * (0.85 + Math.sin(t * 1.1) * 0.1);
        }
        inf[dict.squish] = squish;
      }
      }
    }
    // full/购入模型状态机：站立（钉 lean f1）↔ 对话（播 lean 过渡，clamp 停末帧）
    if ((full || cfg) && perfActions.leanBody) {
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
      // 站姿=钉 lean 第 1 帧（f1 已烘成站姿）：用 timeScale=0 的"持续播放"钉帧——
      // 每帧都采样写入 frame0，彻底规避 paused 只写一次的陷阱类（购入模型上首次
      // 加载曾因此保持 T-pose）。倒播结束 clamp 到 0 后也重新接管为持续钉帧。
      if (!st.dialogView) {
        for (const a of [perfActions.leanBody, perfActions.leanArm]) {
          if (!a) continue;
          // 已钉住（timeScale 0 持续播放于 frame0）则跳过；倒播进行中（time>0）也别打断
          const pinned = a.timeScale === 0 && !a.paused && a.enabled && a.time <= 0.001;
          const reversing = a.isRunning() && a.timeScale < 0;
          if (!pinned && !reversing) {
            a.stop();
            a.setLoop(THREE.LoopOnce, 1);
            a.clampWhenFinished = true;
            a.reset().play();
            a.timeScale = 0;
          }
        }
      }
      if (leanPendingAt.current > 0 && t >= leanPendingAt.current && st.dialogView) {
        leanPendingAt.current = 0;
        playLean(perfActions.leanBody);
        playLean(perfActions.leanArm);
      }
      // 情绪正脉冲（炼卡成功/入组）→ 发牌演出（deal 基于 lean 定格姿势烘焙，无错位）
      if (
        st.dialogView &&
        st.moodUntil !== prevMoodUntil.current &&
        st.mood > 0 &&
        leanP > 0.9 &&
        perfActions.deal &&
        !perfActions.deal.isRunning()
      ) {
        perfActions.deal.reset().play();
      }
      prevMoodUntil.current = st.moodUntil;
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
      gltf.scene.position.z = -4.35 + 0.34 * le;
      // 呼吸移到 group（骨骼全程动画驱动，骨上叠加会累积）：站姿轻微、伏桌稍明显
      gltf.scene.position.y = y - 0.05 * le + Math.sin(t * 1.1) * (0.004 + 0.008 * le);
      // 接触阴影渐显：俯拍机位下"重量压上去"的唯一廉价线索
      const sf = shadowFeltRef.current;
      const sr = shadowRailRef.current;
      if (sf) (sf.material as THREE.MeshBasicMaterial).opacity = 0.6 * le;
      if (sr) (sr.material as THREE.MeshBasicMaterial).opacity = 0.5 * le;
    }
    // DEV 可 __breastLift 现场调托胸参数（重叠/悬浮类调参不必每轮改码重载）
    const bl =
      (import.meta.env.DEV &&
        ((window as unknown as Record<string, unknown>).__breastLift as
          | { angle: number; childAngle?: number; splay?: number; sink?: number; swell?: number; push?: number }
          | undefined)) ||
      cfg?.breastLift;
    if (!full && cfg) {
      // 购入模型俯身位移（人体弯腰上桌动力学，DEV __leanSlide 现场调）：
      // ① 撤步期（leanP<0.35）整体后撤 back——深弯腰胸前伸距离大，先退出横向空间
      // ② 弯腰期（>0.5）从后撤位回收到净位移 z——弯腰本身把胸送到桌沿上方
      // ③ 接触期（>0.7）躯干下沉 sink——胸被 breastLift 托住，沉入=重量压胸
      const ls =
        (import.meta.env.DEV &&
          ((window as unknown as Record<string, unknown>).__leanSlide as
            | { z: number; y: number; back?: number }
            | undefined)) ||
        cfg.leanSlide;
      const back = ls?.back ?? 0;
      const bp = Math.min(1, Math.max(0, leanP / 0.35));
      const bw = bp * bp * (3 - 2 * bp);
      const fp = Math.min(1, Math.max(0, (leanP - 0.5) / 0.5));
      const fw = fp * fp * (3 - 2 * fp);
      const arc = Math.sin(fw * Math.PI) * 0.06;
      const cwS = Math.min(1, Math.max(0, (leanP - 0.7) / 0.3));
      const sink = (bl?.sink ?? 0) * cwS * cwS * (3 - 2 * cwS);
      gltf.scene.position.z = cfg.z - back * bw + ((ls?.z ?? 0) + back) * fw;
      gltf.scene.position.y = y + (ls?.y ?? 0) * fw + arc - sink + Math.sin(t * 1.1) * 0.005;
    }
    // 演出动画先应用（LoopOnce 播放期间覆盖左臂程序姿势，播完自动交还），
    // 再读手骨位置更新持卡——发牌挥动时卡精确跟手。
    // dt 钳制：页面从后台切回时 dt 可达 1s+，会把 2s 过渡两帧跳完
    mixer.update(Math.min(dt, 0.05));
    // ── 接触托胸：胸底落上桌沿后被"托起"（模型自带 Breast 骨链上旋，接触相位渐进）。
    // 基准四元数缓存：clamp 定格后 mixer 停写，直接乘会逐帧累积——必须存基准再复合
    if (bl && leanP > 0) {
      const contact = Math.min(1, Math.max(0, (leanP - 0.7) / 0.3));
      const cw = contact * contact * (3 - 2 * contact);
      const bm = breastBase.current;
      const splay = bl.splay ?? 0;
      // 全程写（cw=0 时等于写回原动画姿态）：中途清缓存会让物理在阈值处读到自己的
      // 上一帧输出当 rest，接管瞬间跳变=用户看到的"过渡中抽动"
      {
        // 上抬（x−，实测两侧均纯垂直）+ 向外分开（L y+ / R y−，防两团向中聚拢重叠）
        for (const [name, ang0, sy] of [
          ["Breast_L", bl.angle, splay],
          ["Breast_R", bl.angle, -splay],
          ["Breast_L001", bl.childAngle ?? 0, 0],
          ["Breast_R001", bl.childAngle ?? 0, 0],
        ] as const) {
          const ang = ang0;
          const bone = gltf.scene.getObjectByName(name);
          if (!bone) continue;
          let base = bm.get(name);
          if (!base) {
            base = bone.quaternion.clone();
            bm.set(name, base);
          }
          bone.quaternion
            .copy(base)
            .multiply(_breastQ.setFromEuler(_breastEuler.set(ang * cw, sy * cw, 0)));
          // 受压膨出+前顶：根骨接触相位放大 + 沿骨轴（指向胸尖）前推（position 在父系，
          // 骨自身 Y 轴方向=quaternion×(0,1,0)；基准位置缓存防 clamp 后累积）
          if (name === "Breast_L" || name === "Breast_R") {
            bone.scale.setScalar(1 + (bl.swell ?? 0) * cw);
            if (bl.push) {
              let pbase = breastPosBase.current.get(name);
              if (!pbase) {
                pbase = bone.position.clone();
                breastPosBase.current.set(name, pbase);
              }
              bone.position
                .copy(pbase)
                .addScaledVector(_breastDir.set(0, 1, 0).applyQuaternion(bone.quaternion), bl.push * cw);
            }
          }
        }
      }
    } else if (breastBase.current.size) breastBase.current.clear();
    // ── 胸部软体物理：breastLift 给出 rest 目标后，由接触碰撞解出真实挤压/避让 ──
    if (breastPhys) {
      const cb = collBones.current;
      const cols = physColliders.current;
      gltf.scene.updateMatrixWorld(true);
      if (cb.lFore && cb.lHand && cols[0]?.kind === "capsule") {
        cb.lFore.getWorldPosition(cols[0].a);
        cb.lHand.getWorldPosition(cols[0].b);
      }
      if (cb.rFore && cb.rHand && cols[1]?.kind === "capsule") {
        cb.rFore.getWorldPosition(cols[1].a);
        cb.rHand.getWorldPosition(cols[1].b);
      }
      if (cb.spine1 && cols[3]?.kind === "sphere") cb.spine1.getWorldPosition(cols[3].center);
      // 全程驱动（breastLift 现已全程写 rest）：阈值处突然接管才是抽动来源
      breastPhys.update(dt, cols, !!bl && leanP > 0.02);
    }
    // ── 头部注视：动画采样之后、世界矩阵/弹簧骨之前叠加限幅转头 ──
    // 只在动画"定格"态叠加（1=站姿钉 f1、2=对话 clamp 末帧）：过渡/倒播期间动画
    // 每帧重写头骨会与叠加打架；定格后 mixer 输出恒定不再 setValue，外部写入可留存
    if (cfg && perfActions.leanBody && b.head) {
      const lb = perfActions.leanBody;
      const head = b.head;
      const pinnedNow = lb.timeScale === 0 && !lb.paused && lb.enabled && lb.time <= 0.001;
      const settled = lb.paused && lb.time >= lb.getClip().duration - 0.001;
      const animState = pinnedNow ? 1 : settled ? 2 : 0;
      // 门限缓变：过渡段交还动画、钉帧/定格段允许叠加，中间用 ~0.35s 过渡不硬跳
      const gateTarget = animState !== 0 ? 1 : 0;
      gazeGate.current += (gateTarget - gazeGate.current) * Math.min(1, dt * 3);
      if (gazeGate.current > 0.001) {
        // 基准取值：与上一帧写入值比对——不同=mixer 刚写过，当前值即新基准；
        // 相同=mixer 已停写（clamp 定格），沿用旧基准。不需要状态机与等待帧。
        if (!headBase.current) headBase.current = head.quaternion.clone();
        else if (!headWritten.current || !head.quaternion.equals(headWritten.current))
          headBase.current.copy(head.quaternion);
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
            // 缓入缓出：窗口两端 0.9s 渐变。原来 0.5s——刘海是弹簧骨（stiffness 4、
            // drag 0.28），转头太快它跟不上，脸就从落后的刘海里钻出来。拉长渐变让发跟上。
            const aIn = Math.min(1, (t - gl2.start) / 0.9);
            const aOut = Math.min(1, (gl2.until - t) / 0.9);
            const m = Math.min(aIn, aOut);
            weight = m * m * (3 - 2 * m);
          }
        }
        if (weight > 0.001) {
          head.updateWorldMatrix(true, false);
          gv.headPos.setFromMatrixPosition(head.matrixWorld);
          gv.baseDir.set(NPC_CAM.pos[0], NPC_CAM.pos[1], NPC_CAM.pos[2]).sub(gv.headPos).normalize();
          gv.camDir.copy(camera.position).sub(gv.headPos).normalize();
          // 偏航/俯仰分离限幅（见 gazeDelta.ts）。实测：脸最前端距头骨 0.0759 模型单位，
          // 到刘海外表面余量仅 0.0187，低头方向必须限死。
          gazeDelta(gv.baseDir, gv.camDir, NPC_GAZE, weight * gazeGate.current, gv.qDelta);
          // 世界系增量 → 头骨局部系：local' = P⁻¹·Δ·P·local
          head.parent!.getWorldQuaternion(gv.qParent);
          gv.qTmp.copy(gv.qParent).invert().multiply(gv.qDelta).multiply(gv.qParent);
          head.quaternion.copy(headBase.current!).premultiply(gv.qTmp);
        }
        // 记下本帧写入值：下一帧靠它判断 mixer 有没有重写头骨
        if (!headWritten.current) headWritten.current = head.quaternion.clone();
        else headWritten.current.copy(head.quaternion);
      }
    }
    gltf.scene.updateMatrixWorld(true);
    // 发布头部世界坐标：相机绕 NPC 头做球面运动 + 第一人称眼位的注视目标
    if (bones.current.head) bones.current.head.getWorldPosition(NPC_HEAD);
    // 辅助骨物理在姿势/动画之后模拟（读最新世界矩阵，回写局部旋转）；
    // 刚体版就绪前弹簧骨顶着（懒加载期间不裸奔）
    const physSim = rigidSimRef.current ?? springSim;
    if (physSim) {
      physSim.update(dt);
      gltf.scene.updateMatrixWorld(true);
    }
  });

  return (
    <group>
      {/* full 站在桌后（落地裙）；bust z：胸前缘恰好压上桌沿 rail，配合 squish 呈"撑在桌面"贴合 */}
      {/* 点击 NPC 建模 = 进入对话（对话框默认隐藏，只由此唤起）；轨道拖拽末尾的 click 不误触 */}
      <primitive
        object={gltf.scene}
        position={[0, y, cfg ? cfg.z : full ? -4.35 : bust ? -4.28 : -3.9]}
        scale={scale}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (orbit.active) return;
          useStudio.getState().openNpcDialog();
        }}
      />
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
    </group>
  );
}
