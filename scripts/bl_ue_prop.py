# UE 道具(.uemodel) → GLB：UEFormat 插件导入 + 指定 diffuse 贴图接线（道具单贴图即可读）。
# 用法: blender --background --python bl_ue_prop.py -- <in.uemodel> <diffuse.png> <out.glb>
import bpy
import sys

argv = sys.argv[sys.argv.index("--") + 1 :]
SRC, TEX, DST = argv

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.preferences.addon_enable(module="bl_ext.user_default.io_scene_ueformat")
# 该 operator 的 execute 只读 directory+files 集合，filepath 参数会被静默忽略（导出空场景）
import os

bpy.ops.uf.import_uemodel(directory=os.path.dirname(SRC), files=[{"name": os.path.basename(SRC)}])
print("IMPORTED objects:", [(o.name, o.type) for o in bpy.data.objects])

img = bpy.data.images.load(TEX)
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    if not o.material_slots:
        o.data.materials.append(bpy.data.materials.new("prop"))
    for slot in o.material_slots:
        mat = slot.material or bpy.data.materials.new("prop")
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Roughness"].default_value = 0.55
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        slot.material = mat

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=DST, export_format="GLB", export_animations=False, export_morph=False)
import os

print("EXPORTED:", DST, os.path.getsize(DST))
