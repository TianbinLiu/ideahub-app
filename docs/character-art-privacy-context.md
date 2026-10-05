# 启梦创作｜立绘、Spine、聊天记录与上下文：调研与决定

资料抓取日期统一为 **2026-09-18**。价格和条款可能会变，下单或上架前请再看一次原文。代码只读 origin/main：server-support 699e255、app-ab cf62f17/3c35211、client-companion 7ca2018。

---

## A. 立绘和 Spine 怎么做出来

### A0. 先说结论
- **还没有一个 AI 工具能把一张立绘直接变成能用的 Spine 4.3 网格变形角色。** 拆层和抠图可以交给 AI，初版骨架也能半自动生成。权重、表情、口型、头发物理和待机动作还得靠人，可以你自己做，也可以委托动画师。
  - See-through 作者说它不等于 Image-to-Live2D，绑定不在项目范围内。见 https://github.com/shitagaki-lab/see-through ，README，最后提交 2026-08-05。
  - Layer.ai 页面写着 "final animator adjustments may still be required"。见 https://layer.ai/tools/layer--create-spine-components
- **立绘这一步可以全部走你已有的火山方舟 API，不用新注册任何账号。** 开工前有两个条款问题要先确认（见 A1 第 0 步）。

### A1. 推荐路线（每一步：谁做、用什么、授权、花费）

**第 0 步：先确认两件事，都得你本人做**
1. **小梦原画当初是不是通过 API 生成的。**
   - 《火山方舟专用条款》3.7.14 规定：API 生成的内容，合规前提下可以使用；在「方舟体验中心」生成的内容，不能主张知识产权，也不能用于体验以外的用途。
   - 如果是在体验中心点出来的，要走 API 重新出图。
   - 出处：https://www.volcengine.com/docs/82379/1104498 ，2026-08-11 生效。
2. **条款 3.1 的地域限制。** 原文写的是「仅在中国大陆地区使用本服务」，「就本服务进行商业使用或以其他方式直接或间接获得收益」需要火山引擎事先书面许可。
   - 我们的服务器在香港，产品也要上境外的 Google Play，这一条对我们是否适用，建议提工单要一份书面答复。
   - 另外，条款没写「生成物著作权归用户」，只写了使用许可。

**第 1 步：主立绘抠成透明底。AI 做，你修边**
- 工具：本地跑 isnet-anime（来自 SkyTNT/anime-segmentation，Apache-2.0，专门针对动漫角色）或 BiRefNet（MIT），都可以免费商用。
- **别用 rembg 的默认模型。** README 写明默认模型已换成 bria-rmbg（RMBG-2.0，CC BY-NC 4.0），商用要和 BRIA 签付费协议。调用时必须显式写 `-m isnet-anime` 或 `-m birefnet-*`。见 https://github.com/danielgatis/rembg
- remove.bg 的免费结果只能私人使用，商用要订阅或按量付费。最低档 Personal 是 40 credits，月付 $9，年付合 $8.10/月（$97.20/年）。按量最低 3 credits 卖 $3。上传会授予 Canva Austria 一份永久、可再许可的许可，范围包括输入和输出。见 https://www.remove.bg/tos （Last updated 16 July 2025）和 https://www.remove.bg/pricing

**第 2 步：出 9 个表情。AI 做**
- **首选 Seedream 5.0 pro 透明模式。** 输入只放上一步的透明 PNG（必须本身带透明通道，传 jpeg 会报错），参数设 `background=transparent`、`output_format=png`、`watermark=false`、size 固定。每个表情调 1 次，提示词只改表情。
  - 限制：透明模式只能输入 1 张图，只有 5.0 pro 支持。见 https://docs.volcengine.com/docs/82379/1541523?lang=zh （更新于 2026-09-09）
