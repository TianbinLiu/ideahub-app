# 视频模型怎么命名、怎么让人选：别家的做法与我们 11-24 之后的档位

> 2026-10-07 主人「你来调研看其它平台是怎么命名和选择视频生成模型的」。起因：方舟第十批 11-24 14:00 下线 Seedance 1.0 pro / pro fast，
> 也就是我们的「标准」「极速」两档（docs/seedream-grid-fix-research.md 第六节）。
> 只读公开页面，不登录、不花钱。国内一路、国外一路，各由一个调研代理去读；
> 即梦、海螺、Vidu、拍我AI、LibTV、RunningHub 的官网不登录也会把模型选择器的配置和文案带下来，这几家读的是原文。
> 登录后才看得到的选择器（可灵国内站、Runway、Dreamina 等）只能靠官方帮助文档和第三方截图，可能和真实界面有出入。
> 标记：[官方] 打开过的官方页，[第三方] 报道 / 教程，[推断] 我的判断。

## 零、结论

1. **主流都把「模型名 + 版本」当主标签，快慢、贵贱做成后缀，再配一句卖点和价钱。**
   - 后缀常见的有 Fast / mini / Lite / Pro / Turbo / Draft / 样片模式 / VIP。
   - 国内：即梦、可灵、海螺、Vidu、万相、LibTV。国外：Flow、Runway、Luma、Krea、Firefly、Leonardo。
2. **只给抽象档名（极速 / 标准 / 高清）、不露模型名的，2026 年主流选择器里一个都没找到。**
   这种做法只出现在单模型或刻意不露模型的产品里：剪映、Canva、HeyGen、Gemini App；老例子有元宝 2024-12 的「标准 / 高品质」。我们现在就是这种。
3. **「极速 / 标准」这类词没消失，而是挂在具体模型下面，当模型里的一种模式。**
   例：Vidu 512p 叫「极速」，可灵 2.1 分「标准 / 高品质 / 大师版」，Flow 的 Veo 3.1 分「Fast / Quality」。
4. **帮人选择靠三样**：
   - 一句话卖点。
   - 规格标签：清晰度、时长、带不带声音、收不收尾帧。
   - 每次多少钱。
5. **用不了的组合有三种处理**：
   - 自动换成能用的模型，并说一句（Vidu、Flow）。
   - 切换前弹确认，说清会丢什么。海螺：「所选模型不支持尾帧，切换后尾帧将被移除。是否确认切换模型？」
   - 只摆这个模型能用的选项（即梦、Hedra）。
6. **换代和下线的做法**：
   - 提前一次性通知（拍我AI）。
   - 先挂「即将下线」，下线后自动切到新模型并说一句。Vidu：「{模型}已下线，已自动切换至最新模型」，历史作品保留，但不能再做同款。
   - 旧版改个名留着，当免费或闲时通道（海螺、Vidu）。
   - 放进 Legacy 组（Krea）。
   - **没找到「把用户存着的设置自动迁到新模型」的例子。** 最接近的是 Flow 遇到不兼容时自动换，以及 Runway 在 API 里留了一个别名。

## 一、国内

