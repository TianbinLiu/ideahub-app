// MMD 刚体体系（极致画质档）：Bullet（ammo.js，MMD 本尊同款物理引擎）驱动发链——
// 每段胶囊刚体（质量/阻尼/摩擦）+ 相邻段 6DOF 弹簧约束（摆动/扭转限位 + 回弹到 rest）
// + 链根运动学锚点跟随动画骨 + 头/胸/髋运动学球碰撞体。真实惯性/碰撞/相互作用，
// 对应 MMD 的「剛体+ジョイント」结构；低/均衡档回退轻量弹簧骨（springBones.ts）。
//
// 骨骼回写与弹簧骨同路：刚体只决定"段朝向"，骨局部位置保持 rest（父链旋转带动即可），
// 链不会散架——段间由约束锁平移、根由锚点锁在动画骨上。
import * as THREE from "three";
import type AmmoT from "ammojs-typed";
import type { SphereCollider } from "./springBones";

type AmmoAPI = typeof AmmoT extends (...a: never[]) => Promise<infer R> ? R : never;

interface Segment {
  bone: THREE.Object3D;
  child: THREE.Object3D;
  restQuat: THREE.Quaternion;
  restChildPos: THREE.Vector3;
  body: AmmoT.btRigidBody;
  halfLen: number;
}

interface Kinematic {
  bone: THREE.Object3D;
  body: AmmoT.btRigidBody;
  offset?: THREE.Vector3;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);

// 碰撞组：发段互不相撞（防高频抖动），只与身体碰撞体互撞
const G_HAIR = 2;
const G_BODY = 4;

let ammoPromise: Promise<AmmoAPI> | null = null;
function loadAmmo(): Promise<AmmoAPI> {
  // 懒加载：仅极致档触发，独立 chunk（asm.js ~1.7MB）
  ammoPromise ??= import("ammojs-typed").then((m) => m.default());
  return ammoPromise;
}

export class RigidBoneSim {
  private A: AmmoAPI;
  private world: AmmoT.btDiscreteDynamicsWorld;
  private segments: Segment[] = [];
  private kinematics: Kinematic[] = [];
  private disposables: unknown[] = [];
  private tmpTrans: AmmoT.btTransform;
  private tmpVec: AmmoT.btVector3;
  private tmpQuat: AmmoT.btQuaternion;
  private inited = false;
  private root: THREE.Object3D;
  private prefixes: string[];
  private colliders: SphereCollider[];
  jointCount = 0;
  /** 静止位穿透碰撞球被排除碰撞的段数（前发/领结等贴身链——碰撞会与回位弹簧打架致抽搐） */
  excludedCount = 0;

