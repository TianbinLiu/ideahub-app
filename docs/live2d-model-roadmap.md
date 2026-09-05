# 看板娘 Live2D 模型：现状、差距与优化路线（2026-09-04 调研，09-05 二次更新：mascot13）

> 目标：让自研的「小梦」达到市面数字人对话产品（VTuber 级 Live2D 绑定）的观感——动作自然、表情随对话变、
> 摸哪儿有哪儿的反应。本文是给下一轮模型工作的依据，官网仓 `docs/COMPANION.md` 记的是运行时行为，这里记资产与工具。

## 1. 现状（mascot15：手臂三段 + 眼球/眉毛/眯眼键 + 头转带发/眼/口 + 头歪 + 腮红，2026-09-05）

| 能力 | 状态 | 实现方式 |
|---|---|---|
| 口型 | ✅ 连续张合 | Mouth Open Warp 两键 + ParamMouthForm 三键；运行时 `包络^0.7 × 0.85` 写 ParamMouthOpenY |
| 眨眼 | ✅ 平滑 | Eye L/R Warp 压扁到睫毛线 + 闭眼补片不透明度键；70/40/120ms 曲线 |
| 头部 / 上身 | ✅ | 自动生成的 Face/Upper Body 变形器 + 3D 旋转表达（Body X/Y）+ Breath |
| 裙摆 | ✅ 会动 | Skirt Warp「自动生成摆动」摆幅 25 + physics3 摆锤（身体 X 既作平移又作角度：转身时瞬态甩动 + 持续跟随） |
| 头发 | ✅ 会动 | Front/Side/Back Hair Warp 摆动键 + physics3 摆锤（前发/侧发 2 节，后发 3 节，发梢比发根晚半拍） |
| 手臂 | ✅ 三段 | 上臂/前臂/手各自网格（split_arms.py 切 + 圆帽重叠），肩 ±8°、前臂 ParamForearmL/R（+10 向内弯 70°，-10 外张 25°）、手腕 ParamHandL/R ±25°；挥手/害羞/惊讶/鞠躬/思考都是带前臂曲线的 motion3 |
| 触摸 | ✅ | model3.json HitAreas（Head/Hair/HandL/HandR/ArmL/ArmR/Body/Skirt/Legs，顺序即优先级）→ `hitTest` → 预置台词 + 表情/动作；牵手/击掌落在手上 |
| 表情随对话 | ✅ | 服务端 `[情绪][face][action]` 标签 → exp3/motion3 + 补片；9 种 face、11 种 action。眉毛（Y/Angle/Form）、眼球（X/Y）、腮红（ParamCheek → cheek 网格不透明度）有键；头 Angle X/Y：脸/眉/鼻/耳由自动生成，眼/口/前发/后发/发夹由手写的 Shift X/Y 旋转变形器平移跟随；Angle Z 由 Face Rotation ±12° |
| 物理文件 | ✅ mascot.physics3.json（手写） | 前发/侧发/后发/裙摆/披风 5 组摆锤（披风 ParamCapeSway 是 Cubism 自动摆动生成的 Cape Warp），输入头身角度；运行时只吹"微风"让静止时也晃；没物理的老模型/市场包仍走 companionModel.ts 的弹簧兜底 |
| 拼接感 | ✅ 已清理（mascot12 贴图） | 见 §2：LaMa 逐层重画被遮挡的边带，moc3 不变 |

## 2. 拼接感（"披风挪开后有一圈虚框"）的根因与修法 —— 已做（mascot12）

立绘是 AI 生成 → See-through（`shitagaki-lab/see-through`）拆 16 层 → 各层被遮挡的部分是模型"脑补"的。
脑补区域带着上层的轮廓残影：披风的领口线印在脖子上、刘海的形状印在额头和披风上、披风/裙摆的阴影烙在袖子和大腿上，
平时被上层盖住看不见，上层一动（呼吸缩放、转头、甩发、摆裙）就露出来，看起来像"贴图拼起来的"。

修法：**把每一层被遮挡区域的残影抹干净**，不是绑定层面的问题。2026-09-05 已用下面这条流水线做完，只改贴图集，moc3/网格不动：

