# 服装外推（FoxDressPushOut）——不用 Unity 的跑法

把陷进身体的服装顶点推到体外，产物是一条 shape key（morph target），随 glTF 导出后
运行时可按需开关。BOOTH 上买的 `FoxDressPushOut` 卖的是一个 Unity 编辑器扩展，
但**拆包后发现 Unity 那层只是个填路径的表单**：

```
Assets/FoxDreddPushOut/Editor/FoxDressPushOut_Blender.cs   ← EditorWindow 外壳
Assets/FoxDreddPushOut/Editor/fd_pushout.py                ← 真正的算法
```

C# 干的事是：把网格导成 OBJ → 拼一段 bootstrap → 跑 `blender --background --python runner.py`
→ 把结果读回来做 BlendShape。算法全在 Python 里，**而且它连 `bpy` 都不 import，只用
`mathutils`（Vector / BVHTree）**——所以我们的 glTF + Blender 管线完全不需要 Unity。

## 调用契约

`fd_pushout.py` 不读 `sys.argv` 也不读环境变量，它要的是**注入到模块里的全局变量**：

| 变量 | 必填 | 说明 |
|---|---|---|
| `GAR` | ✔ | 服装 OBJ。只需要 `v` 行 |
| `BOD` | ✔ | 身体 OBJ。**必须同时有 `v` 和 `f`**（要建 BVH） |
| `BOD2` | | 第二具身体。给了就切到 **union 迭代分支**（8 次迭代 + 步长钳制）；不给是一次性投影，不迭代 |
| `OUT` | ✔ | 输出 OBJ（只写 `v`，行序 = 输入顶点序） |
| `LOG` | ✔ | 日志 |
| `CLR` | ✔ | 体外间隙（米）。Unity 侧默认 0.002 |

```
blender.exe --background --factory-startup --python-exit-code 5 --python runner.py
```

## 四个必须知道的坑

1. **直接 `blender -b -P fd_pushout.py` 会静默失败。** `main()` 确实会执行，但发现缺
   `GAR` 等全局就 print 一行然后 return——**退出码 0、不写输出、不写日志**。
   所以判成功不能只看退出码，要检查 OUT 存在且行数 == 输入顶点数。
2. **不能用 Blender 自带的 OBJ 导出器。** 输出是"位置数组"，靠行号=顶点索引回贴原拓扑；
   而 Blender 的导出器会因拆边/合并/三角化改变顶点数与顺序。必须自己写 `v` 行
   （见 `export.py`）。
3. **身体只有顶点没有面时不会报错**，而是走 fallback 把服装顶点原样拷贝一遍，
   日志里只有一行提示，结果看着"跑通了"其实什么都没做。
4. **法线朝向决定推的方向。** `nearest_signed` 用面法线判内外，绕向朝内会把衣服推**进**
   身体。用带符号体积（散度定理）判定最可靠，单点测试会被凹面和开口骗到——
   实测 Tsumire 用质心单点测出"法线朝内"，而带符号体积 +0.0045 m³ 证明其实是外向的。

## Tsumire 实跑结果（2026-08-07）

`shirt`（2688 顶点）对 `body.002`（13305 顶点 / 23276 面），`CLR=0.002`，`BOD2` 喂同一具身体副本：

| | 陷入顶点 | 最深 |
|---|---|---|
| 推之前 | 59 / 2688 (2.19%) | −36.1 mm |
| 第 1 趟 | 27 | −12.1 mm |
| 第 3 趟 | **0** | **0** |

**为什么要跑三趟**：union 分支每次迭代把位移钳在 `CLR × 1.5` = 3mm，8 次迭代 = 单趟上限
24mm。第一趟跑完最大位移正好是 0.02400——钳制饱和了，而原始最深穿模是 36mm，一趟走不完。
把 `out.obj` 回灌当 `GAR` 再跑即可，三趟后收敛。最终只有 197/2688 个顶点被动过、
平均位移 7.2mm，没有波及无关区域。

单趟耗时约 3 秒（含 Blender 启动）。

## 这个模型的一个前提缺陷

`body.002` **不是封闭网格**：36580 条边里有 3332 条开放/非流形边（VRChat 模型惯例是把衣服
底下看不见的皮肤删掉省面，脖子/手腕/脚踝也是开口圆筒）。`find_nearest` 的内外判定在开口
附近本就不可靠——实测沿脊柱轴取 19 个内部点只有 7 个被判为"体内"。

本次 shirt 的结果能收敛到 0 是因为它的穿模区域离那些开口较远。**换别的衣物（尤其裤子/袜子，
紧邻髋部和脚踝开口）之前先重跑一次开口检查**，必要时先补洞做一具封闭的身体代理再当 BOD。

## 文件

- `export.py` —— 导入 GLB，写出 index-aligned 的 `garment_in.obj` / `body_in.obj`，并打印推之前的基线
- `runner.py` —— 注入全局变量 + exec，按官方契约生成
- `apply.py` —— 读 `out.obj`，量位移与穿模，烘成 `FD_PushOut` shape key，导出 GLB
- `fd_pushout.py` —— **不入库**（BOOTH 购入内容）。从 `FoxDressPushOutV1p1.zip` 里的
  `.unitypackage` 解出，放到 `tool/` 下即可