- **备选：Seedream 4.5 组图。** 1 张参考图加 9 张输出，满足「参考图数 + 输出数 ≤ 15」。出来是白底，再用第 1 步的工具抠图。
- **水印和标识。** `watermark` 默认是 true，会在右下角加「AI 生成」字样，所以出立绘要显式关掉。但按条款 3.7.13，**不管开不开水印，给 AI 生成内容加显式标识和隐式标识都是我们的义务**，平台只提供工具，责任由我们承担。
- **费用。** 价格页 https://docs.volcengine.com/docs/82379/1544106?lang=zh （2026-09-17）的 5.0 pro 单图生成是：≤261 万像素（1.5K 及以下）0.30，>261 万像素 0.60。表里没写单位，按元/张理解。9 张加上重试，大约几块到几十块钱。
  - 仓库里记的 4.0 每张 0.20 元、4.5 每张 0.25 元只是内部记录，要以控制台为准。
- **保真度要实测。** 只喂 1 张参考图时，星星发饰、薄荷绿挑染和瞳色能不能保住，没人实测过。
- **离线备选（Apache-2.0，可以商用）：**
  - Qwen-Image-Edit-2511，模型卡写明「显著改进角色一致性」。见 https://huggingface.co/Qwen/Qwen-Image-Edit-2511
  - FLUX.2 klein 4B。
  - 两者都可以加 ControlNet union SDXL（Apache-2.0）锁姿势。
- **不建议当主力的：**
  - Midjourney：禁止自动化，也没有 API。官方说雀斑、衣服 logo 这类细节可能对不上。「不能原生出透明底」这一点我没在官方文档里核实到，只知道 Editor 能导出擦除区域的透明 PNG。
  - FLUX [dev] 系列：非商业许可，拿来给产品出素材存在灰色地带。
  - NovelAI：锁角色（Precise Reference）只有 V4.5 能用。V5 官方说参考功能 "not part of the current launch"，透明底只在 V5 页面提到，所以两件事目前没法在同一个模型上同时做到。
  - Scenario 免费档：定价页写 "Free plan outputs are for personal and evaluation use only"。
  - Tensor.art：条款 3.1 不主张生成物权利，但所用底模和 LoRA 要逐个核对许可（3.9 条把后果推给使用者）。

**第 3 步：拆层，给 Spine 用。AI 做，你修补**
- **See-through V3。** 最多拆 23 层并补全被遮挡区域，输出分层 PSD。
  - 代码 Apache-2.0。主权重 HF 上标 apache-2.0，但它由 SDXL 微调而来，训练数据是社区收集的 Live2D 模型，上游许可的风险没法完全排除。我们只离线给自家角色出素材，风险低，但这是判断，不是法律意见。
  - 免费渠道：HF Space（GitHub README 说登录后每天约 1–2 次，1280 分辨率。Space 本身默认 768，官方建议免费配额用 768）；ModelScope 版目前免费，分辨率略高。本地跑需要约 12–16GB 显存，NF4 量化后约 8GB。
  - 说明：我们 roadmap 里的「拆 16 层」，推不出用的是旧版模型。23 是上限，重跑不一定能拆出更多层。
- **Seedream 5.0 pro 的 `layer_decomposition`** 能拆出 1 张底图和最多 16 个透明 PNG 图层。能不能拿来当抠图或替代 See-through，要用小梦的图实测。
  - 限制：图层是按 1K/1.5K/2K 档位重新生成的，不保证和原图像素一一对应，也不保证人物单独成一层。任一图层失败，整个请求报错。
  - 计费：按每个图层的档位单独算，0.15 或 0.30。见 1544106 价格页。

**第 4 步：绑骨和动画。半自动加人工**
- **可选的初版骨架：**
  - StretchyStudio（MIT）：吃 See-through 的 PSD，自动出骨架和三角网格。源码写死导出 `spine:"4.0"`，没有权重，也没有 deform 动画。要先用 4.0 编辑器导入、存成工程，再用 4.3 打开导出。见 https://github.com/MangoLion/stretchystudio
  - God Mode AI：$32/30 credits、$100/125 credits 或 $38/月，1 个 credit 对应 1 个角色，页面称所有方案都可商用。它只导出 3.5–4.2，没有 4.3。它面向全身游戏精灵，拆 6 个部位，默认是刚性部件，头发、披风、裙子、袖子可以勾选 "Bend like cloth" 变成可变形网格，但页面没说这些网格带不带骨骼权重。**它不适合半身陪聊立绘。** 服务条款原文也没核对。见 https://www.godmodeai.co/ai-spine-animation