| 脚本（`C:/Users/tliu7/live2d-lab/`） | 做什么 |
|---|---|
| `lama_seams.py` | 对每个 (下层, 上层) 组合算遮罩 = 上层轮廓往里 120～160px（露得出来的带；小区域整块）∪ 往外 6～90px（烙在可见区里的阴影/描边），裁出包围盒，透明区先用可见像素延伸填充，跑 `iopaint run --model=lama`（CPU 8 张图 30s），只写回遮罩内 RGB（羽化 4px）。皮肤层（脸/脖子/耳朵）不用 LaMa——大块光滑皮肤它会脑补出皱纹划痕——改用可见皮肤的归一化卷积平滑延伸 |
| `despeckle.py` | 披风/袖子这类平滑区域里 LaMa 留下的小点和细划痕：中值差 + 连通域面积过滤 + Telea 修补。裙子/腿有褶皱线，**不能**跑 |
| `patch_atlas.py` | alpha 模板匹配找到每层在 4096 贴图集里的位置（手臂按脸中线拆 L/R），把改动贴回去 → `out/mascot12.4096/texture_00.{png,webp}` |
| `scratchpad/render-compare.cjs` | Playwright 离屏渲染 stage-test，两版贴图同一姿势（呼吸满 + 转头 + 刘海/后发/裙摆/双臂推到极限）截上/下半身对比图 |

结果（`out/seams/render/cmp-*.jpg`）：转头时披风上不再有刘海的黑色残影，摆裙时大腿上没有裙摆线，袖子上没有披风阴影带，
额头/脖子没有发丝/领口印子。IOPaint 装在 `live2d-lab/iopaint-venv`（Python 3.12，CPU torch）；LaMa 权重在 `~/.cache/torch/hub/checkpoints/big-lama.pt`。
下次立绘重拆层后，按 lama_seams → despeckle → patch_atlas 顺序重跑即可（PAIRS 表按新分层改）。
没做的：耳朵层在贴图集里匹配不到（可能拆成了两块），残影极小，跳过。

## 3. 和官方示例模型的差距（对比标杆已上传到模型市场）

对比对象：Live2D 官方示例 **Hiyori / Mao / Natori**（`CubismWebSamples`，已作为市场条目上传，App 里可直接「下载并使用」对比）。
授权：一般用户与年销售额 1000 万日元以下的小规模企业可商用，须在应用内保留声明
「This content uses sample data owned and copyrighted by Live2D Inc. The sample data are utilized in accordance with terms and conditions set by Live2D Inc.」
（[Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)、
[Sample Data Terms](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)）；合作角色（如初音）不可商用，本项目只用官方原创角色。

| 维度 | 官方示例 | 小梦 | 差在哪 |
|---|---|---|---|
| 图层 | 画师按绑定需求分 60～100 层（眉毛、上下睫毛、瞳孔、高光、衣服前后片、手指…） | 20 层（AI 拆分 + 手臂手工切三段） | 分层决定上限：眯眼只能靠整眼压扁（没有下睫毛层），没有手指分层就做不出手势 |
| 变形 | 每层多级 Warp + 旋转，手工键 | 自动生成 + 少量手工 | 面部微表情（眉形、眼形）缺键 |
| 物理 | physics3.json（头发/裙/胸 10+ 组摆锤） | 运行时弹簧 3 组 | 官方物理有链式摆锤（发梢比发根晚半拍），弹簧只有一级 |
| 动作 | 10 段 motion3（含身体、手臂） | 9 段程序生成（make_motions2.py：idle/nod/shake/think/excited/wave/shy/surprised/bow，都带前臂/手腕曲线） | 官方的是动画师手 K，我们是正弦 + smoothstep 包络，节奏偏机械 |

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

1. ~~**残影清理**（§2）~~ 已完成（2026-09-05，mascot12 贴图，只改贴图集）。
2. ~~**physics3.json**~~ 已完成（2026-09-05）：`public/live2d/mascot/mascot.physics3.json` 是手写的（格式照官方 Hiyori 示例），
   4 组：前发（2 节，Scale 6）、侧发（2 节，Scale 5）、后发（3 节，Scale 24）、裙摆（3 节，Scale 240）；头发参数量程是 ±1、裙摆 ±10，
   Scale 是按 `scratchpad/physics-tune.cjs` 的实测调的（正弦驱动头 ±20°/身体 ±8° 时前发 ±0.85、裙摆 ±6；慢速空闲时裙摆 ±3～5）。
   运行时（companionModel.ts）有物理时不再写这几个参数，只每帧改 `physics._options.wind.x`（0.37Hz×0.12 + 0.11Hz×0.05）当微风；
   注意 `_options` 里的向量是框架的 CubismVector2，只能改 x/y，整个换掉物理会崩。物理输出只在 model.update() 前存在（update 末尾
   loadParameters 会还原），要读它们得挂 `internalModel.on("beforeModelUpdate")`。披风没做摆锤（它跟着呼吸缩放，没有独立摆动参数）。
