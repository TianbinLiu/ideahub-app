# AI 视频平台「模板/玩法/特效/Skill」体系调研（2026-08-28）

> 背景：仓库主人点名调研 "libTV" 与 "updream"，以及市面成熟平台的模板/玩法体系，
> 评估哪些可以看齐、哪些内容能否照搬当我们的初始视频模板。
> 本文是联网调研产物（关键结论均附来源 URL，检索时间 2026-08-28）；
> 可执行结论已提炼进 [`backlog.md`](backlog.md) §2.8，读那份就够——本文是底稿与出处。
> ⚠ 「照搬」一节的结论（红线清单）是产品决策依据，动初始模板内容前必读。

## 一、"libTV" 与 "updream" 考证：两个都是真实产品

**结论：主人没记错名字。这两家恰好是与我们形态最接近的两个新对手
（无限画布、逐段生成、技能/Skill 封装、多模型接入），必须重点对标。**

### LibTV（liblib.tv）— LiblibAI（哩布哩布）的视频创作平台

- **身份**：LiblibAI（国内最大 AI 模型社区"哩布哩布"）2026-03-19 发布的一站式 AI 视频创作平台，自称"唯一同时服务人类创作者与 Agent 的视频创作系统"。https://www.c114pro.com/ainews/154200.html https://www.1ai.net/en/51292.html （个别导航站写"快手可灵旗下"是错的，混淆源头是它接入了可灵模型：https://www.aibase.com/tool/www.aibase.com/tool/41828）
- **形态**：无限画布 + 节点工作流。"支持文本、图片、视频、音频、脚本五种基础节点，节点之间可自由连线搭建工作流"；"双击任意位置，直接生成节点""从文本节点直接拉一条线出来，接到下一个节点""很像一张思维导图，但承载的是真实的创作逻辑"。https://www.aihub.cn/tools/libtv/ https://news.qq.com/rain/a/20260319A05XAY00
- **20+ 独家功能**：角色三视图与 360° 展示、9/25 宫格连贯分镜、26 个打光点位、电影级运镜控制、"聚焦"（框选上一节点画面里的主体/细节作为参考续生成）、"画面推演"（推演 3 秒后的画面）、节点内直接剪辑。https://news.qq.com/rain/a/20260319A05XAY00 https://www.aihub.cn/tools/libtv/
- **Skill 体系**：对 Agent 开放官方 Skill 包（GitHub：libtv-labs/libtv-skills，遵循 OpenClaw 规范），Agent 通过 Skill 接口"理解任务、调用模型、编排工作流、自动生成内容"，已开放"动画短剧生成 Skill"——聊天窗口发一句话，Agent 自动完成剧本、角色设计、分镜、逐段生视频、剪辑成片（5 分钟以上）。https://pexo.ai/blog/what-is-libtv-1029 https://zhuanlan.zhihu.com/p/2017944626061919460
- **模型**：不自研，聚合 20+ 引擎——视频侧 Seedance 1.5/2.0、可灵 3.0/O3、Wan 2.6 等；图像侧 LibNano、Seedream 5.0、Midjourney V7 等。https://www.aihub.cn/tools/libtv/ https://pexo.ai/blog/what-is-libtv-1029
- **价格**：年卡最低 39 折促销、宣称模型积分比主流竞品低约 70-92%、新用户最高 300 条免费视频额度。https://news.qq.com/rain/a/20260319A05XAY00 https://www.1ai.net/en/51292.html

### updream（updream.cn）— B 站官方 AI 视频创作助手（"UP" 即 UP主）

