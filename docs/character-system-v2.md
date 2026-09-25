# 启梦「角色」系统设计稿：Spine 与静态立绘并存、角色模型市场、三级记忆

> 版本：v0.1（2026-09-18）
> 读者：产品负责人，以及之后动手实现的工程师。
> 状态：这是设计稿，还没有写任何代码，也没有改动任何文件。
> 代码基线（只读 origin/main）：App `app-ab@cf62f17`（2026-09-18），官网 `client-companion@7ca2018`（2026-09-05），服务端 `server-support@699e255`（2026-09-17）。
> 外部来源：抓取日期都是 2026-09-18，GitHub 部分固定到具体 sha。凡是标了「未核实」的，都不能当事实用。

---

> 📎 **续篇**：[`character-art-privacy-context.md`](character-art-privacy-context.md)（2026-09-18）——立绘与 Spine 的制作路线和购买步骤、**聊天记录与隐私的决定**、类 Claude 的**上下文窗口与自动提纯**设计。其中 §C 取代本文 §6 的 L1/L2 部分（二者合并为一个机制，L3 顺延）。产品负责人确认：个人开发者、无公司、无融资、营收 0 ⇒ Spine 买 Professional 即可。

## 0. 一页结论

1. **标杆有，但别照抄它的短板。** RyzaChat 的强项在美术（人手绘制）、语音（原声优授权 TTS）、RPG 式叙事。弱点是记忆和付费，App Store JP 评分 2.1，这是抓取时的数字，会变。我们对标的是「表现层 + 陪聊」这部分质量。RPG、闹钟、世界地图不做。
2. **可以复用的开源代码只有 ryza-ai-revive（MIT）里的算法。** 它的素材、从官方包反编译出来的文本和参数、NSFW 代码、夹带的 Spine 运行时，一律不用。AgentAtelierR 没有 LICENSE，只能借思路和文档里的做法。
3. **Spine 要先买授权才能写集成代码。** Spine Runtimes License 规定，集成运行时的那一刻就必须持有有效的 Editor 授权。要做出 RyzaChat 那种质量（网格变形、物理），必须用 Professional 档。如果公司营收加融资 ≥ 50 万美元，就要用 Enterprise。
4. **运行时锁定 Spine 4.3.x**，用 npm 的 `@esotericsoftware/spine-webgl` 或 `spine-pixi-v7`，要实测后二选一。服务端按 major.minor 校验上传包的版本。
5. **渲染器抽象成一个接口，下面挂 Spine 和立绘两种实现。** 两种实现吃同一套标签（9 个 face 加 11 个 action），前端给一个切换按钮。现有的 `companionBus` 基本就是这个接口，改动面不大。
6. **市场从「Live2D 模型」改成「角色模型 CharacterModel」。** 一个角色可以挂立绘、Spine，或两者都挂。再加一个「发布角色」流程，把人格、模型、声音一次发布出去。
7. **记忆按用户定的顺序做**：先做 L1 服务端持久化，再做 L2 滚动摘要（照 ryza-ai-revive 的两层折叠改写），最后做 L3 向量回忆（两个开源项目都没有，要自己写）。客服渠道和陪聊渠道的记忆彼此隔离，客服的记忆永远放在红线之后注入。
8. **过渡顺序是「立绘先行」。** Spine 小梦做好之前，官方角色先用立绘模式。Live2D 在第一期冻结新上传，第四期删代码。

---

## 1. 质量标杆：RyzaChat AI

### 1.1 基本事实

| 项 | 事实 | 出处 |
|---|---|---|
| 正式名 | 「タイトル：RyzaChat:AIライザと創るあなただけのひと夏の夢物語」。简称和英文副标题没有一手来源，未核实。 | PR TIMES，SpiralAI，2026-09-10，https://prtimes.jp/main/html/rd/p/000000097.000120221.html |
| 开发和发行 | SpiralAI 株式会社。KOEI TECMO GAMES（GUST）提供 IP 授权并负责监修。官网页脚写「Developed by SpiralAI」。 | https://prtimes.jp/main/html/rd/p/000000096.000120221.html |
| 上线时间 | 原定「配信時期：2026年8月18日 配信予定」。8-25「日本国内で提供開始」。9-10「5つの地域で提供開始」，包括日本、美国、印度、印尼、台湾。延期原因和「8-24 分批放量」的一手来源只有 X，未核实。 | PR TIMES 000000095 / 096 / 097 |
| 分批邀请 | 原文「サーバーの負荷状況を確認しながら事前登録いただいた皆さまへ段階的にご案内」，并要求先行用户不要发 SNS。发布域名是 workers.dev，是否为官方渠道没有交叉核实。 | https://announcements.spiralai.workers.dev/announcements/K7xQ2mV9pR4zN8cL?lang=ja （2026-08-24） |
| 平台 | iOS 和 Android。Play 页还显示可在 Windows 上用，官方 FAQ 没提。iOS 版 1.1.1（2026-09-10），包体 703.9MB。 | https://ryzachat-ai.go-spiral.ai/ |
| 语言 | 原文「6言語に対応」，其中中文是繁体。对应地域写的是「日本（※グローバル版は現在制作中）」。 | PR TIMES 000000096 |

### 1.2 功能清单，以及我们做不做

「期」对应第 7 节的分期。「客服」一栏表示这项功能在 App「AI 客服」里适不适用。

