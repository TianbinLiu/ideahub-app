# MMD(PMX) → 玩家形象 GLB 转换（本地开发档专用，产物走 protect 加密、永不进仓/进包）。
# 两个移植模型（凛=流云景版、Gratia=SheepyLord 版）都在 UE/原生骨上叠了标准 MMD 控制链，
# 因此同一张日文骨→mixamo 映射表通吃；PlayerArms 只驱动 7 根骨 + 手骨备用。
# 用法: blender --background --python bl_mmd_player.py -- <in.pmx> <out.glb>
import bpy
import sys

argv = sys.argv[sys.argv.index("--") + 1 :]
SRC, DST = argv[0], argv[1]
# 可选第 3 参=think 托腮点相对头骨的 z 偏移（脸长的模型要更低，默认 -0.11）
CHIN_Z = float(argv[2]) if len(argv) > 2 else -0.11

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mmd_tools")
# 不导入 PHYSICS：刚体/joint 在引擎无用（裙发物理后续用 springBones 近似）
bpy.ops.mmd_tools.import_model(filepath=SRC, scale=0.08, types={"MESH", "ARMATURE", "MORPHS"}, clean_model=False)

arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)  # 道具 PMX 可无骨架
meshes = [o for o in bpy.data.objects if o.type == "MESH"]

# ── 骨骼改名：MMD 控制链 → mixamo 约定（three 会把 ':' sanitize 掉 = mixamorigXxx）──
RENAME = {
    "下半身": "mixamorig:Hips",
    "上半身": "mixamorig:Spine1",
    "首": "mixamorig:Neck",
    "頭": "mixamorig:Head",
    "肩.L": "mixamorig:LeftShoulder",
    "腕.L": "mixamorig:LeftArm",
    "ひじ.L": "mixamorig:LeftForeArm",
    "手首.L": "mixamorig:LeftHand",
    "肩.R": "mixamorig:RightShoulder",
    "腕.R": "mixamorig:RightArm",
    "ひじ.R": "mixamorig:RightForeArm",
    "手首.R": "mixamorig:RightHand",
    # settle 动画牵涉的骨也 ASCII 化：three 的轨道名 sanitize 会把 CJK 剥空致绑定失败
    "センター": "mmdCenter",
    "足.L": "mixamorig:LeftUpLeg",
    "ひざ.L": "mixamorig:LeftLeg",
    "足首.L": "mixamorig:LeftFoot",
    "足.R": "mixamorig:RightUpLeg",
    "ひざ.R": "mixamorig:RightLeg",
    "足首.R": "mixamorig:RightFoot",
    "足D.L": "mixamorigLeftUpLegD",
    "ひざD.L": "mixamorigLeftLegD",
    "足首D.L": "mixamorigLeftFootD",
    "足D.R": "mixamorigRightUpLegD",
    "ひざD.R": "mixamorigRightLegD",
    "足首D.R": "mixamorigRightFootD",
}
renamed = 0
if arm is not None:
    for jp, mx in RENAME.items():
        b = arm.data.bones.get(jp)
        if b:
            b.name = mx  # 顶点组随骨名自动跟改
            renamed += 1
print(f"RENAMED {renamed}/{len(RENAME)}")

