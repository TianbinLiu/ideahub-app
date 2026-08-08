# 新成员上手 — ideahub-app

目标：**装好工具 → 克隆 → 能跑起来 → 能提交**。全程约 20 分钟。

工程铁律在 [`../AGENTS.md`](../AGENTS.md)，**第一天就要读完**，它是所有 AI agent
和人共同遵守的那份。

---

## 1. 装什么

| 工具 | 版本 | 备注 |
|---|---|---|
| Node.js | 20 LTS 或更高 | `node -v` |
| Git | 任意近版 | |
| Claude Code | 最新 | `npm i -g @anthropic-ai/claude-code`，或用桌面版 |
| Android Studio | 仅出安装包时需要 | 只改前端可以不装 |

Claude Code 会自动读取仓库根目录的 `CLAUDE.md` 与 `AGENTS.md`，
所以**克隆完直接在仓库里开 `claude` 就带着项目规则**，不需要额外配置。

Cursor / GitHub Copilot 用户同理：`.cursor/rules/` 与 `.github/copilot-instructions.md`
已经在仓库里，装好插件即可。

## 2. 克隆并安装

```bash
git clone https://github.com/TianbinLiu/ideahub-app.git
cd ideahub-app
npm install
```

## 3. 配环境变量（这一步不能跳）

```bash
cp .env.example .env.local
```

然后按 `.env.example` 里的说明填。**至少要问团队要 `ARK_API_KEY`** ——
不填不会报错，AI 相关功能会静默走 mock，你会以为"功能坏了"。

⚠️ `.env.local` 被 gitignore，**永远不要提交它**，也不要把 key 贴进聊天或文档。

## 4. 跑起来

```bash
npm run dev
```

打开 http://localhost:5173。看到全屏视频流 + 底部导航栏就对了。

首页是空的？多半是 `.env.local` 里 `VITE_API_BASE` 指向了远端服务。
本地开发把它注释掉，走本地 IndexedDB 种子数据。

## 5. 提交前

```bash
npm run build     # tsc + vite build，必须通过
```

提交信息用中文，说清**为什么这么改**，不只是改了什么。
可以参考仓库里已有的 commit —— 会写清楚"推翻了什么做法、量出了什么数据"。

按铁律二：用 `git add <具体路径>`，不要 `git add -A`。

## 6. 出安装包（可选）

```bash
npm run apk           # debug APK
npm run apk:release   # release APK（需要签名 keystore）
npm run aab           # 上架用的 AAB
```

keystore 与口令不在仓库里，见 `android/keystore/README.md`。

---

## 另外两个仓库

要改后端或官网时另外克隆，各自也有同样的 `AGENTS.md` / `CLAUDE.md` / `docs/ONBOARDING.md`：

```bash
git clone https://github.com/TianbinLiu/ideahub-server.git
git clone https://github.com/TianbinLiu/ideahub-client.git
```

三者独立部署、通过 HTTP 契约耦合。改接口时**三边的文档都要同步**，
契约正本是各仓的 `docs/api-contract.md`。

---

## 第一天建议读的

1. [`../AGENTS.md`](../AGENTS.md) — 铁律，必读
2. [`../CLAUDE.md`](../CLAUDE.md) — 目录结构、约定、已知的坑
3. [`api-contract.md`](api-contract.md) — 接口契约
4. [`../public/perch/README.md`](../public/perch/README.md) — 一个完整的"资源怎么生成 +
   踩了哪些坑"的样例，能看出本项目期望的文档颗粒度

## 卡住了怎么办

先看 `CLAUDE.md` 的「已知的坑」表。不在表里、并且你解决了 ——
**把它补进那张表再提交**，这是铁律九。