- **Spine 4.3 Pro 里的半自动功能：**
  - Import PSD：按图层名标签（[bone]、[slot]、[mesh] 等）导入，不会自动识别骨骼。
  - 网格 Trace 和 Generate。
  - Auto weights：按网格拓扑计算权重。
  - 物理约束。
  - 见 https://esotericsoftware.com/spine-weights
- **必须人工的部分：**
  - 按变形需要重新切层：刘海分束，眼白、睫毛、瞳孔分开，嘴内单独一层。
  - 调骨骼层级和轴心，修权重。
  - 做表情和口型。
  - 调头发和披风的物理参数。
  - 编待机和说话动作。
- **版本规则：** 运行时的 major.minor 必须和导出所用编辑器一致。第三方给的 4.0 或 4.2 数据，要用对应旧版编辑器导入、存成工程，再用 4.3 导出。见 https://esotericsoftware.com/spine-versioning
- **不推荐的路线：**
  - DragonBones：转换工具写死输出 Spine 3.6.0，最后一次代码提交是 2020-05-24。
  - Genielabs spine-animation-ai：免费许可是 PolyForm NC，禁止商用，商用要另外找他们谈。

**大致花费**：Spine Pro 一次性 $379。立绘和表情几块到几十块钱。拆层免费。如果绑骨外包，另加 A3 的委托费。

### A2. 买 Spine 授权：具体步骤（下单和付款都由你本人操作）
1. 打开官网 https://esotericsoftware.com/spine-purchase ，选 Professional，点 BUY NOW，会跳到 /spine-checkout/PRO。页面标价是 ~~$449~~ **$379**，没写折扣到哪天截止，下单时再看一眼。
2. 付款方式：Visa、MasterCard、JCB、Discover、Diners 的信用卡或借记卡，或者**支付宝**。不收 American Express 和 PayPal。不需要采购订单，也不要求必须是公司。
3. 付款后邮件会收到下载说明和 license page 链接，发票也在 license page 下载。
4. 条款要点（https://esotericsoftware.com/spine-editor-license ，Last updated April 5, 2025）：
   - **买断**，后续更新免费。但前提是被许可人过去 12 个月的营收加上投资和融资合计少于 **50 万美元**，超过门槛协议立即终止，要改买 Enterprise。你目前营收为 0、没有融资，符合条件。
   - 被许可人的定义包括个人："the person or entity licensing the Spine Editor"。
   - **一人一个具名授权**，激活码最多装在 2 台电脑上，同一时间只能 1 台在用。
   - 不能以任何理由把授权借给、转给或再许可给第三方，所以**外包动画师必须用他自己的 Pro 授权**。
   - 付款后 30 天内可以无理由退款。
5. 商用发布：持有有效授权时，可以把 Spine Runtimes 集成进产品商业发布。App 或网站的「第三方许可」页要附上 Spine Runtimes License 全文。见 https://github.com/EsotericSoftware/spine-runtimes/blob/4.3/LICENSE
6. **只在官网买。** 官方说没有经销商计划。搜到的 SoftwareOne 条目没核实，别从那里买。Steam 上找不到官方在售的一手证据。

### A3. 备选方案
- **买现成素材：不推荐，最多当占位或练手用。**
  - Spine 官方素材包只有 Hitman 和 Gunman，每个 $10，都是男性平台跳跃角色，不适合做看板娘。
  - Unity Asset Store：Gamelauncher 的 Rosie $8、Rina $15。页面都标了 Created with AI，没写 Spine 版本，也没列眨眼、说话这类动作。EULA 要求素材和大量原创内容一起嵌入产品，而且是非独占授权，别人也能买，会撞形象。见 https://unity.com/legal/as-terms
  - itch.io：€6.99 起到 $35 起都有，许可逐个看作者怎么写，没找到带明确商用许可、又适合做看板娘的动漫少女 Spine 角色。
  - Booth 和 ArtStation 没找到合适的。
  - 这些都不是小梦本人。
