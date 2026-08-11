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

    private File download(String url, String expectSha) throws Exception {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("建不了下载目录");
        // 每次先清空：上一次下到一半的残包留着，只会在下次校验时白白失败一轮
        File[] stale = dir.listFiles();
        if (stale != null) for (File f : stale) //noinspection ResultOfMethodCallIgnored
            f.delete();

        File out = new File(dir, "update.apk");
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
        conn.setReadTimeout(READ_TIMEOUT_MS);
        // GitHub Release 的下载地址会 302 到对象存储，不跟跳转就只拿到一个空响应
        conn.setInstanceFollowRedirects(true);
        conn.connect();
        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) throw new Exception("下载失败（HTTP " + code + "）");
        long total = conn.getContentLengthLong();

        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        long got = 0, lastReported = 0;
        try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                fos.write(buf, 0, n);
                sha.update(buf, 0, n);
                got += n;
                if (got - lastReported >= PROGRESS_STEP_BYTES) {
                    lastReported = got;
                    JSObject ev = new JSObject();
                    ev.put("received", got);
                    ev.put("total", total);
                    notifyListeners("downloadProgress", ev);
                }
            }
        } finally {
            conn.disconnect();
        }

        if (expectSha != null && !expectSha.isEmpty()) {
            StringBuilder hex = new StringBuilder();
            for (byte b : sha.digest()) hex.append(String.format("%02x", b));
            if (!hex.toString().equalsIgnoreCase(expectSha)) {
                //noinspection ResultOfMethodCallIgnored
                out.delete();
                throw new Exception("下载的文件校验不通过，已丢弃（可能没下完或被中间人改过）");
            }
        }
        return out;
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
