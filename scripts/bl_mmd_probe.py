# MMD 玩家模型探针：导入 PMX，dump 骨骼树/身高/材质贴图接线（转换映射表的实证依据）
import bpy
import sys

PMX = sys.argv[sys.argv.index("--") + 1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mmd_tools")
bpy.ops.mmd_tools.import_model(filepath=PMX, scale=0.08, types={"MESH", "ARMATURE", "MORPHS"}, clean_model=False)

arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print("ARMATURE:", arm.name, "bones:", len(arm.data.bones))

# 骨骼树（前 3 层全量 + 深层只列人形关键词命中）
KEYS = ["hips", "pelvis", "spine", "chest", "neck", "head", "shoulder", "arm", "elbow", "wrist", "hand",
        "上半身", "下半身", "首", "頭", "肩", "腕", "ひじ", "手首", "センター", "腰"]


def walk(b, depth):
    hit = any(k.lower() in b.name.lower() for k in KEYS)
    if depth <= 3 or hit:
        print("  " * depth + f"[{depth}] {b.name}  head_z={b.head_local.z:.3f}")
    for c in b.children:
        walk(c, depth + 1)


for root in [b for b in arm.data.bones if b.parent is None]:
    walk(root, 0)

# 身高（网格包围盒）
import mathutils

zs = []
for m in meshes:
    for v in m.bound_box:
        zs.append((m.matrix_world @ mathutils.Vector(v)).z)
print("HEIGHT: min_z", round(min(zs), 3), "max_z", round(max(zs), 3))

# 材质 → 贴图
for m in meshes:
    print("MESH:", m.name, "verts:", len(m.data.vertices), "mats:", len(m.material_slots))
    for slot in m.material_slots:
        mat = slot.material
        if not mat:
            continue
        img = None
        if mat.use_nodes:
            for n in mat.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image:
                    img = n.image.filepath or n.image.name
                    break
        print("  MAT:", mat.name, "->", img)
print("PROBE DONE")
