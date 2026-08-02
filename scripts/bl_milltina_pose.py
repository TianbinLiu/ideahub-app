# Milltina 姿势/动画烘焙：垂臂站姿(f1) → 前倾托腮(lean 55f) + 发牌(deal)。
# 手工模型：不做减面/权重修补/形键雕刻（画师的权重比我们的 hack 好）。
# 轴向实测（bl_milltina_probe）：hips/spine +x=前倾；neck/head -x=抬头；head -z=歪向她左；
# 臂 +x=举高；坐标系：上=+z、脸=-y、她左=+x。matrix 回写关键帧（欧拉直设导出参考系会错乱）。
import bpy
from mathutils import Vector

SRC = r"C:/Users/tliu7/ideahub/app/assets-private/milltina-rigged.glb"
DST = r"C:/Users/tliu7/ideahub/app/assets-private/milltina-anim.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
arm_obj = next(o for o in bpy.data.objects if o.type == "ARMATURE")
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.mode_set(mode="POSE")
pb = arm_obj.pose.bones
mw = arm_obj.matrix_world

CHAIN = ["mixamorig:LeftArm", "mixamorig:LeftForeArm", "mixamorig:LeftHand"]
RCHAIN = ["mixamorig:RightArm", "mixamorig:RightForeArm", "mixamorig:RightHand"]
LEGS = ["mixamorig:LeftUpLeg", "mixamorig:RightUpLeg"]
TORSO = ["mixamorig:Hips", "mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Neck", "mixamorig:Head"] + LEGS
ORDER = TORSO + CHAIN + RCHAIN
lh = pb["mixamorig:LeftHand"]
rh = pb["mixamorig:RightHand"]
for n in ORDER:
    pb[n].rotation_mode = "XYZ"


def head_pos():
    bpy.context.view_layer.update()
    return mw @ pb["mixamorig:Head"].head


def set_torso(vals):
    for nm, e in vals.items():
        pb[nm].rotation_euler = e
    bpy.context.view_layer.update()


def set_arms_down():
    """先垂臂作为解算初值（从 T-pose 直接解交叉手会跳扭转盆地）"""
    pb["mixamorig:LeftArm"].rotation_euler = (-1.2, 0, 0.10)
    pb["mixamorig:LeftForeArm"].rotation_euler = (0, 0, 0)
    pb["mixamorig:LeftHand"].rotation_euler = (0, 0, 0)
    pb["mixamorig:RightArm"].rotation_euler = (-1.2, 0, -0.10)
    pb["mixamorig:RightForeArm"].rotation_euler = (0, 0, 0)
    pb["mixamorig:RightHand"].rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()


def solve_arm(tip, chain_names, world_target, elbow_hint=None, prev_sol=None):
    """坐标下降腕位求解 + 肘部锚点 + 帧间连续性限步（防扭转盆地跳变）"""
    bones = [pb[n] for n in chain_names[:2]]
    tv = Vector(world_target)
    ev = Vector(elbow_hint) if elbow_hint is not None else None
    elbow = pb[chain_names[1]]

    def score():
        bpy.context.view_layer.update()
        s = ((mw @ tip.head) - tv).length
        if ev is not None:
            s += 0.6 * ((mw @ elbow.head) - ev).length
        return s

    cur = score()
    s = 0.4
    while s >= 0.02:
        improved = False
        for bi, b in enumerate(bones):
            for ax in range(3):
                for sign in (1.0, -1.0):
                    old = b.rotation_euler[:]
                    e = list(old)
                    e[ax] += sign * s
                    if prev_sol is not None and abs(e[ax] - prev_sol[bi][ax]) > 0.9:
                        continue
                    b.rotation_euler = e
                    d = score()
                    if d < cur - 1e-5:
                        cur = d
                        improved = True
                    else:
                        b.rotation_euler = old
        if not improved:
            s *= 0.55
    return cur, [list(b.rotation_euler) for b in bones]