  constructor(A: AmmoAPI, root: THREE.Object3D, prefixes: string[], colliders: SphereCollider[]) {
    this.A = A;
    this.root = root;
    this.prefixes = prefixes;
    this.colliders = colliders;
    const cfg = new A.btDefaultCollisionConfiguration();
    const dispatcher = new A.btCollisionDispatcher(cfg);
    const broadphase = new A.btDbvtBroadphase();
    const solver = new A.btSequentialImpulseConstraintSolver();
    this.world = new A.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, cfg);
    // 世界量纲 ≈3.35 单位/米；发丝质量极小，重力压低些防"垂死板"
    this.world.setGravity(new A.btVector3(0, -20, 0));
    this.tmpTrans = new A.btTransform();
    this.tmpVec = new A.btVector3(0, 0, 0);
    this.tmpQuat = new A.btQuaternion(0, 0, 0, 1);
    this.disposables.push(cfg, dispatcher, broadphase, solver);
  }

  /** 骨架世界矩阵就绪后（首帧 update 时）才建刚体——与弹簧骨 boneLen 同一时序陷阱 */
  private buildOnce() {
    if (this.inited) return;
    this.inited = true;
    const A = this.A;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const pats = this.prefixes.map(norm);
    // 收集链：匹配前缀且父骨不匹配的=链根，沿第一个骨骼子节点向下走
    const roots: THREE.Object3D[] = [];
    this.root.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      const n = norm(o.name);
      if (!pats.some((p) => n.includes(p))) return;
      const pn = o.parent ? norm(o.parent.name) : "";
      if (!pats.some((p) => pn.includes(p))) roots.push(o);
    });

    const mkTransform = (pos: THREE.Vector3, quat: THREE.Quaternion) => {
      const t = new A.btTransform();
      t.setIdentity();
      t.setOrigin(new A.btVector3(pos.x, pos.y, pos.z));
      t.setRotation(new A.btQuaternion(quat.x, quat.y, quat.z, quat.w));
      return t;
    };
    const mkKinematic = (shape: AmmoT.btCollisionShape, pos: THREE.Vector3, quat: THREE.Quaternion) => {
      const ms = new A.btDefaultMotionState(mkTransform(pos, quat));
      const body = new A.btRigidBody(new A.btRigidBodyConstructionInfo(0, ms, shape, new A.btVector3(0, 0, 0)));
      body.setCollisionFlags(body.getCollisionFlags() | 2); // CF_KINEMATIC_OBJECT
      body.setActivationState(4); // DISABLE_DEACTIVATION
      return body;
    };

    // 身体碰撞体（运动学球，随骨每帧更新）
    for (const c of this.colliders) {
      c.bone.getWorldPosition(_v1);
      c.bone.getWorldQuaternion(_q1);
      if (c.offset) _v1.add(_v2.copy(c.offset).applyQuaternion(_q1));
      const body = mkKinematic(new A.btSphereShape(c.radius), _v1, _q1);
      this.world.addRigidBody(body, G_BODY, G_HAIR);
      this.kinematics.push({ bone: c.bone, body, offset: c.offset });
    }

    for (const chainRoot of roots) {
      // 链根锚点：挂在链根的父骨上（运动学，把整条链钉进动画骨架）
      const parent = chainRoot.parent!;
      parent.getWorldPosition(_v1);
      parent.getWorldQuaternion(_q1);
      const anchor = mkKinematic(new A.btSphereShape(0.01), _v1, _q1);
      this.world.addRigidBody(anchor, G_BODY, 0); // 锚点不参与碰撞
      this.kinematics.push({ bone: parent, body: anchor });

      let prevBody = anchor;
      let bone: THREE.Object3D | undefined = chainRoot;
      let idx = 0;
      while (bone) {
        const child: THREE.Object3D | undefined = bone.children.find((c) => (c as THREE.Bone).isBone);
        if (!child) break;
        bone.getWorldPosition(_v1);
        child.getWorldPosition(_v2);
        const len = _v1.distanceTo(_v2);
        if (len < 1e-5) break;
        const dir = _v2.clone().sub(_v1).normalize();
        const bodyQuat = _q1.setFromUnitVectors(_yAxis, dir).clone();
        const mid = _v1.clone().addScaledVector(dir, len / 2);
        const radius = Math.max(0.02, len * 0.16);
        const shape = new A.btCapsuleShape(radius, Math.max(0.01, len - radius * 2));
        // 质量别太小：0.06 配刚度 9 的固有频率 ~34Hz 超过 60fps 采样=数值震颤（抽搐根因之一）
        const mass = 0.14 * (1 - Math.min(0.5, idx * 0.08)); // 末端渐轻
        const inertia = new A.btVector3(0, 0, 0);
        shape.calculateLocalInertia(mass, inertia);
        const ms = new A.btDefaultMotionState(mkTransform(mid, bodyQuat));
        const body = new A.btRigidBody(new A.btRigidBodyConstructionInfo(mass, ms, shape, inertia));
        body.setDamping(0.55, 0.94); // MMD 髪的典型高角阻尼手感
        body.setActivationState(4);
        body.setFriction(0.4);
        // 静止位穿透检测：贴身链（前发贴脸/领结贴胸/牛耳贴头）的 rest 就在碰撞球内——
        // 参与碰撞=回位弹簧与推挤每帧打架、永不收敛（"一直抽搐扭动"根因）；这类段免碰撞
        let penetrates = false;
        for (const c of this.colliders) {
          c.bone.getWorldPosition(_v1);
          c.bone.getWorldQuaternion(_q2);
          if (c.offset) _v1.add(_v3.copy(c.offset).applyQuaternion(_q2));
          if (mid.distanceTo(_v1) < c.radius + radius + 0.02) {
            penetrates = true;
            break;
          }
        }
        if (penetrates) this.excludedCount++;
        this.world.addRigidBody(body, G_HAIR, penetrates ? 0 : G_BODY);
        bone.getWorldPosition(_v1); // 穿透检测覆写了 _v1，恢复关节点位置供下方约束帧使用

        // 6DOF 弹簧约束：关节点=本段骨头端；平移全锁、摆动/扭转限位+弹簧回 rest
        const jointWorld = mkTransform(_v1, bodyQuat);
        prevBody.getMotionState().getWorldTransform(this.tmpTrans);
        const frameInA = this.tmpTrans.inverse().op_mul(jointWorld);
        body.getMotionState().getWorldTransform(this.tmpTrans);
        const frameInB = this.tmpTrans.inverse().op_mul(jointWorld);
        const cons = new A.btGeneric6DofSpringConstraint(prevBody, body, frameInA, frameInB, true);
        const lin = new A.btVector3(0, 0, 0);
        cons.setLinearLowerLimit(lin);
        cons.setLinearUpperLimit(lin);
        cons.setAngularLowerLimit(new A.btVector3(-0.9, -0.35, -0.9));
        cons.setAngularUpperLimit(new A.btVector3(0.9, 0.35, 0.9));
        // MMD 髪的关节弹簧本就很弱（常为 0，回位主要靠重力+限位）——刚度压低+阻尼拉高
        // 防高频震颤；回位由重力/锚点/限位共同完成
        for (const axis of [3, 4, 5]) {
          cons.enableSpring(axis, true);
          cons.setStiffness(axis, 2.5);
          cons.setDamping(axis, 0.9);
        }
        cons.setEquilibriumPoint(); // rest 姿态=平衡点（回弹目标）
        this.world.addConstraint(cons, true); // 相邻段免碰撞
        this.disposables.push(cons, jointWorld, frameInA, frameInB);

        this.segments.push({
          bone,
          child,
          restQuat: bone.quaternion.clone(),
          restChildPos: child.position.clone(),
          body,
          halfLen: len / 2,
        });
        prevBody = body;
        bone = child;
        idx++;
      }
    }
    this.jointCount = this.segments.length;
  }

  update(dt: number) {
    this.buildOnce();
    // 运动学体跟随动画骨（锚点+碰撞球）；临时对象复用——每帧 new Ammo 对象=堆泄漏
    for (const k of this.kinematics) {
      k.bone.getWorldPosition(_v1);
      k.bone.getWorldQuaternion(_q1);
      if (k.offset) _v1.add(_v2.copy(k.offset).applyQuaternion(_q1));
      this.tmpTrans.setIdentity();
      this.tmpVec.setValue(_v1.x, _v1.y, _v1.z);
      this.tmpTrans.setOrigin(this.tmpVec);
      this.tmpQuat.setValue(_q1.x, _q1.y, _q1.z, _q1.w);
      this.tmpTrans.setRotation(this.tmpQuat);
      k.body.getMotionState().setWorldTransform(this.tmpTrans);
      k.body.setWorldTransform(this.tmpTrans);
    }
    // 1/120 细分步：碰撞接触在粗步长下会过冲-回弹（微抖）
    this.world.stepSimulation(Math.min(dt, 0.05), 8, 1 / 120);
    // 微动扑灭：Bullet 6DOF 弹簧阻尼是显式积分，小质量链会维持不衰减的微振荡极限环
    // （实测领结链 ~0.2°/帧永不收敛=肉眼"抽搐"）——低于阈值的速度直接清零，真实摆动不受影响
    for (const s of this.segments) {
      const av = s.body.getAngularVelocity();
      const lv = s.body.getLinearVelocity();
      if (
        av.x() * av.x() + av.y() * av.y() + av.z() * av.z() < 0.09 &&
        lv.x() * lv.x() + lv.y() * lv.y() + lv.z() * lv.z() < 0.009
      ) {
        this.tmpVec.setValue(0, 0, 0);
        s.body.setAngularVelocity(this.tmpVec);
        s.body.setLinearVelocity(this.tmpVec);
      }
    }
    // 回写：刚体朝向（+Y=段方向）→ 骨局部旋转（与弹簧骨同一套方向差数学）
    for (const s of this.segments) {
      s.body.getMotionState().getWorldTransform(this.tmpTrans);
      const r = this.tmpTrans.getRotation();
      _q2.set(r.x(), r.y(), r.z(), r.w());
      _v2.copy(_yAxis).applyQuaternion(_q2); // 段世界方向
      s.bone.parent!.getWorldQuaternion(_q1);
      _v1.copy(s.restChildPos).normalize(); // rest 局部方向
      _v2.applyQuaternion(_q1.invert()).applyQuaternion(_q2.copy(s.restQuat).invert()).normalize();
      s.bone.quaternion.copy(s.restQuat).multiply(_q1.setFromUnitVectors(_v1, _v2));
      s.bone.updateMatrixWorld(false);
    }
  }

  dispose() {
    const A = this.A;
    try {
      for (const s of this.segments) this.world.removeRigidBody(s.body);
      for (const k of this.kinematics) this.world.removeRigidBody(k.body);
      A.destroy(this.world);
      for (const d of this.disposables) A.destroy(d as never);
    } catch {
      /* ammo 清理尽力而为 */
    }
  }
}

/** 极致画质档入口：懒加载 Bullet，失败由调用方回退弹簧骨 */
export async function createRigidBoneSim(
  root: THREE.Object3D,
  prefixes: string[],
  colliders: SphereCollider[],
): Promise<RigidBoneSim> {
  const A = await loadAmmo();
  return new RigidBoneSim(A, root, prefixes, colliders);
}
