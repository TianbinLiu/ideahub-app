package com.ideahub.branchvideo;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
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
     * 这个错**再试也不会好**（镜像上没有这个文件、地址过期、被拒）。
     * ★ 为什么要单开一个类型而不是去认错误文案里的「404」：本仓已经栽过一次
     *   （`ArkTaskUnknown` 那条），文案是会变的，类型不会。
     * ★ 拿它换来的两件事：不白等 15 秒重试；不对用户说「再点一次会接着下」——
     *   那是一条走不通的路，而用户会照着一直点。
     */
    private static class PermanentDownloadError extends Exception {
        PermanentDownloadError(String msg) {
            super(msg);
        }
    }

    /**
     * 「这一半留着了」这句话**只在真留下字节时才说**。
     * ★ 2026-09-01 复核抓到：原来它是无条件拼在错误后面的，而完全没网/镜像 404 时
     *   `.part` 压根没建（响应码检查在建文件之前）—— 屏幕上写着「已经下好的部分留着了」，
     *   目录里一个字节都没有。往"让人放心"的方向说错不比往吓人的方向说错高尚：
     *   用户会以为下次能接着下，实际每次都从 0 开始。
     */
    private static String resumeTail(File part) {
        long have = part.exists() ? part.length() : 0;
        if (have <= 0) return "（这一次一个字节都没下到）";
        return String.format(java.util.Locale.US, "已经下好的 %.1fMB 留着了，再点一次会接着下，不用从头来。", have / 1048576.0);
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
            call.reject("没有配置版本清单地址");
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
                if (code < 200 || code >= 300) throw new Exception("HTTP " + code);

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

                JSObject ret = new JSObject();
                ret.put("hasUpdate", theirs > mine);
                ret.put("currentVersionCode", mine);
                ret.put("versionCode", theirs);
                ret.put("versionName", j.optString("versionName", ""));
                ret.put("apkUrl", j.optString("apkUrl", ""));
                ret.put("sha256", j.optString("sha256", ""));
                ret.put("sizeBytes", j.optLong("sizeBytes", 0));
                ret.put("notes", j.optString("notes", ""));
                call.resolve(ret);
            } catch (Exception e) {
                // 检查更新失败**不该打扰用户**（没网、清单还没发都会走到这儿）。
                // 如实回给 Web 层，由它决定静默——但不能假装"已是最新"。
                call.reject("检查更新失败: " + (e.getMessage() == null ? "网络不可用" : e.getMessage()));
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
            call.reject("打不开授权页: " + e.getMessage());
        }
    }

    /**
     * 下载并拉起安装。进度通过 "downloadProgress" 事件回传。
     * @param url    APK 地址
     * @param sha256 期望的摘要（可选）。校验不过就**不安装** —— 断点续传断在一半、
     *               CDN 回了一个错误页，都会得到一个装不上或装错的包
     */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        final String expectSha = call.getString("sha256", "");
        if (url == null || url.isEmpty()) {
            call.reject("缺少下载地址");
            return;
        }
        if (!canInstall()) {
            call.reject("尚未允许安装未知应用", "NEED_PERMISSION");
            return;
        }
        io.execute(() -> {
            try {
                File apk = download(url, expectSha);
                launchInstaller(apk);
                JSObject ret = new JSObject();
                ret.put("installerLaunched", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "下载失败" : e.getMessage());
            }
        });
    }

    private boolean canInstall() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
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
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("建不了下载目录");

        // 这一版自己的落点（按 URL 里的文件名分开），顺带把**别的**残包清掉
        String base = url.substring(url.lastIndexOf("/") + 1).replaceAll("[^\\w.-]", "_");
        if (base.isEmpty()) base = "update.apk";
        final File part = new File(dir, base + ".part");
        File[] stale = dir.listFiles();
        if (stale != null) {
            for (File f : stale) {
                if (!f.getName().equals(part.getName())) //noinspection ResultOfMethodCallIgnored
                    f.delete();
            }
        }

        boolean done = false;
        for (int attempt = 1; attempt <= RESUME_ATTEMPTS && !done; attempt++) {
            try {
                done = fetchInto(url, part);
            } catch (PermanentDownloadError e) {
                // ★ 再试也不会好：当场抛，别让用户白等 15 秒重试，更别许一个不存在的出口
                throw new Exception(e.getMessage() + "。这个地址上没有这一版的包了，等下一版或者去官网重下。");
            } catch (Exception e) {
                // ★ 断了就接着试，**不删残包** —— 它正是下一轮要接着下的那一半。
                //   最后一轮还不成才把原因抛上去，并如实说这一半在不在（见 resumeTail）。
                if (attempt == RESUME_ATTEMPTS) {
                    String why = e.getMessage() == null ? "下载中断" : e.getMessage();
                    throw new Exception(why + "。" + resumeTail(part));
                }
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
        if (!done) {
            throw new Exception("这一次没下完（网络断了几次）。" + resumeTail(part));
        }

        // ★ 校验放在最后、对整个文件算：续传拼出来的包与一次下完的包走同一道闸
        if (expectSha != null && !expectSha.isEmpty()) {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            try (InputStream in = new FileInputStream(part)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) sha.update(buf, 0, n);
            }
            StringBuilder hex = new StringBuilder();
            for (byte b : sha.digest()) hex.append(String.format("%02x", b));
            if (!hex.toString().equalsIgnoreCase(expectSha)) {
                // ★ 校验不过**必须删**：留着它，下一次会被当成"下了一半"接着下，
                //   而它本来就是坏的 —— 用户会陷进一个永远修不好的循环。
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                throw new Exception("下载的文件校验不通过，已丢弃（可能没下完或被中间人改过）");
            }
        }

        // 安装器要一个正常后缀的文件
        File apk = new File(dir, base.endsWith(".apk") ? base : base + ".apk");
        //noinspection ResultOfMethodCallIgnored
        apk.delete();
        if (!part.renameTo(apk)) throw new Exception("下载完了但改名失败，存储可能已满");
        return apk;
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
            if (code >= 400 && code < 500 && code != 408 && code != 429) {
                throw new PermanentDownloadError("下载失败（HTTP " + code + "）");
            }
            throw new Exception("下载失败（HTTP " + code + "）");
        }
        // ★★ 服务端**没理会** Range（回 200 而不是 206）：这一发是从头开始的，必须把已有的
        //   那半截丢掉重写 —— 直接追加会拼出一个前半段重复的坏包，而它要到最后校验才暴露。
        boolean append = code == HttpURLConnection.HTTP_PARTIAL && have > 0;
        if (!append) have = 0;
        long total = conn.getContentLengthLong();
        if (total > 0) total += have; // Range 回的是**剩余**长度，进度条要的是整包大小

        long got = have, lastReported = have;
        try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(out, append)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                fos.write(buf, 0, n);
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
            fos.getFD().sync();
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
