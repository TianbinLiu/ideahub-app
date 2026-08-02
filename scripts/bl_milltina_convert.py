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

# 用户定稿：去掉围裙（外扩后仍与衣身穿模）。开关必须自洽——围裙网格删了，
# dress/skirt 就绝不能再烘 Apron_set=1：那是"穿了围裙时让开裙腰"的避让形态，
# 没围裙盖着就等于在腰线开了个真实缺口，深弯时后腰整圈露皮（用户报"后背穿模"）。
# VRChat 里不出这问题，正因为那边网格开关与形键开关是同一套配置联动的。
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
    # 深弯时后腰/臀段皮肤会从衣身后背挤出（用户报"后背穿模"）
    "Shrink_Hip": 1.0,
    "Shrink_Sock_on": 1.0,
    "Panty_squeeze": 1.0,
    "Sock_squeeze": 1.0,
    "Garters_squeeze": 1.0,
    "Foot_heel": 1.0,
})
bake_shape_mix("Milltina_cloth_dress", {"Breasts_Big": 1.0, "Cuff_shrink": 1.0})
bake_shape_mix("Milltina_cloth_panties", {"Panty_squeeze": 1.0, "Option_Tail_set": 1.0})
bake_shape_mix("Milltina_cloth_garterbelt", {
    "Panty_squeeze": 1.0, "Foot_heel": 1.0, "Sock_squeeze": 1.0, "Garters_squeeze": 1.0,
})
bake_shape_mix("Milltina_cloth_hat", {"Option_Twin tail": 1.0})

# ── 腰部收束：删围裙后腰线失去遮挡，深弯时露出一圈身体（用户报"后背穿模"）。
# Shrink 形键幅度不够（它是整体瘦身不是局部），这里对腰段身体顶点做径向内缩，
# 让不动的衣身/裙腰能盖住。只动 body，衣服网格不碰。
# 顶点色/分色渲染探针定位：深弯与站姿下从衣身透出来的是身体皮肤，且不是上下留缝
# 而是径向顶出——按相机几何反算暴露段在 z≈0.78~0.87（下肋段）。梯形剖面：中间整段
# 满额收束，两端羽化防折角。这一段永远在衣身筒内，收紧不影响任何可见轮廓；上界卡在
# 0.90 以下避开胸型。
# 胸部豁免：cinch_waist 的径向收束和 tuck_under 的塞入都会破坏形状，而胸部本来就
# 紧贴衣身内侧（到衣身的内侧距离普遍小于 margin），照做等于把整个胸拍平贴合到裙料壳
# 上——这就是用户报的"人物胸部扭曲"。用骨骼权重做豁免判据，比按高度猜区间精确得多。
BREAST_GROUPS = ("Breast_L", "Breast_R", "Breast_L001", "Breast_R001")


def breast_weighted(obj, thresh=0.01):
    """返回受 Breast 骨链影响的顶点索引集合。"""
    gi = {obj.vertex_groups[n].index for n in BREAST_GROUPS if n in obj.vertex_groups}
    if not gi:
        print("胸部豁免: 未找到 Breast 顶点组")
        return set()
    out = {v.index for v in obj.data.vertices
           if any(g.group in gi and g.weight > thresh for g in v.groups)}
    print(f"胸部豁免: {len(out)} 顶点")
    return out


WAIST_Z = (0.42, 0.52, 0.84, 0.90)   # 淡入起 / 满额起 / 满额止 / 淡出止
WAIST_SHRINK = 0.72                  # 满额段径向保留比例

def cinch_waist(zr=WAIST_Z, k=WAIST_SHRINK):
    o = bpy.data.objects.get("Milltina_body")
    if o is None:
        print("腰部收束: 未找到 Milltina_body")
        return
    skip = breast_weighted(o)
    z0, z1, z2, z3 = zr
    n = 0
    for v in o.data.vertices:
        if v.index in skip:
            continue
        z = v.co.z
        if z <= z0 or z >= z3:
            continue
        if z < z1:
            w = (z - z0) / (z1 - z0)
        elif z <= z2:
            w = 1.0
        else:
            w = (z3 - z) / (z3 - z2)
        f = 1 - (1 - k) * w
        v.co.x *= f
        v.co.y *= f
        n += 1
    kb = o.data.shape_keys.key_blocks if o.data.shape_keys else []
    print(f"腰部收束: {n} 顶点 满额×{k}，形键块 {len(kb)}")


cinch_waist()


