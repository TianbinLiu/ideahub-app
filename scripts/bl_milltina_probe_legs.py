# 诊断：lean 末帧下腿/脚世界高度 vs 地板；掌与躯干间隙；左右胸间距
import bpy
from mathutils import Euler, Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r"C:/Users/tliu7/ideahub/app/assets-private/milltina-anim.glb")
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
if arm.animation_data is None: arm.animation_data_create()
arm.animation_data.action = bpy.data.actions["lean"]
END = int(bpy.data.actions["lean"].frame_range[1])
mw = arm.matrix_world
for fr in [1, END]:
    bpy.context.scene.frame_set(fr)
    bpy.context.view_layer.update()
    pb = arm.pose.bones
    out = {}
    for n in ["mixamorig:Hips", "mixamorig:LeftUpLeg", "mixamorig:RightUpLeg"]:
        if n in pb: out[n.split(":")[1]] = round((mw @ pb[n].head).z, 3)
    # 腿部网格最低点（body + skirt）
    dg = bpy.context.evaluated_depsgraph_get()
    lowest = 9; lowest_obj = None
    for name in ["Milltina_body", "Milltina_cloth_skirt", "Milltina_cloth_shoes"]:
        ob = bpy.data.objects.get(name)
        if not ob: continue
        ev = ob.evaluated_get(dg); me = ev.to_mesh(); m2 = ev.matrix_world
        for v in me.vertices:
            z = (m2 @ v.co).z
            if z < lowest: lowest = z; lowest_obj = name
        ev.to_mesh_clear()
    print(f"FRAME {fr}: bones={out} lowest_mesh_z={lowest:.3f} ({lowest_obj})")
print("引擎映射: world_y = -2.55 + slideY + model_z*3.35 ; 地板 world_y=0 ; 桌沿顶 world_y=0.25")
for sy in [0.0, 0.47]:
    print(f"  slideY={sy}: 模型 z=0 → world_y={-2.55+sy:.2f}")
