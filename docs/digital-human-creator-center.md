# 数字人创作中心：人物模型 × 人物音频 × 人物人格（设计）

> 2026-09-05 起草。目标：让用户在 App 和官网都能**自己做 / 上传**三样东西并发布到市场——人物模型（Live2D）、人物音频（豆包 1.0 混音预设）、
> 人物人格（人格卡），再把三样拼成自己的数字人。本文先盘现状（大部分已经有了），再写要补的东西：App 端制作入口、
> 「按步骤喂数据 → AI 生成人格」的向导、Live2D 上传向导 + 让第三方模型的表情/动作/触摸区能被我们的运行时用起来的映射层。
> 同类精读：`docs/card-prompt-scheme-market-design.md`（市场设计先例）、官网仓 `docs/COMPANION.md`（人格/声音/模型三层的合并规则）。

## 0. 现状：三样东西服务器和官网都已经有了，App 只能"用"

| | 服务器 | 官网（client） | App |
|---|---|---|---|
| **人物模型** Live2D 包 + 市场 | ✅ `/api/live2d-models` CRUD + 安装/点赞；zip 上传带白名单/zip-bomb/路径穿越防护 | ✅ 浏览 + **上传/编辑/删除**（`/live2d/market/new`） | 只能浏览/安装/使用；页脚写着「上传模型请到官网」 |
| **人物音频** 混音预设 + 市场 | ✅ `/api/voice-templates` CRUD + 点赞/使用计数；`/api/tts` 混音走 `custom_mix_bigtts` | ✅ 浏览 + 创建/编辑（`/voices/market/new`） | ✅ VoiceSheet 里 单音色 / **混音器** / 市场 三个 tab，能发布 |
| **人物人格** 人格卡 + 市场 | ✅ `/api/personas` CRUD + `POST /generate`（一段聊天文本 → 草稿）+ 付费购买 | ✅ 浏览 + 创建 + AI 生成（`/arena/persona/new`） | 只能浏览/安装/使用；页脚写着「创建请到官网」 |

已经定死、本设计**沿用不改**的规则（出处 `COMPANION.md` / 各服务文件头）：
- 数字人套装的合并顺序：**用户自选 > 人格推荐 > 模型推荐 > 服务器默认**。
- 人格和模型按 **id 引用**（作者改了大家跟着变；删了/取消公开就静默退回默认）；声音按 **快照** 存进使用方（`templateId` 只是"正在用"的角标，
  模板删了配方还在）。
- 只支持 **豆包 1.0** 的 23 个已验证音色混音，最多 3 个，权重和 = 1；**不加 IP 仿音**。
- 服务器一条规则只有一处实现；改 API 同一提交里更新 `PROJECT_STRUCTURE.md` 与本仓 `docs/api-contract.md`「客服」章节。

要补的缺口（调研结论，详见各节）：
1. **App 不能制作模型和人格**（也没有文件系统插件，只有 `<input type=file>`；走 Cloudflare 代理的 POST 在手机 5G 上 25 MB 会撞 125 s 读超时）。
2. **人格生成只有"贴一段聊天记录"一步**，没有"基本设定 → 素材 → 问卷 → 生成 → 试聊 → 微调 → 发布"的向导，人格卡也没有示例对话/开场白/边界字段。
3. **服务器不知道一个模型"会什么"**：不提取动作组/表情/命中区/参数，市场卡片说不出"支持挥手/害羞/触摸"，用户装了才发现是木头人。
4. **运行时对第三方模型是写死的协议**（`protocol.ts` 的动作组名 `nod/shake/think/excited/wave/shy/surprised`、表情用固定参数、触摸区 9 个固定名）——
   用户模型哪怕带了 20 个动作、10 个表情，只要名字不一样就一个都用不上。这是「让有 Live2D 模型的用户上传后表情动作能正常用」的核心问题。
5. **三类内容都不能被举报/下架**（`Report.targetType` 只有 video/comment/danmaku）；发布状态只有 `shared: Boolean`。
6. 官网导航割裂：模型/声音市场在顶层（游客可看），人格市场在 `/arena/persona` 门后；App 没有 i18n，官网人格页 `@i18n none`。

## 1. 用户视角：入口与选择页

