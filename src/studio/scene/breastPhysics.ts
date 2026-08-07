// 胸部软体物理：把 Breast 骨链当弹簧质点模拟，并与外部实体（前臂/桌沿/对侧胸/躯干）
// 做碰撞推开——挤压/避让由物理解出，而不是逐帧手调旋转参数。
//
// 与 springBones 的差别：①rest 姿态每帧从当前骨骼读取（breastLift 先写"被托起"的
// 目标姿态，物理在其基础上做接触响应）②支持胶囊碰撞体（前臂/桌沿是长条）③左右胸
// 互为动态碰撞体（根除内侧重叠穿模）④高刚度低重力——胸是软而有形，不是果冻。
import * as THREE from "three";
import { FixedStepper } from "./fixedStep";

export type PhysCollider =
  | { kind: "sphere"; center: THREE.Vector3; radius: number }
  | { kind: "capsule"; a: THREE.Vector3; b: THREE.Vector3; radius: number };

interface BJoint {
  bone: THREE.Object3D;
  child: THREE.Object3D;
  restChildPos: THREE.Vector3;
  /** 根节标记 + rest 局部位置：被顶起时胸根随之上移（真实软组织不是钉死在胸壁上的） */
  isRoot: boolean;
  restPos: THREE.Vector3;
  /** 初始（站姿）时该节尾端到胸中线的横向距离——中缝保留的基准 */
  restLat: number;
  /** 平滑后的抬升量——直接用瞬时值会形成"顶开→根上移→碰撞变→再顶开"的无阻尼
   *  正反馈（用户实测：动画中及结束后胸持续抽动） */
  liftCur: number;
  /** 本帧 rest 姿态（由 breastLift 写入的目标）——必须先存再写回，否则下一帧把自己的
   *  输出当 rest 读，旋转会逐帧累积爆炸（实测胸尖被甩到桌沿下方 0.9） */
  restQuat: THREE.Quaternion;
  boneLen: number;
  radius: number; // 该节的"肉半径"（世界），碰撞按球算
  tail: THREE.Vector3;
  prevTail: THREE.Vector3;
  inited: boolean;
  side: 1 | -1; // +1=L / -1=R，用于左右互斥
}

const _bonePos = new THREE.Vector3();
const _parentQ = new THREE.Quaternion();
const _restDir = new THREE.Vector3();
const _next = new THREE.Vector3();
const _inertia = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _rot = new THREE.Quaternion();
const _closest = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _push = new THREE.Vector3();
/** 身体横轴（角色未 yaw，世界 X 即她的左右）——左右互斥只在这个方向上解 */
const _sideAxis = new THREE.Vector3(1, 0, 0);
const _free = new THREE.Vector3();
const _preSolve = new THREE.Vector3();
const _scaleTmp = new THREE.Vector3();
const _up = new THREE.Vector3();
const _upLocal = new THREE.Vector3();
const _centerA = new THREE.Vector3();
const _centerB = new THREE.Vector3();

function closestOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3) {
  _ab.copy(b).sub(a);
  _ap.copy(p).sub(a);
  const denom = _ab.lengthSq();
  const t = denom > 1e-9 ? Math.min(1, Math.max(0, _ap.dot(_ab) / denom)) : 0;
  return out.copy(a).addScaledVector(_ab, t);
}

export class BreastPhysics {
  private joints: BJoint[] = [];
  stiffness: number;
  drag: number;
  gravity: number;
  /** 被顶起时胸根跟着上移的比例（0=钉死在胸壁，0.3≈软组织自然跟随） */
  rootLift: number;
  /** 抬升上限（世界，锁骨下缘为界）+ 平滑速率（越小越黏，抑制自激） */
  rootLiftMax: number;
  rootLiftSmooth: number;
  /**
   * 中缝保留：两侧尾端与胸中线的横向距离 ≥ 站姿距离 × 此系数。
   * 弯腰托腮时前臂胶囊会把两团一起往中间挤——左右互斥只防"重叠"、不防"合拢"，
   * 胸口正中的门襟/扣子（权重在脊柱上，不随胸动）就被两团整条吞进沟里
   * （2026-08-07 用户实测）。0=关闭。
   */
  medialKeep: number;
  private rootL: THREE.Object3D | null = null;
  private rootR: THREE.Object3D | null = null;
  private lastRootLift = 0;