# ── 收缩包裹：逐顶点把身体塞回衣身内侧。径向收束是"按比例猜"，总有局部猜不够；
# 这一步直接对衣身求最近点，凡落在外侧（或贴得太近）的顶点按面法线压进去留出余量，
# 是几何上确定的解，不用再试比例。姿势变化会让身体相对衣身移动，所以余量给得比
# 静态穿模所需更大一些。
def tuck_under(garment_name, zr, margin=0.012, body_name="Milltina_body"):
    from mathutils.bvhtree import BVHTree
    g = bpy.data.objects.get(garment_name)
    b = bpy.data.objects.get(body_name)
    if g is None or b is None:
        print(f"收缩包裹: 缺对象 {garment_name}/{body_name}")
        return
    gm, bm = g.matrix_world, b.matrix_world
    vs = [gm @ v.co for v in g.data.vertices]
    tris = []
    for poly in g.data.polygons:
        pv = poly.vertices[:]
        for k in range(1, len(pv) - 1):
            tris.append((pv[0], pv[k], pv[k + 1]))
    tree = BVHTree.FromPolygons(vs, tris, all_triangles=True)
    bmi = bm.inverted()
    skip = breast_weighted(b)
    n = 0
    for v in b.data.vertices:
        if not (zr[0] <= v.co.z <= zr[1]) or v.index in skip:
            continue
        p = bm @ v.co
        loc, nor, _, _ = tree.find_nearest(p, 0.25)
        if loc is None:
            continue
        depth = (p - loc).dot(nor)          # >0 在衣物外侧
        if depth > -margin:
            # 沿法线按穿透深度往里推，而不是吸附到最近点：吸附会把顶点的切向位置
            # 一并改掉，等于让身体去复制衣物表面，形状就没了
            v.co = bmi @ (p - nor * (depth + margin))
            n += 1
    print(f"收缩包裹: {body_name} ← {garment_name} {n} 顶点 margin={margin}")


tuck_under("Milltina_cloth_dress", (0.52, 0.98))
tuck_under("Milltina_cloth_skirt", (0.30, 0.55))


# ── 胸根权重平滑：90° 直角的根源是蒙皮权重梯度不连续 ──
# 线性混合蒙皮下，若顶点权重在一两圈边环内就从"全归 Spine"跳到"全归 Breast"，
# 骨头一转就必然折出硬棱。市面上的做法有三层：①把权重过渡摊到 3~5 圈边环
# ②加中间关节分摊形变梯度 ③按骨骼角度驱动的修正形键（Pose Space Deformation）。
# 这里做的是第①层——它是根因，且纯几何、不增加运行时开销。运行时那边的
# 二节跟随（0.85）相当于第②层的简化版。
def smooth_breast_weights(obj_name="Milltina_body", iters=8, rings=3):
    o = bpy.data.objects.get(obj_name)
    if o is None:
        print("胸根权重平滑: 未找到", obj_name)
        return
    gi = [o.vertex_groups[n].index for n in BREAST_GROUPS if n in o.vertex_groups]
    if not gi:
        print("胸根权重平滑: 未找到 Breast 顶点组")
        return
    me = o.data
    nbr = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices
        nbr[a].append(b)
        nbr[b].append(a)

    def bw(v):
        return sum(g.weight for g in v.groups if g.group in gi)

    # 过渡带 = 受 Breast 影响的顶点向外扩 rings 圈（只在带内平滑，胸尖与胸壁本体不动）
    band = {v.index for v in me.vertices if bw(v) > 1e-4}
    for _ in range(rings):
        band |= {n for i in list(band) for n in nbr[i]}
    idx = sorted(band)
    w = {i: bw(me.vertices[i]) for i in idx}
    for _ in range(iters):
        nw = {}
        for i in idx:
            ns = nbr[i]
            nw[i] = (w[i] + sum(w.get(n, bw(me.vertices[n])) for n in ns)) / (len(ns) + 1)
        w = nw

    grps = o.vertex_groups
    for i in idx:
        v = me.vertices[i]
        target = min(1.0, max(0.0, w[i]))
        cur_b = bw(v)
        others = [(g.group, g.weight) for g in v.groups if g.group not in gi]
        so = sum(x[1] for x in others)
        if cur_b > 1e-6:
            # 按原比例重分配 Breast 侧
            for g in v.groups:
                if g.group in gi:
                    grps[g.group].add([i], g.weight / cur_b * target, 'REPLACE')
        elif target > 1e-6 and gi:
            grps[gi[0]].add([i], target, 'REPLACE')
        if so > 1e-6:
            for gidx, gw in others:
                grps[gidx].add([i], gw / so * (1 - target), 'REPLACE')
    print(f"胸根权重平滑: 过渡带 {len(idx)} 顶点，{iters} 次迭代")


smooth_breast_weights()

# 大腿段径向收一档：裙子跟腿之后仍剩一小片捅出来，这一段永远在裙筒内，收紧零代价
def cinch_thigh(zr=(0.24, 0.32, 0.58, 0.66), k=0.88):
    o = bpy.data.objects.get("Milltina_body")
    if o is None:
        return
    z0, z1, z2, z3 = zr
    n = 0
    for v in o.data.vertices:
        z = v.co.z
        if z <= z0 or z >= z3:
            continue
        w = (z - z0) / (z1 - z0) if z < z1 else (1.0 if z <= z2 else (z3 - z) / (z3 - z2))
        f = 1 - (1 - k) * w
        v.co.x *= f
        v.co.y *= f
        n += 1
    print(f"大腿收束: {n} 顶点 满额×{k}")


