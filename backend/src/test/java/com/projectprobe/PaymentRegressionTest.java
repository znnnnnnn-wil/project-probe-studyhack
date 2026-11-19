package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.alipay.api.*;
import com.alipay.api.internal.util.AlipaySignature;
import com.alipay.api.request.*;
import com.alipay.api.response.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(
  properties = {
    "spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:payment-regression;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
    "spring.datasource.username=${PROBE_TEST_DB_USER:sa}",
    "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
    "app.model-mode=demo",
    "app.payment.mode=mock",
    "app.payment.reconcile-enabled=false",
  }
)
class PaymentRegressionTest {

  @Autowired
  Store s;

  @Autowired
  ProjectService projects;

  @Autowired
  ModelService model;

  static String privateKey, publicKey, applicationPrivateKey;

  @BeforeAll
  static void keys() throws Exception {
    var generator = KeyPairGenerator.getInstance("RSA");
    generator.initialize(2048);
    var pair = generator.generateKeyPair();
    privateKey = Base64.getEncoder().encodeToString(
      pair.getPrivate().getEncoded()
    );
    publicKey = Base64.getEncoder().encodeToString(
      pair.getPublic().getEncoded()
    );
    applicationPrivateKey = Base64.getEncoder().encodeToString(
      generator.generateKeyPair().getPrivate().getEncoded()
    );
  }

  String user() {
    String u = id();
    s.db.update(
      "INSERT INTO app_users VALUES (?,?,?,?)",
      u,
      "pay-" + u,
      "unused",
      now()
    );
    return u;
  }

  @Test
  void refundEventsNeverGrantAndOperationsAreRecoverable() throws Exception {
    var cfg = config("sandbox");
    var client = mock(AlipayClient.class);
    var pay = service(cfg, client);
    var operations = new PaymentOperations(pay);
    String u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    var refundNotice = notification(o, "TRADE_SUCCESS");
    refundNotice.put("refund_fee", "9.90");
    refundNotice.put("out_biz_no", "synthetic-refund");
    sign(refundNotice);
    assertEquals("success", pay.notify(refundNotice));
    assertEquals("success", pay.notify(refundNotice));
    assertEquals(0, grants(str(o, "id")));
    assertEquals("REVIEW_REQUIRED", pay.order(u, str(o, "id")).get("status"));
    assertEquals(
      1,
      s.db.queryForObject(
        "SELECT COUNT(*) FROM payment_notification_events WHERE order_id=?",
        Integer.class,
        o.get("id")
      )
    );
    var paid = pay.create(u, Map.of("requestKey", id()));
    assertEquals("success", pay.notify(notification(paid, "TRADE_SUCCESS")));
    String oid = str(paid, "id");
    assertThrows(ResponseStatusException.class, () ->
      operations.refund(u, oid)
    );
    cfg.setOperationsEnabled(true);
    assertThrows(ResponseStatusException.class, () ->
      operations.refund(user(), oid)
    );
    when(client.execute(any(AlipayTradeRefundRequest.class))).thenThrow(
      new AlipayApiException("synthetic timeout")
    );
    assertThrows(ResponseStatusException.class, () ->
      operations.refund(u, oid)
    );
    assertEquals("REFUNDING", pay.order(u, oid).get("status"));
    assertTrue(pay.packages(u).isEmpty());
    var request = s.one("SELECT * FROM payment_refunds WHERE order_id=?", oid);
    operations.refund(u, oid);
    verify(client, times(1)).execute(any(AlipayTradeRefundRequest.class));
    assertEquals(
      request.get("request_no"),
      s
        .one("SELECT * FROM payment_refunds WHERE order_id=?", oid)
        .get("request_no")
    );
    s.db.update(
      "UPDATE payment_refunds SET attempted_at=? WHERE order_id=?",
      now() - 11000,
      oid
    );
    var response = new AlipayTradeFastpayRefundQueryResponse();
    response.setCode("10000");
    response.setBody(
      s.encode(
        Map.of(
          "alipay_trade_fastpay_refund_query_response",
          Map.of(
            "out_trade_no",
            paid.get("merchant_order_no"),
            "trade_no",
            "TRADE_" + oid,
            "out_request_no",
            request.get("request_no"),
            "total_amount",
            "9.90",
            "refund_amount",
            "9.90",
            "refund_status",
            "REFUND_SUCCESS"
          )
        )
      )
    );
    when(
      client.execute(any(AlipayTradeFastpayRefundQueryRequest.class))
    ).thenReturn(response);
    assertEquals("CASH_REFUNDED", operations.refundQuery(u, oid).get("status"));
    assertEquals("CASH_REFUNDED", operations.refund(u, oid).get("status"));
    assertEquals("success", pay.notify(notification(paid, "TRADE_SUCCESS")));
    assertEquals("CASH_REFUNDED", pay.order(u, oid).get("status"));
    assertEquals(1, grants(oid));
  }

