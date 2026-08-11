package com.ideahub.branchvideo;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;

import com.getcapacitor.JSObject;

/**
 * 读当前包的版本号。两个渠道的 AppUpdaterPlugin 都要用，所以放在 main/ 共用 ——
 * 各抄一份的话，哪天版本号口径要改（比如加 buildTime）就会只改一边（铁律六）。
 */
final class AppVersion {
    private AppVersion() {}

    /** 失败返回 null（调用方负责 reject），不抛异常 */
    static JSObject describe(Context ctx) {
        try {
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            JSObject o = new JSObject();
            // ★ API 28 起 versionCode 是 long。用旧的 int 字段在超过 2^31 时会溢出，
            //   而版本号一旦溢出成负数，"有没有新版"的比较会永远判错
            o.put("versionCode", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? info.getLongVersionCode() : info.versionCode);
            o.put("versionName", info.versionName);
            return o;
        } catch (Exception e) {
            return null;
        }
    }
}