- **委托画师：可行。**
  - Coconala：Spine 动画服务起价约 **¥8,000–¥20,000**。例如葵ゆうき起价 ¥8,000，写明可商用（https://coconala.com/services/3041334 ）；Chikiyo ¥10,000（不含税），要求提供已拆好部件的图（https://coconala.com/services/4216477 ）。
    - 页面默认只交付视频（MP4/MOV 等），起价不含重绘和拆件。
    - 平台默认著作权不转让，成果物默认非独占许可（https://coconala.com/pages/terms_user ）。
  - Skeb 不适合：条款默认只允许个人观赏或用作 SNS 头像。
  - Spine 官方论坛 Networking 版块可以找熟悉 Spine 的动画师，但没有平台担保，要自己签合同。
  - Fiverr：搜索结果标题里的 gig 起价有 $10、$15、$25，一手页面返回 403，**没核实**。米画师的一手页面也拿不到。
  - **合同里必须写明：**
    - 交付 .spine 工程和分层 PSD。
    - 用 4.3.x 导出 JSON 或 skel 加 atlas。
    - 著作权转让或独占商用许可。
    - 对方自己持有 Spine Pro 授权。
    - 作品集展示和保密的约定。

---

## B. 聊天记录与隐私：决定

### B0. 现状（代码事实）
- **看板娘和客服的对话都不落库。** 前端每次只发最近 12 条（`MAX_HISTORY=12`）。服务端上限是 20 条、每条 1000 字。超出的部分被静默丢掉，没有摘要，也没有记忆。
  - 服务端：server-support companion.routes.js:46-47、support.routes.js:54-55。
  - 前端：client-companion CompanionChat.tsx:50、app-ab SupportPage.tsx:72。
- **服务端已经存了原文的有两处，都没有保存期限：**
  - `SupportTicket.transcript`：转人工时存最近 30 条对话。
  - `SupportFeedback`：点赞或点踩时，把问题（≤1000 字）和回答（≤4000 字）原文一起存下，只追加不修改（support.routes.js:403-406）。
- **疑似 bug（推断，未实测）：** App 端每条历史截到 2000 字（SupportPage.tsx:286），服务端只收 1000 字。一条长回复之后，下一次请求可能被 zod 校验拒掉。下面的新方案改成服务端持有历史后，这个问题自然消失。
- **账号删除是个重大缺口：**
  - App 的「注销」调用 `/api/me/deactivate`，是软删除，只打一个 deactivatedAt 时间戳。
  - 网站的 `DELETE /api/users/:id` 只删 User 一条记录，不级联。
  - `purgeUserCascade` 只有管理员能触发，而且不覆盖 SupportTicket、SupportFeedback、CompanionSetting。
  - 相关文件：me.controller.js、users.controller.js:516、branchAdmin.controller.js:331。
  - Google Play 原文说临时停用、禁用、冻结都**不算删除**。见 https://support.google.com/googleplay/android-developer/answer/13327111
- **LLM 服务商在代码里没写死。**
  - 读取顺序：`AI_BASE_URL || OPENAI_BASE_URL`，模型是 `AI_MODEL || OPENAI_MODEL || 各调用点自带的 fallback`，多数是 gpt-5.2，workshop 是 gpt-5.4。
  - 按 2026-07-20 的项目记忆，线上是 DeepSeek `deepseek-v4-flash`。这个旧名现在由 DeepSeek-V4.1-Flash 提供服务，上下文 1M（https://api-docs.deepseek.com/zh-cn/quick_start/pricing ）。
  - **线上 .env 没核实。**
- **语音走火山引擎豆包语音，TTS 和 ASR 用同一套凭据。** 这意味着用户的录音会发给火山。

### B1. 决定

