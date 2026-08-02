# 倾斜系环抱：臂锚定"胸根沿躯干轴向下"（胸与躯干交界褶线），轻上旋让胸垂搭臂上。
# 上一版用世界 Z 判"下方"——躯干前倾 40° 下臂落在乳头位、把胸往里压（用户实锤）。
import bpy, os
from mathutils import Euler, Vector

OUT = os.environ.get("HUG_OUT", r"C:/Users/tliu7/ideahub/app/assets-private/hug2")
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r"C:/Users/tliu7/ideahub/app/assets-private/milltina-anim.glb")
arm_obj = next(o for o in bpy.data.objects if o.type == "ARMATURE")
if arm_obj.animation_data is None:
    arm_obj.animation_data_create()
arm_obj.animation_data.action = bpy.data.actions["lean"]
END = int(bpy.data.actions["lean"].frame_range[1])
bpy.context.scene.frame_set(END)
pb = arm_obj.pose.bones
mw = arm_obj.matrix_world
bpy.context.view_layer.update()

# 倾斜躯干系：躯干轴 = Spine1→Neck；"沿躯干向下"= -axis；胸壁外法向≈躯干前向
s1 = mw @ pb["mixamorig:Spine1"].head
neck = mw @ pb["mixamorig:Neck"].head
axis = (neck - s1).normalized()          # 沿躯干向上（倾斜的）
rootL = mw @ pb["Breast_L"].head
rootR = mw @ pb["Breast_R"].head
# 胸壁前向法向：躯干轴×左向(x) 的正交化——用世界前向(-y)去除轴向分量
fwd = Vector((0, -1, 0))
fwd = (fwd - axis * fwd.dot(axis)).normalized()
print("AXIS", [round(v,3) for v in axis], "FWD", [round(v,3) for v in fwd])
print("ROOT_L", [round(v,3) for v in rootL], "ROOT_R", [round(v,3) for v in rootR])

# 臂目标：胸根沿躯干向下 dDown、沿胸壁法向外 dOut（贴胸壁+臂半径）
def targets(dDown, dOut):
    cL = rootL - axis * dDown + fwd * dOut
    cR = rootR - axis * dDown + fwd * dOut
    mid = (cL + cR) / 2
    # 交叉环抱：左腕到右侧、右腕到左侧，都在褶线带上；肘外扬回落桌沿带
    lw = Vector((-0.045, mid.y, mid.z))
    rw = Vector((0.04, mid.y - 0.012, mid.z + 0.012))
    le = Vector((0.125, cL.y + 0.01, cL.z + 0.005))
    re = Vector((-0.125, cR.y + 0.01, cR.z + 0.005))
    return lw, le, rw, re

CHAIN = ["mixamorig:LeftArm", "mixamorig:LeftForeArm", "mixamorig:LeftHand"]
RCHAIN = ["mixamorig:RightArm", "mixamorig:RightForeArm", "mixamorig:RightHand"]
lh = pb["mixamorig:LeftHand"]; rh = pb["mixamorig:RightHand"]

def solve_arm(tip, chain_names, world_target, elbow_hint=None):
    bones = [pb[n] for n in chain_names[:2]]
    for b in bones: b.rotation_mode = "XYZ"
    tv = Vector(world_target); ev = Vector(elbow_hint) if elbow_hint else None
    elbow = pb[chain_names[1]]
    def score():
        bpy.context.view_layer.update()
        s = ((mw @ tip.head) - tv).length
        if ev is not None: s += 0.6 * ((mw @ elbow.head) - ev).length
        return s
    cur = score(); step = 0.4
    while step >= 0.02:
        improved = False
        for b in bones:
            for ax in range(3):
                for sign in (1.0, -1.0):
                    old = b.rotation_euler[:]
                    e = list(old); e[ax] += sign * step
                    b.rotation_euler = e
                    d = score()
                    if d < cur - 1e-5: cur = d; improved = True
                    else: b.rotation_euler = old
        if not improved: step *= 0.55
    return cur

sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"; sc.render.resolution_x = 720; sc.render.resolution_y = 720
sc.display.shading.light = "MATCAP"
def make_cam(name, loc, look):
    cd = bpy.data.cameras.new(name); cam = bpy.data.objects.new(name, cd)
    sc.collection.objects.link(cam); cam.location = loc
    cam.rotation_euler = (Vector(look) - Vector(loc)).normalized().to_track_quat("-Z", "Y").to_euler()
    return cam
CAMS = [(make_cam("camF", (0, -1.5, 0.62), (0, -0.20, 0.78)), "F"),
        (make_cam("camS", (1.5, -0.75, 0.82), (0, -0.20, 0.78)), "S")]

def measure_underside():
    # 轻上旋态下胸区网格的底面剖线：y 槽 → min z
    dg = bpy.context.evaluated_depsgraph_get()
    dress = bpy.data.objects["Milltina_cloth_dress"]
    vg = {g.index for g in dress.vertex_groups if g.name.startswith("Breast")}
    ev = dress.evaluated_get(dg); mesh = ev.to_mesh(); dmw = ev.matrix_world
    slots = {round(y,2): 9 for y in [-0.24,-0.22,-0.20,-0.18,-0.16,-0.14]}
    for v_ev, v_orig in zip(mesh.vertices, dress.data.vertices):
        w = sum(g.weight for g in v_orig.groups if g.group in vg)
        if w < 0.4: continue
        co = dmw @ v_ev.co
        if abs(co.x) > 0.12: continue
        for y0 in slots:
            if abs(co.y - y0) < 0.012 and co.z < slots[y0]:
                slots[y0] = co.z
    ev.to_mesh_clear()
    for y0 in sorted(slots): print(f"UNDERSIDE y={y0}: minz={slots[y0]:.3f}")
    return slots

# 叠臂带压：railTop(引擎 slideY0.48 反推)=0.693；左前臂贴沿、右前臂带压叠左臂、胸带压坐堆
RAIL = 0.693
# (标签, 叠距, breast[ang,splay,child,swell])
GRID = [
    ("X_stack030_l30", 0.030, (-0.30, 0.24, -0.14, 1.12)),
    ("Y_stack036_l35", 0.036, (-0.35, 0.25, -0.16, 1.12)),
]
for label, stack, (ang, splay, child, swell) in GRID:
    bpy.context.scene.frame_set(END - 1); bpy.context.scene.frame_set(END)
    for name, side in [("Breast_L", 1), ("Breast_R", -1)]:
        b = pb[name]; b.rotation_mode = "QUATERNION"
        b.rotation_quaternion = b.rotation_quaternion @ Euler((ang, splay * side, 0), "XYZ").to_quaternion()
        b.scale = (swell, swell, swell)
    for name in ["Breast_L.001", "Breast_R.001"]:
        b = pb[name]; b.rotation_mode = "QUATERNION"
        b.rotation_quaternion = b.rotation_quaternion @ Euler((child, 0, 0), "XYZ").to_quaternion()
    bpy.context.view_layer.update()
    slots = measure_underside()
    zLow = RAIL + 0.018            # 左前臂轴：平贴沿顶
    zHigh = zLow + stack           # 右前臂轴：带压叠在左臂上
    lw = Vector((-0.042, -0.190, zLow))
    rw = Vector((0.038, -0.200, zHigh))
    le = Vector((0.118, -0.138, RAIL + 0.022))
    re = Vector((-0.118, -0.138, RAIL + 0.026))
    dl = solve_arm(lh, CHAIN, lw, le)
    dr = solve_arm(rh, RCHAIN, rw, re)
    bpy.context.view_layer.update()
    print("HUG2", label, "res", round(dl,3), round(dr,3),
          "Lw", [round(v,3) for v in (mw @ lh.head)], "Le", [round(v,3) for v in (mw @ pb[CHAIN[1]].head)],
          "Rw", [round(v,3) for v in (mw @ rh.head)], "Re", [round(v,3) for v in (mw @ pb[RCHAIN[1]].head)])
    for cam, tag in CAMS:
        sc.camera = cam
        sc.render.filepath = os.path.join(OUT, f"{label}_{tag}.png")
        bpy.ops.render.render(write_still=True)
print("DONE")
