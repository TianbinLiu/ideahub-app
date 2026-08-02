# 伏桌姿接触表（无头）：lean 末帧 + 托胸/手臂参数网格 × 双机位离屏渲染——
# 网格真值下收敛胸/臂穿模，替代共享 Blender MCP（会被兄弟会话清场）与浏览器捕帧
# （卡渲+机位会藏浅穿透）。输出 PNG 到 scratchpad + 每组合手/肘世界坐标。
import bpy
import os
from mathutils import Euler, Vector

SRC = r"C:/Users/tliu7/ideahub/app/assets-private/milltina-anim.glb"
OUT = os.environ.get("CONTACT_OUT", r"C:/Users/tliu7/ideahub/app/assets-private/contact")
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
if arm.animation_data is None:
    arm.animation_data_create()
arm.animation_data.action = bpy.data.actions["lean"]
END = int(bpy.data.actions["lean"].frame_range[1])
pb = arm.pose.bones
mw = arm.matrix_world

# 渲染设置：Workbench 快照级
sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sc.render.resolution_x = 720
sc.render.resolution_y = 720
sc.display.shading.light = "MATCAP"

def make_cam(name, loc, look):
    cam_data = bpy.data.cameras.new(name)
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = loc
    d = (Vector(look) - Vector(loc)).normalized()
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return cam

CAM_FRONT = make_cam("camF", (0, -1.5, 0.62), (0, -0.20, 0.76))
CAM_SIDE = make_cam("camS", (1.5, -0.75, 0.80), (0, -0.20, 0.76))

# (标签, breast[angle,splay,child,swell,push], arm下移[Arm dx, ForeArm dx])
# push=沿胸骨自身轴向前顶出（臂托胸方案：胸底搁前臂线上、体积鼓在臂上前方）
GRID = [
    ("K2_armP12", (-0.50, 0.30, -0.24, 1.18, 0.0), (0.12, 0.04)),
    ("L2_armP18", (-0.50, 0.30, -0.24, 1.18, 0.0), (0.18, 0.06)),
    ("M2_armP24", (-0.50, 0.30, -0.24, 1.18, 0.0), (0.24, 0.08)),
]

BREAST = [("Breast_L", 1), ("Breast_R", -1)]
BCHILD = ["Breast_L.001", "Breast_R.001"]
ARMS = ["mixamorig:LeftArm", "mixamorig:RightArm"]
FOREARMS = ["mixamorig:LeftForeArm", "mixamorig:RightForeArm"]

for label, (ang, splay, child, swell, push), (adx, fdx) in GRID:
    # 复位到动作帧
    bpy.context.scene.frame_set(END - 1)
    bpy.context.scene.frame_set(END)
    # 托胸
    for name, side in BREAST:
        b = pb[name]
        b.rotation_mode = "QUATERNION"
        b.rotation_quaternion = b.rotation_quaternion @ Euler((ang, splay * side, 0), "XYZ").to_quaternion()
        b.scale = (swell, swell, swell)
        b.location.y += push  # 沿骨轴（指向胸尖）前顶
    for name in BCHILD:
        b = pb[name]
        b.rotation_mode = "QUATERNION"
        b.rotation_quaternion = b.rotation_quaternion @ Euler((child, 0, 0), "XYZ").to_quaternion()
    # 手臂下移
    for name in ARMS:
        b = pb[name]
        b.rotation_mode = "QUATERNION"
        b.rotation_quaternion = b.rotation_quaternion @ Euler((adx, 0, 0), "XYZ").to_quaternion()
    for name in FOREARMS:
        b = pb[name]
        b.rotation_mode = "QUATERNION"
        b.rotation_quaternion = b.rotation_quaternion @ Euler((fdx, 0, 0), "XYZ").to_quaternion()
    bpy.context.view_layer.update()
    # 记录手/肘世界坐标（供回写 FRAMES 目标）
    coords = {}
    for n in ["mixamorig:LeftHand", "mixamorig:LeftForeArm", "mixamorig:RightHand", "mixamorig:RightForeArm"]:
        h = mw @ pb[n].head
        coords[n] = [round(v, 3) for v in h]
    print("GRID", label, coords)
    for cam, tag in [(CAM_FRONT, "F"), (CAM_SIDE, "S")]:
        sc.camera = cam
        sc.render.filepath = os.path.join(OUT, f"{label}_{tag}.png")
        bpy.ops.render.render(write_still=True)
print("DONE", OUT)