| # | RyzaChat 功能 / 质量要点（原文短引与出处） | 我们 | 期 | 客服 |
|---|---|---|---|---|
| 1 | **两种模式，可随时切换**：「物語を進めたいときは「RPGモード」」「雑談モード」「いつでも切り替え可能！」（App Store JP，v1.1.1） | 只做**雑談式陪聊**，RPG 不做 | — | 不适用 |
| 2 | **三种会话风格**：「テキストでも、声でも、ささやきでも。」「※会話スタイルはいつでも切り替えられます。」（官网） | 文字和语音做。ASMR 暂不做，要做需另行决策 | 文字、语音：P1–P2 | 只要文字和语音 |
| 3 | **立绘全部人手绘制**，不用 AI 生图：「画像生成AIは一切使用していません」「会話に応じて変化するのは素材の"動きの組み合わせ"のみ」（官网 Q&A）。官网没说用的是哪个动画引擎。 | 做。官方角色由美术产出，市场要求上传者做原创声明 | P3（小梦 Spine） | 适用 |
| 4 | **动画引擎官方没写**。第三方仓库 ryza-ai-revive 是用 Spine 4.2 去跑从 APK 里还原出来的骨架。有一条用户评论说「Live2Dになっている」，可能只是口语说法。所以「官方用 Spine」算未核实。 | 只作参考 | — | — |
| 5 | **表情和动作的规模**（AgentAtelierR 对官方包的审计，属第三方）：坐姿 9 个情绪配置，622 条 normal 表情组合，140 个动作组；站姿对应是 9、108、53。「组合数量不是独立贴图数量」。 | 小梦的目标定为**一个姿势、9 个情绪、每个情绪 3–6 条表情组合、11 个动作**，先把规模做小，见 §3 | P3 | 适用，但动作幅度要收敛 |
| 6 | **语音**：声优のぐちゆり授权录制素材，再用 SpiralAI 自研的 TTS 合成（PR TIMES 000000096）。历史语音不能在聊天记录里重播。 | 用我们现有的 TTS，并做**历史语音可重播**，这正是对方被吐槽的地方 | P2 | 适用 |
| 7 | **LLM**：自研 SpiralLLM，是在公开模型上用原作剧本追加训练出来的。官方声明不拿用户对话训练。（PR TIMES 000000097） | 继续用我们单一 provider 的 aiClient。隐私政策里写明「不用于训练」，这一点要法务确认 | — | 适用 |
| 8 | **聊天界面**：角色全身立绘在背后，底部是半透明的聊天记录，右侧箭头可以调记录区高度；有「全屏显示」；文字速度可调。ベーシック皮肤是站姿，其他皮肤是坐姿。（帮助中心） | 做「角色在背后、底部半透明记录区可调高度、全屏看角色」的布局 | P1（立绘）/ P2 | App 客服页适用 |
| 9 | **服装（SKIN）**：免费「ベーシック」，付费 4 款，12 个月档送「ナイトマーメイド」；定价「特別価格 1,850円 / 通常 3,700円」。（公告 2026-09-15，workers.dev） | Spine 的 skin 和立绘变体都支持多套。收费规则另议，见 §9 | P4+ | 客服只用默认服装 |
| 10 | **触摸反应**：一手宣传材料里没把它当功能介绍，只有用户评论提到「ライザへのタップは自由」 | 我们**已经有** TOUCH_AREAS，共 9 个区。Spine 用 bounding box 命中，立绘用矩形热区 | P1 / P2 | 客服只保留 Head、Hand，关掉 Skirt、Legs |
| 11 | **记忆架构**（帮助中心）：服务端**不长期存用户原文**，只存「对话摘要」和「莱莎的回复」；聊天记录只在本机，不跨设备 | 我们做**服务端持久化加跨设备**，见 §6。这是对方被吐槽的点，要做隐私告知 | P1 | 适用，但和陪聊隔离 |
| 12 | **记忆质量是官方自己承认的短板**：FAQ 承认对话越长越接不上前文、会忘人忘事。评论里的头号槽点就是记忆。「高品質な記憶／コンテクスト」还被放进了订阅权益。 | 这是我们主要的**超越点**，做 L2 加 L3 | P3–P4 | 客服只用会话内摘要 |
| 13 | **付费**：必须订阅才能用。免费额度是「保有上限：15回分」「10日ごと」回满，而且只抵文字；Token 按回复轮次扣。（帮助中心 billing-11/23/6） | 不照搬这套付费。本期不做 Token 计费 | — | 不适用 |
| 14 | **闹钟**：按星期设置（帮助中心 trouble-8）；世界地图、任务、背包、合成等养成系统 | 不做 | — | 不适用 |
| 15 | **安全**：「18歳以上の方のみ…登録時に年齢確認」；AI 身份在「初回起動時、会話画面、利用規約」里说明；检测到自伤倾向会「通常のキャラクター演技を中断し」并转介热线；声明 AI「専門家ではありません」；遵循加州 SB 243（官网 /safety） | 做：**会话界面上标明是 AI**、**自伤时中断人格并转介**、**专业领域免责声明**。年龄门槛另议 | P1 | **客服必须有** |
| 16 | **素材防提取**：官方公告把抽取角色素材和语音定性为违反条款的逆向工程（workers.dev 公告） | 我们的包不加密。AgentAtelierR 的文档也承认加密只能挡住直接解包，挡不住运行时抓取。只做签名 URL 加防盗链 | P2 | — |
| 17 | 分级不统一：App Store JP 页面写 18+（iTunes API 返回 17+），Google Play 写 Everyone 10+ | 仅作参考 | — | — |

### 1.3 用户评价里对我们有用的部分

来源：App Store JP 评论 RSS，https://itunes.apple.com/jp/rss/customerreviews/page=1/id=6763540981/sortby=mosthelpful/json ，2026-09-18 抓取。

- **优点**：语音录得好，质量被评为「他のサービスの追随を許さないレベル」（v1.0.3，2026-09-05）。立绘由原作画师トリダモノ绘制。RPG 有 TRPG 感，「NPCがいるTRPGを遊んでいるような感覚」。莱莎很配合玩家，但也有人嫌「協力的すぎて」。
- **槽点**：头号是**记忆**，会忘、会重复、关系值会归零。其次是付费压力：语音一轮扣 84 Token，¥340 大约只能聊 10 轮。还有：亲密互动会被定型文打断，雑談模式像一问一答，历史语音不能重播，聊天记录不跨设备。
- **对我们的启示**：记忆、跨设备、历史语音重播这三项是我们可以做得比它好的地方。美术和声优的质量要靠投入，靠代码补不了。

---

## 2. 开源基座怎么用

### 2.1 ryza-ai-revive（MIT，固定到 `6b3a902`，2026-09-14）

- 许可证是「MIT License, Copyright (c) 2026 zeroa234」：https://github.com/zeroa234/ryza-ai-revive/blob/6b3a90234ab0d9fd87c06addaa6e4136ab5da7bd/LICENSE
- MIT **只覆盖 zeroa234 自己写的代码**。仓库里的游戏素材、从 libapp.so 或 AOT 快照恢复出来的文本和参数、夹带的 Spine 运行时，都不在 MIT 范围内。

**A. 可以改写后复用（保留 MIT 声明）**

以下路径都在 `web/js/`，固定到 @6b3a902。

| 模块 | 位置 | 我们怎么改 |
|---|---|---|
| 标签化回复解析：`withTurnCue` / `formatHistoryReply` / `extractState` / `parseTagFields` / `isMachineTag` / `attachSceneTags` / `parseTaggedReply` | api.js L217–L325 | 标签字段只留 `emotion`、`attitude`，另加我们的 `face`、`action`，客服再加 `handoff`。删掉 undress、nsfw、stage、tod、place、sleep、time_advance。README 原文说这套协议「no function-calling requirement」，正适合我们单一 provider 的 aiClient。改写后放到**服务端**。 |
| 两层记忆：sessions 和 summaries，满了在同层折叠 | memory.js，287 行。头注释写「Two-layer conversation memory」；每 8 轮生成一张卡；提示词要求「200字以内」 | 改成服务端写 Mongo，提示词改成中文，作为 L2（§6） |
| WebGL 宿主与图层 `makeHost` / `makeLayer` | avatar.js L76–L110，头注释「One WebGL context. Two stacked WebGL canvases flicker on Windows.」 | 做成 ES module，页面上只保留一个常驻上下文 |
| 命中检测 `_pointInPoly` / `_onCharacter` / `hitPartAt` | avatar.js L769–L862 | BB_* 插槽映射到我们的 TOUCH_AREAS。删掉 breast 和 weast 两个部位 |
| 骨架加载 `_loadSpine` | avatar.js L865–L908 | 改成 fetch 签名 URL。去掉写死的 `crf_skn_002_0001` 和 `_01/_99` 后缀逻辑 |
| 口型 `_voiceDb` / `_applyLip` | avatar.js L2147–L2207。原理：用 RMS 算出 dB，映射成 0–1 的开口度，再拖动 scrub 动画的 trackTime | 直接改写。美术只需要做一条「嘴从闭到全开」的线性动画 |
| 每帧顺序 | avatar.js L2524–L2560：`state.update → _applyLip → apply → skeleton.update → _applyLook → updateWorldTransform(Physics.update)` | 照这个顺序做。物理完全交给 Spine 的 PhysicsConstraint |
| 眨眼调度、点击后动态退出混合 | L2617–L2640 加 L2584–L2600，以及 L2412–L2447 | 改写。数值用我们自己实测的，**不照抄 0.3 s 这类从官方包得出的数** |
| 测试写法 | scripts/memory_regression.js（纯 Node，vm 沙箱）、boot_smoke.js | 照着写服务端和前端的回归测试 |
| 测试思路 | motion_regression.js：在 Node 里跑 spine 运行时，按 60fps 跑 0.5 小时，断言骨骼数值有限、idle 轨道没被替换；expression_coverage.js：检查所有引用的动画名都存在 | 改成跑小梦的骨架，作为 CI 和上传校验的依据 |

