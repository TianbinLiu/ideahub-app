# `src/tutor/shared/` —— 与 tutor 仓 / server / 官网同一份的纯函数（verbatim 拷贝，别手改）

`materials/blocks.js`（切块 / 块 hash）、`format/normalize.js`（编码归一）逐字来自 tutor 仓 `src/` 的同名文件
（目录结构照搬，所以它们之间的相对 import 原样成立）。官网仓 `client/src/tutor/shared/` 是同一批文件的另一份拷贝。

- **为什么必须同一份**：App 里用 md / txt 建课时在本机切块、算块 hash 再交给服务端（tutor 仓 docs/05 §4.2），
  服务端存的逐块 hash 与这里切出来的必须相同，老师的锚点才钉得回去。抄一份改一行，锚点就静默钉不回去。
- **改规则只改 tutor 仓**，再把两个文件原样复制过来（`cp tutor/src/materials/blocks.js app/src/tutor/shared/materials/`）；
  这里手改一行，下一次同步就被覆盖、两边从此分叉。
- `.d.ts` 是本仓自己写的类型声明（同名放在 .js 旁），只声明用到的导出。
- App 只收 md / txt（M4，tutor 仓 docs/06 §6.1）：pdf / pptx / docx 的解析器（pdf.js / JSZip / mammoth）不进 APK，
  WebView 里跑 pdfjs 的内存与时长没量过 —— 那几种格式引导去网页端传。