- **身份**：B 站自研，面向 UP 主与专业创作团队，定位"有记忆、可控、可复用"的 AI 创作伙伴。https://www.toolify.ai/tool/updream https://www.aihub.cn/tools/video/updream/
- **与我们同底座**：视频侧接入 **Seedance 2.0 / Seedance 2.0 Fast**（付费档专属，"无排队、支持真人参考"），另有 Kling 系、Vidu、海螺系、Veo 系、Wan 系；图像侧含 Seedream 系；文本侧 Gemini/GPT/DeepSeek/Qwen。https://www.aihub.cn/tools/video/updream/ https://www.xmsumi.com/detail/3169
- **Skill 体系（与主人说的"skill 小窗口"最贴）**：核心概念是"把常用的提示词、工作流、审美偏好封装成 Skill 技能，随时调用"，即"把提示词体系、审美偏好和创作套路系统化保存"；有内置**技能广场**，收录官方精选与用户自制技能（如"大圆镜科普文案写手""场景多机位助手""AI 短剧资产设计师"），**在对话或节点里按 "/" 唤起已激活的技能**；技能可社区分享、复用他人方法论。https://www.xmsumi.com/detail/3169 https://www.aihub.cn/tools/video/updream/ https://www.qianzhifang.com/tools/updream
- **形态**：无限画布（文本/图片/视频节点自由排布、拖拽、实时预览）+ 长记忆 AI 助手（"持续记录用户的偏好、风格选择、历史对话和项目状态"，系列创作自动延续到下一集）+ 素材库跨项目复用、分镜面板、版本管理。https://www.qianzhifang.com/tools/updream
- **价格**：积分制，注册送 1000 积分（约 5 条视频）；免费档 4 并发、生成内容**不可商用**；付费包 9800 积分/49 元、64800 积分/198 元，8 并发+高阶模型+优先排队。https://www.aihub.cn/tools/video/updream/ https://www.xmsumi.com/detail/3169

**对我们的含义**：字节（即梦）、快手（可灵）、B 站（updream）、哩布（LibTV）在 2026 年集体收敛到同一形态——"画布/逐段工作流 + 可复用的技能/模板封装 + 多模型报价"。我们的"卡组 + 视频模板 + 方案市场"结构不落后，缺的是它们已经跑通的**封装物的市场化呈现**（技能广场/模板卡片/做同款按钮）。

## 二、各平台「模板/玩法/特效」体系逐个拆解

### 1. 即梦 Jimeng / Dreamina（字节；与我们同用 Seedance/Seedream）

- **a) 体系与入口**：没有独立"特效商店"，包装成三层——①"灵感"社区流（Web 与 App 首页 tab，日均新增 10 万+ 作品，"每天更新优秀案例，模仿他们的 prompt 和风格"）；②生成器内的**模式化包装**：Seedance 能力被拆成"主题参考 / 智能多帧 / 首尾帧 / 万能参考"四个入口；③App 端"AI 特效/玩法"（毛衣特效、剪纸拼接、新春变身等节令特效）与"动作模仿"（上传动作视频当模板让图片人物照做）。https://magicnetworld.com/tools/jimeng/ https://www.aigc.cn/jimeng-ai https://ai-bot.cn/app/15155.html https://lmtw.com/mzw/content/detail/id/240529
- **b) 条目公开信息**：社区作品卡 = 成片 + 提示词 + 参数，一键"做同款"直接复用他人提示词生成自己的版本。https://ai-bot.cn/sites/17772.html
- **c) 分类法**：按能力/场景（视频、图片、数字人、动作模仿、Agent 模式…），特效按节令热点滚动上新。https://zhuanlan.zhihu.com/p/1987939926201882473
- **d) 一致性素材体系**：**"万能参考"是它包装 Seedance 多模态参考的答案**——"同时用图片+视频+音频，@语法精准控制"（Seedance 2.5 起支持最多 9 张参考图 + 3 段参考视频）。@语法与我们卡片点名句几乎同构。https://magicnetworld.com/tools/jimeng/ https://magicnetworld.com/tools/jianying/
- **e) 值得抄形**：①灵感流上的"做同款"按钮=把社区流量直接灌进生成器；②"@图1 @视频1"这种把参考素材变成**可点名的具名槽位**的交互（我们的卡片天然就是槽位）。
- 另注意它的定价踩坑史：2026 年 3-4 月三次涨价（15 秒 45→120 积分，+167%）引发投诉——报价透明度是用户敏感点。https://magicnetworld.com/tools/jimeng/

