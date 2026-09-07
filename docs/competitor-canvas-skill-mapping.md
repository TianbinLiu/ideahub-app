# 对标 LibTV / updream：画布、Skill、模板 ↔ 我们的工坊 / 画布 / 卡片（调研，2026-09-06）

主人的假设：视频模型 API 收的输入是固定的一套，LibTV / updream 靠"把这套固定输入填对"做出了大量效果稳定的
Skill 与模板；我们的卡片 / 卡组 / 画布本质上是把同一套输入拆成不同的卡各管一格，应当能一一对应，并借此让功能稳下来。
**结论先行：假设成立**——两家的每一个视频节点都是同一份契约（模式 / 模型 / 画幅 / 时长 / 声音 / 提示词 / 左侧连进来的锚点图或参考视频），
Skill 与模板只是"把这些槽位填对"的流程；它们的稳定来自四件事（先出图再出片、锚点即资产、空间交给 3D 白模、Skill 输出结构化字段），
而我们四条出片路各自拼提示词、没有一份显式契约、缺可审核的中间物。逐项对照与改法见 §三、§四。

## 零、调研边界（诚实）

- 两家的创作面都要登录：updream 点「查看全部 Skills」直接跳 `/login`；LibTV 首页无登录态时「查看全部 skills」「查看创作过程」点了无反应。
  主人的 Chrome 里两家都**没有登录态**（LibTV 顶栏仍是「注册/登录」+ 新人红包），我不能替人注册或输密码 ——
  所以画布实操、Skill 详情页、模板固化按钮、节点参数面板这四样**没走到**，下面写的来自：两家官网可见部分、
  两个 GitHub 仓库（LibTV 官方 `libtv-skills` 与第三方 `libtv-video-production` 的 CLI 用法）、四篇测评 / 实测。
- 主人在 Chrome 登录后我可以接着走（§六是要补看的清单）。

## 一、两家长什么样

| 维度 | LibTV（LiblibAI，liblib.tv） | updream（B 站，updream.cn） |
|---|---|---|
| 入口 | 「新建画布创作」；模型车道 Seedance 2.5 / Wan 3.0 / Minimax H3 Max；独家工具：导演台、逐帧拉片、片段重拍 | 「新建画布」「3D预演台」「创作剧本」「设计角色」「拆分分镜」 |
| 画布 | 无限画布，节点：文本 / 图片 / 视频 / 音频 / 脚本；节点可打组保存、一键重复执行（= 模板）；分镜组宫格；剪辑台（多轨 + 变速）在画布里 | 无界画布，右键建节点、连线、分支对比、上游改动向下游传播；测评：20+ 节点后排版乱、没有合成节点 |
| 视频节点契约（CLI 可见） | `modeType=image2video / text2video`、`model`、`ratio`、`resolution`、`duration`、`enableSound`、`--prompt`、`--left-add <锚点节点>`（左侧连线 = 参考图 / 参考视频） | 节点面板预填 模型 / 分辨率 / 画幅（SeeDream 5.0 · 2K · 16:9），视频走 Seedance 2.0 |
| 一致性资产 | 角色锚点 = **一张四合一呈现板**（正面全身 / 面部特写 / 四分之三侧 / 纯侧面，Z-image Turbo 出图）；场景锚点一张；每个视频节点左侧连上它们 | 素材库：人物三视图、场景、道具、参考色调；「角色一致性锁定」= 指定素材库角色跨镜头连贯；「预填策略」= 先传视觉元素，AI 自动匹配 |
| 3D / 空间 | **导演台**：画布里的轻量 3D 构图节点——人体素模 / 几何体 / 群众阵列 / 本地模型，摆位置姿势、拧机位，「截图」→ 构图参考图发到画布，与角色三视图、场景图一起给模型；场景图一键转 720° 全景 | **预演台**：传 1~3 张参考图，4~7 分钟生成 3D 白模场景；加人物与机位、画走位与轨道；**录成预演视频**当下游视频模型的参考素材（"让创作告别抽卡，走向确定"） |
| 参考视频 | 逐帧拉片：传视频逐帧当参考；Wan 3.0「改写视频画面、剧情、环境」 | Seedance 2.0 参考视频 |
| Skill | 官方 `libtv-skills` 只是 IM 透传（自然语言进、结果出，后端 Agent 编排）；站内 Skill：POP MV、是枝裕和电影美学、真人感美妆 UGC 测评、TV Show、短漫剧生成、爆款视频复刻、音乐 MV | Skill = 流程方法 + 提示词 + **结构化输出**（分镜 Skill 输出 镜头编号 / 时长 / 场景 / 景别 / 运镜 / 情绪节拍）+ 示例与输入要求 + Agent 追问补全；点当前节点会推荐相关 Skill；`/` 调用；能"根据画布里的信息提炼一个 skill"；官方：剧本策划助手、剧本直出美术资产、剧本转分镜故事板、剧本转视频提示词、人物多视角生成、图片风格迁移、问题视频返修、场景多机位助手、电影级提示词优化大师 |
| 模板 | 节点组打组保存 → 换素材批量生产；「精选画布 · 查看创作过程」= 公开的整张画布 | Skill 社区（"专业影视创作领域的 GitHub"） |
| 修片 | 片段重拍（精准修改片段）、字幕智能擦除 / 框选擦除、图像工具（打光、角度） | 问题视频返修 Skill |
| 分镜 | 一句话 → 12 个分镜表格；每镜先出图（选模型、可选 LibLib 风格库、专业相机预设、画幅）再批量图生视频；一图生多机位九宫格 / 25 宫格 | 剧本 → 分镜（"12 秒，4 个镜头"）→ 视频节点 → 剪辑节点 |
| Agent / 记忆 | 双入口：GUI 给人、Skill 给 Agent；Agent 从剧本到成片自动搭画布 | 长记忆：跨项目记住调性 / 风格 / 习惯；「在画布中继续帮我创建下一幕，风格和主角与上一幕一致」一句话续写 |
| 模型 | 图：LibNano、Seedream 5.0、MJ V7、Z-image；视频：可灵 3.0 / O3、Wan 2.6 / 3.0、Seedance 1.5 / 2.5、Veo 3.1、Minimax、Vidu、Pixverse | Seedance 2.0 / Fast、可灵、Vidu、Wan 2.7、HappyHorse |
| 计费 | 积分 + 年会员（低至 3.7~4.5 折），Seedance 2.5 720P 低至 0.39 元/秒 | 积分；Seedance 2.0 Fast 低至 0.07 元/秒 |

