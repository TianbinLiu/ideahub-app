# 诗绘（工作名）—— 诗词视频教育 App 骨架

每句诗一段水墨画面：**念出这一句，才走进下一句**；孩子逐句写诗，AI 逐句画出来，
朗诵后发布，家长分享。产品全案与查漏补缺见 [`docs/IDEA-REVIEW.md`](docs/IDEA-REVIEW.md)（先读这份）。

本目录是**独立可跑的骨架工程**，与 ideahub-app 主工程互不依赖（各有各的 package.json），
放在同仓只为评审方便；将来独立成仓直接整目录搬走。

## 跑起来

```bash
cd shihui
npm install
npm run dev        # http://localhost:5174
```

`npm run build` = `tsc && vite build`，提交前必须通过（与主仓同规矩）。
不配 `.env.local` 就是**演示模式**（右上角有角标）：画面是水墨占位动画，非真视频。

## 骨架里已经是真的

- **学诗闭环**：列表 → 逐句播放器（范读 TTS + 跟读识别 + 手动放行）→ 学完奖积分（每首一次，防刷）
- **创作闭环**：三难度（词语拼接/主题/自由）→ 逐句生成（**上一句画面好了才能写下一句**，
  承接门禁唯一实现在 `store.canAddLine`）→ 起名 → 朗诵录音（MediaRecorder）→
  确定性打分（自由创作不打分不进榜）→ 发布
- **广场**：排行榜（有分才有名次）/最新、逐句播放浮层、点赞幂等（likedIds 落盘）、分享领积分（每日一次）
- **经济系统**：免费 5 段/天 + 积分兜底，扣费唯一入口 `store.spendGeneration`，报价单收口 `data/economy.ts`
- **水墨占位画面**：`InkPlaceholder` 按句子关键词组装场景（月/山/水/鹅/雨/花…），种子确定性

## 还是假的（接线点）

| 假的 | 真实现 | 说明 |
|---|---|---|
| 画面生成（1.5~3s 假延迟） | 方舟 Seedream+Seedance | 抄 ideahub `segmentGen`，坑全列在 `src/ai/real.ts` 注释里 |
| 朗诵识别（Web Speech） | 火山 openspeech 流式 ASR | 国内真机 Web Speech 不可用；从宽判定 + 手动放行的形状保留 |
| 范读（speechSynthesis） | 火山 TTS / 真人音 | 系统没中文语音包就没声（主仓已知坑） |
| 打分（确定性规则） | 豆包 chat 按 rubric 填数 | 必须关深度思考；维度口径钉在 `src/ai/score.ts` |
| 存储（localStorage） | IndexedDB + 服务端 | 朗诵音频目前刷新即失效，重水化时已做清洗 |
| 账号/支付/审核/家长门 | 未做 | 形态见 IDEA-REVIEW「合规」与「账号体系」 |

## 目录

```
src/
  types.ts        领域模型：诗-句-段三层；mock: 前缀约定与 realClip()
  data/           poems 种子内容库+主题词库 · economy 报价单 · store 状态与防刷收口
  ai/             mock/real 切换 · recite 朗诵(ASR/TTS/判定) · score 打分 rubric
  components/     InkPlaceholder 水墨占位 · TabBar
  pages/          LearnList/LearnPlayer · ComposeHome/ComposeSession · Feed · Me
docs/IDEA-REVIEW.md   产品全案：逐条评审、合规、单位经济、MVP 切法
```

沿用主仓铁律：依赖单向 `data → store → 组件`；一条规则一处实现（承接门禁、扣费、防刷）；
动画只动 transform/opacity；失败要响且局部。