| 项 | 决定 |
|---|---|
| **保存什么** | 登录用户：①会话和消息原文（用于展示历史和上下文）；②滚动摘要；③事实卡「小梦记得的事」；④用量记录（只存 token 数，不存内容）。**语音音频不落库**，只保存识别出的文字（按这个原则实现，实现后核对 /api/asr 确实没有落库）。 |
| **存多久** | 陪聊原文和摘要：最后一次活跃后 **180 天**，用 TTL 自动清理。事实卡：保留到用户删除或账号删除。客服会话：最后活跃后 **30 天**。客服工单：结案后 **180 天**。点赞点踩评价：**180 天**。用量记录：180 天。安全和儿童安全举报：按法律要求另行保存。 |
| **删除（彻底删除）** | ①删单条事实卡：立即硬删。②删某个会话：立即硬删它的消息、摘要、用量记录，**以及从这个会话提炼出的事实卡**（按 `sourceThreadIds` 找，比 Claude 更严格。Claude 删对话不会连带删记忆）。③清空记忆：硬删全部事实卡。④删账号：token 立即失效，数据**立即排入删除队列**，7 天撤回期满后硬删所有集合（User、ChatThread、ChatMessage、ChatMemory、UsageLog、SupportTicket、SupportFeedback、CompanionSetting，加上作品线已有的 purgeUserCascade）。不能再用 deactivate 充当删除。 |
| **备份** | 备份不单独擦除，保留期满后自然被覆盖。另建一个 `DeletionLog`，只存被删对象的 ID 和删除时间，不存内容，保存期 ≥ 备份保留期。万一从备份恢复，先重放删除日志，被删的数据不会复活。隐私政策里如实写「删除后最长在备份中留存 X 天」，X 取 Atlas 快照的保留期（待确认）。依据：PIPL 第 47 条，技术上难以删除的，只能存储和做安全保护，不能再做其他处理。 |
| **游客** | 服务端不存任何对话内容，只在请求时传给模型，处理完不保存，属于 Data safety 里的 ephemeral。前端只放在页面内存里，没有记忆和事实卡功能。界面提示「登录后小梦才能记住你」。 |
| **客服 vs 陪聊** | 陪聊：长期关系，持久化会话和事实卡，可以跨会话记忆，用量条外显。客服：一次性事务，开新会话就清零，不跨会话记用户；转人工时工单存**原文**，不存摘要；用量条默认收起。 |
| **训练** | 我们**不用**聊天内容训练或微调任何模型。评价数据只用于人工抽查客服答案质量。第三方模型商是否会拿 API 输入去训练，DeepSeek 开放平台协议没写，在书面确认之前，隐私政策写「按服务商政策处理」。 |
| **第三方传输** | 对话模型：DeepSeek，数据存储在中国大陆（https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html ）。如果线上其实用的是方舟，就改写火山方舟。语音：火山引擎豆包语音。数据库：MongoDB Atlas。服务器：阿里云香港。短信：阿里云 PNVS。邮件：Resend。媒体：Cloudinary。登录：腾讯 QQ。这些都属于代我们处理数据的服务商，Data safety 里不算 shared（https://support.google.com/googleplay/android-developer/answer/10787469 ）。 |
| **跨境同意** | 所有数据都存在香港，所以**在登录时**加一个单独的「个人信息出境同意」勾选框，和用户协议、隐私政策分开勾。这是 PIPL 第 39 条的单独同意。事前做一份个人信息保护影响评估，报告和处理情况记录至少保存 3 年（第 55、56 条）。 |
| **首次陪聊弹窗** | 用户第一次打开陪聊时单独弹一次，需要用户主动点「同意」，返回键或划走都不算同意。内容：会存哪些内容、存多久、发给哪些服务商、可以随时删除、「陪伴聊天可能不适合部分未成年人」。 |
| **安全协议** | 陪聊和客服**都**上自杀和自残内容应对协议：识别到相关内容时引导用户去危机求助热线，并把协议公布在网站上。原因：App 客服用的也是小梦这个人设，按加州 SB 243，客服机器人只有 "used only for customer service" 才被排除，我们的客服不一定满足这个条件。 |
| **AI 内容举报** | 每条 AI 回复上都要有应用内举报按钮，这是 Google Play 的要求（https://support.google.com/googleplay/android-developer/answer/13985936 ）。如果现在还没有，就加上。 |

### B2. 隐私政策需要改的条目
下面的改动同时适用于 App 的 `src/data/agreements.tsx`（第 92–127 行）和网站 `zh.json`、`en.json` 的 `privacy.*`（约第 2420–2457 行）。

