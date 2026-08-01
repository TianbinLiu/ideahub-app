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
    bpy.ops.object.mode_set(mode="OBJECT")
    print("THINK baked")

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
