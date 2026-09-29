package com.ideahub.branchvideo;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Google Play 结算（play 渠道的真实实现；sideload 那边是会 reject 的空壳）。
 *
 * ★★ **这个插件不发币、也不 consume**。它只做 Play 那一半：拿商品、拉起付款、把
 *   `purchaseToken` 交给 Web 层。发币与 consume 都在服务端（`payment/play.service.js`
 *   的 `redeem` / `consumeAndMark`）—— 那里能用 Play 的服务端 API 查验这笔购买是真的、
 *   属于这个账号、没被退款。
 *   ⚠ 客户端**绝不能**调 `consumeAsync`：consume 蕴含 acknowledge，一旦端上先消耗掉，
 *   服务端再查就是「查不到/已消耗」，于是**钱收了、币没发**，而且端上没有任何东西会报错。
 *   这条规则只有一处实现（铁律六），实现在服务端。
 *
 * ★★ 购买结果**不从 `launchBillingFlow` 的返回值来**，它只说「收银台拉起来了没有」。
 *   真正的结果走 `PurchasesUpdatedListener`，可能在几十秒后（用户在 Play 里挑付款方式、
 *   输密码、验指纹）。所以 `purchase()` 把 PluginCall 存起来，由 `finish()` 一处交付。
 *
 * ★ `ITEM_ALREADY_OWNED` 不是错误，是**卡住的购买**：上一笔买成了、但服务端还没 consume
 *   （兑的那一发断网 / 进程被杀）。这时候 Play 不让再买同一个商品，而用户看到的是
 *   「点了没反应」。所以这一档要去 `queryPurchasesAsync` 把那笔捞出来照常返回 ——
 *   Web 层拿它去兑，服务端 consume 掉，下一次购买就通了。
 *
 * ★ `obfuscatedAccountId` 是**必填**：它是 HMAC(服务端密钥, userId)，服务端据此拒掉
 *   「别人的购买兑到我账上」。拿不到就不许发起购买 —— 服务端对「没带」只 warn 一句就放行，
 *   端上要是允许不带，那道闸等于不存在（server `pay.routes.js` 的 `/play/account` ★★）。
 */
@CapacitorPlugin(name = "PlayBilling")
public class PlayBillingPlugin extends Plugin implements PurchasesUpdatedListener {

    /** 等 Play 回执的上限。★ 给得长：用户真的会在收银台里待几分钟（换卡、验指纹、充值） */
    private static final long PENDING_TIMEOUT_MS = 10 * 60 * 1000L;

