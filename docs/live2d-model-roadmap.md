# 看板娘 Live2D 模型：现状、差距与优化路线（2026-09-04 调研）

> 目标：让自研的「小梦」达到市面数字人对话产品（VTuber 级 Live2D 绑定）的观感——动作自然、表情随对话变、
> 摸哪儿有哪儿的反应。本文是给下一轮模型工作的依据，官网仓 `docs/COMPANION.md` 记的是运行时行为，这里记资产与工具。

## 1. 现状（mascot10，2026-09-04）

| 能力 | 状态 | 实现方式 |
|---|---|---|
| 口型 | ✅ 连续张合 | Mouth Open Warp 两键 + ParamMouthForm 三键；运行时 `包络^0.7 × 0.85` 写 ParamMouthOpenY |
| 眨眼 | ✅ 平滑 | Eye L/R Warp 压扁到睫毛线 + 闭眼补片不透明度键；70/40/120ms 曲线 |
| 头部 / 上身 | ✅ | 自动生成的 Face/Upper Body 变形器 + 3D 旋转表达（Body X/Y）+ Breath |
| 裙摆 | ✅ 会动 | Skirt Warp「自动生成摆动」摆幅 25 + 运行时二阶弹簧（增益 3、0.37Hz 微摆） |
| 头发 | ✅ 会动 | Front/Back Hair Warp 摆动键（16 / 20）+ 弹簧追头部/身体角度 |
| 手臂 | ◐ 微动 | Arm L/R Rotation 旋转键（±8°）：呼吸开合、随身体倾斜、[action:wave] 右臂挥；没有前臂/手的分段 |
| 触摸 | ✅ | model3.json HitAreas（Head/Hair/Body/Skirt/ArmL/ArmR/Legs）→ `hitTest` → 预置台词 + 表情/动作 |
| 表情随对话 | ✅ | 服务端 `[情绪][face][action]` 标签 → exp3/motion3 + 补片；9 种 face、11 种 action |
| 物理文件 | ✗ | 没有 physics3.json，摆动全靠运行时弹簧（两端共用 companionModel.ts） |
| 拼接感 | ✗ 未解决 | 见 §2 |

## 2. 拼接感（"披风挪开后有一圈虚框"）的根因与修法

立绘是 AI 生成 → See-through（`shitagaki-lab/see-through`）拆 16 层 → 各层被遮挡的部分是模型"脑补"的。
脑补区域带着上层的轮廓残影（披风的边在裙子层里、手臂层里都有一道淡淡的线），平时被披风盖住看不见，
披风一动（呼吸缩放、身体旋转）就露出来，看起来像"贴图拼起来的"。