  @Test
  void closeQueriesFirstAndOnlyClosesUnpaidMatchingTransaction()
    throws Exception {
    var cfg = config("sandbox");
    cfg.setOperationsEnabled(true);
    var client = mock(AlipayClient.class);
    var pay = service(cfg, client);
    var operations = new PaymentOperations(pay);
    String u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    when(client.execute(any(AlipayTradeQueryRequest.class))).thenReturn(
      response(o, "TRADE_SUCCESS")
    );
    assertThrows(ResponseStatusException.class, () ->
      operations.close(u, str(o, "id"))
    );
    verify(client, never()).execute(any(AlipayTradeCloseRequest.class));
    var waiting = pay.create(u, Map.of("requestKey", id()));
    when(client.execute(any(AlipayTradeQueryRequest.class))).thenReturn(
      response(waiting, "WAIT_BUYER_PAY")
    );
    var closed = new AlipayTradeCloseResponse();
    closed.setCode("10000");
    closed.setTradeNo("TRADE_" + waiting.get("id"));
    closed.setBody(
      s.encode(
        Map.of(
          "alipay_trade_close_response",
          Map.of(
            "out_trade_no",
            waiting.get("merchant_order_no"),
            "trade_no",
            closed.getTradeNo()
          )
        )
      )
    );
    when(client.execute(any(AlipayTradeCloseRequest.class))).thenReturn(closed);
    assertEquals(
      "CLOSED",
      operations.close(u, str(waiting, "id")).get("status")
    );
    assertEquals(
      "CLOSED",
      operations.close(u, str(waiting, "id")).get("status")
    );
    verify(client, times(1)).execute(any(AlipayTradeCloseRequest.class));
    assertEquals(0, grants(str(waiting, "id")));
  }

  @Test
  void usedPackagesAndMismatchedRefundResponseAreRejected() throws Exception {
    var cfg = config("production");
    cfg.setOperationsEnabled(true);
    var client = mock(AlipayClient.class);
    var pay = service(cfg, client);
    var operations = new PaymentOperations(pay);
    String u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    pay.notify(notification(o, "TRADE_SUCCESS"));
    s.db.update(
      "UPDATE training_packages SET deep_used=TRUE WHERE order_id=?",
      o.get("id")
    );
    assertThrows(ResponseStatusException.class, () ->
      operations.refund(u, str(o, "id"))
    );
    verify(client, never()).execute(any(AlipayTradeRefundRequest.class));
    var fresh = pay.create(u, Map.of("requestKey", id()));
    pay.notify(notification(fresh, "TRADE_SUCCESS"));
    var r = new AlipayTradeRefundResponse();
    r.setCode("10000");
    r.setBody(
      "{\"alipay_trade_refund_response\":{\"out_trade_no\":\"wrong\"}}"
    );
    when(client.execute(any(AlipayTradeRefundRequest.class))).thenReturn(r);
    assertThrows(ResponseStatusException.class, () ->
      operations.refund(u, str(fresh, "id"))
    );
    assertEquals("REFUNDING", pay.order(u, str(fresh, "id")).get("status"));
    assertEquals(
      "UNKNOWN",
      s
        .one("SELECT * FROM payment_refunds WHERE order_id=?", fresh.get("id"))
        .get("status")
    );
  }