| 平台 | 选项怎么写（原样） | 选项上还有什么 | 默认 / 用不了时 | 换代 / 下线 |
|---|---|---|---|---|
| 即梦 [官方·页面配置] | 「即梦 Seedance 2.5 (样片模式)」「即梦 Seedance 2.5」「即梦 Seedance 2.0 mini」「即梦 Seedance 2.0 Fast VIP」「即梦 Seedance 1.0」，另接了「Wan 3.0」等，标小字「by Tongyi Lab」 | 图标、一句卖点 | 默认选 2.0 mini，不是最强的那个；每个模型只露自己支持的清晰度和输入方式；卖点里直接写「（暂不支持真人人脸）」 | 「视频 3.0 Pro」改名为「即梦 Seedance 1.0」后留着，内部文案键仍是 video_3_0_Pro |
| 可灵 [官方文档 + 第三方] | 「视频 3.0」「视频 3.0 Omni」；早先 2.1 分「标准 / 高品质 / 大师版」 | 按秒扣灵感值，带不带声音价钱不同；「1080p（非会员免费体验 3 次）」 | 价目表里写「Not Supported Yet」 | 新模型先给最高档会员；旧版本仍在文档里 |
| 海螺 [官方·页面配置] | 「H3」「H3 Max」「Hailuo 2.3」「Hailuo 2.3-Fast」「Hailuo 2.0 (首尾帧)」 | 一句话、标签（「768P-1080P」「6s-10s」「便宜」「带音频」「尾帧」）、「{cost} 贝壳/秒」+ 价格明细 | Agent 自动匹配模型；切换前弹确认，说清会丢什么 | 旧模型改名留着（01→1.0），会员闲时无限用 |
| Vidu [官方·页面配置] | 「Vidu Q3」「Q2」「Q2 Pro」「Q1」，Q3 下再分 Pro / Fast / Lite；另有「生成模式」：电影大片 / 闪电出片 / 营销广告 | 一句话（「最高画质，细节最丰富」）；「试用N次」「免费N次」；会员项带标识 | 有「自动模式」；「视频参考需使用 Vidu Q2 Pro 模型，点击上传视频会自动切换。」 | 先挂「即将下线」；下线后自动切到新模型并说一句；旧模型进免费的错峰模式 |
| 拍我AI [官方·页面配置] | V5.6 / V6 / C1，另接 seedance-2.5 | 按秒计费 | 按套餐解锁模型 | 一次性弹窗：「V4.5首尾帧,V5,V5-fsat模型和相关功能即将在4月23日停止支持，升级到最新版本享受更佳体验。」 |
| LibTV [官方·页面配置] | 「Seedance 2.5（样片模式）」「Seedance 2.0」「StarVideo 2.0 / Fast / Mini」「Wan 2.6」 | 一句话、划线价、new 角标 | 只给这个模型支持的方式和清晰度；没签人像协议时 Agent 不用 Seedance | 「Seedance 2.0为会员专属模型，请升级为会员后继续生成」 |
| 万相 / 豆包 / 剪映 [第三方 + 官方] | 万相网页「万相 2.5」，API「万相2.6极速版」「万相2.2专业版」；豆包写「Seedance 2.0」；**剪映不让选** | 灵感值；豆包每日免费积分 | 豆包 App 先做真人校验 | 万相 API 保留旧版、新版写「推荐优先选用」 |
| RunningHub [官方] | 「Seedance2.5 重磅上线」「Seedance 2.0 4K」「Wan 3.0」 | 价钱写到元/秒：「480P低至0.055元/秒」 | — | — |

## 二、国外

