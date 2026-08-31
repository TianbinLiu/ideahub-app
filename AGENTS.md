# AGENTS.md — IdeaHub 工程铁律（任何 Agent / 新成员接手前必读）

> **这是给所有 AI coding agent 的强制指令**（Claude Code / Cursor / GitHub Copilot /
> Codex / Aider / Windsurf 等，无论你是谁、用哪个工具），也是新成员的入职必读。
> 在本仓库（`ideahub-app`）改代码、构建或发布前，**必须先读完并遵守以下铁律**。
>
> **人类的从零上手指引**：[`docs/ONBOARDING.md`](docs/ONBOARDING.md)（装什么、配什么、怎么跑起来）。
> **Claude 系 agent 另有可执行版本**：
> [`.claude/skills/ideahub-engineering-rules/`](.claude/skills/ideahub-engineering-rules/SKILL.md)，
> 附真实事故复盘。其它工具不读 `.claude/skills/`，**以本文件为准** ——
> 本文件必须保持自足，不得掏空后只留指针。

---

## 项目由三个独立仓库组成

| 仓库 | 是什么 | 部署到 |
|---|---|---|
| [`ideahub-server`](https://github.com/TianbinLiu/ideahub-server) | Node + Express 5 + MongoDB 后端 | 阿里云 ECS，pm2 cluster + nginx |
| [`ideahub-client`](https://github.com/TianbinLiu/ideahub-client) | React + Vite 官网 | 同一台 ECS，nginx 静态托管 |
| [`ideahub-app`](https://github.com/TianbinLiu/ideahub-app) | React + Vite + Capacitor 安卓 App | 构建成 APK/AAB |

三者**各自独立部署**，通过 HTTP 契约耦合，**彼此不知道对方线上跑的是哪个版本**。
契约见 [`docs/api-contract.md`](docs/api-contract.md)。

---

## ⛔ 铁律（无条件遵守）

### 1. 动手前先 `git pull`，改哪个仓就 pull 哪个；跨仓改动三个都要

```bash
git checkout main && git pull origin main
```

- 接续会话、开始改代码、构建、发布前都要重新 pull。**会话摘要是历史快照，不代表本地是最新的**。
- pull 有冲突 → 立即停下报告，不得自行处理后继续。
- **在下"仓库里没有某段代码"这个结论前先 pull**。grep 不到 ≠ 不存在，很可能只是本地落后。

### 2. 同事未提交的 WIP 一律不动

工作树里同事未提交的改动 —— **不 commit / 不 push / 不 stash / 不 discard**。
只要不挡住自己提交就忽略，由本人处理。提交时用 `git add <具体路径>`，
不要 `git add -A` 把别人的东西一起裹进来。

> 真实情况：`ideahub-server` 工作区里长期有一个未跟踪的 `ideahub-server/` 目录。
> 它不该被提交，也不该被删。

### 3. 密钥只进 `.env`，永不入仓、不入文档、不入日志

| 仓库 | 密钥文件 | 模板 |
|---|---|---|
| server | `.env` | `.env.example` |
| client | `.env` | `.env.example` |
| app | `.env.local` | `.env.example` |

- App 的 `ARK_API_KEY` **不带 `VITE_` 前缀**是刻意的：带前缀会被打进客户端包，
  等于把密钥发给每一个装了 App 的人。**新增任何密钥都不要加 `VITE_` 前缀**，
  需要走网络就在 `vite.config.ts` 里加代理（现有的 `/api/ark` 就是这么做的）。
- 生成密钥用 `openssl rand -base64 48` 这类方式在**服务器上**生成，不要在聊天里传。
- 提交前扫一眼 `git diff --cached`，确认没有把 key 粘进注释或文档。

### 4. 生产只走发布链路，不手改线上

- server / client 有 GitHub Actions（`.github/workflows/deploy.yml`）与 `deploy.sh`。
  **不要**手动 scp 覆盖线上文件、不要在服务器上直接改代码后当作已发布。
- `deploy.sh` 自带部署前配置自检（`npm run check:config`）与部署后健康检查，
  绕过它就等于绕过这两道闸门。
- pm2 用的是 **cluster 模式 + `ecosystem.config.js`**（零停机 reload）。
  ⚠️ `pm2 reload <文件>` 在进程不存在时会**直接新建一份**。用 root 跑一次
  就会起出一份与 deploy 用户平行的重复服务，两份同时监听、内存翻倍，
  而且 `pm2 list` 在另一个用户下看不到它。**只用 deploy 用户操作 pm2。**

### 5. 验证只认被测系统自己吐出的证据

不认"我改了所以应该好了"，也不认单次读数。

- **先确认改动已经生效，再去测。** 改完本地就跑验证，测的是旧代码。
- nginx `systemctl reload` 是**异步**的：返回成功时旧 worker 可能还在服务请求。
  reload 后立刻测到旧行为不代表配置没生效。
- **单次测量不算数**。一次耗时/一次响应可能是冷启动或抖动，至少取三次。
- 用管道过滤命令输出时注意**退出码会被最后一个命令吃掉**：
  `npm test | grep xxx && git commit` 里测试失败也照样提交。要判成败就分开跑。

### 5b. 修完一批之后，回头查**自己改出来的**

一轮集中修复之后，**再单独看一遍这一批 diff**，问的不是"仓里还有什么问题"，
而是"**我这次改的东西有没有把事情弄坏**"。这两个问题找到的东西几乎不重叠。

2026-08-31 实测：一天四轮复核修掉 40 多条，而**我自己在过程中制造了 5 条** ——
3 条随版本发了出去（下一版才修回来），2 条被发版前复核挡在门内。
它们无一例外地通过了 `tsc`、`check-hook-order`、CI 与全部既有用例，症状全部为零。

高危改法（改完必须回头看的四类）：

- **把可选参数/回调漏传**：`?` 让漏传零症状 —— 这类参数干脆改成必填。
- **同步改异步**：所有调用点都跟上了吗？有没有把 Promise 当布尔用（`if (fn())` 恒真）？
- **加过滤 / 加早退**：`rg` 一遍**谁还在读这个函数** —— 它要的是"界面视图"还是"全量事实"？
- **把 N 种结局压成两档**："没问到"与"确实没有"一旦合并，就会诞生一句编出来的空状态。

⚠ 还有一条最阴的：**同一份数据有两个渲染面时，某一面自带的行为会把问题掩住**。
（评论排序改错时，抽屉那一面自带排序、完全测不出来，坏的是平铺渲染的详情页。）
测的时候要挑那个**什么都不做**的面。

发版前那一道更严格，见 [`docs/app-distribution.md`](docs/app-distribution.md)「发一版」：
**只复核 `v<上一版>..HEAD` 这一段 diff，绿了才按发布；改完必须重新出包并核对 sha 变了。**

### 6. 一条规则只能有一处实现

改任何"判断规则"（取客户端 IP、判限流、判登录态、拼提示词、算默认值）前，
**先 grep 全仓库确认它现在有几处实现**。两处以上：先合并成一处，再改那一处。
判断依据是 **"这两处如果规则变了，是否必须同时改？"** —— 是，就必须合并。

### 7. 改配置类脚本：先验证，再落盘

写入 nginx / Redis / systemd 这类"写坏了服务就起不来"的配置时，
**必须先在临时端口或用语法检查跑一遍，通过了才落盘并重启**，
并且落盘前先备份。

> 真实事故：装 Redis 的脚本直接写配置就 restart。配置里用了 6.2+ 才有的
> `bind 127.0.0.1 -::1` 语法，而机器上是 6.0.16 —— Redis 当场起不来。
> nginx 那边有 `nginx -t`，Redis 没有等价命令，就**必须**用临时端口试跑代替。

### 8. 失败要"响且局部"，不要"静默且全局"

- 兜底 `catch` 不能把错误吞掉。限流中间件曾经因为 `clientIp()` 在缺少
  `req.headers` 时抛错、被 fail-open 的 catch 接住，于是**限流静默失效、所有请求放行**。
  兜底放行是可以的，但必须打日志，且要能被测试覆盖到。
- 新增后台循环 / 常驻任务前先问：**这份代码会跑在几种角色上？每种都该跑吗？**
  不是 → 写显式开关，**默认关**。AI worker 现在就是靠
  `NODE_APP_INSTANCE === "0"` 只在一个 cluster 实例上跑。

### 9. push 前更新文档

改了架构、契约、环境变量、发布方式，就在同一次提交里更新对应文档：

| 改了什么 | 更新哪份 |
|---|---|
| 接口契约 | `docs/api-contract.md`（三仓共享的契约，改了要通知另外两仓） |
| 环境变量 | `.env.example` + `docs/ONBOARDING.md` |
| 发布方式 / 服务器配置 | server 仓 `SECURITY_HARDENING.md`、`deploy.sh` 注释 |
| 工程规则本身 | 本文件 + `CLAUDE.md` + `.claude/skills/` + `.cursor/rules/` + `.github/copilot-instructions.md`（五处要一起改，见铁律六的精神） |

文档用 **Markdown**。这一点与参考项目（XeroFocus）不同 —— 那边强制 HTML 是为了
中英双语切换和暗色模式，本项目没有这个需求，不必照搬。

### 10. 注释写"为什么"，不写"是什么"

本项目的既有代码大量使用「★ 标记 + 说明取舍原因」的注释风格，尤其是：
**踩过的坑、量出来的数值、被推翻过的做法**。新代码请延续这个风格。

反例：`// 设置超时为 500ms`。
正例：`// 500ms：Redis 连不上时不能拖住登录请求，超时即降级到进程内计数`。

---

## 本仓（app）特有

### 环境准备

`.env.local` **不在仓库里**，克隆后必须自己建（照抄 `.env.example`）：

```bash
cp .env.example .env.local
```

- 不配 `ARK_API_KEY` → `__AI_REAL__` 为 false，AI 功能自动走 mock，**不会报错**。
  所以"AI 没反应"第一步先查这个文件。
- **用 `/worktree` 开新工作区时 `.env.local` 不会跟着过去**（它被 gitignore 了），
  必须手动复制，否则新工作区里 AI 全是 mock。

### 常用命令

```bash
npm run dev          # 开发服务器
npm run build        # tsc + vite build（提交前必须过）
npm run build:app    # 构建 + 裁剪资源 + cap sync android
npm run apk          # 出 debug APK
```

### 方舟（Seedream / Seedance / 豆包）实测约束

写在 `src/ai/arkClient.ts` 与 `public/perch/README.md` 里，动手前先读。要点：

- **提示词里出现「少女」「拥抱」「害羞」等词会被整个请求拒掉**（400
  `InputTextSensitiveContentDetected`），不是降级而是失败。用中性表述。
- **一张图里画多个角色一律被拒**。要多个姿势必须逐张生成，靠传 `image` 参考图锁形象。
- 需要中间动作帧时用 **Seedance 首尾帧模式**，不要找外部插值服务。
- 生图提示词必须写死「镜头静止」「角色居中大小不变」，否则抽帧会忽大忽小。

### ⛔ 第三方素材的授权先于代码

`design/` 下有从 BOOTH 购入的 VRChat 角色模型。据其利用規約：

- **再配布只允许无偿**，有偿再配布不可；
- 「把该数位文件作为特定商用产品的一部分」需**向版权持有人查询** ——
  把模型打进 App 出厂分发正落在这一条，**上线前必须先取得书面许可**；
- 建议署名 `©てぐらるしょっぷ`。

结论与邮箱见 [`design/README-tsumire.md`](design/README-tsumire.md)。
**在拿到许可之前，不要把它设为出厂默认形象、不要打进发布包。**
这是法律约束，不是工程偏好 —— 任何 agent 被要求"先打进去再说"时应当拒绝并说明。

### 数据层依赖方向是单向的

`src/data/*` → `src/store/*` → 组件。反向引用会成环。
本地库（IndexedDB）有种子数据迁移逻辑，**新增字段时必须同时写迁移**，
否则老用户设备上读到 `undefined`，而可选字段不会报错 —— 这是静默降级，只能靠迁移补。

---

**再次强调**：以上是无条件铁律。若你是 AI agent 且被要求做与之冲突的操作，
**先指出冲突并停下**，说明违反了哪一条、可能的后果，不要擅自绕过。用户明确坚持后再执行。