**B. 参考思路后自己重写，不逐行复制**

- avatar.js 里的表情、情绪、占用层、视线、特效调度，大约 1200 行（L1029–1860、L1972–2146、L2209–2400）。这部分和官方 gesture.json 的结构、硬编码名字（`sofa_root`、`FALLBACK_IDLE`、`FALLBACK_LIP`、BB_breast/weast）绑得很紧。而且代码注释自己承认，其中大量行为是按官方包复刻的，比如「78 of 98 drivers are lookAtUser」。所以这部分**按我们自己的精简清单（§3.2）重写**。MIT 能不能覆盖「依据反编译行为写出来的实现」，要由法务判断，见 §9。
- 相机与场景（L506–L760 附近）依赖游戏的场景骨架和 `posture_camera.json`。看板娘和客服都没有舞台，改成固定取景（fit）。
- `persona()` / `staticPrompt` / `dynamicPrompt`（api.js L74–L237）：借用「静态前缀在前、记忆块在中间、动态段在后，方便前缀缓存命中」的结构。内容换成人格卡加客服知识库的红线。
- 对话模式框架 MODES / MODE_TTS / MODE_PLAY_FX：只有 asmr（rate 0.93、gain 0.82）和 immersive 两种模式有播放处理。框架可以留，所有文案重写。
- `/_proxy`（serve.py、Electron、AssetServer.java）不需要，我们由 Express 做代理。

**C. 必须剔除**

1. **所有游戏素材和由素材派生的表**：`web/assets/spine/**`、`_index/*.json`（voice_bank、tap_voice、scenes 等）、`assets/audio/alarm/**/*.env.json`、world_map、Lottie、SVG 图标，还有 Release 里的 590MB APK 和 646MB exe。README 和 `scripts/restore_media.py` 写明素材要从 `RyzaChat-1.2.15.apk` 里复制出来，所以这些**都是厂商的素材**。官方公告也把抽取素材定性为违反条款的逆向工程。
2. **反编译得来的文本和数据**：api.js L18–25 的 `STYLE_SAMPLES`（注释原文「Genuine in-game phrasing recovered from the AOT snapshot」）；i18n.js L1025–1107 的 `NPC_NAMES` / `ZH_TW_VERBATIM` / `EN_VERBATIM`（注释「recovered verbatim from libapp.so」）；game.js 里的字段名（注释「real wire names recovered from the AOT snapshot」）；各模式的说明文案。
3. **RPG 模块**：game.js、quests.js、daily.js、world.js、alarm.js、onboarding.js。
4. **全部 NSFW/undress 代码**。PROJECT.md L81 原文：「`web/js/nsfw.js` swaps a costume's `nsfw` atlas texture when the AI emits `undress:on`」。具体位置：
   - nsfw.js 全文
   - avatar.js L118–121、L350–L478、L868、L956
   - api.js L131/142/156/190/259–274/292/306/322，以及 nsfwSection 的传递链 L203/207/231/233/1045
   - app.js L141/469/1128/1174/1191/2249–2250/2329
   - config.js L119
   - i18n.js 里 4 处 settings.nsfw
   - build_indexes.py L79–L102
   - nsfw_intent_regression.js
   我们的 tag 白名单里**根本不设**这个字段。服务端解析时遇到未知字段直接丢弃。
5. **夹带的运行时 `web/vendor/spine-webgl.js`**：这份文件里没有 Spine Runtimes License 文本，再分发不合规。我们从 npm 引入，并随包附上许可证（§3.4）。

**D. 引用义务怎么落地**

- 凡是改写复用 A 类代码的文件，文件头写上：`Portions adapted from zeroa234/ryza-ai-revive @6b3a902 (MIT, Copyright (c) 2026 zeroa234)`。
- 在两个前端仓和服务端仓都加 `THIRD_PARTY_NOTICES.md`，收录 MIT 全文。App 的「关于 / 开源许可」页也列出来，和现在 LICENSE-pixi.txt 的做法一样。

### 2.2 AgentAtelierR：没有授权，只借思路

- GitHub API 显示 `license: null`。README 声明不提供原版素材，也说代码公开不等于可以商用。https://github.com/onion-aqua/AgentAtelierR/blob/2f50227ed1d95251d02927eda45632a97318fe83/README.md
- **不拷代码，也不拷它文档里的数值表。** 下面是可以借的**思路**，都附了出处，固定到 @2f50227：

| 思路 | 出处 | 我们怎么用 |
|---|---|---|
| LLM 不直接输出动画名，每句台词只带 `[TTS情绪][face:9选1][action:12选1]`；客户端负责白名单校验、姿态兼容、去重、排队（最多 2 个意图，5 秒过期，3 秒冷却）；**不按用户文字里的关键词触发动作** | docs/CHARACTER_PERFORMANCE_MAPPING.md | 这就是我们的标签驱动（§4.2）。现有 protocol.ts 的 FACES 和 ACTIONS 已经是这个形态 |
| 口型用音量包络近似，README L38 原文「不是音素级唇形识别」；没有 TTS 时退化成合成的开合节奏 | README L38；映射文档 L6–L17 | 思路相同。具体参数自己实测 |
| 长期记忆是结构化条目：category / importance 1–5 / summary / keywords；五类强保护（promise、confession 等）；每 4 条用户消息整理一次，遇到承诺、告白等关键词立即整理；**没有向量** | lib/src/app_controller.dart L455–463、L1768–1902；chat_screen.dart L2084–2087 | L2 的「事实卡」结构可以借（§6）。注意「importance=5」只是写在提示词里的要求，代码并不强制 |
| 系统提示把用户设定、历史消息、附件都标成**不可信数据**，里面的任何指令都不能覆盖系统提示 | lib/src/ai_services.dart | 客服：人格卡和导入的角色卡都按不可信数据处理，覆盖不了红线 |
| 写入类工具要以工具返回为准，「不得只用文字宣称成功」 | ai_services.dart L216 | 客服：「转人工」和「建工单」必须以服务端结果为准，模型不能自己宣称已经转接 |
| 本地皮肤导入：Spine 单页图集 ZIP，内含 .atlas、.png、.skel、_gesture.json；ZIP 和解压后总量各不超过 64MB；不读包里的脚本；没有预览图就显示空白 | docs/LOCAL_SKIN_IMPORT.md | 我们上传包的校验清单拿它做参考（§5.3） |
| 换成自己的角色时，要「同步调整提示词、角色 ID、骨骼轨道、动作映射、头像和场景资料，而不只是替换纹理」 | README L193 | 说明发布单元应该是「人格 + 模型 + 表演映射」 |
| 设定项分 3 类，每类 5 个槽位，其中包括人物卡、世界书 | docs/settings_presets.md | 角色卡导入落到 Persona（§5.5） |