for mesh in meshes:
    # ── 形键全清：玩家形象不驱表情，留着只会把 GLB 撑爆（Gratia 166k 顶点×87 形键）──
    if mesh.data.shape_keys:
        mesh.shape_key_clear()

    # ── 删"非表示"特效面（材质名标注不显示的 VFX 板）──
    hide_slots = [i for i, s in enumerate(mesh.material_slots) if s.material and "非表示" in s.material.name]
    if hide_slots:
        import bmesh

        bm = bmesh.new()
        bm.from_mesh(mesh.data)
        doomed = [f for f in bm.faces if f.material_index in hide_slots]
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bm.to_mesh(mesh.data)
        bm.free()
        print("DROPPED faces of slots", hide_slots)

    # ── 材质重建：mmd_tools 的 MMDShader 节点 glTF 导不出——取第一张 TEX_IMAGE 当
    # diffuse 重建极简 Principled（引擎侧 toonify 会整体换 MeshToonMaterial）──
    BLEND_NAMES = ("目光", "睫毛影", "瞳环", "眼角膜")  # 半透明高光/覆盖片
    for slot in mesh.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        img = None
        for n in mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                img = n.image
                break
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Roughness"].default_value = 0.9
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        if img is not None:
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = img
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        if any(k in mat.name for k in BLEND_NAMES):
            mat.blend_method = "BLEND"
        else:
            mat.blend_method = "CLIP"
        mat.use_backface_culling = False

