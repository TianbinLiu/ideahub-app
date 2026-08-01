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
TORSO = ["mixamorig:Hips", "mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Neck", "mixamorig:Head"]
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

# ── lean：站姿(交叉抱手) → 俯身（左肘撑桌沿+掌托脸颊、右前臂横放桌沿），55f@24fps ──
# 桌沿在她局部系的位置按引擎滑移(+0.45)反推：b_y≈-0.09、桌沿顶 b_z≈0.836
# 站姿=双手交叉叠放身前小腹、双肘内收夹住胸侧（用户定稿）
act = bpy.data.actions.new("lean")
arm_obj.animation_data.action = act
ZERO = {n: (0, 0, 0) for n in TORSO}
STAND_L = ((0.025, -0.115, 0.615), (0.095, -0.045, 0.72))  # 左腕(前叠)/左肘
STAND_R = ((-0.02, -0.105, 0.60), (-0.095, -0.045, 0.72))  # 右腕/右肘
# (frame, torso, 左腕绝对, 左肘hint, 右腕绝对, 右肘hint)
FRAMES = [
    (1, ZERO, STAND_L[0], STAND_L[1], STAND_R[0], STAND_R[1]),
    (10, {"mixamorig:Hips": (0, 0, 0), "mixamorig:Spine": (-0.02, 0, 0), "mixamorig:Spine1": (0, 0, 0),
          "mixamorig:Neck": (0, 0, 0), "mixamorig:Head": (0.05, 0, 0)},
     STAND_L[0], STAND_L[1], STAND_R[0], STAND_R[1]),
    # 手臂路径：先向外向前散开（避免扫过身体穿模），再落向各自目标
    (16, {"mixamorig:Hips": (0.02, 0, 0), "mixamorig:Spine": (0.03, 0, 0), "mixamorig:Spine1": (0.025, 0, 0),
          "mixamorig:Neck": (-0.06, 0, 0), "mixamorig:Head": (-0.07, 0, -0.01)},
     (0.11, -0.14, 0.68), (0.13, -0.06, 0.75), (-0.10, -0.13, 0.66), (-0.13, -0.06, 0.74)),
    (22, {"mixamorig:Hips": (0.04, 0, 0), "mixamorig:Spine": (0.06, 0, 0), "mixamorig:Spine1": (0.05, 0, 0),
          "mixamorig:Neck": (-0.11, 0, 0), "mixamorig:Head": (-0.13, 0, -0.025)},
     (0.13, -0.12, 0.76), (0.16, -0.07, 0.80), (-0.08, -0.10, 0.80), (-0.16, -0.08, 0.82)),
    (28, {"mixamorig:Hips": (0.06, 0, 0), "mixamorig:Spine": (0.09, 0, 0), "mixamorig:Spine1": (0.075, 0, 0),
          "mixamorig:Neck": (-0.17, 0, 0), "mixamorig:Head": (-0.20, 0, -0.04)},
     (0.10, -0.10, 0.86), (0.17, -0.09, 0.84), (-0.05, -0.095, 0.835), (-0.17, -0.095, 0.845)),
    (40, {"mixamorig:Hips": (0.09, 0, 0), "mixamorig:Spine": (0.125, 0, 0), "mixamorig:Spine1": (0.105, 0, 0),
          "mixamorig:Neck": (-0.25, 0, 0), "mixamorig:Head": (-0.31, 0, -0.08)},
     (0.065, -0.095, 0.94), (0.18, -0.10, 0.845), (-0.02, -0.09, 0.84), (-0.17, -0.09, 0.843)),
    (48, {"mixamorig:Hips": (0.12, 0, 0), "mixamorig:Spine": (0.15, 0, 0), "mixamorig:Spine1": (0.125, 0, 0),
          "mixamorig:Neck": (-0.30, 0, 0), "mixamorig:Head": (-0.375, 0, -0.115)},
     (0.058, -0.092, 0.965), (0.185, -0.10, 0.838), (-0.01, -0.09, 0.838), (-0.165, -0.09, 0.84)),
    (55, {"mixamorig:Hips": (0.11, 0, 0), "mixamorig:Spine": (0.14, 0, 0), "mixamorig:Spine1": (0.115, 0, 0),
          "mixamorig:Neck": (-0.28, 0, 0), "mixamorig:Head": (-0.35, 0, -0.10)},
     (0.058, -0.09, 0.96), (0.185, -0.10, 0.840), (-0.01, -0.09, 0.840), (-0.165, -0.09, 0.842)),
]
prevL = None
prevR = None
dealL = None
for fr, torso, l_abs, l_eb, r_abs, r_eb in FRAMES:
    set_torso(torso)
    if fr == 1:
        set_arms_down()
    if l_abs is not None:
        dl, prevL = solve_arm(lh, CHAIN, Vector(l_abs), elbow_hint=l_eb, prev_sol=prevL)
        print(f"  f{fr} L residual {dl:.3f}")
    if r_abs is not None:
        dr, prevR = solve_arm(rh, RCHAIN, Vector(r_abs), elbow_hint=r_eb, prev_sol=prevR)
        print(f"  f{fr} R residual {dr:.3f}")
    key_pose(fr)
    if fr == 55:
        dealL = [list(pb[CHAIN[0]].rotation_euler), list(pb[CHAIN[1]].rotation_euler)]
        print("LEAN f55 head:", [round(v, 3) for v in head_pos()])
        print("LEAN f55 lhand:", [round(v, 3) for v in (mw @ lh.head)],
              "lElbow:", [round(v, 3) for v in (mw @ pb[CHAIN[1]].head)])
        print("LEAN f55 rhand:", [round(v, 3) for v in (mw @ rh.head)],
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
for fr, tgt in [(6, (0.09, -0.24, 0.92)), (9, (0.10, -0.27, 0.90)), (15, None)]:
    if tgt is not None:
        dd, prevD = solve_arm(lh, CHAIN, Vector(tgt), prev_sol=prevD)
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