cinch_thigh()


# ── 腰线搭接：衣身下摆绑 Spine、裙腰绑 Hips，深弯时两片沿相反方向走，出厂那点重叠量
# 不够就在后腰错开出一条缝，露出整圈皮肤（用户报"后背穿模"；VRChat 里由围裙盖住所以
# 看不出来，我们把围裙删了就必须自己把搭接做够）。做法是纯几何：裙腰上沿往上长、衣身
# 下摆往下长，都长进对方内部，任何弯腰角度都咬得住。长出去的部分永远在另一片里面，
# 站姿轮廓不受影响。
def overlap_seam(name, mode, span, grow, xmax=None):
    o = bpy.data.objects.get(name)
    if o is None:
        print(f"腰线搭接: 未找到 {name}")
        return
    # xmax 限定躯干范围：A 姿下手比腰低，衣身网格的全局最低点是袖口而不是下摆，
    # 不排除袖子就会把袖口往下拉长、腰缝一点没补（实测两轮无变化）
    vs = [v for v in o.data.vertices if xmax is None or abs(v.co.x) <= xmax]
    if not vs:
        print(f"腰线搭接: {name} 选区为空")
        return
    edge = max(v.co.z for v in vs) if mode == "up" else min(v.co.z for v in vs)
    n = 0
    for v in vs:
        t = (edge - v.co.z) / span if mode == "up" else (v.co.z - edge) / span
        if t >= 1.0 or t < 0:
            continue
        v.co.z += (grow if mode == "up" else -grow) * (1.0 - t)
        n += 1
    print(f"腰线搭接: {name} {mode} edge={edge:.3f} {n} 顶点 {'+' if mode == 'up' else '-'}{grow}")


# 裙腰只轻抬：抬多了会把背后牛尾开衩的上沿一起拽变形、反而撕出更大的洞。
# 主力交给衣身下摆——它是没有开口的整片壳，往下长进裙筒里，既补腰缝又从内侧
# 垫住开衩，透过开衩看到的是衣身绿而不是皮肤。

overlap_seam("Milltina_cloth_skirt", "up", 0.09, 0.10)
overlap_seam("Milltina_cloth_dress", "down", 0.12, 0.22, xmax=0.13)

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

# ── 裙身权重下移到大腿：分色渲染实测，深弯撤步时大腿会从裙面中间捅出来。
# 裙子出厂只绑髋，腿一动裙子不动，穿模是必然的——静态收紧/静态塞入都是治标。
# 游戏里长裙的标准做法是给裙子加一层裙骨或把下半部分权重分给大腿，让布跟着腿走。
# 这里做后者：按高度把权重逐渐转给左右大腿骨，左右按到大腿轴的距离软分配，
# 腰部保持全髋（裙腰不该跟腿摆），下摆保留部分髋权重（不然一迈腿裙子会像裤子一样劈开）。
def skirt_follow_legs(name="Milltina_cloth_skirt", share=0.65, z_top=0.79, z_bot=0.22):
    o = bpy.data.objects.get(name)
    if o is None:
        print("裙子跟腿: 未找到", name)
        return
    bl, br = arm.data.bones.get("mixamorig:LeftUpLeg"), arm.data.bones.get("mixamorig:RightUpLeg")
    if bl is None or br is None:
        print("裙子跟腿: 未找到大腿骨")
        return
    mw = arm.matrix_world
    segs = []
    for b, n in ((bl, "mixamorig:LeftUpLeg"), (br, "mixamorig:RightUpLeg")):
        segs.append((mw @ b.head_local, mw @ b.tail_local, n))
    for _, _, n in segs:
        if n not in o.vertex_groups:
            o.vertex_groups.new(name=n)
    grps = o.vertex_groups
    omw = o.matrix_world
    n_done = 0
    for v in o.data.vertices:
        p = omw @ v.co
        t = (z_top - v.co.z) / (z_top - z_bot)
        # 腰段 0 → 大腿段满额；下摆维持满额（穿模就发生在大腿到膝盖这一段）
        blend = share * min(1.0, max(0.0, (t - 0.10) / 0.40))
        if blend <= 1e-4:
            continue
        ds = []
        for a, b, _ in segs:
            ab = b - a
            u = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
            ds.append(max(1e-4, (p - (a + ab * u)).length))
        inv = [1.0 / d ** 2 for d in ds]
        tot = sum(inv)
        for k, (_, _, gname) in enumerate(segs):
            grps[gname].add([v.index], blend * inv[k] / tot, 'REPLACE')
        # 其余组等比缩到 (1-blend)
        legi = {grps[gn].index for _, _, gn in segs}
        others = [(g.group, g.weight) for g in v.groups if g.group not in legi]
        so = sum(x[1] for x in others)
        if so > 1e-6:
            for gi_, gw in others:
                grps[gi_].add([v.index], gw / so * (1 - blend), 'REPLACE')
        n_done += 1
    print(f"裙子跟腿: {n_done} 顶点转移至大腿骨（share={share}）")


skirt_follow_legs()

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