3. ~~**手臂分段**~~ 已完成（2026-09-05，mascot13）：`live2d-lab/split_arms.py` 按肘/腕（关节坐标在脚本 JOINTS 表）把 LaMa 清理版手臂切成
   上臂/前臂/手，子块在关节处带以关节为圆心的圆帽（藏在父块下，转动时不露缝；手的圆帽落在袖口里，用皮肤平滑填充）。
   Cubism 里：只含 6 块的 `sheet-6-arms-only.psd` 走「Add all layers as new ArtMesh」→ 自动网格 → Forearm L/R、Hand L/R 旋转变形器
   （原点用 Inspector「Vertices Info」数值填肘/腕坐标）挂在 Arm L/R Rotation 下 → ParamForearmL/R、ParamHandL/R 各 3 键 → 贴图集里
   右键「Place selected objects to texture atlas」+ 自动排布 → 导出。旧 arm_L/arm_R 删除，HitAreas 改成 armU/armF/hand。
4. ~~**面部微表情键**~~ 已完成：眼球（Eyeball L/R Move 旋转变形器当父级，原点 X±22/Y±12 px，虹膜 Clipping ID = 眼白）、
   眉毛（Eyebrow L/R Move：Y ±22px，Angle ±10°，Form +8/-12°）、头 Angle X/Y（自动生成；Eye L/R Warp、Mouth Warp 各套了一个空 warp
   才肯生成）。没做：ParamEyeL/RSmile（眯眼要上下睫毛分层）、ParamCheek（没有腮红层）、ParamAngleZ、前发跟头转。
5. ~~**动作库**~~ 已完成（程序生成，`live2d-lab/make_motions2.py`）：idle 加了前臂/手腕微晃；wave（右前臂抬起手腕摆 4 下）、
   shy（双手收胸前、头低偏、眼神躲）、surprised（头扬、双臂微张、眉飞）、think（左手到胸前、眉挑、眼看上）、excited（双臂抬、两手交替甩）、
   bow（低头前倾、双手收身前）、nod/shake 带手部跟随。ACTION_MOTIONS：wave→wave、shy→shy、surprised→surprised。
   Cubism Animator 手 K 的版本仍然会更自然，留给以后。
6. 重绘一版分层更细的立绘（画师或 Bunraku 发布后），才是"官方示例级"的根本解。
7. ~~前发/后发跟随头转、腮红层、ParamAngleZ~~ 已完成（2026-09-05，mascot14）：
   - 扫描发现眼/口其实没跟着头转（第一次自动生成的目标是一组空的重复变形器），改为在真正的 Eye L/R Warp、Mouth Warp、
     Front/Back Hair Warp 外各套两层旋转变形器「… Shift X / Shift Y」（X 和 Y 分开，避免多参数组合键），原点数值 = 默认 ± 位移
     （眼 ±55/∓30px、口 ±50/∓28、前发 ±60/∓35、后发 ±25/∓12），发夹 headwear 挂到 Front Hair Shift X 下。后发原本挂在 Arm R Rotation
     下（右肩一动后发跟着转），改挂 Breath。
   - Angle Z：Face Rotation ±30 → ±12°（支点在下巴，前发跟着歪，后发不歪）。
   - 腮红：`out/psd-cheek/cheek.png`（两团高斯粉晕，眼下 72px）→ `sheet-6-cheek.psd` 导入为 cheek 网格挂在 Face Warp 下，
     ParamCheek 0/1 → 不透明度 0/100%（smile/shy 的 exp3、FACE_POSES 里的 ParamCheek 现在真的有效）。
   - 眯眼（ParamEyeL/RSmile，mascot15）：不拆睫毛，在真正的 Eye L/R Warp 外再套一个 2×2 / Bezier 1×1 的「Eye L/R Squint」warp，
     EyeSmile=1 时把它的底边整体拖高 40px（顶边不动，双线性压缩：眼白下缘抬 28px、瞳孔中心抬 20px、上睫毛几乎不动）。
     控制点要点在变形器包围盒的角上才不会误选下面的补片网格。效果是"眼睛眯成弯月"，smile 表情 1.0、happy 姿势 0.3～0.4。
     真正带下睫毛弧线的眯眼仍要拆上下睫毛层，先这样。