| 平台 | 选项怎么写 | 选项上还有什么 | 默认 / 用不了时 | 换代 / 下线 |
|---|---|---|---|---|
| Google Flow [官方] | 「Veo 3.1 - Lite / - Fast / - Quality」；官方原话 "two tiers of models (Fast, Quality)" | 每次 10 / 20 / 100 积分；逐模型能力表 | 不兼容时 "we'll default you to a compatible model" | 菜单里只剩 3.1 |
| Runway [官方] | 自家「Gen-4.5」「Aleph 2.0」，2026-01 起上架「Seedance 2.0 Pro」「Kling 3.0」等 | 每 N 秒积分；Agent 会建议先出 Draft | 开发者 API 可按成本 / 延迟 / 质量自动路由 | Gen-3 Alpha 07-08 下线、升级套餐也回不来；API 旧 ID 直接报错，只留一个别名 |
| Luma [官方] | 一张表平铺「Ray3.2」「Ray3.14」与「Seedance 2.5」「Veo 3.1」，模型内分 Draft / SDR / HDR | 积分 × 秒 × 分辨率 | Agent 自动选 | — |
| Krea（聚合）[官方] | 厂商名 + 版本，分 Fast / Intelligent / Quality / Legacy 四组 | 速度、质量各打 1~3 分；一句话（"Best for most use cases"） | 预选一个，不做 Auto | 旧版进 Legacy；Sora 2 下线时写 "no drop-in replacement" |
| Adobe Firefly [官方 / 摘要] | 下拉分「Adobe models / Partner models」：Veo 3.1 / Veo 3.1 Fast、Kling 3.0、Ray3… | 积分 / 秒；内容凭证注明用了哪家模型 | 设置随模型变 | 公开下线页分 Deprecated / Removed |
| Leonardo [官方] | 厂商名 + 自家「Motion 2.0 / 2.0 Fast」 | 能力标签；价钱写在生成键上 | 图生视频默认 2.0 Fast；免费用户只开放部分模型 | 带日期的下线日志，逐条写替代模型 |
| OpenArt / Higgsfield / Hedra（聚合）[官方] | 按厂商分组；「NEW」「COMING SOON」「UNLIMITED」徽章；「Seedance 2.5 Draft」先出 480p 草稿 | ¢/秒 | 参考面板只显示这个模型能收的输入 | 下线后留页写「已下线，试试新模型」；Higgsfield 把 Sora 2 留到 API 截止日 |
| Midjourney / Gemini / Canva / HeyGen [官方 / 第三方] | 单模型或不让选：Midjourney 只有 SD / HD、低 / 高运动；Canva 只叫功能名 | — | 后台可以静默换模型（Gemini 已从 Veo 换成 Omni） | — |

**Sora 2 下线的连锁**：OpenAI 2026-03-24 通知，04-26 关闭网页版和 App，09-24 删除 API，「替代模型」一栏空着。
下游各家跟进，有停用的、有换成 Veo 3.1 的、有标 Deprecated 的。这正是我们这次面对的情形：上游下线，我们的档位得跟着换。[官方]

## 三、对我们的意思

**11-24 之后方舟还能调的 Seedance**（官方价目页 10-06 存的副本；我们这把钥匙 `GET /models` 10-07 核过）：

| 型号 | 我们现在的档 | 720p 5 秒 | 480p 5 秒 | 备注 |
|---|---|---|---|---|
| ~~1.0 pro fast~~ | 极速 | ¥0.46 | — | 11-24 下线 |
| ~~1.0 pro~~ | 标准（默认） | ¥1.63 | — | 11-24 下线 |
| 2.0 mini | 高清 | ¥2.50 | 约 ¥1.12 | 带声音；收参考图 / 首尾帧；4~15 秒 |
| 2.0 fast | — | 约 ¥4.03 | 约 ¥1.80 | — |
| 2.0 | — | 约 ¥5.01 | — | — |
| 2.5 | 电影级（会员） | 约 ¥7.62 | — | 有官方「样片（Draft）模式」：先出便宜的预览，选中再出正片，两步各算各的钱 |
| 海螺 2.3 Fast（MiniMax） | 真人 | 按发 | — | 不受方舟下线影响 |

> 720p 按 1248×704、24 帧算约 108,900 token（与账单对得上）；480p 按 480×864 估约 48,600 token，以账单为准。2.0 mini / fast 现在有企业限时折扣，表里按刊例。

- **下线之后最便宜的是 2.0 mini 480p**，5 秒约 ¥1.12：比原来的「标准」便宜一点，是原来「极速」的 2.4 倍左右。
  ⚠ 服务端现在只放行 720p（`pinPlainVideoTask` 非 720p 整句 400），要用 480p 得先改服务端。
- 1.0 两档上的几样东西会跟着变：
  - 3 秒段没了：2.0 mini 最短 4 秒。
  - 段从无声变成有声：2.0 mini 自带环境音，不额外收钱。
  - 首尾帧照样有：2.0 mini 收首尾帧，也收参考图。

**几种走法**（是商品决定，等主人定）