### 2. 可灵 Kling（快手）

- **a)**：社区叫**创意圈**（灵感 tab），6000 万+ 创作者；特效类走"AI 效果"（国际版 Effects）。https://www.aihub.cn/tools/video/klingai/ 灵动画布报道：https://m.sohu.com/a/911837972_120932824/
- **b)**：创意圈作品点"做同款"后"系统会自动复制该作品的**提示词和参数设置**，你可以在此基础上进行微调或直接生成"。https://blog.csdn.net/qq_43792385/article/details/145697708
- **c)**：Effects 按玩法分：双人类（拥抱/亲吻/比心，需恰好 2 张图、必须检测到人脸）与单人类（捏捏乐 squish/膨胀 expansion，1 张图）——**模板自带输入槽位数量与校验规则**。https://docs.aimlapi.com/api-references/video-models/kling-ai/v1.6-standard-effects https://piapi.ai/docs/kling-api/kling-effects
- **d)**：**多图参考（国际版 Elements）**：图生视频里传 1-4 张参考图，**框选图片中要用的人物/动物/物品/场景**，再用提示词描述它们的互动——正面攻"一致性"。https://www.geekpark.net/news/345528 https://finance.sina.com.cn/tech/roll/2025-01-22/doc-inefvzcv6884574.shtml
- **e) 抄形**：①"做同款=复制提示词+参数"这个精确定义；②多图参考的**框选主体**交互（我们的卡片形象参考图可以支持框选局部当参考）。

### 3. Vidu（生数科技）

- **a)**：官网导航一级入口 Templates（vidu.com/templates 与 /ai-templates），文案"Discover Vidu's ready-made template library… kissing, hugging, or other fun video templates"，主打"**不用写复杂提示词**"。https://www.vidu.com/templates https://www.vidu.com/ai-templates
- **b)**：模板卡=名称+封面缩略图，点入专页后是"Generate Now"生成器（上传槽+生成按钮）；对外还有 template-to-video API（fal/eachlabs 有转售）。https://www.vidu.com/ai-templates https://fal.ai/models/fal-ai/vidu/template-to-video
- **c) 分类法（原文）**：All / **Love / WowFactor / Prank / Morph / Animated / Ads & Commerce / Festival / Image Template**，11 页分页——按**情绪与用途**分类，不按技术参数。https://www.vidu.com/ai-templates
- **d)**：**参考生视频**是招牌：上传主体图锁定形象，文字换场景；Q3 支持**最多 7 个参考主体**（人物/道具/环境）+ 镜头控制，还能"把角色 A 的正面与角色 B 的背面融合成新主体"。https://www.bilibili.com/video/BV1915v6bEcs/ https://zhuanlan.zhihu.com/p/1928059456320672315
- **e) 抄形**：①按"Love/整活/变身/节日/电商"这类**人话分类法**组织模板市场；②"多主体参考"与我们卡组是同一件事——它证明"人物+道具+场景"多卡同投是模型层可行的。

### 4. PixVerse / 拍我AI（爱诗科技）——特效模板库的教科书

- **a)**：C 端以 Effect（特效模板）驱动增长：毒液变身、肌肉猛男、AI 拥抱、美人鱼、僵尸模式等病毒特效，"上传一张照片、20 秒生成变身视频，内置自动配乐与运镜"，数百个模板按热点周更；2025-06-06 上线国内版"拍我AI"。https://www.yizz.cn/8754.html https://www.xmsumi.com/detail/1041 https://blog.csdn.net/SJJS_1/article/details/144951913
- **b) 单个模板条目的字段（开放平台 API 原样）**：`template_id`、`display_name`（如 "Zombie Mode"）、**`display_prompt`（对外展示的提示词，含槽位，如 "The [SUBJECT] suddenly transforms into a zombie"）**、`thumbnail_path`（GIF 封面）、`thumbnail_video_path`（示例视频）、`marker`（**hot/new/default 角标**）、`example_list`（效果示例组）、`qualities`（可选清晰度 360p-1080p）、`i18n_json`、时间戳。这就是一张"特效模板卡"的完整数据模型。https://github.com/AceDataCloud/PixverseAPI https://docs.platform.pixverse.ai/
- **c)**：按 trending/热点节令组织，运营节奏="一个特效引爆一波社媒→催生代制作服务"。https://blog.csdn.net/weixin_41446370/article/details/143768919
- **d)**：一致性靠"多模态参考"生视频，弱于 Vidu/可灵，特效模板本身就是它的护城河。https://docs.platform.pixverse.ai/
- **e) 抄形**：①**整套字段模型直接借鉴**（尤其 `display_prompt` 的 `[SUBJECT]` 槽位写法——我们的卡就是槽位实参）；②`marker` 热度角标 + 按清晰度分档报价。

