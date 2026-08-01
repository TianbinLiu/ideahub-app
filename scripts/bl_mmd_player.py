# MMD(PMX) → 玩家形象 GLB 转换（本地开发档专用，产物走 protect 加密、永不进仓/进包）。
# 两个移植模型（凛=流云景版、Gratia=SheepyLord 版）都在 UE/原生骨上叠了标准 MMD 控制链，
# 因此同一张日文骨→mixamo 映射表通吃；PlayerArms 只驱动 7 根骨 + 手骨备用。
# 用法: blender --background --python bl_mmd_player.py -- <in.pmx> <out.glb>
import bpy
import sys

argv = sys.argv[sys.argv.index("--") + 1 :]
SRC, DST = argv[0], argv[1]

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

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=DST,
    export_format="GLB",
    export_skins=True,
    export_animations=False,
    export_morph=False,
    export_image_format="AUTO",
    export_yup=True,
)
import os

print("EXPORTED:", DST, os.path.getsize(DST))
