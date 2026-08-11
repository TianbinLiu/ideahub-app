# 发包与应用内更新

App 目前是**侧载分发**：自己出 APK，发给别人装。这份文档说清两件事 ——
怎么发一版，以及别人装了之后怎么收到后续更新。

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

## 发一版的完整流程

### 1. 涨版本号

`android/app/build.gradle`：

```groovy
versionCode 3      // 必须 +1。Android 只认这个整数判新旧
versionName "1.2"  // 给人看的
```

**`versionCode` 不涨 = 所有人的更新检查都判不出有新版**，这是最容易漏的一步。

### 2. 出包

```bash
npm run apk:release
```

产物：`android/app/build/outputs/apk/sideload/release/app-sideload-release.apk`

★ 必须是 **release** 包，用 `android/keystore/` 里那把固定的密钥签名。
debug 包和 release 包签名不同，**互相覆盖不了** —— 用户会看到「应用未安装」，
而那个提示完全看不出原因，只能先卸载。所以：**发给别人的永远只发 release 包**。

### 3. 算 sha256

```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))" <apk 路径>
```

### 4. 发 GitHub Release

```bash
gh release create v1.2 <apk> latest.json --title "启梦 1.2" --notes "..."
```

`latest.json` 的格式：

```json
{
  "versionCode": 3,
  "versionName": "1.2",
  "apkUrl": "https://github.com/TianbinLiu/ideahub-app/releases/download/v1.2/qimeng-1.2.apk",
  "sizeBytes": 59116950,
  "sha256": "……",
  "notes": "这一版改了什么，会原样显示在更新弹窗里"
}
```

App 拉的是 `…/releases/latest/download/latest.json` —— 这个地址**永远指向最新一版**，
所以每次发版只要传一个同名的 `latest.json` 上去，代码和配置都不用动。

---

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

## 用户在国内、GitHub 太慢怎么办

把 `latest.json` 和 APK 换到自己的服务器上（`ideahubs.org` 在阿里云 ECS，国内快得多），
然后改 `.env.production` 的这一行：

```
VITE_UPDATE_MANIFEST=https://ideahubs.org/app/latest.json
```

格式不变。改完要重新出包才生效（它是构建期常量）。

---

## 这套**盖不到**什么

自更新换的是整个 APK，所以原生改动（新插件、权限、图标、targetSdk）它都盖得到。
盖不到的只有一件事：**用户不点「立即更新」**。

如果想要"打开就是新的、完全无感"，那是另一套东西（热更新 web 包，只换 dist 里的
JS/CSS/图，不换原生）。当时评估过，没做 —— 它盖不了原生改动，等于要同时维护两套
更新通道，而现在这套已经够用。真要做再说。
