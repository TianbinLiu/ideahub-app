# 发包与应用内更新

App 目前是**侧载分发**：自己出 APK，发给别人装 —— 现在「发给别人装」有了固定的
去处：官网下载页 <https://ideahubs.org/download>（见下面「官网下载页」一节）。
这份文档说清两件事 —— 怎么发一版，以及别人装了之后怎么收到后续更新。

上架 Google Play 是另一条路，见 [`play-store-checklist.md`](play-store-checklist.md)。

---

## 两个渠道，别混

`android/app/build.gradle` 有两个 product flavor，**存在的唯一理由是自更新只能出现在侧载包里**：

| 渠道 | 出包命令 | 有 `REQUEST_INSTALL_PACKAGES` | 有自更新代码 |
|---|---|---|---|
| `sideload` | `npm run apk` / `npm run apk:release` | ✅ | ✅（`android/app/src/sideload/`） |
| `play` | `npm run aab` | ❌ | ❌（拿到的是 `src/play/` 里会 reject 的空壳） |

★ Google Play 的「设备与网络滥用」政策**禁止应用自己下载安装 APK**。所以不能写成
"上架前记得手动删掉" —— 那是一颗只在审核时才炸的雷，而那时离改动早就过去很久了。
`src/play/AndroidManifest.xml` 里还用 `tools:node="remove"` 兜了一道底，
防止哪天有人图省事把权限挪回 `src/main/`。

验证隔离有没有生效（改完 flavor 一定要跑一遍）：

```bash
aapt2 dump permissions android/app/build/outputs/apk/play/release/app-play-release.apk | grep INSTALL
```

play 渠道**不该**有任何输出。

---

## 发一版

```bash
# 1. 改 android/app/build.gradle 的 versionCode（必须 +1）与 versionName
# 2. 写这一版的更新说明（会原样显示在用户的更新弹窗里）
#    → RELEASE_NOTES.md
# 3. 出两个包
npm run apk:release        # 直装版（sideload 渠道，带自更新）
npm run aab                # 上架版（play 渠道，无自更新）
# 4. 发布 + 自检
npm run release
```

`npm run release`（[`scripts/release.mjs`](../scripts/release.mjs)）**不只是上传**，
它把"这次更新到底能不能到老用户手里"逐条查一遍，任何一条不过就当场停下：

| 查什么 | 不查会怎样 |
|---|---|
| APK 里的版本号 == 源码里的 | 改了 build.gradle 但忘了重新出包 → **发了个旧包** |
| 签名证书指纹 == 历史版本 | 换过 keystore → 老用户点更新，装到最后只说「应用未安装」 |
| versionCode > 线上那一版 | 不涨 → 所有人的更新检查都判不出有新版，**等于没发** |
| 发布**之后**再从公网拉一遍 `latest.json` | Release 被标成 draft/pre-release，或漏传 `latest.json` → 固定地址 404，客户端安静地什么都不做 |
| 清单里的 `apkUrl` 真能下、大小与 sha256 对得上 | 下完校验不过被丢弃，用户看到「更新失败」 |

★ 这五件事**互相独立、错了都不报错**，而且漏了之后**你不会知道** —— 你手上的 App 是好的，
坏的是所有已经装了旧版的人。所以它必须是脚本查，不是人记。

跑完会打印实际生效的清单地址与安装包地址，照着点一下就能确认。

## 别人装了之后怎么收到更新

1. App 启动 3 秒后（避开开屏抢带宽）由**原生层**拉一次 `latest.json`；
2. `versionCode` 比自己大就弹「有新版本」，显示版本、大小、更新说明；
3. 点「立即更新」→ 原生下载（带进度）→ 校验 sha256 → 拉起系统安装器；
4. 用户点「以后再说」的话，**这一个版本**不再打扰，出了更新的才再提。

设置页底部还有一个手动的「检查更新」。

### 用户那边会卡住的地方