## 二、它们"稳"在哪（对着我们的痛点说）

1. **输入契约只有一份**。LibTV 的视频节点就是 `{modeType, model, ratio, resolution, duration, enableSound, prompt, 左侧连线}`；
   方舟 Seedance 的协议我们自己在 `ai/arkClient.ts` 里也早就钉过：`content = [text, image_url(role: first_frame | last_frame | reference_image)…, video_url(reference), audio_url(reference)]` + `ratio / duration / resolution / generate_audio`。
   两边逐项对得上：`modeType` ↔ role 组合（首帧 = i2v、参考图 = r2v/refMode、参考视频 = edit）、`enableSound` ↔ `generate_audio`、`--left-add` ↔ `reference_*`。
   **差别在我们这边把这份契约拆进了四条路各拼各的**（经典首尾帧 / refMode 参考生视频 / 白模 r2v / 真人 MiniMax），`segmentGen` + `prepareMaterialRefs` + `blockoutPrompt` + `minimaxVideo` 各有一份"卡 → 槽位"逻辑，CLAUDE.md 坑表里"零报错"的那一类几乎全是这四份分叉出来的。
2. **每个镜头先出图、再出片**。LibTV 的 SOP 是 剧本 → 分镜表 → 每镜一张分镜图（可改打光 / 角度）→ 批量 image2video；第三方踩坑清单第 4 条直接写"连了锚点就必须 image2video，text2video 是错的"。
   分镜图是**可审核的中间物**：人不对、构图不对，在花视频钱之前就能看见。我们的三拍法（要求 → 三套方案含首尾帧 → 出片）本来就是这个形状，但白模路（r2v）与真人档（MiniMax 首帧 = 照片）没有这一层，主人真机上"出来才发现不对"的多半在这两条。
3. **锚点即资产，且一次只发一张**。LibTV 人物锚点是一张四合一板（正面全身 / 特写 / 四分之三 / 侧面）；第三方清单第 3 条："三张分开的视图是错的，四合一一张才对"。
   这与方舟指南"人物参考大头照 + 全身照，不建议多视图"**方向相反**——他们跑的是 Seedance 2.0 mini / 可灵，我们钉的是方舟 2.5 的实测。我们的人物卡（face + body 两张，`promptSchemes` 把三视图规格图标成 display 不进模型）是按方舟指南做的，不必改，但值得做一次同段 A/B：四合一板一张 vs face+body 两张（design/ab-bind-syntax.mjs 那套脚本形状），钉一个。
