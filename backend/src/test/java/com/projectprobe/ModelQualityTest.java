package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class ModelQualityTest {
  final Store store = new Store(null, null, new com.fasterxml.jackson.databind.ObjectMapper());
  Map<String, Object> body() {
    return new LinkedHashMap<>(Map.of("project", new LinkedHashMap<>(Map.of("responsibility", "我负责预约接口", "facts", List.of())),
      "turns", List.of(Map.of("id", "turn-1", "question", "请说明验证方式。", "answer", "我只测了正常预约，尚未执行并发测试。"))));
  }
  Map<String, Object> candidate() {
    return new LinkedHashMap<>(Map.of("clearParts", List.of("说明了已测正常预约"), "retestTopics", List.of("并发验证"),
      "findings", List.of(new LinkedHashMap<>(Map.of("topic", "并发验证", "assessment", "回答尚未说明并发预约的验证结果", "task", "发起两个同座位请求并核对成功数和最终记录数",
        "turnIds", List.of("T1"), "factIds", List.of())))));
  }
  Map<String, Object> check(String key, String verdict, List<Map<String, Object>> quotes) {
    return Map.of("key", key, "verdict", verdict, "reason", "所引回答明确保留了未执行的边界", "quotes", quotes);
  }
  Map<String, Object> quote(String source, String text) { return Map.of("sourceId", source, "quote", text); }
  Map<String, Object> review() {
    return Map.of("checks", List.of(check("CLEAR_1", "SUPPORTED", List.of(quote("T1", "我只测了正常预约"))),
      check("FINDING_1", "SUPPORTED", List.of(quote("T1", "尚未执行并发测试")))));
  }
  ModelService queued(List<Map<String, Object>> outputs, List<String> rules) {
    var queue = new ArrayDeque<>(outputs);
    var model = new ModelService(store, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
      @Override Map<String, Object> call(String rule, Object data) {
        rules.add(rule);
        assertTrue(questionDeadline.get() <= now() + 80000, "生成和复核共用总预算");
        assertFalse(queue.isEmpty(), "不能无限修订或隐式跳过复核");
        return queue.remove();
      }
    };
    model.qualityReviewEnabled = true;
    return model;
  }
  @Test void reportStoresOnlyExactSpansAndDoesNotClaimHumanVerification() {
    var rules = new ArrayList<String>();
    var model = queued(List.of(candidate(), review()), rules);
    var report = model.report(body());
    assertEquals(2, rules.size());
    assertEquals("MODEL_REVIEWED", ((Map<?, ?>) report.get("qualityReview")).get("status"));
    assertEquals(false, ((Map<?, ?>) report.get("qualityReview")).get("humanVerified"));
    var finding = list(report, "findings").get(0);
    assertEquals("尚未执行并发测试", list(finding, "supportingQuotes").get(0).get("quote"));
    assertEquals("MODEL_REVIEWED_NEEDS_HUMAN_REVIEW", finding.get("evidenceStatus"));
    assertEquals(Long.MAX_VALUE, model.questionDeadline.get());
  }
  @Test void unsupportedReportIsRepairedOnceAndMustBeReviewedAgain() {
    var rejection = Map.<String, Object>of("checks", List.of(check("CLEAR_1", "UNSUPPORTED", List.of()),
      check("FINDING_1", "SUPPORTED", List.of(quote("T1", "尚未执行并发测试")))));
    var rules = new ArrayList<String>();
    var model = queued(List.of(candidate(), rejection, candidate(), review()), rules);
    model.report(body());
    assertEquals(4, rules.size());
  }
  @Test void uncertainReportNeverBecomesASuccessAfterRetryBudget() {
    var rejection = Map.<String, Object>of("checks", List.of(check("CLEAR_1", "NEEDS_REVIEW", List.of()),
      check("FINDING_1", "SUPPORTED", List.of(quote("T1", "尚未执行并发测试")))));
    var rules = new ArrayList<String>();
    var model = queued(List.of(candidate(), rejection, candidate(), rejection), rules);
    assertThrows(ResponseStatusException.class, () -> model.report(body()));
    assertEquals(4, rules.size());
    assertEquals(Long.MAX_VALUE, model.questionDeadline.get());
  }
  @Test void reviewCannotInventQuotesOrUseUnrelatedAnswers() {
    for (var bad : List.of(quote("T1", "并发测试已经通过"), quote("T2", "尚未执行并发测试"), quote("P_responsibility", "我负责预约接口"))) {
      var result = new ModelService(store, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
        @Override Map<String, Object> call(String rule, Object data) { return candidate(); }
      }.report(body());
      var checks = Map.<String, Object>of("checks", List.of(check("CLEAR_1", "SUPPORTED", List.of(quote("T1", "我只测了正常预约"))),
        check("FINDING_1", "SUPPORTED", List.of(bad))));
      assertThrows(ResponseStatusException.class, () -> ModelQuality.report(checks, ModelQuality.claims(result, body()), result));
    }
  }
  @Test void missingDuplicateAndUnknownReviewClaimsFailClosed() {
    var result = queued(List.of(candidate(), review()), new ArrayList<>()).report(body());
    var claims = ModelQuality.claims(result, body());
    var valid = check("CLEAR_1", "SUPPORTED", List.of(quote("T1", "我只测了正常预约")));
    for (var checks : List.of(List.of(valid), List.of(valid, valid), List.of(valid, check("FINDING_9", "SUPPORTED", List.of()))))
      assertThrows(ResponseStatusException.class, () -> ModelQuality.report(Map.of("checks", checks), claims, result));
    assertThrows(ResponseStatusException.class, () -> ModelQuality.report(Map.of(), claims, result));
  }
  @Test void semanticQuestionCheckCatchesParaphrasesAndUnsupportedFrameworks() {
    for (String code : List.of("REPEATED_GOAL", "UNSUPPORTED_PREMISE", "OFF_TARGET", "CONTRADICTORY_CONDITION")) {
      var rules = new ArrayList<String>();
      var reject = Map.<String, Object>of("issues", List.of(Map.of("code", code, "reason", "重复目标或预设了未提供的实现")));
      var first = Map.<String, Object>of("question", "请说明你如何保证查询结果正确。", "topic", "验证方法");
      var repaired = Map.<String, Object>of("question", "请说明实际使用的数据访问方式。", "topic", "查询实现");
      var model = queued(List.of(first, reject, repaired, Map.of("issues", List.of())), rules);
      assertEquals(repaired.get("question"), model.firstDeepQuestion(body()).question());
      assertEquals(4, rules.size());
    }
  }
  @Test void malformedQuestionReviewDoesNotSilentlyPass() {
    assertThrows(ResponseStatusException.class, () -> ModelQuality.question(Map.of("passed", true)));
    assertThrows(ResponseStatusException.class, () -> ModelQuality.question(Map.of("issues", List.of(Map.of("code", "UNKNOWN", "reason", "x")))));
    ModelQuality.question(Map.of("issues", List.of()));
  }
  @Test void rejectedReasonsStayOutOfSharedLogsButRemainAvailableToTheOwner() {
    var failure = assertThrows(ModelQuality.Rejected.class, () -> ModelQuality.question(Map.of("issues", List.of(
      Map.of("code", "UNSUPPORTED_PREMISE", "reason", "合成私人原文中的框架尚未声明")))));
    assertEquals("QUESTION", failure.diagnostic.get("stage"));
    assertEquals("semantic_review_failed", ModelQuality.logReason(failure.getReason()));
    assertFalse(ModelQuality.logReason(failure.getReason()).contains("私人原文"));
  }
  @Test void serviceFailuresDoNotRegenerateWholeReports() {
    int[] calls = {0};
    var model = new ModelService(store, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
      @Override Map<String, Object> call(String rule, Object data) { calls[0]++; throw error(503, "模型繁忙，请稍后重试"); }
    };
    model.qualityReviewEnabled = true;
    assertThrows(ResponseStatusException.class, () -> model.report(body()));
    assertEquals(1, calls[0]);
    assertEquals(Long.MAX_VALUE, model.questionDeadline.get());
  }
  @Test void comparisonNeedsExactEvidenceFromBothRounds() {
    var before = source("PT1", "我不知道怎样验证", "old");
    var after = source("T1", "计划发起两个请求并核对记录数量", "new");
    var claims = List.of(ModelQuality.claim("COMPARISON_1", Map.of("status", "PARTIAL"), List.of(before, after)));
    assertThrows(ResponseStatusException.class, () -> ModelQuality.report(Map.of("checks", List.of(
      check("COMPARISON_1", "SUPPORTED", List.of(quote("T1", "计划发起两个请求"))))), claims, new LinkedHashMap<>()));
    ModelQuality.report(Map.of("checks", List.of(check("COMPARISON_1", "SUPPORTED", List.of(
      quote("PT1", "我不知道怎样验证"), quote("T1", "计划发起两个请求"))))), claims, new LinkedHashMap<>());
  }
  Map<String, Object> source(String id, String text, String turn) { return ModelQuality.source(id, text, turn); }
}
