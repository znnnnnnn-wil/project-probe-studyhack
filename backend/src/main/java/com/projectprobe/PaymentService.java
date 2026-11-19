package com.projectprobe;

import static com.projectprobe.Store.*;

import com.alipay.api.*;
import com.alipay.api.internal.util.AlipaySignature;
import com.alipay.api.request.*;
import java.math.BigDecimal;
import java.net.URI;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class PaymentService {

  final Store s;
  final PaymentSettings settings;
  final String mode;
  final PaymentLease leases;

  @Autowired
  PaymentService(Store s, PaymentSettings settings) {
    this.s = s;
    this.leases = new PaymentLease(s);
    this.settings = settings;
    this.mode = settings.getMode();
    if (
      settings.getOrderTtlMinutes() < 1 || settings.getOrderTtlMinutes() > 1440
    ) throw new IllegalArgumentException("订单有效期须为 1–1440 分钟");
    if (
      !Set.of("mock", "sandbox", "production").contains(mode)
    ) throw new IllegalArgumentException(
      "PAYMENT_MODE 只能为 mock、sandbox、production"
    );
    if (
      settings.getPriceCents() < 1 || settings.getPriceCents() > 100000000
    ) throw new IllegalArgumentException("训练包价格须为 1–100000000 分");
    if (
      !settings.getSandbox().getAppId().isBlank() &&
      settings
        .getSandbox()
        .getAppId()
        .equals(settings.getProduction().getAppId())
    ) throw new IllegalArgumentException("沙箱和正式应用不能使用同一 APP_ID");
  }

  // 保留合成测试构造方式，不读取任何运行账户配置。
  PaymentService(
    Store s,
    String mode,
    String appId,
    String privateKey,
    String publicKey,
    String sellerId,
    String notifyUrl,
    String returnUrl
  ) {
    this(
      s,
      testSettings(
        mode,
        appId,
        privateKey,
        publicKey,
        sellerId,
        notifyUrl,
        returnUrl
      )
    );
  }

  static PaymentSettings testSettings(
    String mode,
    String appId,
    String privateKey,
    String publicKey,
    String sellerId,
    String notifyUrl,
    String returnUrl
  ) {
    var cfg = new PaymentSettings();
    cfg.setMode(mode);
    var a = cfg.active();
    a.setAppId(appId);
    a.setPrivateKey(privateKey);
    a.setPublicKey(publicKey);
    a.setSellerId(sellerId);
    a.setNotifyUrl(notifyUrl);
    a.setReturnUrl(returnUrl);
    a.setMerchantConfirmed(true);
    return cfg;
  }

  boolean configured() {
    return mode.equals("mock") || settings.issues().isEmpty();
  }

  void requireConfigured() {
    if (!configured()) throw error(
      503,
      "支付宝配置未完成，不能发起支付或查询；不会回退模拟支付"
    );
  }

  String scope() {
    return settings.scope();
  }

  boolean ownsScope(Map<String, Object> order) {
    return (
      mode.equals(order.get("mode")) &&
      (scope().equals(order.get("account_scope")) ||
        (mode.equals("mock") && "legacy".equals(order.get("account_scope"))))
    );
  }

  void requireScope(Map<String, Object> order) {
    if (!ownsScope(order)) throw error(
      409,
      "订单属于其他支付环境或应用账号，不能操作"
    );
  }

  Map<String, Object> create(String user, Map<String, Object> input) {
    return s.locked(user, () -> {
      String key = required(input, "requestKey", 100);
      String productCode = input.containsKey("productCode")
        ? required(input, "productCode", 30)
        : "TEN_TRAININGS";
      var product = products()
        .stream()
        .filter(p -> productCode.equals(p.get("code")))
        .findFirst()
        .orElseThrow(() -> error(400, "套餐不存在，请刷新后重新选择"));
      var rows = s.db.queryForList(
        "SELECT * FROM purchase_orders WHERE user_id=? AND request_key=?",
        user,
        key
      );
      if (!rows.isEmpty()) {
        requireScope(rows.get(0));
        if (!productCode.equals(rows.get(0).get("product_code"))) throw error(
          409,
          "此订单请求已用于其他套餐，请重新创建"
        );
        return order(user, str(rows.get(0), "id"));
      }
      String id = id(),
        merchantNo = mode.toUpperCase(Locale.ROOT) + "_" + id.replace("-", "");
      var a = settings.active();
      s.db.update(
        "INSERT INTO purchase_orders(id,user_id,request_key,amount_cents,mode,status,created_at,app_id,seller_id,account_scope,merchant_order_no,expires_at,product_code,product_name,training_limit,lifetime) VALUES (?,?,?,?,?,'PENDING',?,?,?,?,?,?,?,?,?,?)",
        id,
        user,
        key,
        product.get("amountCents"),
        mode,
        now(),
        mode.equals("mock") ? "" : a.getAppId(),
        mode.equals("mock") ? "" : a.getSellerId(),
        scope(),
        merchantNo,
        now() + settings.getOrderTtlMinutes() * 60000L,
        productCode,
        product.get("name"),
        product.get("trainingLimit"),
        product.get("lifetime")
      );
      return order(user, id);
    });
  }

  Map<String, Object> order(String user, String id) {
    var o = s.one(
      "SELECT * FROM purchase_orders WHERE user_id=? AND id=?",
      user,
      id
    );
    if (
      ownsScope(o) &&
      "PENDING".equals(o.get("status")) &&
      ((Number) o.get("expires_at")).longValue() <= now()
    ) {
      expireOrder(id);
      o = s.one(
        "SELECT * FROM purchase_orders WHERE user_id=? AND id=?",
        user,
        id
      );
    }
    o.put("can_operate", ownsScope(o));
    o.remove("query_lease_token");
    o.put(
      "can_pay",
      ownsScope(o) &&
        "PENDING".equals(o.get("status")) &&
        ((Number) o.get("expires_at")).longValue() > now()
    );
    return o;
  }

  void expireOrder(String id) {
    s.db.update(
      "UPDATE purchase_orders SET status='EXPIRED' WHERE id=? AND status='PENDING' AND expires_at<=? AND mode=? AND account_scope=?",
      id,
      now(),
      mode,
      scope()
    );
  }

  void expireDue() {
    for (var o : s.db.queryForList(
      "SELECT id FROM purchase_orders WHERE mode=? AND account_scope=? AND status='PENDING' AND expires_at<=? ORDER BY expires_at LIMIT 100",
      mode,
      scope(),
      now()
    ))
      expireOrder(str(o, "id"));
  }

  List<Map<String, Object>> packages(String user) {
    return s.db.queryForList(
      "SELECT p.* FROM training_packages p JOIN purchase_orders o ON o.id=p.order_id WHERE p.user_id=? AND o.mode=? AND o.status='PAID' AND (o.account_scope=? OR (o.mode='mock' AND o.account_scope='legacy'))",
      user,
      mode,
      scope()
    );
  }

  List<Map<String, Object>> products() {
    return List.of(
      Map.of(
        "code",
        "TEN_TRAININGS",
        "name",
        "10 次训练套餐",
        "amountCents",
        settings.getPriceCents(),
        "trainingLimit",
        10,
        "lifetime",
        false,
        "description",
        "深挖与关联复测共用 10 次，无时间限制"
      ),
      Map.of(
        "code",
        "LIFETIME",
        "name",
        "永久训练套餐",
        "amountCents",
        999900,
        "trainingLimit",
        0,
        "lifetime",
        true,
        "description",
        "永久不限训练次数，无自动续费"
      )
    );
  }

  static boolean legacy(Map<String, Object> pack) {
    return "LEGACY_PAIR".equals(pack.get("product_code"));
  }

  static boolean available(Map<String, Object> pack, String kind) {
    if (legacy(pack)) return !Boolean.TRUE.equals(
      pack.get(kind.equals("DEEP") ? "deep_used" : "retest_used")
    );
    return (
      Boolean.TRUE.equals(pack.get("lifetime")) ||
      ((Number) pack.get("training_used")).longValue() <
        ((Number) pack.get("training_limit")).longValue()
    );
  }

  Map<String, Object> quota(List<Map<String, Object>> packs) {
    long shared = 0,
      deep = 0,
      retest = 0;
    boolean unlimited = false;
    for (var pack : packs) {
      if (legacy(pack)) {
        if (available(pack, "DEEP")) deep++;
        if (available(pack, "RETEST")) retest++;
      } else if (Boolean.TRUE.equals(pack.get("lifetime"))) unlimited = true;
      else shared +=
        ((Number) pack.get("training_limit")).longValue() -
        ((Number) pack.get("training_used")).longValue();
    }
    return Map.of(
      "unlimited",
      unlimited,
      "sharedRemaining",
      shared,
      "legacyDeepRemaining",
      deep,
      "legacyRetestRemaining",
      retest,
      "deepAvailable",
      shared + deep,
      "retestAvailable",
      shared + retest
    );
  }

  Map<String, Object> shop(String user) {
    return shop(user, false);
  }

  Map<String, Object> shop(String user, boolean summary) {
    var packs = packages(user);
    if (summary) return Map.of(
      "mode",
      mode,
      "configured",
      configured(),
      "quota",
      quota(packs),
      "packages",
      packs,
      "orders",
      List.of(),
      "product",
      products().get(0),
      "products",
      products()
    );
    s.db.update(
      "UPDATE purchase_orders SET status='EXPIRED' WHERE user_id=? AND status='PENDING' AND expires_at<=? AND mode=? AND account_scope=?",
      user,
      now(),
      mode,
      scope()
    );
    var orders = s.db.queryForList(
      "SELECT * FROM purchase_orders WHERE user_id=? ORDER BY created_at DESC",
      user
    );
    for (var order : orders) {
      order.remove("query_lease_token");
      order.put("can_operate", ownsScope(order));
      order.put(
        "can_pay",
        ownsScope(order) &&
          "PENDING".equals(order.get("status")) &&
          ((Number) order.get("expires_at")).longValue() > now()
      );
    }
    return Map.of(
      "product",
      products().get(0),
      "products",
      products(),
      "quota",
      quota(packs),
      "mode",
      mode,
      "configured",
      configured(),
      "operationsEnabled",
      !mode.equals("mock") && settings.isOperationsEnabled(),
      "configurationIssues",
      settings.issues(),
      "orders",
      orders,
      "packages",
      packs
    );
  }

  static int cents(String amount) {
    try {
      if (
        amount == null || !amount.matches("[0-9]{1,9}(\\.[0-9]{1,2})?")
      ) throw new IllegalArgumentException();
      int value = new BigDecimal(amount).movePointRight(2).intValueExact();
      if (value < 1) throw new IllegalArgumentException();
      return value;
    } catch (Exception e) {
      throw error(400, "支付金额格式不正确");
    }
  }

  static String yuan(Map<String, Object> order) {
    return BigDecimal.valueOf(
      ((Number) order.get("amount_cents")).longValue(),
      2
    ).toPlainString();
  }

  void validateTrade(
    Map<String, Object> order,
    String transactionId,
    int amount
  ) {
    requireScope(order);
    if (amount != ((Number) order.get("amount_cents")).intValue()) throw error(
      400,
      "订单金额不匹配"
    );
    if (
      transactionId == null ||
      transactionId.isBlank() ||
      transactionId.length() > 100
    ) throw error(400, "交易号不合法");
    if (
      order.get("trade_no") != null &&
      !transactionId.equals(order.get("trade_no"))
    ) throw error(400, "交易号不匹配");
  }

}
