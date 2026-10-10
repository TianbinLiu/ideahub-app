// 这一包的版本「<versionName>+<versionCode>」（如 2.63+75、debug 包 2.63-debug+75）—— 请求头 X-App-Version 的值
// （只发给自家服务器 /api/ 下，判定在 api/client.withAppVersion）。
//
// ★★ 两个来源，**装在手机上的那一包优先**（2026-10-10 评审改）：
//   ① 原生：@capacitor/app 的 App.getInfo（读 PackageManager）—— 就是装着的这个包自己报的版本，debug 包带着 build.gradle 的
//     versionNameSuffix（"2.63-debug"）；先出前端包、后涨 build.gradle 再直接跑 gradlew 的那种包，报的也是 APK 自己的号。
//   ② 构建期常量 __APP_VERSION__（vite.config.ts 的 appVersionFromGradle，读 build.gradle 的 defaultConfig）—— 兜底：
//     浏览器里（npm run dev，没有原生可问）、原生没问到 / 回得太慢的那几发。
//   原来只有 ②，并在注释里说「发版脚本拿 APK 的版本号与 gradle 比过，所以头上的就是装着的那一包」—— 那一道只比了 APK 与 gradle，
//   从没看过前端包里烤进去的那个数；debug 包也永远报不出 -debug（服务端契约举的例子正是 `2.63-debug+75`）。
// ★ 原生那一问是异步的，而开机第一发请求（探活、读作品库）就要带上版本 —— 所以 main.tsx 在加载 App 之前、与激活语言**并排**等它
//   （adoptInstalledAppVersion：最多等 INSTALLED_WAIT_MS，绝不抛；激活语言本来就要等一个目录分片，多数时候一毫秒都不多等）。
//   等超时了也不放弃：回包晚到照样换上，只是开机那几发带的是 ②。
// ★ 这个头**只进服务端日志**（例：哪些版本还在发方舟下线了的出图 id —— 决定接班表与老价目什么时候能删）。服务端**不拿它**放行 / 计价 /
//   门禁：头是客户端写的、谁都能伪造，2.62 及以前的包一个都不带；改发与结算认的是请求体里的模型 id（docs/api-contract.md「请求头 X-App-Version」）。
//   所以报错版本的代价是日志认错版本，不是钱、也不是功能 —— 但日志正是用来定「老东西什么时候能删」的，所以还是要报对。
// ★ 零依赖（原生那两个包在函数里动态 import）：main.tsx 开机时就要它，而那时业务模块一个都不该先求值（理由见 main.tsx 的 ★★）。

declare const __APP_VERSION__: string;

/** 构建期那一个（②）。Node 直接跑的构建检查脚本里没有这个常量 → 空串（那里不发请求） */
const BUILT: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";

/**
 * versionName / versionCode 的写法 —— 与服务端 middleware/appVersion 的 VERSION_RE 同一个口径（`2.63` / `2.63-debug` + 正整数）。
 * 原生回了认不出的东西就不换（照旧用 ②）：发一个服务端解析不了的头，日志里就只剩「没带」。
 */
const NAME_RE = /^\d[\w.-]{0,23}$/;
const CODE_RE = /^\d{1,9}$/;

/** 原生那一问最多等多久。★ Capacitor 的插件调用在本机桥上一般是几毫秒；这个数只防「桥没回话」把开机拖住 */
const INSTALLED_WAIT_MS = 400;

let current = BUILT;

/** 现在该报的版本；空串 = 不报 */
export function appVersion(): string {
  return current;
}

/** 问原生「装着的是哪一包」，问到就换上。只在原生壳里问；不抛 */
async function readInstalled(): Promise<void> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    const name = String(info.version ?? "").trim();
    const code = String(info.build ?? "").trim();
    if (NAME_RE.test(name) && CODE_RE.test(code)) current = `${name}+${code}`;
  } catch {
    /* 问不到（老壳、桥坏了）就用构建期那一个 */
  }
}

/**
 * 开机时调一次（main.tsx）：最多等 INSTALLED_WAIT_MS 就返回，绝不抛。超时之后原生的回答晚到了照样换上。
 */
export function adoptInstalledAppVersion(): Promise<void> {
  return Promise.race([readInstalled(), new Promise<void>((r) => setTimeout(r, INSTALLED_WAIT_MS))]);
}