**App**（客服页顶栏三个按钮已存在：👗 形象 / 🎭 人格 / 🎙️ 声音）
- `/support/models`（形象选择页）顶部加一张「＋ 上传我的 Live2D 模型」卡 → `/support/models/new`（向导，§3）；
  列表加 tab：官方 / 市场 / 我的（我的 = 自己上传的全部，含未公开）。卡片加能力角标（会动 / 会表情 / 可触摸 / 有物理）。
- `/support/personas`（人格选择页）顶部加「＋ 制作我的人格」卡 → `/support/personas/new`（向导，§4）；同样三 tab。
- 声音：VoiceSheet 的混音 tab 就是制作入口，不动；市场 tab 加「我的」筛选。
- 客服页顶栏再加一个入口「✨ 创作中心」`/support/create`：三张卡（模型 / 音频 / 人格）各带「去制作」「我的作品 n」。

**官网**
- 新页 `/create`（创作中心，游客可看、点制作要登录）：三张卡指向现有三个编辑器；人格编辑器加一条顶层路由 `/personas/market/new`
  （和 `/arena/persona/new` 渲染同一组件，只是不套 ArenaLayout/门），老路由保留。
- 三个市场列表都加 tab 官方 / 市场 / 我的，模型卡加能力角标。

## 2. 三类共用：发布、市场、举报

- 发布状态沿用 `shared: Boolean`（不引入草稿/审核状态机——现有三个 spec 和官网编辑器都按它写的）。**新增 `takenDown: Boolean`**：
  运营下架后作者也不能再 `shared=true`，列表/详情按 `shared && !takenDown` 过滤。
- 举报：`Report.targetType` 加 `live2d_model | persona | voice_template`；`takedown.service.takedownTarget` 按类型分派：置 `takenDown=true, shared=false`，
  模型另跑现有的"退回默认"逻辑（引用它的 `CompanionSetting.model` 置 null），声音模板跑 `detachTemplateEverywhere`。
- 上传/创建时的**授权勾选**（三类都要，存 `license: { selfMade: Boolean, agreedAt }`）：我是作者或已获授权；不上传他人作品 / 真人肖像 /
  Live2D 官方示例模型；违规下架且可能封号。Live2D 官方示例（Hiyori/Haru/Mao/Natori/Rice/Wanko/Mark/Shizuku）的 moc3 哈希进黑名单，
  上传即拒（官方示例只能由我们以"官方"身份挂在市场并带 Live2D 版权声明）。
- 列表接口统一 `?scope=official|market|mine`（voice-templates 已有 `scope=all|mine`，补 `official`；另两个补 `scope`），market 只回
  `shared && !takenDown`。

## 3. 人物模型：Live2D 上传向导

