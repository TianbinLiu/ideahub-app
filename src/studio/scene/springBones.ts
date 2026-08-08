// 轻量弹簧骨（VRM SpringBone 式）：给购入模型的辅助骨链（双马尾/牛耳/缎带）
// 提供惯性摆动物理。每关节维护"当前尾端世界位置"，逐帧：惯性外推 + 刚度回弹
// 向 rest 方向 + 重力下垂，再把尾端方向差转成骨骼局部旋转。
import * as THREE from "three";
import { FixedStepper } from "./fixedStep";

interface Joint {
  bone: THREE.Object3D;
  child: THREE.Object3D;
  restQuat: THREE.Quaternion;
  restChildPos: THREE.Vector3; // 骨局部系下子骨 rest 位置
  boneLen: number; // 尾端球面半径=世界 rest 长度（首次 update 时量定，见下）
  currTail: THREE.Vector3;
  prevTail: THREE.Vector3;
  /** 最近一次积分步写入的局部旋转：不足一步的渲染帧原样重放（见 update 注释） */
  lastQuat: THREE.Quaternion;
  /** 上一积分步的骨骼世界 y：微小垂直平移（呼吸起伏）做惯性中和（见 step 注释） */
  prevBoneY: number;
  inited: boolean; // 尾端状态延迟到首次 update 初始化（那时世界矩阵才可靠）
  /** 每链独立的手感参数：刘海和双马尾要的东西完全相反——长发要飘（软、低阻尼），
   *  刘海要贴着头走（硬、高阻尼）。共用一组参数时刘海跟不上头的快速点头，
   *  脸就从落后的刘海里钻出来（用户实测：注视/点头时脸捅出刘海）。 */
  k: number;
  d: number;
  g: number;
  /** 命中 overrides 的链参数按链定制，setParams 整体换手感时不动它们 */
  ovr: boolean;
}

/** 按链前缀覆盖手感参数（键用与 prefixes 同样的归一化匹配） */
export type SpringOverrides = Record<string, { stiffness?: number; drag?: number; gravity?: number }>;

/** 球形碰撞体：挂在骨骼上随动（世界半径；offset 为骨局部偏移，随骨旋转） */
export interface SphereCollider {
  bone: THREE.Object3D;
  radius: number;
  offset?: THREE.Vector3;
}

const _bonePos = new THREE.Vector3();
const _parentQuat = new THREE.Quaternion();
const _restDirWorld = new THREE.Vector3();
const _next = new THREE.Vector3();
const _inertia = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _rot = new THREE.Quaternion();
const _collCenter = new THREE.Vector3();
const _collOff = new THREE.Vector3();
const _hitCenter = new THREE.Vector3();
const _hitN = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _collQuat = new THREE.Quaternion();

export class SpringBoneSim {
  private joints: Joint[] = [];
  stiffness: number;
  drag: number;
  gravity: number;
  colliders: SphereCollider[];

  /**
   * @param root 骨架所在场景
   * @param prefixes 链根名匹配（大小写不敏感、忽略非字母数字，如 "twintail"）
   *
   * ⚠️ 匹配是**子串**判断而不是前缀判断，很容易误伤：归一化会剥掉下划线和点，
   * 于是 "twintail_L" → "twintaill" 里含有 "tail"——给猫尾链写 prefixes:["Tail"]
   * 会连双马尾一起收进来。同一根骨被两套 sim 每帧各写一遍就是抽搐
   * （2026-08-07 接 Tsumire 时踩到）。这种时候用 opts.exclude 排掉。
   */
  /** 可选平面碰撞：按尾端位置返回允许的最低 y（桌面/地板），长发垂落时贴面不穿透 */
  clampY?: (pos: THREE.Vector3) => number;