1. **一、收集什么**：新增 AI 陪聊和客服的对话内容、摘要和记忆条目、语音输入（只用于实时识别，不保存音频）、客服工单和评价、token 用量。注明游客的对话不保存。
2. **二、用途**：新增「维持对话连续性（记忆）」「客服答疑和人工跟进」「客服答案质量抽查」。明确写「不用于训练模型」。
3. **三、第三方**：现在写了方舟、Cloudinary、腾讯 QQ，还有一个没点名的「邮件服务商」。要补上 **DeepSeek（数据在中国大陆）**、**火山引擎豆包语音（TTS/ASR）**、Resend（点名）、阿里云 PNVS、阿里云香港服务器、MongoDB Atlas。每一家都写清楚接收哪类数据。
4. **四、存储与保留**：写明服务器在香港，并按 PIPL 第 39 条列出**境外接收方的名称、联系方式、处理目的、方式、信息种类，以及用户向境外接收方行使权利的方式和程序**。逐项写 B1 表里的保存期限（180 天、30 天、结案后 180 天等），以及备份最长留存天数。另外写明模型服务商可能在它的前缀缓存里短暂留存内容，DeepSeek 官方原话是通常几小时到几天（https://api-docs.deepseek.com/guides/kv_cache ）。
5. **五、权利**：把「注销后账号被标记为停用」（网站的 storageHowLong 和 rightsDeactivate，App 第 118 行）改成「删除账号 = 7 天撤回期满后彻底删除全部关联数据」。写明应用内和网页 `ideahubs.org/account-deletion` 两个删除入口，以及查看和删除会话、「小梦记得的事」的入口。
6. **新增一节「AI 陪聊说明」**：说明对方是 AI，不是真人；可能不适合部分未成年人；附自杀和自残应对协议的链接。
7. **年龄**：目前写的是 13 岁以上，按 C 节之后第 4 条待确认点的结果来调整。

### B3. 上架 Google Play 前要做的
- [ ] 应用内硬删账号，替换 `/api/me/deactivate`。
- [ ] 上线网页删除入口 `ideahubs.org/account-deletion`，把这个链接填进 Data safety 表单（https://support.google.com/googleplay/android-developer/answer/10144311 ）。
- [ ] Data safety 表单：
  - Messages 选 Other in-app messages：登录用户是 collected，并且会存储。
  - Audio 选 Voice or sound recordings：collected，只做 ephemeral 处理。
  - 个人信息选手机号、邮箱、姓名。
  - 全部标为「不 shared」，服务商豁免。
  - 标为「可申请删除」，传输时加密。
- [ ] 登录时的单独出境同意勾选框，以及首次陪聊的同意弹窗。
- [ ] 每条 AI 回复都有举报按钮。
- [ ] 隐私政策按 B2 改完，App 版和网站版保持一致。
- [ ] 在「第三方许可」页附上 Spine Runtimes License。

---

## C. 上下文窗口与自动提纯

### C1. 计量
- **真实值用接口返回的 usage。** DeepSeek 流式响应**不开 include_usage 也会在最后一个 chunk 带整次请求的 usage**（https://api-docs.deepseek.com/api/create-chat-completion ）。方舟的 `include_usage` 默认是 false，必须显式打开（https://docs.volcengine.com/docs/82379/1494384 ）。所以统一在请求里加 `stream_options:{include_usage:true}` 作为兼容写法。
- **我们现在拿不到 usage，是因为代码把它丢了。** `aiChatStream`（aiClient.js:152）只 yield `delta.content`，最后那个带 usage 的 chunk 被扔掉了。要改三处：
  1. `aiChatStream`：把 usage 作为返回值或事件交出去。
  2. `companion.service.js:260` 和 `support.routes.js:335`：在 `done` 事件里带上 usage。
  3. tests 里 mock 的 `aiChatStream` 同步改。
