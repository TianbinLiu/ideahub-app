# CLAUDE.md — ideahub-app

Claude Code 会自动读取本文件。**工程铁律在 [`AGENTS.md`](AGENTS.md)，先读那份。**
本文件只给"这个仓库长什么样、怎么跑、有哪些坑"。

新成员从零上手看 [`docs/ONBOARDING.md`](docs/ONBOARDING.md)。

---

## 这是什么

IdeaHub 的安卓 App：React 19 + Vite 7 + Tailwind + Capacitor。
形态对标抖音/TikTok —— 全屏上下滑的视频流，视频由 AI 逐段生成，支持分支互动。

三仓关系与契约见 [`AGENTS.md`](AGENTS.md) 顶部。

## 跑起来

```bash
npm install
cp .env.example .env.local     # 必须，否则 AI 全走 mock
npm run dev                    # http://localhost:5173
```

`npm run build` = `tsc && vite build`，**提交前必须通过**。

出安装包：`npm run apk`（debug，自己测）/ `npm run apk:release`（**发给别人的只发这个**）/ `npm run aab`（上架）。
发版走 `npm run release` —— 它会**自检"这次更新能不能到老用户手里"**（签名、版本号、
清单可达性），任何一条不过就当场停下。完整流程见 [`docs/app-distribution.md`](docs/app-distribution.md)。
签名 keystore 不在仓库里，见 `android/keystore/README.md`。

## 目录

```
src/
  ai/          方舟（Seedream 生图 / Seedance 生视频 / 豆包对话）客户端与真假实现切换
  api/         与 server 的 HTTP 调用
  components/  通用组件
  data/        本地库（IndexedDB）与账号库，含种子数据与迁移
  hooks/
  mock/        无后端时的假数据
  pages/       路由页面（hash 路由）
  studio/      创作/工坊相关
  utils/
public/
  create/      创作入口三张封面（角色设定的唯一出处）
  perch/       激活态角色的逐帧精灵图（Q 版，50px 图标挂件）+ 生成流程说明
  mascot/      工作流页屏幕中央的看板娘逐帧演出（二次元正片，交卡/炼卡/炼成三段）
  cards/       卡牌素材
  models/      3D 模型（protected/ 下的加密产物不入仓）
  avatars/     官方 Q 版看板娘头像（「我的」页换头像用，从 createbtn 精灵图里裁的）
design/        ★ 建模/出图的【离线工具与素材】，不参与 App 构建
               （角色转换、LOD 生成、封面生成脚本 + 参考图 + 授权笔记）
shihui/        ★ 新产品「诗绘」（诗词视频教育）的独立骨架工程，自带 package.json，
               与本 App 构建互不参与；先读 shihui/README.md 与 shihui/docs/IDEA-REVIEW.md
```

## 约定

- **注释写"为什么"**，尤其是踩过的坑、量出来的数值、被推翻过的做法。既有代码用
  `★` 标记关键取舍，请延续。
- **依赖方向单向**：`data → store → 组件`。工坊与工作流之间也是单向的：
  `studioStore` 认识 `flowStore`，反过来**绝不**——两个 store 互相 import，Vite 下会
  拿到半初始化的模块。需要同时读写两边的逻辑（存草稿、法阵铺流水线）一律放 `studioStore`
  或页面组件里。
- **一段视频只有一份**：出片结果挂在 `Proposal.videoUrl` 上，不挂在某个 store 里——
  工坊节点卡上单独炼的和工作流里逐段炼的是同一份，换个模式打开不会要求重炼、重复收费。
  「怎么炼一段」也只有一份实现（`studio/segmentGen.ts`），两个模式共用。
  mock 构建（没配 `ARK_API_KEY`）下 Seedance 不返回地址，两边一致写 `"mock:"` 占位串：
  问「出片了吗」用 `proposalDone()`，问「能不能播」用 `realVideoOf()`，别直接看 `videoUrl`。
- **一段的推进是三拍，不是一拍**：写要求 → 推演三套方案（方案台，各带首尾帧预览）→ 挑定
  一套（可换帧、改剧情、按修改重画）→ 才炼视频。方案台组件两边共用
  （`studio/ui/PlanBoard.tsx`）；工坊用 `NodeSlot.chosenId === null` 表示"待挑"，
  工作流用 `FlowNode.plan === "picking"`（形状不同，所以组件不认 store，只收 props）。
  **炼出本段视频才能开下一段**——段与段靠上一段的**真实尾帧**承接起拍，攒着最后一起炼会让
  衔接断掉，也会让"第 1 段人物就不对"这种最该早止损的错拖到铺完五段才暴露。这条门禁在
  每一侧都只有一处实现（铁律六）：工作流是 `flowStore.clampCursor`（左右箭头、横划手势、
  底部节点条三条路共用）加 `addNode` 的追加门槛，工坊是 `studioStore.placeholderVisible`
  （虚线卡位亮不亮）加 `composable`（法阵亮不亮）。UI 上的 disabled/锁图标只是把"为什么
  点不动"画出来，别在那里另写一遍判断。
