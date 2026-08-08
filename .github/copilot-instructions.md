# GitHub Copilot 指令 — IdeaHub 工程铁律

接手本仓库（`ideahub-app`）改代码、构建或发布前必须遵守以下铁律。
完整版见根目录 [`AGENTS.md`](../AGENTS.md)（唯一正本），项目上下文见 `CLAUDE.md`。

1. **动手前先 `git pull`**；跨仓改动三个仓库都要（server / client / app）。冲突立即停下报告。断言"代码库里没有 X"之前也要先 pull。
2. **同事未提交的 WIP 一律不动**（不 commit/push/stash/discard）。提交用 `git add <具体路径>`，不要 `git add -A`。
3. **密钥只进 `.env` / `.env.local`**，永不入仓、不入文档、不入日志。App 侧新增密钥**不要加 `VITE_` 前缀**——带前缀会被打进客户端包发给每个用户；要走网络就在 `vite.config.ts` 加代理。
4. **生产只走发布链路**（GitHub Actions / `deploy.sh`），不手改线上、不绕过部署前配置自检与部署后健康检查。pm2 只用 deploy 用户操作。
5. **验证只认被测系统吐出的证据**：先确认改动已生效再测；nginx reload 是异步的；单次测量不算数；不要把断言塞进管道（退出码会被 grep 吃掉）。
6. **一条规则只能有一处实现**。改判断逻辑前先 grep 全仓确认有几处；两处以上先合并。
7. **改 nginx/Redis/systemd 这类配置：先验证再落盘**（没有校验命令就用临时端口试跑），并先备份。
8. **失败要响且局部**：兜底 catch 不能吞错误；新增后台任务必须有显式开关且默认关。
9. **push 前更新文档**：契约改了更新 `docs/api-contract.md`，环境变量改了更新 `.env.example` 与 `docs/ONBOARDING.md`。
10. **注释写"为什么"**，尤其是踩过的坑、量出来的数值、被推翻过的做法。

App 特有：`.env.local` 不在仓库里，克隆后必须 `cp .env.example .env.local`，
否则 AI 功能静默走 mock。方舟提示词含「少女」「拥抱」等词或要求一张图多个角色会被 400 拒绝。

若被要求做与铁律冲突的操作，先指出冲突并停下，不要擅自绕过。