- **我们仓里现有的风险**：protocol.ts 文件头写明 TIMING 的数值取自 AgentAtelierR 实测。我们的 ACTIONS 列表（11 个）也和它的 12 个几乎一样，只少了 invite。建议 P1 里把 TIMING **换成我们自己实测的值**，列表名字请法务看一眼，见 §9。

---

## 3. 角色资产：小梦要产出什么

### 3.1 前置条件：Spine 编辑器授权（需要用户决定和购买）

| 事实 | 原文 / 出处 |
|---|---|
| 档位和价格（购买页当前显示）：Essential 原价 $99、现价 $69；Professional 原价 $449、现价 $379；Enterprise $2499 起，每个用户另加 $379，按年付费。Essential 和 Pro 是永久授权 | https://esotericsoftware.com/spine-purchase |
| 营收门槛：「Businesses with more than $500,000 USD annual revenue require a Spine Enterprise license.」编辑器协议里的口径是：过去 12 个月的营收、投资、融资合计要低于 50 万美元 | 购买页；https://esotericsoftware.com/spine-editor-license （Last updated April 5, 2025） |
| Essential 没有的功能（对比表 ESS 列标 `check no`）：**Physics constraint、Meshes、Deformation、Weights、Clipping、Transform constraint、Path constraint、Audio**。另外「Spine Essential is unable to save or export projects containing Spine Professional features, such as meshes or IK.」注意：对比表里 IK 在 ESS 列是勾选的，但这条脚注又把 IK 当作 Pro 功能，页面自相矛盾，用 IK 之前要问 Esoteric | 购买页 |
| 集成义务（Runtimes License 走 Section 2 路线）：2.1「(a) each Product adds significant and primary functionality to the Spine Runtimes; and (b) You have a valid Spine Editor license **at the time the Spine Runtimes are integrated**」；2.2 要求把 Exhibit A 许可证文本放进产品附带的文档或材料里；授权到期后，已经集成的版本可以继续分发，但**不能再集成或修改运行时去发新版本** | https://github.com/EsotericSoftware/spine-runtimes/blob/4.3/LICENSE ；编辑器协议 §2.1–2.4、§3.3 |
| Trial 不能保存，也不能导出：「Purchasing Spine enables saving projects and exporting animation data」 | 购买页 |

**结论**：要做到 RyzaChat 那样的质量，表情和口型靠网格变形，头发和衣摆靠物理约束，这些都是 **Professional 专有功能**。所以：

- 公司持有 **Pro（每个席位 $379，永久）**，前提是营收加融资 < 50 万美元；否则要买 **Enterprise**。
- 这份授权**必须在工程开始集成 Spine 运行时之前**生效，P2 之前就要到位。
- 做小梦的美术，本人也要有 Pro 编辑器才能保存和导出。如果是外包，就用外包方自己的授权，或者占我们的一个席位。
- 只用 Essential，最多做出「换图 + 刚性骨骼」的效果，和静态立绘差别不大，不建议。

### 3.2 小梦的 Spine「装配契约」（交给美术的清单）

原则：不照搬官方 gesture.json 的结构（它是游戏素材，我们只是从读取代码反推出来的）。我们自己定一份**精简 manifest**。骨骼名默认沿用 ryza-ai-revive 代码里的默认名，这样改写的代码不用额外配置；如果要换名字，在 manifest 的 `rig` 字段里映射。

**编辑器与导出**

- Spine **4.3.x** 编辑器（§4.3 版本锁定）。4.3 的导出和 4.2 运行时不兼容。
- 导出**二进制 `.skel`**（首选）和 `.atlas`、`.png`。服务端也接受 `.json`。
- 单张贴图边长 ≤ 4096，整个 zip ≤ 25MB（沿用现有的上传上限）。
- 预乘 Alpha（PMA）的导出设置等 P2 实测后再定，美术先不用管。

**骨骼**（带 * 的必须有）

| 骨骼 | 用途 |
|---|---|
| `root`* | 根骨骼 |
| `chara_root`* | 摆位和取景的锚点 |
| `head`* | 眼线对齐、视线回退时用 |
| `rig_face` | 视线跟随的中心；没有就退回用 `head` |
| `control_aim_eye` / `control_aim_head` / `control_aim_body` | 视线和注视。代码直接改这几根骨骼的 x/y，要靠约束带动眼球和头部 |
| `control_roll_head` / `control_roll_neck` / `control_roll_body` | 待机时的微动（改 rotation） |

**插槽和附件**

- 点击热区用 BoundingBox 附件，插槽名 `BB_<区>`，区名对应我们的 TOUCH_AREAS：`BB_Head`、`BB_Hair`、`BB_HandL`、`BB_HandR`、`BB_ArmL`、`BB_ArmR`、`BB_Body`。`BB_Skirt`、`BB_Legs` 可选，客服场景会禁用这两个。**不做**胸部、腰部热区。
- 腮红、泪、汗等脸部特效插槽，命名前缀为 `fx_`。它们按 Normal 混合绘制，不要设成 Multiply。

**动画**（全部小写，下划线分隔）

| 类别 | 命名 | 要求 | 轨道 |
|---|---|---|---|
| 待机 idle* | `idle_01` … `idle_03` | 循环播放，身体有呼吸感。头发和衣摆靠物理约束摆动，不要手 K | 0 |
| 表情 face* | `face_normal`、`face_happy`、`face_laughing`、`face_angry`、`face_sad`、`face_crying`、`face_shy`、`face_tease`、`face_cuddle` | 9 个**全要有**，和 protocol.ts 的 FACES 一一对应。每个表情只 key 眼、眉、嘴、脸颊；可以做 `_a/_b/_c` 几个变体，播放时随机抽 | 2（眼、眉可以拆成 2 和 3） |
| 眨眼 blink* | `eye_blink`、`eye_closed` | 眨眼 0.15–0.25 s；闭眼保持 | 2 |
| 口型 mouth* | `mouth_scrub` | 嘴从**完全闭合到最大张开，线性过渡，时长 1 s**，只 key 嘴部。代码按开口度拖动它的时间轴 | 4 |
| 动作 action* | `act_acknowledge`、`act_disagree`、`act_think`、`act_explain`、`act_excited`、`act_wave`、`act_shy`、`act_surprised`、`act_comfort`、`act_playful` | 10 个一次性动作（第 11 个 `none` 不需要做）。首帧和末帧要能自然衔接 idle；时长 1–3 s | 1 |
| 触摸 touch | `touch_head`、`touch_hand`、`touch_body` … | 可选。没做的区域就回落到对应的 action | 6 |
| 风 wind | `wind_01` | 可选，按叠加方式混合 | 10 |

**物理**：头发、裙摆、披风用 Spine 4.2 起提供的 **Physics constraint**（Pro 功能）来做。

**皮肤（skin）**：`default` 是必须的。换装用 skin；换姿势（站姿、坐姿）做成**独立的骨架变体**，每个变体各带一份 manifest。这对应 ryza-ai-revive 里「每个骨架各有一份 gesture」的形态。

**事件（event）**：不强制。如果要在动作的某一帧触发音效，可以用 `sfx_<name>`。

**manifest `companion-spine.json`**（和骨架一起打包；上传后服务端会先自动生成一份草稿，用户或美术在向导里确认）：