- **互动计数一律要能防刷**。首页是上下甩着刷的，"进入视口就 +1""重挂载就重来"这类写法
  等于给用户做了个刷量按钮。已经收口的两条：**播放**要真看够 `PLAY_MIN_SEC`（3 秒，
  按 `currentTime` 增量累计，不是墙上时钟）且一次会话只记一次（`videos.addPlay` 里去重，
  sessionStorage 存名单，刷新也不重置）；**点赞**在 `videos.setLike` 里做幂等，
  而它成立的前提是**离线模式把 likedIds 落盘**（不落盘的话刷新一次爱心就变回空心，
  同一条能无限点）。新加互动（收藏/投币之类）先想清楚"反复做同一件事会怎样"。
- **弹幕走服务端**（`data/danmaku.ts` ↔ `/api/branch/videos/:id/danmaku`，契约见
  `docs/api-contract.md`「弹幕」）。三条别踩：
  ① 读接口是**同步**的（`danmakuOf`）——渲染层每一拍都要问，远端那份靠"按作品懒加载
  + 到货后 emit"补进内存 cache（与 `videos.loadDetail` 同一招）；
  ② 发弹幕**不做乐观插入**，真等回包。乐观发送时一旦失败，用户会亲眼看着自己那条飘过去
  然后永远消失，而全 app **没有任何地方监听 `emitApiError`**——那就是静默失败（铁律八）；
  ③ 「这次会话到底在不在远端上」只有一处判断：`videos.remoteOn()`。别在别的 data 模块里
  各探一次，否则弱网冷启动会出现"视频退了本地库、弹幕还在打远端"这种半边天。
  离线模式（没配 `VITE_API_BASE` 或服务端没起）退回 IndexedDB，此时输入条会明说
  "只存在这台设备上"——接上服务端时那句话必须消失，否则是另一种骗人。
- **简约模式不进草稿库**（`saveWorkDraft` 里挡掉）：它只有一段、写一句话就出片、直通发布，
  中间没有"回来接着做"的状态；而草稿一条带 1MB 级的帧，塞进去只会把真正需要草稿的
  工坊/工作流挤出 20 条上限。
- **在途工程存 `data/drafts.ts`**：没做完的半成品，可以接着编辑（工坊/工作流两条路都能打开）。
  草稿索引与正文分开存（正文带 1MB 级的帧，个人页列表只读索引）。
  与之相对，**已发布的作品不可回炉**——成片定稿，编辑页只改壳（标题/简介/分区/封面/可见性）。
  想换内容就重新发一条。（"源工程 `saveProject`"那套 2026-08 删了：唯一的读方是回炉。）
- **数值不要拍脑袋**。涉及尺寸/间距/重叠的值先量再定，并在注释里写清量法与结论
  （例：`CharacterPerch` 的 `bottom` 系数调过四轮，注释里记了每一轮为什么不行）。
- 动画只动 `transform` / `opacity`（合成层）。视频流滚动时本就吃紧，触发重排会掉帧。
- **渲染循环里别信任外部状态的形状**。`useFrame` 里抛一次错就是每帧抛一次：整页白屏，
  且**自己好不了**——循环挂了就没人再去改状态，用户只能刷新（工坊没有持久化时等于全丢）。
  从 store 取来的坐标之类先校验再用（例：`TableScene` 的 `camOk`），坏值退默认而不是崩。