### 5. 海螺 Hailuo（MiniMax）

- **a)**：能力包装成两件事：**导演模式**（Director 镜头模型）与**主体参照**（Subject Reference，1 张正脸照锁角色）。https://news.qq.com/rain/a/20250110A05S7B00 https://www.yumiok.com/archives/2182.html
- **b) 导演模式的"指令词表"**：运镜指令写在方括号里、放提示词开头，**一组最多 3 个**：`[Truck left, Pan right, Zoom in]`；词表固定（Truck/Pan/Push/Pull/Pedestal/Tilt/Zoom/Shake/Tracking/Static）。这是"把运镜做成受控词汇表"的代表。https://piapi.ai/docs/hailuo-api/hailuo-director-mode https://minimax-ai.chat/guide/hailuo-video-prompts/
- **c)**：不做特效商店，按模型版本分能力档。
- **d)**：主体参照="上传一张人物照片+场景描述，让角色出演任意场景"，解决"五官漂移"。https://cloud.tencent.com.cn/developer/article/2513808
- **e) 抄形**：①**方括号运镜 DSL**——可在方案台/画布做成可点选的运镜 chips，落到提示词就是受控词表（Seedance 提示词同样吃这一套措辞）；②图生视频提示词公式"首帧主体+运动+镜头运动+氛围变化"可当写作引导占位文。

### 6. Higgsfield——"技能卡墙"的原型

- **a)**：三个预设库：**Camera Controls**（50-70+ 运镜预设：Crash Zoom、Bullet Time、Dolly Zoom、FPV、Snorricam…）、**Effects**（23+ 部 VFX：Building Explosion、Levitation、Disintegration、Face Punch…按 Pack 成批上新）、**Soul 2.0 风格预设**（20+：Flash Editorial、Candy Pop…）。https://higgsfield.ai/camera-controls https://higgsfield.ai/collection/effects https://higgsfield.ai/soul-intro
- **b) 预设卡片公开的信息（实测页面结构）**：网格卡片=**预设名 + 循环视频预览 + "Generate" 按钮 + "View X" 详情链接**，部分带一句话场景描述；详情页也只有名称+演示视频+Generate——**不公开底层提示词**，官方说法是预设"baked into how the model thinks"（烤进模型/增强层），这正是它的付费护城河。https://higgsfield.ai/camera-controls https://kolbo.ai/blog/higgsfield-suite-100-camera-presets
- **c)**：按运镜语义聚类（dolly 族/zoom 族/rig 族/时间族/特技族）；Effects 另有**官方组合预设**（Thunder God+Levitation 等，最多叠 3 个运镜/特效）。https://higgsfield.ai/blog/Higgsfield-Effects-Mix-Lets-You-Tell-Bigger-Stories https://blog.segmind.com/higgsfield-ai-enhanced-video-creation/
- **d)**：**Soul ID**：20-80 张照片训练一个角色（约 3 分钟），之后所有生成在 Character 页签选择该角色即可保持同脸，官方推荐"预设优先于自由提示词"。https://higgsfield.ai/blog/sould-id-best-character-consistency https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-create-and-use-a-soul-id-character
- **e) 抄形**：①**"名字+动图+一个按钮"的极简技能卡**（信息越少、点击率越高，参数全部藏进下一步）；②"最多叠 3 个"的组合规则——给预设做可组合性但设上限。

