package com.ideahub.branchvideo;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.tencent.mm.opensdk.modelbase.BaseResp;
import com.tencent.mm.opensdk.modelmsg.SendAuth;
import com.tencent.mm.opensdk.modelmsg.SendMessageToWX;
import com.tencent.mm.opensdk.modelmsg.WXMediaMessage;
import com.tencent.mm.opensdk.modelmsg.WXWebpageObject;
import com.tencent.mm.opensdk.openapi.IWXAPI;
import com.tencent.mm.opensdk.openapi.WXAPIFactory;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.SecureRandom;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 微信登录 + 微信好友分享（开放平台 OpenSDK）。
 *
 * 与 QQLoginPlugin 同一套架构判断（移动应用没有回调地址栏，网页 OAuth 走不通，
 * 只能原生 SDK 拿一次性 code 交服务端换身份），差异在**回执的路**：
 *   QQ  —— 回到 MainActivity.onActivityResult，转发给插件；
 *   微信 —— 回到**固定路径**的 wxapi/WXEntryActivity（<包名>.wxapi.WXEntryActivity，
 *          包名派生、一个字母都不能错，错了微信静默回不来，没有任何报错）。
 *          那个 Activity 只做一件事：把 resp 转给本类的静态 handleResp，然后立刻 finish。
 *
 * ★★ 登录与分享对"回执"的性情完全不同，处理方式刻意不同：
 *   · 登录（SendAuth）**一定**有回执（同意/取消/拒绝都有）→ pending 单槽等它。
 *   · 分享（SendMessageToWX）在新版微信上**取消不回执**（官方行为变更：用户在微信里
 *     按返回，什么都不会发回来）→ 绝不能挂 pending 等，否则这一槽永远占着，
 *     后面所有登录都被"上一次操作还没结束"挡死。所以分享是**发出即成功**：
 *     sendReq 返回 true 就 resolve，迟到的回执一律当噪音丢弃。
 *
 * ★ 分享卡片的缩略图必须是**字节**（thumbData ≤ 32KB），微信不帮你拉 URL —— 与 QQ
 *   收 imageUrl 的口味相反。所以这里在 IO 线程下载封面、缩到 200px、JPEG 质量往下压
 *   直到 ≤ 32KB；拉不到就不带图（分享照发，别为一张缩略图把整个动作弄失败）。
 *
 * ★★ **每一条 reject 都带一个稳定的 ASCII code**（2026-09-17，「应用分身」那次缺陷）：
 *   句子由 Web 侧按 code 用 Lingui 现翻（`utils/wechat.ts`）—— 原来这里直接抛中文，
 *   英文界面下弹出的是中文，而且「原生回执」与「服务端换 token 失败」两种失败**同前缀**
 *   （都叫「微信授权失败（…）」），用户截图里分不出是哪一头，没法定位。
 *   ⚠ 别在 Web 侧按 message 里的中文关键词判（CLAUDE.md 那条坑），只认 code。
 *
 * ★★ **单槽绝不许永久占用**（同上）：有分身的手机上点登录会先弹系统的选择框，
 *   而**取消选择框微信永远不给回执**（SDK 的 send() 已经 return true、PendingIntent 的
 *   OnFinished 只打日志）—— 老写法里 pendingLogin 就此占死，之后每次点都被自己拒成
 *   「上一次微信登录还没结束」，等于登录键彻底失效。两道闸：①再点一次**顶掉**上一次
 *   （用户的意图很明确）；②看门狗到点自己释放。
 */
@CapacitorPlugin(name = "WeChat")
public class WeChatPlugin extends Plugin {

    private static WeChatPlugin instance;