```json
{
  "schema": 1,
  "spine": "4.3",
  "skeleton": "xiaomeng.skel", "atlas": "xiaomeng.atlas",
  "fit": { "anchorBone": "chara_root", "scale": 1, "offsetY": 0 },
  "idle": ["idle_01", "idle_02"],
  "faces": { "normal": ["face_normal"], "happy": ["face_happy_a", "face_happy_b"] },
  "actions": { "acknowledge": "act_acknowledge", "none": null },
  "blink": { "blink": "eye_blink", "closed": "eye_closed" },
  "mouth": { "scrub": "mouth_scrub", "track": 4 },
  "touch": { "BB_Head": "Head", "BB_HandL": "HandL" },
  "rig": { "aim": { "eye": "control_aim_eye" }, "roll": { "head": "control_roll_head" } }
}
```

**验收**：用改写后的 motion_regression，拿小梦的骨架在 Node 里跑 30 分钟，断言骨骼数值都是有限值、idle 轨道一直在、一次性动作的轨道能回空。再跑 expression_coverage，检查 manifest 里引用的动画名全部能在骨架里找到。

### 3.3 静态立绘规格

- **文件命名按渲染用的 FACES**，不按 TTS 用的 EMOTIONS：`normal.png`（**必须有**）、`happy`、`laughing`、`angry`、`sad`、`crying`、`shy`、`tease`、`cuddle`（这 8 张可选，缺了就回落到 normal）。依据：companion.service.js@699e255 L32–34 里有两套名字，渲染驱动用的是 FACES。上传时 EMOTIONS 名只当别名接受，比如 `neutral` 会映射成 `normal`。
- 可选张嘴图 `<face>-talk.png`。有这张图，说话时就切图；没有，就只做轻微缩放。
- 格式为 **PNG 或 WebP，透明底**，服务端会检查有没有 alpha 通道。**所有张的尺寸完全一致**，角色在画面里的位置不变（这样切换表情时身体不会跳）。边长 ≤ 2048，推荐 1536×2048 竖幅、全身、脚底对齐底边。
- 可选 `portrait.json`：`{ "fit": {...}, "hitAreas": { "Head": [x,y,w,h], ... } }`，坐标用比例值。没有提供时，整张图都算 Body。
- 可选 `cover.webp` 作为市场封面。

### 3.4 许可证随包

两个前端仓的 `public/` 下各放一份 `LICENSE-spine-runtimes.txt`（Exhibit A 全文，包含「Copyright (c) 2013-2025, Esoteric Software LLC」），App 的开源许可页也列出来。这样满足编辑器协议 §2.2(a)。

---

## 4. 架构

### 4.1 渲染器接口

现状：两端的 `src/companion/bus.ts` 都只通过 `import type { CompanionModel }` 依赖 Live2D。对外暴露 setModel / onModel / face / action / mouth / speakSynthetic / stopSpeaking / hit / onHit，还有一个 `get model()` getter，会把整个模型对象暴露出去。代码里有调用方直接用了模型对象：

- `SupportModelNewPage.tsx:288` 调 `.snapshot()`
- `live2dUploadStore.ts:289` 读 `.modelUrl`
- `SupportStage.tsx:143` 和官网 `CompanionStage.tsx:133` 按对象身份比较

所以接口里必须带上 `snapshot()` 和 `modelUrl`。

```ts
// src/companion/renderer.ts（两端相同，建议后续抽成共享包）
export type RenderMode = "spine" | "portrait";
export interface CompanionRenderer {
  readonly mode: RenderMode;
  readonly modelUrl: string;
  attach(host: HTMLElement): void; detach(): void;
  resize(w: number, h: number): void; fitTo(box: DOMRect): void;
  setFace(f: CompanionFace): void; playAction(a: CompanionAction): void;
  setMouth(open01: number): void; speakSynthetic(ms: number): void; stopSpeaking(): void;
  lookAtClient?(x: number, y: number): void;
  hitTest(x: number, y: number): TouchArea | null;
  snapshot(): Promise<Blob>; destroy(): void;
  playRawAnimation?(name: string): boolean; // 仅上传向导试演；立绘返回 false
}
```

- `bus.ts` 里把 `CompanionModel` 换成 `CompanionRenderer`，涉及 import、ModelListener、current、getter 这几处。App 端把 `motionGroup` 和 `expression` 改名为 `playRawAnimation`。
- `protocol.ts` 拆成两部分。**和渲染器无关、保留的**：FACES、ACTIONS、TIMING（换成自测值）、estimateSpeechMs、TOUCH_AREAS、TOUCH_REACTIONS。**Cubism 专用、删除的**：EXPRESSION_PARTS、FACE_POSES、ACTION_MOTIONS。
- **Spine 实现**：idle 放在 track0，常驻，永不被替换；action 放在 track1 做一次性播放，播完回空；face 放在 track2/3；`mouth_scrub` 放在 track4，timeScale=0，靠拖动 trackTime 控制开口；点击命中用 SkeletonBounds 检测 BB_*。
- **立绘实现**：DOM 叠两层 `<img>` 做交叉淡入；action 用 CSS transform 关键帧（点头、摇头、弹跳、倾斜）；口型有 `-talk` 图就切图，否则轻微缩放；点击命中用比例矩形。不依赖 WebGL，低端机也能跑。
- **切换按钮**：放在舞台右上角，写进 `CompanionSetting.renderMode`。游客存 localStorage（读写都包 try/catch）。角色只有一种资源时，按钮置灰并提示「该角色未提供 Spine / 立绘」。Spine 加载失败或 WebGL 不可用时，**自动降级到立绘**并提示用户。

### 4.2 标签驱动（Spine 和立绘共用）

- 服务端让模型每句台词输出 `[emotion:x|face:y|action:z]`。解析器由 ryza-ai-revive 的 `parseTaggedReply` 改写，放在**服务端**，只认白名单字段，非法值保持上一句的值。SSE 推给前端的是结构化的 `{text, face, action, emotion}`。
- ryza 的 9 种情绪（neutral happy laughing tease shy cuddle sad crying angry）和我们的 FACES 基本一致，只有 neutral 对应 normal。
- 前端排队规则：同一时刻最多 2 个意图，5 秒过期，3 秒冷却，**不按用户文字里的关键词触发动作**。这几个数值要自己实测后定。

### 4.3 Spine 运行时选型与版本锁定

| 事实 | 出处 |
|---|---|
| 4.3.00 已发布为稳定版（changelog 写「4.3 stable released!」，2026-05-14）；npm 上 spine-webgl、spine-pixi-v7、spine-pixi-v8、spine-player 的 latest 都是 4.3.13，另有 `v4.2-latest`=4.2.120 | https://esotericsoftware.com/spine-changelog ；spine-runtimes 4.3/spine-ts/package.json |
| 规则：导出数据的 major.minor 必须和运行时一致，patch 号可以不同 | https://esotericsoftware.com/spine-versioning |
| 4.3 分支 README 写明 spine-ts 只支持 4.3.xx 导出的数据；运行时本身**不校验**版本 | spine-ts/README.md@4.3；SkeletonJson.ts / SkeletonBinary.ts |
| 我们两个仓现在用 `<script>` 引入 `pixi-7.4.2.min.js` 和 `pixi-unsafe-eval`，package.json 里没有 pixi 依赖 | app-ab@cf62f17、client-companion@7ca2018 的 public/live2d/runtime |

**决定**：锁定 **Spine 4.3.x**（package.json 精确到 `4.3.13`，升级 patch 要走 PR）。我们没有历史素材要兼容。ryza-ai-revive 用 4.2，是因为它要兼容官方包里的素材，这个理由对我们不成立。

