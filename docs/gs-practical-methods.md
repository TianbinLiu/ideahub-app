# 高斯泼溅的实用方法：从「改不了光」到分层工程

> 2026-11-25 · **研究产出：只写文档，不改代码、不含图片。**
> 起因：B 站 [BV14ss56SEqq](https://www.bilibili.com/video/BV14ss56SEqq/) 评论区（30 条热门，2026-11-25 抓取）里 9 条说法。任务是把每条对上**论文**与**工程方案**，然后回答"我们这张桌子该怎么选"。
> 上游三份（本文不重复它们的内容，只补论文与方法）：
> [gaussian-splatting-workshop.md](gaussian-splatting-workshop.md)（场景边界 / Atlas 口径 / 窗与光照混合方案）、
> [gs-step0-splat-log.md](gs-step0-splat-log.md)（第 0 步资产台账与读数）、
> [engine-evaluation-workshop3d.md](engine-evaluation-workshop3d.md)（引擎路线）。
> **口径**：论文给标题 + 年份 + 链接，会议 / 期刊只写查证过的；工程给仓库或文档链接；**查不到的写「未核实」，不编论文名与数字**。人日是估算，不是承诺。

---

## 0. 一页结论：评论区 9 条，哪条对

| # | 评论原话（节选） | 判定 | 一句话理由 | 详见 |
|---|---|---|---|---|
| 1 | 「远看还行，不能近看……最后还是要手搓」 | **对（有前提）** | 近看的问题分三类：混叠（Mip-Splatting 治）、表面不存在（2DGS / SuGaR / GOF 治）、覆盖不足（只能靠采集与混合网格）；治完仍要人工清理 | §1.3、§2.1 |
| 2 | 「光影是靠材质画上去的，涉及动画基本没戏」 | **半对（机制说法要纠正）** | 不是"材质贴图"，是**光被积分进颜色**（球谐只是存法，我们这份连高阶 SH 都没有）；"没戏"对 splat 本身成立，但可动物体可以拆出去用 mesh、或走 4DGS | §1.2、§2.4 |
| 3 | 「光影变不了，有 4D 高斯可能能实现」 | **前半对，后半句错** | 4D 只加**时间维**，不加光照模型；改光要靠逆渲染（GS-IR / R3DG）或多套烘焙 | §2.2、§2.4 |
| 4 | 「Blender 的高斯可以一定程度打光，但效果不太好」 | **对** | Blender 5.3 原生支持 splat；默认自发光，换成 Diffuse BSDF 只能粗略重打光（没有可靠法线 / 材质） | §2.2 |
| 5 | 「场景内不能 rig 是硬伤……只生成不需要 rig 的部分，rig 的物体另外建」 | **对，且最实用** | splat 没有骨骼 / 蒙皮 / 运动模型；静态布景用 splat、可动物体用 mesh，正是本文 §3 的分层 | §3.2 |
| 6 | 「高斯转模型不就可以了」「转网格就能正常打光」 | **方向对，代价被低估** | SuGaR / 2DGS / GOF / Atlas splats2Mesh 都能转；但薄结构、透明、反光会坏，视角相关高光退化成烘焙色，还要重拓扑 / UV / 材质 | §2.1 |
| 7 | 「最多 24 张图，花 5000 积分导出训练高斯」 | **价格对，张数过时** | 今天 refined 收 2~512 帧（推荐 8~16 视角）、draft 收 2~32 帧；refined 5,000 credits（$5）、draft 500 credits | §5.1 |
| 8 | 「多角度拍，各自生成高斯再拼接，解决单视角穿帮」 | **方向对，工序错** | 正解是"重叠覆盖 + 一次联合位姿 + 一次重建"；各建各的再拼会带来接缝、光照不一致、重叠区 α 偏亮 | §4.4 |
| 9 | 「以前转一转视角就都是镂空的」 | **对（历史与现状都成立）** | 成因是覆盖不足 + 生成视角不一致 + 薄结构缺段；今天靠多视角 / 表面正则 / 背景兜底缓解，但转到没拍过的地方仍然镂空 | §1.4 |

★ **一句话**：这 9 条里没有"全错"的，错的主要是把**一个表示问题**（radiance 采样没有光照模型）说成了**工艺问题**；而"能改光"的三条路都真实存在，只是各自有明确代价（§2）。

---

## 1. 基础：为什么"改不了光"是定义问题，不是工程没做好

### 1.1 原论文到底存了什么

3D Gaussian Splatting（Kerbl、Kopanas、Leimkühler、Drettakis，*3D Gaussian Splatting for Real-Time Radiance Field Rendering*，SIGGRAPH 2023，[arXiv:2308.04079](https://arxiv.org/abs/2308.04079)｜[项目页](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)｜[参考实现](https://github.com/graphdeco-inria/gaussian-splatting)）把一个场景表示成几十万到几百万个**各向异性高斯**，每个高斯存这些量：

| 分量 | 维度 | 说明 |
|---|---|---|
| 中心位置 `μ` | 3 | 世界坐标 |
| 旋转 `q`（四元数） | 4 | 决定椭球朝向 |
| 缩放 `s` | 3 | 决定三个轴的长度（各向异性） |
| 不透明度 `α` | 1 | 经 sigmoid，参与 α 混合 |
| 颜色 | **48** | **3 阶球谐（SH）**：16 个基函数 × RGB |

合计 **59 个浮点**。渲染是 tile-based 光栅化：把高斯投影到屏幕 → 按深度排序 → 逐个 α 混合。**整条管线里没有"取灯光信息"这一步。**

> ⚠️ 这是**论文的表示**。我们这份资产（2026-11-25 Atlas 导出）的 SPZ 头里 `shDegree = 0` —— 也就是**只有 DC 颜色、没有高阶球谐**（见 §3.1 的资产头）。所以"视角相关高光"在**我们这一份**里根本不存在；下面讲 SH 的地方都是通用原理，别拿它当我们的资产描述。

准确结论（不是形容词）：

1. **颜色是"从某个方向看过去有多亮"**，即 `c(d) = Σ c_i·B_i(d)`，`d` 是视角方向。训练时把「当时的光 × 材质 × 几何」一起积分进了这 48 个系数。
2. 因此球谐能表达**视角相关的高光**（看起来"有反光"），但它只随**视角**变、不随**光源**变 —— 这是"看起来对"和"能重打光"的分界线。
3. 没有法线、没有 BRDF、没有折射率、没有阴影贴图。⚠️ PLY 里虽然有 `nx,ny,nz` 三个字段，但那是初始化时从 SfM 点云带过来的、官方实现里直接写 0，**渲染不用、训练也不监督** —— 别把它当法线。
4. 所以「改灯」= 改 radiance = **要么重训，要么做逆渲染把材质与光解耦，要么换一套烘焙**。三条路就是 §2。

### 1.2 三句话把"能 / 不能"划清

- **能**：静态、固定光、近看不过分的布景；视角内插；实时渲染；和照片一致的材质感。
- **不能**：改灯位 / 强度 / 色温 / 阴影；挪动物体（阴影不会跟着变）；调单个物件（没有"物件"这个概念，只能按空间裁）；骨架动画。
- **可以绕**：换烘焙（多套）、拆物件（分割 / 裁切）、可动物体换 mesh、离线转网格或重光照后再进引擎。

### 1.3 「近看不行」和「镂空」是两个问题

这两件事经常被混成一句"精度不行"，但成因与解法完全不同：

| 现象 | 成因 | 对应方法（论文 / 工程） | 代价 |
|---|---|---|---|
| 放大有小颗粒 / 闪烁 / "一个个小球" | 高斯投影到屏幕的足迹小于 1 像素 → 混叠 | **Mip-Splatting**（CVPR 2024 Best Student Paper，[arXiv:2311.16493](https://arxiv.org/abs/2311.16493)｜[项目页](https://niujinshuchong.github.io/mip-splatting/)）：3D 平滑 + 2D Mip 滤波 | 略糊；训练多尺度采样 |
| 近看没有"面"，是一层半透明壳 | 表示的是**体积密度**，不是表面；椭球叠出来的等值面发虚 | **2DGS**（SIGGRAPH 2024，[arXiv:2403.17888](https://arxiv.org/abs/2403.17888)｜[项目页](https://surfsplatting.github.io/)）、**SuGaR**（CVPR 2024，[arXiv:2311.12775](https://arxiv.org/abs/2311.12775)）、**GOF**（SIGGRAPH Asia 2024，[arXiv:2404.10772](https://arxiv.org/abs/2404.10772)） | 要重训 / 提取网格；薄结构与反光仍难 |
| 转到某个角度整块没了 / 背景透出来 | **覆盖不足**：只拍了半球、或单图生成只"想象"了部分视角 | 采集规范（重叠 ≥50%，下限 ~10%；单房间 8~16 视角）、联合位姿、背景兜底 | 多拍、重建费、时间 |
| 椅子腿、线缆、吊灯杆断成两截 | 结构比高斯尺度还细 | 提高拍摄分辨率 + **别指望重建，直接用 mesh 补** | 建模工作量 |
| 玻璃 / 镜面 / 水面糊成一层雾 | 视角相关高光不守恒；没有折射 | 网格 + PBR 替代；偏振镜；哑光处理 | 资产改造 |
| 重影 / 同一张桌子出现两份 | 输入视角之间不一致（生成视角乱摆）或位姿误差 | 提交前核一致性（Atlas 文档给了两张桌子重叠的实例）；重跑 COLMAP / 重生成 | 返工 |
| 远处 / 背景糊 | 视角分布不均、大场景 | 分块重建（**VastGaussian**，CVPR 2024）、层次化 LOD（**Hierarchical 3DGS**，SIGGRAPH 2024，[arXiv:2406.12080](https://arxiv.org/abs/2406.12080)） | 工程复杂度 |

> Atlas 官方文档（[Splat best practices](https://docs.atlas.worldlabs.ai/splat-best-practices)，已读）自己就把 **大面积平墙、天空、植被、人脸、薄结构、窗户** 列为"要重点检查"的六类，并写清"整体房间好不代表每个物体都对"。这段和评论区第 1、9 条说的是同一件事。

### 1.4 「以前转一转就镂空」今天为什么好一些，但仍然没消失

拆开看有五个成因，按"能不能靠软件治"排序：

1. **拍不到的地方就是没有**（最根本）。单图 / 少量视角时代，模型只能"脑补"没看到的区域，一转就露馅。今天的做法是**覆盖式采集**（同一圈多角度、重叠 ≥50%），把"没看到"变成"看到得少"。
2. **生成视角之间不一致**。Atlas 的文档举的例子很典型：两张生成图的餐桌形状 / 朝向不同，重建出来就是两层重影的桌子。这不是 splat 的锅，是输入不一致。
3. **表面约束不足**。原版 3DGS 只对像素负责，对"表面在哪"没有约束；2DGS / SuGaR / GOF 用表面正则把椭球压成面，侧看才不"透"。
4. **薄结构欠采样**。视角少 + 尺度大，细结构直接被高斯吞掉；提高分辨率或干脆用 mesh。
5. **观看越界**。任何重建都只对"拍摄锥体"负责；把相机推到墙外、或者转到背面，看到的是"场景的壳"。工程上的兜底是**永远别让人看到场景外**：splat 外面放一层背景 / skybox / 黑场，比补洞便宜得多。

★ 结论：**"镂空"是覆盖问题，不是渲染 bug**；"近看不行"是采样与表面问题。两者都不能靠"换个查看器"解决。

---

## 2. 让高斯"能吃光 / 能改光"的三条路线

### 2.1 路线 A：转网格（splat → mesh → PBR，之后就能正常打光）

| 方法 | 年份 / venue | 做法 | 链接 |
|---|---|---|---|
| **SuGaR** | CVPR 2024 | 表面对齐正则把高斯"压"到表面上，再 Poisson 提取网格；论文自述单卡几分钟 | [arXiv:2311.12775](https://arxiv.org/abs/2311.12775)｜[Anttwo/SuGaR](https://github.com/Anttwo/SuGaR) |
| **2DGS** | SIGGRAPH 2024 | 把 3D 椭球换成**有朝向的 2D 圆盘**，ray–splat 求交做透视正确的 splatting；网格用 **TSDF 融合**（基于 Open3D）提取 | [arXiv:2403.17888](https://arxiv.org/abs/2403.17888)｜[hbb1/2d-gaussian-splatting](https://github.com/hbb1/2d-gaussian-splatting) |
| **GOF** | SIGGRAPH Asia 2024 | 从 ray-tracing 体积渲染导出**不透明度场的 level set**，Marching Tetrahedra 提网格；**不走 TSDF / Poisson**，项目页自述背景几何比 2DGS 好、细节比 SuGaR 好 | [arXiv:2404.10772](https://arxiv.org/abs/2404.10772)｜[项目页](https://niujinshuchong.github.io/gaussian-opacity-fields/) |
| **Atlas splats2Mesh** | 服务（无年份） | 把 splat 资产丢给 `splats2Mesh` 换网格 | [API 文档](https://docs.atlas.worldlabs.ai/api-reference/splats2-mesh) |
| **Blender 5.3** | 2026-11 | **原生**把 splat 按 PLY / SPZ 导入成**点云**，可用 Geometry Nodes 加工，Workbench / EEVEE / Cycles 渲染 | [5.3 发布页](https://www.blender.org/download/releases/5-3/)｜[渲染说明](https://developer.blender.org/docs/release_notes/5.3/rendering/)｜[Atlas 的 Blender 页](https://docs.atlas.worldlabs.ai/blender) |
| **Unity / UE** | 工程 | 两个渲染插件都只负责**渲染** splat，不负责转网格；要打光仍需先离线转 mesh 或做重光照 | [UnityGaussianSplatting](https://github.com/aras-p/UnityGaussianSplatting)｜[XV3DGS-UEPlugin](https://github.com/xverse-engine/XV3DGS-UEPlugin) |

**转成 mesh 之后，代价是什么（逐条）**

1. **薄结构先死**：椅子腿、线缆、吊灯杆、窗棂 —— 高斯本来就糊，等值面一提取就断；SuGaR 的 README 也要你调 `vertices_density_quantile` 才有细节。
2. **透明与反光没法表达**：玻璃、水面、亮面漆在 mesh 上只剩一个"平均颜色"，因为 SH 里那点视角相关高光被烘成 albedo / 顶点色。
3. **拓扑碎**：一间房提出来是几万个碎片，要重拓扑、UV 展开、法线修正 —— 这已经是"重做资产"，不是"导一下"。
4. **颜色是烘死的**：转出来的贴图带的是**拍摄时的光**；想要别的光，PBR 材质得重新画 / 重新烘。
5. **尺寸与对齐**：splat 的世界没有米，转出来的 mesh 也一样；进了引擎还要对一次尺度与朝向（我们第 0 步已经踩过，见 step0 log §3）。

> **Blender 那条路具体怎么走**：splat 进 Blender 是**点云**（不是网格），要出网格得再用 Geometry Nodes 的"Points to Volume → Volume to Mesh"（有损、且要几十万点才成形），或者**干脆用 SuGaR / 2DGS / GOF 离线出网格再导入**。前者适合"只要个大概形状 / 做碰撞"，后者才是"要能正常打光"的路线 —— 评论 6 把这两件事混成一句了。

★ 结论：**不要整间房转网格**。只转"必须参与光照 / 碰撞 / 引擎原生管线"的少数件：**桌面、窗框窗棂、炉台**。其余留在 splat 里。

### 2.2 路线 B：重光照（relighting，做逆渲染把光和材质分开）

原理三步：给每个高斯（或它所在的表面）估计 ① **法线** ② **材质**（albedo / roughness / metallic） ③ **环境光**（球谐 / SG / env map），然后用可微渲染在**新光源**下重渲一遍。

| 方法 | 年份 / venue | 关键点 | 链接 |
|---|---|---|---|
| **GS-IR** | CVPR 2024 | 用 forward mapping 体积渲染估计**几何 / 材质 / 环境光照**（未知光照条件）：法线用"深度导出"的正则，间接光用烘焙遮挡近似 | [arXiv:2311.16473](https://arxiv.org/abs/2311.16473)｜[lzhnb/GS-IR](https://github.com/lzhnb/GS-IR) |
| **R3DG**（Relightable 3D Gaussian） | ECCV 2024 | BRDF 分解 + **ray tracing** 处理相互反射 / 阴影 | [arXiv:2311.16043](https://arxiv.org/abs/2311.16043)｜[NJU-3DV/Relightable3DGaussian](https://github.com/NJU-3DV/Relightable3DGaussian) |
| **GaussianShader** | CVPR 2024 | 给高斯加 shading function，反光部分留给**残差颜色**，专门对付反射表面 | [arXiv:2311.17977](https://arxiv.org/abs/2311.17977)｜[Asparagus15/GaussianShader](https://github.com/Asparagus15/GaussianShader) |

**关于"Gaussian Relight"这个名字**：我按标题检索**没有找到**一篇就叫 *Gaussian Relight* 的论文（**未核实**）。"Relightable 3DGS 系列"是一大类（2024 起每年都有新变体，例如 2026 的 [LumiMotion: Improving Gaussian Relighting with Scene Dynamics](https://www.openaccess.thecvf.com/content/CVPR2026/html/Kaleta_LumiMotion_Improving_Gaussian_Relighting_with_Scene_Dynamics_CVPR_2026_paper.html)，CVPR 2026）——本文只列上面三篇**有代码 / 项目页、可复现**的代表，不凑数。

**效果边界（这条比论文名字重要）**

- **能吃**：室内、近平面、**漫反射为主**的物体；单方向主光 + 环境光的换光；离线出图。
- **吃不动**：镜面 / 玻璃 / 水（需要折射与多次反射）、细小遮挡（阴影会漏）、大面积纯色墙（法线估不准）。
- **本质歧义**：albedo 与光照可以互相补偿（"这里白"和"这里被照亮"在单视角下不可分），所以材质往往是"看起来对"而不是"物理对"。
- **成本**：每场景单独优化（论文级代码 + 调参），训练 / 显存都远超原版 3DGS；**不能直接驱动手机上的 200 万高斯实时渲染**。

**Blender 那条评论的准确答案**：Blender 5.3 原生支持 splat（[发布页](https://www.blender.org/download/releases/5-3/)），导入后默认用**自发光**着色 —— 也就是"原样显示拍下来的颜色"；把 Emission 换成 Diffuse BSDF 可以**粗略**重打光，但因为没有可靠法线 / 材质，效果就是评论区说的"一定程度、不太好"（[tutkit 的 5.3 说明](https://www.tutkit.com/en/news/1035-blender-5-3-splats-project-system-vulkan)、[DIGITAL PRODUCTION](https://digitalproduction.com/2026/11/11/blender-5-3-splat-happens-and-everything-else-gets-better/)）。★ 这条**不能**当"我们的运行时方案"，只能当离线试光。

### 2.3 路线 C：编辑式（不做真光照，改烘焙）—— 我们该走的那条

| 做法 | 具体手段 | 换来什么 | 代价 |
|---|---|---|---|
| **C1 多套烘焙 + 交叉淡化**（方案已定：workshop §9.3a，未落地） | 同一位姿、同一批图，按不同光照重建 2~3 套；运行时调 `SplatMesh.opacity` 淡入淡出 + `recolor` 补色温 | 整套房间的光都变（含 splat） | 体积 ×N；只能**离散状态**之间切；两套同时在场显存 ×2；淡化中途 α 不是简单相加（0.5/0.5 那一帧合成不透明度只有 ~0.75，背景会透一点） |
| **C2 分割 / 分组** | **Gaussian Grouping**（ECCV 2024，[arXiv:2312.00732](https://arxiv.org/abs/2312.00732)）做对象级分组；**SAGA**（[arXiv:2312.00860](https://arxiv.org/abs/2312.00860)）用 2D prompt 做可提示分割；**Feature 3DGS**（[arXiv:2312.03203](https://arxiv.org/abs/2312.03203)）把 2D 特征蒸馏进高斯；工程侧 SuperSplat 里框选手删 | 把火 / 灯 / 人物 / 可动物体从 splat 里摘出来，单独处理或换 mesh | 分割边界粗；逐场景跑；改完要重新导出 / 重新压 |
| **C3 擦掉火与光斑**（"火必须熄灭再做"） | 在 SuperSplat / Blender 里框选删除，再用邻近高斯缩放 / 克隆补洞；或者**整块换成 mesh**（炉台） | 场景里不再有烘死的火光，后面用实时火去照亮 | 每次改烘焙都要重做一遍（成本 ×N）；删除后边缘 α 突变、洞里会透背景 |
| **C4 shader 调制（dyno）** | Spark 的 `objectModifiers` / `worldModifiers` 是**逐 splat 的 GPU 函数**，可以按世界坐标算"离火多远"乘系数 | 火闪时 splat 整体明暗呼吸 | **没有法线 ⇒ 没有方向、没有影子**；只能当氛围，不能当主光 |

> "SplatSeg" 这个名字：检索到的近似工作是 **SplatSeg3D**（2026，arXiv:2611.32716，零样本点云分割），但**没有找到恰好叫 "SplatSeg" 的论文**（**未核实**）。功能上等价的是上面 Gaussian Grouping / SAGA 这一族。

★ 我们的结论（与 [workshop §9.3](gaussian-splatting-workshop.md) 一致）：**C1 + C3 做主路，C2 做资产准备，C4 只做夜间补光。**

### 2.4 动态 / 4D：评论区的"4D 高斯"现实到什么程度

| 方法 | 年份 | 表示 | 链接 |
|---|---|---|---|
| **4D Gaussian Splatting (4D-GS)** | CVPR 2024 | 3D 高斯 + **变形场 / 时间条件** | [arXiv:2310.08528](https://arxiv.org/abs/2310.08528)｜[hustvl/4DGaussians](https://github.com/hustvl/4DGaussians) |
| **Dynamic 3D Gaussians** | 3DV 2024 | 每个高斯带**持久运动 + 旋转**，可做 6-DoF 跟踪 | [arXiv:2308.09713](https://arxiv.org/abs/2308.09713)｜[JonathonLuiten/Dynamic3DGaussians](https://github.com/JonathonLuiten/Dynamic3DGaussians) |
| **Spacetime Gaussians** | CVPR 2024 | 多项式运动 + 特征 splatting | [CVF 页面](https://openaccess.thecvf.com/content/CVPR2024/html/Li_Spacetime_Gaussian_Feature_Splatting_for_Real-Time_Dynamic_View_Synthesis_CVPR_2024_paper.html) |
| **SC-GS** | CVPR 2024 | 稀疏控制点驱动高斯，**可编辑运动** | [CVF 页面](https://openaccess.thecvf.com/content/CVPR2024/html/Huang_SC-GS_Sparse-Controlled_Gaussian_Splatting_for_Editable_Dynamic_Scenes_CVPR_2024_paper.html) |

**现实边界（逐条）**

1. **4D ≠ 可打光**。这四篇都在解决"**动起来**"，没有一篇引入 BRDF / 光源模型；改光仍要回到 §2.2 或 §2.3。评论区把"4D 高斯"当成"能改光"是**概念错位**。
2. **采集变了**：不再是"拍一圈照片"，而是**多视角视频 / 单目视频 + 每帧位姿**；运动模糊、曝光变化、动态遮挡都会进来。
3. **成本随时长线性涨**：变形场 / 每帧状态要训练、要存；存储随帧数增长。
4. **一致性靠约束**：物体穿模、闪烁、长序列漂移都是常见失败；SC-GS 这类"控制点"方案就是为可编辑 + 稳定。
5. **不能"发明"新动作**：只能重放、插值、或在控制点上改；它不是骨骼动画系统。

★ 对我们的判断：**火、卡牌、人物都不该走 4DGS**。火是 shader，人物是骨骼 mesh，卡牌是 mesh。4DGS 的适用场景是"要一段拍下来的表演，且不打算改光"。

---

## 3. 我们的场景怎么选（结论）

### 3.1 现状（资产与预算来自仓库台账；真机 fps 是本轮交接的读数）

| 项 | 值 | 出处 |
|---|---|---|
| 渲染栈 | `three@0.180` + `@react-three/fiber@9.3` + `@sparkjsdev/spark@2.4.0` | `package.json` |
| 资产 | **2,000,000 高斯** / `31,244,367 B` = **29.8 MiB** / SPZ | [gs-step0-splat-log.md](gs-step0-splat-log.md) §1 |
| 资产头（本次现读） | SPZ **v2**、`numPoints = 2,000,000`、**`shDegree = 0`（无高阶球谐）**、`fractionalBits = 12`、`flags = 64`；文件本身是 **GZIP** 过的（`1f 8b`） | 解压头部 32 字节读出来的（2026-11-25） |
| 资产密度 | **≈15.6 B / 高斯**（GZIP 后；≈ 每 10 万高斯 1.5 MiB） | 上面两数相除 |
| 真机 | **40.7 fps**（本轮交接的读数；**分辨率 / dpr / 档位没记**，验收要按同一口径复测，否则不可比） | 主人真机角标（仓库 log 里还写着"真机未测"，待回填） |
| 桌面 | 要**单独做哑光 PBR 网格**（卡牌深度、窗光、影子） | [workshop §9.2](gaussian-splatting-workshop.md) |
| 火 | 要**真光照**（点光会闪、要照亮桌面与墙） | 本轮任务 |
| 包体预算 | 单份 **8~12 MiB** | [step0 log §5](gs-step0-splat-log.md) 风险 2 |
| 已知天花板 | 桌面小物件（天平、马克杯）从盖板里浮出来，是一块琥珀色糊斑 | step0 log §5-1 |

> ★ 先记住一个换算：**按当前 SPZ 密度，每 10 万高斯 ≈ 1.5 MiB**。所以"≤12 MiB"≈ **≤80 万高斯**；"120 万高斯"≈ **18 MiB**。这个换算决定了 §4.1 的路线顺序。

### 3.2 分层：谁进 splat、谁进网格、谁贴图

| 元素 | 归属 | 理由 | 验收 |
|---|---|---|---|
| 墙、书架、木梁、地毯、织物、摆件、杂物 | **splat** | 静态、哑光、有纹理，正是它的强项 | 1 米内看不出接缝；不闪 |
| **桌板 + 桌沿** | **mesh（哑光 PBR）** | 卡牌要压在上面（深度）、窗光要落在上面（影子）、火要照亮它 | 窗棂的影子边界清楚；卡牌不穿插 |
| 桌面小物件（天平、杯、烛台） | 从 splat 里**切掉**，改 mesh 或单独一小份 splat | 现在从盖板顶面浮出来（step0 §5-1） | 近景没有浮出物 |
| 窗框 / 窗棂 / 窗台 | **mesh** | 要投影 ⇒ 必须写深度的几何 | 窗棂投影落在桌面背光侧 |
| 玻璃 | **透射材质**（`MeshPhysicalMaterial`，`transmission`）或"窗外不透明板 + 反射" | splat 没有法线 / 折射率 | 转相机时反射跟着动 |
| 窗外 | **两层视差板**（远层天空 + 近层剪影）/ 20~30 秒循环视频纹理 | 无限远 + 高动态，重建必糊 | 亮度与室内对得上；不"像贴图" |
| **火** | **体积 / 粒子 / 视频纹理** + 点光 + 光照贴图 | 动态、自发光，不能进 splat | 见 §3.3 验收 |
| 卡牌 / NPC / 玩家手臂 / 投影光 / 全息 | **mesh + shader**（不进 splat） | 要动、要点选、要交互 | 已有实现，不动 |

★ 这张表与 [workshop §9.2](gaussian-splatting-workshop.md) 一致，只是把"桌面要不要拿出来"这一条**拍死**：**拿出来**。留着它，窗光永远照不到桌面，火也永远照不亮桌子。

### 3.3 火的正确做法

**火的三种实现（先选型）**

| 实现 | 观感 | 手机成本 | 什么时候用 |
|---|---|---|---|
| 体积 raymarch shader（噪声 + 温度映射 + 黑体色） | 最好，能绕、能看进火里 | 高（每像素几十步，手机上要限分辨率） | "追求质量"档；只在火占屏 <20% 时开 |
| 2~3 层 additive billboard 序列帧 / 视频纹理 | 好，手机友好 | 低（一张循环贴图 + 少量粒子） | **推荐主路** |
| 纯粒子（GPU points） | 一般，容易"塑料" | 中 | 火星 / 飞灰等点缀 |

**光怎么落到 splat 上（这是核心矛盾）**

splat 的材质是 `ShaderMaterial` 且没开 `lights: true`，three 只对"要灯光的材质"上传灯光 uniform ⇒ **点光照不到 splat**（[workshop §9.2.1](gaussian-splatting-workshop.md) 已经读过源码）。所以"火照亮墙"只有三条接法：

| 接法 | 做法 | 效果上限 | 工作量（估） |
|---|---|---|---|
| **a. 两套烘焙 + 交叉淡化**（火亮 / 火暗） | 多重建一套"炉火点着"的 splat，运行时随火焰强度淡入淡出 | 整套房间会跟着变亮；但只能离散两档，火焰"闪"要靠在两档之间抖 | 4~6 人日 / 两套 + $5/套 |
| **b. 炉台附近换 mesh** | 壁炉前 1~2 米（砖石、地面）用 mesh + 光照贴图，点光真照它 | **有方向、有明暗过渡、有跳动的影子**；接缝只在 1~2 米外可接受 | 5~7 人日（含接缝处理） |
| **c. dyno 局部提亮** | Spark `objectModifiers` 按"到火的距离"乘亮度 | 能闪，但**没有方向、没有影子** | 1~3 人日 |

★ 推荐组合：**火本体走"视频纹理 + 少量粒子"；桌面 / 炉台用 b 的缩小版（只做桌面 + 炉台前一块 lightmap）；墙面用 c 做低强度呼吸；"火亮"那一套烘焙（a）留到"追求质量"档**。理由：b 是最便宜地拿到"真光照"观感的做法，c 补氛围，a 最贵（还要再花 $5 + 每加一套 +2~3 人日）。

**四个实现细节（都是坑）**

1. **排序**：splat 是 `transparent: true` + `depthWrite: false`；火是 additive 透明 ⇒ 火必须排在 splat **之后**。我们已经在代码里定了队伍：网格 `renderOrder 0` / splat `10` / 玻璃与光效 `20`（`GsStep0Room.tsx` 头注释）。
2. **点光参数**：`decay 1.7~2`、`distance` 按炉台半径收紧（别照全屋）、`intensity` 用噪声（两个不同频率的正弦 + 随机）驱动，幅度 0.85~1.15 —— 只为"看得出来在跳"，不为物理正确。
3. **光照贴图**：火位置固定时，给桌面 / 炉台烘一张 lightmap（three 的 `lightMap` / `aoMap` 通道），火焰闪时用 uniform 乘 0.9~1.1。这是"假但便宜"的关键一招：**不增加一个实时灯，也能有方向感**。
4. **地面光斑**：火的"脚下那圈光"用一张 additive decal 贴在**地面 mesh** 上（不要让 splat 去接），比给 splat 打光便宜一个量级。

**验收（可量，照 step0 §6.1 的做法：同机位截图取均值）**

- 火灭时，墙面 / 桌面亮度**不下降** ⇒ 没有残留的烘焙火光（"火必须熄灭再做"这条的验收）；
- 火闪时，桌面与炉台前 1 米的地面有 **5~10%** 的亮度变化；墙上有 **3~8%** 的低频变化；
- 关火后 1 秒内回到基准，**不残留**光斑；
- 火焰最亮时，火附近没有"亮过桌面"的糊斑（有 = decal / lightmap 叠过头）。

### 3.4 两套组合（各写清工作量与风险）

> 人日口径：1 人、含自测与真机走查，**不含** Atlas 重建机时与美术画贴图。与 [workshop §9.3/§9.4](gaussian-splatting-workshop.md) 的估算对齐，本文只是把"火 / 压缩"并进来重算。

**组合一：最低成本能上真机（首版）**

| 项 | 内容 | 人日 |
|---|---|---|
| 1 | 桌板 + 桌沿改哑光 PBR 网格（颜色从 splat 采 / 概念图取），窗光 `DirectionalLight` + 程序化环境光 | 2 |
| 2 | 桌面小物件从 splat 里切掉（SuperSplat 框选删 + 补洞） | 1 |
| 3 | 火：视频纹理 / 序列帧 + 少量粒子 + 点光（只照 mesh）+ 桌面 / 炉台 lightmap + 火闪 uniform | 2~3 |
| 4 | 压到 ≤12 MiB（按贡献剪枝到 ~80 万 + 真机复测） | 1.5~2.5 |
| **合计** | | **≈ 6.5~8.5 人日** |

- **能拿到**：桌面有窗光、火看起来在照亮桌面、包体能进、真机 30fps 有把握（40.7 的余量够）。
- **拿不到**：火照不到 splat 墙面（只有 decal / 弱 dyno）；夜里整套房间不会变暗；窗外仍是程序化天空。
- **风险**：① 接缝（splat 桌面切口 vs 网格桌面）—— 用"网格做大一圈 + α 渐隐 3~5 cm"压；② 剪枝到 80 万后近景糊 —— 优先保桌面周围的密度，先切份再全局剪。

**组合二：追求质量**

| 项 | 内容 | 人日 |
|---|---|---|
| 1 | 组合一全部 | 6.5~8.5 |
| 2 | 窗框 / 窗棂低模 + 玻璃透射 + 窗外两层视差板 + 窗光（directional + rectArea） | 3~4 |
| 3 | 炉台 / 窗侧 1 米换 mesh（含接缝处理） | 4~6 |
| 4 | 第二套（夜间）烘焙 + 交叉淡化排程（含"中途那一帧"验收） | 4~6（+$5/套） |
| 5 | 夜间 dyno 补光（台灯 / 霓虹呼吸） | 1.5~2 |
| 6 | 空间切份 + LOD / 流式（降首进时间与显存） | 4~6 |
| **合计** | | **≈ 23~32 人日** |

- **能拿到**：白天 / 夜间两档真换光、窗光有方向、火有方向光 + 影子、首屏更快。
- **风险**：① 两套 splat 同时在场，显存与包体 ×2（见 §4.1）；② 真机 40.7 → 30 以下（阴影 + 透射 + 双套三样都是新开销）；③ 接缝从"一处"变成"两处"（窗、炉台）；④ 第二套重建如果要重拍，光照对不齐就白做。
- **触发条件**：只有当"白天 / 夜间"是**玩法必需**时才做；否则组合一 + 一张夜间后期色（`recolor` / 色调映射）就够。

★ **不要做的三件事**（省下来的就是利润）：
1. **不要把整间房转网格**（薄结构、透明、反光会坏，且要重做 UV / 材质）；
2. **不要在运行时接一套论文级 relighting**（每场景优化，手机上跑不动）；
3. **不要用 4DGS 做火 / 人物**（它只解决"动"，不解决"光"，成本还高）。

---

## 4. 工程与性能

### 4.1 压缩：三条正交的杠杆，别混着用

| 杠杆 | 代表工作 | 自述效果 | 对我们意味着 |
|---|---|---|---|
| **编码 / 格式** | **SPZ**（Niantic，[repo](https://github.com/nianticlabs/spz)，官方自述"约 10× 小于 PLY"） | 我们已在用：15.6 B/高斯 | 已经是压缩态，**再换格式的边际收益不大** |
| | **SOGS**（Self-Organizing Gaussians，Fraunhofer HHI；PlayCanvas 2.7.5 接入，[博客](https://blog.playcanvas.com/playcanvas-adopts-sogs-for-20x-3dgs-compression/)，[repo](https://github.com/fraunhoferhhi/Self-Organizing-Gaussians)） | 20×；1 GB PLY / 400 万高斯 → 55 MB（≈14 B/高斯） | 和我们 SPZ 的密度**同一量级**；换它主要买"解码走 WebP、浏览器友好" |
| | **HAC**（ECCV 2024，[arXiv:2403.14530](https://arxiv.org/abs/2403.14530)） | 用哈希网格 + 上下文熵模型做学习式压缩 | 学术前沿；工程接入成本高，先不碰 |
| **数量（剪枝 / 掩码）** | **LightGaussian**（NeurIPS 2024，[arXiv:2311.17245](https://arxiv.org/abs/2311.17245)，[repo](https://github.com/VITA-Group/LightGaussian)） | 15× 压缩、200+ FPS（论文自述） | 直接对应"2M → 1.2M"的诉求 |
| | **Compact-3DGS**（CVPR 2024，[arXiv:2311.13681](https://arxiv.org/abs/2311.13681)，[项目页](https://maincold2.github.io/c3dgs/)） | >25× 存储：可学习 mask 减点 + 网格神经场替代 SH + 矢量量化 | 思路最全面；要用得重训 |
| **LOD / 流式** | **Spark**（[repo](https://github.com/sparkjsdev/spark)） | `.RAD` LoD 树 + `paged` 共享 splat 池（文档口径：固定 GPU 池、默认 16M splats）+ HTTP Range 流式 | **我们已经在 2.4.0 的 `.d.ts` 里核到 `lod` / `lodAbove` / `paged` 三个选项**，可以直接用 |
| | **Hierarchical 3DGS**（SIGGRAPH 2024，[arXiv:2406.12080](https://arxiv.org/abs/2406.12080)） | 层次化 LOD + 流式，面向超大场景 | 我们一间房用不上，思路可借 |

**★ 一个先算清楚再动手的账**

- 当前：**15.6 B/高斯**（GZIP 后的 SPZ）。所以：
  - **≤12 MiB ⇒ ≤ 约 80 万高斯**；
  - **120 万高斯 ⇒ 约 18 MiB**（仍超预算）；
  - 每减 10 万高斯 ≈ 省 1.5 MiB。
- ⚠️ **文件已经是 GZIP**（`1f 8b`），打进 APK 的 zip **不会再压一次** ⇒ 包里就是这 ~29.8 MiB 量级；别把"压缩包"当成"还能再压"。
- 另两种格式的密度（SPZ 15.6 / SOGS ~14）说明：**"换成 SOGS"不会让 2M 变成 12MB**。要进包体，**必须减高斯数**。
- 我们的资产 `shDegree = 0` ⇒ **"降 SH 阶"这条对我们没有收益**（已经是最低阶）。能动的只有**数量**与**编码**。
- ⚠️ **不能用"截断数组尾部"来减**：我们第 0 步实测过，`SplatMesh({maxSplats})` 只分配容量不截断；手动改 `splat.splats.numSplats` 虽然少画，但打包数组是空间顺序，**截掉尾部 = 房间少一半**（[step0 log §6.3](gs-step0-splat-log.md)）。

**我们的路线（按性价比）**

1. **离线按贡献剪枝**：在训练 / 后处理里按 `opacity × 投影面积` 排，保留到 120 万，先看同机位 A/B 有没有可见糊；这一步不改资产管线。
2. **空间切份**：近景（桌 + 炉台 + 窗）保密度，远景墙 / 天花板减半；配 Spark 的 `lod`（`lod: true` 现建，或预构建 `.RAD`）。
3. **再压到 80 万**：如果包体仍然过不去。此时**必须**接受远景糊，并用"背景 / 雾 / 景深"遮。
4. **编码**：换 SOGS / HAC 或更强的熵编码 —— 收益要实测（同密度量级，见上），优先级最低；先别为一个不确定的 10% 换渲染栈。

> ★ **两个目标别混**：**「每帧只画 80 万」**（LOD / 流式，包里仍是 2M）解决的是帧率与填充率；**「包里只有 80 万」**（剪枝）解决的是包体与显存。我们要进包体，所以是后者 —— 但可以先用前者换时间。
>
> ★ **800k 还能不糊的前提是「近景不剪、远景大剪」**：按空间切份，桌 / 炉台 / 窗那一块保住原始密度，墙、天花板、远处角落剪到 1/3；**全局均匀剪到 80 万一定糊**（近看那张桌子先糊）。这也是 Spark `lod` 的思路：树越远越低，近处始终是全量。

### 4.2 three.js / Spark 集成要点（我们已跑通的部分 + 待做的部分）

**已经跑通的**（见 `src/studio/scene/GsStep0Room.tsx`、`gsStep0.ts`）

- 一个 Canvas **只能有一个** `SparkRenderer`（它按帧把场景里所有 `SplatMesh` 收进自己那个 mesh 画）；`new SplatMesh({ url, maxSplats, raycastable: false })`。
- **排序队伍写死**：网格 `renderOrder 0` / splat `10` / 玻璃与光效 `20`（splat `transparent + depthWrite:false`，挡不住之后画的透明物）。
- **8 秒超时 / 加载失败 / WebGL 能力不足 → 回退程序化书房**（`gsPhase = "failed"`），桌面与卡位坐标不变。
- **落位常量只有一处**（`gsStep0.ts` 的 `CENTER / YAW_DEG / SCALE / TARGET / SHIFT`），改朝向只改那一处。
- 环境光：程序化等距柱状图 → `PMREMGenerator` → `scene.environment`（只影响 mesh 与玻璃，**不影响 splat**）。

**待做的**（本文的工程建议）

- **LoD**：`SplatMesh({ lod: true })` 或预构建 `.RAD`；`paged` 走共享池（Spark 2.4.0 的类型里都有）。目标：首屏先出粗层，再补细节；把 [step0 §6.4](gs-step0-splat-log.md) 的浏览器基线（首进 2.9 s / 缓存后 1.4~1.7 s）在手机上压到可接受。
- **首进时间**：29.8 MiB 在手机上不是帧率问题，是**下载 + 解码**问题；LoD / 切份是唯一正解，压缩格式只帮一半。
- **真机读数要带口径**：40.7 fps 必须补上分辨率 / dpr / 档位，否则下一版没法比。角标（`gsHud.ts`）已经会打 fps / splat 数 / draw call / 首进耗时，补一列分辨率即可。
- **剔除 / 分块**：Spark 把场景里的 `SplatMesh` 统一收进自己的渲染器画（一个 Canvas 只能有一个 `SparkRenderer`），所以"按块省填充率"要靠**切份 + LoD / paging 自己的机制**，别指望 three 的逐物体视锥剔除。

### 4.3 Unity / UE 的可用实现（只作对照，换引擎的决策见 engine-evaluation）

| 引擎 | 实现 | 状态 | 备注 |
|---|---|---|---|
| Unity | [aras-p/UnityGaussianSplatting](https://github.com/aras-p/UnityGaussianSplatting) v2.0.0 | 直接读 `.ply` / `.spz`，可选 **stochastic rendering**（免排序） | 只渲染 splat，**不打光**；要光照仍走 §2.1 转 mesh |
| Unreal | [XVERSE 3D-GS UE Plugin](https://github.com/xverse-engine/XV3DGS-UEPlugin) | Niagara 路径，README 自述支持**动态光照**、Niagara 里 **20 万点以上** | "dynamic illumination" 的实现方式**未核实**；点数上限对我们是硬约束 |

★ 这两条对我们的意义是：**"换引擎"不会自动让 splat 吃光**。UE 插件的"动态光照"要么是逐 splat 调制（同我们的 dyno），要么是转成可着色几何；两者都不改 §2 的结论。

### 4.4 拼接多段 splat（回应评论第 8 条）

**先说结论**：**能拼，但"各建各的再拼"是下策**；正解是"覆盖式采集 + 一次联合位姿 + 一次重建"。

| 做法 | 怎么做 | 代价 |
|---|---|---|
| **正解：一次覆盖** | 一圈机位（重叠 ≥50%，下限 ~10%），所有图进**同一次** SfM / 位姿估计，再一次重建 | 拍摄要规划；单次重建视角数上限（Atlas：refined 2~512 帧） |
| 大场景分块 | **VastGaussian**（CVPR 2024，[CVF 页面](https://openaccess.thecvf.com/content/CVPR2024/html/Lin_VastGaussian_Vast_3D_Gaussians_for_Large_Scene_Reconstruction_CVPR_2024_paper.html)）：分区重建 + 外观建模 + 无缝合并；**Hierarchical 3DGS**：LOD + 流式 | 工程复杂度；块间外观要对齐 |
| 拼接后处理 | SuperSplat / [`@playcanvas/splat-transform`](https://github.com/playcanvas/splat-transform)（MIT CLI：变换 / 合并 / 格式转换） | **接缝**、曝光 / 色温不一致、重叠区 α 偏亮（两套高斯叠在一起，合成不透明度不是 1）、位姿误差放大 |
| 360 相机 | 等距柱状投影畸变 + 单机基线太小 ⇒ 位姿差 | **不推荐**当采集主力；多机位绕拍更稳 |

★ 如果非拼不可：**同一场拍摄、同一套光照、同一台相机参数**，重叠区留 20~30%，拼完在重叠区做一次颜色对齐（`recolor` 或离线校色），并在接缝处放一个遮挡物（柱子 / 家具）—— 这是"藏缝"而不是"消缝"。

---

## 5. 结论与建议（一页）

### 5.1 九条说法的最终判定

| # | 说法 | 判定 | 准确的说法 |
|---|---|---|---|
| 1 | 远看行、近看不行、要手搓 | **对（有前提）** | 近看有混叠 / 表面 / 覆盖三类问题，方法各治一类；但"能上游戏的近景"仍要人工清理 + 混合网格 |
| 2 | 光影是画上去的，动画没戏 | **半对** | 光被积分进颜色 / SH（不是材质贴图）；splat 本身没有运动模型，但可动物体可以拆出去 |
| 3 | 光改不了，4D 高斯也许能 | **半对，后半错** | 4D 只加时间维；改光靠逆渲染或多套烘焙 |
| 4 | Blender 能打光但效果不好 | **对** | 原生支持 + 自发光默认；换 Diffuse BSDF 只能粗略重打光 |
| 5 | 不能 rig，只生成不需要 rig 的部分 | **对（最实用）** | splat 做静态布景，可动物体另建 —— 就是本文的分层 |
| 6 | 转网格就能正常打光 | **方向对，代价低估** | 能转（SuGaR / 2DGS / GOF / Atlas），但薄结构 / 透明 / 反光会坏，且要重拓扑与重画材质 |
| 7 | 最多 24 张图、5000 积分 | **价格对，张数过时** | 今天 2~512 帧（推荐 8~16）、draft 2~32；refined 5,000 credits、draft 500 |
| 8 | 多角度各建再拼接 | **方向对，工序错** | 重叠覆盖 + 一次联合位姿 + 一次重建；拼接是下策 |
| 9 | 以前转视角就镂空 | **对** | 覆盖不足 + 视角不一致 + 薄结构；今天缓解但没消失，别让人看到场景外 |

> **第 7 条的核对底稿**（Atlas [Posed images to splats](https://docs.atlas.worldlabs.ai/posed-images-to-splats)，2026-11-25 读）：refined（默认）收 **2~512 帧**、单房间推荐 **8~16 视角**、约 50% 重叠；**5,000 credits（$5）**、15~21 分钟。draft（`refine:false`）收 **2~32 帧**、**500 credits（$0.50）**、约 30 秒。所以"5,000 积分"对，"最多 24 张"**与今天的文档不符**（要么是旧限制，要么记混了别的工具）。

### 5.2 下一步最该做的 3 件事（按性价比）

1. **桌板换哑光 PBR 网格 + 一套窗光**（**2 人日**）
   理由：这是唯一同时解决"卡牌深度 / 桌面影子 / 后面火的光照锚点"的一步；也是第 0 步验收里最后没过的那条（桌面物件浮出）。做完就能拍板"桌面到底留不留在 splat 里"。
2. **火的最小闭环：视频纹理火 + 点光（只照 mesh）+ 桌面 / 炉台 lightmap + 火闪 uniform**（**2~3 人日**）
   理由：主人的显性需求；不动 splat 就能拿到 80% 的"火在照亮房间"观感；验收可量（同机位 A/B 灰度 5~10%）。**先别做两套烘焙**（那是最贵的一档，等夜间确定是玩法必需再上）。
3. **包体压到 ≤12 MiB**（**1.5~2.5 人日 + 一次重建**）
   理由：29.8 MiB 是唯一**确定的**上架硬门槛（预算 8~12 MiB），而帧率已经 40.7；按 §4.1 的换算，目标 ≈ 80 万高斯。先剪枝 + 切份，不要动格式。

> 做完这三件，再看要不要走"组合二"（夜间第二套 + 窗玻璃 + 混合深度 + LOD）。**顺序别反**：先有"桌面真网格 + 火真光"，再谈"整套房间换光"；否则第二套烘焙做完还是要重做一遍。

### 5.3 一句话

**高斯泼溅不是"能打光的模型"，它是"拍下来的光"；把它当布景用、把要动要亮的东西做成网格与 shader，就是今天最划算的工程答案。** 评论区那 9 条里，真正错得最离谱的只有一条 —— "4D 高斯能改光"。

---

## 附录 A：论文 / 项目清单（便于核对）

| 标题 | 年份 / venue | 链接 |
|---|---|---|
| 3D Gaussian Splatting for Real-Time Radiance Field Rendering | SIGGRAPH 2023 | [arXiv:2308.04079](https://arxiv.org/abs/2308.04079) |
| Mip-Splatting: Alias-free 3D Gaussian Splatting | CVPR 2024（Best Student Paper） | [arXiv:2311.16493](https://arxiv.org/abs/2311.16493) |
| 2D Gaussian Splatting for Geometrically Accurate Radiance Fields | SIGGRAPH 2024 | [arXiv:2403.17888](https://arxiv.org/abs/2403.17888) |
| SuGaR: Surface-Aligned Gaussian Splatting… | CVPR 2024 | [arXiv:2311.12775](https://arxiv.org/abs/2311.12775) |
| Gaussian Opacity Fields | SIGGRAPH Asia 2024（Journal Track） | [arXiv:2404.10772](https://arxiv.org/abs/2404.10772) |
| GS-IR: 3D Gaussian Splatting for Inverse Rendering | CVPR 2024 | [arXiv:2311.16473](https://arxiv.org/abs/2311.16473) |
| Relightable 3D Gaussian（R3DG） | ECCV 2024 | [arXiv:2311.16043](https://arxiv.org/abs/2311.16043) |
| GaussianShader: 3D Gaussian Splatting with Shading Functions… | CVPR 2024 | [arXiv:2311.17977](https://arxiv.org/abs/2311.17977) |
| LightGaussian: Unbounded 3D Gaussian Compression… | NeurIPS 2024 | [arXiv:2311.17245](https://arxiv.org/abs/2311.17245) |
| Compact 3D Gaussian Representation for Radiance Field | CVPR 2024 | [arXiv:2311.13681](https://arxiv.org/abs/2311.13681) |
| HAC: Hash-grid Assisted Context for 3DGS Compression | ECCV 2024 | [arXiv:2403.14530](https://arxiv.org/abs/2403.14530) |
| 4D Gaussian Splatting for Real-Time Dynamic Scene Rendering | CVPR 2024 | [arXiv:2310.08528](https://arxiv.org/abs/2310.08528) |
| Dynamic 3D Gaussians: Tracking by Persistent Dynamic View Synthesis | 3DV 2024 | [arXiv:2308.09713](https://arxiv.org/abs/2308.09713) |
| Spacetime Gaussian Feature Splatting | CVPR 2024 | [CVF 页面](https://openaccess.thecvf.com/content/CVPR2024/html/Li_Spacetime_Gaussian_Feature_Splatting_for_Real-Time_Dynamic_View_Synthesis_CVPR_2024_paper.html) |
| SC-GS: Sparse-Controlled Gaussian Splatting for Editable Dynamic Scenes | CVPR 2024 | [CVF 页面](https://openaccess.thecvf.com/content/CVPR2024/html/Huang_SC-GS_Sparse-Controlled_Gaussian_Splatting_for_Editable_Dynamic_Scenes_CVPR_2024_paper.html) |
| Gaussian Grouping: Segment and Edit Anything in 3D Scenes | ECCV 2024 | [arXiv:2312.00732](https://arxiv.org/abs/2312.00732) |
| Segment Any 3D GAussians（SAGA） | 2024 | [arXiv:2312.00860](https://arxiv.org/abs/2312.00860) |
| Feature 3DGS: Supercharging 3DGS to Enable Distilled Feature Fields | 2024 | [arXiv:2312.03203](https://arxiv.org/abs/2312.03203) |
| VastGaussian: Vast 3D Gaussians for Large Scene Reconstruction | CVPR 2024 | [CVF 页面](https://openaccess.thecvf.com/content/CVPR2024/html/Lin_VastGaussian_Vast_3D_Gaussians_for_Large_Scene_Reconstruction_CVPR_2024_paper.html) |
| A Hierarchical 3D Gaussian Representation… | SIGGRAPH 2024 | [arXiv:2406.12080](https://arxiv.org/abs/2406.12080) |

## 附录 B：核实状态（哪些是读来的、哪些还没验）

- **已读原文 / 项目页**：Atlas [Posed images to splats](https://docs.atlas.worldlabs.ai/posed-images-to-splats)（2~512 / 2~32 帧、5,000 / 500 credits、8~16 视角、~50% 重叠）、[Splat best practices](https://docs.atlas.worldlabs.ai/splat-best-practices)（六类易坏特征、两桌重影的例子）、[Blender 页](https://docs.atlas.worldlabs.ai/blender)；GOF 项目页（SIGGRAPH Asia 2024、与 2DGS / SuGaR 的对比自述）；Compact-3DGS 的 CVPR 摘要（>25×）；PlayCanvas SOGS 博客（20×、1GB→55MB、WebP + PLAS）；SPZ 仓库自述（~10× vs PLY）；Mip-Splatting README（CVPR 2024 Best Student Paper）。
- **读了本仓库代码 / 类型 / 资产头**：`GsStep0Room.tsx`（SparkRenderer / SplatMesh 选项、renderOrder 队伍、8 秒回退）、`gsStep0.ts`（落位常量、`GS_DAY`、预算）、`package.json`（three 0.180 / r3f 9.3 / spark 2.4.0）；`node_modules/@sparkjsdev/spark/dist/types/SplatMesh.d.ts`（`lod` / `lodAbove` / `lodScale` / `paged` / `objectModifiers` 确实存在于 2.4.0）；**`public/models/study/gs/workshop-step0.spz` 的 GZIP 头**（解出 `NGSP` / v2 / 2,000,000 点 / `shDegree = 0` / `fractionalBits = 12` / `flags = 64`）。
- **二手、未逐条核对**：Blender 5.3 的"自发光 → Diffuse BSDF 可粗略重打光"来自 tutkit / DIGITAL PRODUCTION 的报道（官方发布页只写"native support / relight and render in Workbench, EEVEE and Cycles"）；UE 插件"动态光照"来自其 README 自述；Spark 的"默认 16M splats 共享池"来自其文档站，未在 2.4.0 上实测。
- **明确未核实**：标题恰为 *Gaussian Relight* 的论文、恰为 *SplatSeg* 的论文 —— 检索没有找到，本文按"同功能族"给了替代；Atlas 登录后界面与免费额度；真机 40.7 fps 的**分辨率 / dpr / 档位**（本轮没有拿到）；真机上"阴影 + 透射 + splat"三项同开的帧率。
- **本文没有做的事**：没有重新跑训练 / 转网格 / relighting 的任何实验；所有"效果上限"来自论文与文档自述 + 我们的工程推理，不是我们的实测。