    private BillingClient client;
    /** 正在等 Play 回执的那一次 purchase()。只允许一笔在飞 */
    private PluginCall pending;
    /** sku → ProductDetails。launchBillingFlow 要的是对象本身，不是 sku 字符串 */
    private final Map<String, ProductDetails> cache = new HashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private Runnable watchdog;
    /** 正在连接时排队的活儿。★ 见 withClient 的 ★ */
    private final List<Runnable> waiting = new ArrayList<>();
    private boolean connecting = false;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        ret.put("connected", client != null && client.getConnectionState() == BillingClient.ConnectionState.CONNECTED);
        call.resolve(ret);
    }

    /** 商品目录（价格由 Play 按国家给，我们只显示它给的 formattedPrice，绝不自己拼货币符号） */
    @PluginMethod
    public void queryProducts(PluginCall call) {
        JSArray skus = call.getArray("skus");
        List<String> ids = new ArrayList<>();
        try {
            if (skus != null) for (Object s : skus.toList()) if (s != null) ids.add(String.valueOf(s));
        } catch (Exception e) {
            call.reject("skus 不合法", "BAD_ARGS");
            return;
        }
        if (ids.isEmpty()) {
            call.reject("skus 是空的", "BAD_ARGS");
            return;
        }
        withClient(call, () -> queryDetails(ids, (result, list) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                call.reject(playMessage("拿不到商品信息", result), playCode(result));
                return;
            }
            JSArray out = new JSArray();
            for (ProductDetails d : list) {
                ProductDetails.OneTimePurchaseOfferDetails offer = d.getOneTimePurchaseOfferDetails();
                if (offer == null) continue; // 一次性商品才有这个；订阅走另一套，这里不卖
                JSObject o = new JSObject();
                o.put("sku", d.getProductId());
                o.put("title", d.getTitle());
                o.put("name", d.getName());
                o.put("formattedPrice", offer.getFormattedPrice());
                o.put("currency", offer.getPriceCurrencyCode());
                // ★ micros 是整数（1,000,000 = 一个货币单位）：给对账用，显示一律用 formattedPrice
                o.put("priceMicros", offer.getPriceAmountMicros());
                out.put(o);
            }
            JSObject ret = new JSObject();
            ret.put("products", out);
            call.resolve(ret);
        }));
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        String sku = call.getString("sku", "");
        String accountId = call.getString("obfuscatedAccountId", "");
        if (sku == null || sku.isEmpty()) {
            call.reject("缺少 sku", "BAD_ARGS");
            return;
        }
        // ★ 见类注释：没有这个 id 就不许买（服务端那道账号绑定闸靠它）
        if (accountId == null || accountId.isEmpty()) {
            call.reject("缺少账号标识，请重新登录后再试", "NO_ACCOUNT_ID");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity 不可用", "NO_ACTIVITY");
            return;
        }
        // ★ 这里**拒绝新的**而不是顶掉旧的（与 QQLoginPlugin 相反）：Play 自己也只允许一个
        //   收银台在前台，顶掉旧的会把一笔可能已经付了钱的购买的回执扔掉。
        if (pending != null) {
            call.reject("上一笔购买还没结束", "BUSY");
            return;
        }
        pending = call;
        armWatchdog();
        withClient(null, () -> {
            ProductDetails cached = cache.get(sku);
            if (cached != null) {
                launch(activity, cached, accountId);
                return;
            }
            queryDetails(Collections.singletonList(sku), (result, list) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    finish(null, playMessage("拿不到商品信息", result), playCode(result));
                    return;
                }
                ProductDetails d = cache.get(sku);
                if (d == null) {
                    // ★ 响亮：这正是「Play Console 里的商品 id 与 config/play.js 不一致」的样子
                    finish(null, "Play 里没有这个商品（" + sku + "）", "UNKNOWN_SKU");
                    return;
                }
                launch(activity, d, accountId);
            });
        });
    }

    /**
     * Play 那边还挂着、尚未被服务端 consume 的购买。
     *
     * ★★ 这是**补偿链路**，不是可选项：兑的那一发失败（断网 / 进程被杀 / 服务端 502）之后，
     *   币还没发、Play 那笔还在。不捞回来的话用户付了钱拿不到东西，而且许可测试员的购买
     *   **3 分钟**不被 acknowledge 就会被 Google 自动退款（consume 蕴含 acknowledge，
     *   而 consume 在服务端 redeem 的末尾）。
     */
    @PluginMethod
    public void pendingPurchases(PluginCall call) {
        withClient(call, () -> client.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
                (result, purchases) -> {
                    if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        call.reject(playMessage("查不到已有购买", result), playCode(result));
                        return;
                    }
                    JSObject ret = new JSObject();
                    ret.put("purchases", describe(purchases));
                    call.resolve(ret);
                }));
    }

    // ── Play 回执 ────────────────────────────────────────────────

    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        int code = result.getResponseCode();
        if (code == BillingClient.BillingResponseCode.OK) {
            JSObject ret = new JSObject();
            ret.put("purchases", describe(purchases));
            finish(ret, null, null);
            return;
        }
        if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            finish(null, "已取消付款", "USER_CANCELED");
            return;
        }
        if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            // 见类注释 ★：把卡住的那笔捞出来当成结果返回，让 Web 去兑、服务端去 consume
            client.queryPurchasesAsync(
                    QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
                    (r2, owned) -> {
                        if (r2.getResponseCode() != BillingClient.BillingResponseCode.OK || owned == null || owned.isEmpty()) {
                            finish(null, "你已经买过这个商品，但没能取回它，请稍后重试", "ALREADY_OWNED");
                            return;
                        }
                        JSObject ret = new JSObject();
                        ret.put("purchases", describe(owned));
                        ret.put("recovered", true); // 让 Web 侧能说清「这是把上一笔取回来了」
                        finish(ret, null, null);
                    });
            return;
        }
        finish(null, playMessage("付款没有完成", result), playCode(result));
    }

    // ── 内部 ─────────────────────────────────────────────────────

    private interface DetailsCallback {
        void onDone(BillingResult result, List<ProductDetails> list);
    }

    private BillingClient ensureClient() {
        if (client == null) {
            client = BillingClient.newBuilder(getContext())
                    .setListener(this)
                    // ★ 一次性商品也可能是 PENDING（例如现金付款）：不开这个，Play 直接报 DEVELOPER_ERROR
                    .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                    // ★ 掉线自动重连（BL 6.2+）：Play 商店更新自己时连接会断，手动重连那套容易漏分支
                    .enableAutoServiceReconnection()
                    .build();
        }
        return client;
    }

    /**
     * 连上再干活。
     *
     * ★ 连接中的请求要**排队**而不是各自再 startConnection 一次：重复调用会让某一次的
     *   监听器收到 DEVELOPER_ERROR，表现是「第一次点没反应、第二次才好」这种偶发。
     * @param call 失败时要 reject 的那一次；purchase() 传 null（它走 finish 收尾）
     */
    private void withClient(PluginCall call, Runnable onReady) {
        BillingClient c = ensureClient();
        if (c.getConnectionState() == BillingClient.ConnectionState.CONNECTED) {
            onReady.run();
            return;
        }
        waiting.add(onReady);
        if (connecting) return;
        connecting = true;
        c.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                connecting = false;
                List<Runnable> queued = new ArrayList<>(waiting);
                waiting.clear();
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    String msg = playMessage("连不上 Google Play 结算服务", result);
                    String code = playCode(result);
                    if (call != null) call.reject(msg, code);
                    if (pending != null) finish(null, msg, code);
                    return;
                }
                for (Runnable r : queued) r.run();
            }

            @Override
            public void onBillingServiceDisconnected() {
                // enableAutoServiceReconnection 会自己重连；这里只把「正在连」的标记放掉
                connecting = false;
            }
        });
    }

    private void queryDetails(List<String> skus, DetailsCallback cb) {
        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        for (String sku : skus) {
            products.add(QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(sku)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build());
        }
        client.queryProductDetailsAsync(
                QueryProductDetailsParams.newBuilder().setProductList(products).build(),
                (result, queryResult) -> {
                    List<ProductDetails> list = queryResult == null ? Collections.emptyList() : queryResult.getProductDetailsList();
                    for (ProductDetails d : list) cache.put(d.getProductId(), d);
                    cb.onDone(result, list);
                });
    }

    private void launch(Activity activity, ProductDetails details, String accountId) {
        BillingFlowParams.ProductDetailsParams.Builder item = BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(details);
        ProductDetails.OneTimePurchaseOfferDetails offer = details.getOneTimePurchaseOfferDetails();
        // ★ 一次性商品的 offerToken 在经典单档商品上是空的（只有订阅/多档必填）；
        //   有就带上（BL 8 起一次性商品也能有多个购买选项），空就别调 setOfferToken。
        if (offer != null && offer.getOfferToken() != null && !offer.getOfferToken().isEmpty()) {
            item.setOfferToken(offer.getOfferToken());
        }
        BillingFlowParams params = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(Collections.singletonList(item.build()))
                .setObfuscatedAccountId(accountId)
                .build();
        BillingResult r = client.launchBillingFlow(activity, params);
        // ★ 这个返回值只说「收银台拉起来了没有」。拉不起来是终态（不会再有回执），要当场收尾，
        //   否则 pending 一直挂着，购买按钮从此点不动（直到 10 分钟看门狗）。
        if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) {
            finish(null, playMessage("打不开 Google Play 付款页", r), playCode(r));
        }
    }

    private JSArray describe(List<Purchase> purchases) {
        JSArray out = new JSArray();
        if (purchases == null) return out;
        for (Purchase p : purchases) {
            JSObject o = new JSObject();
            o.put("purchaseToken", p.getPurchaseToken());
            JSArray ids = new JSArray();
            for (String id : p.getProducts()) ids.put(id);
            o.put("products", ids);
            o.put("quantity", p.getQuantity());
            o.put("state", stateName(p.getPurchaseState()));
            o.put("orderId", p.getOrderId() == null ? "" : p.getOrderId());
            o.put("acknowledged", p.isAcknowledged());
            out.put(o);
        }
        return out;
    }

    private static String stateName(int state) {
        if (state == Purchase.PurchaseState.PURCHASED) return "PURCHASED";
        if (state == Purchase.PurchaseState.PENDING) return "PENDING";
        return "UNSPECIFIED";
    }

    /** 结果只从这一处交付：某条分支忘了清 pending，购买按钮就永远点不动 */
    private void finish(JSObject ret, String err, String code) {
        cancelWatchdog();
        PluginCall call = pending;
        pending = null;
        if (call == null) return;
        if (err != null) call.reject(err, code);
        else call.resolve(ret);
    }

    private void armWatchdog() {
        cancelWatchdog();
        watchdog = () -> finish(null, "等了很久也没有收到 Google Play 的回执", "NO_RESPONSE");
        main.postDelayed(watchdog, PENDING_TIMEOUT_MS);
    }

    private void cancelWatchdog() {
        if (watchdog != null) main.removeCallbacks(watchdog);
        watchdog = null;
    }

    /** 把 Play 的响应码带进 code 里：用户截图里能看出是哪一类失败（没有它只剩一句“付款失败”） */
    private static String playCode(BillingResult r) {
        return "PLAY_" + r.getResponseCode();
    }

    private static String playMessage(String prefix, BillingResult r) {
        String dbg = r.getDebugMessage();
        return prefix + "（" + r.getResponseCode() + "）" + (dbg == null ? "" : dbg);
    }

    @Override
    protected void handleOnDestroy() {
        cancelWatchdog();
        if (client != null) client.endConnection();
        client = null;
        super.handleOnDestroy();
    }
}
