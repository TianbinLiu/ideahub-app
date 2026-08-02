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
_apron = bpy.data.objects.get("Milltina_cloth_apron")
if _apron:
    bpy.data.objects.remove(_apron, do_unlink=True)
    print("已移除围裙")

# bra 在裙下完全不可见，唯独蕾丝刺绣会在胸尖穿出裙身（官方靠围裙盖住此区，
# 我们去围裙后暴露；Shrink 系只缩身体不缩 bra）——直接移除（隐藏实验已验证衣身完好）
_bra = bpy.data.objects.get("Milltina_cloth_bra")
if _bra:
    bpy.data.objects.remove(_bra, do_unlink=True)
    print("已移除 bra")

# ── 官方防穿模配置（逆向自 Milltina.prefab 的 m_BlendShapeWeights，索引→键名对照 FBX 顺序）──
# VRChat 不穿模的根源：prefab 把「身体 Shrink 系（衣下身体内缩）+ 全件胸型统一 Cow +
# 挤压键」配置好了；裸 FBX 全 0 = 身体全尺寸顶穿衣身 → 内衣/皮肤露出。
# 胸型：官方 prefab 用 Cow（最大档）——用户反馈"像装水气球太下垂"，改一档
# (Wear bra)Breasts_Big：作者的"穿 bra 支撑形"，更小更挺形状固定；衣身配对键同步
bake_shape_mix("Milltina_body", {
    "(Wear bra)Breasts_Big": 1.0,   # 穿 bra 状态的胸型（与 dress 同号配对）
    "Shrink_Clothes_on": 1.0,       # 衣下身体内缩=物理上不可能穿出
    # 深弯腰(45°)时腹部皮肤会挤出衣身——腰腹段再收一档（作者自带的分部位 Shrink）
    "Shrink_Spine_1": 1.0,
    "Shrink_Spine_2": 1.0,
    "Shrink_Sock_on": 1.0,
    "Panty_squeeze": 1.0,
    "Sock_squeeze": 1.0,
    "Garters_squeeze": 1.0,
    "Foot_heel": 1.0,
})
bake_shape_mix("Milltina_cloth_dress", {"Apron_set": 1.0, "Breasts_Big": 1.0, "Cuff_shrink": 1.0})
bake_shape_mix("Milltina_cloth_skirt", {"Apron_set": 1.0})
bake_shape_mix("Milltina_cloth_panties", {"Panty_squeeze": 1.0, "Option_Tail_set": 1.0})
bake_shape_mix("Milltina_cloth_garterbelt", {
    "Panty_squeeze": 1.0, "Foot_heel": 1.0, "Sock_squeeze": 1.0, "Garters_squeeze": 1.0,
})
bake_shape_mix("Milltina_cloth_hat", {"Option_Twin tail": 1.0})

# ── 去 Q 版：等比缩头（实测原始 4.86 头身=典型 Q 版；正常成年 6.5~7）──
# 只缩头不改躯干/四肢：身高、臂长、胸位全不变 → 已标定的接触坐标与烘焙姿势继续有效。
# 网格顶点与形键 delta 同步缩放（形键是相对偏移，不跟着缩会让眨眼/口型幅度失配）。
# 无头量测结论（非等比）：她的腿比例其实正常（胯高/身高 0.530≈真人 0.53），
# Q 感主因是**头横向过宽**（头宽/头长 0.853 vs 真人 0.644）——等比缩放改不了这一项。
# 纵 0.865 把头身比 6.05→6.84，横 0.90 收窄脸型；身高与脚底不变 ⇒ 已标定坐标全部继续有效。
HEAD_SCALE = (0.90, 0.90, 0.865)  # (世界X 横, 世界Y 深, 世界Z 纵)

def deq_head(scale=HEAD_SCALE):
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    hb = arm.data.bones.get("mixamorig:Head") or arm.data.bones.get("Head")
    if hb is None:
        print("去Q版: 未找到 Head 骨，跳过")
        return
    center = arm.matrix_world @ hb.head_local  # 以颈根为缩放中心，脖子接缝不动
    moved = 0
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        gi = {g.index for g in o.vertex_groups if g.name in ("mixamorig:Head", "Head")}
        if not gi:
            continue
        mw, mwi = o.matrix_world, o.matrix_world.inverted()
        # 权重 w 作为渐变系数：脖子处 w 小→几乎不缩，头顶 w=1→全缩（无硬接缝）
        wmap = {}
        for v in o.data.vertices:
            w = sum(g.weight for g in v.groups if g.group in gi)
            if w <= 0.01:
                continue
            w = min(1.0, w)
            wmap[v.index] = w
            world = mw @ v.co
            d = world - center
            for i in range(3):
                d[i] *= 1 - w + w * scale[i]
            v.co = mwi @ (center + d)
            moved += 1
        # 形键 delta 同步缩放
        if o.data.shape_keys:
            basis = o.data.shape_keys.key_blocks[0]
            for kb in o.data.shape_keys.key_blocks[1:]:
                for idx, w in wmap.items():
                    dd = kb.data[idx].co - basis.data[idx].co
                    for i in range(3):
                        dd[i] *= 1 - w + w * scale[i]
                    kb.data[idx].co = basis.data[idx].co + dd
        # Basis 也要跟上主网格
        if o.data.shape_keys:
            kb0 = o.data.shape_keys.key_blocks[0]
            for idx in wmap:
                kb0.data[idx].co = o.data.vertices[idx].co
    # 骨骼：头骨链同步缩短，注视/表情驱动才不会错位
    prev_mode = bpy.context.object.mode if bpy.context.object else "OBJECT"
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for eb in arm.data.edit_bones:
        if eb.name in ("mixamorig:Head", "Head"):
            t = eb.tail - eb.head
            for i in range(3):
                t[i] *= scale[i]
            eb.tail = eb.head + t
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"去Q版: 头缩放 {tuple(scale)}，{moved} 顶点")


deq_head()

# ── 贴图接线：按材质名归类到四张图 ──
TEX = {
    "face": os.path.join(TEXDIR, "Milltina_Face.png"),
    "body": os.path.join(TEXDIR, "Milltina_Body.png"),
    "hair": os.path.join(TEXDIR, "Milltina_Hair.png"),
    # 深绿+金滚边重着色版（scripts/recolor_milltina_costume.py 产出，场景色板对齐）
    "costume": r"C:/Users/tliu7/ideahub/app/assets-private/textures/Milltina_Costume_greengold.png",
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
    r"^eye_nagomi_[12]($|_)",  # 和み两档强度——常驻慵懒半眯用作者原键，不再用 blink 半开 hack
    r"^brow_nagomi($|_)",  # 配套眉毛放松键（眼+眉才是完整表情）
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
