package com.ideahub.branchvideo;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.system.ErrnoException;
import android.system.OsConstants;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 侧载渠道的自更新：下载新版 APK 并拉起系统安装器。
 *
 * ★★ 这个插件**只存在于 sideload 渠道**（见 android/app/build.gradle 的 productFlavors）。
 *   Google Play 的「设备与网络滥用」政策禁止应用自己下载安装 APK，上架包（play 渠道）
 *   连 REQUEST_INSTALL_PACKAGES 权限都会被 manifest 合并规则摘掉，这个类也不参与编译。
 *   ——所以别把它挪到 main/ 下面去，那等于给上架埋一颗雷，而且要到审核被拒才炸。
 *
 * ★ 为什么自己写而不是装个插件：需要的动作只有三件（查版本号、流式下载、发安装 Intent），
 *   加起来一百多行；引一个第三方插件反而要跟着它的版本、权限声明和生命周期走。
 *
 * ★ 装不上的两种正常情况，都必须能说清楚，不能只是"没反应"：
 *   ① 用户没给"安装未知应用"授权 → canInstall=false，UI 引导去系统设置（openInstallPermission）；
 *   ② 下载的包和已装的包**签名不同** → 系统安装器会自己报错。这在从 debug 包换到
 *      release 包时必然发生，只能卸载重装（见 public/../docs 与 README 的说明）。
 *
 * ★★ 失败只回**码**、不回话（2026-10-19，docs/review-personas-2026-10.md 第九节「留着的」）：原来下载失败时把异常的
 *   getMessage()（「timeout」「Unable to resolve host …」）原样拼在中文前面交给 Web 上屏 —— 中文界面开头一个英文原词，
 *   英文界面后半句又只有中文（2.63 发版后真机更新时撞到「timeout。已经下好的 46.2MB 留着了…」）。现在 reject 的 code 是
 *   UpdateError 头上那张码表，已经下好的字节数（received）与 HTTP 状态（httpStatus）放在 data 里，话由 Web 侧按界面语言说
 *   （src/data/appUpdate.ts 的 updateFailText —— 码表两边一起改）。reject 的 message 只给日志看（码 + 原生原话），
 *   Web 认得出码时一个字都不上屏。
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    /** 下载超时。APK 近 60MB，慢网上一分钟都下不完是常态，别设太短 */
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 60_000;
    /** 进度事件的节流：每多下这么多字节才报一次。
     *  不节流的话 60MB 会打出上千次 bridge 调用，光序列化就够卡一会儿 */
    private static final long PROGRESS_STEP_BYTES = 512 * 1024;
    /**
     * 断了自动接着下几次。
     * ★ 这个数不是拍的：一发 60MB 在慢网上要几十秒到几分钟，中途掉一两次是常态；
     *   而**每一次重试都从上次断的地方接着下**，所以多试几次的代价只有时间，不是流量。
     */
    private static final int RESUME_ATTEMPTS = 5;

    /**
     * 一次失败归成哪一类。码表（与 src/data/appUpdate.ts 的 UPDATE_FAIL_CODES 逐条相等，改一边就改另一边）：
     *   STORAGE      手机存储写不进去：建不了下载目录 / 写盘出错（多半是写满了）/ 下完改名失败 —— 再试也不会好
     *   TIMEOUT      连接或读取超时
     *   OFFLINE      连不上：域名解析不了、网络不可达、对方拒连
     *   NETWORK      其它网络中断（连接被重置、TLS 断了…）
     *   HTTP         服务端 5xx / 408 / 429 这几种「待会儿再来会好」的，httpStatus 带上
     *   PACKAGE_GONE 其余 4xx：这个地址上没有这一版的包了 —— 再试也不会好，httpStatus 带上
     *   INCOMPLETE   连试几次都没下完（流提前结束、没抛错）
     *   CHECKSUM     下完了、sha256 对不上（已丢弃）
     *   INSTALLER    包下好了、拉不起系统安装器
     *   BAD_MANIFEST 版本清单读不出来（check）
     *   FAILED       以上都不是（原生原话只进 message）
     * 入口处另有几个早退码：downloadAndInstall 的 NO_URL / NO_SHA / NEED_PERMISSION、check 的 NO_MANIFEST_URL、
     * openInstallPermission 的 NO_SETTINGS（play 渠道的空壳一律 UNSUPPORTED）。
     *
     * ★ 为什么是类型 + 码而不是去认错误文案里的「404」：本仓已经栽过一次（`ArkTaskUnknown` 那条），文案是会变的，类型不会。
     * ★ retryable = false 的（STORAGE / PACKAGE_GONE / CHECKSUM / INSTALLER）当场抛：不白等 15 秒重试，也不对人说「再点一次会
     *   接着下」—— PACKAGE_GONE 那条是一条走不通的路，而人会照着一直点。
     */
    private static class UpdateError extends Exception {
        final String code;
        final int httpStatus;
        final boolean retryable;

        UpdateError(String code, int httpStatus, boolean retryable, String detail, Throwable cause) {
            super(code + (detail == null || detail.isEmpty() ? "" : ": " + detail), cause);
            this.code = code;
            this.httpStatus = httpStatus;
            this.retryable = retryable;
        }
    }

    /** 不是 UpdateError 的异常归成一个码：只认**类型**（顺着 cause 链找），不认文案 */
    private static UpdateError classify(Exception e) {
        if (e instanceof UpdateError) return (UpdateError) e;
        String detail = String.valueOf(e);
        for (Throwable c = e; c != null; c = c.getCause()) {
            // SocketTimeoutException 也是 IOException：先认它（连接超时与读超时都是它）
            if (c instanceof SocketTimeoutException) return new UpdateError("TIMEOUT", 0, true, detail, e);
            if (c instanceof UnknownHostException || c instanceof ConnectException || c instanceof NoRouteToHostException) {
                return new UpdateError("OFFLINE", 0, true, detail, e);
            }
            if (c instanceof ErrnoException && isDiskFull(((ErrnoException) c).errno)) {
                return new UpdateError("STORAGE", 0, false, detail, e);
            }
        }
        if (e instanceof JSONException) return new UpdateError("BAD_MANIFEST", 0, false, detail, e);
        if (e instanceof IOException) return new UpdateError("NETWORK", 0, true, detail, e);
        return new UpdateError("FAILED", 0, true, detail, e);
    }

    private static boolean isDiskFull(int errno) {
        return errno == OsConstants.ENOSPC || errno == OsConstants.EDQUOT;
    }

    /**
     * 把失败交给 Web：码 + data（received = 这一版在本机已经有多少字节，没有这一项 = 不适用；httpStatus 有才带）。
     * ★ 「已经下好的那一截留着了」这句话由 Web 说，而且**只在 received > 0 时才说**（2026-09-01 复核抓到的老坑：原来那句是
     *   无条件拼在错误后面的，而完全没网 / 镜像 404 时 `.part` 压根没建 —— 屏幕上写着「留着了」，目录里一个字节都没有）。
     */
    private static void rejectWith(PluginCall call, UpdateError e, long received) {
        JSObject data = new JSObject();
        if (received >= 0) data.put("received", received);
        if (e.httpStatus > 0) data.put("httpStatus", e.httpStatus);
        call.reject(e.getMessage(), e.code, data);
    }

    private final ExecutorService io = Executors.newSingleThreadExecutor();

    /** 当前包的版本号 + 这个渠道支不支持自更新 + 这台机器现在能不能装。UI 靠它决定显示什么 */
    @PluginMethod
    public void current(PluginCall call) {
        JSObject ret = AppVersion.describe(getContext());
        if (ret == null) {
            call.reject("读不到当前版本号");
            return;
        }
        ret.put("selfUpdate", true); // sideload 渠道：支持
        ret.put("canInstall", canInstall());
        call.resolve(ret);
    }

    /**
     * 拉版本清单并和当前包比一比。
     *
     * ★★ 为什么这一步放在**原生**做，而不是 Web 层 fetch：WebView 的 origin 是
     *   https://localhost，去拉 GitHub Release 上的 latest.json 是跨域请求，
     *   而那边不会给我们发 CORS 头 —— Web 层拿到的永远是一个网络错误，
     *   而且错得毫无提示（浏览器把跨域失败一律报成 TypeError: Failed to fetch）。
     *   原生 HttpURLConnection 没有同源策略这回事，顺带把 302 跳转也一并处理了。
     */
    @PluginMethod
    public void check(PluginCall call) {
        final String manifestUrl = call.getString("manifestUrl");
        if (manifestUrl == null || manifestUrl.isEmpty()) {
            call.reject("没有配置版本清单地址", "NO_MANIFEST_URL");
            return;
        }
        io.execute(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(manifestUrl).openConnection();
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(CONNECT_TIMEOUT_MS);
                conn.setInstanceFollowRedirects(true);
                conn.connect();
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) throw new UpdateError("HTTP", code, true, "manifest", null);

                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                try (InputStream in = conn.getInputStream()) {
                    byte[] buf = new byte[8192];
                    int n;
                    // 清单是几百字节的 JSON；设个上限，免得地址填错时把一个大文件读进内存
                    while ((n = in.read(buf)) > 0 && bos.size() < 64 * 1024) bos.write(buf, 0, n);
                }
                JSONObject j = new JSONObject(bos.toString("UTF-8"));

                JSObject cur = AppVersion.describe(getContext());
                long mine = cur == null ? 0 : cur.getLong("versionCode");
                long theirs = j.optLong("versionCode", 0);
                // ★ 强制更新（2026-10-10，方舟 11-24 下线那一批）：清单里可选的 minVersionCode = 「比它老的包必须更新才能接着用」。
                //   老清单没有这一格 → 0 → 谁都不强制，行为与改之前一字不差。
                //   ★ 读不出数就当没写：optLong 对非数字回缺省值 0（数字字符串、小数它会照转成整数 —— 发版脚本只写整数），
                //     负数夹到 0。宁可不强制，也不把所有人锁在门外。
                //   ★ 老包（2.62 及以前）读同一份清单不受影响：它们只 optXxx 自己认识的那几格，多一格 minVersionCode 直接被忽略。
                long min = Math.max(0, j.optLong("minVersionCode", 0));

                JSObject ret = new JSObject();
                ret.put("hasUpdate", theirs > mine);
                ret.put("currentVersionCode", mine);
                ret.put("versionCode", theirs);
                ret.put("minVersionCode", min);
                // ★ 只有「真有更新可装」时才算强制：清单上的新版不比手上这版新（发版脚本拦着，但清单是外部输入），
                //   强制了也没有东西可装 —— 那是把人锁死在一张关不掉的弹层前面。
                // ★ debug 包（build.gradle 的 applicationIdSuffix ".debug"）**永远不强制**（2026-10-10 评审抓到）：
                //   「立即更新」与两条浏览器下载装的都是正式包 —— 另一个包名，并排装上，这个 debug 包自己的 versionCode
                //   一辈子到不了门槛（versionCode 只在 main 上涨，门槛之前切出去的 worktree 出的包就落在下面）。
                //   强制的话它每次冷启动都是一张关不掉的弹层，整个包不能用。按包名判，因为原因就是「装的是另一个包」。
                //   普通的「有新版」提示照旧（关得掉）。
                boolean updatesElsewhere = getContext().getPackageName().endsWith(".debug");
                ret.put("mandatory", !updatesElsewhere && theirs > mine && mine < min);
                ret.put("versionName", j.optString("versionName", ""));
                ret.put("apkUrl", j.optString("apkUrl", ""));
                ret.put("sha256", j.optString("sha256", ""));
                ret.put("sizeBytes", j.optLong("sizeBytes", 0));
                ret.put("notes", j.optString("notes", ""));
                call.resolve(ret);
            } catch (Exception e) {
                // 检查更新失败**不该打扰用户**（没网、清单还没发都会走到这儿）。
                // 如实回给 Web 层（码 + HTTP 状态），由它决定静默、或按界面语言说出来 —— 但不能假装"已是最新"。
                rejectWith(call, classify(e), -1);
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    /** 打开系统的「安装未知应用」授权页。★ 直接跳到本应用那一项，不是设置首页 ——
     *  丢用户去设置首页自己找，等于这一步大部分人过不去 */
    @PluginMethod
    public void openInstallPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve(); // 8.0 以前是全局开关，没有按应用的授权页
            return;
        }
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("打不开授权页: " + e, "NO_SETTINGS");
        }
    }

    /**
     * 下载并拉起安装。进度通过 "downloadProgress" 事件回传。
     * @param url    APK 地址
     * @param sha256 期望的摘要（**必填**，64 位十六进制）。校验不过就**不安装** —— 断点续传断在一半、
     *               CDN 回了一个错误页，都会得到一个装不上或装错的包
     */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        final String expectSha = call.getString("sha256", "");
        if (url == null || url.isEmpty()) {
            call.reject("缺少下载地址", "NO_URL");
            return;
        }
        // ★ 没有 sha256 就不下不装（2026-10-15 教材人格评审，owasp-security-5）：原来 expectSha 为空时直接改名、拉起安装器 ——
        //   发版脚本每一版都写 sha，缺了只可能是服务端转手逻辑回归或有人手改了清单，没有理由替它放行：装上去的那个包
        //   谁都证明不了是我们发的。Web 侧（appUpdate.checkUpdate）先拦了一道，这里是原生自己的闸，不信上层。
        if (expectSha == null || !expectSha.matches("(?i)[0-9a-f]{64}")) {
            call.reject("更新清单里没有安装包的 sha256，不下载也不安装", "NO_SHA");
            return;
        }
        if (!canInstall()) {
            call.reject("尚未允许安装未知应用", "NEED_PERMISSION");
            return;
        }
        io.execute(() -> {
            try {
                File apk = download(url, expectSha);
                try {
                    launchInstaller(apk);
                } catch (Exception e) {
                    // 包已经下好、校验过、改好名：再点一次 download 会直接复用它（见 download 里「上次已经下好的成品」）
                    throw new UpdateError("INSTALLER", 0, false, String.valueOf(e), e);
                }
                JSObject ret = new JSObject();
                ret.put("installerLaunched", true);
                call.resolve(ret);
            } catch (Exception e) {
                rejectWith(call, classify(e), bytesOnDisk(url));
            }
        });
    }

    private boolean canInstall() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    /**
     * 这一版的两个落点：[0] = 下载中的半截（.part），[1] = 下完、校验过、改好名的成品（安装器要一个正常后缀的文件）。
     * 按 URL 里的文件名分开存（理由见 download 头上那条 ⚠）。
     */
    private File[] targetsOf(String url) {
        File dir = new File(getContext().getCacheDir(), "updates");
        String base = url.substring(url.lastIndexOf("/") + 1).replaceAll("[^\\w.-]", "_");
        if (base.isEmpty()) base = "update.apk";
        return new File[] { new File(dir, base + ".part"), new File(dir, base.endsWith(".apk") ? base : base + ".apk") };
    }

    /** 这一版在本机已经有多少字节（失败时回给 Web 的 received）：下好的成品优先（它在 = 只差安装那一步），否则 .part 那半截 */
    private long bytesOnDisk(String url) {
        try {
            File[] t = targetsOf(url);
            if (t[1].exists()) return t[1].length();
            return t[0].exists() ? t[0].length() : 0;
        } catch (Exception e) {
            return -1; // 量不出来：不带这一项，Web 那边就不提「留没留着」
        }
    }

    /**
     * 下载安装包，**支持断点续传**。
     *
     * ★★ 2026-08-31 加。原来是「每次先把目录清空、从 0 重下」，在这个场景下代价特别大：
     *   包 60MB 出头，而手机上下到一半断线是常态 —— 断一次前面下的就全白费，
     *   用户看到的是进度条反复从 0 开始、永远下不完。
     * ★ 续传的三个前提我们都占着：文件名带版本号（内容不会变）、服务端 `res.sendFile`
     *   本来就支持 Range、清单里带 sha256。所以"接着下"不会悄悄拼出一个坏包 ——
     *   最后那道校验是兜底。
     *
     * ⚠ 摘要**不能再边下边算**：续传时前半截不经过这一轮的流。改成下完之后整个文件读一遍
     *   （60MB 顺序读在手机上不到一秒），这样"续传拼出来的包"与"一次下完的包"走同一道闸。
     * ⚠ 残包要**按文件名分开存**：不同版本共用一个 update.apk 的话，上一版没下完的半截
     *   会被当成这一版的前半段接着下 —— 拼出来必然校验不过，而用户要先白等一场。
     */
    private File download(String url, String expectSha) throws Exception {
        File[] targets = targetsOf(url);
        final File part = targets[0];
        final File apk = targets[1];
        File dir = part.getParentFile();
        if (dir == null || (!dir.exists() && !dir.mkdirs())) throw new UpdateError("STORAGE", 0, false, "mkdirs " + dir, null);

        // 顺带把**别的**残包清掉
        File[] stale = dir.listFiles();
        if (stale != null) {
            for (File f : stale) {
                // ★ 这一版自己的**成品**也留着（2026-10-10 评审抓到）：原来只留 .part，于是「下完 → 安装器弹出来 → 人点了取消 /
                //   Play Protect 扫描时退了出来 → 再点一次「立即更新」」会把上次下好、校验过的整包删掉，60MB 从 0 重下。
                //   强制更新那一版这张弹层关不掉，这一次重下期间人什么都干不了。
                if (!f.getName().equals(part.getName()) && !f.getName().equals(apk.getName())) //noinspection ResultOfMethodCallIgnored
                    f.delete();
            }
        }

        // ★ 上次已经下好的成品：摘要对得上就直接拿去装，不再下一遍。
        //   对不上 = 不是这一版 / 坏了，删掉重下。（sha256 在 downloadAndInstall 入口就是必填的，这里不再分「没给摘要」那一支）
        if (apk.exists()) {
            if (sha256Hex(apk).equalsIgnoreCase(expectSha)) return apk;
            //noinspection ResultOfMethodCallIgnored
            apk.delete();
        }

        boolean done = false;
        for (int attempt = 1; attempt <= RESUME_ATTEMPTS && !done; attempt++) {
            try {
                done = fetchInto(url, part);
            } catch (Exception e) {
                UpdateError ue = classify(e);
                // ★ 再试也不会好（PACKAGE_GONE / STORAGE）：当场抛，别让用户白等 15 秒重试，更别许一个不存在的出口 ——
                //   原来 PACKAGE_GONE 那句指人「去官网重下」，而官网下载页 302 到的正是同一个镜像文件（2026-10-10 评审抓到）。
                //   强制更新那一版的弹层上另摆着 GitHub 那条备用路（components/UpdateSheet），这里不替它指路。
                // ★ 断了就接着试，**不删残包** —— 它正是下一轮要接着下的那一半。
                //   最后一轮还不成才把码抛上去；这一半在不在由 Web 照 data.received 如实说（rejectWith 头上那条 ★）。
                if (!ue.retryable || attempt == RESUME_ATTEMPTS) throw ue;
                try {
                    Thread.sleep(1500L * attempt);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            }
        }

        // ★★ 「没下完」与「下坏了」是**两个结局**，绝不能合并：下面那道 sha 校验失败时会
        //   把残包删掉（它必须删，否则坏包会被当成"下了一半"永远接下去）。而一个仅仅是
        //   没下完的文件走到那里，就会被当成坏包删掉 —— 用户白下的那几十 MB 就没了，
        //   而他下次还得从 0 开始，正是这次改动要消灭的事。
        if (!done) throw new UpdateError("INCOMPLETE", 0, true, null, null);

        // ★ 校验放在最后、对整个文件算：续传拼出来的包与一次下完的包走同一道闸。
        //   无条件校验（2026-10-15 教材人格评审）：原来 expectSha 为空就跳过这一步直接改名、拉起安装器，入口处现在已经拒掉了空的
        if (!sha256Hex(part).equalsIgnoreCase(expectSha)) {
            // ★ 校验不过**必须删**：留着它，下一次会被当成"下了一半"接着下，
            //   而它本来就是坏的 —— 用户会陷进一个永远修不好的循环。
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            throw new UpdateError("CHECKSUM", 0, false, null, null);
        }

        //noinspection ResultOfMethodCallIgnored
        apk.delete();
        // 改名失败：半截（其实是整包）还在，下一次 Range 回 416 → 当成下完 → 校验 → 再改名
        if (!part.renameTo(apk)) throw new UpdateError("STORAGE", 0, false, "rename", null);
        return apk;
    }

    /** 整个文件的 SHA-256（小写十六进制）。60MB 顺序读在手机上不到一秒；下完校验与复用上次的成品走同一个函数 */
    private static String sha256Hex(File f) throws Exception {
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) sha.update(buf, 0, n);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : sha.digest()) hex.append(String.format("%02x", b));
        return hex.toString();
    }

    /**
     * 从 `out.length()` 处接着下。
     * @return true = 这一发把文件下完了；false = 还没下完（调用方接着重试）
     */
    private boolean fetchInto(String url, File out) throws Exception {
        long have = out.length();
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
        conn.setReadTimeout(READ_TIMEOUT_MS);
        // GitHub Release 的下载地址会 302 到对象存储，不跟跳转就只拿到一个空响应
        conn.setInstanceFollowRedirects(true);
        if (have > 0) conn.setRequestProperty("Range", "bytes=" + have + "-");
        conn.connect();
        int code = conn.getResponseCode();
        // ★ 416 = 手上这半截已经不小于服务端那个文件了（多半上次其实下完了）。当成"下完"
        //   交给外面那道 sha 去判 —— 它才是权威，在这儿自己下结论只会多一种猜错的方式。
        if (code == 416) {
            conn.disconnect();
            return true;
        }
        if (code < 200 || code >= 300) {
            conn.disconnect();
            // 408 请求超时 / 429 太频繁 —— 这两个恰恰是"待会儿再来"，不算永久
            boolean permanent = code >= 400 && code < 500 && code != 408 && code != 429;
            throw new UpdateError(permanent ? "PACKAGE_GONE" : "HTTP", code, !permanent, null, null);
        }
        // ★★ 服务端**没理会** Range（回 200 而不是 206）：这一发是从头开始的，必须把已有的
        //   那半截丢掉重写 —— 直接追加会拼出一个前半段重复的坏包，而它要到最后校验才暴露。
        boolean append = code == HttpURLConnection.HTTP_PARTIAL && have > 0;
        if (!append) have = 0;
        long total = conn.getContentLengthLong();
        if (total > 0) total += have; // Range 回的是**剩余**长度，进度条要的是整包大小

        // ★ 写盘的错与读网络的错分开归类（2026-10-19）：前者（多半是写满了）再试也不会好、要人腾空间，后者断了接着下。
        //   原来两种都落进同一个 catch、拿原话说，写满了也照样重试五轮、再对人说一句英文。
        FileOutputStream fos;
        try {
            fos = new FileOutputStream(out, append);
        } catch (IOException e) {
            conn.disconnect();
            throw new UpdateError("STORAGE", 0, false, String.valueOf(e), e);
        }
        long got = have, lastReported = have;
        // fos 排在 in 前面：getInputStream 抛错时 fos 已经登记成资源，照样会被关掉
        try (FileOutputStream f = fos; InputStream in = conn.getInputStream()) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                try {
                    f.write(buf, 0, n);
                } catch (IOException e) {
                    throw new UpdateError("STORAGE", 0, false, String.valueOf(e), e);
                }
                got += n;
                if (got - lastReported >= PROGRESS_STEP_BYTES) {
                    lastReported = got;
                    JSObject ev = new JSObject();
                    ev.put("received", got);
                    ev.put("total", total);
                    notifyListeners("downloadProgress", ev);
                }
            }
            // 落盘再说"下完了"：进程被系统杀掉时才不会留下一个长度对不上的残包
            try {
                f.getFD().sync();
            } catch (IOException e) {
                throw new UpdateError("STORAGE", 0, false, String.valueOf(e), e);
            }
        } finally {
            conn.disconnect();
        }
        return total <= 0 || got >= total;
    }

    private void launchInstaller(File apk) {
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        // 这两个 flag 缺一不可：没有 GRANT_READ 安装器读不到我们私有目录里的文件，
        // 没有 NEW_TASK 从非 Activity 上下文启动会直接抛异常
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity act = getActivity();
        if (act != null) act.startActivity(i);
        else getContext().startActivity(i);
    }
}