**候选**，P2 第一周做 spike，实测以下几点后二选一：

1. **`@esotericsoftware/spine-webgl@4.3.13`**（首选）。ryza-ai-revive 用的就是这套底层 API（ManagedWebGLRenderingContext、PolygonBatcher、SkeletonRenderer），改写最直接。Live2D 退场后可以把 Pixi 整个删掉。
2. `@esotericsoftware/spine-pixi-v7@4.3.x`。可以沿用 Pixi 7.4.2，过渡期里能和 Live2D 共用一个 canvas。但要继续带着 `pixi-unsafe-eval`。

**实测项**：App 的 CSP（`script-src 'self' 'wasm-unsafe-eval'`）；Capacitor WebView（安卓、iOS）下能不能跑；**WebGL 单上下文**（沿用 companionModel.ts ★★ 的教训：模块级常驻画布，换模型只换 stage 里的内容，不销毁重建）；blob: URL 的资源解析（bundlePreview.ts ★★★ 的坑，上传预览要用运行时的自定义资源加载器）。以上**本次都没有实测**。

**Web 和 App 共用**：渲染器、协议、标签解析客户端，第一期两仓各放一份，内容逐字相同，加一个 CI diff 检查；第二期再抽成 `@qimeng/companion` 共享包。

---

## 5. 市场：「人格 + 模型」统一发布

### 5.1 数据模型

把 `Live2dModel` 改成 **`CharacterModel`**。现有文件：models/Live2dModel.js 52 行、controller 423 行、routes 65 行、schemas 100 行、live2dBundle.service 426 行、live2dCapabilities.service 445 行、live2dMarket.service 114 行，都固定到 @699e255。

```js
CharacterModel {
  author, name, description, cover, tags, shared, takenDown, stats,
  persona: ref Persona,            // 推荐人格（已有）
  voice,                           // 已有
  license: { selfMade, agreedAt, spineEditorLicense: bool },  // 新增 spine 声明
  portrait: { dir, faces:{normal:path,...}, talk:{...}, hitAreas, fit, capabilities, bytes, fileCount } | null,
  spine:    { dir, skeletonPath, atlasPath, format:'skel'|'json', spineVersion, manifest, capabilities, bytes, fileCount } | null,
  kinds: ['portrait','spine'],     // 派生，用于筛选和角标
  legacy: { live2d: {...} }        // 存量迁移
}
```

- 在 pre-validate 里保证 `portrait` 和 `spine` 至少有一个。
- 上传接口拆成两个子资源：`PUT /api/character-models/:id/portrait` 和 `/:id/spine`。这样可以先发立绘，以后再补 Spine。
- 路由从 `/api/live2d-models` 改成 `/api/character-models`，旧路径保留一个别名，理由是已经发出去的 App 版本还会调旧接口（这是推断，没有验证）。前端路由 `/live2d/market` 做 301 跳转。
- `Persona` 加一个 `defaultModel` 反向引用，市场详情页可以互相跳转。现在 Persona 有 `price`（Persona.js L51），模型没有，定价规则见 §9。

### 5.2 发布流程

- 新增「发布角色」向导，分四步：人格（复用 personaWizard）→ 模型（选立绘、Spine 或两者）→ 声音 → 声明与预览。App 的 SupportCreatePage 在现有「三扇门」之外再加这一扇。
- `POST /api/characters/publish {personaId, modelId}`：校验归属、未下架、至少一种资源、原创声明，通过后**在一个事务里**把两者同时设为 `shared=true`。

### 5.3 上传校验

**可以复用的外壳**，都在 live2dBundle.service.js@699e255：

- multer 内存接收，zip 上限 25MB（L29、L46–48）
- 解压总量 60MB、最多 500 个条目，防 zip 炸弹（L31/33）
- 过滤 `__MACOSX` 和 `..` 路径穿越（L173–182）
- 只看**最后一个扩展名**的白名单，防 `evil.png.html`（L145–152）
- `safeSlug` / `walkFiles` / `publicUrlFor`（库里只存相对路径）/ `removeBundleDir`
- Cloudinary 直传后的取回和删除（L355–400）

**要改的地方**：白名单改成参数；`installBundle` 里认 model3.json 的入口识别（L316–320）要重写；错误文案去掉「Live2D」；删掉 `writeCompanionJson` 和 `live2dCapabilities` 的依赖。

**Spine 包**（新建 spineBundle.service）：

- 扩展名白名单：`.skel .json .atlas .png .webp`
- 包里恰好一个骨架入口；有多个时要求用户指定 `entry`（现有 schema 已经有这个字段）。
- **版本校验**：
  - `.json`：取 `JSON.parse(x).skeleton?.spine`，用 `/^4\.3\./` 匹配。依据 SkeletonJson.ts@4.3，这个字段只是被赋值给 skeletonData.version，运行时并不校验。
  - `.skel`：跳过前 8 字节（两个大端 int32 的 hash），读一个 varint 作为长度 n（0 表示 null，1 表示空串），再读 n−1 字节的 UTF-8 串。依据 SkeletonBinary.ts@4.3。
  - 版本不匹配就拒收，提示「请用 Spine 4.3.x 重新导出」。
- `.atlas` 里的每一页贴图都要在包里找得到；单张边长 ≤ 4096（`readImageSize` 可以复用）。
- 用 Node 加载 spine-core 解析一遍骨架，解析失败就拒收（防止版本串伪造）。

**立绘包**（新建 portraitBundle.service）：规格见 §3.3。只收 `.png .webp .json`；必须有 `normal`；各张尺寸一致；要有 alpha 通道；边长 ≤ 2048。

### 5.4 能力提取

照 live2dCapabilities 的四段结构（extract → suggestMapping → validateMapping → completenessOf）写：

- **Spine**：提取 animations、skins、slots、bones、events、BB_* 附件名；判断有没有疑似 mouth 和 blink 的动画或插槽；按 §3.2 的命名规则用关键词打分，生成 manifest 草稿（复用 `findByKeywords`）。完整度用来在市场上显示角标，比如「9/9 表情 · 口型 · 触摸」。
- **立绘**：提取有哪些 face、有没有 talk 图、尺寸、有没有 alpha。

### 5.5 和角色卡导入的关系（用户已拍板支持）

- `POST /api/personas/import`，接收 JSON 或 PNG（从 PNG 的 tEXt chunk 取出卡数据）。映射关系：
  - description、personality、scenario 合并进 `style.summary`（上限 2000）
  - first_mes 进 `greeting`（上限 300）
  - mes_example 进 `examples`（最多 12 条，每条上限 300）
  
  依据：Persona.js@699e255 L20–31、persona.schemas.js L14–45。
- **丢弃** `system_prompt` 和 `post_history_instructions`。导入的结果**强制 `shared=false`**，只能是私有草稿。
- Persona 加 `source {kind:'original'|'imported-card', format, cardHash, originalCreator, importedAt}` 和 `license {selfMade, agreedAt}`。如果是 imported-card 且没有原创声明，发布时拒绝。
- 导入的卡**只产出人格**，模型要另外上传或从市场里选。卡里的文本在提示词里按**不可信数据**包裹。

### 5.6 内容治理