### 3.1 外部参考（调研）
- **model3.json 官方规范**（[Live2D/CubismSpecs](https://github.com/Live2D/CubismSpecs/blob/master/FileFormats/model3.json.md)）：
  `Version`、`FileReferences{Moc, Textures[], Physics?, Pose?, DisplayInfo?, UserData?, MotionSync?, Expressions?[{Name,File}],
  Motions?{组名:[{File, FadeInTime?, FadeOutTime?, Sound?}]}}`、`Groups[{Target:"Parameter", Name:"EyeBlink"|"LipSync", Ids[]}]`、`HitAreas[{Name, Id}]`、`Layout`。
- **nizima 模型规范 beta 0.4**（[creator manual](https://docs.nizima.com/en/model-spec/creator-manual/)）——Live2D 官方市场给"能点、能滑、能换表情"
  的模型定的通用约定，**我们直接认它**，兼容面最大：动作组 `Idle`（必，≥3 段）、`Start`（出场）、`Tap`/`Tap@区`、`Flick`/`Flick@区`、
  `FlickUp/Down/Left/Right(@区)`、`Flick3`、`Shake`、`PinchIn/Out`；命中区名就是 `HitAreas[].Name`（`Head`、`Body`…）；
  表情名 `Normal / Smile / Angry / Sad / Surprised / Blushing / Hungry / Tired / Scared / Insane`（带不带 `.exp3.json` 后缀都认）。
- **VTube Studio**（[VTS Model Settings](https://github.com/DenchiSoft/VTubeStudio/wiki/VTS-Model-Settings)）：拖入文件夹 → auto-setup 按**标准参数 ID**
  自动接管，ID 不标准就逐个手动映射；只认 ID 不认名字，新旧 ID 风格（`ParamAngleX` / `PARAM_ANGLE_X`）都兼容；表情 = exp3 文件。
- 我们的运行时（pixi-live2d-display）本来就支持多动作组 + 优先级、exp3 表情、HitAreas 命中、Pose、Physics、Sound 对口型——缺的只是"名字对不上"。

### 3.2 合格标准（写进上传页说明；服务器 `inspectModel3Json` 同步校验）
| 必须 | 不满足时 |
|---|---|
| `*.model3.json`（Version 3）+ `*.moc3`（文件头 `MOC3`）+ 贴图 png/webp（每张 ≤ 4096²，建议 2048²，≤ 4 张） | 拒收（错误码对应官网 `live2dMarket.errors.*`） |
| 标准参数 `ParamAngleX/Y`、`ParamEyeLOpen/ROpen`、`ParamMouthOpenY` | 拒收——不能转头/眨眼/说话的模型没意义（大小写/下划线风格自动兼容） |

| 推荐（有就自动接上） | 接到哪 |
|---|---|
| `Idle` 动作组 | 待机；没有则用我们的呼吸/微摆兜底并提示 |
| `ParamAngleZ`、`ParamBodyAngleX/Y/Z`、`ParamEyeBallX/Y`、`ParamMouthForm`、`ParamBreath`、`ParamCheek`、眉毛 6 参数 | 视线 / 口型 / 呼吸 / 脸红 / 参数版表情 |
| exp3 表情 `Normal/Smile/Angry/Sad/Surprised/Blushing` | 我们 9 个表情槽（normal/happy/laughing/angry/sad/crying/shy/tease/cuddle）里的对应项 |
| 动作组 `Tap@Head`、`Tap@Body`、`Flick@Body`、`Start`… | 触摸反应 / 出场 |
| `HitAreas` `Head/Hair/Body/HandL/HandR/ArmL/ArmR/Skirt/Legs` | 触摸分区（区名不同就在向导里点一下对上） |
| `physics3.json`、`pose3.json`、`cdi3.json` | 物理 / 透明度组 / 参数中文名（向导里显示用） |

### 3.3 能力档案 `capabilities`（服务器提取，存库 + 进列表 payload）
```ts
{ motionGroups: string[]; motionCount: number; expressions: string[]; hitAreas: string[];
  params: string[]            // cdi3 有就从 cdi3 取，没有留空（moc3 不在服务器解析）
  hasPhysics: boolean; hasPose: boolean; textures: { count: number; maxSide: number };
  badges: ("motions"|"expressions"|"touch"|"physics")[] }   // 市场卡片角标
```

### 3.4 映射文件 `companion.json`（我们的协议层；model3.json 保持标准不动）
向导生成、服务器校验后写到包里 model3.json 旁边，同时存库 `mapping`。运行时加载模型时顺手 `fetch(new URL("companion.json", modelJsonUrl))`，
404 就用现在写死的默认（= 官方 mascot 的行为），所以老包零改动。
```json
{
  "version": 1,
  "idle": "Idle",
  "start": "Start",
  "actions": { "acknowledge": "nod", "disagree": "shake", "think": "think", "explain": "nod", "excited": "excited",
               "wave": "Tap@HandR", "shy": "Flick@Body", "surprised": "FlickUp@Head", "comfort": "nod", "playful": null },
  "faces":   { "normal": { "expression": "Normal" }, "happy": { "expression": "Smile" }, "laughing": null,
               "angry": { "expression": "Angry" }, "sad": { "expression": "Sad" }, "crying": null,
               "shy": { "expression": "Blushing" }, "tease": null, "cuddle": null },
  "touch":   { "Head": { "hitAreas": ["Head"], "motion": "Tap@Head" }, "Body": { "hitAreas": ["Body"], "motion": "Tap@Body" },
               "Hair": null, "HandL": null, "HandR": null, "ArmL": null, "ArmR": null, "Skirt": null, "Legs": null },
  "params":  { "mouthOpen": "ParamMouthOpenY", "eyeL": "ParamEyeLOpen", "eyeR": "ParamEyeROpen", "angleX": "ParamAngleX",
               "angleY": "ParamAngleY", "angleZ": "ParamAngleZ", "eyeBallX": "ParamEyeBallX", "eyeBallY": "ParamEyeBallY",
               "bodyX": "ParamBodyAngleX", "breath": "ParamBreath", "cheek": null, "mouthForm": "ParamMouthForm" },
  "fit":     { "heightRatio": 1.2, "xBias": 0.5 }
}
```
运行时规则（`companionModel.ts`，两仓同步）：`actions[x]` 为 null → 该动作不播（现在缺组也是静默跳过）；`faces[x]` 为 null → 退到参数版通用表情，
参数版又缺参数 → 静默；`touch[x]` 为 null → 只说话不播动作；`params` 里缺的功能静默关闭。服务器校验：映射里引用的动作组 / 表情 / 命中区
必须真的在包里（参数不校验，Cubism 对不存在的参数本来就忽略）。**自动映射**（`suggestMapping(capabilities)`）只有一处实现，在服务器：
nizima 名 → 我们的槽（`Tap@Head`→touch.Head、`Smile`→happy、`Blushing`→shy…）+ 我们自己的组名原样（`nod/shake/...`）+ 标准参数大小写兼容。

### 3.5 向导（App 与官网同一套步骤）
1. **选文件**：zip（推荐）或多选整目录。本地 JSZip 解开 → 找 model3.json → 逐项核对 FileReferences → 白名单后缀
   `.moc3 .model3.json .physics3.json .pose3.json .cdi3.json .userdata3.json .exp3.json .motion3.json .png .webp .wav .mp3`，
   总大小 ≤ 25 MB；不合格当场红字。
2. **本地预览**：pixi-live2d-display 从 blob URL 加载，画出来才算过；右侧列参数（配 cdi3 中文名）、动作组、表情、命中区、有无物理。
3. **自动识别**：把 zip 交给 `POST /api/live2d-models/inspect`（不落库）→ 返回 `capabilities` + 建议 `mapping` + 完成度（必须项 / 推荐项）。
4. **手动映射**（可跳过）：三张表——动作槽 ×（他们的动作组，点▶在预览里播）；表情槽 ×（exp3 或「用参数调一个」）；触摸区 ×（HitAreas，点画布高亮网格）。
5. **验收试跑**：固定脚本自动跑——说一句话对口型、眨眼、逐个 action、逐个 face、逐个区点一下；用户点「没问题」。
6. **发布信息**：名称、封面（自动截屏 + 可换，走 `/api/uploads/image`）、简介、标签、推荐人格/声音（可空）、公开与否、授权勾选 → 提交。

### 3.6 服务器改动
- `inspectModel3Json` 增加：moc3 文件头、贴图尺寸/张数、必需参数（从 cdi3；没有 cdi3 时只能靠客户端预览步骤把参数表传上来——`inspect` 接口
  接受可选 `params[]`）、能力提取；`findModelEntryFile` 优先 `*.model3.json`，多个时按名字排序并返回列表让客户端选（`entry` 字段）。
- `POST /api/live2d-models/inspect`（multipart zip，`requireAuth` + 限流 10/分）→ `{ capabilities, mapping, entry, warnings[] }`。
- `POST /api/live2d-models` 接受可选 `mapping`（JSON 字符串）；没有就用 `suggestMapping`；校验后写 `companion.json` + 存库；payload 带
  `capabilities`、`mapping`、`license`。`PUT /:id` 允许改 `mapping`（重写 `companion.json`）。
- **App 大文件路径**：`POST /api/live2d-models/bundle/sign` 返回 Cloudinary `raw` 直传签名（folder `live2d-bundles/<userId>`，≤ 25 MB，
  1 小时过期）→ 客户端 XHR 直传（有进度、不过 Cloudflare 125 s）→ `POST /api/live2d-models` 传 `bundleRef`（public_id）代替 `bundle` 文件
  → 服务器从 Cloudinary 拉回（限 25 MB）、`installBundle`、删掉 raw 资源。官网桌面端仍可直接 multipart。
- 老路径 `POST /api/me/components/live2d/upload` 补 `inspectModel3Json` + 限流 + 覆盖时删旧目录（同一实现，别再分叉）。

## 4. 人物人格：AI 生成向导

### 4.1 现状可复用
`POST /api/personas/generate`（`personaAi.service.generatePersonaFromChat`）已经会从聊天文本提炼 `name/description/coverEmoji/tags/style{summary,
catchphrases,stanceHint}`，只回草稿不落库，创建仍走 `POST /api/personas`（校验/归属/shared 由它管）。运行时注入方式是 `styleDescriptorOf` 拼一行
`名字｜风格：…｜口头禅：…｜倾向：…`（≤600 字）进 `personaPromptLine`。本设计把它扩成向导 + 更厚的人格卡，链路不变。

### 4.2 人格卡扩展（`Persona.style` 加可选字段，老数据不动）
```ts
style: {
  summary, catchphrases[], stats[], stanceHint,          // 已有
  tone?: string;            // 语气一句话（"慢热、爱用省略号、生气也不飙脏话"）
  addressUser?: string;     // 怎么称呼用户
  greeting?: string;        // 开场白（≤120）
  examples?: { user: string; reply: string }[];   // 3~8 组示例对话（从素材提炼/仿写），few-shot 用
  boundaries?: string[];    // 该人格自己的边界（"不聊前任""不评价别家产品"）；平台基础安全条款不在这里，固定注入
}
```
`styleDescriptorOf` 追加 `tone/addressUser/boundaries`（上限放到 900 字）；`examples` 不拼进一行，而是在 companion chat 的 messages 里作为
few-shot 轮次注入（最多 6 组）。

### 4.3 向导 7 步（App `/support/personas/new`、官网 `/personas/market/new`）
1. **基本设定**：名字、别称、定位（陪聊 / 客服 / 老师 / 角色扮演 / 自定义）、一句话简介、与用户的关系、封面 emoji / 图。
2. **素材导入**（可多条、可跳过）：粘贴文本；上传 `.txt/.md/.json/.csv`；微信/QQ 聊天导出（识别「昵称: 内容」/「昵称 时间」格式，让用户点选
   哪个昵称是"TA"，只取 TA 的话）；微博/小红书文案。总量 ≤ 50k 字，超出服务器按段随机抽样到 12k。**素材只用于生成，不入库不公开。**
3. **性格问卷**（12 项，都有默认值）：外向↔内向、理性↔感性、正式↔随意、幽默感、话多↔话少、敬语程度、口头禅（自填）、情绪外露度、称呼用户、
   语言（中/英/混）、emoji 用量、禁忌话题（多选 + 自填）。
4. **AI 生成**：客户端先调 `POST /api/personas/analyze`（素材 → 分析：高频词/口癖、句长、标点/emoji 习惯、语气词、立场、常聊/避谈话题、
   3～6 段代表性原话（去隐私改写）），再调 `POST /api/personas/generate`（基本设定 + 问卷 + 分析 → 完整草稿）。两步分开是为了
   第 5 步"重生成"只重跑第二步、不重读素材。没有素材时跳过 analyze，只用问卷。
5. **试聊**：`POST /api/personas/preview-chat`（SSE，草稿随请求带上，不落库；限流 20/分）聊 5 轮；「整体再来一版」= 重跑 generate；
   「只换开场白 / 只换口头禅」= generate 带 `only: ["greeting"]`。
6. **微调**：表单直接改每个字段；口头禅/示例对话可增删。
7. **发布**：可见性、标签、价格（沿用 0～100000 积分）、是否允许 remix（`remixable`，别人可「复制成我的再改」）、授权勾选 → `POST /api/personas`。

### 4.4 安全
- 生成与试聊固定注入：不冒充真实存在的人、不声称是人类、不给医疗/法律/投资建议、未成年人保护；分析步骤对手机号/身份证/地址/邮箱做脱敏。
- 名字与简介过「真实公众人物」判断（模型判断 + 小黑名单），命中要求虚构化才能发布；已有内容审核（若接了）继续走。

### 4.5 服务器改动
- `POST /api/personas/analyze`：`{ materials: [{ kind: "chat"|"posts"|"notes", text }], speaker?: string }` → `{ analysis, model }`，`aiRateLimit` 5/分。
- `POST /api/personas/generate` 扩参（向后兼容）：`{ chatText?, hint?, basics?, questionnaire?, analysis?, only?: string[] }` → 草稿多出 4.2 的字段。
- `POST /api/personas/preview-chat`：`{ draft, messages[] }` SSE；复用 companion chat 的系统提示词拼装（一处实现），只是人格来自请求体。
- `persona.schemas.js` 的 `styleBody` 加可选字段并限长；`Persona.js` 同步；`styleDescriptorOf` 追加字段；`companion.service` 注入 examples。
- `listPersonas` 改成数据库分页（现在是全量 `find().lean()` 再 JS 过滤，会先被市场增长压垮）。

## 5. 人物音频：豆包 1.0 混音（已有，补三处）
接口事实（[火山引擎 单向流式 HTTP V3 复刻/混音](https://www.volcengine.com/docs/6561/1598757)）：`speaker: "custom_mix_bigtts"`，
`req_params.mix_speaker.speakers[{ source_speaker, mix_factor }]`，最多 3 个，`mix_factor` 和必须 = 1；只认 1.0 音色（及 `S_`/`icl_` 复刻），
资源必须是 `seed-tts-1.0`——和服务器 `config/voices.js`、`utils/voiceSettings.js` 现状一致。
1. 发布模板时服务器用固定句子合成一次存 `previewUrl`（Cloudinary media），市场试听不再每次打 TTS（省配额、秒开）。
2. 列表 `scope` 补 `official`（官方推荐配方，`author` 为系统账号）。
3. App 的 `studio/voices.ts` 手抄 2.0 音色表改成也读 `/api/tts/voices`（现在单音色 tab 和混音 tab 两个来源）。

## 6. API 变更清单
| 方法 | 路径 | 变化 |
|---|---|---|
| POST | `/api/live2d-models/inspect` | 新增：zip → capabilities + 建议 mapping + entry 候选 |
| POST | `/api/live2d-models/bundle/sign` | 新增：Cloudinary raw 直传签名（App 大文件） |
| POST | `/api/live2d-models` | 加 `mapping`（JSON 字串）、`bundleRef`、`license`；payload 加 `capabilities/mapping/license/takenDown` |
| PUT | `/api/live2d-models/:id` | 允许改 `mapping`（重写 companion.json） |
| GET | `/api/live2d-models` `/api/personas` `/api/voice-templates` | `?scope=official\|market\|mine`；market 过滤 `takenDown` |
| POST | `/api/personas/analyze` | 新增 |
| POST | `/api/personas/generate` | 扩参 `basics/questionnaire/analysis/only`，草稿多字段 |
| POST | `/api/personas/preview-chat` | 新增 SSE |
| POST | `/api/personas` `PUT /:id` | `style` 新字段、`remixable`、`license` |
| POST | `/api/reports` | `targetType` 加三类；`takedownTarget` 分派 |
| — | 静态 `uploads/live2d-market/<u>/<pkg>/companion.json` | 新文件，运行时读 |

## 7. 分期与验收
1. **服务器 P1**（本轮先做）：能力提取 + `mapping`/`companion.json` + `suggestMapping` + `inspect` 接口 + 人格 `analyze/generate 扩参/preview-chat`
   + `style` 扩字段 + `scope` 三值 + `takenDown`；jest 全绿、`check:config` 过；更新 PROJECT_STRUCTURE.md 与 App 仓 api-contract.md。
2. **运行时 P2**（App + 官网 `companionModel.ts`）：读 `companion.json` 覆盖动作/表情/触摸/参数映射；官方 mascot 无此文件行为不变。
   验收：拿市场里的 Hiyori（nizima 风格动作组 `Idle/TapBody/…`）配一份 mapping，能触摸/播动作/换表情。
3. **App P3**：创作中心 + 形象/人格选择页的「＋」入口与三 tab + Live2D 向导（含直传）+ 人格向导；`npm run build` 过、真机走一遍。
4. **官网 P4**：`/create` + 两个向导（复用 App 的步骤组件逻辑，i18n zh/en）+ 人格市场顶层路由。
5. **治理 P5**：举报/下架三类 + 官方示例哈希黑名单 + 声音 previewUrl。
6. 之后：官网人格页 i18n、App i18n 框架、Cubism 2 老模型转换提示。

## 8. 参考
- [Live2D CubismSpecs · model3.json](https://github.com/Live2D/CubismSpecs/blob/master/FileFormats/model3.json.md)
- [nizima 模型规范 · Creator's Manual](https://docs.nizima.com/en/model-spec/creator-manual/)、[规范概述](https://docs.nizima.com/en/model-spec/)
- [VTube Studio · VTS Model Settings](https://github.com/DenchiSoft/VTubeStudio/wiki/VTS-Model-Settings)、[Expressions](https://github.com/DenchiSoft/VTubeStudio/wiki/Expressions-(a.k.a.-Stickers-or-Emotes))
- [nizima LIVE · 添加 Live2D 模型](https://docs.live2d.com/nizimalive/en/tutorials/how-to-add-live2d-model/)
- [火山引擎 豆包语音 · 单向流式 HTTP V3（复刻/混音 mix）](https://www.volcengine.com/docs/6561/1598757)