4. **空间交给 3D 白模，不交给文字**。LibTV 导演台把站位 / 姿势 / 机位 / 景别摆出来截图当构图参考，测评者说多人会议戏此前"反复生成几百张分镜图"，导演台之后"切镜像呼吸一样"；updream 预演台更进一步：白模**视频**当参考，"人物运动方向、摄影机路径、多机位间身份与环境连续性都更稳，无效尝试明显减少"。
   这正是我们**白模模板**那条路（r2v edit 逐镜复刻）的形状——我们已经有 3D 场景、人偶模型、白模化服务与 r2v 链路；差的是"从零摆"：我们的白模只能从**现成视频**白模化，没有"摆一个场 / 画一条走位 / 拧一个机位"的入口；工坊那张 3D 桌面今天只是展示，不产出构图参考。
5. **风格是选的，不是写的**。LibTV 出分镜图时从 LibLib 风格库选（LoRA / 预设），updream 有"批量风格统一"（一键统一分镜的打光 / 色调 / 风格）与图片风格迁移 Skill，风格还进长记忆。
   我们 V3 之后风格卡 = 画风 + 材质 + 色调光影 + 镜头语言 的出片句 + 一张风格样张，是**提示词级**；他们是**模型级**（LoRA）或**图级**（先把所有分镜图统一成一种风格，再图生视频）。方舟 Seedream 没有 LoRA，但"图级统一"我们做得到：风格样张 i2i 洗一遍全片首帧。
6. **Skill = 流程 + 结构化字段 + 确认点，不是一句话**。updream 的分镜 Skill 输出 镜头编号 / 时长 / 场景 / 景别 / 运镜 / 情绪节拍 六个字段；Skill 启动后"关键步骤需要创作者确认"；点当前节点推荐相关 Skill。
   我们的 `data/agentSkills` 只是"一句存好名字的画布指令"；`canvasAgent` 的白名单 + 确认卡已经是"确认点"，缺的是**结构化的分镜字段**（我们的 `Proposal` 只有 title / plot / durationSec / 首尾帧，没有景别、运镜、情绪节拍）。
7. **修在节点上**：片段重拍、问题视频返修、字幕擦除、打光。我们有圈选改帧、重画、重新生成、剪辑页裁切，但**没有"对已出成片做局部返修"**——白模路用的 edit 子任务其实就是这个能力（Wan 3.0 的定位"改写视频画面 / 剧情 / 环境"也是）。
8. **剪辑在画布里**（多轨 + 变速 + 画中画）。我们的剪辑页能合并 / 裁 / 分割 / 外挂音轨；缺变速与多轨，优先级最低。

## 三、一一对应表