现状：Report.js@699e255 L23 是 `TARGET_TYPES = ["video", "comment", "danmaku"]`，L39 是 `REASONS = ["csae","porn","violence","abuse","spam","infringe","other"]`，L53 是 `URGENT_REASONS = ["csae"]`。优先级由 pre-save 按 reason 计算。report.controller.js L421 的日志显示 `services/takedown.service.js` **还没落地**。

改动：

- `TARGET_TYPES` 加 `persona`、`character_model`。App 的 `src/api/admin.ts` 要同步改；按注释的要求，两边必须「逐字相等」。
- 在 `resolveTargets` 里加这两种类型的解引用。下架时把 `takenDown` 设为 true，并且让引用它的 `CompanionSetting` 回退到官方角色。
- **csae 规则沿用现有逻辑**：插队处理、下架、封号、留存证据、依法报告。在 branchAdmin 的删号流程里，csae 相关证据不删；判定一律走 `Report.URGENT_REASONS`，不在别处手写 "csae"。
- 上传时的防线：原创声明、Spine 授权声明、禁止 NSFW 变体（服务端**拒收**文件名含 `nsfw` 的贴图页，tag 白名单里也没有 undress 字段）。
- `takedown.service.js` 是现有的缺口，**建议另开任务先补上**，否则 persona 和模型接入举报之后仍然没法一键下架。

---

## 6. 记忆：L1 → L2 → L3

### 6.1 现状

依据：server-support@699e255、client-companion@7ca2018、app-ab@cf62f17。

- 两个 chat 接口都是**无状态**的，每次由客户端带着整段 `messages` 发过来：`/api/companion/chat` 最多 20 条（companion.routes.js L46），`/api/support/chat` 也是 20 条（support.routes.js L54）。
- 客户端只放在内存里，`MAX_HISTORY=12`（CompanionChat.tsx L50、SupportPage.tsx L72）。localStorage 里只存了语音开关。
- 真正落库的只有两处：转人工时的 `SupportTicket.transcript`（≤30 条），以及用户点赞点踩时的 `SupportFeedback`（问题原文 ≤1000 字、回答原文 ≤4000 字）。

### 6.2 L1：聊天记录持久化（P1）

```js
ChatConversation { user, channel:'companion'|'support', persona, model, title,
  lastMessageAt, messageCount, summary, summaryUpToSeq, deletedAt }
  index {user, channel, lastMessageAt:-1}
ChatMessage { conversation, user, seq, role, content, emotion, face, action, handoff, audioKey?, createdAt }
  unique {conversation, seq}; TTL 按保留期
```

- 接口：
  - `GET /api/chat/conversations?channel=`
  - `GET /api/chat/conversations/:id/messages?before=&limit=`
  - `DELETE /api/chat/conversations/:id`（软删还是硬删待定，见 §9）
- 两个 chat 接口改成接受 `{conversationId?, message}`。服务端从库里取最近 N 条拼上下文，SSE 的 `done` 事件里带回 `conversationId`。
- **兼容旧 App**：请求里带 `messages[]` 的走旧逻辑，不落库。
- 写入时机：先插入用户消息，流结束后再插入助手的整句。流中途断了就标记为 `partial`。
- `audioKey`：TTS 结果可以缓存，用来**重播历史语音**，这是 RyzaChat 被吐槽的点。可选。
- 转人工时 `SupportTicket` 直接引用 `conversationId`，不再复制 transcript。
- 游客：只存在本地（try/catch 包好）。登录后提示是否合并到账号。
- 隐私：在隐私政策里告知「对话会存储在服务端，可以删除」，并写明是否用于训练。

### 6.3 L2：滚动摘要（P3）

- 算法改写自 ryza-ai-revive 的 memory.js（两层结构）：
  - 每满 8 轮生成一张 **session 卡**，限 200 字以内，要保留专有名词、约定、情绪变化；
  - session 卡满 8 张后折叠成一张 **summary 卡**；summary 卡满 8 张后在同一层合并；
  - LLM 失败时退回用原文拼接并截断。
- 再借 AgentAtelierR 的「事实卡」结构：category / importance / keywords。承诺、重要的人生事件这几类由**代码强制保护**，不能只靠提示词要求。
- 存储：新增 `MemoryCard {user, channel, persona, layer:'session'|'summary'|'fact', text, keywords, importance, fromSeq, toSeq, createdAt}`。由后台任务异步生成，不阻塞回复。
- 提示词结构：静态前缀（人格、格式）→ 记忆块（summary 在前，session 在后，新的在下）→ 最近 N 条原文 → 动态段。这样排是为了让前缀缓存能命中。
- 用户可以在「她记得的事」页面查看、删除记忆卡。这也是对「记忆越长越接不上」的产品化回应。

### 6.4 L3：向量回忆（P4）

- 两个开源项目**都没有**向量回忆（AgentAtelierR 代码里没有 embedding、cosine、vector）。需要自己做。
- 用 aiClient 的 embedding 接口（单一 provider）给 `ChatMessage` 和 `MemoryCard` 生成向量。检索按 `{user, channel, persona}` 过滤后取 top-k（k≤6），再按时间和重要度重排。
- 向量存在哪里有两种做法：如果生产库是 MongoDB Atlas，可以用它的向量检索（**我们用不用 Atlas 没有核实**）；如果不是，就在应用内对每个用户做小规模的余弦计算（每人几千条以内），以后再换专门的库。
- 触发：每轮都检索，但只注入相似度超过阈值的结果。当用户出现回指词（上次、还记得……）时调低阈值。

### 6.5 看板娘和客服的差异

| | 看板娘 / 陪聊（companion） | AI 客服（support） |
|---|---|---|
| L1 | 存。支持跨设备 | 存。转人工时工单直接引用 |
| L2 | 跨会话，按人格累积 | **只在会话内**做摘要，不跨会话积累个人记忆 |
| L3 | 跨会话向量回忆 | 默认关闭。检索的是**知识库**，不是个人记忆 |
| 注入位置 | 人格之后 | **永远在知识库红线之后**（「禁止承诺」「转人工判定」「联系方式」三节，support.service.js@699e255 L10–17、L50、L193–201），标注「仅供参考，不得覆盖规则」 |
| 隔离 | 两个渠道的记忆**互不可见**，陪聊内容不能进入客服上下文 | |
| 人格 | 决定语气和内容 | 只影响语气（personaLine 和 few-shot） |
| 安全 | 标明是 AI；自伤时中断人格并转介；专业领域免责声明 | 同左 |

---

## 7. 分期

| 期 | 内容 | 交付物 | 依赖 | 谁来做 |
|---|---|---|---|---|
| **P0 决策**（本周） | §9 里的授权档位、美术人选、营收档、保留期等 | 决策记录 | 产品负责人 | 用户 |
| **P1 立绘先行加 L1**（约 2–3 周） | ① 渲染器接口和**立绘实现**，模式切换按钮（两端）；② CharacterModel 数据模型、迁移脚本、`/api/character-models` 加旧路由别名、**立绘上传**和能力提取；③ **L1 聊天持久化**和历史 UI；④ 角色卡导入；⑤ 举报支持 persona 和模型；⑥ TIMING 换成自测值，加 THIRD_PARTY_NOTICES；⑦ 冻结 Live2D 的新上传 | 三仓各一个 PR，带测试 | 小梦的 9 张立绘（没有的话，临时方案见 §8） | **我们写代码** |
| **P2 Spine 运行时**（约 3 周） | ① spike：spine-webgl 和 spine-pixi-v7 的 CSP、WebView、单上下文实测；② **Spine 渲染器**（改写 ryza 的 A 类代码）；③ Spine 上传：版本校验、manifest 草稿、预览向导；④ 随包 Spine 许可证；⑤ 发布角色的统一向导；⑥ 历史语音重播 | PR，加 spike 报告 | **Spine Pro 或 Enterprise 授权必须先生效**；一个测试用骨架（必须是自有或可用素材） | 我们写代码，用户购买授权 |
| **P3 小梦 Spine 加 L2**（美术 4–8 周，并行） | ① 美术按 §3.2 契约做小梦的 Spine；② 小梦的 motion 和 coverage 回归测试接入 CI；③ **L2 滚动摘要**，以及「她记得的事」页面 | 小梦 Spine 包；L2 的 PR | 美术人力，美术的 Pro 编辑器 | 美术加我们 |
| **P4 L3 加清场** | ① **L3 向量回忆**；② 删除 Live2D 代码（§8）；③ 共享包 `@qimeng/companion` | PR | P1 的 App 版本普及率达标 | 我们写代码 |

