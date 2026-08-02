# 贴身环抱托胸验证：lean 末帧 + 托胸(强上旋抬胸底) + solver 直接解贴身环抱臂 → 双机位渲染
import bpy, os
from mathutils import Euler, Vector

OUT = os.environ.get("HUG_OUT", r"C:/Users/tliu7/ideahub/app/assets-private/hug")
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r"C:/Users/tliu7/ideahub/app/assets-private/milltina-anim.glb")
arm_obj = next(o for o in bpy.data.objects if o.type == "ARMATURE")
if arm_obj.animation_data is None:
    arm_obj.animation_data_create()
arm_obj.animation_data.action = bpy.data.actions["lean"]
END = int(bpy.data.actions["lean"].frame_range[1])
pb = arm_obj.pose.bones
mw = arm_obj.matrix_world
CHAIN = ["mixamorig:LeftArm", "mixamorig:LeftForeArm", "mixamorig:LeftHand"]
RCHAIN = ["mixamorig:RightArm", "mixamorig:RightForeArm", "mixamorig:RightHand"]
lh = pb["mixamorig:LeftHand"]; rh = pb["mixamorig:RightHand"]

def solve_arm(tip, chain_names, world_target, elbow_hint=None):
    bones = [pb[n] for n in chain_names[:2]]
    for b in bones:
        b.rotation_mode = "XYZ"
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
CAMS = [(make_cam("camF", (0, -1.5, 0.62), (0, -0.20, 0.76)), "F"),
        (make_cam("camS", (1.5, -0.75, 0.80), (0, -0.20, 0.76)), "S")]

# (标签, breast[ang,splay,child,swell], L腕, L肘, R腕, R肘)
GRID = [
    ("N_hug_tight", (-0.72, 0.30, -0.30, 1.15),
     (-0.040, -0.205, 0.712), (0.125, -0.195, 0.744), (0.035, -0.218, 0.728), (-0.125, -0.200, 0.744)),
    ("O_hug_low",   (-0.72, 0.30, -0.30, 1.15),
     (-0.040, -0.200, 0.700), (0.125, -0.190, 0.738), (0.035, -0.212, 0.716), (-0.125, -0.195, 0.738)),
    ("P_hug_lift80",(-0.80, 0.32, -0.34, 1.12),
     (-0.040, -0.205, 0.715), (0.125, -0.195, 0.744), (0.035, -0.218, 0.730), (-0.125, -0.200, 0.744)),
]
for label, (ang, splay, child, swell), lw, le, rw, re in GRID:
    bpy.context.scene.frame_set(END - 1); bpy.context.scene.frame_set(END)
    for name, side in [("Breast_L", 1), ("Breast_R", -1)]:
        b = pb[name]; b.rotation_mode = "QUATERNION"
        b.rotation_quaternion = b.rotation_quaternion @ Euler((ang, splay * side, 0), "XYZ").to_quaternion()
        b.scale = (swell, swell, swell)
    for name in ["Breast_L.001", "Breast_R.001"]:
        b = pb[name]; b.rotation_mode = "QUATERNION"
        b.rotation_quaternion = b.rotation_quaternion @ Euler((child, 0, 0), "XYZ").to_quaternion()
    bpy.context.view_layer.update()
    dl = solve_arm(lh, CHAIN, lw, le)
    dr = solve_arm(rh, RCHAIN, rw, re)
    bpy.context.view_layer.update()
    print("HUG", label, "res", round(dl, 3), round(dr, 3),
          "Lw", [round(v, 3) for v in (mw @ lh.head)], "Rw", [round(v, 3) for v in (mw @ rh.head)])
    for cam, tag in CAMS:
        sc.camera = cam
        sc.render.filepath = os.path.join(OUT, f"{label}_{tag}.png")
        bpy.ops.render.render(write_still=True)
print("DONE")
