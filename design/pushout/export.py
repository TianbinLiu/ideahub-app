import bpy, sys, os
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index("--")+1:]
GLB, OUTDIR, GARMENT, BODY = argv[0], argv[1], argv[2], argv[3]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
dg = bpy.context.evaluated_depsgraph_get()

def world_mesh(name):
    o = bpy.data.objects[name]
    me = o.evaluated_get(dg).to_mesh()
    vs = [o.matrix_world @ v.co for v in me.vertices]
    fs = [list(p.vertices) for p in me.polygons]
    o.evaluated_get(dg).to_mesh_clear()
    return vs, fs

gvs, _ = world_mesh(GARMENT)
bvs, bfs = world_mesh(BODY)

# ★ 必须自己写 OBJ，不能用 Blender 的 OBJ 导出器：
#   它会因拆边/合并/三角化改变顶点数与顺序，而 fd_pushout 的输出是"位置数组"，
#   靠行号=顶点索引回贴，顺序一乱就全错位。
with open(os.path.join(OUTDIR, "garment_in.obj"), "w", encoding="utf-8") as f:
    f.write("# index-aligned garment\n")
    for v in gvs:
        f.write(f"v {v.x:.10f} {v.y:.10f} {v.z:.10f}\n")

with open(os.path.join(OUTDIR, "body_in.obj"), "w", encoding="utf-8") as f:
    f.write("# body with faces (BVH 需要面)\n")
    for v in bvs:
        f.write(f"v {v.x:.10f} {v.y:.10f} {v.z:.10f}\n")
    for p in bfs:
        f.write("f " + " ".join(str(i + 1) for i in p) + "\n")   # OBJ 索引从 1 开始

# 推之前的穿模基线
bvh = BVHTree.FromPolygons([tuple(v) for v in bvs], bfs, all_triangles=False)
inside = 0; deepest = 0.0
for p in gvs:
    loc, nor, idx, dist = bvh.find_nearest(p)
    if loc is None: continue
    ds = (p - loc).dot(nor)
    if ds < 0:
        inside += 1; deepest = min(deepest, ds)
print(f"EXPORT garment={GARMENT} V={len(gvs)}  body={BODY} V={len(bvs)} F={len(bfs)}")
print(f"BEFORE inside={inside} pct={100.0*inside/len(gvs):.2f} deepest={deepest:.5f}")