- **要记录的字段：** `prompt_tokens`、`completion_tokens`、`prompt_cache_hit_tokens`、`prompt_cache_miss_tokens`，以及 `completion_tokens_details.reasoning_tokens`。
- **发送前估算：** 汉字按 0.6 token、其他字符按 0.3 token 算（DeepSeek 官方比例，https://api-docs.deepseek.com/quick_start/token_usage ），再乘一个每个会话自己的校准系数 k。k 取「实际 prompt_tokens ÷ 估算值」的滑动平均，初值 1.0。这样换了 provider 也能自动校准，不用引入 tokenizer 依赖。
- **显示值：** 上一轮的 prompt_tokens + completion_tokens，也就是下一次请求的输入基数。这是 Claude Code 的口径，它的 used_percentage 只算输入（https://code.claude.com/docs/en/statusline ）。

### C2. 上限和阈值
- **Y 取产品预算，不取模型的 1M 窗口：**
  - 陪聊 **32k**。固定前缀最坏约 3.1k token。
  - 客服 **16k**。system 在 25 道评测题上约 3.1k/3.5k/4.5k token（最小/中位/最大），其中知识库节选占 61–73%。
  - 两个值放进 env（`COMPANION_CTX_BUDGET`、`SUPPORT_CTX_BUDGET`），实际取 `min(Y, 模型最大输入)`。方舟 doubao-seed-2-0-mini 最大输入是 224k。
- **成本：** deepseek-flash 高峰期缓存未命中 ¥2/百万 token，输出 ¥8/百万 token（中文页）。一轮 25k 输入约 ¥0.05，再加上输出费用。
- **阈值：**
  - 估算的下一轮输入 ≥ **0.6·Y**：UI 变黄。
  - ≥ **0.75·Y**：自动提纯。0.75 参照的是 Claude API compaction 默认的 150k/200k（https://platform.claude.com/docs/en/build-with-claude/compaction ）。
  - 连续两次提纯后仍然 ≥ 0.75·Y（通常是用户贴了超长文本）：不再重试，提示用户开新对话，避免反复提纯的死循环。

### C3. 提纯算法（回复生成完之后异步执行，不阻塞下一句 TTS）
1. 选取超出「最近 N 轮」、还没提纯过的消息。陪聊 N=6，客服 N=4。
2. 调 `aiComplete`，输入是旧摘要、这些消息、现有事实卡，以及可选的用户 focus 指令。要求输出 JSON：`{summary ≤600字, facts_add[], facts_update[], facts_remove[]}`。
3. 关掉思维链。DeepSeek 默认开启思考，关闭方式是 `thinking:{type:"disabled"}`。另外思考模式下 temperature 不生效（https://api-docs.deepseek.com/guides/thinking_mode ）。
4. 校验 JSON。保存上一版摘要和事实卡，用于回退。把这些消息标为 `compacted=true`：原文照样保留给用户看历史，只是不再发给模型。
5. 在对话流里插一条分隔提示：「已整理前 N 轮（保留摘要和 M 条记忆）」。
6. 这次提纯的 usage 单独记为 `kind:'compact'`。

### C4. 保留什么和拼接顺序
- **不参与压缩、每轮照常组装的：** system、人设、few-shot、客服 FAQ 和知识库。相当于 Claude Code 里压缩后从磁盘重新注入的 CLAUDE.md（https://code.claude.com/docs/en/context-window ）。
- **事实卡：** 最多 30 条、总共不超过 1.5k token。
  - 陪聊记：称呼、偏好、生日、正在做的创作、答应过的事。
  - 客服记：任务号、订单时间、设备和版本、报错原文、已试过的办法、**同一问题未解决的次数**（「连续两轮未解决就转人工」的规则依赖这一项）、是否已转人工。
- **滚动摘要：** 不超过 600 字。
- **拼接顺序：** system → few-shot → 事实卡 → 摘要 → 最近原文 → 新消息。稳定的部分放前面，尽量命中 DeepSeek 前缀缓存。
- **客服知识库的位置：** 现在知识库每轮按问题重新挑选，放在 system 末尾，前缀缓存从这里断开。可以挪到历史之后，作为一条独立的 system 消息，但**挪之前先用 evalSupport.js 回归一遍**，确认答题质量不掉。
- **演出标签：** 历史里的 assistant 消息改存带演出标签的原文 `modelText`，和 few-shot 示范的格式保持一致；展示给用户的是剥掉标签的 `displayText`。

