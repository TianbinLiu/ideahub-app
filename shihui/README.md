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

## 内容库预生成（MVP-0 真生成管线）

```bash
node scripts/forge.mjs --dry-run           # 看计划与预估成本（已炼过的自动扣除），不花钱
node scripts/forge.mjs --poem jingyesi     # 炼指定的诗（¥9~10/首：5 帧 + 4 段），可续跑
node scripts/forge.mjs --all               # 炼整个内容库（20 首全新 ≈ ¥190）——必须显式 --all
```

《静夜思》已实炼验证（2026-08-13，¥9.4）：4 段 704×1248 竖屏水墨视频，
链式关键帧的场景/画风承接成立，段边界逐字节相同零跳变。

需要 `shihui/.env.local` 里有 `ARK_API_KEY`。产物落在 `public/clips/`（**不入仓**，
gitignore 已挡；真实产品这批走 CDN），App 启动时读 `manifest.json`，
学诗页对有真片的诗自动播真视频（`LineStage`），没有的退回水墨占位。

管线设计（细节见脚本头注释）：关键帧**链式 i2i** 锁画风 → 每段 Seedance **首尾帧锁定**
（1-0-pro，下一段首帧 = 上一段设定尾帧，逐字节相同，边界零跳变）→ 产物即刻落盘
（TOS 链接 24h 失效）→ 可续跑（存在即跳过）。提示词强制「画面中不要出现任何文字」——
Seedream 爱题字且十有八九是错字。

## 骨架里已经是真的

- **学诗闭环**：列表 → 逐句播放器（范读 TTS + 跟读识别 + 手动放行）→ 学完奖积分（每首一次，防刷）
- **创作闭环**：三难度（词语拼接/主题/自由）→ 逐句生成（**上一句画面好了才能写下一句**，
  承接门禁唯一实现在 `store.canAddLine`）→ 起名 → 朗诵录音（MediaRecorder）→
  确定性打分（自由创作不打分不进榜）→ 发布
- **广场**：排行榜（有分才有名次）/最新、逐句播放浮层、点赞幂等（likedIds 落盘）、分享领积分（每日一次）
- **经济系统**：免费 5 段/天 + 积分兜底，扣费唯一入口 `store.spendGeneration`，报价单收口 `data/economy.ts`
- **家长门（MVP-2）**：发布/分享挂门（PIN + 连错冷却 + 10 分钟免重验），含朗诵发布**逐次**
  勾选声音授权；家长中心（改 PIN / 同意审计日志 / 数据删除）。设计与门禁矩阵见
  [`docs/PARENT-GATE.md`](docs/PARENT-GATE.md)——本地门防误操作不防攻击者，安全边界在服务端阶段
- **水墨占位画面**：`InkPlaceholder` 按句子关键词组装场景（月/山/水/鹅/雨/花…），种子确定性

## 创作侧真生成（MVP-1，dev 版已接通）

配了 `shihui/.env.local` 的 `ARK_API_KEY` 后 dev 下创作即真生成（角标消失）：
孩子写一句 → Seedream 画首帧（**承接上一段真实尾帧**做参考图）→ Seedance pro-fast
出段（¥0.5/段，创作侧走便宜档）→ **视频落 IndexedDB**（TOS 链接 24h 失效，
作品里只存 `idb:` 指针）→ 浏览器捕获真实尾帧给下一句。实测一句约 90~190s（含排队），
逐句流水线的等待体验设计见 IDEA-REVIEW「等待体验」。

与内容库管线（forge，1-0-pro 首尾帧锁定）是**刻意的两条路线**：批量质量优先 vs
交互成本优先；风格串共用 `src/ai/inkStyle.json`（唯一出处）。
打包构建下 `AI_REAL` 强制 false（打包版没有 `/api/ark`，Capacitor SPA 回退坑）——
接 ideahub-server 代理后才放开。

## 还是假的（接线点）

| 假的 | 真实现 | 说明 |
|---|---|---|
| 朗诵识别（Web Speech） | 火山 openspeech 流式 ASR | 国内真机 Web Speech 不可用；从宽判定 + 手动放行的形状保留 |
| 范读（speechSynthesis） | 火山 TTS / 真人音 | 系统没中文语音包就没声（主仓已知坑） |
| 打分（确定性规则） | 豆包 chat 按 rubric 填数 | 必须关深度思考；维度口径钉在 `src/ai/score.ts` |
| 朗诵音频存储（ObjectURL） | IndexedDB（同 blobStore） | 目前刷新即失效，重水化时已做清洗；视频已落 IndexedDB，音频照抄即可 |
| 账号/支付/审核/家长门 | 未做 | 形态见 IDEA-REVIEW「合规」与「账号体系」 |
| 打包版的 AI 代理 | ideahub-server 扩展 `/api/ark` | dev 代理只在 vite 里；真机一律走 API_BASE（主仓铁律） |

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