注：工作量估算来自代码行数统计，按 @cf62f17 / @7ca2018 / @699e255 算：

- 删除：Live2D 前端约 2,500 行（App 1,626、官网 841），官网旧挂件约 600 行。
- 新增：渲染器接口加立绘约 400 行，Spine 实现约 700 行。服务端市场迁移约 600 行（要重写 757 行测试），Spine 和立绘校验约 600 行，统一发布约 150 行，L1 约 300 行，角色卡导入约 250 行。

---

## 8. Live2D 退场计划

1. **P1 起**：Live2D 还能渲染存量模型，但**禁止新上传**。市场的上传入口换成「立绘 / Spine」。
2. **官方小梦的过渡**：Spine 做好之前，小梦**默认用立绘模式**。立绘可以请美术先画 9 张。另一个选项是用现有的 `mascot.moc3`，通过 `companionModel.snapshot()` 渲染出 9 个表情截图作为临时立绘；这要先确认这个 Live2D 模型的著作权归我们，本次没有核实。Live2D 版小梦在 P1 期间保留为第三种隐藏模式，作为兜底。
3. **存量用户模型**：迁移脚本把它们写进 `legacy.live2d`，在市场里隐藏。`CompanionSetting.model` 指向这些模型的，回退到官方角色，并给作者发站内通知，请他用立绘或 Spine 重新发布。
4. **P4 删除**（前提：新 App 版本的占比达到约定阈值，阈值待定）：
   - **App**：`src/live2d/*`（companionModel、bundlePreview、loader、mapping、prefetch）、`public/live2d/**`（包括闭源的 Cubism Core、pixi、pixi-live2d-display）、`studio/live2dUploadStore.ts`、SupportModelNewPage 里的 Live2D 分支。
   - **官网**：`src/live2d/*`、`public/live2d/**`、`public/live2d-widget/**`、`SiteLive2D.tsx/.css`（在 App.tsx:219 全站挂载，默认从 jsDelivr 拉 Hiyori）、`Live2DSettingsPage`，以及各个 Live2d 市场页（改名，保留跳转）。
   - **服务端**：Live2dModel 的 controller、routes、schemas、services、tests，`User.live2d` 子文档，`POST /api/me/components/live2d/upload`，`components.controller.js` 里的 `uploadMyLive2dBundle`。`/api/live2d-models` 的别名最后一个删。
5. 如果选了 spine-webgl，**Pixi 也跟着一起删**，`LICENSE-pixi.txt` 随之移除。

---

## 9. 需要用户拍板或提供的东西

| # | 事项 | 为什么 | 建议 |
|---|---|---|---|
| 1 | **公司过去 12 个月的营收加投资加融资，是否低于 50 万美元** | 决定买 Pro 还是 Enterprise（编辑器协议、购买页） | 由你确认 |
| 2 | **购买 Spine**：Pro，每席位 $379，永久；或 Enterprise，$2499 起加每人 $379，按年付。需要几个席位 | Runtimes License 2.1(b) 要求集成时就持有有效授权；网格和物理是 Pro 功能 | 至少 1 席给工程，美术视情况再加 |
| 3 | **小梦的美术谁来做**：内部还是外包；9 张立绘和 Spine 的排期 | 代码补不了美术质量。RyzaChat 的质量来自原作画师监修 | 先画立绘，再做 Spine |
| 4 | 发邮件请 Esoteric 书面确认：①平台允许用户上传自己导出的 Spine 数据、由我们的运行时播放，我们有没有额外义务；②IK 到底算不算 Pro 功能（购买页前后矛盾） | 协议没有直接写这种情况；「数据文件不含运行时」只是我们的推断 | 由你发邮件，或授权我们起草 |
| 5 | 是否要求上传者声明「持有合法的 Spine 授权并拥有美术权利」 | 编辑器协议 §2.3、2.4 | 要求 |
| 6 | 存量 Live2D 用户模型：隐藏后通知作者重发，还是保留为第三种渲染模式 | 你说过「不用 live2d」 | 隐藏后通知作者重发 |
| 7 | 旧 `/api/live2d-models` 路由保留多久，App 旧版本的占比阈值定多少 | 已发出去的 App 还在调用 | 两个版本周期，或占比 < 5% |
| 8 | 聊天记录的保留期；删除是软删还是硬删；客服对话里有个人信息，隐私告知怎么写；是否承诺不用于训练 | L1 上线的前提 | 法务定 |
| 9 | 立绘按 FACES 命名、`normal` 必须有、`-talk` 张嘴图可选，这个约定是否确认 | 影响上传规格 | 确认这样做 |
| 10 | 「角色」的定价：现在人格可以定价，模型不能；合并发布后怎么定价；皮肤要不要收费 | 统一发布的前提 | 第一期不收费 |
| 11 | 法务判断三件事：①protocol.ts 里来自 AgentAtelierR（无 LICENSE）的 TIMING 数值和动作名列表；②依据 ryza-ai-revive 反编译行为写出的实现，能不能改写复用 | IP 风险 | P1 先换成自测值 |
| 12 | 要不要做 ASMR 风格、年龄门槛（RyzaChat 是 18+）、「高质量记忆」要不要放进付费权益 | 产品定位 | 暂不做 ASMR；记忆作为基础能力免费 |
| 13 | 是否先另开任务补上 `takedown.service.js` | 举报接入 persona 和模型之后，才能一键下架 | 补 |

---

## 附：还没核实的项（不要当事实用）

- RyzaChat 用的是 Spine、Live2D 还是自研引擎：官方只说「素材の"動きの組み合わせ"」。
- 「v1.1.1 新增 2,000+ 表情」、延期原因、「8-24 分批先行体验」：一手来源只有 X，这次拿不到。
- 月订阅价格、Token 包各含多少 Token：只有用户评论提到。「特価 ¥1,850 / 通常 ¥3,700」只出现在 workers.dev 公告里，App Store 页面上没有。
- 雑談模式里其他角色是否出场、免 Token 的闹钟、地图能否移动、游戏内天数：没有一手来源。
- AgentAtelierR 的 Gemini 版工具轮数、MiMo TTS：源码没有公开。
- 官方 gesture.json 的真实结构：只从读取代码反推过，原文件是游戏素材，按规矩没有下载。
- Spine 运行时在我们 CSP 和 WebView 下的表现、单上下文行为、MongoDB 是否是 Atlas：都没有实测。