修法只有一条：**把每一层被遮挡区域的残影抹干净**，不是绑定层面的问题。
- 工具：[IOPaint](https://github.com/Sanster/IOPaint)（原 lama-cleaner，开源，LaMa 模型 CPU 可跑，`iopaint run --model=lama --image= --mask= --output=` 支持批处理）。
- 遮罩：对每一层，遮罩 = 上层（披风/前发/手臂）alpha 向外膨胀 20～40px ∩ 本层 alpha，只修边缘带，不动可见区。
- 流程：`live2d-lab/out/psd-lr/*.png` → 修补 → `build_grouped_psd5.py` 重建 PSD → Cubism「重新导入 PSD」（图层名不变则网格/变形器保留）→ 导出。
  之前脸层用 `fix_face.py` 的归一化卷积做过同样的事（眼睛残影），效果可参考；衣服褶皱这类有结构的区域必须用 LaMa。
- 顺带做：给披风/裙子的网格边缘留 2px 羽化（Cubism 自动网格的边缘硬，缩放时锯齿明显）。

## 3. 和官方示例模型的差距（对比标杆已上传到模型市场）

对比对象：Live2D 官方示例 **Hiyori / Mao / Natori**（`CubismWebSamples`，已作为市场条目上传，App 里可直接「下载并使用」对比）。
授权：一般用户与年销售额 1000 万日元以下的小规模企业可商用，须在应用内保留声明
「This content uses sample data owned and copyrighted by Live2D Inc. The sample data are utilized in accordance with terms and conditions set by Live2D Inc.」
（[Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)、
[Sample Data Terms](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)）；合作角色（如初音）不可商用，本项目只用官方原创角色。

| 维度 | 官方示例 | 小梦 | 差在哪 |
|---|---|---|---|
| 图层 | 画师按绑定需求分 60～100 层（眉毛、上下睫毛、瞳孔、高光、衣服前后片、手指…） | 16 层（AI 拆分） | 分层决定上限：没有上下睫毛就做不出眯眼，没有前臂就做不出抬手 |
| 变形 | 每层多级 Warp + 旋转，手工键 | 自动生成 + 少量手工 | 面部微表情（眉形、眼形）缺键 |
| 物理 | physics3.json（头发/裙/胸 10+ 组摆锤） | 运行时弹簧 3 组 | 官方物理有链式摆锤（发梢比发根晚半拍），弹簧只有一级 |
| 动作 | 10 段 motion3（含身体、手臂） | 5 段手写 | 缺"手臂参与"的动作 |

## 4. 开源工具评估

| 工具 | 能做什么 | 结论 |
|---|---|---|
| [See-through](https://github.com/shitagaki-lab/see-through)（SIGGRAPH 2026） | 单图拆层 + 遮挡补全（已在用） | 拆层质量够，补全区域有残影 → 用 IOPaint 二次修补 |
| [Bunraku](https://bunraku-live2d.github.io/)（arXiv 2607.27348） | 单图 → 分层 + 每层网格 + 逐顶点位移，声称 Live2D 兼容 | **仓库只有 readme，代码/权重未发布**（2026-07-31），持续关注 |
| [StretchyStudio](https://github.com/MangoLion/stretchystudio) | 拆层 + DWPose 骨架 + 网格变形 | 输出是自家格式，不出 moc3；可借它的骨架估计给手臂/腿定枢轴 |
| [Inochi2D / Inochi Creator](https://github.com/Inochi2D/inochi-creator) | 开源的 Live2D 替代（编辑器 + 运行时） | 无成熟 Web 运行时，App/官网都是 pixi-live2d-display，不换 |
| [IOPaint](https://github.com/Sanster/IOPaint) | LaMa 修补 | §2 的关键工具 |
| Cubism Editor 自带 | 自动网格、自动脸部动作、自动摆动生成、物理设置、动画 | 本轮全部用的是这些；物理设置对话框（Modeling ▸ Parameter ▸ Physics Settings）还没用，下一步用它替代运行时弹簧 |
| [AgentAtelierR](https://github.com/onion-aqua/AgentAtelierR)（用户给的安卓开源项目） | Flutter + **Spine**（不是 Live2D）的本地 AI 角色 App | 借了它 `docs/CHARACTER_PERFORMANCE_MAPPING.md` 的演出协议与节奏常量（口型 20ms 帧、起 40 / 落 90ms、强表情 4.6s、动作压制 2.3s）；**不含任何示例模型**（素材要用户自备，且仓库无 LICENSE） |

## 5. 下一步（按性价比排序）

1. **残影清理**（§2）：IOPaint 批处理 + PSD 重导入，一次性消掉拼接感。约半天。
2. **physics3.json**：把裙/前发/后发/披风改成 Cubism 物理（链式摆锤），运行时弹簧只留兜底；两端零代码改动。
3. **手臂分段**：把 `02_handwear` 再拆成上臂/前臂/手（See-through 不分，手工在 PSD 里切），旋转变形器两级，才能做抬手/摆手/托腮。
4. **面部微表情键**：眉形（ParamBrowL/RForm）、眼形（ParamEyeL/RSmile 眯眼）、脸红（ParamCheek）补关键帧，exp3 才有内容可驱动。
5. **动作库**：用 Cubism Animator 做 8～10 段带手臂的 motion3（挥手、思考托腮、惊讶后仰、鞠躬），替换现在的手写 JSON。
6. 重绘一版分层更细的立绘（画师或 Bunraku 发布后），才是"官方示例级"的根本解。