def palm_local(hand_name, mesh_name="Milltina_body"):
    """量一次：手骨局部系下的掌心点+掌面法向（rest 顶点×骨 rest 矩阵逆——姿势无关）"""
    ob = bpy.data.objects.get(mesh_name)
    bone = arm_obj.data.bones[hand_name]
    gi = ob.vertex_groups[hand_name].index
    inv = bone.matrix_local.inverted()
    pts = []
    for v in ob.data.vertices:
        for g in v.groups:
            if g.group == gi and g.weight > 0.6:
                pts.append(inv @ (ob.matrix_world @ v.co))
                break
    if len(pts) < 8:
        return None, None
    c = sum(pts, Vector()) / len(pts)
    # 掌面法向 = 协方差最小主轴（幂迭代求最大轴两次去除，剩余轴即最小）
    import mathutils
    cov = mathutils.Matrix(((0, 0, 0), (0, 0, 0), (0, 0, 0)))
    for q in pts:
        d = q - c
        for i in range(3):
            for j in range(3):
                cov[i][j] += d[i] * d[j]
    axes = []
    for _ in range(2):
        v = Vector((0.3, 0.5, 0.81))
        for _ in range(40):
            v = (cov @ v)
            for a in axes:
                v -= a * v.dot(a)
            if v.length < 1e-9:
                v = Vector((0.7, 0.2, 0.68))
            v.normalize()
        axes.append(v)
    n = axes[0].cross(axes[1]).normalized()
    return c, n


