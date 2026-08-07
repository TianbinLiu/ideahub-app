# Tsumire 接入笔记（BOOTH 购入的 VRChat 角色 → 工坊玩家形象）

源包：`Tsumire_ver1.30.zip`（作者命名空间 `tegral`），含 FBX + 散装 PNG 贴图 +
unitypackage。**包内没有任何授权文件**，用户口述 BOOTH 购入、可商用。
按仓库既有规矩，模型本体走 `public/models/protected/`（gitignore + 出包裁剪），
只作 DEV 试穿档，不进分发包——"可商用"与"可再分发"是两件事，出厂默认前需确认
利用規約里的再配布条款。

## 模型本身（很好）

- 55,127 顶点 / 68,482 三角面 —— 比现有 Tripo 玩家模型（63 万面）轻得多，很适合网页
- 149 根骨骼，**含完整手指骨**（拇指/食指/中指/无名指/小指 × 近中远 × 左右）
- **自带物理骨链**：后发 4 节×3 股、双马尾 3 节、裙 8 片×3 节、尾巴 6 节、缎带、猫耳
- 406 组 morph target（表情）
- 19 个 skinned mesh **共享同一套 149 根骨**（无重复骨节点，`getObjectByName` 可用）

## 已完成

1. **FBX→GLB**：`npm i --no-save fbx2gltf` + `design/convert-vrc-avatar.mjs`
2. **贴回贴图**：VRChat 的 FBX 里材质是不带贴图的 Phong 空壳（贴图绑定在 unitypackage
   的 Unity 材质里），转出来 9 个材质全指向同一张 1×1 白图，必须按 mesh 语义手工映射
3. **骨骼改名成 mixamo**：仓库约定所有玩家模型都用 mixamo 骨名，改完 PlayerArms.tsx
   的 9 个取骨点全部命中，应用侧代码一行没动
4. **姿势轴向**：这套骨架**局部 Y 沿骨、局部 X 才是抬手/垂手轴**（左臂局部X→世界
   (0,0,-1)、右臂→(0,0,1)，两侧都对应绕世界 Z 转）。第一版误用 Z 轴让手臂朝镜头平伸。
   轴向是从 GLB 直接解算骨骼世界基向量得到的，不是试出来的
5. **顺手修了 toonify 的通用缺陷**：它只在 `old.transparent` 为真时保 alpha，而
   glTF 的 `alphaMode:"MASK"` 映射成的是 `alphaTest>0` 且 `transparent=false`——
   正好漏掉，导致靠贴图切形状的发片/睫毛整片实心渲染。已让 alphaTest 与描边反壳
   一起带过来（对现有 Tripo/MMD 模型无影响，它们 alphaTest 恒为 0）

## 未解决：单位不一致导致摆姿势就炸

**现象**：绑定姿势下完全正常（独立预览器四视角渲染无瑕疵），一进工坊摆姿势就糊成
一团肤色的东西。

**根因**：fbx2gltf 输出的 mesh 节点带 `scale: 100`（FBX 厘米单位），而骨架是米制
（上臂骨在 y=0.693）。glTF 规范要求**忽略蒙皮网格的节点变换**，three.js 靠
`bindMatrix`/`bindMatrixInverse` 抵消它；这个 100× 打破了抵消，于是绑定姿势（形变=
单位阵）看不出问题，一旦有骨骼旋转，蒙皮位移就被放大 100 倍。

已排除的嫌疑（都测过）：弹簧骨发散（骨骼世界位全部正常、无 NaN）、描边反壳
（隐掉 24 个壳无变化）、alpha 裁切（修好后无变化）、机位（同机位渲染 `f` 档完全正常）。

**修法**（二选一）：
- GLB 层烘平：`POSITION ×100`、节点 `scale` 置 1、`inverseBindMatrices` 同步折算
- 或在 Blender 里 `Ctrl+A → Apply Scale` 后重导（更稳，Blender 会一并处理绑定矩阵）

## 其余待办

- 摇摆骨参数是照抄 rin/gratia 的，未按本模型体格调过
- 没有 think/settle 动画（Unity 的 .anim 不在 FBX 里），目前靠姿势表驱动
- 30MB 未优化，需降面/压贴图分出三档画质
