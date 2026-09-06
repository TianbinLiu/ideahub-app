# CLAUDE.md — ideahub-app

Claude Code 会自动读取本文件。**工程铁律在 [`AGENTS.md`](AGENTS.md)，先读那份。**
本文件只给"这个仓库长什么样、怎么跑、有哪些坑"。

新成员从零上手看 [`docs/ONBOARDING.md`](docs/ONBOARDING.md)。
看板娘（Live2D 数字人）模型的现状、与官方示例的差距、工具评估与下一步见 [`docs/live2d-model-roadmap.md`](docs/live2d-model-roadmap.md)。

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
签名 keystore 不在仓库里（`android/keystore/` 被 gitignore 排除），换机 / 新 worktree
怎么恢复见 [`docs/signing-keystore.md`](docs/signing-keystore.md)。**缺了它 release 构建会直接失败**，
不再退化成无签名包 —— 那种包装到别人手机上只提示「应用未安装」，看不出是签名问题。

## 分支纪律：单主干，做完就落回 main

**这个仓库只认一条长期分支：`main`。** session 开的分支是临时的，任务一完成就并回去 ——

```bash
npm run land          # 构建门禁 → 合进 main → 推（main 受保护时自动改走 PR）→ 删掉本分支
npm run land -- --dry # 只检查不动手
```

★★ 为什么要有纪律而不是"想起来再合"：本仓同时开着十几个 worktree，**各自出包、各自涨
`versionCode`，谁装谁覆盖手机上那一份**。2026-08-29 真出过事故：主人手机上装的是 A 分支的
44，而当时正在验的是 B 分支的改动 —— 屏幕上表现为「功能不见了、之前的改动回退了」，查到
`dumpsys package` 的 `lastUpdateTime` 才定案。合流晚一天，就多一天这种"查半天原来是装错包"。

- **出包前先 `git log --oneline -1` 对一眼**，装完用 `adb shell dumpsys package com.ideahub.branchvideo | grep -E "versionCode|lastUpdateTime"` 确认装上的就是刚出的那个。
- **`versionCode` 只在 main 上涨**（`android/app/build.gradle`）。分支里临时涨了不算数，
  落回 main 时以 main 为准 —— 两条分支各涨各的必然撞车（44 vs 45 就是这么来的）。
- **不合流就删的分支要先打 tag 存档**（`archive/<名字>`）：删掉的分支在远端也一并没了，
  没有 tag 就只剩 reflog 那点时间窗。2026-08-29 那次合流留了两条：
  `archive/laughing-chebyshev-blockout-split`（功能在 main 里已有另一份实现）、
  `archive/nostalgic-pasteur-server-merge-cut`（剪辑页服务端合并，落后太多先存着）。
  整体回滚点 `backup/pre-consolidation-2026-08-29`。

## 目录