  /**
   * @param root 骨架场景
   * @param radii 每节肉半径（世界量纲，根→末），长度不足则复用最后一个
   */
  constructor(
    root: THREE.Object3D,
    opts?: {
      stiffness?: number;
      drag?: number;
      gravity?: number;
      radii?: number[];
      rootLift?: number;
      rootLiftMax?: number;
      rootLiftSmooth?: number;
      medialKeep?: number;
    },
  ) {
    this.stiffness = opts?.stiffness ?? 26;
    this.drag = opts?.drag ?? 0.55;
    this.gravity = opts?.gravity ?? 0.9;
    this.rootLift = opts?.rootLift ?? 0;
    this.rootLiftMax = opts?.rootLiftMax ?? 0.12;
    this.rootLiftSmooth = opts?.rootLiftSmooth ?? 3;
    this.medialKeep = opts?.medialKeep ?? 0.85;
    const radii = opts?.radii ?? [0.15, 0.12, 0.09];
    for (const side of [1, -1] as const) {
      const base = side === 1 ? "Breast_L" : "Breast_R";
      let idx = 0;
      let bone = root.getObjectByName(base);
      while (bone) {
        const child = bone.children.find((c) => (c as THREE.Bone).isBone);
        if (!child) break;
        if (idx === 0) {
          if (side === 1) this.rootL = bone;
          else this.rootR = bone;
        }
        this.joints.push({
          bone,
          child,
          restChildPos: child.position.clone(),
          restQuat: bone.quaternion.clone(),
          isRoot: idx === 0,
          restPos: bone.position.clone(),
          restLat: 0,
          liftCur: 0,
          boneLen: child.position.length() || 1e-4,
          radius: radii[Math.min(idx, radii.length - 1)],
          tail: new THREE.Vector3(),
          prevTail: new THREE.Vector3(),
          inited: false,
          side,
        });
        bone = child;
        idx++;
      }
    }
  }

  /** 胸中线的世界 X（两根骨中点）；单侧模型返回 null（约束自动失效） */
  private centerX(): number | null {
    if (!this.rootL || !this.rootR) return null;
    this.rootL.getWorldPosition(_centerA);
    this.rootR.getWorldPosition(_centerB);
    return (_centerA.x + _centerB.x) / 2;
  }

  get jointCount() {
    return this.joints.length;
  }

  /** 供左右互斥用：某侧末端球（世界） */
  private tipOf(side: 1 | -1): BJoint | null {
    let last: BJoint | null = null;
    for (const j of this.joints) if (j.side === side) last = j;
    return last;
  }

  /**
   * @param colliders 外部实体（前臂/桌沿/躯干），世界坐标，每帧由调用方刷新
   */
  /**
   * @param active 仅在接触段（breastLift 每帧写 rest）时驱动；false=复位物理状态并放行骨骼
   */
  /** 固定步长累加器：渲染 dt 在手势缩放/平移时会剧烈波动（1ms↔50ms），显式积分的
   *  弹簧对 dt 极敏感——同一姿势会因帧长忽长忽短而抖动、胸被拉扯变形。物理按固定
   *  1/60 步进、渲染帧只决定跑几步，操作镜头时就完全稳定 */
  private stepper = new FixedStepper();
  /** 静止吸附阈值（世界位移平方，1m≈2.52 单位）：0.0008/帧≈4.8cm/s，慢到看不出来 */
  private static readonly SLEEP_SQ = 0.0008 * 0.0008;

  update(dt: number, colliders: PhysCollider[], active = true) {
    if (!active) {
      // 只停驱动、不重置状态：重置会让下次激活时 tail 瞬移（过渡期反复跨阈值=抽动）
      for (const j of this.joints) {
        j.liftCur *= 0.9;
        if (this.rootLift > 0) {
          _upLocal.set(0, 1, 0).multiplyScalar(
            j.liftCur / (_scaleTmp.setFromMatrixScale((j.bone.parent as THREE.Object3D).matrixWorld).y || 1),
          );
          j.bone.position.copy(j.restPos).add(_upLocal);
        }
      }
      this.stepper.reset();
      return;
    }
    // 固定步长：累加真实 dt，按 1/60 整步消费（上限 3 步防卡顿后暴冲）
    const steps = this.stepper.take(dt);
    for (let i = 0; i < steps; i++) this.step(this.stepper.step, colliders, true);
    // 不足一步时仍要写一次骨骼（否则 breastLift 的 rest 会直接暴露），但**不推进物理**：
    // 高刷屏上大半帧凑不满 1/60，照跑一遍等于每隔一帧凭空施加一次惯性，正是"镜头一动
    // 模型就抖/变形"的其中一条来源
    if (steps === 0) this.step(0, colliders, false);
  }