| 走法 | 档位怎么写 | 好处 | 代价 |
|---|---|---|---|
| A. 照主流，露模型名 | 「Seedance 2.0 mini」底下分「480p · 省钱试拍」「720p」；「Seedance 2.5（电影级 · 会员）」；「海螺 2.3 Fast（真人照片）」。每项一句话 + 价钱 + 标签（有声 / 首尾帧 / 收参考图） | 与国内外主流一致；以后上游再换代，名字跟着改就行，不用再造新词 | 新手看不懂型号，要靠那一句话和价钱帮他选 |
| B. 档名留着，后面注上模型（即梦「动作模仿」那种） | 「省钱 · Seedance 2.0 mini 480p」「标准 · Seedance 2.0 mini」「电影级 · Seedance 2.5」「真人 · 海螺 2.3 Fast」 | 老用户熟悉的词还在；型号也看得到 | 档名与型号是两套说法，上游换代时两边都要改 |
| C. 只换底下的型号，名字不动 | 「极速」→ 2.0 mini 480p，「标准」→ 2.0 mini 720p（与「高清」变成同一个，二选一） | 改动最小 | 「极速」「标准」「高清」三个名字底下只剩一个型号，说不清差在哪；与主流做法相反 |

我的建议是 **A**，理由：
- 主流做法就是这样，档名不用再随上游换代重造。
- 我们已经在卖两家的模型（Seedance 和海螺）。各家聚合平台在这种情况下都写原厂模型名。
- 「省钱试拍」可以照 Draft / 样片的思路做：先出 480p 看构图，满意了再出 720p。

**不管选哪种，下线前后都要做的几件事**（照别家的做法）：
1. **下线前**：选法屏与档位旁边挂「11-24 下线」，加一次性提示（拍我AI 的做法）。
2. **下线后，存着旧档位的草稿 / 段**（`VideoSegment.videoTier` / `EditorState` 存的是 `fast` / `std`）：
   - 打开时按新档报价。
   - 说一句：「原来的「极速」档已下线，这一段改用「…」，价钱按新档算」（Vidu 的做法）。
   - 别静默换：价钱变了。
3. **两仓价目一起改**（economy / tokens 逐条相等），服务端 `ALLOWED_MODELS` 拿掉两个 1.0。
4. **出图那边同步迁**：速写（4.0）→ 4.0-20260415；定妆（4.5）→ 官方建议 5.0 pro，单价从 ¥0.25 涨到 ¥0.30 / ¥0.60。
   九宫格分镜的组图只有 4.0 那一支能接。

## 出处

国内 [官方·页面配置]（2026-10-07 不登录打开）：jimeng.jianying.com/ai-tool/home、hailuoai.com/create、vidu.cn/create、pai.video、liblib.tv、runninghub.cn；
可灵 kling.ai/quickstart（VIDEO 3.0 Omni / 2.6 用户指南）；MiniMax 新闻 minimax.cn/news/minimax-hailuo-23；阿里云百炼模型下线规则 help.aliyun.com/document_detail/2712454.html；
TapNow 官方模板公开接口；第三方：厦门大学 AIGC 实验教程第 5 章（2026-03）、新京报 2026-02-09、IT之家 2024-11-15、ai-bot.cn、人人都是产品经理。

国外 [官方]：support.google.com/flow（16352836 / 16526234 / 16353333）、runway.com/pricing 与 changelog、docs.dev.runwayml.com、lumalabs.ai/pricing、kling.ai/quickstart、
minimax.io/news、platform.vidu.com/docs、pixverse.ai/blog、dreamina.capcut.com、krea.ai/docs、hedra.com/models/video、openart.ai/ai-model、docs.leonardo.ai/docs/deprecations-changes、
developers.openai.com/api/docs/deprecations、ai.google.dev/gemini-api/docs/deprecations；Adobe helpx 的模型下线页只看到搜索摘要。

方舟：模型下线公告 82379/1350667、模型价目 82379/1544106（10-06 存的副本）、`GET /api/v3/models`（10-07）。