```
src/
  ai/          方舟（Seedream 生图 / Seedance 生视频 / 豆包对话）客户端与真假实现切换
  api/         与 server 的 HTTP 调用；`companion.ts` = 数字人的人格/形象/声音设置（/api/companion/settings）
               与两个市场（Live2D 形象 / 人格）的请求层 + 共用报错文案
  companion/   AI 客服/看板娘的演出协议（表情/动作标签、SSE 解析、语音包络、舞台总线）——与官网 client 同源拷贝
  live2d/      Live2D 运行时加载与模型驱动（pixi + Cubism Core，全部自托管在 public/live2d/）；
               `prefetch.ts` = 换市场形象前把 model3.json 引用的文件各拉一遍，热 WebView 缓存
  components/  通用组件；`flow/` = 工作流画布：`FlowCanvas.tsx`（画布壳 + 就地编辑窗 +
               agent 输入条 + 四个 portal 弹层：方案台/成片回看/选卡/选模板）、
               `DeleteSegBtn.tsx`（删段确认，与 FlowPage 那份共用一处实现）；
               `support/` = AI 客服页专用：`SupportStage`（Live2D 舞台，按 modelUrl 换装）、`HoldToTalk`、
               `VoiceSheet`（声音面板，三页：单音色 / 混音 / 声音市场；存服务端，官网同步）、
               `VoiceMixer`（混音调配 + 发布成模板）、`VoiceMarket`（声音市场列表：试听 / 设为我的声音 / 点赞 / 删自己的）、
               `voicePreview.ts`（三页试听共用的合成 + 播放 + 喂口型，同一时刻只响一段）
  data/        本地库（IndexedDB）与账号库，含种子数据与迁移
  hooks/
  mock/        无后端时的假数据
  pages/       路由页面（hash 路由）；`SupportPage` = AI 客服，`SupportModelsPage` / `SupportPersonasPage` =
               数字人形象 / 人格市场（/support/models、/support/personas，入口在客服页顶栏那一列小键与设置页）
  studio/      创作/工坊相关
  utils/
public/
  create/      创作入口三张封面（角色设定的唯一出处）
  perch/       激活态角色的逐帧精灵图（Q 版，50px 图标挂件）+ 生成流程说明
  mascot/      工作流页屏幕中央的看板娘逐帧演出（二次元正片，交卡/炼卡/炼成三段）
  cards/       卡牌素材
  models/      3D 模型（protected/ 下的加密产物不入仓）
  live2d/      看板娘 Live2D 模型（mascot/）与运行时脚本（runtime/，许可说明见其 README）——AI 客服页用
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
- **流水线只有一份**（2026-08-30 主人点名"两个模式的节点数据是同一份"）：节点数据的
  唯一真相是 `flowStore.nodes`，工坊桌面/投影窗与工作流画布是它的两个**面**——工坊侧
  不再自持 NodeSlot 树（该类型只活在存量草稿正文里，openWorkDraft 经 `flowFromRoot`
  一次性换算）。工坊的写一律走 flowStore 的 action（appendNode/chooseProposal/
  updateProposal(…,pid)/genNode/setNodeProposals），读经 `studioStore.activePath()/
  chosenProposal()`（后者把 plan==="picking" 翻译成"待挑"，别在调用点各判）。
  换走向**保分支**：旧走向的后续段归档进 `flowStore.alts`、发布分支互动视频从它取材。
  「怎么炼一段」也只有一份实现（`studio/segmentGen.ts`；工坊单炼已委托 `flowStore.genNode`，
  连报价带门禁同一处）。出片结果挂在 `Proposal.videoUrl` + 节点的 `videoByProposal`
  （两处由 genNode/setProposalVideo 同拍写），换个模式打开不会要求重炼、重复收费。
  mock 构建（没配 `ARK_API_KEY`）下 Seedance 不返回地址，两边一致写 `"mock:"` 占位串：
  问「出片了吗」用 `proposalDone()`，问「能不能播」用 `realVideoOf()`，别直接看 `videoUrl`。
- **一段的推进是三拍，不是一拍**：写要求 → 推演三套方案（方案台，各带首尾帧预览）→ 挑定
  一套（可换帧、改剧情、按修改重画）→ 才炼视频。方案台组件两边共用
  （`studio/ui/PlanBoard.tsx`，不认 store 只收 props）；"待挑"两面都是
  `FlowNode.plan === "picking"`（单一真相后同一形状，工坊读经 chosenProposal 翻译）。
  **炼出本段视频才能开下一段**——段与段靠上一段的**真实尾帧**承接起拍，攒着最后一起炼会让
  衔接断掉，也会让"第 1 段人物就不对"这种最该早止损的错拖到铺完五段才暴露。这条门禁在
  每一侧都只有一处实现（铁律六）：工作流是 `flowStore.clampCursor`（左右箭头、横划手势、
  底部节点条三条路共用）加 `addNode` 的追加门槛，工坊是 `studioStore.placeholderVisible`
  （虚线卡位亮不亮）加 `composable`（法阵亮不亮）。UI 上的 disabled/锁图标只是把"为什么
  点不动"画出来，别在那里另写一遍判断。
- **凡是"整表换掉 `nodes`"的入口，都要先问 `flowDirty`、成功之后断开旧草稿**。
  这样的入口有**七条**（2026-08-30 少一条：单一真相后「工坊法阵重铺」不存在了——法阵
  只是去画布那一面的门 `requestFlow`，没有第二份数据要铺）：创作入口换模式（`seedSolo`
  ×2）、模板货架套用、模板详情页套用、工作流页「提取模板」、简约模板栏那颗「不用」
  （也是 `seedSolo`）、**个人页/草稿箱打开草稿**（`openWorkDraft`，DraftSheet 两页共用）、
  **做同款**（首页 chip 与详情页整宽键，`remakeNodesOf` → `seed`，2026-08-29）。三件事缺一不可：
  ① **先问**——已经花钱炼出来的段就在 `nodes` 上，换掉就没了（确认卡是共用的
  `components/flow/DiscardFlowDialog`，它按 `savedDoneCount` 如实说清哪些其实存住了）；
  ② **成了再断**（`newWorkDraft()`）——不断的话 `workDraftId` 还指着旧草稿，新流水线
  炼成第一段时的自动存盘会把它**原地覆盖**，而那正是那些付费段唯一的备份；顺序反过来
  也不行：套用被整句拒时流水线没变，却已经和草稿脱钩了。
  ③ **在途生成时一律不许换**（`flowStore.canReplaceNodes` 一处闸）——出片是几分钟的异步，
  没有 AbortController、那一炉停不下来：换掉之后回包时 `spendTokens` 照扣、写回打在
  已不存在的节点上静默落空，而确认卡那会儿正说着「没有花掉的钱」。删段同理
  （agent 那条路绕过了 UI 的 disabled）。另外每炉领一个 `genRun` 令牌，**只有"还是我
  这一炉"才有资格清 `busy`** —— 否则一个已经作废的回包会把「同时只炼一段」的闸打开。
  ⚠ 这条一次性防住四种事故，而它们**都零报错**：段没了、草稿被覆盖、确认卡说的与事实相反、
  钱扣了而成片落空。
- **工坊与工作流是同一件东西的两个面**（2026-08-30 主人点名合并）：创作入口只剩
  **工坊 / 简约**两条；画布从「另一页」变成**工坊里的一层全屏浮层**（StudioPage 的
  `canvasOpen`）——不 navigate 是因为跳页会把 3D 场景整个卸载重装，而用户的心智是
  「把桌子换个看法」。`/flow` **路由保留别删**：简约与付费白模挂卡走的正是它。
  存草稿/组稿/组稿报价**与"又炼出一段就自动存盘"**四样抽在 `hooks/useFlowActions`
  （两个宿主共用，FlowPage 与 StudioPage 都调它，页内不再各留一份）——⚠ 自动存盘那条
  尤其别再搬回某一页：它只长在 /flow 上的时候，同一颗「炼这一段」按钮在工坊里**不会**
  存草稿，而那一刻钱刚花出去、草稿是那些付费段唯一的备份（2026-08-30 复核抓到）。
  画布开关放 `studioStore.canvasOpen`（不是页面 state）：去挂卡编辑页再回来时这一页会
  整个重挂，局部 state 归零 = 用户从画布掉回桌面；放 store 顺带让它进了返回栈。
  挂卡入参仍是 `FlowPage.castEditorState`、回程仍是 `hooks/useCastReturn`。
- **工作流只剩画布一个面**（2026-08-23 线性视图下线，用户点名；`localStorage.flowCanvasOpen`
  那条长期偏好同日作废，别再去读它）。`pages/FlowPage.tsx` 这一页现在同时服务两件事：
  非简约 = 只挂 `components/flow/FlowCanvas.tsx`（z-40 全屏 portal），简约 = 页内那套单段 UI。
  **单段那一大块用 `{simple && …}` 闸住**（2026-08-23 补）：不闸的话它在工作流里照常挂载、
  照常跑 effect、照常开一个 `<video>` 去解码同一段成片，而屏幕上一个像素都看不到 ——
  实测两段"还没有画面…"的提示同时躺在 DOM 里，`elementFromPoint` 打在它们中心拿回来的都是画布。
  ⚠ 别把它当死码删了：简约仍然会落到这一页 —— `applyTemplate` 把模板铺成 `mode:"simple"`
  再 `nav("/flow")`（`/simple` 那条向导页只接创作入口那一下），**付费的 V2 白模挂卡走的正是它**。
  ⚠ 闸**里面**另有一批条件恒假的分支（专注态块、存草稿钮、组稿报价行、底部节点条那一支）：
  简约下 `plan` 恒 null、`deckQuoteOf` 恒 `on:false`，所以它们永不成立。删是安全的，只是没删 ——
  读的时候别当成"简约模式的功能"。
  画布与页内那套单段 UI 都不自己判规则，各条**唯一实现**在哪：顺序门禁 `flowStore.clampCursor`、报价 `nodeCost` /
  `proposalsCost` / `redrawCost`（与真扣钱同一个函数）、「能不能播」`flowStore.realVideoOfNode`
  （2026-08-21 收口，收之前两面各写了一份 `!startsWith("mock:")`）、删段确认 `DeleteSegBtn`。
  组稿（`toCut`）、存草稿（`saveNow`）、挂卡入口（`castEditorState`）三样的实现**只在 FlowPage**，
  画布靠 prop 借——组稿要回写真帧、提炼卡组、清流水线、跳剪辑页，抄一份必然与那边分叉。
  挂卡的 `returnTo` 自 2026-08-30 起**谁发起回谁**（工坊的模板段面板也能发起了，`/studio`）；
  回程收结果只有一份实现 `hooks/useCastReturn`，FlowPage 与 StudioPage 都挂它——模板对号
  那道闸只能改一处。工坊侧的模板车道（选模板/换摘/挂卡/点名句）在 `studio/ui/projection` 的
  `TplSegBody`：选模板弹层借的是 FlowCanvas 导出的同一份 `TemplatePicker`，白模段在工坊
  不再摆 PlanBoard（r2v 没有方案台这一拍，重推/改帧/圈选对它全是死路）。**「加一段还行不行」
  连同工坊虚线卡位问的都是 `flowStore.appendBlocked` 一处**——虚线卡位不问的话，模板段收尾后
  它照亮，用户付完推演费才被 appendNode 拒，钱已花、方案没处落。**已存在的段换模式靠
  `SegModeRow`**（与画布那排页签同名同义、同一批 action：setNodeTemplate / setNodeCustom）——
  铸段窗那三步只管新段，老段此前在工坊换不了模式而画布一直能换；切到自定义的老段另有
  ~~`CustomRefRow`~~。**2026-08-30 改口**（主人实测点名）：**已存在的段不再摆三模式切换行**
  —— 切了之后 3D 桌面上的卡片不会实时变，换模式只该回铸段窗第①步重来，`SegModeRow` /
  `CustomRefRow` 已撤。铸段窗第①步是**三张塔罗卡**（封面 `public/create/mode-*.jpg`，与创作
  入口共用同一张定妆照，出图脚本 `design/gen-segmode-covers.mjs`）；自定义车道是**四步**
  （选式→示例视频→内容→规格），内容页与画布共用同一份 `CustomFrameSlots`。
- **帧一律当参考图发，不走 first_frame/last_frame**（2026-08-30 主人点名「app 里不要有
  单纯的首尾帧生成视频」）：方舟三种场景**互斥**（图生视频-首帧 / 首尾帧 / 全模态参考生视频），
  所以走首尾帧那一条时，挂在这一段上的**素材卡形象图一张都发不出去** —— 人像不像全靠那
  两张设定帧烤进去。现在 `segmentGen` 的 `framesAsRefs`：档位收参考图时，帧转成 https 当
  `reference_image` 发，时序由 `customRefPrompt` 点名（图片1=第一帧…），卡片形象图接在帧
  后面、绑定句按 offset 说话（差一位就是「张三的脸给了李四」）。**价钱一分没变**：
  `segmentCost` 的视频那半只按 时长×档位 算，帧的张数只影响要不要画设定帧。
  ⚠ 两件事别忘：① `first_frame` 是协议级**硬约束**、点名句是**软引导**，段间承接会退一档，
  文案不许把它说成「接得严丝合缝」；② **1.0 两档（极速/标准）与真人档协议上根本不收参考图**
  （`VideoTier.refImg` 硬白名单），它们仍然只能走首尾帧 —— 要全 app 都没有首尾帧出片，
  得把那两档下线，那是价目与商品的决定，不是代码问题。
  ⚠ 这条路上有三处**踩过的**坑，改它之前先读：① 退回首尾帧的降级分支要**同时撤掉
  `refAudios`**（arkClient 对「非 reference 模式 + 参考音频」是当场 throw，软降级会变成
  整段出不了片）；② 图位预算要在 `prepareMaterialRefs` **那一步**就按帧占的位扣，
  不能发之前再截 —— 绑定句是按 refs 全量编号的，截了就会点名到没发出去的编号上，
  那个角色的形象由模型自己编且零报错；③ `noteTail` 必须**现算**（notes 在它之后还会
  被追加），写成定死的串那几条提示永远不会出现在任何一行进度里。
  ⚠ 圈选改帧也跟着从硬约束变软引导（anns 不再挡住这条路）——文案不许说成"一定按你圈的改"。
- **「这一段用哪个模板」是三态，且必须当场表态**（`FlowNode.tpl`）：`undefined` = 还没表态
  （退回 store 级 `template`，老草稿与单模板流靠它）、`null` = 明确没有、对象 = 这一段自己的
  快照。读**只准走 `tplOfNode`**。而 store 级那份会随 `setCursor` 换成**当前段**的快照 ——
  于是任何留着 `undefined` 的段，都会在用户点回前面某个模板段的那一刻被兜底认成那个模板：
  卡片冒出 🧪、报价改按 r2v、加段被拒「白模复刻段只有一段」，最后 `genNode` 真把那个模板的
  参考视频发给方舟（按 r2v 扣钱，炼出来的是前面那段的复刻），全程零报错。
  ⇒ **凡是让某个段有了明确 tpl 的动作**（套模板 / 摘模板 / **加一段**）都要在同一拍里调
  `pinUnstatedTpl` 把其余段钉住 —— 一处实现，漏掉哪一处都没有任何症状（`addNode` 那处
  2026-08-21 才补上，前两处早就有）。
- **两个面要清点的不只是 `store.err`**：flowStore 上还有 `castErr` / `castFallback` /
  `castBusy` 三个用户可见状态，挂卡合成失败写的是它们、`err` 一个字不动。画布这一面此前
  一个都没引用 —— 于是合成失败在画布上表现为"输入框还是空的、提示语还说去挂卡（卡明明挂过了）、
  生成键恒灰"，而那颗「填入默认写法」只长在被画布整块盖住的线性视图上。加新的状态字段时，
  两个面都要问一句"这个字段谁来画"。
- **「对画布说话」（`studio/canvasAgent.ts`）把模型输出当不可信输入**：模型只能发白名单里的 op。
  要用户点头的三件一律**只摆确认卡、点了才跑** —— 推演、出片（真花钱），以及挂卡合成
  （**免费**，但会整表覆盖角色映射并重写你改过的点名句）。所以确认卡上那行 `costLabel`
  有两种含义：价钱**或**后果（cast 那张 `cost` 恒为 0）。**钱上的闸必须写在白名单这一层，
  不能指望提示词**——实测模型会嘴上说"已经给你加一段啦"而门禁其实拒了，回执里那排 ✓/✗
  芯片就是为治这个而存在的（说的是 store 的真相，不是模型的话）。
  确认卡从摆出到点下之间**世界会变**，所以真跑之前要拿同一把尺重问两件事：价钱
  （`nodeCost` / `proposalsCost`）与**顺序门禁**（`clampCursor`）—— 后者漏了的话，用户回前面
  换一套没炼过的走向就会让本段重新上锁，而这张卡成了绕过门禁的唯一入口（屏幕上写着 🔒，
  钱照扣）。
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
- **页顶栏只有一份实现 `components/PageHeader`**（2026-09-05 主人真机点名"返回键偏上、各页位置不统一"后收口）：
  safe-top + 48px 一行，返回键 / 标题 / 「?」中心离状态栏底沿 34px，返回键走 `IconTapButton`（44×44 命中区，
  图标 22px、左缘 16px），标题 18px 加粗，右侧插槽从左到右「?」→ 操作键，长页用 `sticky`。
  新页面**别再自己拼一行 `safe-top … <BackButton/> <h1/>`**：那正是此前 24 屏各差几像素的来源。
  覆盖层的表头（画布 / 核对角色位 / 客服页）不用它，但行高对齐同一个 58px。
- **按钮两档形状**（2026-09-05 主人定，主按钮与次级按钮同一条）：整宽 / 独立的 CTA 一律 `rounded-xl … py-2.5`
  （`w-full` / `flex-1` / 空态里的「去创作」这类，**以及与它们同一行的配对键**——对话框脚部的「取消」、
  段卡上「▶ 回看 / ✂ 编辑」跟着主键同形同高，一行里别一颗方一颗圆），顶栏、工具条、输入框旁、列表行里的
  小键一律胶囊 `rounded-full`（高度按所在行）；紧凑小键（`py-1.5` 以下或字号 ≤11px）不论宽度都是胶囊。
  此前 `bg-brand` 按钮有十来种圆角 × 高度组合，`bg-panel` / 描边那批次级键又是另一套。
  查法：`rg 'bg-brand' --glob '*.tsx' | rg 'rounded-(lg|md)'` 应为空；`rg 'rounded-lg' --glob '*.tsx' | rg '<button|<Link'`
  剩下的只该是选项卡 / 列表行 / 多行的 tile（`text-left`、`justify-between`）。
- **底部抽屉只有一种壳**（2026-09-05 第三轮收口，收之前四种皮：`bg-panel + 阴影` / `bg-ink` 无边 /
  `rounded-t-3xl bg-slate-950/95 backdrop-blur` / `border` 全边）：遮罩 `bg-black/60`，面板
  `rounded-t-2xl border-t border-slate-700 bg-ink`，内边距 `p-4`（自带布局的抽屉至少 px-4），底部
  `calc(… + env(safe-area-inset-bottom))`。标题行 `text-sm font-bold text-slate-100`，关闭键一律
  `<CloseButton chip="sm" size={13} align="end" />`（`components/IconTapButton`，44px 命中区），
  不再手写 `-m-2 p-2` 的裸图标或「关闭」文字键。简单内容直接用 `components/Sheet`。
  查法：`rg 'rounded-t-' --glob '*.tsx' | rg -v 'border-t border-slate-700 bg-ink'` 只该剩
  `studio/ui/modals.tsx`（那是 3D 桌面里的就地卡片弹层，不是抽屉）。⚠ 别把 `backdrop-blur` 加回壳上：
  它会给 `position: fixed` 后代造包含块（已知的坑那一格）。
- **提示条（amber / rose / sky / emerald 底）一律带同色 `/40` 边框**：`rounded-lg border border-<色>-500/40
  bg-<色>-500/10`，紧凑（`py-1.5`）配 `px-2.5`、常规（`py-2`）配 `px-3`；整块的卡式提示（`p-3` 及以上）
  才用 `rounded-xl`。收之前 120 条里 35 条没边框、圆角与内边距十几种组合，同一页上下两条就不一样。
  底色透明度只有 `/10` 一档（第十一轮把管理页 / 客服页 / 模板详情的 `/5` `/15` 收了）；徽标与胶囊那种无边框的
  `/15` `/20` 是另一种控件，不按这条。边线是 `500/40`，别写 `400/40`。
- **段落 / 字段标题一律 `text-sm font-semibold text-slate-300`**（字段 `mb-1.5`、段落 `mb-2`）；抽屉标题见上。
- **居中对话框只有一种壳**（2026-09-06 第四轮）：遮罩 `fixed inset-0 z-* flex items-center justify-center bg-black/60 p-6`
  （z 按层叠需要），面板 `w-full max-w-{xs|sm|md} rounded-2xl border border-slate-700 bg-ink p-4`，标题
  `text-sm font-bold text-slate-100`。确认卡用 `components/ConfirmDialog` / `DeleteConfirmShell`，说明卡用 `InfoDialog`。
  图片放大层（`bg-black/90`）与 3D 桌面内的就地弹层（`studio/ui/NpcDialog`、`modals.tsx`）不在此列。
  遮罩透明度只有这两档（第十三轮把说明气泡的 `/50`、工坊帧卡放大层的 `/75` 收了）；层级上抽屉 / 对话框 z-50、
  盖在它们之上的确认卡 z-[60] / z-[70]、轻提示 z-[90]，客服页自己的抽屉 z-30 只因为那一页没有底栏。
  收之前遮罩有 /60 /65 /70 /80 六档、面板 bg-panel 带阴影 / bg-ink 无边各一半。
- **页签与筛选芯片两档**：紧凑 `rounded-full px-3 py-1 text-[11px]`（顶栏 / 列表头的筛选），常规
  `rounded-full px-3.5 py-1.5 text-xs`（分区 / 分类 / 排序）；选中态一律 `bg-brand font-semibold text-ink`，
  未选中 `bg-panel text-slate-300`（无底的排在 `text-slate-400`）。别再用 `bg-brand/25 ring-1` 这种淡选中态。
  分段控件是另一种控件，两档：整宽 `rounded-xl bg-panel p-1` 容器 + `rounded-lg py-2 text-sm` 段（登录方式），
  紧凑 `rounded-full bg-panel p-0.5 gap-1` 容器 + `rounded-full px-3 py-1 text-[11px]` 段（画布模式页签、管理页筛选）；
  选中态同样 `bg-brand font-semibold text-ink`（第十轮把混进去的 `font-bold` 收了）。
- **CTA 字号两档**：页面 / 抽屉里的整宽或配对 CTA `text-sm font-bold`；对话框（`max-w-xs` 确认卡）脚部的键
  `text-xs font-bold`。客服系列卡片里的「设为 / 下载并使用 / 安装并使用」是整宽 CTA，形状字号都按这条。
- **字号只用刻度**：`text-[9px]` / `text-[10px]` / `text-[11px]` / `text-xs` / `text-sm` / `text-base` / `text-lg`…
  `text-[12px]` 与 `text-xs` 同一个像素但行高不同，`text-[13px]` / `text-[15px]` 根本不在刻度上 —— 第四轮把
  128 处像素写法归到刻度（12→xs、13→sm 或 xs、14→sm、15/16→base、17→lg、19→xl）。
  查法：`rg 'text-\[1[2-9]px\]' --glob '*.tsx'` 应为空。
- **卡片容器边线一律 `border-slate-700/70`**（`rounded-xl border border-slate-700/70 bg-panel p-3`）；输入框与按钮的
  描边仍是 `border-slate-700`。内容卡片圆角只有 `rounded-xl`（第十二轮把模板货架 / 工单卡 / 管理页行卡的 `2xl`
  收了）；整块可选的"砖"（简约模式的两块、自建卡的照片位、草稿箱的封面卡）仍是 `rounded-2xl`，那是另一种控件。
  小字段落的行高只有 `leading-relaxed`（`leading-4` / `leading-5` 与它只差半个像素，却让同一页两行不一样）。空态文案不再手拼 `rounded-2xl bg-slate-900/60` 的段落，走 `EmptyState`。
- **徽标（`rounded-full` 小字非交互）按字号定内边距**：9px `px-1.5 py-0.5`、10px `px-2 py-0.5`、11px `px-2.5 py-1`。
- **全屏覆盖层的表头**（画布 / 成片回看 / 调首尾帧 / 核对角色位 / 客服页，第五轮收口）：`safe-top flex h-[58px] flex-none
  items-center gap-2 px-4`，关闭 / 返回键走 `CloseButton` / `BackButton`（覆盖层上用 `chip="md" size={16}`，
  客服页那种透明顶栏用裸图标 `size={20}`），标题 `text-sm font-bold text-slate-100`。不再手写 `h-8 w-8 rounded-full bg-panel`
  的圆钮 —— 那是 chip md 的手抄版，命中区只有 32px。⚠ `h-[58px]` 是**含 safe-top 那 10px** 的（58 = 10 + 48），
  只准写在自己带 `safe-top` 的那一行上；safe-top 已经在外层时里面那行是 `h-12`（客服页第十四轮量出来差 5px）。
  验法：在浏览器里逐路由量返回键中心的 y，都该是 34。
- **加载圈只有一份 `components/Spinner`**（xs / sm / lg），别再手写 `animate-spin rounded-full border-2 …`。
- **内联链接**：`underline underline-offset-2`；能点出动作的 `text-brand`，说明性的灰链接一律 `text-slate-500`，
  不写 `decoration-*`。
- **分隔线一律 `border-slate-700/60`**（`border-t` / `border-b`）；抽屉壳与顶部下拉窗的那条边线仍是 `border-slate-700`。
- **字母头像走 `components/Avatar`**（按名字取色），别再手拼 `rounded-full bg-slate-700` 的首字母圈。
- **非交互的关键词芯片**（卡片 #标签、形象 #标签）`rounded-full bg-panel px-2.5 py-1 text-[11px] text-slate-300`；
  能点的话题标签（作品页 / 标签输入框）是另一种：`bg-brand/15 text-brand text-xs`。
- **复选框一律 `accent-brand`**；页面根容器一律 `min-h-full px-4 pb-10`（登录页居中布局除外）；
  媒体上的进度条轨道 `h-1 bg-white/25`，面板里的 `h-1.5 bg-slate-700`。
- **禁用态一律 `disabled:opacity-40`**（第六轮收口，收之前 25 / 30 / 35 / 40 / 45 / 50 / 60 七档，279 处）；
  按压反馈用到时 `active:opacity-60`（图标键 `active:scale-95`）。
- **控件下方的报错小字一律 `text-rose-300`、成功小字 `text-emerald-300`**（字号跟着所在面板：页面级 `text-xs`，
  紧凑面板 `text-[11px]` / `text-[10px]`）；输入框 `placeholder:text-slate-500`，紧凑字段也一样。
- **卡片 / 面板内的小标题 `mb-1.5 text-xs font-semibold text-slate-300`**（页面级段落标题是 `text-sm`，见上）。
- **网格间距**：三列卡片网格 `gap-2.5`，两列 `gap-3`；搜索框里的放大镜图标 `size={16}`。
- **会滚动的页一律 `<PageHeader sticky>`**（第七轮）：页面根已经是 `min-h-full px-4 pb-10` 的传 `sticky inset`
  （顶栏自己 -mx-4 顶满、间距不变），根没有 px 的传 `sticky`。收之前 6 页钉、16 页不钉，同一组设置页都不一样。
- **轻提示只有一份 `data/toast.showToast()` + `components/Toast`**（挂在 App 根）。「已复制」这类回执一律走它，
  别再把按钮文字换成「已复制 ✓」或在抽屉里写一行 note。⚠ `window.confirm` / `alert` 一个都不许用：确认走
  `ConfirmDialog`，回执走 toast。
- **列表的加载态与空态也走 `EmptyState`**（`loading` / `emoji + text + hint`），别再手拼 `py-8 text-center text-xs`
  或 `border-dashed py-10` 的框（第八轮逐页目视后把最后 8 个虚线框与工坊广场那条行内报错都收了；弹层里用 `compact`）。
  查法：`rg 'border-dashed' --glob '*.tsx' | rg 'text-center'` 只该剩 `studio/ui/NpcDialog`（那是 3D 桌面的空卡位，不是空态）。
- **横向滚动的芯片 / 缩略图行一律 `no-scrollbar overflow-x-auto`**（第十轮）：安卓 WebView 上不加就会在行下方闪一条
  滚动条（剪辑页片段条在桌面浏览器里直接画出一条灰轨）。`scrollbar-none` 这个类**不存在**（模板货架那行写了等于没写），
  `[scrollbar-width:none]` 一类的任意值写法也别再手拼。查法：`rg 'overflow-x-auto' --glob '*.tsx' | rg -v no-scrollbar` 只该剩注释。
- **时长写法两档**：句子里「N 秒」（`至少留 2 秒`、`2~15 秒`），角标 / 读数 `Ns`（卡片右下角 `21s`、`20.7s`），
  播放头位置 `mm:ss`。**相对时间只有一份 `types.relativeTime`**（刚刚 / 3分钟前 / 9月6日），别再冒 `toLocaleString()`。
- **上万折「x.x 万」只有一份 `types.formatPlays`**：热度 / 播放 / 卡片热度 / 3D 卡面小字都用它（此前四处各抄一份）。
- **空态 / 整页态只有一份实现 `components/EmptyState`**（2026-09-05 收口）：图标 40px slate-600（或 emoji）→ 正文
  text-sm slate-400（出错 rose-300）→ 补充 text-xs slate-600 → 按钮（主 bg-brand / 次 bg-panel+ring，同上一条）。
  列表里的空态 `py-16`，整页态（卡/卡组/模板不存在、未登录墙、取回中）传 `full`（min-h-[70vh] 居中 + safe-top）。
  收之前草稿箱 / 消息 / 个人页 / 模板市场 / 三个详情页各是一副面孔。**别再手拼 `flex flex-col items-center gap-3 py-16`**。
  评论区那种嵌在列表里的一行「还没有评论」不算，留着。
- **长活登记进 `data/jobs`，胶囊只有一颗**（2026-09-05 主人点名"生成/上传时能退出页面不中断，并像出片那样有提示小窗"）：
  AI 出图 / 铸卡上传 / 圈选改图 / 模板上传·登记·白模化·分析都 `startJob()` 领一张票，进度 `update()`、结局
  `done()` / `fail()`（带 `route`，通知点下去要有地方落；人就在那一页上时 `silent`），`GenerationPill` 统一画
  （出片那条仍直接读 flowStore）。任务本身是 Promise、本来就不随页面卸载而停 —— 断的从来是**人看不见**，
  以及**结果写进已卸载的组件**：所以「自己传图做卡片」整页表单搬进了 `studio/customCardStore`
  （`useDraftField` 用法同 useState），退出再进来原样还在；提取窗的 AI 图位在窗关了之后停进模块级
  `parked`，下次打开接回来。新加长活先问两句：结果落在 store/data 层还是组件 state？人不在时谁通知他？
- **页面级表单字段一个规格**：`rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm text-slate-100 outline-none
  placeholder:text-slate-500 focus:border-brand`（textarea 加 `resize-none leading-relaxed`）—— 高 40px，与主按钮同高。
  登录 / 设置 / 发布 / 编辑 / 卡片 / 卡组 / 模板详情 / 自建卡 / 简约模式的输入框都是它。画布、工坊面板、
  弹层里的**紧凑**字段（`rounded-lg px-2.5 py-1.5 text-xs`）与深色弹层上的 `bg-black/30` 不在此列。
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
| 指望给图生 3D 出来的角色加眨眼/口型/表情 | 做不成，而且**要走到很后面才发现**：几何形键无从下手（那种脸是**贴图画的眼睛 + 光滑面**，没有眼睑可动），退而求其次做贴图闭眼又会卡在合成——自动展开的 UV 是碎片图集，眼睛被切成几百个几像素的小岛紧挨着不相干的面，遮罩一膨胀就串岛（眼周灰斑）、一腐蚀就啃掉眼睛（漏出睁眼的虹膜）| **表情能力是资产属性，不是后期能补的**。要表情就用画师做的、自带形键的资产（铸卡师 milltina 有 22 个形键；玩家形象新旧两版都是 0 个）。重展 UV 救不回来：实测整体重展只修好了贴图质量（图集利用率 17.5%→83.2%，关键是 `angle_limit` 要给到上限 89°，因为 Collapse 减面后相邻面法线跳变大、默认 66° 下几乎每面一岛），但仍是几千个碎片岛，脸成不了整块；把头拆成独立贴图也一样（1024² 空洞率 52.8%）。全过程与判据见 `assets-private/playerf-v2/blink-abandoned/README.md` |
| 靠**包围盒跨度**判断「新模型该绕竖轴转多少度」才对得上现网骨架 | 人形的 x/y 跨度**前后对称**：player-m 实测 yaw=90° 与 270° 的误差逐位相同（x 7.7% / y 1.4%），选哪个纯看谁先被扫到 —— 而**抛错了零报错**：蒙皮成功、`think` 能播、导出正常，只是工坊第三人称转过去看到的是后脑勺 | 再加一条**能分前后**的判据：鞋尖比鞋跟伸得远，脚尖指的方向就是正面（纯几何、不用采样贴图，新旧网格都成立）。加上之后 90°/270° 的一致度是 +0.972 / −0.972，干净分开。一处实现在 `assets-private/playerm-v2/scripts/rig_transfer.py` 的 `toe_dir`，`gen_preview.py` / `nose_mask.py` / `face_cmp.py` 都复用它 —— 凡是要摆一台「看正面」的相机，都得先问它，别假定正面朝 -Y |
| 在 Blender 里按包围盒取景、或按 z 区间选面，却没剔掉 glTF 导入器造的**骨架显示辅助球** | 那颗球是个 MESH、**不在文件里**，会把包围盒撑成「和身高一样宽」。后果不止「框歪一点」：凡是按 z 区间取点的判据（取鞋尖、取头部）都会取到球上的点，结论完全是垃圾 —— 本次它让对照相机转到了后脑勺，而「前后两张图逐像素比」照样跑出一个数（3 个像素差），看着像「修复没生效」。一天之内咬了三次 | 一律按「有没有 ARMATURE 修饰器」挑出真正的角色网格，别按 `o.type == "MESH"` 或名字挑 |
| 在 Blender Python 里用 `is` 比较节点/物体 | `link.from_node is node` **恒为假** —— RNA 包装对象每次访问都新建。表现是「一处都没换到」，而打印节点图明明有那条连线 | 按 `.name` 比，或者干脆从连线那头直接写（`link.from_node.image = new`）|
| 给图生 3D 的贴图做**局部修补**时用了任何跨像素的空间滤波（模糊 / 膨胀 / inpaint） | 自动展开的 UV 是碎片图集，一块部位在图集里的邻居可能是头发或眼睛：修鼻子时「把整图模糊一遍当填充底」把暗色吸了过来，出来一块带锯齿边（正好是岛边界）的灰褐斑，比不修还显眼。与 player-f 那次眨眼失败是同一个根因 | 补色只能用**不跨岛**的办法：常数填充（颜色从遮罩外一圈采样）+ 只羽化遮罩本身。遮罩还要先做闭运算补洞 —— 只改外圈会得到「灰环套粉心」的花斑。另外「这块是不是鼻子」不能靠「最靠前的点」找（那是刘海）也不能靠「最大的粉团」找（整张脸是连片的粉），只能拿一张标定过的正脸渲染图**量**出高度层。四次失败的写法与判据见 `assets-private/playerm-v2/README.md` |
| 用 `onBeforeCompile` 改了材质着色器，却没给 `customProgramCacheKey` | 换一组参数**画面纹丝不动**，且完全不报错——你会以为是参数没调对，接着一路调到怀疑人生 | three 复用已编译 program 的键里**不含** `onBeforeCompile` 改出来的源码。同一种材质（例：`MeshToonMaterial`）只要 uniform 定义一样就命中同一个 program，后编译的那份直接被丢掉。凡是按参数生成不同 GLSL 的地方，都要把参数拼进 `material.customProgramCacheKey`（`toonify` 的 rim/spec 就是这么钉的） |
| 抄别处（教程/Blender 插件/别的引擎）的着色阈值，直接填进来 | 要么**一点效果都看不见**，要么**全屏死白**——两头都不报错，只让人以为"这招在我们这儿没用" | 阈值是绑定在**产生它的那条分布**上的，不是通用常数。移植 Blender 二次元插件那两笔时实测：菲涅尔边缘光原值 0.55/0.85 对应 N·V 0.151→0.040（比 1px 还窄，等于没有），高光原值 0.84/0.93 配 Blinn 指数 86.9 则散成一颗颗白点。搬配方可以，**阈值必须在本项目灯光下重量一遍**（`toonify` 里记了两组的实测过程） |
| 换了 `public/models/protected/*.glbx` 却没顶 `?v=` | 老用户的浏览器/WebView 拿的还是缓存里那份**旧模型**，全程零报错，本机清了缓存又一切正常 | 换模型必须同步顶版本号（NPC 在 `TableScene.tsx` 的 `?v=mNN`，玩家/预览档在 `quality.ts` 的 `NPC_VER`/`PLAYER_VER`）。出货全链见 `scripts/bl_milltina_convert.py` 头部 |
| 自己调 `screen.orientation.lock` / `ScreenOrientation.lock` 转屏 | 浏览器里像是好了，**真机上点了没反应** | 方向只有一个主人：`hooks/useOrientationLock`。它每次切路由就 `lock(portrait)`，加上 manifest 的 `screenOrientation="portrait"`，native 那层早把 activity 钉死了，Web 的 `screen.orientation.lock` 盖不过去。要横屏调 `requestLandscape(true)` 表达意图，退出时**必须**传 `false`（首页全屏转屏就走这条路） |
| 改了画幅却发现出片还是横的 | 竖屏设定帧被裁成横的，或视频照样 16:9 | 画幅要**三处同时改**才生效，缺一处就被方舟静默裁掉：Seedance 的 `ratio` 参数、Seedream 的画布尺寸（竖屏 `1440x2560`，比例不符会被裁）、提示词里的构图措辞（尺寸参数管不到构图）。三者收在 `types.VIDEO_ASPECTS` 一处，别在调用点各写各的。另：720p 竖屏方舟实际吐 **704×1248**（对齐到 16 的倍数），不是 720×1280 |
| 动了首页底缘任何一个元素的位置 | 别的元素被**悄悄盖住**：右侧栏的全屏键压住时长文字、底栏的看板娘压住进度条 —— 两件都真发生过，而且都不报错，只是信息看不见了 | 底缘 100px 里叠着四样东西，位置是联动的：进度条容器 `bottom = var(--tabbar-h) - 0.375rem`（离底 50px）→ 时长文字顶沿在 86px → 右侧栏 `bottom = var(--tabbar-h) + 3rem`（104px）。底栏自己 56px 高，任何挂件都不许往上戳。改一个就把这几个数一起重算，别只看自己那一块 |
| 右侧操作栏加了新按钮 | 小屏（640 高）上最上面的头像被 section 的 `overflow-hidden` **裁掉** | 整栏是 bottom 定位的 flex-col，加一个键就往上长 64px。现值 512px + 底 104px = 616px，640 屏还剩 24px。再加键就得先减间距（`RailBtn` 的 `mt-8` 只给有角色演出的键，基准 gap-2） |
| 弹层/确认卡按「第几段」记 | 用户删掉前面一段，下标**整体前移** —— 之后的操作静默落到**另一段**上：换走向、清掉圈选、把已出片的段退回未出片并连锁上锁，最狠的是 `genNode` 打在用户没点头的那一段：扣真钱、覆盖它已经花过钱的成片，回执还写着「第 3 段开始生成了」，全程零报错 | 一律**认 `node.id` 不认下标**（`AgentProposal.nodeId` / `PlanSheet` / `SegPlayer` 三处都是这么修的）；执行前 `node.id !== p.nodeId` 就整句拒。面板类组件加 `key={node.id}`，顺带清掉跨段残留的本地开关 |
| 确认卡上的价钱在卡摆着的时候不会变 | 卡不关，用户去方案台把时长 5s 点成 10s（那正是计价输入）→ 回来点「执行」：标价 507.6k、实扣 1.0M，屏幕上那个数从头到尾没动过 | `executeAgentProposal` 真跑之前用**同一把尺**重算（`nodeCost` / `proposalsCost`），对不上就整句拒并请用户重说一句。所以 `AgentProposal.cost` 存的是**数值**，不只是那句字符串 |
| z-50 的弹层盖住 z-40 画布壳上那条错误条 | store 的整句拒绝（换模板被拒、挂卡被拒）正好落在被盖住的那条上 = 用户眼里的「点了没反应」 | 盖住谁就**自带一份**：`PlanSheet` 与 `TemplatePicker` 各画一份 `useFlow(s => s.err)`；能提前判死的干脆 disable 并在旁边写清为什么点不动 |
| store 的 action 撞上全局 `busy` 时静默 `return false` | 上层拿不到原因：画布的确认卡把**没点着的火**报成绿勾 ✓ 并跳窗过去，用户以为两段都在炼，实际只有一段在跑、另一段一个 token 都没花 | store 里**任何早退分支**（busy / 已出片 / 越界）都要 `set({ err: 整句人话 })` 再 `return false` —— 静默 false = 上层只能瞎猜（本次给 `genNode` / `deriveProposals` / `regenProposal` 补齐，`setNodeTemplate` / `applyCast` 早就这么写）；调用方判成败一律看 `store.err` 或**真实结果**，探不到就当没点着 |
| 拿 `!currentUser()` 当「没登录」 | 冷启动后**立刻**点底栏 ➕ 弹出登录页，而人明明登录着（退出去点「我的」头像昵称钱包全在，再点 ➕ 就好了）。用户读到的是**「我被登出了」**，且每次冷启动手快就撞得上 | `currentUser()` 回答的是"手里有没有人"，回答不了"是没登录、还是会话还没水合完"。远端模式下有一段窗口是**手里有 token、人还没认领上**（`fetchMe` 失败在退避自愈中，或探活失败退了本地库），那一段两者的答案相反。判据只有一处：`account.authState()` 的三态 `in / out / pending`（hook 是 `useAuthState`），**只有 `"out"` 才可以把人送去登录页**，`"pending"` 给 `<AuthPending/>`。pending 是有边界的：自愈五轮退避跑完会如实退回 `out`，不会永远转圈。硬登录墙也只有一处：`App.tsx` 的 `RequireAuth` —— 底栏 ➕ 那类入口只 `navigate`，不许自己再判一遍（判两遍必然有一遍先跑，2026-08-20 就是这么撞上的） |
| 拿**名字**当身份判「这条是不是我发的」 | 用户改完昵称回首页：右侧头像退回字母底、点进去还是旧名字的主页，重启才好 | `VideoItem.author` 是**显示名**，会变。缓存里那些作品的 author 还是旧值，`isMyAuthor` 就判否了。改名时按 `authorId` 精确改写缓存（`videos.ts` 的 `renameMyVideos`），别按旧名字模糊匹配——会误伤重名的别人 |
| 界面上摆一个永远点不动的选项 | 「极致」画质在 App 里是灰的，说明写着"安装包不含 4K 贴图" —— 用户只会觉得功能坏了 | 要么让它真能用（现在 4K 随包发布），要么别显示。同理：设置页那个「已用 xx MB」原来只是个用户看不懂也做不了事的数字，现在配了真能清的「清理缓存」 |
| 用**同一个版本号**发第二份内容（发布之后发现问题、改完重发） | 已经下载过旧包的用户**永久更新不了这一版**：镜像上的 `qimeng-<版本>.apk` 在 Cloudflare 是 `max-age=1y, immutable`，边缘那份一年不变；客户端按清单 sha 校验整包 → 对不上 → 删残包 → 报「校验不通过（可能没下完或被中间人改过）」→ 再点还是同一份缓存。屏幕上那句话还指向一个不存在的原因（中间人） | 2026-08-31 之前这条**碰巧**没事：全局 CORS 的 `Vary: Origin` 让 CF 一律不缓存 APK，同名换内容每次都回源。缓存修好那天这个坑才装上弹。闸在 `scripts/release.mjs` 第 5b 步（已发过的 tag + 内容不同 = 当场拒），出路是**涨版本号重出包**，不是清缓存 |
| 出包时忘了涨 `versionCode` | 已经装了的人**永远收不到这次更新** —— 更新检查靠这个整数判新旧，不涨就等于没发 | 每次 `npm run apk:release` 前先改 `android/app/build.gradle`，见 `docs/app-distribution.md` |
| 新 worktree 缺 `android/keystore/` | release 构建**当场失败**（这是有意的）：以前只 warn，产出的无签名包看起来完全正常，装到别人手机上只提示「应用未安装」 | 报错里写了恢复步骤；完整说明见 [`docs/signing-keystore.md`](docs/signing-keystore.md)。debug 构建不受影响 |
| 把 debug 包发给别人装 | 下次发 release 包时对方装不上，只提示「应用未安装」，看不出是签名不同 | 发给别人的永远只发 `npm run apk:release` 的产物；debug 包只留在自己机器上 |
| 想把 QQ 登录塞进 `providers[]`，复用「系统浏览器 + 深链」那条路 | 授权页直接被 QQ 拒 | QQ 互联注册的是**移动应用**，后台**没有回调地址那一栏**——网页版 OAuth2.0 要求先在「网站应用」里登记域名与回调地址（还要 ICP 备案）。所以 QQ 是**另一条链路**：原生 SDK（`QQLoginPlugin.java`）拿一次性 code，结果**同步返回**，不经过 `OauthDeepLinkBridge`。也因此它不看 `caps.providers`，只看跑没跑在 App 壳里 |
| QQ 登录让客户端把 openid 一起传给服务端 | 报谁的 openid 就登谁的号 | 用 `loginServerSide` 只取 code，openid 由服务端拿 AppKey 去 QQ 换。AppKey 只准待在 server 的环境变量里，AppID（`1905467096`）才是可以随包发的那个 |
| 把 `REQUEST_INSTALL_PACKAGES` 挪进 `src/main/` | 本地一切正常，**上架审核被拒**（Google Play 禁止应用自装 APK），而那时离改动早过去很久了 | 自更新的权限与代码只准待在 `android/app/src/sideload/`；`src/play/AndroidManifest.xml` 里那条 `tools:node="remove"` 是兜底，别删 |
| 全屏浮层写了 `fixed inset-0` 却只铺满一小块 | 浮层被某个祖先裁掉、点不到或压不住底栏 | 祖先上有 `backdrop-blur`（`backdrop-filter`）或 `transform`/`filter` —— 它们会给 `position: fixed` 后代造**包含块**，`inset-0` 于是相对那个盒子而不是视口；`position+z-index` 还会另开层叠上下文，压不过外面的兄弟节点。解法一律是 `createPortal` 到 `body`（评论抽屉、首尾帧卡放大层都栽在这条上，各修过一次） |
| 确认卡/提示语说"丢了要重花 token 再炼一次" | 其实每炼成一段就自动落一次草稿（`FlowPage` 的 `doneCount` effect），已出片的段躺在「我的 → 草稿」里。往**吓人**的方向说错不比往放心的方向说错高尚：用户会为了保住其实没危险的东西放弃一次无害的操作 | 「丢了会怎样」只按**已知事实**说：`studioStore.savedDoneCount`（确实写成功了几段，只有 `saveWorkDraft` 返回非 null 才动）与当前 doneCount 的差额才是真会烧掉的钱。别拿 `workDraftId` 非空替代——那是上一次成功保存留下的。对话框只有一份：`components/flow/DiscardFlowDialog` |
| 自动存盘写成 `void saveWorkDraft(...)` | 失败零提示，而这恰恰是钱刚花出去那一刻；一旦静默失败，上面那句"存住了"就**悄悄变成假的** | 自动存盘也要判返回值并写 `err`（铁律八）。手动那颗按钮早就判了，自动这条 2026-08-21 才补 |
| 输入框忘了 `maxLength` | 提示词硬顶（`VIDEO_PROMPT_MAX`）是**从正文那头下刀**的，越顶的后果是发出去的点名映射被切掉一截、画面照出、钱照收，而那句 `cut` 警告只是一闪而过的进度行 | 每个能写进提示词的入口都硬拦，且用同一个常量。同一件事一度有三个数：人手输入无上限（画布）、模型 300（agent）、线性 400 |
| 全局状态不记「属于哪一段」，界面按 `cursor` 反推 | `castErr` / `castFallback` / `castBusy` 是这么用的，而挂卡合成是一次十几秒的对话 —— 这期间用户点一下别的段光标就走了（点卡片、底部节点条都不判 busy）。于是**真正在被写的那一段解除了禁用**（这几秒打的字会被回包整段覆盖，而那把锁存在的全部理由就是防这个），失败提示与「填入默认写法」却落到**另一段**上，点下去把这一段的骨架写进别人的 plot | 状态自己记住主人：`flowStore.castNodeId`（`applyCast` 起手写），界面与 `fillCastFallback` 都认它、不认 `cursor`。⚠ 别用"只有锁着的段才会 sel≠cursor"这类不变式来省这一步——**上一段炼完那一刻它就破了**（frontier 前移、这一格就地解锁，而 `genNode` 根本不碰 cursor） |
| 手势进行中被别的东西改了视图（程序化平移、滚轮） | 那一下会被下一个 `pointermove` **整个抹掉**，抬手时 `setView` 还把这个覆盖值提交下去 —— 表现成"跳过去又弹回来"，比纹丝不动更像坏了 | `pointermove` 是**整体重算**（`tx = 基准.tx + dx`）不是增量叠加，所以任何在手势中途改视图的地方都要连**基准**一起挪。唯一实现是 `FlowCanvas.reanchor`，四处共用：按下 / 少一根手指（两指→一指、三指抬掉最先按下那根都算）/ `panTo` / 滚轮。这条改了两版才对 |
| 换段这件事自己 `set` 一个下标，不走 `setCursor` | 换段不只是挪下标：store 级的模板快照与**挂卡缓冲**都要换成那一段自己的。少走一条路的表现是"按别段的角色位渲染、挂法串段"，零报错。`shiftCursor` 与 `removeNode` 都栽过（各修一次） | 唯一实现是 `flowStore.setCursor`，任何改变"当前是第几段"的动作都走它。⚠ 它**不许**顺手清 `castErr`/`castNodeId` 之类的在途状态（清了就把归属抹掉，见上一行） |
| 靠"首字白名单 + 字数阈值"判断一句话是什么意思 | 本地降级档拿它区分"改属性"和"写要求"，结果 `^(拍\|画\|讲\|演\|要)` 与「**画**质换成高清」「**要**删掉」正面撞车 —— 判成要求就**静默整段覆盖**用户写好的一大段，不可撤销 | 改用**剥词法**：把改动动词/属性名/属性值/语气词剥净，剩不下东西才算属性指令（属性句剥完必然为空，画面句剥完必然还剩主体）。判据写完要拿一批正反例**实跑**，而且测试直接从源文件抠正则，别在测试里重打一遍（重打一遍就是同一条规则的第二处实现） |
| 把正则写成**字符串常量**再 `new RegExp` | `"\d"` 在 JS 里是转义序列，运行时退化成字母 `d` —— 那一档从此永远匹配不上，而且**零症状**（构建过、类型过、也不报错）。`blockoutPrompt` 里那条模板字符串的 `\s` 是同一个坑的另一面，这次在 `canvasAgent` 的词表上又栽一次 | 一律用**正则字面量**；需要同一份规则的另一种标志位（比如去掉 `g`）时用 `new RegExp(那条.source, "i")` **派生**，别另抄一份字符串。判据写完拿正反例实跑，而且测试直接从源文件抠正则 |
| 上传大视频失败，只说「网络不可用」 | 47MB 传不上去、11.6MB 同一条网传得上去；客户端只拿到 fetch reject（**没有状态码**） | **真因（2026-08-22 用 nginx `$request_time` 实证，三发连续复现）：Cloudflare 的 Proxy Read Timeout = 125 秒。** `rt=125.006 / 125.005 / 125.006` 精确到毫秒一致；`len` 只有 18~23MB（body 根本没传完）、`urt=-`（nginx 还在读 body，没转发给 Node）；nginx 记 **499**。机理：nginx 默认 `proxy_request_buffering on`，**要把整个 body 收完才回包** ⇒ 整个上传期间 CF 看到的是「源站零响应」⇒ 125 秒到点掐断。⇒ **这条路真正的天花板不是那个 100MB，是「125 秒内能推上去多少」** —— 实测同一台手机 5G 上行 0.126MB/s（curl 发 10MB 用 83 秒）⇒ 约 15MB；WiFi 0.69MB/s ⇒ 约 86MB。而且**服务端处理时间也算在这 125 秒里**（`upload_stream` 同步等 Cloudinary 吃完才回包，11.6MB 那发就花了约 79 秒），所以可用体积还要再打折。⚠ **别升 CF 套餐**：这个值只有 Enterprise 能调，Pro/Business 一样 125 秒。⚠ **别拿「路由不存在」的路径做探针**（`/api/health` 收 POST 时 Express 立刻回 404、不等 body，读超时永远不触发）—— 我被这个无效对照骗过一次，还据此写下「不存在 125 秒时间墙」的错误结论。**已修（2026-08-23 上线并真机验过）**：模板视频改走**客户端签名直传 Cloudinary + 分块**（`api/uploads.ts` 的 `directTicket`/`putDirect`/`confirmDirect` ↔ server 的 `/uploads/template-video/sign` + `/confirm`）—— 字节不经过 CF 与源站，每块都远短于 125 秒，断了只重传那一块。真机复验：同一条 47MB 素材此前三次都在 125.00 秒被砍，改后约 100 秒传完，界面上有真进度（「上传视频 63%」）。老路**保留不删**（旧版 App 只认它），新版在 `/sign` 回 404 时退回去。⚠ 三条防线都在服务端且缺一不可，改之前先读 `docs/api-contract.md` 那一节：public_id 服务端生成并签死、`overwrite:false` 进签名（防过审后原地换内容）、`allowed_formats` 进签名（防拿 /video 的票往 /raw 传任意文件 —— 实测过这个洞真的存在）。⚠ 这一格纠正过四次（体积超限 → CF ~100 秒 → 两分钟计时器 → 无固定时间墙），前三次都是「听起来合理但没量过」——`$request_time` 一加上去，一条日志就定案了 |
| 同一笔钱在**第二个地方**再算一次报价 | 2026-08-30 又栽一次：工坊新加的「🎲 生成三套方案」自己算 `proposalsCost(!!proposal.firstFrame)`，而真扣（studioStore.regenNodeProposals）按**上一段的尾帧**算 —— 第 1 段少报一半，且同一块面板上两行之外的重推价用的才是对的那把尺 | 报价永远**从算真扣的那个表达式里取**，由上层算好传下去（本次改成面板算一次、PlanBoard 与 PickedActions 共用）。新加任何一颗印着价钱的按钮时，先 `rg` 一下这笔钱在哪儿扣 |
| 给某条路加门禁时只加在"最近的那一处" | `deriveIssue`（真人档走不了推演）在 flowStore.deriveProposals 与 studioStore.generateNode 都有，**唯独 regenNodeProposals 漏了** —— 真人档上点重推，spendTokens 照扣、炼出三套那一档一张都用不上的帧，还把用户亲笔的 plot 换成 AI 重写的 | 同一条规则的**所有**入口一起补。查法：`rg "deriveIssue\|r2vPriceIssue\|tierBlockReason"` 看它们出现的地方是不是覆盖了每一条会花钱的路 |
| 组件里把 hook 写在早退（`if (!x) return null`）**之后** | 那一格状态从有变无的那一拍 hook 数对不上，React 抛「Rendered fewer/more hooks」——**整棵树当场崩**，而工坊/画布都没有 ErrorBoundary：屏幕上是一块空白，不是一条报错。表现会被描述成"某个功能不见了、之前的改动回退了" | hook 一律排在所有早退**之前**（2026-08-30 一天内 `projection.tsx` 两处各栽一次：ProposalsPanel 的 `playing`、EditorPanel 的 `tplPick`/`matsOpen`）。查法：函数体里第一个早退之后不允许再出现 `use*(`（回调体内的 return 不算） |
| 在**看不见的**窗口里测（最小化/被挡住/标签页在后台） | 三类假故障：① `scrollTo({behavior:"smooth"})` 完全不动、scroll 事件一次都不触发（轮播翻页、首页上下滑看起来全坏）② `<video>` 不加载不解码，`loadedmetadata`/`seeked` 永不到达（出片卡在「捕获本段真实尾帧…」、剪辑页卡在「合并中」）③ rAF 被节流到 ~1 帧/500ms，Three.js 画布是黑的 | 先查 `document.visibilityState`，是 `hidden` 就别下结论。自动化测试必须让窗口真正可见（CDP 截图能骗过去，rAF 和媒体解码骗不过去）。代码侧的对策是**等媒体事件一律带超时**（见 `ai/real.ts` 的 `withTimeout`）——否则用户在几分钟的出片过程里切出去，回来就是永久卡死 |
| 出片没接到结果就按「失败」处理 | 用户面前唯一可点的是「♻ 重新生成（N token）」= **重新下一单 = 再花一次钱**，而那一发的成片往往在方舟那边好好地存在着（2026-08-18 实测：15s 白模模板方舟约 13 分钟出片，App 10 分钟就放弃了，¥27 的成片是事后用任务号从方舟侧捞回来的）。计费在**受理那一刻**就发生（契约「先扣钱、再转发」+「受理之后失败不退」），所以「没接到」和「没花钱」毫无关系 | 「没接到」与「失败」是**两个**结局，判据是**类型**（`ai/arkClient.ArkTaskUnknown`）而不是错误文案里的关键词。三件一起做：① 任务**受理即落凭据**（`data/videoJobs`，用 localStorage —— 要扛得住进程被系统回收，那正是丢结果最常见的方式），落在开始等待**之前**而不是失败分支里；② 节点打 `status:"pending"` 而不是 `"failed"`；③ 段卡上给 24 小时取回入口（查询不计费，取回不再花钱）。同仓另有一份正确形态可对照：`data/templates.waitBlockoutTask`（白模化两阶段），改一处时对着看另一处 |
| 照着一份"结论"动手，没自己核那几行代码 | 2026-08-30 实测：一份写得很详实的调研里，**六条有两条的证据指错了地方**——「服务端早就收作品 tags」（其实那条 `tags` 长在**卡组快照里每张卡**上，作品本体的 zod/model/回包三处都没有）、「`types.ts:417` 有 `VideoItem.tags`」（那是 `Card.tags`）。照着做的话，客户端会发一个被 z.object 静默 strip 的字段：发了、201 了、读回来是空的 | 二手结论只当**线索**，动手前把它引用的那几行**自己打开看一眼**（`sed -n` 就够）。尤其是"某某已经支持了"这种否定不了的说法——它一旦是错的，后果正好落在最难查的那一类：零报错的丢数据 |
| 两个层级上有同名字段（作品的 `tags` / 卡组快照里那张卡的 `tags`） | `rg tags` 会把两者一起命中，读的人以为是同一条规则。上一格那次误判就是这么来的 | 加同名字段时在**两边的注释里互相点名**（"与 X 同名不同物：那是……这是……"）。本仓已有的同型：`VIEW_TAG_MAX`（图位花名）与话题标签、`Card.tags`（进提示词的关键词）与 `VideoItem.tags`（给人搜的话题） |
| 把客户端上限与服务端 zod 的上限"对齐成一样" | 服务端那边超了是**整发 400 而不是截断** —— 一旦客户端调到与它相等再往上动一格，用户会在发布一条几十分钟的付费成片时吃 400，而那一发的 token 已经花掉了 | 两个数**有意不相等**：服务端是**安全上界**（防伪造客户端），客户端是**产品口径**（`types.VIDEO_TAG_MAX`=6/10 vs server 20/40）。只要客户端 ≤ 服务端就永远撞不到那个 400，而且放宽产品口径不用发服务端。理由写在两处注释与 `docs/api-contract.md` 里，防止后人"顺手统一" |
| 一个开关有两个方向，判据却不分方向 | 分享/取消分享共用一颗键、共用一份 `shareBlockReason` ⇒ **已经分享出去的东西撤不下来**：卡组被清空、或分享之后才挂第三方模型/才勾真人，取消分享一并被堵死，而广场上那条还挂着、别人还在装。真人那条尤其反了——那规则存在的全部理由是保护画上那个真实的人 | 凡"这东西不适合出现在广场上"的规则只在 `published === false` 时生效；方向参数**必填**（可选的话新调用点漏传就悄悄退回老行为，零症状）；两个方向的**话也要分开说**（想撤的人读到"离线库里没有别人"是答非所问） |
| 以"只渲染不落库"为由，给同一个映射抄第二份 | `WorkshopPage.toLocalShape` 就是这么来的，它漏了 `views` ⇒ 逛广场点进任何一张别人的卡，「🖼 形象参考」**整块不见**；装回来又全有了。而服务端明明特意把 views 发到了广场那一跳 | 渲染同样要用全字段。映射只留 `data/account.toLocalCard` 一份（铁律六）。⚠ "不落库所以可以另写一份"这个理由本身就是坑——下次服务端再加个随分享走的字段（`idLine` 就是这么加的），第二份还会漏 |
| 同一个 `segIndex` 上挂着两个片段（分割出来的两半），却按"整段"去改它 | 剪辑页「还原整段」无条件把 start/end 回到 `[0, durationSec]` ⇒ 与旁边那一半**区间重叠**，合并循环按各自区间逐个录，同一截录两遍：A[0,10]+B[5,10] 出来 15 秒、第 5~10 秒播两次。而两半共用同一张缩略图、屏幕上没有任何重叠提示，合并是几十秒的实时录制、录完直接进发布页，本页**没有撤销** | 分割的真相是「同 segIndex + 不同 start/end」（见 `Clip` 类型注释），所以凡是要动某个片段区间的动作，先问一句「这一段还有没有别的片段」（`view.some(c => c.id !== t.id && c.segIndex === t.segIndex)`）。UI 上的 ✂「裁过」标记也要问同一句，否则分割会被标成裁剪、并摆出一颗按下去必被拒的按钮 |
| 长循环里的「取消」只在 `await` 那几处判 | 剪辑页合并的取消原来只结束**当前这一段**：剩下每段照样 `setBusy("合并中 · 片段 i/N")` 把「正在停止…」顶掉、照样推进度条、照样去 `resolveMediaUrl`（失败是**抛**、带重试、最坏 2×120s）⇒ 用户点的是「取消」、收到的是「合并失败：取媒体超时」。我实测"取消能停下来"只是因为那条稿子**只剩最后一段**，正好把这个洞掩住了 | 取消要在**每一轮开头**先 `break`；catch 里还要认得出"这是取消不是失败"（`if (cancelRef.current)` 走另一句话）。测取消一定要拿**多段**的稿子测，单段测不出来 |
| 把要给用户看的话写进某个 store 的 `err`，而同一拍就 `reset()` + 换路由 | 组稿落盘失败那句提示写进 `flowStore.err`，可下面两行同一个同步续体里就 `reset()`（`set({ err: "" })`）并 `navigate` 走 —— 而 `err` 的消费者一个都不在目的地那一页上。于是这句话**在任何路径上都显示不出来**，而它说的正是"你刚花掉的钱现在没有备份" | 话要说在**用户接下来会看的那一屏**上：随导航带过去（`navigate(to, { state: { warn } })`，收方 `useLocation()` 拿）。写 `err` 之前先问两件事：这一拍之后它会不会被清掉、这句话所在的页面还在不在 |
| 拿 `listVideos()` 筛出「我的 / 他的」某一类东西 | 远端模式下那份 cache 的唯一来源是 `feed:"recommend", limit:30`（`readyRemote`），`save()` 是 no-op、`feedCursor()` 至今零调用方 —— 所以「我的作品」实际是**全站最新 30 条里恰好是我的那几条**。平台上（含自己）再发 30 条，冷启动后个人页就空了，可见性筛选芯片整排不画，页面还斩钉截铁写「还没有发布作品」，而**「仅自己可见」在 app 内没有第二个入口**。零报错，且只在配了 `VITE_API_BASE` 的真机包上复现（本地注释掉 API_BASE 时这条路是对的） | 「谁发了什么」只有一处实现 `videos.fetchAuthorWorks`，**自己那条也走它**（服务端 `readableFilter` 的 `{author}` 分支本来就把自己的 private/unlisted 一并返回）。远端那份与本地那份**取并集**（刚 pushPublish 的还只在内存里），失败方向是"多显示自己的东西"。`worksKnown` 一律问"服务端认账了吗"，别写成 `self \|\| …` |
| effect 依赖里漏了 `remoteOn()` 这类**时机型**布尔 | 它答的是"配了 API_BASE **而且**服务端真的应答了"，而应答是 `readyVideos()` 之后的事 —— 挂载那一拍恒为 false。于是 effect 只跑一次、当场早退，之后再没人重跑：页面永远停在加载态（上一格那个修复第一版就栽在这儿，本机实测才发现） | 把它**当值读进渲染**再进依赖（`const remoteLive = remoteOn()`），靠 `videosVersion` 引起的重渲染让它翻真。⚠ 别图省事直接依赖 `videoV`：那样点一次赞就重拉一遍列表 |
| 同一个函数里**两把尺**：报价读 A，真发读 `A ?? B` | 工坊「🎲 推演三套方案」按 `!!editor.startFrame` 报价，真发的是 `editor.startFrame ?? prev?.lastFrame`。真实尾帧是 `toDataURL` 出来的 data: URI，`real.ts` 认它就只排 3 个出图任务 ⇒ 用户为 6 张图付钱、只拿到 3 张，每段多扣 3×`IMAGE_TOKENS`；同一函数下面那行 `chain:` 自己就知道它承接了，同一屏上「承接上一段尾帧」的提示也写着 | 这类"优先级链"的值收成**一个函数**（`studioStore.nextStartFrame`），报价/真发/UI 三处只准调它。⚠ 与「两个地方各算一次报价」是同一族但更隐蔽：这次两个地方**代码一模一样**，错的是那一份本身 |
| 给 import 起别名，而注释里写死了 `rg` 自查命令 | `studioStore` 是 `import { addCards as saveCardsToAccount }`，于是 `acquireCard` 注释里那条 `rg "installSharedCard\|addCards\(\["` 搜不到桌面市场那颗按钮 —— 它绕过唯一装卡实现一路没被发现：广场卡带着 `published:true` 落进我的库，卡片详情页显示「已在工坊·取消分享」、删卡确认卡说「删卡会同时下架」，全是假的；点「取消分享」是空操作，点完按钮翻成亮着的「分享到工坊」，按下去必被服务端 400 | 写自查命令时把**别名也列进去**，并先 `rg "<函数名> as"` 一遍。收口型注释里的查法**本身要能查到所有调用点**，否则它给的是虚假的安心 |
| 全局状态只由某一页上的两颗按钮清 | `segEdit`（单段编辑）原来只有剪辑页顶栏那两颗按钮会清，而安卓物理返回键是 `webView.goBack()`（全 app 没有人监听 `backButton`），那两颗一次都不跑 ⇒ 退出后它一直留着：接着按「完成视频」，铸完卡组/3D（真扣 token）后 `persistCutDraft` 因它**一个字节都不落盘**，落到 /cut 顶栏渲染成「保存本段」= 根本没有发布入口，按下去时流水线已被 `reset()` ⇒ 找不到落点 ⇒ 刚花钱的产物被静默清空 | 生命周期挂在**数据换新**上（"有新草稿就翻篇"），不是"用户会不会点那两颗按钮"：`finalizeInner` / `openWorkDraft` / 个人页「接着剪」三处一起清。⚠ 别改成 unmount 时清 —— `StrictMode` 下 effect 会 mount→unmount→mount，那会在 dev 里当场把它清掉 |
| 等媒体事件（`seeked` / `timeupdate` / `canplaythrough`）不带上限 | 窗口不可见时解码被挂起，事件永不到达 ⇒ Promise 永不 settle ⇒ `finally` 里的 `setXxx(false)` 永不执行：按钮恒显「录制中…」、整块面板恒禁用、`err` 一个字不写，用户只能整个关掉面板（连带丢掉**已经扣过 token** 的产物）。⚠ 长循环里的 `cancelRef` 救不了它 —— 卡在 `await` 里，取消轮不到判 | 全部带上限（仓里 `utils/videoFrames`、`blockout/VideoStage`、`flow/SegPlayer`、`CoverPicker` 早就带了，`VideoCardAnnotator` 两处与 `CutPage` 合并循环两处 2026-08-31 补齐）。上限按"这件事本身该花多久"给宽裕量，不是拍一个固定值；**超时不等于成功**，要么当失败抛、要么说清是半截的 |
| 把一块 UI 关进模式闸（`{simple && …}`）里，而它其实与模式无关 | 「取回这一发成片」整块长在 `FlowPage` 的 `NodeScreen` 里，2026-08-23 那道 simple 闸落下后，**工作流画布与工坊一个像素都看不到它**；而 `genNode` 的 pending 分支照常把「用下面的「取回」领回来，别重新生成」写进 `err`（画布自己读 `s.err`，那句话看得见），画布上唯一那颗键却是 `genNode` = 重新下一单。**提示语指向一个不存在的出口**，24 小时后凭据作废、那笔钱彻底沉没 | 关进闸之前先问一句「它是这个模式的功能，还是这条流水线的功能」。跨模式的那种抽成不认宿主的组件（`components/flow/SegmentRecoverCards`），每个宿主各挂一份。⚠ 说「点下面那颗 X」之前，先确认这一面真的画得出 X |
| 同一条规则的第二条支路抄漏了两行，其中一行把**类型判据**压成了字符串 | `segmentGen` 的主路径先 `if (res.pendingTaskId) throw new ArkTaskUnknown(...)` 再 `throw new Error(res.error)`；自定义参考视频那条支路只有后半句 ⇒ 「没接到结果」被抹平成普通失败，上层 `e instanceof ArkTaskUnknown` 判否、节点打 failed；同一支路还少传了受理回调 ⇒ `onTask` 从没被调用、**凭据压根不存在**，取回入口修好了也没有可取的记录。唯一能点的是全价「重新生成」 | 这种"结局怎么交上去"的两三行收成一个函数（`settleSegment`），所有支路只准调它 —— 下次再加支路时漏不掉。⚠ 抛 unknown **必须**配一条真能走的取回路：真人档的凭据只认方舟任务号，在那儿抛只会摆出一颗按下必然说"钱没了"的按钮，比不抛更坏 |
| 设备级单键的队列/名单不记「这是谁的」 | 待发布队列（`ideahub-app.videos.pending.v1`）只有 `{draft,error,at}`。A 的作品没传上去 → A 退出、B 登录 → `flushPending` 带**B 的 token** 发出，而服务端 `author: req.user._id` 只认 token ⇒ **A 花钱炼的成片挂到 B 名下、进广场**，随后条目被删；在自动 flush 之前，个人页横幅还把 A 的标题与失败原因显示给 B、并给一颗「立即重试」。全程 200、零报错 | 凡是落在设备上、又会**代表用户对外发起动作**的东西都要记 owner（`ownerKey()`），读写两侧一处判断。⚠ owner 对不上时**只跳过、绝不删**（删了等于替上一个人丢作品），整表覆盖时把别人那几条原样并回去。同文件的 `LikedStore` 是正确样板 |
| 「先来先占」的闸只看"广场上现在有没有别人" | 作者自己**下架再上架**时，那道闸会把他自己挡在门外（下架期间广场上是空的，别人趁机占位；作者回来就被判成"已经有人先分享了"）。第一版就是这么写的，用例实测才发现 | 两道闸分工：① 装来的副本按 `sourceOwner` 一律拒（判**有值**，存量当原创）；② "广场上已有别人"这道**只在"我从没发布过这一套"时**才拦。次序由 `publishedAt`（只在第一次发布时写）+ `_id` 兜底决定，广场去重与 install 共用同一个排序 —— 否则"看到的"和"装到手的"可以是两个人的两份 |
| 级联删除的清单里，某张表**既不在"删"里也不在"不删（刻意的）"里** | 那就是遗漏，不是取舍。`purgeUserCascade` 整个文件一次都没提到 `BranchTemplate` ⇒ 被永久删号的人发布的白模模板原封不动留在货架上（市场列表是裸的 `find({status:"published"})`，不查作者在不在），别人照样套用出片、照样按 r2v 付费；那份 100MB 级素材在产品内**再没有任何把手能删**（删模板端点只认 ownerId 本人，而那个人已经不存在了） | 级联函数的文档要维持**两份清单**，新表加进来时必须落在其中一份里。资产回收走 `PendingAssetPurge` + 清扫器重试，别在级联里抄第二份 destroy 逻辑；顺序（refVideo → 封面 → 原始素材 → 分段组末段才带走组源）与单条删除端点保持一致 |
| 远端模式下往 `account.persist()` 里存东西 | 它在 `remoteOn()` 时**一行都不写**（有意的：防幽灵账号）。于是"只改内存 + persist()"这套写法在正式包里等于什么都没存 —— 收藏就是这么丢的：收藏 10 条、书签点亮、个人页「收藏 10」全对，杀掉 App 再打开全部归零，而 FeedPage 的注释还写着「刷新后都还在」 | 先问一句「服务端有没有这一项的端点」。有 → 走服务端（乐观 + 失败回滚，照 `toggleFollow`）；没有 → 按 owner **单独落一个键**（照 `videos.LIKED_KEY`），并且界面上不许暗示它跨设备。**绝不放开 persist() 的 remote 闸** |
| 远端模式下的写操作写成 `void promise.catch(emitApiError)` | 全 app **没有任何地方监听 `api:error`**，而远端模式本机不落盘 ⇒ 那一发请求就是唯一的真相。改昵称/简介/emoji 头像就是这么写的：网络一抖，屏幕显示「已保存 ✓」、`renameMyVideos` 还把新名字铺满作品列表，冷启动整库重建后原样退回旧值，用户读到的是「App 把我的改动吞了」 | 远端模式下的写一律 `await` + 回**整句人话**，失败回滚内存那份并把话摆在**用户按的那颗键旁边**。同页的 `setAvatarImage` 是正确样板 |
| 函数签名里的**可选回调**（`onTask?`）漏传 | 漏传**没有任何编译期或运行期症状**。真人档补「取回」时就漏了一次：`composeSegments` 少给第三参 ⇒ `rememberVideoJob` 一次都没跑 ⇒ 凭据一条不落，而界面照常写着「用下面的「取回」领回来」、任务号也从错误文案里删掉了 —— **比不改更坏**。而同一次改动的注释还写着"三件连动已经做齐" | 这类"漏了就零症状"的参数**改成必填**（`composeSegments` 的 `onTask`/`onProgress` 已经钉死）。调用方真不需要就显式传 `() => {}` —— 那是一个**看得见的决定**，不是一次遗漏。改可选参数时先问一句"漏传会怎样"，答案是"零症状"就该钉 |
| 把 N 种结局**压成两档**（`ok / 其余`、`有 / 没有`） | `fetchVideoById` 回 ok/missing/failed/offline 四档，收藏页压成 `video \| null` ⇒ 弱网下 20 条全超时会同时显示「有 20 条被作者删了」和「还没有收藏」，而服务端那 20 条好好活着；effect 依赖里又没有值会因为网络恢复而变 ⇒ **永远不重试**。压档之后"没问到"与"确实没有"就再也分不开了 | 结局**原样带下来**，在渲染层才分档；"没问到"永远单列一句话并配一条重试的路（依赖里放一个 nonce，网络恢复不会自己触发任何 effect）。⚠ 分档要**分全**：只分"没问到 / 其余"的话，"确实全没了"会掉进加载态那一支，屏幕上留一句永远消失不了的「正在取…」 |
| **后一步无条件覆盖前一步的产物，而报价按前一步的次数收** | 承接段里，圈在前半段的每一处都会真跑一发 Seedream 图生图（真花钱），紧接着 `if (input.carryFrame) first = input.carryFrame` 把它**整张覆盖** —— 图钱花了、图作废，只有文字要求还进提示词。零报错，进度行还写着「按圈选改画面 1/N…」，而报价按圈选**总数**全额收 | 凡是「A 的产物可能被 B 覆盖」的地方，先问一句「那还收不收 A 的钱」。修法是把**"哪几条真的会跑"收成一个导出函数**，报价与真跑读同一个（`segmentGen.redrawnAnns`），并把跳过的那几条**说出来**（少收钱也要说，否则用户只会以为"圈选坏了"）。⚠ 别反过来修（让 A 赢、丢掉 B）：这里 B 是段间承接，打断接缝比少改一次图坏得多。⚠ 报价一旦依赖某个判定，那个判定的**重复实现**就从"冗余"变成"事故源"——本次顺带把 `genNode` 里手抄的承接判定收回 `nodeCarry` |
| 把**某一个模型**的能力当成"方舟的能力"，发给了另一个模型 | `asset://<可信素材>` 是 **Seedance**（视频侧）的协议 —— 方舟视频不收直接上传的真人人脸、只收授权素材。而 `prepareMaterialRefs` 原来**无条件**把已授权真人卡换成这个 URI，它被 5 条画帧的路（推演/改帧/重画/段内绘制起拍与结束画面）共用 ⇒ `image: "asset://asset-…"` 直接进了 **Seedream**。服务端 `billedForward` 是原样透传，不翻译。两种结局都坏：整发 400（catch 退回纯文字重画，每帧多打一发、按调用计费，实收可到报价两倍）或被静默忽略 —— **画出来的人不是他授权的那个人**，而出片正是照着这些帧拍的，做授权的意义整个落空，全程零报错 | 「这批参考图发给谁」做成**必填**参数（`prepareMaterialRefs(materials, "image"|"video", …)`）—— 漏传是零症状的。⚠ 不能拿同一份改一改：绑定句按**各自那份的全量编号**说话，替换或抽掉一张就会点名到另一个角色身上；要两份就各准备一份、各自 bind（`segmentGen` 的 `drawRefs`）。⚠ 出图这条本来就不需要替换：**Seedream i2i 对真人照片放行**（2026-09-01 实测 `doubao-seedream-4-0-250828` + 授权照片 → 200 出图），拦真人的是 Seedance |
| 注释自称「**唯一实现**」，而别处手写了一份相反的 | `defaultSchemeFor` 写着「无脸方案主推这条产品规则的唯一实现」、对真人回无脸；而 CustomCardPage 的真人按钮手写 `find(s => s.builtin && !s.faceless)` 强制套正脸。两边各自都有道理，错的是那句注释 —— 于是主人问「为什么真人扫脸默认是全身立绘+面部特写」时，**去唯一实现那儿看到的是相反的答案**，真答案藏在另一处的一行注释里 | 发现第二份实现时别只改代码：把**区别本身写进签名**（本次加了 `authorized` 一档——没授权走无脸，已授权靠 asset:// 绑定走正脸），漏传时退回**更保守**那一档。收口后原地留一句「以前有两份、区别是什么」 |
| 「东西到手了」与「它能放进哪一格」写成同一个 if | `importAssetPhoto` 找不到可用图位就当场 `return`，于是**照片连 aiBody 都没进**；屏幕说「换一套再试」，可换方案**不会**重新取图（全 app 没有第二个触发它的入口）——那张授权照片就此消失，用户只能解除授权重走一遍 | 拆成两步：先无条件认下「到手了」（存进状态），再决定「放不放得进格子」。凡是 `return` 落在「已经拿到东西之后」的，都要先问一句「这一退，手上那份还在不在」 |
| 给某个函数加了过滤，却没看**谁还在读它** | `pendingPublishes()` 加 owner 过滤之后，`cacheSweep` 也在读它 —— 于是冷启动没连上服务器（镜像空）或换过账号（被 owner 滤掉）时，点一次「清理缓存」就把待传成片的**唯一磁盘指针**删了，而确认卡写着「还没传上去的作品不会动」 | 加过滤前先 `rg` 一遍调用点，问每一个"它要的是**界面视图**还是**全量事实**"。给扫描/回收这类"要全量"的调用方单开一个不过滤的读（`allPendingDraftsForSweep`），并在注释里互相点名 |
| 一个页面自带的行为（排序/兜底）**把问题掩住** | 修「评论出现又消失」时把归并排成了升序，而服务端是 `createdAt: -1`、`addReply` 也插最前 ⇒ **详情页评论区整个倒过来**、刚发的那条沉到最底。而评论抽屉那一面自带 `buildThreads` 排序，**只测抽屉完全看不出来** | 同一份数据有两个渲染面时，改数据层之前先看**两个面各自还做了什么**。测的时候要挑那个**什么都不做**的面（这里是 VideoPage：平铺渲染、全页一个 `sort` 都没有） |
| 只 `navigate` 到某一页，而那一页读的是别处的状态 | 简约模式出片后 `navigate("/cut")`，而剪辑页读 `studioStore.draft` —— 这条路从没调过 `finalizeFromFlow`，draft 恒 null ⇒ 挂载那一拍就被 replace 进 3D 工坊。简约又不进草稿库，那条刚花钱炼的片子没有第二份副本，按返回键还会来回弹 | 「去某一页」= 换路由 + **把那一页要的东西准备好**，两件事。共用的准备动作抽成一处（`useFlowActions.toCut`），新宿主只准调它。⚠ 用 ref 挡住重复触发：`toCut` 每渲染都是新函数，进依赖会反复触发，而组稿要铸卡=真花钱 |
| 服务端 `select` 手写一份"可见性要哪几列"的清单 | `assertVisible` 的 select 由调用方给，少一列 ⇒ `doc.<那列> === undefined` ⇒ 判据静默走成另一支。`linkOnly` 就这么漏过：「凭链接可见」作品下的 @ 提及**一条通知都发不出去**，而提及落库了、回包齐全、客户端算出 `droppedMentions === 0`，连那句黄字警告都不出现 —— 公开作品下是好的，所以本地测不出来 | 判据要读哪几列，由**判据自己**声明（`READABLE_FIELDS` 与 `readableBy` 同生同灭），取数的地方无条件并上它。多取三四列代价是零，漏一列的代价是"被 @ 的人永远收不到通知" |
| 远端拉取失败时 `catch(() => [])` | `listCards` 拉挂了 ⇒ `db.cards` 被整表覆盖成空 ⇒ 用户真花过 token 铸的卡在工坊里全没了、空态还说「还没有卡片」，而 `assetsHydrated` 照样置真。重启一次又全回来 | 失败回 **`null`**（≠ 空数组）、**跳过覆盖**、把原因留下来（`cardsLoadIssue()`）；空态分「没问到 / 问过是空的」两句话说。作品那一侧的 `worksKnown` 是同一条规则的正确样板 |
| 页面上的"我点过没有"用 `useState(false)` 起手 | 详情页的点赞就是这样：进已赞过的作品显示空心（而数字里含着自己那票），点一下撞上 `setLike` 的幂等短路 —— 不发请求、数字纹丝不动，只有图标变红，用户读到「点了没生效」；再点一下真的把赞取消了。想取消的人则要点两下 | 「我点过没有」的唯一真相是 `videos.isLiked`。⚠ 详情页不能照抄首页的 lazy 初值：那条路上挂载时数据还没到，必须**在详情回填 effect 里再同步一次** |
| 「框选段」与「在**整条原片**的时间轴上标帧」摆在同一屏（2026-09-05 之前提取器的自带白模片路就是这样） | 用户把 34 秒裁成 19 秒之后，下面那条标帧轴还是 34 秒 —— 即使有黄字说"只有选段里的才作数"也照样混淆（主人实测点名）。而这一步是付费的、标错零报错 | 拆成两步：第 1 步只框选段与裁剪（Trimmer 的 submit 变成「下一步」、`initial` 让回退不丢框），第 2 步在**框出来的那一段**上标帧（`BoxFramePicker` 的 `axis="clip"`：滑杆两端 = 选段起止、读数从片段第 0 秒起、播到末尾自动停）。⚠ 只是画法：标记仍按原片绝对秒存、判据仍只有 `boxMarksInSelection` 一处 —— 改存相对秒的话，回上一步挪了起点，同一条标记就悄悄指向另一帧。⚠ 末尾钳位要挂在 `timeupdate` 上，不能只靠 rAF：页面不渲染时 rAF 一拍都不来而视频照样解码 |
| 同一件事有两个调用方，各自 `await` 同一个会发请求的函数（`saveTemplate` 自动登记 + `makeOwnRefTemplate` 再登记一次） | 两发 POST 同时在路上：第一发 201、第二发被服务端按参考视频去重成 409。用户看到「这段视频已经登记过一个模板了」，模板其实建好了，但异常在认人之前抛出、认角色位那一步根本没跑（2026-09-05 浏览器全链巡检抓到，线上一直如此） | 会发请求的"登记/上传"类函数按 id 记**在途 Promise**（`templates.registering`），后到的调用复用同一个结果；409 一律先按同一把钥匙（参考视频地址）去「我的」列表认领，认不到再报错。查法：`rg "registerTemplate("` 看有没有两处对同一个对象各调一次 |
| 列表 cache 只在冷启动装一次，之后整个会话没有任何重拉入口 | 首页永远是启动那 30 条：别人新发的作品要重启才出现；拉黑了某人他的作品还留在首页（分区页是现拉的，已经不见了）；被下架的照样在首页播。「关注」页签更是从这 30 条里按作者名筛 —— 平台一多作品就永远是空的，而服务端 `feed=following` 一直都在、客户端从没调过 | 重拉只有一处实现 `videos.refreshFeed`（带 minAgeMs 与在途去重），首页挂载 / 从后台回来（停在第一条时）调它，拉黑当场 `purgeAuthorVideos` + 重拉；关注流走 `refreshFollowingFeed`。⚠ 整份替换要保留本机乐观条目（`onServer()` 为假的那些），否则刚发布还在传的那条会从首页消失 |
| 服务端给用户看的字段直接写了内部枚举 key（举报理由 `porn` 写进 `takedown.reason`） | 作者的作品页上写着「已被平台下架 porn」；而作品列表那条路手填的是中文，两条路对不上 | 给人看的字段在**写入那一刻**就翻成人话（server `Report.REASON_LABELS`），客户端再兜一层 `takedownReasonText` 管存量。凡是 enum 要上屏，先问一句"这个 key 谁翻译" |
| 明明**已经知道**参考图是真人照片，画风句还写成"照片则写实、插画则插画"让模型自己判 | 真人扫脸路上，同一张授权自拍出的「面部特写」是照片、「全身立绘」却是厚涂二次元（2026-09-04 主人真机）。本机复现：清晰参考 14/14 写实，把同一张自拍缩到 300×400 再拉回、JPEG q55（扫脸留下的正是这种）就 4 张里 2 张飘成 CG/厚涂感 —— 「全身」要模型编出参考里没有的整个身体，飘的空间最大；「特写」几乎是重画参考图，所以只坏一格 | 已知事实就说死：`slotPrompt` 的 `realPhoto`（**必填**）为真时换成无条件的 `PHOTO_LOCK_CLAUSE`（降质参考 4/4 写实），两条路各传自己的 `realPerson`。⚠ 画风句一律接在构图正文**之后**：挪到前面「全身」就丢（实测 1 头肩 + 3 半身）。⚠ 「出不出全身」是另一件事、另一处实现：`promptSchemes.FULL_BODY_PROMPT`（只有头肩参考时老写法约半数出半身，点名鞋子/留白/不裁切后 8/8），别混进画风句里修 |
| 把**设定首帧**（`firstFrame`）当成片的预览图画 | 白模复刻段与参考卡片直出段一张设定帧都不画，firstFrame 恒空，出片后画布上那张卡写着「预览帧没抓到」——而根本没有任何代码去截过它（出片后只截**尾帧**）。文案暗示"试过但失败"，实际是"设计上就没有"（2026-09-04 主人真机） | 成片第一帧单开一格 `Proposal.poster`（与尾帧同一次解码截，`captureVideoHeadTail`），预览一律读 `poster \|\| firstFrame`。**不能**把截到的帧写回 firstFrame：`refVideoOn` 见它非空退出直出、白模 `blockoutIssue` 见它非空整句拒、承接判定拿它认亲——重炼时会被自己截的帧挡住 |
| 剪辑页播放器等**截帧流**（fetch 成 blob）才播，取流失败只 `console.warn` | 真机上一句永远的「视频载入中…」，而 release 包没有 CDP、也不把控制台写进 logcat，用户与开发者都拿不到一个字。查了一圈：转存登记表说地址是 Cloudinary、手机 curl 3.7 秒拉完、手机 Chrome 上同一段 fetch+blob 2.6 秒通、CSP 放行——四条都排除后仍不知道原因，因为**原因从没上过屏** | 播放直连 https（`useMediaUrl` 不传 forCapture），截帧流后台取、失败原因与「重试」画在预览正下方；圈选改从截帧流上离屏截（`utils/videoFrames.loadVideoAt`），别再从直连播放器 drawImage（画布会被污染）。凡是"取不到就一直转圈"的地方，先问一句：失败了用户在屏幕上能看到什么 |
| 「操作完去别的页」写成 `nav("/x")`（push），而这一页随后就不该再被回到 | 模板详情页删掉模板后 push 了市场页，被删的那页还压在栈底 ⇒ 市场页按返回回到一个已不存在的模板（主人真机：「返回到上一访问的模板页」）。深链冷启动时 `nav(-1)` 更狠：历史里没有上一页，WebView 直接退成白屏 | 死页/终点页一律 `replace`；返回键只走 `hooks/useBackOr(fallback)`（有上一页才 `-1`，判据 `history.state.idx`），个人页、通知页、模板两页已收口，别再手写一份 |
| 分段登记「AI 认不出人」时去改 App 的提示或加合并/重切 | 2026-09-05 主人素材上模型每帧都看见了 10~12 个人，是**服务端解析器**把整帧扔了：四个坐标写成 `96 602 187 703`（空格分隔）不匹配正则、以及 10 人以上群戏撞上"相邻中心太近"的阈值（那条阈值只拿 2~7 人校准过）。App 侧无论怎么合并/重切都救不回来 | 先看 pm2 日志里 `[blockoutize] 认人+量框` 那几行再决定是谁的问题。server 侧已放宽（空格/逗号分隔可读、超上限群戏不按间距否决）；App 侧结果页把没认出的段列出来就地「换一帧重认」，并明说没认出也能整组套用（退回整段泛指换人）。**不要自动并段**：认不出 ≠ 没有人，并了还常超 30 秒窗口 |
| 「授权给的是这个账号」的东西只落在本机侧库（IndexedDB） | 换机 / 重装 / 并排装了 debug 包再登录：卡从服务端回来了、绑定却没有，用户读到的是「退出再登录，授权就失效了」（2026-09-05 主人真机 —— 那次其实是并排装的 debug 包另有一套存储，但换机同样会撞上） | 账号级的状态服务端存一份（server `BranchCard.portrait`：只有卡主读得到、广场与安装都不带），本机侧库退成镜像：登录时 `account.syncCardAssets` 以服务端为准装回、本机独有的补传；写入口只有 `account.bindCardAsset`（本机 / 服务端两步各自回执，卡详情页把「没同步」说出来）。同型的 `cardVoice`（声音样本）仍是本机独有 —— 那是产品决定（样本不出本机），不是遗漏 |
| 工坊里一张**空白占位段**（加了段还没推演）把人困住 | 点节点卡开的是方案台：顶栏那枚 ‹ 是"上一段"（第 1 段时灰着），铸段窗那枚"上一步"随窗一起没了，「删除本段」又被"只剩一段"挡住 —— 用户描述成"退出工坊再进来，返回按钮消失了，没法重选走向"（2026-09-05 主人真机） | 空白的判据只有 `flowStore.nodeBlank` 一处（没剧情、没帧、没出片、非自定义/白模）：方案台给「‹ 回铸段窗重选模式」（`studioStore.recastBlankNode`，撤段 + 按原要求/档位/画幅/素材重开铸段窗，不花钱），`removeNode` 对空白段放开"只剩一段"那道闸。⚠ 别按"只有一套方案"判空白：做同款/老草稿的段也只有一套，里面是真内容 |
| 凭据**受理即落盘**，而取回卡读的是"本机全部凭据" | 每次出片，受理那一刻起黄色的「第 N 段有一发成片还没取回」就摆出来、取回键还灰着，直到成片回来才消失 —— 用户读到的是"刚下单就丢了一发"（2026-09-05 主人真机点名） | 落盘没错（进程被回收时它是唯一线索），错的是**显示门**：`data/videoJobs` 加一份只在内存里的 `waiting`（受理时 `setVideoJobWaiting(id,true)`，genNode 的 finally 里解除），取回卡读 `recoverableVideoJobs()`。冷启动回来 waiting 天然为空，凭据照常摆出来。⚠ 别把它做成落盘字段：落了盘"正在等"就永远为真 |
| 取回凭据只落在本机 localStorage，取回成功那一拍就销毁，而成片只落在内存里的流水线上 | 出片到一半 App 被重启（2026-09-06 是我们出包装机）：流水线没了、凭据还在 → 用户按「取回」成功、凭据销毁、成片落进内存里新开的一段 → App **又**被重启一次 → 这一发谁都找不回来：钱在受理那一刻已经扣了、方舟侧好好存着 24 小时、App 里一颗按钮都没有（主人真机，那一发事后从服务端日志里的任务号捞回并转存） | 两道都补：① 服务端受理即登记（server `ArkVideoTask`，`GET /api/ark/video-tasks`），App 进创作入口时 `videoJobs.importServerVideoJobs` 把本机不认识、也没处理过的任务补成凭据（本机「已处理」名单 `taken` 防重复出现）；② 取回成功**当场存草稿**（`SegmentRecoverCard.take`）—— 创作入口那个宿主没挂 useFlowActions 的自动存盘。⚠ 出包装机的纪律：App 在前台亮屏时**不装**（人可能正在等出片，屏幕不动 ≠ 没在用） |
| 取回卡上的键**永远灰着**，旁边写"回到当初炼它的那条工作流" | 原节点不在这条流水线里就整句拒 —— 而"不在"最常见的原因是 App 被重启、那一段从没存过草稿（第一段炼成之前没有任何自动存盘）：根本没有那条草稿可回，一颗灰键守着一笔已经花掉的钱（2026-09-05 主人真机：被我重启 App 打断的那一发） | 原节点在 → 落回原位；不在 → `flowStore.placeRescuedSegment` **新开一段**安放（落在第一段没出片的段之前，chain:false、tpl:null、不写 firstFrame）。凭据从 2026-09-05 起多存时长 / 画幅 / 档位 / 剧情，老凭据按成片实测与缺省补。取回卡的键不再按 `mine` 灰掉，只换一句话 |
| 剪辑页按**申报**时长（`durationSec`）铺片段出点 | 白模复刻 / 参考视频直出的成片长度跟着参考走（20 秒模板出 20 秒的片），申报值还是 5 ⇒ 进剪辑页只剩 5 秒、合并也只录 5 秒，而播放器明明能播 20 秒（2026-09-05 主人真机） | 出片截帧那一步顺手读 `duration` 一路带回 `Proposal/VideoSegment.realDurationSec`；剪辑页铺片段、还原整段、分割、✂ 标记一律 `realDurationSec ?? durationSec`（`segLen` / `lenOf`），没记上的从播放器 / 截帧流 / 合并前的 metadata 学（`learnRealDur`），没裁过的片段跟着真实时长走。报价仍按申报值 |
| 发布时成片走 `POST /uploads/media` 整份 multipart | 一条作品的 6 张图几秒传完，10.3MB 的成片在 180 秒里一个字节都没到 Node（pm2 里没有那一跳的日志），个人页横幅「上传超时」（2026-09-06 主人真机）。老路是整份经 Cloudflare（125 秒读超时）→ nginx 收完整个 body → Node 同步等 Cloudinary（100 秒）三段串行，慢网上任何一段慢一点就整发作废、从头再来 —— 与 2026-08-22 模板视频 47MB 那次同一个根因，当时只改了模板那条 | 成片也走签名直传 + 分块（`uploadMedia` → `/uploads/media/sign` + `putDirect` + `/uploads/media/confirm`，与模板视频同一份 putDirect），每块 6MB、断了只重传那一块、有真进度；每块的超时按「90 秒没传出一个字节」算而不是固定总时长（真机 5G 上行只有 30~40KB/s，一块要 150~200 秒，固定 240 秒只差一口气）；上限 100MB（老路 20MB 是 multer 内存缓冲逼出来的）。老服务端 `/sign` 回 404 退回老路。契约见 `docs/api-contract.md`「发布成片直传」 |
| 成片预览截帧把整条成片拉到手机上解码 | 21 秒的白模片几十 MB：直连 `<video>` Range 截帧与 fetch→blob 两条路在手机网上都拉不完，「捕获本段真实尾帧」跑满 120s 后 The user aborted a request（2026-09-06 主人真机，第二版直连 Range 也没救回来）；而转存那一步的成败被步骤日志折进了「渲染视频」，看不出截帧到底走的哪条路 | 转存后的成片让 Cloudinary 抽帧（`so_` 变换，两张几十 KB 的 JPEG，`real.grabViaCloudinary`），手机只读一次元数据；直连 Range 与下载后截只做兜底。转存没赶上（还是方舟临时链接）时 `flowStore.settleNodeMedia` 后台盯 `/transfer-video/status`，拿到永久地址就换上并补截；卡片上另给「重截预览」（`recaptureNode`）。步骤日志里「成片转存中 / 没成」单独成一步（`genLog.splitStatus`）。三处捕获失败仍把原因写进步骤日志（`captureIssueLine`） |

## 相关文档

- [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — 从零到能跑
- [`docs/api-contract.md`](docs/api-contract.md) — 与 server 的接口契约（三仓共享）
- [`docs/play-store-checklist.md`](docs/play-store-checklist.md) — 上架检查单
- [`docs/app-distribution.md`](docs/app-distribution.md) — 发包给别人装、应用内更新怎么走
- [`docs/signing-keystore.md`](docs/signing-keystore.md) — 签名 keystore 换机 / 新 worktree 怎么恢复
- [`public/perch/README.md`](public/perch/README.md) — 角色动画资源怎么生成、踩过什么坑
- [`public/createbtn/README.md`](public/createbtn/README.md) — 底栏 ➕ 上那只常驻宠物（含并排版式的取值）
- [`public/avatars/README.md`](public/avatars/README.md) — 官方 Q 版看板娘头像怎么裁、选了之后存的是什么
- [`public/mascot/README.md`](public/mascot/README.md) — 工作流页看板娘三段演出的出图流水线与坑
- [`design/README-tsumire.md`](design/README-tsumire.md) — 购入模型的接入笔记与**授权结论**（上线前必读）

## 真机联调（客服页这类要打本机 server 的功能）

1. 本机起 server（内存库也行），CORS 白名单要包含 `https://localhost`（Capacitor WebView 的 origin）。
2. `.env.e2e.local` 写 `VITE_API_BASE=http://localhost:4000`，然后 `npx vite build --mode e2e && node scripts/prune-app-assets.mjs && npx cap sync android && cd android && ./gradlew.bat assembleSideloadDebug`。
3. `adb reverse tcp:4000 tcp:4000`：手机上的 localhost:4000 就是电脑。e2e 模式的 CSP 除了 connect-src，**img-src 也放行了 localhost**——市场 Live2D 模型的贴图是 `<img>` 载入的，不放行的话真机换装只会看到 "Texture loading error" 然后回落官方形象。debug 变体的网络安全配置（`android/app/src/debug/res/xml/`）只给 localhost 放行明文；release 一个字没动。
4. debug 包是 `com.ideahub.branchvideo.debug`，和正式包并排装，测完 `adb uninstall com.ideahub.branchvideo.debug`，不碰手机上正式版的草稿与登录态。
5. QQ/微信登录在 debug 包里不能用（按正式包名 + 正式签名注册的），用密码登录测。