| 现象 | 原因 | 界面上怎么处理的 |
|---|---|---|
| 弹窗里「立即更新」是灰的 | 没给「允许安装未知应用」授权 | 弹窗里直接给一颗按钮跳到**本应用**的那一页授权（不是设置首页——丢用户去自己找，这一步大部分人过不去） |
| 装到最后提示「应用未安装」 | 手里那版和新包**签名不同**（多半是早期的 debug 测试包） | 弹窗底部提前写了这句，让人知道要先卸载 |
| 下载完没反应 | sha256 校验没过（没下完 / 被中间人改过） | 丢弃并如实报错，留着重试 |

### 为什么清单要由原生层去拉

WebView 的 origin 是 `https://localhost`，在 Web 层 `fetch` GitHub 上的清单是**跨域**，
而 GitHub 不发 CORS 头 —— Web 层永远只能拿到一个没有细节的 `TypeError: Failed to fetch`。
原生的 `HttpURLConnection` 没有同源策略这回事，顺带把 302 跳转也一并处理了。

---

## 官网下载页

<https://ideahubs.org/download>（`ideahub-client` 的 `src/pages/DownloadPage.tsx`）。
**发一版之后这一页不用动**：版本号、大小、更新说明、sha256 全部现取自清单。

| 页面上的东西 | 从哪来 |
|---|---|
| 版本 / 大小 / 更新说明 / sha256 | `GET /api/app/latest.json`（就是上面那份清单） |
| 下载按钮、桌面端二维码 | `GET /api/app/download` → 302 到当前版本的 APK |

★ 按钮**故意不用清单里的 `apkUrl`**：那个地址带版本号
（`…/v1.7/qimeng-1.7.apk`），一旦被复制进聊天记录、印上海报或二维码就收不回来了，
下次发版所有照着它下的人拿到的还是旧包。`/api/app/download` 是不带版本号的固定地址。

★ 因此 `APP_APK_BASE` 这个换源开关现在有**两个**下游（App 的自更新 + 官网下载页），
换 CDN 时两边一起生效，仍然只改一个环境变量。

## 更新源现在长什么样

```
App（构建期常量 VITE_UPDATE_MANIFEST）        官网下载页 /download
  └───────────────┬────────────────────────────┬──┘
                  ↓                            ↓
   https://api.ideahubs.org/api/app/latest.json   /api/app/download  ← 自己的服务器，国内秒回
       └→ 转一手 + 缓存 60 秒（两个端点共用同一份缓存）
            └→ https://github.com/…/releases/latest/download/latest.json   ← 权威那份
                 apkUrl → GitHub Release 上的 95MB APK
```

**为什么清单要经服务端转一手**（`ideahub-server` 的 `src/routes/appRelease.routes.js`）：

1. **国内快**。App 每次冷启动都要拉它比版本号，直连 GitHub 常超时，而超时的后果是
   **静默的** —— 用户永远收不到更新提示，也没有任何症状可看。
2. **下载源以后能换，不用重新出包**。`VITE_UPDATE_MANIFEST` 是构建期常量，发出去就
   钉死在每个用户的包里了。清单在服务端就等于留了个开关：想把 APK 挪到 OSS/CDN，
   在服务端配 `APP_APK_BASE=https://cdn.example.com/app/`，**已经装了 App 的人下次
   检查更新就拿到新地址**。

服务端**不重算任何东西**（版本号、sha256 的唯一出处仍是发版脚本生成的那份），
上游挂了就发一天以内的旧清单而不是 5xx —— 回 502 等于让所有人再也收不到更新。

★ APK 本身仍在 GitHub。95MB 走自己的 ECS 要花出网带宽（100 人各更新一次 ≈ 9.6GB），
值不值得看用户量；要搬的时候按上面那个开关来，App 侧一行都不用动。

## 这套**盖不到**什么

自更新换的是整个 APK，所以原生改动（新插件、权限、图标、targetSdk）它都盖得到。
盖不到的只有一件事：**用户不点「立即更新」**。

如果想要"打开就是新的、完全无感"，那是另一套东西（热更新 web 包，只换 dist 里的
JS/CSS/图，不换原生）。当时评估过，没做 —— 它盖不了原生改动，等于要同时维护两套
更新通道，而现在这套已经够用。真要做再说。
