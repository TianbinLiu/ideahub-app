# Milltina FBX → GLB 转换：接贴图、人形骨改名为 mixamo 约定（复用整套演出管线）、
# 精选形键白名单（738→常用集，控制导出体积）。购买资产——产物只进 gitignore 目录。
import bpy
import re

SRC = r"C:/Users/tliu7/Downloads/Milltina_ミルティナ__ver1.01.1/Milltina(ミルティナ)_ver1.01.1/FBX/Milltina.fbx"
TEXDIR = r"C:/Users/tliu7/Downloads/Milltina_ミルティナ__ver1.01.1/Milltina(ミルティナ)_ver1.01.1/PNG"
DST = r"C:/Users/tliu7/ideahub/app/assets-private/milltina-rigged.glb"

import os
os.makedirs(os.path.dirname(DST), exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)

# 穿模修复：衣装是参数化系统——dress/skirt 的 "Apron_set" 形键是穿围裙时的
# 衣身避让形态（出厂默认 0 → 围裙与裙身互相穿插）。把正确穿搭配置烘进基础形。
def bake_shape_mix(obj_name, values):
    o = bpy.data.objects.get(obj_name)
    if not o or not o.data.shape_keys:
        return
    for k in o.data.shape_keys.key_blocks:
        k.value = values.get(k.name, 0.0)
    mixed = o.shape_key_add(name="__mix", from_mix=True)
    coords = [v.co.copy() for v in mixed.data]
    for k in list(o.data.shape_keys.key_blocks):
        o.shape_key_remove(k)
    for v, c in zip(o.data.vertices, coords):
        v.co = c
    print(f"已烘穿搭形态: {obj_name} <- {values}")

# 用户定稿：去掉围裙（外扩后仍与衣身穿模）；dress/skirt 烘 Apron_set=1
# （无围裙穿搭的衣身形态——衣装参数化系统的配套开关）
_apron = bpy.data.objects.get("Milltina_cloth_apron")
if _apron:
    bpy.data.objects.remove(_apron, do_unlink=True)
    print("已移除围裙")
bake_shape_mix("Milltina_cloth_dress", {"Apron_set": 1.0})
bake_shape_mix("Milltina_cloth_skirt", {"Apron_set": 1.0})
bake_shape_mix("Milltina_cloth_hat", {"Option_Twin tail": 1.0})

# ── 贴图接线：按材质名归类到四张图 ──
TEX = {
    "face": os.path.join(TEXDIR, "Milltina_Face.png"),
    "body": os.path.join(TEXDIR, "Milltina_Body.png"),
    "hair": os.path.join(TEXDIR, "Milltina_Hair.png"),
    "costume": os.path.join(TEXDIR, "Milltina_Costume.png"),
}
imgs = {k: bpy.data.images.load(v) for k, v in TEX.items()}

def pick_tex(mat_name):
    n = mat_name.lower()
    if "face" in n:
        return imgs["face"]
    if "hair" in n:
        return imgs["hair"]
    if "body" in n and "cloth" not in n:
        return imgs["body"]
    return imgs["costume"]

wired = []
for mat in bpy.data.materials:
    if not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        continue
    img = pick_tex(mat.name)
    texn = nt.nodes.new("ShaderNodeTexImage")
    texn.image = img
    nt.links.new(texn.outputs["Color"], bsdf.inputs["Base Color"])
    # alpha 材质（睫毛/发影等）接 alpha 通道
    if "alpha" in mat.name.lower():
        nt.links.new(texn.outputs["Alpha"], bsdf.inputs["Alpha"])
        mat.blend_method = "BLEND" if hasattr(mat, "blend_method") else None
    wired.append(f"{mat.name}→{img.name}")
print("MAT wired:", wired)