- **服务端给实体加了字段，本机库那几跳必须一起搬**。2026-08-16 一天之内同一形状咬了三次
  （`roles` / `realDurationSec` / `markColors`），每次都是**零报错**，所以单列一条。
  机理是两条各自正确的设计**相乘**：① 本机库那几跳是**逐字段重建**（`apiToTemplate` →
  `saveTemplate` / `rolesOf` / `parseState` / `applyTemplate`），少写一行没有任何编译期或
  运行期症状；② 新字段一律**判否定**（缺失 = 老数据）——这条本身必须坚持，但它让
  "漏搬了"和"这确实是老数据"**完全无法区分**。于是后果不是"少显示一个字段"，而是
  **整份走上一代逻辑，还一路通过所有校验**（`markColors` 那次合成出的「编号绿色=凛」
  连三道正则都命中了，因为正则找的是 `编号\s*绿色`）。
  ⇒ 加字段时**四处一起改**：`apiToTemplate`（解析）、`NewTemplate`（**类型里得有名字**，
  否则 TS 连"你忘了传"都提示不了）、`adoptBlockoutTemplate`（新建落库）、
  `refreshRemoteTemplate`（`mine` 与 `shared` **两份都要**——作者自己那台设备读的是 `mine`，
  而 `getTemplate` 是 mine 优先，所以**别人看得见的提示，作者反而看不见**）。

## 已知的坑

