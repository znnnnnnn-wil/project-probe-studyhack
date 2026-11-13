package com.projectprobe;
import static com.projectprobe.Store.*;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
class CommercialMetrics {
  final Store s; final PaymentService pay; final UsageMetrics access;
  CommercialMetrics(Store s, PaymentService pay, UsageMetrics access) { this.s=s; this.pay=pay; this.access=access; }
  Map<String, Object> summary(String user, int days) {
    access.requireOperator(user);
    if (days < 1 || days > 90) throw error(400, "统计窗口须为1至90天");
    long since = now() - days * 86400000L;
    String base = " FROM purchase_orders o JOIN training_packages p ON p.order_id=o.id WHERE o.mode=? AND o.account_scope=? AND EXISTS (SELECT 1 FROM entitlement_events e WHERE e.package_id=p.id AND e.event_type='GRANTED' AND e.created_at>=?)";
    Object[] scope = {pay.mode, pay.scope(), since};
    var payments = s.one("SELECT COUNT(*) AS confirmed_orders,COUNT(DISTINCT CASE WHEN o.status='PAID' THEN o.user_id END) AS retained_paying_accounts,COALESCE(SUM(o.amount_cents),0) AS gross_confirmed_cents,COALESCE(SUM(CASE WHEN o.status IN ('REFUNDING','REVIEW_REQUIRED') THEN 1 ELSE 0 END),0) AS unresolved_orders" + base, scope);
    var refunds = s.one("SELECT COUNT(*) AS confirmed_refunds,COALESCE(SUM(r.amount_cents),0) AS confirmed_refund_cents FROM payment_refunds r JOIN purchase_orders o ON o.id=r.order_id WHERE o.mode=? AND o.account_scope=? AND r.status='SUCCEEDED' AND r.updated_at>=?", scope);
    long registered = s.db.queryForObject("SELECT COUNT(*) FROM app_users WHERE created_at>=?", Long.class, since);
    long converted = s.db.queryForObject("SELECT COUNT(*) FROM app_users u WHERE u.created_at>=? AND EXISTS (SELECT 1 FROM purchase_orders o JOIN training_packages p ON p.order_id=o.id JOIN entitlement_events e ON e.package_id=p.id AND e.event_type='GRANTED' WHERE o.user_id=u.id AND o.mode=? AND o.account_scope=? AND o.status='PAID' AND e.created_at>=u.created_at)", Long.class, since, pay.mode, pay.scope());
    var usage = s.one("SELECT COUNT(*) AS responses,COALESCE(SUM(estimated_cost_micros),0) AS estimated_cost_micros,COALESCE(SUM(CASE WHEN estimated_cost_micros IS NULL THEN 1 ELSE 0 END),0) AS unpriced_calls FROM model_usage WHERE payment_mode=? AND created_at>=?", pay.mode, since);
    var result = new LinkedHashMap<String,Object>();
    result.put("paymentMode", pay.mode); result.put("windowDays", days); result.put("since", since);
    result.put("payments", payments); result.put("refunds", refunds);
    result.put("productionRetainedPayingAccounts", pay.mode.equals("production") ? payments.get("retained_paying_accounts") : 0);
    result.put("newAccountCohort", Map.of("registered", registered, "retainedPaying", converted,
      "conversionRate", registered == 0 ? 0 : (double) converted / registered));
    result.put("textUsage", usage);
    result.put("estimatedTextCostMicros", ((Number)usage.get("unpriced_calls")).longValue() == 0 && ((Number)usage.get("responses")).longValue() > 0 ? usage.get("estimated_cost_micros") : null);
    result.put("grossMargin", null);
    result.put("note", "付款与退款只汇总当前支付账号及指定窗口；付款以服务端发放账本为依据。沙箱和模拟不计真实付费用户，未决退款与争议单单列。退款按确认日期统计，不能直接从本窗口新付款金额减出净收入。转化率仅为同期新注册账号的当前留存付款状态，不代表官方有效用户口径。文本用量按支付环境汇总，不能归属某个商户账号；成本缺少ASR、失败请求、服务器及平台账单，不能得出完整毛利。");
    return result;
  }
  Map<String,Object> operations(String user) {
    access.requireOperator(user); long now = now();
    return Map.of("failedTrainings", s.db.queryForObject("SELECT COUNT(*) FROM trainings WHERE status='FAILED'", Long.class),
      "expiredGenerationLeases", s.db.queryForObject("SELECT COUNT(*) FROM trainings WHERE status='GENERATING' AND lease_until<?", Long.class, now),
      "paymentNeedsReview", s.db.queryForObject("SELECT COUNT(*) FROM purchase_orders WHERE mode=? AND account_scope=? AND status IN ('REVIEW_REQUIRED','REFUNDING')", Long.class, pay.mode, pay.scope()),
      "openFeedback", s.db.queryForList("SELECT kind,COUNT(*) AS total FROM user_feedback WHERE status='OPEN' GROUP BY kind"),
      "note", "仅聚合待处理数量，不返回用户材料、账号和反馈正文；未决款项需人工核对，故障恢复不自动触发现金退款。");
  }
}
