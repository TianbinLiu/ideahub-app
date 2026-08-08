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

出安装包：`npm run apk`（debug）/ `npm run apk:release` / `npm run aab`。
签名 keystore 不在仓库里，见 `android/keystore/README.md`。

## 目录

```
src/
  ai/          方舟（Seedream 生图 / Seedance 生视频 / 豆包对话）客户端与真假实现切换
  components/  通用组件
  data/        本地库（IndexedDB）与远端数据源，含种子数据与迁移
  hooks/
  pages/       路由页面（hash 路由）
  store/       zustand
public/
  create/      创作入口三张封面（角色设定的唯一出处）
  perch/       激活态角色的逐帧精灵图 + 生成流程说明
  models/      3D 模型（protected/ 下的加密产物不入仓）
```

## 约定

- **注释写"为什么"**，尤其是踩过的坑、量出来的数值、被推翻过的做法。既有代码用
  `★` 标记关键取舍，请延续。
- **依赖方向单向**：`data → store → 组件`。
- **数值不要拍脑袋**。涉及尺寸/间距/重叠的值先量再定，并在注释里写清量法与结论
  （例：`CharacterPerch` 的 `bottom` 系数调过四轮，注释里记了每一轮为什么不行）。
- 动画只动 `transform` / `opacity`（合成层）。视频流滚动时本就吃紧，触发重排会掉帧。

## 已知的坑

| 坑 | 症状 | 怎么办 |
|---|---|---|
| `.env.local` 没配 | AI 功能静默走 mock，不报错 | `cp .env.example .env.local` |
| 新 worktree 缺 `.env.local` | 同上（gitignore 不会带过去） | 手动复制 |
| `VITE_API_BASE` 指了远端 | 首页空白（本地库被跳过） | 本地开发注释掉它 |
| 方舟提示词含敏感词 | 整个请求 400，不是降级 | 见 `AGENTS.md` 本仓小节 |
| 新增数据字段没写迁移 | 老设备读到 `undefined`，静默显示 0 | 在 `src/data/videos.ts` 的迁移分支里加条件 |

## 相关文档

- [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — 从零到能跑
- [`docs/api-contract.md`](docs/api-contract.md) — 与 server 的接口契约（三仓共享）
- [`docs/play-store-checklist.md`](docs/play-store-checklist.md) — 上架检查单
- [`public/perch/README.md`](public/perch/README.md) — 角色动画资源怎么生成、踩过什么坑