| 我们 | LibTV | updream | 对得上吗 / 差在哪 |
|---|---|---|---|
| 人物卡（face + body 两张形象图、身份句、可挂声音、真人授权） | 角色锚点（四合一呈现板一张图）+ 提示词里的角色描述 | 素材库人物三视图 + 「角色一致性锁定」+ 人物多视角生成 Skill | 同构。张数策略相反（§二 3），要 A/B 一次；他们没有声音样本与真人授权这一层 |
| 场景卡（定场图 + 空间出片句，V3 从原片去人留景） | 场景锚点一张图（Z-image 出）；导演台截图（构图） | 素材库场景 + 场景概念图；预演台白模场景 | 同构；我们缺"构图 / 机位"这一维（§二 4） |
| 风格卡（画风 + 镜头语言 出片句 + 风格样张） | LibLib 风格库（LoRA）+ 相机预设 + 是枝裕和 / 哥特这类风格 Skill | 图片风格迁移 Skill、批量风格统一、长记忆里的调性 | 半对：我们是提示词级，他们多一层图级 / 模型级统一（§二 5） |
| 道具卡（原片裁剪 + 实物参考） | 图片节点当参考图连进视频节点 | 素材库道具 | 同构 |
| 背景卡（故事背景纯文字，V3） | 脚本节点 / 输入区的"选题、写法规则、角色设定" | 剧本策划助手输出的故事背景 | 同构（他们叫剧本 / 输入区） |
| 卡组（随片发布、可收入、做同款） | 节点组打组保存 / 公开画布「查看创作过程」 | Skill 社区里的成套资产 | 同构；他们的"模板"= 整张画布，我们的 = 卡组 + 分段剧本 |
| 经典模板（配方 styleHint / beats / framePrompt + 素材卡） | 打组保存的节点组，换素材批量生产 | Skill（流程 + 结构化输出） | 半对：我们的配方是文字 beats，没有结构化镜头字段（§二 6） |
| 白模模板（白模化视频 + 角色位 + 挂卡点名句 → r2v edit） | 导演台截图 + 逐帧拉片 | **预演台**（白模视频当参考） | 最接近的一对；我们缺"从零摆"入口，他们缺"从现成视频白模化" |
| 分段组（长视频切段各一份白模） | 分镜组宫格 | 拆分分镜 | 同构 |
| 节点 / 段（FlowNode + 三套方案 + 首尾帧承接） | 视频节点（左侧连锚点，modeType image2video） | 视频生成节点 | 同构；承接方式不同（我们首帧硬承接 / 他们靠锚点软约束） |
| 方案台（推演三套、换帧、改剧情、圈选重画） | 每镜分镜图 + 图像工具（打光 / 角度） | 分镜故事板 Skill + 非线性修改 | 同构 |
| 挂卡点名句（编号 / 序数 → 卡） | `--left-add` 连线 + 提示词点名 | 素材库预填自动匹配 | 同构（我们的点名骨架就是他们的连线） |
| 圈选提取卡片 / 视频提取模板 | 逐帧拉片 | — | 我们更细（圈选 + 取声） |
| 工作流画布（FlowCanvas） | 无限画布 | 无界画布 | 我们是线性流水线的一种视图；他们是任意图；他们也承认 20+ 节点会乱 |
| 工坊 3D 桌面 + 铸卡师 NPC | 导演台（3D 构图） | 预演台（3D 白模） | **我们的 3D 是展示，他们的 3D 是生产工具**——最大的一处可借鉴 |
| 对画布说话（canvasAgent 白名单 + 确认卡）+ agentSkills（一句话） | LibTV Agent（IM 透传，后端编排）+ Skill | 长记忆 Agent + Skill（结构化） | 半对：确认点我们有；结构化输出与记忆没有 |
| 草稿 / 自动存盘 | 画布即项目 | 画布即项目 | 同构 |
| 剪辑页（合并 / 裁 / 分割 / 音轨） | 剪辑台（多轨 + 变速 + 字幕擦除） | 剪辑节点 | 我们缺变速 / 多轨 / 返修 |

## 四、要学的（按收益 / 代价排序）

1. **一份显式的"生成节点契约"**（收益最大、改动在自己家）：在 `studio/segmentGen.ts` 之上抽一层
   `GenSpec = { mode: "i2v" | "ref" | "edit" | "minimax", model, ratio, resolution, duration, audio, prompt, refs: { characters, scene?, composition?, referenceVideo?, style? } }`，
   四条路只做"卡 → 槽位"的映射，`arkClient` / `minimaxVideo` 只认 `GenSpec`。报价（`nodeCost`）也从同一份 spec 算。这是把 CLAUDE.md 坑表里那一族"两份实现分叉、零报错"的根拔掉。
2. **每段都有可审核的中间物**：白模路给出"白模帧 + 挂卡后的合成预览图"（挂卡合成时用 Seedream 把角色卡贴进白模帧画一张预览，几分钱），真人档给出首帧；没有中间物的路不许直接花视频钱。
3. **工坊 3D 桌面升级成导演台**：现有 3D 场景 + 人偶模型（milltina 等）+ 相机 → 摆人偶（位置 / 朝向）+ 拧机位 → 截图当 `reference_image`（构图参考）与人物卡一起发；再进一步是录一段人偶动画当 r2v 参考视频（= updream 预演台，我们白模链路现成）。这是"从零白模"，补上白模模板只能从现成视频来的缺口。
4. **Proposal 加结构化镜头字段**：景别 / 运镜 / 情绪节拍（updream 分镜 Skill 的六个字段里我们缺三个），推演提示词按字段写、提示词拼装按字段读；风格卡的镜头语言那半就有了落点。
5. **风格图级统一**：组稿前用风格样张 i2i 把全片首帧洗成同一种画风（可选、报价单独一笔）。
6. **片段返修**：把 r2v edit 子任务开放成"对这一段成片说一句改法"（改环境 / 改道具 / 擦字幕），Wan 3.0 的定位。
7. **Skill 结构化**：`agentSkills` 从"一句话"升级为 `{ steps[], outputs(schema), confirmAt[] }`，先做一条"剧本 → 分镜字段"的官方 Skill 验证形状。
8. **人物参考张数 A/B**（0 代码，先实测）：四合一板一张 vs face+body 两张。