  @Test
  void successfulRequestStillWaitsForRefundQueryAndRetryKeepsIdentifier()
    throws Exception {
    var cfg = config("sandbox");
    cfg.setOperationsEnabled(true);
    var client = mock(AlipayClient.class);
    var pay = service(cfg, client);
    var operations = new PaymentOperations(pay);
    String u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    pay.notify(notification(o, "TRADE_SUCCESS"));
    String oid = str(o, "id");
    var r = new AlipayTradeRefundResponse();
    r.setCode("10000");
    r.setBody(
      s.encode(
        Map.of(
          "alipay_trade_refund_response",
          Map.of(
            "out_trade_no",
            o.get("merchant_order_no"),
            "trade_no",
            "TRADE_" + oid,
            "refund_fee",
            "9.90",
            "fund_change",
            "N"
          )
        )
      )
    );
    when(client.execute(any(AlipayTradeRefundRequest.class))).thenReturn(r);
    assertEquals("REFUNDING", operations.refund(u, oid).get("status"));
    var first = s.one("SELECT * FROM payment_refunds WHERE order_id=?", oid);
    assertThrows(ResponseStatusException.class, () ->
      operations.refundQuery(u, oid)
    );
    s.db.update(
      "UPDATE payment_refunds SET attempted_at=? WHERE order_id=?",
      now() - 11000,
      oid
    );
    operations.refund(u, oid);
    var capture = org.mockito.ArgumentCaptor.forClass(
      AlipayTradeRefundRequest.class
    );
    verify(client, times(2)).execute(capture.capture());
    assertEquals(
      capture.getAllValues().get(0).getBizContent(),
      capture.getAllValues().get(1).getBizContent()
    );
    assertEquals(
      first.get("request_no"),
      s.decode(capture.getValue().getBizContent()).get("out_request_no")
    );
  }

  @ParameterizedTest
  @ValueSource(strings = { "request", "amount", "total", "status", "seller" })
  void refundQueryRejectsMismatches(String mismatch) throws Exception {
    var cfg = config("sandbox");
    cfg.setOperationsEnabled(true);
    var client = mock(AlipayClient.class);
    var pay = service(cfg, client);
    var operations = new PaymentOperations(pay);
    String u = user();
    var o = pay.create(u, Map.of("requestKey", id()));
    pay.notify(notification(o, "TRADE_SUCCESS"));
    String oid = str(o, "id");
    when(client.execute(any(AlipayTradeRefundRequest.class))).thenThrow(
      new AlipayApiException("synthetic")
    );
    assertThrows(ResponseStatusException.class, () ->
      operations.refund(u, oid)
    );
    s.db.update(
      "UPDATE payment_refunds SET attempted_at=? WHERE order_id=?",
      now() - 11000,
      oid
    );
    var request = s.one("SELECT * FROM payment_refunds WHERE order_id=?", oid);
    var fields = new HashMap<String, Object>(
      Map.of(
        "out_trade_no",
        o.get("merchant_order_no"),
        "trade_no",
        "TRADE_" + oid,
        "out_request_no",
        request.get("request_no"),
        "total_amount",
        "9.90",
        "refund_amount",
        "9.90",
        "refund_status",
        "REFUND_SUCCESS"
      )
    );
    switch (mismatch) {
      case "request" -> fields.put("out_request_no", "wrong");
      case "amount" -> fields.put("refund_amount", "0.01");
      case "total" -> fields.put("total_amount", "1.00");
      case "status" -> fields.put("refund_status", "UNKNOWN");
      case "seller" -> fields.put("seller_id", "wrong");
    }
    var response = new AlipayTradeFastpayRefundQueryResponse();
    response.setCode("10000");
    response.setBody(
      s.encode(Map.of("alipay_trade_fastpay_refund_query_response", fields))
    );
    when(
      client.execute(any(AlipayTradeFastpayRefundQueryRequest.class))
    ).thenReturn(response);
    assertThrows(ResponseStatusException.class, () ->
      operations.refundQuery(u, oid)
    );
    assertEquals("REFUNDING", pay.order(u, oid).get("status"));
    assertEquals(
      "UNKNOWN",
      s.one("SELECT * FROM payment_refunds WHERE order_id=?", oid).get("status")
    );
  }

  @Test
  void invalidMoneyAndReusedEnvironmentAccountAreRejected() {
    for (String amount : Arrays.asList(
      null,
      "",
      "1e2",
      "-1",
      "0",
      "1.001",
      "21474836.48"
    ))
      assertThrows(ResponseStatusException.class, () ->
        PaymentService.cents(amount)
      );
    assertEquals(990, PaymentService.cents("9.90"));
    var cfg = config("sandbox");
    cfg.active().setPrivateKey(privateKey);
    assertTrue(
      cfg
        .issues()
        .stream()
        .anyMatch(v -> v.contains("应用公钥"))
    );
    cfg.active().setPrivateKey(applicationPrivateKey);
    cfg.getProduction().setAppId(cfg.getSandbox().getAppId());
    assertThrows(IllegalArgumentException.class, () ->
      new PaymentService(s, cfg)
    );
  }
}