# 量测：lean 末帧（含托胸变形）下，裙面前表面在下胸/腰腹高度带的 y 位置 + 胸底
import bpy
from mathutils import Euler

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r"C:/Users/tliu7/ideahub/app/assets-private/milltina-anim.glb")
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
arm.animation_data_create() if arm.animation_data is None else None
arm.animation_data.action = bpy.data.actions["lean"]
END = int(bpy.data.actions["lean"].frame_range[1])
bpy.context.scene.frame_set(END)
pb = arm.pose.bones
for name, side in [("Breast_L", 1), ("Breast_R", -1)]:
    b = pb[name]
    b.rotation_mode = "QUATERNION"
    b.rotation_quaternion = b.rotation_quaternion @ Euler((-0.5, 0.30 * side, 0), "XYZ").to_quaternion()
    b.scale = (1.18, 1.18, 1.18)
for name in ["Breast_L.001", "Breast_R.001"]:
    b = pb[name]
    b.rotation_mode = "QUATERNION"
    b.rotation_quaternion = b.rotation_quaternion @ Euler((-0.24, 0, 0), "XYZ").to_quaternion()
bpy.context.view_layer.update()

dg = bpy.context.evaluated_depsgraph_get()
dress = bpy.data.objects["Milltina_cloth_dress"]
ev = dress.evaluated_get(dg)
mesh = ev.to_mesh()
mw = ev.matrix_world
slices = {round(z, 2): [] for z in [0.68, 0.70, 0.72, 0.74, 0.76, 0.78]}
breast_low = 9
vg_breast = {g.index for g in dress.vertex_groups if g.name.startswith("Breast")}
for v_ev, v_orig in zip(mesh.vertices, dress.data.vertices):
    co = mw @ v_ev.co
    if abs(co.x) < 0.09:
        for z0 in slices:
            if abs(co.z - z0) < 0.012:
                slices[z0].append(round(co.y, 3))
    w = sum(g.weight for g in v_orig.groups if g.group in vg_breast)
    if w > 0.5 and co.z < breast_low and abs(co.x) < 0.15:
        breast_low = co.z
ev.to_mesh_clear()
for z0 in sorted(slices):
    ys = sorted(slices[z0])
    if ys:
        print(f"z={z0}: front_y(min)={ys[0]:.3f} n={len(ys)}")
print("breast region lowest z:", round(breast_low, 3))