    private IWXAPI api;
    /** 只给登录用的 pending 单槽（分享发出即成功，不占槽——理由见类注释） */
    private PluginCall pendingLogin;
    /** 本次登录请求的防伪标记：回执的 state 对不上就不是我们这一单 */
    private String loginState = "";
    /** 看门狗：到点还没有回执就释放单槽（见类注释 ★★）。微信的授权页停留多久都算正常，所以给得宽 */
    private static final long LOGIN_TIMEOUT_MS = 5 * 60 * 1000L;
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    private Runnable loginWatchdog;

    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        instance = this;
    }

    private IWXAPI ensureApi() {
        if (api == null) {
            api = WXAPIFactory.createWXAPI(getContext().getApplicationContext(), BuildConfig.WX_APP_ID, true);
            api.registerApp(BuildConfig.WX_APP_ID);
        }
        return api;
    }

    /** WXEntryActivity 也要建 IWXAPI 来 handleIntent，从这里拿同一份配置 */
    public static IWXAPI apiFor(android.content.Context ctx) {
        IWXAPI a = WXAPIFactory.createWXAPI(ctx.getApplicationContext(), BuildConfig.WX_APP_ID, true);
        a.registerApp(BuildConfig.WX_APP_ID);
        return a;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        ret.put("wechatInstalled", ensureApi().isWXAppInstalled());
        call.resolve(ret);
    }

    /** 起授权。成功 resolve {code}，其余（取消/拒绝/未装微信）一律 reject（铁律八），每条都带 code。 */
    @PluginMethod
    public void login(PluginCall call) {
        // ★ 再点一次就顶掉上一次：上一单要么真的还在飞（用户已经放弃它了），要么是永远等不到回执的
        //   死槽（取消了选择框、分身没回执）。拒绝新的那一次 = 登录键从此点不动，比顶掉坏得多。
        settle(null, "微信登录被新的一次顶替了", "WX_SUPERSEDED");
        IWXAPI wx = ensureApi();
        if (!wx.isWXAppInstalled()) {
            call.reject("这台手机上没有安装微信", "WX_NOT_INSTALLED");
            return;
        }

        // state 是防 CSRF 的一次性标记；回执带回来对不上就不认
        byte[] rnd = new byte[12];
        new SecureRandom().nextBytes(rnd);
        StringBuilder sb = new StringBuilder("qimeng_");
        for (byte b : rnd) sb.append(String.format("%02x", b));
        loginState = sb.toString();

        SendAuth.Req req = new SendAuth.Req();
        // 只要昵称头像这一档。snsapi_base 拿不到 userinfo，别省这一级
        req.scope = "snsapi_userinfo";
        req.state = loginState;

        pendingLogin = call;
        armWatchdog();
        if (!wx.sendReq(req)) {
            settle(null, "微信授权页没能打开（请稍后重试）", "WX_SEND_FAILED");
        }
    }

    /** 看门狗：到点还没有回执就释放单槽。★ 每次 settle 都撤掉它，别让上一单的闹钟打断下一单 */
    private void armWatchdog() {
        cancelWatchdog();
        loginWatchdog = () -> settle(null, "等了很久也没有收到微信的回执", "WX_NO_RESPONSE");
        main.postDelayed(loginWatchdog, LOGIN_TIMEOUT_MS);
    }

    private void cancelWatchdog() {
        if (loginWatchdog != null) {
            main.removeCallbacks(loginWatchdog);
            loginWatchdog = null;
        }
    }

    /**
     * 登录这一单的**唯一**收尾出口：清单槽、撤看门狗，再交结果。
     * ★ 收成一处是因为老写法里每条分支各自 `pendingLogin = null` + reject，漏一条就是永久占槽（类注释 ★★）。
     */
    private void settle(JSObject ret, String err, String code) {
        cancelWatchdog();
        PluginCall call = pendingLogin;
        pendingLogin = null;
        loginState = "";
        if (call == null) return;
        if (ret != null) call.resolve(ret);
        else call.reject(err, code);
    }

    /**
     * 分享网页卡片到微信好友会话。**发出即成功**（理由见类注释）；
     * thumb 在 IO 线程下载压缩，拉不到就无图发。
     */
    @PluginMethod
    public void share(PluginCall call) {
        IWXAPI wx = ensureApi();
        if (!wx.isWXAppInstalled()) {
            call.reject("这台手机上没有安装微信");
            return;
        }
        String title = call.getString("title", "");
        String targetUrl = call.getString("targetUrl", "");
        if (title == null || title.isEmpty() || targetUrl == null || targetUrl.isEmpty()) {
            call.reject("缺少标题或链接");
            return;
        }
        String summary = call.getString("summary", "");
        String imageUrl = call.getString("imageUrl", "");

        io.execute(() -> {
            byte[] thumb = imageUrl == null || imageUrl.isEmpty() ? null : fetchThumb(imageUrl);

            WXWebpageObject page = new WXWebpageObject();
            page.webpageUrl = targetUrl;
            WXMediaMessage msg = new WXMediaMessage(page);
            msg.title = title;
            msg.description = summary == null ? "" : summary;
            if (thumb != null) msg.thumbData = thumb;

            SendMessageToWX.Req req = new SendMessageToWX.Req();
            req.transaction = "share" + System.currentTimeMillis();
            req.message = msg;
            req.scene = SendMessageToWX.Req.WXSceneSession;

            if (wx.sendReq(req)) {
                call.resolve(new JSObject());
            } else {
                call.reject("没能拉起微信分享");
            }
        });
    }

    /**
     * 封面 → 缩略图字节。缩到 200px 短边后从 85 质量往下压，直到 ≤ 32KB。
     * 任何一步失败都返回 null（无图分享），不抛 —— 缩略图是装饰，不是分享的前提。
     */
    private byte[] fetchThumb(String url) {
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            byte[] raw;
            try (InputStream in = conn.getInputStream(); ByteArrayOutputStream bo = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                // 封面最多读 5MB，再大不像封面像事故
                while ((n = in.read(buf)) > 0 && bo.size() < 5 * 1024 * 1024) bo.write(buf, 0, n);
                raw = bo.toByteArray();
            }
            Bitmap src = BitmapFactory.decodeByteArray(raw, 0, raw.length);
            if (src == null) return null;
            int w = src.getWidth(), h = src.getHeight();
            float scale = 200f / Math.min(w, h);
            if (scale < 1f) {
                src = Bitmap.createScaledBitmap(src, Math.round(w * scale), Math.round(h * scale), true);
            }
            for (int q = 85; q >= 30; q -= 15) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                src.compress(Bitmap.CompressFormat.JPEG, q, out);
                if (out.size() <= 32 * 1024) return out.toByteArray();
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    /** WXEntryActivity 收到回执后转进来。只认登录回执；分享的迟到回执一律丢弃。 */
    public static void handleResp(BaseResp resp) {
        WeChatPlugin self = instance;
        if (self == null) return;
        if (!(resp instanceof SendAuth.Resp)) return; // 分享回执：发出即成功，不在这儿收
        if (self.pendingLogin == null) return;

        SendAuth.Resp auth = (SendAuth.Resp) resp;
        if (auth.errCode == BaseResp.ErrCode.ERR_OK) {
            if (self.loginState.isEmpty() || !self.loginState.equals(auth.state)) {
                self.settle(null, "微信回执与本次请求不匹配，请重试", "WX_STATE_MISMATCH");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("code", auth.code == null ? "" : auth.code);
            self.settle(ret, null, null);
        } else if (auth.errCode == BaseResp.ErrCode.ERR_USER_CANCEL) {
            self.settle(null, "已取消微信登录", "WX_CANCEL");
        } else if (auth.errCode == BaseResp.ErrCode.ERR_AUTH_DENIED) {
            self.settle(null, "微信拒绝了授权请求", "WX_DENIED");
        } else {
            // ★ 把 errCode 原样带给 Web 侧：-6（ERR_BAN，微信那头认不出我们的包名 / 签名）正是
            //   「选了分身」最可能落到的那一档 —— 句子由 utils/wechat.ts 按 code 说，这里不拼中文。
            self.settle(null, "微信授权失败（" + auth.errCode + "）", "WX_FAIL_" + auth.errCode);
        }
    }
}