### 7. Runway / Pika / Luma（简）

- **Runway Gen-4 References**：1-3 张参考图（照片/生成图/3D 模型/自拍）锁角色与场景，提示词里用 **`image_1`/`image_2` 标签**指代各参考图。与我们卡片点名句同构。https://help.runwayml.com/hc/en-us/articles/40042718905875-Creating-with-Gen-4-Image-References https://runway.com/research/introducing-runway-gen-4
- **Pika**：**Pikaffects**（Squish It/Melt It/Explode It/Cake-ify It…动词命名的单键特效）、Pikadditions（往实拍里加物）、Pikaswaps（换物）、Pikatwists（结尾反转）、**Pikascenes——上传"角色/服装/道具/场景"多张 ingredient 图合成一镜**，与我们五种卡几乎一一对应。https://pikaais.com/tools/ https://pollo.ai/m/pika-ai
- **Luma Dream Machine**：以 **Boards/Ideas**（可分享、可 remix 的灵感板）+ **Brainstorm**（基于你上一条结果建议变体）组织创作，Ray2 模型。https://apps.apple.com/nl/app/luma-dream-machine/id6478852867?l=en-GB https://lumalabs.ai/learning-hub/dream-machine-guide-ray2

### 8. 国内"模板中心/一键成片"（简）

- **剪映**：AI 文字成片/图文成片/营销成片/AI 一键成片（5-30 张图+1 首 BGM 自动套卡点模板 10-30 秒出片）+ 海量用户模板生态；即梦成片可"直接送剪映草稿"打通剪辑分发。https://www.ifanr.com/1639648 https://zhuanlan.zhihu.com/p/1957125121346082023 https://magicnetworld.com/tools/jimeng/
- **度加剪辑**（百度）：热点选题（日更 500+ 话题）→AI 成稿（约 800 字）→AI 成片（约 1 分钟）+提词拍摄，是"文案驱动一键成片"代表。https://baike.baidu.com/item/度加剪辑/63087976 https://www.aigc.cn/sites/5737.html
- **开拍**（美图）：AI 写脚本（接 DeepSeek R1 行业脚本）+AI 提词器（跟随语速滚动）+网感模板一键剪辑，专攻口播赛道。https://ai-bot.cn/sites/7280.html https://apps.apple.com/cn/app/id6446305602

## 三、"照搬"的边界

### a) 平台条款怎么写的（关键条文原文）

- **即梦《用户服务协议》**：第 9.1 条"即梦AI产品和服务的**全部知识产权归我们所有**，包括但不限于软件、技术、程序、网页、文字、图片、音频、视频、图表、版面设计…"；第 5.3(4) 条禁止"采用技术手段…爬虫抓取、模拟下载、深度链接…**盗取、监视、复制、传播、展示、镜像**…即梦AI中的信息或内容"，第 5.3(7) 条禁止把平台内容"用于我们书面授权范围之外的任何形式的销售和商业使用"。**注意第 9.6 条：用户互相"做同款、用灵感/用作参考图"是平台协议内互授的许可**——这个许可只在即梦体系内成立，不延伸到我们把内容搬出去。https://lf9-cdn-tos.draftstatic.com/obj/ies-hotsoon-draft/vco/17620dba-f821-4a18-85f9-b8b11f73304a.html
- **PixVerse ToS**："The Services, including source code, UI, trademarks, and algorithms, are the proprietary property of PixVerse"；平台素材"provided on a limited-use basis"；明文禁爬："You shall not use any form of device, program, or algorithm, including spiders, robots, deep-links, and page-scrapes… to access, obtain, copy, or monitor any part of the Services or its Content."（用户 Inputs/Outputs 归用户，但那是用户的东西，不是平台模板库）。https://pixverse.ai/en/terms-of-service
- **Vidu**：平台"software, models, algorithms, trademarks, and platform technology…remain the exclusive property"。https://platform.vidu.com/docs/terms-of-use
- **可灵**：输入/输出归用户并授平台全球免费许可用于推广与研发，不同镜像站表述不一、需以官网现行文本为准。https://kling.ai/docs/user-policy https://www.glbgpt.com/hub/can-i-use-kling-ai-for-commercial-use/
- 共性：**模板库的封面图、示例视频、界面文案属于"平台内容/平台素材"，条款一律保留所有权并禁止爬取转用**；"生成内容归用户"条款帮不了我们——模板示例视频的权利人是对方平台或其用户，都不是我们。

