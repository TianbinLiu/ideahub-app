# android/app/libs/ —— 手工入仓的第三方 jar

这个目录里的 jar 经 `android/app/build.gradle` 的 `fileTree(include: ['*.jar'])` **原样进包**，不经任何仓库、没有校验和下载过程。
所以每一个都要在下面这张表里记清它从哪下的、哪天下的、sha256 是多少 —— 不然换机器出的包与发出去的那份是不是同一份、
文件有没有被换过，谁都答不上来；而这里躺着的恰恰是处理**登录**的那段代码。

| 文件 | 来源 | 下载 / 入仓日期 | sha256 |
|---|---|---|---|
| `open_sdk_3.5.19_r9483ffc7_lite.jar` | QQ 互联「SDK 下载」页 <https://wiki.connect.qq.com/sdk%E4%B8%8B%E8%BD%BD>（Android SDK，lite 版） | 2026-08-23（commit `201a6037`：QQ 登录走原生 SDK） | `9d57fe61ff9026d34ac84bc63dc719f61da6aa40533a299cc6f73d4ce9df7af8` |

★ **这张表是机读的**（2026-10-15 教材人格评审，humble-delivery-8）：`scripts/release.mjs` 第 2d 步（`scripts/lib/app-package.mjs`
的 `jarProvenance`）拿目录里每个 `*.jar` 对这张表 —— 文件名与 sha256 两格要用反引号包着；表里没有的 jar、sha256 对不上的 jar
都当场停发。换 SDK 版本的步骤：下载 → `sha256sum <jar>` → 改表（文件名、日期、sha256 三格）→ 删旧 jar。

★ 微信 SDK 不在这里：它走 Maven（`com.tencent.mm.opensdk:wechat-sdk-android`），由 gradle 按坐标取、有仓库校验；
QQ 互联只给 jar 下载、没有 Maven 坐标，才落在这个目录。