  private step(d: number, colliders: PhysCollider[], integrate: boolean) {
    const cx = this.centerX(); // 本步的胸中线（世界 X），中缝保留的参照
    for (const j of this.joints) {
      const bone = j.bone;
      bone.getWorldPosition(_bonePos);
      // 先存 rest（此刻 bone.quaternion 是 breastLift 写入的目标姿态），再算再写回
      j.restQuat.copy(bone.quaternion);
      bone.parent!.getWorldQuaternion(_parentQ);
      _restDir.copy(j.restChildPos).applyQuaternion(j.restQuat).applyQuaternion(_parentQ).normalize();
      if (!j.inited) {
        j.inited = true;
        j.boneLen = j.child.getWorldPosition(_next).distanceTo(_bonePos) || j.boneLen;
        j.tail.copy(_bonePos).addScaledVector(_restDir, j.boneLen);
        j.prevTail.copy(j.tail);
        // 首帧是站姿（lean 钉第 1 帧）：此刻的横向距离就是"该有的中缝宽度"基准
        const cx = this.centerX();
        if (cx != null) j.restLat = Math.max(0, (j.tail.x - cx) * j.side);
      }
      // 惯性 + 向 rest 回弹 + 重力
      if (integrate) {
        _inertia.copy(j.tail).sub(j.prevTail).multiplyScalar(1 - this.drag);
        _next
          .copy(j.tail)
          .add(_inertia)
          .addScaledVector(_restDir, this.stiffness * d)
          // 重力与刚度同量纲（不像头发那样再乘 0.1）——胸要能被自重拉到臂上，
          // gravity/stiffness 之比就是"下垂 vs 回弹"的手感旋钮
          .add(_from.set(0, -this.gravity * d, 0));
      } else {
        _next.copy(j.tail); // 只重投影，不推进
      }

      // 先归长再取"自由位置"。此前 _free 拍在归长之前，而 stiffness*d 的径向增量
      // （20/60=0.333）高达骨长的 66%，会被归长整个吃掉——于是 raw 量到的主要是
      //"归长退回了多少"而不是"接触顶开了多少"，一个碰撞体都没碰到也会常驻一份抬升。
      _next.sub(_bonePos).normalize().multiplyScalar(j.boneLen).add(_bonePos);
      _free.copy(_next);
      _preSolve.copy(_next);
      // 接触求解：推开→归长→再推开（单次求解时归长会把推出的球又拉回穿透位；
      // 且大 dt 下单帧位移可超过碰撞半径，迭代能救回穿透）
      const opp = this.tipOf(j.side === 1 ? -1 : 1);
      for (let iter = 0; iter < 3; iter++) {
        for (const c of colliders) {
          if (c.kind === "sphere") _closest.copy(c.center);
          else closestOnSegment(_next, c.a, c.b, _closest);
          const minD = c.radius + j.radius;
          _push.copy(_next).sub(_closest);
          const dist = _push.length();
          if (dist < minD && dist > 1e-6)
            _next.copy(_closest).addScaledVector(_push.divideScalar(dist), minD);
        }
        // 左右互斥：只沿身体横轴分离——用任意方向推会把一侧顶到另一侧的上方
        // （用户实测"左胸滑到右胸上"），横向约束保证两团只会左右让开
        if (opp && opp.inited && opp !== j) {
          const minD = j.radius + opp.radius;
          _push.copy(_next).sub(opp.tail);
          _push.projectOnVector(_sideAxis); // 仅保留横向分量
          const dist = _push.length();
          const wantSign = j.side; // L 向 +x、R 向 -x，绝不越过中线
          if (dist < minD) {
            _push.copy(_sideAxis).multiplyScalar(wantSign * (minD - dist) * 0.5);
            _next.add(_push);
          }
        }
        // 中缝保留：互斥只防"重叠"，防不了两团被前臂一起挤向中线"合拢"——
        // 弯腰托腮时胸口门襟/扣子（权重在脊柱，不随胸动）就被整条吞进沟里。
        // 各侧尾端到中线的横距不得小于站姿的 medialKeep 倍，给中缝衣物留出位置。
        if (this.medialKeep > 0 && j.restLat > 0 && cx != null) {
          const minLat = j.restLat * this.medialKeep;
          if ((_next.x - cx) * j.side < minLat) _next.x = cx + j.side * minLat;
        }
        // 归一化到骨长（角度约束）——再进入下一轮推开
        _next.sub(_bonePos).normalize().multiplyScalar(j.boneLen).add(_bonePos);
      }
      // 接触耗散：推开量原样计入速度会在下一帧被惯性带回去，形成不衰减的极限环
      //（实测静置后仍有 ~0.005/帧的持续抖动，就是用户说的"胸部一直在抽动"）。
      // 真实软组织撞上硬物是非弹性的——本帧发生了接触就把动量吃掉大半。
      const corrected = _next.distanceToSquared(_preSolve) > 1e-10;
      // 静止吸附：位移小到看不见就直接归零，彻底断掉残余环流
      if (!integrate) {
        // 未推进的帧一律不动状态量——碰上它就把速度清零会在高刷屏上把弹性全抹掉
        _next.copy(j.tail);
      } else if (_next.distanceToSquared(j.tail) < BreastPhysics.SLEEP_SQ) {
        _next.copy(j.tail); // 下面的旋转写回也用冻结位，否则照样每帧微动
        j.prevTail.copy(j.tail);
      } else {
        j.prevTail.copy(j.tail);
        if (corrected) j.prevTail.lerp(_next, 0.85);
        j.tail.copy(_next);
      }
      // 胸根跟随抬升：被顶开的向上分量→根骨沿躯干上移（真实软组织根部不钉死）。
      // 必须**平滑+限幅**：瞬时值会正反馈自激（抽动），无上限会窜到锁骨以上
      if (this.rootLift > 0) {
        _up.set(0, 1, 0).applyQuaternion(_parentQ);
        if (j.isRoot) {
          const raw = Math.max(0, _next.dot(_up) - _free.dot(_up)) * this.rootLift;
          const target = Math.min(this.rootLiftMax, raw);
          // 死区：胸根上移会改变碰撞、碰撞又改变上移量，低通之后仍会剩一个慢速极限环。
          // 目标变化小于阈值就干脆不动，环路才真正断开。
          if (Math.abs(target - j.liftCur) > 0.0015)
            j.liftCur += (target - j.liftCur) * Math.min(1, d * this.rootLiftSmooth);
          this.lastRootLift = j.liftCur;
        } else {
          // 二节按半量跟随：根骨独走会在胸根与胸壁间折出 90° 直角，
          // 分摊到下一节才有软组织的弧线过渡
          j.liftCur += (this.lastRootLift * 0.85 - j.liftCur) * Math.min(1, d * this.rootLiftSmooth);
        }
        // liftCur 是**世界**量纲（由世界坐标点积得出），写进 bone.position 却是父骨的
        // 局部系——必须除父骨的**世界**缩放。原来只除了 parent.scale.y（局部），整模型
        // 的 scale 3.35 完全没被除掉，抬升实际放大 3.35 倍：胸根被平移到超过自身骨长，
        // 锁骨到胸之间的皮肤被拉成锥形（用户看到的"扭曲"而非"抖动"）。
        const pScale = _scaleTmp.setFromMatrixScale((j.bone.parent as THREE.Object3D).matrixWorld).y || 1;
        _upLocal.set(0, 1, 0).multiplyScalar(j.liftCur / pScale);
        j.bone.position.copy(j.restPos).add(_upLocal);
      }
      _from.copy(j.restChildPos).normalize();
      _to.copy(_next).sub(_bonePos).applyQuaternion(_parentQ.invert());
      _to.applyQuaternion(_rot.copy(j.restQuat).invert()).normalize();
      bone.quaternion.copy(j.restQuat).multiply(_rot.setFromUnitVectors(_from, _to));
      bone.updateMatrixWorld(false);
    }
  }
}