### b) 提示词文本本身受不受版权保护（中美主流观点）

- **美国**：版权局 2025-02《Copyright and AI, Part 2: Copyrightability》报告——"prompts alone do not provide sufficient human control"，提示词"may reflect a user's mental conception or idea, but they do not control the way that idea is expressed"，即**提示词更接近"想法/指令"**；报告主要针对"提示词能否让输出可版权"，业界普遍推论：短语式提示词本身也难以构成可保护作品（短语/方法不受保护）。https://www.copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-2-Copyrightability-Report.pdf https://www.privacyworld.blog/2025/02/copyright-office-copyrighting-ai-generated-works-requires-sufficient-human-control-over-the-expressive-elements-prompts-are-not-enough/
- **中国（三个关键判例，方向并不矛盾）**：
  1. 北京互联网法院"AI 文生图第一案"（2023-11-27 生效）：**精心迭代提示词+参数产出的图可以构成作品**（独创性来自选择与安排）。https://www.bj148.org/sa1/ajbb/202401/t20240103_1661271.html
  2. 苏州中院"首例 AI 文生图不构成作品案"（2025-04 生效）："用户仅通过**简单提示词**触发AI生成的内容未能体现独创性智力投入，不构成著作权法意义上的作品"——且举证要能"再现生成过程"。https://m.gmw.cn/2025-04/23/content_1304021700.htm
  3. **上海黄浦区法院"首例 AI 提示词著作权案"（2025-11-06 宣判）：直接判提示词**——罗列式提示词（风格+主体+材质的简单罗列，"缺乏语法逻辑关联"、属"常规表达"、"属于思想范畴"）**不构成作品，驳回全部诉请；但明示若提示词具备"场景化叙事""独特语法结构"或"高度原创性编排"，仍可能受保护**。https://www.zhichanli.com/p/962221931 https://www.lexology.com/library/detail.aspx?g=d7e4d126-7749-412a-93ca-0ff9f52e660c
- **对我们最危险的判例其实不在提示词，而在模板**：杭州互联网法院"首例短视频模板著作权侵权案"（2021-04-16，剪映"为爱充电"模板诉 Tempo App）——法院认定短视频模板对音乐、贴纸、特效、剧情的选择编排构成"有机统一的视听整体"，**属类电作品**，把别家模板搬进自己 App 构成侵害信息网络传播权，判停用+赔偿。这与"把别人平台的模板搬来当初始模板"是同一个动作。https://www.ciplawyer.cn/articles/146612.html 另：成套照搬文案/装潢即便不构成著作权侵权，也可能落入《反不正当竞争法》第 6 条（混淆）与一般条款（2025 年最高法反法典型案例仍在强调）。https://ipc.court.gov.cn/zh-cn/news/view-4601.html

### c) 务实红线清单

**可以放心学（想法/方法层，不受版权保护）**
- 分类法与栏目命名思路（Love/整活/变身/节日/电商；hot/new 角标；按清晰度分档）
- 交互形态：做同款按钮、技能卡网格、"/"唤技能、@槽位点名、框选主体、最多叠 3 个的组合规则
- 数据结构与参数命名（template_id/display_prompt/[SUBJECT] 槽位这类 schema 设计）
- 运镜受控词表这一"做法"（Truck/Pan/Push…这些是行业通用摄影术语，不是谁家的作品）
- 定价结构（积分制、免费不可商用、会员折扣结构）

