import bpy, sys, os
from mathutils import Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index("--")+1:]
GLB, FD, GARMENT, BODY = argv[0], argv[1], argv[2], argv[3]

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

def read_verts(path):
    out = []
    with open(path, encoding="utf-8") as f:
        for ln in f:
            if ln.startswith("v "):
                _, x, y, z = ln.split()[:4]
                out.append(Vector((float(x), float(y), float(z))))
    return out

gvs, _ = world_mesh(GARMENT)
bvs, bfs = world_mesh(BODY)
new = read_verts(os.path.join(FD, "out.obj"))
assert len(new) == len(gvs), f"顶点数不符 {len(new)} != {len(gvs)}"

# ① 位移统计
moved = [(a - b).length for a, b in zip(new, gvs)]
nz = [d for d in moved if d > 1e-9]
print(f"MOVED count={len(nz)}/{len(gvs)} max={max(moved):.5f} mean_moved={(sum(nz)/len(nz) if nz else 0):.5f}")

# ② 穿模前后
bvh = BVHTree.FromPolygons([tuple(v) for v in bvs], bfs, all_triangles=False)
def pen(verts):
    ins = 0; deep = 0.0
    for p in verts:
        loc, nor, idx, dist = bvh.find_nearest(p)
        if loc is None: continue
        ds = (p - loc).dot(nor)
        if ds < 0:
            ins += 1; deep = min(deep, ds)
    return ins, deep
b_in, b_deep = pen(gvs); a_in, a_deep = pen(new)
print(f"PEN before inside={b_in} deepest={b_deep:.5f}")
print(f"PEN after  inside={a_in} deepest={a_deep:.5f}")

# ③ 烘成 shape key（位移是世界坐标，要转回物体局部空间）
o = bpy.data.objects[GARMENT]
inv = o.matrix_world.inverted()
if not o.data.shape_keys:
    o.shape_key_add(name="Basis", from_mix=False)
sk = o.shape_key_add(name="FD_PushOut", from_mix=False)
for i, (a, b) in enumerate(zip(new, gvs)):
    if (a - b).length > 1e-9:
        sk.data[i].co = inv @ a
sk.value = 1.0
print(f"SHAPEKEY added '{sk.name}' on {GARMENT}, keys={[k.name for k in o.data.shape_keys.key_blocks]}")

out_glb = os.path.join(FD, "tsumire_pushout.glb")
bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", export_morph=True)
print(f"EXPORTED {out_glb} {os.path.getsize(out_glb)//1024}KB")