# ── 人形骨改名 → mixamo 约定（我们的姿势/动画/注视系统全按 mixamorig 名驱动）──
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
RENAME_CANDIDATES = {
    "mixamorig:Hips": ["Hips"],
    "mixamorig:Spine": ["Spine"],
    "mixamorig:Spine1": ["Chest"],
    "mixamorig:Spine2": ["Upper Chest", "UpperChest", "Upper_Chest"],
    "mixamorig:Neck": ["Neck"],
    "mixamorig:Head": ["Head"],
    "mixamorig:LeftShoulder": ["Left shoulder", "LeftShoulder", "Shoulder_L", "shoulder_L"],
    "mixamorig:LeftArm": ["Left arm", "LeftUpperArm", "Upper_arm_L", "UpperArm_L", "Left Arm"],
    "mixamorig:LeftForeArm": ["Left elbow", "LeftLowerArm", "Lower_arm_L", "LowerArm_L"],
    "mixamorig:LeftHand": ["Left wrist", "LeftHand", "Hand_L", "hand_L"],
    "mixamorig:RightShoulder": ["Right shoulder", "RightShoulder", "Shoulder_R", "shoulder_R"],
    "mixamorig:RightArm": ["Right arm", "RightUpperArm", "Upper_arm_R", "UpperArm_R", "Right Arm"],
    "mixamorig:RightForeArm": ["Right elbow", "RightLowerArm", "Lower_arm_R", "LowerArm_R"],
    "mixamorig:RightHand": ["Right wrist", "RightHand", "Hand_R", "hand_R"],
    "mixamorig:LeftUpLeg": ["Left leg", "LeftUpperLeg", "Upper_leg_L"],
    "mixamorig:LeftLeg": ["Left knee", "LeftLowerLeg", "Lower_leg_L"],
    "mixamorig:LeftFoot": ["Left ankle", "LeftFoot", "foot_L"],
    "mixamorig:RightUpLeg": ["Right leg", "RightUpperLeg", "Upper_leg_R"],
    "mixamorig:RightLeg": ["Right knee", "RightLowerLeg", "Lower_leg_R"],
    "mixamorig:RightFoot": ["Right ankle", "RightFoot", "foot_R"],
}
names = {b.name for b in arm.data.bones}
renamed, missing = [], []
for target, cands in RENAME_CANDIDATES.items():
    src = next((c for c in cands if c in names), None)
    if src:
        arm.data.bones[src].name = target
        renamed.append(f"{src}→{target}")
    else:
        missing.append(target)
print("BONES renamed:", len(renamed))
for r in renamed:
    print("  ", r)
print("BONES missing:", missing)

# ── 形键白名单：口型核心 + 眨眼 + 常用表情（体积控制；全集永远在源 FBX 里）──
KEEP_PATTERNS = [
    r"^vrc\.v_(aa|ih|ou|e|oh|sil)$",  # 口型核心六元音
    r"^vrc\.blink",
    r"^eye_close($|_)",
    r"^eye_joy($|_)",
    r"^eye_nagomi_1($|_)",
    r"^eye_smile",
    r"^mouth_smile",
    r"^mouth_up",
    r"^mouth_niko",
    r"^eye_hau",
    r"^eye_wink($|_)",
]

def keep(name):
    return name == "Basis" or any(re.search(p, name) for p in KEEP_PATTERNS)

for o in bpy.data.objects:
    if o.type != "MESH" or not o.data.shape_keys:
        continue
    kbs = o.data.shape_keys.key_blocks
    drop = [k.name for k in kbs if not keep(k.name)]
    kept = [k.name for k in kbs if keep(k.name)]
    for name in drop:
        o.shape_key_remove(o.data.shape_keys.key_blocks[name])
    if len(kept) > 1:
        print(f"SK {o.name}: 保留 {len(kept)} 个:", kept[:24])

bpy.ops.export_scene.gltf(filepath=DST, export_format="GLB", export_morph=True, export_skins=True,
                          export_animations=False, export_image_format="AUTO")
print("EXPORTED:", DST, os.path.getsize(DST), "bytes")