**绝对不能搬（表达层，且有条款+判例双重风险）**
- 任何平台模板库的**封面图、示例视频、GIF 预览**（平台内容条款+类电作品判例，双杀）
- **成套**的模板文案/提示词库整库搬运（即使单条不构成作品，整库复制也踩汇编+不正当竞争+禁爬条款；抓取行为本身违反 ToS）
- 平台专有名称与品牌词当自家功能名（Pikaffects、Soul ID、万能参考这类命名照抄有混淆风险）
- 用爬虫批量拉取对方模板接口数据（即梦 5.3(4)、PixVerse 禁爬条款白纸黑字）

**灰色（做了要留痕、要改写）**
- **单条**提示词的意译重写：上海判例下，罗列式提示词大概率不构成作品，意译改写后风险很低；但"场景化叙事、独特语法结构"的长提示词要当作品对待——只取其意、完全重写、换主体换措辞
- 复刻某个"玩法概念"（如"捏捏乐""毒液变身"这类效果创意）：创意本身是想法，但要用**自己生成的**封面/示例视频、自己写的提示词去实现，且别用对方的效果名直译
- 参考对方模板的分段结构/时长节奏做自己的模板：结构是方法，逐帧复刻画面则越线

## 对我们 App 的十条可执行建议

1. **给"视频模板"补齐 PixVerse 式字段**：display_prompt（含 `[人物卡]`/`[场景卡]` 槽位）、GIF 封面、示例视频、hot/new 角标、可选清晰度与价签——模板登记表向这个 schema 对齐（参考 PixVerse effect API 对象）。
2. **首页视频流上加"做同款"**：从流里一键带模板+提示词+参数进工作流，复用可灵"复制提示词和参数设置"的精确定义（参考可灵创意圈、即梦灵感流）。
3. **模板市场分类改按人话**：情感互动/整活/变身/节日/带货，而不是按模型或参数分（参考 Vidu 模板 hub 的 Love/WowFactor/Prank/Festival 分类）。
4. **模板卡片做减法**：卡面只留"名称+自动循环预览+一个生成键"，提示词与参数收进详情第二屏（参考 Higgsfield 预设卡）。
5. **把"方案"升级成可分享的 Skill**：允许用户把提示词+卡组配置+参数封装成技能发到方案市场，agent 输入条里 "/" 唤起（参考 updream 技能广场与 "/" 唤起、LibTV Skill 包）。
6. **卡片点名句标准化成 @槽位语法**：`@人物1 @场景1` 映射到 Seedance 多参考输入，与即梦"万能参考 @语法"、Runway `image_1` 标签同构——用户跨平台习惯可迁移。
7. **方案台加"运镜 chips"行**：固定词表（推近/拉远/横移/环绕/跟拍…）点选后以方括号短语进提示词，最多叠 3 个（参考海螺导演模式词表+Higgsfield/海螺的"≤3 组合"规则）。
8. **模板声明输入槽位数并前置校验**："本模板需要 1 张人物卡+1 张场景卡"，缺卡时禁用并写明原因（参考可灵 Effects 对 1 图/2 图/人脸检测的硬校验）。
9. **初始模板全部自产**：用自己的 Seedream/Seedance 生成封面与示例视频、提示词自己写并**留存创作过程记录**（迭代截图/参数），既避开杭州模板判例与各家禁爬条款，又按苏州判例攒下"我们的模板构成作品"的举证能力。
10. **每周一个热点特效的运营节奏**：特效模板跟节令与梗周更、旧特效降位（参考 PixVerse"毒液→肌肉→拥抱"的爆款接力与 marker 角标运营）。

**一句话总结**：形态上最该抄的三个"形"是——PixVerse 的模板数据模型、Higgsfield 的技能卡墙、可灵/即梦的"做同款"闭环；最不能碰的是任何平台的封面/示例视频/成套文案（有 2021 年剪映模板胜诉判例在前）；提示词层面"单条意译重写"基本安全（上海 2025 判例），"整库搬运"必踩条款与反法。