  constructor(
    root: THREE.Object3D,
    prefixes: string[],
    opts?: {
      stiffness?: number;
      drag?: number;
      gravity?: number;
      colliders?: SphereCollider[];
      clampY?: (pos: THREE.Vector3) => number;
      overrides?: SpringOverrides;
      /** 反向排除：命中 prefixes 但也命中这里的骨不收（同样是归一化子串匹配）。
       *  用来化解 prefixes 之间的误伤，见构造函数注释 */
      exclude?: string[];
    },
  ) {
    this.stiffness = opts?.stiffness ?? 14;
    this.drag = opts?.drag ?? 0.32;
    this.gravity = opts?.gravity ?? 1.6;
    this.clampY = opts?.clampY;
    this.colliders = opts?.colliders ?? [];
    // 保留 Unicode 字母数字（MMD 移植模型的骨名是中日文：馬尾/後髪/劉海），只剥符号
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const pats = prefixes.map(norm);
    const excl = (opts?.exclude ?? []).map(norm);
    const ovr = Object.entries(opts?.overrides ?? {}).map(([k, v]) => [norm(k), v] as const);
    root.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      const n = norm(o.name);
      if (!pats.some((p) => n.includes(p))) return;
      if (excl.some((p) => n.includes(p))) return;
      const hit = ovr.find(([k]) => n.includes(k))?.[1];
      // 每根骨与其第一个骨骼子节点构成一个关节（叶骨无子，跳过）
      const child = o.children.find((c) => (c as THREE.Bone).isBone);
      if (!child) return;
      this.joints.push({
        bone: o,
        child,
        restQuat: o.quaternion.clone(),
        restChildPos: child.position.clone(),
        // 占位=局部 rest 长度。构造发生在 r3f commit 前（场景缩放/摆位未生效），
        // 此刻量世界长度不可靠且随挂载时序漂移（StrictMode 二次挂载时已带 3.35×缩放）
        // ——真正的半径在首次 update 时量定（那时世界矩阵已就绪）。
        boneLen: child.position.length() || 1e-4,
        currTail: new THREE.Vector3(),
        prevTail: new THREE.Vector3(),
        lastQuat: new THREE.Quaternion(),
        prevBoneY: 0,
        inited: false,
        k: hit?.stiffness ?? this.stiffness,
        d: hit?.drag ?? this.drag,
        g: hit?.gravity ?? this.gravity,
        ovr: !!hit,
      });
    });
  }

  get jointCount() {
    return this.joints.length;
  }

  /** 本 sim 实际驱动的骨名（供上层自检"同一根骨被多组驱动"） */
  boneNames(): string[] {
    return this.joints.map((j) => j.bone.name);
  }

  /** 运行时整体换手感（直立/伏桌切换用）。此前外部直接改 sim.stiffness 等字段，
   *  但关节在构造时已把参数快照进 j.k/j.d/j.g——那是三行永远不生效的死代码。
   *  overrides 命中的链保持按链定制值不被覆盖。 */
  setParams(o: { stiffness?: number; drag?: number; gravity?: number }) {
    this.stiffness = o.stiffness ?? 14;
    this.drag = o.drag ?? 0.32;
    this.gravity = o.gravity ?? 1.6;
    for (const j of this.joints) {
      if (j.ovr) continue;
      j.k = this.stiffness;
      j.d = this.drag;
      j.g = this.gravity;
    }
  }

  private stepper = new FixedStepper();

  update(dt: number) {
    // 固定步长：操作镜头时 dt 剧烈波动，变 dt 直接喂显式积分会让头发/缎带抖动、拉扯
    //（用户实测"移动摄像头会让模型扭曲抖动"）。
    const n = this.stepper.take(dt);
    for (let i = 0; i < n; i++) this.step(this.stepper.step);
    // 不足一步的帧**重放上一积分步的旋转**，绝不重算几何：
    // 旧实现是"把尾端重新投影到当前骨骼变换"再重解一遍旋转——链上父子一步延迟
    // 耦合让重投影解与积分解从链根就系统性分岔（实测根骨差 1°、到第 5 节放大成
    // 25°），高刷屏上积分帧/重投影帧交替渲染 = 头发在两个姿势间高频翻转（抽搐）。
    // 原样重放与积分帧严格一致；同时也把动画混合器每帧写回的 rest 姿势盖掉
    // （NPC 的 idle 动画每帧都在写发链骨），骨骼这一帧绝不会暴露 rest。
    if (n === 0) this.hold();
  }

  /** 不足一步的渲染帧：把每个关节最近一次积分算出的局部旋转原样写回 */
  private hold() {
    for (const j of this.joints) {
      if (!j.inited) continue; // 首次积分前没有可重放的解，保持现状（rest/动画帧）
      j.bone.quaternion.copy(j.lastQuat);
      j.bone.updateMatrixWorld(false);
    }
  }

  private step(d: number) {
    for (const j of this.joints) {
      const bone = j.bone;
      bone.getWorldPosition(_bonePos);
      // rest 方向（父骨当前朝向 × rest 局部子位）
      bone.parent!.getWorldQuaternion(_parentQuat);
      _restDirWorld.copy(j.restChildPos).applyQuaternion(j.restQuat).applyQuaternion(_parentQuat).normalize();
      // 首帧：量定世界 rest 长度（缩放已生效；此时骨还未被本 sim 转过，子骨在 rest 位），
      // 尾端从 rest 位静止起步——无启动跳变。手感参数按世界量纲调定（模型 scale 3.35）。
      if (!j.inited) {
        j.inited = true;
        j.boneLen = j.child.getWorldPosition(_next).distanceTo(_bonePos) || j.boneLen;
        j.currTail.copy(_bonePos).addScaledVector(_restDirWorld, j.boneLen);
        j.prevTail.copy(j.currTail);
        j.prevBoneY = _bonePos.y;
      }
      // 呼吸中和：角色整体的呼吸起伏（±2mm 级垂直正弦）会经球面约束把垂直激励
      // 转成切向运动，被链条共振放大成发梢持续画圈（实测冻结起伏立即完全静止、
      // 恢复即复现 0.37 幅度进动，刚度/阻尼都压不住）。微小垂直位移让尾端状态
      // 跟随参考系平移（不产生相对速度=不注入能量）；单步超过阈值的大位移
      // （姿势切换/跳跃）不中和，甩发的自然物理保留。
      const dy = _bonePos.y - j.prevBoneY;
      if (Math.abs(dy) < 0.05) {
        j.currTail.y += dy;
        j.prevTail.y += dy;
      }
      j.prevBoneY = _bonePos.y;
      // 惯性 + 刚度 + 重力。
      // 刚度是**朝 rest 目标点的比例趋近**（每步走剩余距离的 min(1, k·dt)），
      // 不是旧版"恒定速率 k·dt 朝 rest 方向"——恒速注入与位置无关，在平衡点
      // 两侧等幅翻转，永不衰减。比例趋近在平衡点注入趋零，静止真正收敛为静止；
      // 远离 rest 时时间常数 ≈1/k 秒，手感量级不变。
      _inertia.copy(j.currTail).sub(j.prevTail).multiplyScalar(1 - j.d);
      _to.copy(_bonePos).addScaledVector(_restDirWorld, j.boneLen); // rest 目标点（复用 _to 暂存）
      _next
        .copy(j.currTail)
        .add(_inertia)
        .addScaledVector(_to.sub(j.currTail), Math.min(1, j.k * d))
        .add(_from.set(0, -j.g * d * 0.1, 0));
      // 球形碰撞体：把尾端推出碰撞球面（先碰撞后归长，与 VRM SpringBone 次序一致）
      let hit = false;
      let deepest = 0;
      for (const c of this.colliders) {
        c.bone.getWorldPosition(_collCenter);
        if (c.offset) {
          c.bone.getWorldQuaternion(_collQuat);
          _collCenter.add(_collOff.copy(c.offset).applyQuaternion(_collQuat));
        }
        const dist = _next.distanceTo(_collCenter);
        if (dist < c.radius && dist > 1e-6) {
          _next.sub(_collCenter).multiplyScalar(c.radius / dist).add(_collCenter);
          // 记下穿得最深的那颗，下面按它的法线消速（多球同时接触时它最主导）
          if (c.radius - dist >= deepest) {
            deepest = c.radius - dist;
            hit = true;
            _hitCenter.copy(_collCenter);
          }
        }
      }
      // 归一化到骨长
      _next.sub(_bonePos).normalize().multiplyScalar(j.boneLen).add(_bonePos);
      // 平面碰撞：垂落的长发贴住桌面/地板（简单 y-clamp，穿模远比长度微差刺眼）
      let clamped = false;
      if (this.clampY) {
        const minY = this.clampY(_next);
        if (_next.y < minY) {
          _next.y = minY;
          clamped = true;
        }
      }
      j.prevTail.copy(j.currTail);
      j.currTail.copy(_next);
      // 接触吸附：位置被平面硬钳而 verlet 历史还带着下落速度，下一步惯性就成了
      // 反弹动量——贴桌发梢会逐帧弹跳不衰减。钳制帧把 y 速度清零（prev.y 对齐），
      // 水平惯性保留：发梢仍可沿桌面滑动，只是不再上下弹。胸部物理同款思路。
      if (clamped) j.prevTail.y = _next.y;
      // 球面接触消速：与上面平面钳制同一个道理，之前只修了平面。
      // 把尾端推出球面是**位置硬改**，而 verlet 的速度是 (curr-prev) 反推出来的——
      // 这段推出位移下一步原样变成朝外的惯性，弹开→重力/刚度拉回→再穿→再推，
      // 每步注入一次能量，成了不衰减的自持振荡（实测：贴着头/胸/胯球的后发、双马尾、
      // 侧发一直抖，离球远的猫尾/缎带/猫耳/短刘海全静止；加阻尼无效，因为注入量
      // 取决于穿透深度而不是速度）。这里只清掉沿法线的速度分量，切向保留——
      // 发梢仍能贴着球面滑动，只是不再被弹开。
      if (hit) {
        _hitN.copy(j.currTail).sub(_hitCenter);
        const len = _hitN.length();
        if (len > 1e-6) {
          _hitN.multiplyScalar(1 / len);
          _vel.copy(j.currTail).sub(j.prevTail);
          j.prevTail.addScaledVector(_hitN, _vel.dot(_hitN));
        }
      }
      // 方向差 → 骨局部旋转：local' = restQuat × rotate(restDir_local → targetDir_local)
      _from.copy(j.restChildPos).normalize();
      // 世界方向转到"父世界系+restQuat"局部：先去父旋转，再去 restQuat
      _to.copy(_next).sub(_bonePos).applyQuaternion(_parentQuat.invert());
      _to.applyQuaternion(_rot.copy(j.restQuat).invert()).normalize();
      bone.quaternion.copy(j.restQuat).multiply(_rot.setFromUnitVectors(_from, _to));
      j.lastQuat.copy(bone.quaternion);
      bone.updateMatrixWorld(false);
    }
  }
}