### C5. UI
- **输入框旁的用量环：** 显示「上下文 3.2k / 32k」。低于 60% 灰色，60–75% 黄色，达到 75% 触发提纯。点开后按类别展示：人设/规则、知识库（仅客服）、记忆卡、摘要、最近对话。参照 Claude Code 的 `/context` 和 SillyTavern 的 Prompt Itemization。
- **菜单按钮：**
  - 「整理记忆」：手动提纯，相当于 `/compact`。可以附一句「重点记住…」作为 focus 指令。
  - 「新对话」：相当于 `/clear`，事实卡保留。
- **「小梦记得的事」面板：** 可以逐条查看、编辑、删除，可以一键清空，可以回退到上一版。SillyTavern 官方也警告摘要可能丢细节或有幻觉，所以这些功能是必要的。
- **客服端：** 用量环默认收起，只在提纯时出一条提示。

### C6. 数据结构（MongoDB）
- **ChatThread**
  - `_id, userId, scene('companion'|'support'), personaId, title`
  - `createdAt, lastActiveAt, expiresAt`（TTL 索引）
  - `summary{text, version, prevText, coversUntilSeq}`
  - `stats{lastPromptTokens, lastCompletionTokens, calibK, budget, compactFailStreak}`
- **ChatMessage**
  - `_id, threadId, userId, seq, role`
  - `displayText, modelText, estTokens, compacted:boolean`
  - `kind('msg'|'divider'), createdAt, expiresAt`（TTL 索引）
- **ChatMemory**
  - `_id, userId, scene, text, category`
  - `sourceThreadIds[], pinned, createdAt, updatedAt, prevText`
- **UsageLog**
  - `threadId, userId, kind('reply'|'compact'), model`
  - `promptTokens, completionTokens, cacheHitTokens, cacheMissTokens, reasoningTokens`
  - `createdAt`（TTL 180 天）
- **DeletionLog**
  - `targetType, targetId, deletedAt`
  - 只存 ID 不存内容，用于备份恢复后重放删除。
- **接口改动：** 前端只发新消息和 `conversationId`。历史由服务端持有，预算和提纯都在服务端做，不再信任客户端上传的历史。

### C7. 和 L1/L2/L3 的关系
- **L1 持久化：本次合并。** 就是上面的 ChatThread 和 ChatMessage，是记忆和删除流程的前提。
- **L2 滚动摘要：本次合并。** 和提纯是同一个机制，事实卡也一起做。
- **L3 向量回忆：顺延。** 32k 预算加事实卡已经够用，而加向量库会多一份要级联删除的 embedding。等上线后用 usage 数据证明「事实卡装不下」再做。

---

## 仍需你确认的点
1. **线上到底用哪家模型。** 在服务器上执行 `grep AI_ /var/www/ideahub-server/.env`，确认 `AI_BASE_URL`、`AI_MODEL`、`AI_EXTRA_BODY` 的值。这决定隐私政策写 DeepSeek 还是方舟，也决定思维链有没有关掉。
2. **小梦原画是走 API 生成的，还是在体验中心点出来的**（条款 3.7.14）。另外，要不要就条款 3.1 的地域和商用问题给火山引擎提工单要书面答复。
3. **Google Play 上架是否包含美国和欧盟。** 如果包含，陪聊加一个「我已满 18 岁」的自认门槛，参照 RyzaChat 仅限 18 岁以上的做法，SB 243 里未成年人每 3 小时提醒的义务就基本不触发。GDPR 第 3(2)(b) 条的行为监控这一项和是否把欧盟列为目标国家无关，要另外评估。
4. **是否继续对中国大陆用户开放 AI 对话。** 这涉及生成式 AI 服务备案或登记，DeepSeek 开放平台协议 3.3 条把这个义务推给了开发者。
5. **MongoDB Atlas 快照保留多少天**，这个数要写进隐私政策的「备份最长留存 X 天」。另外，发邮件问 DeepSeek：API 输入保留多久、会不会拿去训练。