# ── think 姿势烘焙（卡组视角）：f1 rest → f10 低头歪头+左手托下巴 ──
# 世界系矩阵摆姿势 + 坐标下降解腕（对 MMD/UE 骨局部轴向免疫，目标按头/肩实际位置
# 相对推算，两模型通吃）；只 keyframe FPS 姿势表同款 7 骨——退出 deckView 后
# else 分支逐帧重写它们，不会留残姿势
if arm is not None and arm.data.bones.get("mixamorig:Head"):
    from mathutils import Matrix, Vector

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    pb = arm.pose.bones
    mw = arm.matrix_world
    ORDER = ["mixamorig:Spine1", "mixamorig:Neck", "mixamorig:Head",
             "mixamorig:LeftArm", "mixamorig:LeftForeArm", "mixamorig:LeftHand",
             "mixamorig:RightArm", "mixamorig:RightForeArm"]
    for n in ORDER:
        pb[n].rotation_mode = "XYZ"

    def rot_world(name, axis, angle):
        """绕世界轴旋转 pose bone（原地，平移不动）——免局部轴向考古"""
        b = pb[name]
        loc = b.matrix.to_translation()
        b.matrix = Matrix.Translation(loc) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-loc) @ b.matrix
        bpy.context.view_layer.update()

    def key_pose(frame):
        bpy.context.view_layer.update()
        mats = {n: pb[n].matrix.copy() for n in ORDER}
        bpy.context.scene.frame_set(frame)
        for n in ORDER:
            pb[n].matrix = mats[n]
            bpy.context.view_layer.update()
        for n in ORDER:
            pb[n].keyframe_insert(data_path="rotation_euler", frame=frame)

    def solve_arm(tip_name, chain, target, elbow_hint):
        tip, elbow = pb[tip_name], pb[chain[1]]
        bones = [pb[chain[0]], pb[chain[1]]]

        def score():
            bpy.context.view_layer.update()
            s = ((mw @ tip.head) - target).length
            s += 0.6 * ((mw @ elbow.head) - elbow_hint).length
            return s

        cur = score()
        s = 0.4
        while s >= 0.02:
            improved = False
            for b in bones:
                for ax in range(3):
                    for sign in (1.0, -1.0):
                        old = b.rotation_euler[:]
                        e = list(old)
                        e[ax] += sign * s
                        b.rotation_euler = e
                        d = score()
                        if d < cur - 1e-5:
                            cur = d
                            improved = True
                        else:
                            b.rotation_euler = old
            if not improved:
                s *= 0.55
        return cur

    act = bpy.data.actions.new("think")
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = act
    key_pose(1)  # rest
    # 前倾+低头+歪头（坐标系：脸=-Y、上=+Z、她左=+X；绕世界 +X 正角=前倾）
    rot_world("mixamorig:Spine1", "X", 0.28)
    rot_world("mixamorig:Neck", "X", 0.18)
    rot_world("mixamorig:Head", "X", 0.22)
    rot_world("mixamorig:Head", "Y", 0.10)
    head_pos = mw @ pb["mixamorig:Head"].head
    shoulder = mw @ pb["mixamorig:LeftArm"].head
    # 托颚线外侧（不是下巴正前/眼侧）：正前大袖挡脸、太高手套压眼——贴颚下缘最自然
    chin = head_pos + Vector((0.10, -0.10, CHIN_Z))
    hint = shoulder + Vector((0.10, -0.02, -0.24))
    res = solve_arm("mixamorig:LeftHand", ["mixamorig:LeftArm", "mixamorig:LeftForeArm"], chin, hint)
    print(f"THINK solve residual {res:.3f}  chin {[round(v,3) for v in chin]}")
    # 掌心内旋朝脸（rest 掌朝镜头会读作"打招呼"）：左手绕世界竖轴 -70°
    rot_world("mixamorig:LeftHand", "Z", -1.2)
    key_pose(10)
    tr = arm.animation_data.nla_tracks.new()
    tr.name = "think"
    tr.strips.new("think", 1, act)
    arm.animation_data.action = None
    print("THINK baked")

    # ── settle：站立 → 撤步弯腰伏桌（用户定稿：像真人一样边弯腰边翘臀、双腿后撤一两步）──
    # 腿走 MMD 自带 IK（移 足ＩＫ 目标脚真踩地），躯干 rot_world 逐帧绝对角，臂坐标下降
    # 解到"交叉垫在胸下"；全部 visual matrix 回写 keyframe；センター位置轨引擎侧白名单保留
    def find_pb(*names):
        for n in names:
            if n in pb:
                return pb[n]
        return None

    CEN = find_pb("mmdCenter", "センター")
    LIK = find_pb("足ＩＫ.L", "足IK.L", "左足ＩＫ")
    RIK = find_pb("足ＩＫ.R", "足IK.R", "右足ＩＫ")
    HIPS = pb.get("mixamorig:Hips")
    # 腿链（含 D 变体）绝不打关键帧：pb.matrix 回写对带约束的骨会把"补偿基旋+约束复制"
    # 叠成两倍旋转（D 腿飞天事故）。只动 IK 目标——glTF 导出按求值后姿势采样自然正确
    S_ORDER = ([CEN.name] if CEN else []) + (["mixamorig:Hips"] if HIPS else []) + [
        "mixamorig:Spine1", "mixamorig:Neck", "mixamorig:Head",
        "mixamorig:LeftArm", "mixamorig:LeftForeArm", "mixamorig:LeftHand",
        "mixamorig:RightArm", "mixamorig:RightForeArm"]
    for n in S_ORDER:
        pb[n].rotation_mode = "XYZ"

    def reset_upper():
        for n in ["mixamorig:Spine1", "mixamorig:Neck", "mixamorig:Head",
                  "mixamorig:LeftArm", "mixamorig:LeftForeArm", "mixamorig:LeftHand",
                  "mixamorig:RightArm", "mixamorig:RightForeArm"]:
            pb[n].rotation_euler = (0, 0, 0)
        if HIPS:
            HIPS.rotation_euler = (0, 0, 0)
        bpy.context.view_layer.update()

    def key_settle(frame):
        bpy.context.view_layer.update()
        mats = {n: pb[n].matrix.copy() for n in S_ORDER}
        bpy.context.scene.frame_set(frame)
        for n in S_ORDER:
            pb[n].matrix = mats[n]
            bpy.context.view_layer.update()
        for n in S_ORDER:
            pb[n].keyframe_insert(data_path="rotation_euler", frame=frame)
        if CEN:
            CEN.keyframe_insert(data_path="location", frame=frame)
        for ik in (LIK, RIK):
            if ik:
                ik.keyframe_insert(data_path="location", frame=frame)

    def set_arms_cross(depth):
        """双臂交叉垫胸下（depth 0..1 渐进）：以折叠后胸口实际位置为世界目标"""
        bpy.context.view_layer.update()
        chest = (mw @ pb["mixamorig:Spine1"].head) * 0.35 + (mw @ pb["mixamorig:Neck"].head) * 0.65
        below = Vector((0, 0, -0.10))  # 胸下缘
        lt = chest + Vector((-0.07 * depth, -0.02, 0)) + below
        rt = chest + Vector((0.07 * depth, -0.04, 0)) + below
        le = chest + Vector((0.17, 0.02, -0.06))
        re = chest + Vector((-0.17, 0.0, -0.06))
        solve_arm("mixamorig:LeftHand", ["mixamorig:LeftArm", "mixamorig:LeftForeArm"], lt, le)
        solve_arm("mixamorig:RightHand", ["mixamorig:RightArm", "mixamorig:RightForeArm"], rt, re)

    act3 = bpy.data.actions.new("settle")
    arm.animation_data.action = act3
    # (帧, センター背移+降, 右脚IK后移/抬, 左脚IK后移/抬, 躯干折, 颈, 头, 臀翘, 抱胸深度)
    # 她背向 = +Y（脸 -Y）；上 = +Z
    # 脚只撤 ~0.11、重心背移小/下沉大（膝盖微弯）→ 侧影是"L 形伏桌"而非俯卧撑斜坡；
    # 头 counter 加深（全折 90° 后脸要基本朝前看向对面）
    SEQ = [
        (1, (0, 0, 0), (0, 0), (0, 0), 0.0, 0.0, 0.0, 0.0, None),
        (10, (0, 0.02, -0.02), (0.07, 0.03), (0, 0), 0.22, -0.08, -0.1, 0.04, None),
        (18, (0, 0.05, -0.05), (0.10, 0), (0.08, 0.03), 0.50, -0.22, -0.26, 0.09, 0.35),
        (26, (0, 0.08, -0.08), (0.10, 0), (0.12, 0), 0.78, -0.38, -0.44, 0.14, 0.7),
        (36, (0, 0.10, -0.11), (0.11, 0), (0.12, 0), 1.02, -0.54, -0.64, 0.18, 1.0),
        (48, (0, 0.11, -0.13), (0.11, 0), (0.12, 0), 1.22, -0.65, -0.78, 0.20, 1.0),
        (58, (0, 0.108, -0.128), (0.11, 0), (0.12, 0), 1.19, -0.64, -0.76, 0.19, 1.0),
    ]
    def move_world(b, world_delta):
        """pose bone location 是 rest 局部系——世界位移需经 rest 旋转逆变换"""
        b.location = b.bone.matrix_local.to_3x3().inverted() @ Vector(world_delta)

    for fr, cen, rik, lik, fold, neckA, headA, butt, cross in SEQ:
        reset_upper()
        if CEN:
            move_world(CEN, cen)
        if RIK:
            move_world(RIK, (0, rik[0], rik[1]))
        if LIK:
            move_world(LIK, (0, lik[0], lik[1]))
        bpy.context.view_layer.update()
        if butt and HIPS:
            rot_world("mixamorig:Hips", "X", butt)  # 骨盆前倾=翘臀（腰キャンセル会抵消到腿）
        if fold:
            rot_world("mixamorig:Spine1", "X", fold)
        if neckA:
            rot_world("mixamorig:Neck", "X", neckA)
        if headA:
            rot_world("mixamorig:Head", "X", headA)
        if cross is not None:
            set_arms_cross(cross)
        key_settle(fr)
    tr3 = arm.animation_data.nla_tracks.new()
    tr3.name = "settle"
    tr3.strips.new("settle", 1, act3)
    arm.animation_data.action = None
    bpy.ops.object.mode_set(mode="OBJECT")
    print("SETTLE baked  ik:", bool(LIK), bool(RIK), " cen:", bool(CEN))

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=DST,
    export_format="GLB",
    export_skins=True,
    export_animations=True,
    export_morph=False,
    export_image_format="AUTO",
    export_yup=True,
)
import os

print("EXPORTED:", DST, os.path.getsize(DST))