def seg_closest(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return a + ab * t


PALM_CACHE = {}


def fit_palm(hand_name, opp_elbow, opp_wrist, R=0.030, breast=None, RB=0.105):
    """转手骨让掌面贴上对侧前臂（主）+ 掌内侧靠住同侧胸外缘（次）"""
    if hand_name not in PALM_CACHE:
        PALM_CACHE[hand_name] = palm_local(hand_name)
    cLoc, nLoc = PALM_CACHE[hand_name]
    if cLoc is None:
        return
    hb = pb[hand_name]
    hb.rotation_mode = "XYZ"

    def cost():
        bpy.context.view_layer.update()
        m = mw @ hb.matrix
        p = m @ cLoc
        n = (m.to_3x3() @ nLoc).normalized()
        a = mw @ pb[opp_elbow].head
        b = mw @ pb[opp_wrist].head
        q = seg_closest(p, a, b)
        d = (q - p).length
        align = 1.0 - n.dot((q - p).normalized()) if d > 1e-6 else 2.0
        cost = (d - R) ** 2 * 400 + align * 0.6
        if breast is not None and breast in pb:
            # 目标=胸根沿身体横轴外移的"胸外缘"点：直接用胸根会把手拉进胸正下方被遮住
            side = 1.0 if breast.endswith("_L") else -1.0
            bp_ = (mw @ pb[breast].head) + Vector((side * 0.055, 0, 0))
            db = (bp_ - p).length
            cost += (db - RB) ** 2 * 70   # 权重低于前臂：只做靠拢不主导
        return cost

    base = list(hb.rotation_euler)
    cur = cost()
    step = 0.5
    while step >= 0.02:
        improved = False
        for ax in range(3):
            for sign in (1.0, -1.0):
                old = hb.rotation_euler[:]
                e = list(old)
                e[ax] += sign * step
                if abs(e[ax] - base[ax]) > 1.3:
                    continue
                hb.rotation_euler = e
                c2 = cost()
                if c2 < cur - 1e-6:
                    cur = c2
                    improved = True
                else:
                    hb.rotation_euler = old
        if not improved:
            step *= 0.55
    bpy.context.view_layer.update()
    m = mw @ hb.matrix
    p = m @ cLoc
    q = seg_closest(p, mw @ pb[opp_elbow].head, mw @ pb[opp_wrist].head)
    print(f"    PALM {hand_name} gap={(q - p).length:.3f} cost={cur:.3f}")


def key_pose(frame):
    """visual matrix 回写（父先子后）再 keyframe——唯一被验证导出参考系正确的路径"""
    bpy.context.view_layer.update()
    mats = {n: pb[n].matrix.copy() for n in ORDER}
    bpy.context.scene.frame_set(frame)
    for n in ORDER:
        pb[n].matrix = mats[n]
        bpy.context.view_layer.update()
    for n in ORDER:
        b = pb[n]
        b.keyframe_insert(
            data_path="rotation_quaternion" if b.rotation_mode == "QUATERNION" else "rotation_euler",
            frame=frame,
        )


if arm_obj.animation_data is None:
    arm_obj.animation_data_create()

# ── lean：站姿(交叉抱手) → 撤步弯腰伏桌（用户定稿 v7：后退两步→边弯腰边翘臀
# （髋前倾+大腿反向补偿保持腿立、臀后翘）→胸压桌沿→头垂靠向胸、全身重量压胸+
# 桌沿；右手伏右胸、左手撑脸），85f@24fps ──
# 手部目标=锚定骨相对偏移（head/Breast_R/spine1）：伏own胸/撑own脸是身体相对
# 手势，弯多深都跟随；落沿位置全交给引擎滑移曲线（撤步 back + 落沿 z 可 DEV 调）
act = bpy.data.actions.new("lean")
arm_obj.animation_data.action = act
ZERO = {n: (0, 0, 0) for n in TORSO}
STAND_L = ((0.025, -0.115, 0.615), (0.095, -0.045, 0.72))  # 左腕(前叠)/左肘
STAND_R = ((-0.02, -0.105, 0.60), (-0.095, -0.045, 0.72))  # 右腕/右肘


def resolve_target(spec):
    """绝对元组 或 ("head"|"s1"|"bR", (dx,dy,dz)) 锚定骨相对偏移（须在 set_torso 后调）"""
    if spec is None:
        return None
    if isinstance(spec[0], str):
        kind, off = spec
        bone_name = {"head": "mixamorig:Head", "s1": "mixamorig:Spine1", "bR": "Breast_R"}[kind]
        bpy.context.view_layer.update()
        return (mw @ pb[bone_name].head) + Vector(off)
    return Vector(spec)
def T(hips, spine, sp1, neck, head, legL, legR, headZ=0.0):
    """躯干+双腿：hips 前倾配大腿反向补偿=腿保持站立、臀部后翘（人体弯腰铰链）"""
    return {
        "mixamorig:Hips": (hips, 0, 0), "mixamorig:Spine": (spine, 0, 0),
        "mixamorig:Spine1": (sp1, 0, 0), "mixamorig:Neck": (neck, 0, 0),
        "mixamorig:Head": (head, 0, headZ),
        "mixamorig:LeftUpLeg": (legL, 0, 0), "mixamorig:RightUpLeg": (legR, 0, 0),
    }


# (frame, torso, 左腕spec, 左肘hint偏移, 右腕spec, 右肘hint偏移)
# 腕 spec=锚定骨相对偏移（伏own胸/撑own脸是身体相对手势，弯多深都跟随）；
# 站姿帧沿用绝对坐标+绝对肘 hint（旧格式）
ELB_L = (0.095, -0.035, -0.14)
ELB_R = (-0.085, -0.035, -0.10)
FRAMES = [
    # 撤步期：交叉抱手不变，右腿→左腿各向后摆一步（腿在吧台后，读作重心节奏）
    (1, ZERO, STAND_L[0], STAND_L[1], STAND_R[0], STAND_R[1]),
    (10, T(0.07, 0.03, 0.02, -0.02, 0.02, -0.07, -0.30), STAND_L[0], STAND_L[1], STAND_R[0], STAND_R[1]),
    (20, T(0.16, 0.09, 0.05, -0.05, -0.02, -0.34, -0.18), STAND_L[0], STAND_L[1], STAND_R[0], STAND_R[1]),
    # 弯腰期：髋主导前倾+大腿持续反补（翘臀），手沿身侧外弧上行
    (30, T(0.20, 0.11, 0.07, -0.05, 0.0, -0.20, -0.20),
     (0.02, -0.165, 0.67), (0.12, -0.10, 0.70), (-0.03, -0.155, 0.66), (-0.13, -0.09, 0.69)),
    (44, T(0.33, 0.18, 0.115, -0.05, -0.09, -0.33, -0.33),
     (-0.02, -0.19, 0.73), (0.13, -0.15, 0.745), (0.01, -0.18, 0.73), (-0.14, -0.14, 0.74)),
    # 落沿期：双臂**左右镜像对称**横放桌沿（同 z 高度、右臂 y 前错 0.025 避互穿）——
    # 一高一低的叠臂必然把两胸托到不同高度（用户实测左胸偏高）；
    # 胸压在交叠手臂上、头颊侧倾向下贴靠胸口（闭目小憩感；注视系统偶尔抬眼保互动）
    # Q 版矮个+吧台高：总弯角封顶 ~44°，更深整个人趴平吧台（61° 版实测翻车）
    # 头=上目线（颈/头上抬看镜头+轻歪头）：低头/纯侧倾两版玩家机位都只见帽顶——
    # 参考图的"闭目贴胸脸"是侧视美术，游戏正面机位必须脸朝镜头
    (58, T(0.265, 0.295, 0.185, -0.13, -0.19, -0.26, -0.26, -0.03),
     (-0.045, -0.188, 0.716), (0.124, -0.142, 0.734), (0.045, -0.213, 0.716), (-0.124, -0.167, 0.734)),
    (72, T(0.285, 0.31, 0.20, -0.17, -0.25, -0.28, -0.28, -0.05),
     (-0.045, -0.190, 0.716), (0.125, -0.140, 0.734), (0.045, -0.215, 0.716), (-0.125, -0.165, 0.734)),
    # 定格微回（呼吸落位）；髋弯份额下调防后腰衣裙分离露缝
    (85, T(0.28, 0.305, 0.195, -0.16, -0.24, -0.275, -0.275, -0.05),
     (-0.045, -0.190, 0.716), (0.125, -0.140, 0.734), (0.045, -0.215, 0.716), (-0.125, -0.165, 0.734)),
]
LAST_F = FRAMES[-1][0]
prevL = None
prevR = None
dealL = None
for fr, torso, l_spec, l_eb, r_spec, r_eb in FRAMES:
    set_torso(torso)
    if fr == 1:
        set_arms_down()
    anchored_l = isinstance(l_spec[0], str)
    anchored_r = isinstance(r_spec[0], str)
    l_abs = resolve_target(l_spec)
    r_abs = resolve_target(r_spec)
    if l_abs is not None:
        l_hint = (l_abs + Vector(l_eb)) if anchored_l else Vector(l_eb)
        dl, prevL = solve_arm(lh, CHAIN, l_abs, elbow_hint=l_hint, prev_sol=prevL)
        print(f"  f{fr} L residual {dl:.3f}")
    if r_abs is not None:
        r_hint = (r_abs + Vector(r_eb)) if anchored_r else Vector(r_eb)
        dr, prevR = solve_arm(rh, RCHAIN, r_abs, elbow_hint=r_hint, prev_sol=prevR)
        print(f"  f{fr} R residual {dr:.3f}")
    # 落沿帧：掌面几何拟合——solver 只管腕位，掌朝向必须让掌面真正贴上对侧前臂
    if fr >= 44:
        lh.rotation_euler = (0.2, 0, 0)
        rh.rotation_euler = (0.2, 0, 0)
        bpy.context.view_layer.update()
        if fr >= 58:
            # 掌面同时贴对侧前臂与同侧胸外缘（用户："手掌内侧可以贴着胸部外侧"）——
            # 双目标加权：前臂给接触面、胸给内侧贴合方向
            fit_palm("mixamorig:LeftHand", RCHAIN[1], RCHAIN[2], breast="Breast_L")
            fit_palm("mixamorig:RightHand", CHAIN[1], CHAIN[2], breast="Breast_R")
        bpy.context.view_layer.update()
    key_pose(fr)
    if fr == LAST_F:
        dealL = [list(pb[CHAIN[0]].rotation_euler), list(pb[CHAIN[1]].rotation_euler)]
        print(f"LEAN f{fr} head:", [round(v, 3) for v in head_pos()])
        print(f"LEAN f{fr} lhand:", [round(v, 3) for v in (mw @ lh.head)],
              "lElbow:", [round(v, 3) for v in (mw @ pb[CHAIN[1]].head)])
        print(f"LEAN f{fr} rhand:", [round(v, 3) for v in (mw @ rh.head)],
              "rElbow:", [round(v, 3) for v in (mw @ pb[RCHAIN[1]].head)])
tr = arm_obj.animation_data.nla_tracks.new()
tr.name = "lean"
tr.strips.new("lean", 1, act)
arm_obj.animation_data.action = None
print("ANIM lean baked")

# ── deal：从托腮位向前递牌再收回（基于 lean 定格姿势接续解算，保证连贯）──
act2 = bpy.data.actions.new("deal")
arm_obj.animation_data.action = act2
set_torso(FRAMES[-1][1])
pb[CHAIN[0]].rotation_euler = dealL[0]
pb[CHAIN[1]].rotation_euler = dealL[1]
bpy.context.view_layer.update()
key_pose(1)
prevD = dealL
# 发牌目标改锚定头骨（新姿势头位深垂，绝对坐标会失配）：向前上方递出
for fr, tgt in [(6, ("head", (0.03, -0.17, 0.02))), (9, ("head", (0.04, -0.20, 0.01))), (15, None)]:
    if tgt is not None:
        dd, prevD = solve_arm(lh, CHAIN, resolve_target(tgt), prev_sol=prevD)
        print(f"  deal f{fr} residual {dd:.3f}")
    else:
        pb[CHAIN[0]].rotation_euler = dealL[0]
        pb[CHAIN[1]].rotation_euler = dealL[1]
        bpy.context.view_layer.update()
    key_pose(fr)
tr2 = arm_obj.animation_data.nla_tracks.new()
tr2.name = "deal"
tr2.strips.new("deal", 1, act2)
arm_obj.animation_data.action = None
print("ANIM deal baked")

bpy.ops.export_scene.gltf(filepath=DST, export_format="GLB", export_morph=True, export_skins=True,
                          export_animations=True, export_image_format="AUTO")
import os

print("EXPORTED:", DST, os.path.getsize(DST))