### 进度（2026-09-06）

- §四 1 的第一步：`composeSegments` 的入参命名为 `real.GenSpec`，提交前 `describeGenSpec` 把「模式 / 档 / 画幅 / 时长 / 参考图张数」写进步骤日志（`genLog` 认「契约 ·」前缀）。四条路真正收成"卡 → 契约"的翻译层是下一步。
- §四 4 已落：`types.ShotSpec`（景别 / 运镜 / 情绪节拍）—— 推演按字段写、`segmentGen.shotPrefix` 拼在正文最前、方案台显示、发布折进剧本。
- §四 6 已落：片段返修（`flowStore.genNode(id, { revise })`，本段成片当参考视频走 edit，`REVISE_TAIL` 代替换人句；`Proposal.prevVideoUrl` 留上一版可还原；两面共用 `ReviseBox`）。限制如实写在框里：按 r2v 计价、产物无声。
- §四 2 已落一半：白模段挂卡后可出「合成预览图」（`flowStore.makeCastPreview` → `real.castPreviewImage`，投影窗与画布共用 `CastPreviewCard`，一张图钱，换模板 / 改挂法作废）。真人档的首帧本来就是照片。

## 五、方舟协议 ↔ 卡片 的槽位表（"固定输入"这件事的证据）

| 方舟 Seedance 入参（arkClient） | LibTV 节点设置 | 我们谁来填 |
|---|---|---|
| `model` | `model` | `VideoTier`（档位） |
| `ratio` / `resolution` / `duration` | `ratio` / `resolution` / `duration` | 段设置（`aspect` / 档位 / `durationSec`） |
| `generate_audio` | `enableSound` | 档位 `audio` + 白模路钉死 false |
| `content[text]` = 提示词 | `--prompt` | 剧情 + `materialText`（人物身份句 / 场景 / 风格出片句 / 故事背景）+ 点名句 |
| `image_url role=first_frame / last_frame` | `modeType=image2video` 的左侧图 | 方案的首尾帧 / 承接帧 |
| `image_url role=reference_image`（≤30） | `--left-add` 角色 / 场景锚点、导演台截图 | 人物卡 face+body、场景卡定场图、道具卡、风格样张（`allocateRefs`） |
| `video_url role=reference_video` | 逐帧拉片 / 预演视频 | 白模模板的 refVideo / 自定义参考视频 |
| `audio_url role=reference_audio` | — | 人物卡声音样本 |

## 六、登录后要补看的清单

Skill 详情页的输入表单字段与输出示例；模板"打组保存"的粒度（存参数还是存结果）；视频节点参数面板的全部项（有没有我们没有的槽位，例如 seed / 负向词 / 运镜预设）；
导演台导出物的分辨率与画幅、是否带深度 / 骨架；updream Skill 编辑器的结构（步骤 / 追问 / 输出 schema）；素材库字段（三视图张数、色调参考怎么进模型）；「根据画布提炼 skill」产出了什么。

## 来源

- LibTV 官网 https://www.liblib.tv/ ；官方 Agent 技能仓 https://github.com/libtv-labs/libtv-skills ；第三方 CLI 工作流与踩坑清单 https://github.com/CDragon123-code/libtv-video-production
- LibTV 介绍：https://news.qq.com/rain/a/20260318A03FQ300 ，https://www.aihub.cn/tools/libtv/ ；人类侧全流程实测 https://zhuanlan.zhihu.com/p/2017534105735148387 ；导演台 https://www.uisdc.com/hangye/libtv-director ，https://zhuanlan.zhihu.com/p/2044805686928963439
- updream 官网 https://www.updream.cn/ ；介绍 https://www.aihub.cn/tools/video/updream/ ；测评 https://www.aixq.cc/46236.html ；Skill 社区 https://news.qq.com/rain/a/20260715A06S5300 ；实测 https://umaax.com/updreamshicehuabushichuangzuoyijuhuaxuxiehuamiandaochengpian/ ；预演台 https://zglg.work/ai/news/zh/2026-08-19-updream-s-previs-studio-brings-3d-white-model-previsualization-to-ai-video-cr
