# 生成 runner.py：fd_pushout.py 要的是**注入到模块里的全局变量**，
# 不是 sys.argv 也不是环境变量，所以只能靠外壳脚本注入后 exec。
# 用法: python make_runner.py <工作目录> [CLR]
import sys, os, io, shutil

WORK = os.path.abspath(sys.argv[1]).replace("\\", "/")
CLR = sys.argv[2] if len(sys.argv) > 2 else "0.002"
tool = os.path.join(WORK, "tool", "fd_pushout.py")
if not os.path.isfile(tool):
    sys.exit(f"缺 {tool}——从 FoxDressPushOutV1p1.zip 的 .unitypackage 里解出来放这儿")

# BOD2 喂同一具身体的副本：不给 BOD2 走的是"一次性投影"不迭代，
# 给了才切到 union 分支拿到 8 次迭代 + 步长钳制
body = os.path.join(WORK, "body_in.obj")
if os.path.isfile(body):
    shutil.copyfile(body, os.path.join(WORK, "body2_in.obj"))

io.open(os.path.join(WORK, "runner.py"), "w", encoding="utf-8", newline="").write(f'''import sys, os
GAR  = r"{WORK}/garment_in.obj"
BOD  = r"{WORK}/body_in.obj"
BOD2 = r"{WORK}/body2_in.obj"
OUT  = r"{WORK}/out.obj"
LOG  = r"{WORK}/py_log.txt"
CLR  = {CLR}
TOOL = r"{WORK}/tool"
if TOOL not in sys.path:
    sys.path.insert(0, TOOL)
__file__ = os.path.join(TOOL, "fd_pushout.py")
with open(__file__, "rb") as fp:
    code = compile(fp.read(), __file__, "exec")
exec(code, globals(), globals())
''')
print("runner.py ->", os.path.join(WORK, "runner.py"))
