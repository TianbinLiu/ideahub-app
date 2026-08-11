# ideahub-app · 分支视频

IdeaHub 的视频平台 App（Web 形态，后续可用 Capacitor 打包 iOS/Android 壳）。核心是**卡片工坊**——把 AI 视频生成管线具象为一场 3D 桌面卡牌游戏，以及标准视频平台页面（首页 / 播放页 / 详情 / 评论 / 发布）。互动分支播放为后续核心功能（规划中）。

## 技术栈

- React 19 + TypeScript + Vite 7 + Tailwind 3.4（与 ideahub-client 同代）
- three.js + @react-three/fiber（3D 卡牌桌）
- zustand（工坊状态机）
- 路由 HashRouter（便于静态托管与壳打包）

## 卡片工坊（/studio）

3D 长桌场景，固定机位只露出双方手部/上身与桌面（NPC 无头部建模）：

- **NPC 铸卡师**：右侧对话面板。上传本地文件（图片作真实卡面、txt/md 读内容）+ 补充说明 → 炼成类型化卡片（人物/场景/背景/道具/风格），飞入左下角**卡组**（空组只剩虚位标记）。
- **市场**：NPC 从口袋摊开一排社区热卡（扑克式），对话框输入词即搜索刷新；点卡推镜 + 详情窗（左预览/右信息）→ 加入卡组。
- **节点链**：点击虚线空白卡位 → 卡组在下方展开（箭头翻页，可拖拽卡片到卡位）+ 节点编辑窗（预览图 / 按类型的素材槽 / 视频要求 / 时长 AI 定或自定义）→ 推演**三套方案**，摊成**方案台**（一行一套：左边首尾帧卡两帧渐变轮播，右边小说式剧情）。挑定一套后它放大居中、其余缩小；选定的那套可以换首尾帧（上传本地图）、逐字改剧情，改完让 AI 按修改重画画面，也可以整台重新推演。
  **必须炼出本段视频，右侧才会亮出下一段的虚线卡位**——段与段靠上一段的**真实尾帧**承接起拍，攒着最后一起炼会让衔接断掉，第 1 段人物不对也要等铺完五段才发现。下一段生成以**整条已选路径**为上下文。重选其它方案会收起原方案的后续子树（切回可恢复）。超出桌宽的最早节点自动收到左侧堆。
- **合成**：中线右端法阵（每段都出片后才点亮）→ 铺成工作流 → 剪辑页 → 编辑发布页（标题/分类/简介/从各段首尾帧选封面）。

## 三个创作入口（/create）

同一条流水线的三个入口，共用同一份出片（挂在 `Proposal.videoUrl` 上）与同一套「炼一段」实现（`studio/segmentGen.ts`）：

| 入口 | 方案台 | 草稿 |
|---|---|---|
| 工坊模式 `/studio` | 有（3D 桌面上的投影面板） | 有 |
| 工作流模式 `/flow` | 有（一屏一段，中间那块大屏幕） | 有 |
| 简约模式 `/flow?simple` | 无（写一句话直接出片） | **无**——一段几十秒就出片、直通发布，没有"回来接着做"的状态 |

方案台组件两边共用：`src/studio/ui/PlanBoard.tsx`。

## mock 管线说明

当前 AI 生成为本地 mock（接口形状按未来 server 端点设计，全部 async + 延迟）：

- 剧情：三种走向模板（顺势推进/风云突变/柳暗花明）组合素材名、视频要求与路径上下文
- 首尾帧：canvas 种子画（`src/mock/frames.ts`），同种子恒等，色调链保证段间承接
- 播放器：`SegmentPlayer` 用首帧→尾帧渐变 + 轻推镜头模拟分段播放；接真实视频生成后换 `<video>` 即可

替换点集中在 `src/mock/ai.ts`（→ server API）与 `src/data/videos.ts`（localStorage → server API）。

## 3D 资产

`public/models/study/` 来自 [Poly Haven](https://polyhaven.com)（**CC0**，商用免署名）：哥特书柜/五斗柜、黄铜烛台、古董提灯、高脚杯、精装书组、木桶等扫描模型（1k 贴图），以及 `castle_brick_07` 石墙、`dark_wooden_planks` 木地板 PBR 贴图和 `dikhololo_night` 夜景 HDRI。魔法书房场景在 `src/studio/scene/MagicStudy.tsx` 布置；NPC 人物计划换为 VRoid Studio 定制 VRM（待人物设定图）。

## 开发

```bash
npm install
npm run dev    # http://localhost:5178
npm run build
```

DEV 模式暴露 `window.__studio`（zustand store）供 E2E 驱动。

## 已知边界（后续版本）

- 互动分支播放（观众侧选分支）——等产品细节
- 长片树图浏览（左右堆展开导航）
- 接真实视频/图像生成 API 与 ideahub server（账号/赏金/卡片市场共享）
- 移动端触控优化与 Capacitor 打包