| 坑 | 症状 | 怎么办 |
|---|---|---|
| `.env.local` 没配 | AI 功能静默走 mock，不报错 | `cp .env.example .env.local` |
| 新 worktree 缺 `.env.local` | 同上（gitignore 不会带过去） | 手动复制 |
| 新 worktree 缺 `public/models/protected/` | **出包直接少东西且不报错**：工坊里铸卡师不见了（milltina 是加密分发的默认 NPC），凛卡的 3D 预览也没了。dev 下同样静默——只是模型 404，画面上就是"人没出来" | 同样手动从主仓复制。出包前用 `ls dist/models/protected/` 确认 `milltina-opt.glbx` 在（2026-08-11 就是这么发出去一个没有铸卡师的包的） |
| `VITE_API_BASE` 指了远端 | 首页空白（本地库被跳过） | 本地开发注释掉它 |
| 方舟提示词含敏感词 | 整个请求 400，不是降级 | 见 `AGENTS.md` 本仓小节 |
| 新增数据字段没写迁移 | 老设备读到 `undefined`，静默显示 0 | 在 `src/data/videos.ts` 的迁移分支里加条件 |
| 给 `DraftVideo` 加了字段，服务端却存不下 | 客户端发了、服务端 201 了、读回来是空的，全程零报错 | server 的 `schemas/branchVideo.schemas.js` 用 `z.object`，**默认 strip 未声明字段**。加字段必须同步声明一次（`deck` 就这么丢过） |
| 后加的字段用 `=== "预期值"` 判 | 存量数据那一项是 `undefined`，被整批判成"不是"——首页突然空了，且不报错 | 一律判**否定**（`!== "private"`）。`visibility` 踩过，规则写在 `docs/api-contract.md`「可见性」一节 |
| 两仓价目表各写各的 | 页面报价 ¥25、实际扣 ¥15，用户觉得被偷钱 | `src/data/economy.ts` 是**报价**，server 的 `payment/order.service.js` + `config/tokens.js` 是**结算**，必须逐条相等。server 的 `payOrder.spec.js` 末尾钉了一份 |
| 「最多出几张卡」的上限自己抄一份（报价一份、提示词一份、`slice` 一份） | 上一条的**同仓版**：界面按 6 张报价、实际铸了 8 张，多出的两张卡面照扣钱。改上限时改一处漏三处**没有任何症状**——只会变成报价与实收不等，两个方向都不报错 | 上限只有一处：`economy.DECK_MAX_CARDS` / `TEMPLATE_MAX_CARDS`，类型是 `CardMintCap`（带牌子的 number），报价函数与 `mintCards` 都只收它 —— `extractCost(n, 8)` 这种手写数字**编译不过**。提示词里那个数由 `real.ts` 的 `mintSpec(cap, head, tail)` **插值**进去（调用方只给前后两半文字，拿不到写那个数的机会），`mintCards` 切的是同一个 `spec.cap`。2026-08-13 收口，收之前模板那条路已经是错的（提示词 `0~6`、slice 切 8、报价按 6） |
| 以为 `design/` 里的模型可以随便打包 | —— | 那是 BOOTH 购入的第三方素材，出厂分发需先取得授权，见下 |
| 把 `public/models/protected/` 当成"都是不能发的" | 两个方向都出过事：把**自有**的 milltina 裁掉 → 进工坊看不到铸卡师且不报错；把**第三方**的 rin 留下 → 版权素材随包发出去了 | 那个目录装的是"要加密的"，不是"不能发的"，两件事。**自有、必须发**：`milltina-opt.glbx`（委托定制的默认铸卡师）。**第三方、绝不能发**：rin（远坂凛，含卡牌全息那份）、gratia、tsumire。加密拦不住版权 —— 解密密钥就在同一个包里 |
| 铸卡师不出声 | 嘴在动但没声音 | 系统没装中文语音包。Win11：设置→时间和语言→语音→添加语音→中文(简体，中国)，装完**完全退出浏览器**再开（语音表在进程启动时枚举一次）。⚠「讲述人→添加自然语音」里的晓晓/云希浏览器拿不到 |
| 以为 `ARK_API_KEY` 能用来做 TTS | —— | 方舟没有 TTS（实测 129 个模型里一个都没有）。语音合成是 openspeech 另一条产品线，另配 `TTS_APPID`/`TTS_TOKEN`，见 `.env.example` |
| 前端把服务端接口写成同源相对路径（`/api/ark`、`/api/asset`、`/api/tts`） | 真机上"出片第 1 段就失败：`Unexpected token '<',"<!doctype"...`"、工坊 NPC 不回话、试听没声音 | 这些端点在 dev 是 `vite.config.ts` 的中间件/代理，**APK 里根本不存在**；而 Capacitor 的本地静态服务器对未命中路径做 SPA 回退，返回 **200 + index.html** 不是 404，于是 `res.ok` 恒真、`res.json()` 撞上 HTML。一律走 `API_BASE`（`src/api/client.ts`），并且判断"这台服务器有没有这个能力"要看 `Content-Type` 或专门的健康端点（`GET /api/ark/health`），**永远不要信状态码** |
| 自己调 `screen.orientation.lock` / `ScreenOrientation.lock` 转屏 | 浏览器里像是好了，**真机上点了没反应** | 方向只有一个主人：`hooks/useOrientationLock`。它每次切路由就 `lock(portrait)`，加上 manifest 的 `screenOrientation="portrait"`，native 那层早把 activity 钉死了，Web 的 `screen.orientation.lock` 盖不过去。要横屏调 `requestLandscape(true)` 表达意图，退出时**必须**传 `false`（首页全屏转屏就走这条路） |
| 改了画幅却发现出片还是横的 | 竖屏设定帧被裁成横的，或视频照样 16:9 | 画幅要**三处同时改**才生效，缺一处就被方舟静默裁掉：Seedance 的 `ratio` 参数、Seedream 的画布尺寸（竖屏 `1440x2560`，比例不符会被裁）、提示词里的构图措辞（尺寸参数管不到构图）。三者收在 `types.VIDEO_ASPECTS` 一处，别在调用点各写各的。另：720p 竖屏方舟实际吐 **704×1248**（对齐到 16 的倍数），不是 720×1280 |
| 动了首页底缘任何一个元素的位置 | 别的元素被**悄悄盖住**：右侧栏的全屏键压住时长文字、底栏的看板娘压住进度条 —— 两件都真发生过，而且都不报错，只是信息看不见了 | 底缘 100px 里叠着四样东西，位置是联动的：进度条容器 `bottom = var(--tabbar-h) - 0.375rem`（离底 50px）→ 时长文字顶沿在 86px → 右侧栏 `bottom = var(--tabbar-h) + 3rem`（104px）。底栏自己 56px 高，任何挂件都不许往上戳。改一个就把这几个数一起重算，别只看自己那一块 |
| 右侧操作栏加了新按钮 | 小屏（640 高）上最上面的头像被 section 的 `overflow-hidden` **裁掉** | 整栏是 bottom 定位的 flex-col，加一个键就往上长 64px。现值 512px + 底 104px = 616px，640 屏还剩 24px。再加键就得先减间距（`RailBtn` 的 `mt-8` 只给有角色演出的键，基准 gap-2） |
| 拿**名字**当身份判「这条是不是我发的」 | 用户改完昵称回首页：右侧头像退回字母底、点进去还是旧名字的主页，重启才好 | `VideoItem.author` 是**显示名**，会变。缓存里那些作品的 author 还是旧值，`isMyAuthor` 就判否了。改名时按 `authorId` 精确改写缓存（`videos.ts` 的 `renameMyVideos`），别按旧名字模糊匹配——会误伤重名的别人 |
| 界面上摆一个永远点不动的选项 | 「极致」画质在 App 里是灰的，说明写着"安装包不含 4K 贴图" —— 用户只会觉得功能坏了 | 要么让它真能用（现在 4K 随包发布），要么别显示。同理：设置页那个「已用 xx MB」原来只是个用户看不懂也做不了事的数字，现在配了真能清的「清理缓存」 |
| 出包时忘了涨 `versionCode` | 已经装了的人**永远收不到这次更新** —— 更新检查靠这个整数判新旧，不涨就等于没发 | 每次 `npm run apk:release` 前先改 `android/app/build.gradle`，见 `docs/app-distribution.md` |
| 把 debug 包发给别人装 | 下次发 release 包时对方装不上，只提示「应用未安装」，看不出是签名不同 | 发给别人的永远只发 `npm run apk:release` 的产物；debug 包只留在自己机器上 |
| 把 `REQUEST_INSTALL_PACKAGES` 挪进 `src/main/` | 本地一切正常，**上架审核被拒**（Google Play 禁止应用自装 APK），而那时离改动早过去很久了 | 自更新的权限与代码只准待在 `android/app/src/sideload/`；`src/play/AndroidManifest.xml` 里那条 `tools:node="remove"` 是兜底，别删 |
| 全屏浮层写了 `fixed inset-0` 却只铺满一小块 | 浮层被某个祖先裁掉、点不到或压不住底栏 | 祖先上有 `backdrop-blur`（`backdrop-filter`）或 `transform`/`filter` —— 它们会给 `position: fixed` 后代造**包含块**，`inset-0` 于是相对那个盒子而不是视口；`position+z-index` 还会另开层叠上下文，压不过外面的兄弟节点。解法一律是 `createPortal` 到 `body`（评论抽屉、首尾帧卡放大层都栽在这条上，各修过一次） |
| 在**看不见的**窗口里测（最小化/被挡住/标签页在后台） | 三类假故障：① `scrollTo({behavior:"smooth"})` 完全不动、scroll 事件一次都不触发（轮播翻页、首页上下滑看起来全坏）② `<video>` 不加载不解码，`loadedmetadata`/`seeked` 永不到达（出片卡在「捕获本段真实尾帧…」、剪辑页卡在「合并中」）③ rAF 被节流到 ~1 帧/500ms，Three.js 画布是黑的 | 先查 `document.visibilityState`，是 `hidden` 就别下结论。自动化测试必须让窗口真正可见（CDP 截图能骗过去，rAF 和媒体解码骗不过去）。代码侧的对策是**等媒体事件一律带超时**（见 `ai/real.ts` 的 `withTimeout`）——否则用户在几分钟的出片过程里切出去，回来就是永久卡死 |
| 出片没接到结果就按「失败」处理 | 用户面前唯一可点的是「♻ 重新生成（N token）」= **重新下一单 = 再花一次钱**，而那一发的成片往往在方舟那边好好地存在着（2026-08-18 实测：15s 白模模板方舟约 13 分钟出片，App 10 分钟就放弃了，¥27 的成片是事后用任务号从方舟侧捞回来的）。计费在**受理那一刻**就发生（契约「先扣钱、再转发」+「受理之后失败不退」），所以「没接到」和「没花钱」毫无关系 | 「没接到」与「失败」是**两个**结局，判据是**类型**（`ai/arkClient.ArkTaskUnknown`）而不是错误文案里的关键词。三件一起做：① 任务**受理即落凭据**（`data/videoJobs`，用 localStorage —— 要扛得住进程被系统回收，那正是丢结果最常见的方式），落在开始等待**之前**而不是失败分支里；② 节点打 `status:"pending"` 而不是 `"failed"`；③ 段卡上给 24 小时取回入口（查询不计费，取回不再花钱）。同仓另有一份正确形态可对照：`data/templates.waitBlockoutTask`（白模化两阶段），改一处时对着看另一处 |

## 相关文档

- [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — 从零到能跑
- [`docs/api-contract.md`](docs/api-contract.md) — 与 server 的接口契约（三仓共享）
- [`docs/play-store-checklist.md`](docs/play-store-checklist.md) — 上架检查单
- [`docs/app-distribution.md`](docs/app-distribution.md) — 发包给别人装、应用内更新怎么走
- [`public/perch/README.md`](public/perch/README.md) — 角色动画资源怎么生成、踩过什么坑
- [`public/createbtn/README.md`](public/createbtn/README.md) — 底栏 ➕ 上那只常驻宠物（含并排版式的取值）
- [`public/avatars/README.md`](public/avatars/README.md) — 官方 Q 版看板娘头像怎么裁、选了之后存的是什么
- [`public/mascot/README.md`](public/mascot/README.md) — 工作流页看板娘三段演出的出图流水线与坑
- [`design/README-tsumire.md`](design/README-tsumire.md) — 购入模型的接入笔记与**授权结论**（上线前必读）
