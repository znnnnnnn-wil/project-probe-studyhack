package com.projectprobe;
import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties={"spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:commercial;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
  "spring.datasource.username=${PROBE_TEST_DB_USER:sa}","spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}","app.model-mode=demo","app.payment.mode=mock"})
@org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
class CommercialMetricsTest {
  @Autowired Store s; @Autowired ProjectService projects; @Autowired PaymentService payments;
  @Autowired TrainingService trainings; @Autowired UsageMetrics access;
  @Autowired org.springframework.test.web.servlet.MockMvc mvc;
  @Test void readinessIsPublicButCrossAccountStatisticsRequireExplicitAccess() throws Exception {
    mvc.perform(get("/api/ready")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ready"));
    mvc.perform(get("/api/operator/business")).andExpect(status().isUnauthorized());
    String user=id(),token=id();
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)",user,user,"unused",now());
    s.db.update("INSERT INTO auth_sessions VALUES (?,?,?)",Auth.hash(token),user,now()+60000);
    var cookie=new jakarta.servlet.http.Cookie("probe_session",token);
    access.operators="";
    mvc.perform(get("/api/operator/business").cookie(cookie)).andExpect(status().isForbidden());
    mvc.perform(get("/api/operator/operations").cookie(cookie)).andExpect(status().isForbidden());
    access.operators=user;
    try {
      mvc.perform(get("/api/operator/business").cookie(cookie)).andExpect(status().isOk())
        .andExpect(jsonPath("$.paymentMode").value("mock")).andExpect(jsonPath("$.productionRetainedPayingAccounts").value(0));
      mvc.perform(get("/api/operator/operations").cookie(cookie)).andExpect(status().isOk());
    } finally { access.operators=""; }
  }
  @Test void sandboxNeverBecomesRealRevenueAndRefundsRemainSeparate() {
    var f=TrainingFixture.create(s,projects,payments,trainings);
    access.operators=f.user();
    var mockMetrics=new CommercialMetrics(s,payments,access);
    assertEquals(0, mockMetrics.summary(f.user(),30).get("productionRetainedPayingAccounts"));
    var settings=new PaymentSettings();settings.setMode("production");
    settings.getProduction().setAppId("synthetic-app");settings.getProduction().setSellerId("synthetic-seller");
    var production=new PaymentService(s,settings);
    var metrics=new CommercialMetrics(s,production,access);
    String order=str(s.one("SELECT order_id FROM training_packages WHERE user_id=?",f.user()),"order_id");
    // Synthetic accounting fixture only: never invokes the official payment provider.
    s.db.update("UPDATE purchase_orders SET mode='production',account_scope=? WHERE id=?",production.scope(),order);
    var result=metrics.summary(f.user(),30);
    assertEquals(1L,((Number)result.get("productionRetainedPayingAccounts")).longValue());
    assertNull(result.get("grossMargin"));assertNull(result.get("estimatedTextCostMicros"));
    assertThrows(org.springframework.web.server.ResponseStatusException.class,()->metrics.summary(id(),30));
    assertThrows(org.springframework.web.server.ResponseStatusException.class,()->metrics.summary(f.user(),0));
    var cohort=(Map<?,?>)result.get("newAccountCohort");
    assertTrue(((Number)cohort.get("conversionRate")).doubleValue()<=1);
    s.db.update("UPDATE purchase_orders SET status='CASH_REFUNDED' WHERE id=?",order);
    s.db.update("INSERT INTO payment_refunds VALUES (?,?,?,'SUCCEEDED',?,?)",order,id(),990,now(),now());
    result=metrics.summary(f.user(),30);
    assertEquals(0L,((Number)result.get("productionRetainedPayingAccounts")).longValue());
    assertEquals(990L,((Number)((Map<?,?>)result.get("payments")).get("gross_confirmed_cents")).longValue());
    assertEquals(990L,((Number)((Map<?,?>)result.get("refunds")).get("confirmed_refund_cents")).longValue());
    assertFalse(metrics.operations(f.user()).toString().contains("password"));
  }
}
