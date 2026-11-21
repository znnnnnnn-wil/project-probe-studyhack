package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(properties = {"spring.datasource.url=jdbc:h2:mem:competition-practice;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
  "app.model-mode=demo", "app.practice-max-turns=5"})
class CompetitionPracticeTest {
  @Autowired Store s;
  @Autowired ProjectService projects;
  @Autowired ProjectPractice practice;
  @Autowired PracticeRetest retest;
  String[] fixture() {
    String user = id();
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    var project = projects.save(user, null, Map.of("name", "合成预约项目", "responsibility", "预约接口、数据库约束", "verification", "并发测试尚未完成"));
    return new String[]{user, str(project, "id")};
  }
  @Test void completesFiveTurnsAndRejectsStaleSubmissions() {
    var f = fixture();
    var state = practice.run(f[0], f[1], Map.of());
    assertEquals(5, state.get("maxTurns"));
    for (int i = 0; i < 5; i++) {
      var turns = list(state, "turns");
      assertEquals(i + 1, turns.size());
      assertEquals("ACTIVE", state.get("status"));
      var input = Map.<String,Object>of("turnId", turns.get(i).get("id"), "answer", "合成回答" + i + "：我负责接口，通过数据库约束防止冲突；并发测试尚未完成。");
      state = practice.run(f[0], f[1], input);
      if (i < 4) {
        var stale = assertThrows(ResponseStatusException.class, () -> practice.run(f[0], f[1], input));
        assertEquals(409, stale.getStatusCode().value());
        assertEquals(state, practice.run(f[0], f[1], Map.of()));
      }
    }
    assertEquals("COMPLETED", state.get("status"));
    var report = (Map<String,Object>)state.get("report");
    assertEquals(5, list(report, "findings").size());
    assertEquals(state, practice.run(f[0], f[1], Map.of()));
    var turns = list(state, "turns");
    var invalid = Map.<String, Object>of(
      "findingIndex", 0, "turnId", turns.get(1).get("id"), "answer", "来自另一题");
    assertThrows(ResponseStatusException.class, () -> retest.run(f[0], f[1], invalid));

    var input = Map.<String, Object>of(
      "findingIndex", 0, "turnId", turns.get(0).get("id"),
      "answer", "测试输入：两次并发请求。预期结果：仅成功一笔。实测结果：尚未执行。");
    var compared = retest.run(f[0], f[1], input);
    var saved = PracticeRetest.object(compared.get("retest"));
    var comparison = list(PracticeRetest.object(saved.get("report")), "comparisons").get(0);
    assertEquals("COMPLETED", saved.get("status"));
    assertEquals(report, compared.get("report"));
    assertEquals(turns.get(0).get("answer"), list(comparison, "previousEvidence").get(0).get("quote"));
    assertEquals(input.get("answer"), list(comparison, "currentEvidence").get(0).get("quote"));
    assertTrue(str(comparison, "assessment").contains("测试输入、预期结果"));
    assertFalse(str(comparison, "assessment").contains("、实测结果"));
    assertEquals(compared, retest.run(f[0], f[1], input));
    assertEquals(true, practice.history(f[0]).get(0).get("retestCompleted"));
    assertTrue(practice.history(id()).isEmpty());
    assertThrows(ResponseStatusException.class, () -> practice.get(id(), f[1]));
  }
  @Test void resumesSavedAnswerAfterExpiredGenerationWithoutLosingOrDuplicatingIt() {
    var f = fixture();
    var state = practice.run(f[0], f[1], Map.of());
    list(state, "turns").get(0).put("answer", "已经提交的回答，故障后应保留。");
    s.db.update("UPDATE project_practice_rounds SET body=?,status='GENERATING',lease_until=? WHERE user_id=? AND round_id=?", s.encode(state), now()-1, f[0], str(state, "roundId"));
    assertEquals("FAILED", practice.get(f[0], f[1]).get("status"));
    var recovered = practice.run(f[0], f[1], Map.of());
    assertEquals("ACTIVE", recovered.get("status"));
    assertEquals(2, list(recovered, "turns").size());
    assertEquals("已经提交的回答，故障后应保留。", list(recovered, "turns").get(0).get("answer"));
    assertEquals(recovered, practice.run(f[0], f[1], Map.of()));
    assertEquals("ACTIVE", practice.history(f[0]).get(0).get("status"));
    assertEquals(1, practice.history(f[0]).get(0).get("answeredCount"));
  }
  @Test void requiresQuestionIdentityAndKeepsTheOriginalMaterialSnapshot() {
    var f = fixture();
    var first = practice.run(f[0], f[1], Map.of());
    assertThrows(ResponseStatusException.class, () -> practice.run(f[0], f[1], Map.of("answer", "未标明题目")));
    var changed = new LinkedHashMap<>(projects.get(f[0], f[1]));
    changed.put("responsibility", "后来补充的材料");
    projects.save(f[0], f[1], changed);
    var next = practice.run(f[0], f[1], Map.of("answer", "已提交", "turnId", list(first,"turns").get(0).get("id")));
    assertEquals("预约接口、数据库约束", ((Map<?,?>)next.get("project")).get("responsibility"));
  }
  @Test void dialogueKeepsTheTopicUntilTheAnswerIsDeveloped() {
    var fixture = fixture();
    String user = fixture[0], project = fixture[1];
    var state = practice.run(user, project, Map.of());
    var first = list(state, "turns").get(0);
    String turnId = str(first, "id");
    String question = str(first, "question");

    var greeting = Map.<String, Object>of("turnId", turnId, "dialogue", true, "exchangeCount", 0, "answer", "你好！");
    state = practice.run(user, project, greeting);
    assertEquals("ACTIVE", state.get("status"));
    assertEquals(1, list(state, "turns").size());
    first = list(state, "turns").get(0);
    assertEquals(turnId, str(first, "id"));
    assertEquals(question, str(first, "question"));
    assertEquals("", str(first, "answer"));
    assertTrue(PracticeDialogue.currentPrompt(first).contains("接着聊这道题"));
    assertEquals(409, assertThrows(ResponseStatusException.class,
      () -> practice.run(user, project, greeting)).getStatusCode().value());
    assertEquals(409, assertThrows(ResponseStatusException.class,
      () -> practice.requireUnansweredTurn(user, project, turnId, 0)).getStatusCode().value());
    assertEquals(first, practice.requireUnansweredTurn(user, project, turnId, 1));

    String brief = "服务端用数据库唯一键保存请求记录。";
    var partial = Map.<String, Object>of("turnId", turnId, "dialogue", true, "exchangeCount", 1, "answer", brief);
    state = practice.run(user, project, partial);
    assertEquals(1, list(state, "turns").size());
    assertEquals(2, PracticeDialogue.count(list(state, "turns").get(0)));
    assertEquals("", str(list(state, "turns").get(0), "answer"));

    String detail = "同一个幂等键查到之前的处理结果，重复请求直接返回第一次的结果。";
    state = practice.run(user, project, Map.of(
      "turnId", turnId, "dialogue", true, "exchangeCount", 2, "answer", detail));
    var turns = list(state, "turns");
    assertEquals(2, turns.size());
    assertEquals(3, PracticeDialogue.count(turns.get(0)));
    assertEquals(brief + "\n" + detail, str(turns.get(0), "answer"));
    assertEquals(1, practice.history(user).get(0).get("answeredCount"));
    assertNotEquals(turnId, str(turns.get(1), "id"));
  }

  @Test void restoresPendingDialogueOnceAfterAnExpiredLease() {
    var fixture = fixture();
    String user = fixture[0], project = fixture[1];
    var state = practice.run(user, project, Map.of());
    String turnId = str(list(state, "turns").get(0), "id");
    state.put("pendingExchange", Map.of("turnId", turnId, "exchangeCount", 0, "answer", "使用唯一键。"));
    s.db.update("UPDATE project_practice_rounds SET body=?,status='GENERATING',lease_until=? WHERE user_id=? AND round_id=?", s.encode(state), now()-1, user, str(state, "roundId"));

    var recovered = practice.run(user, project, Map.of());
    assertEquals("ACTIVE", recovered.get("status"));
    assertFalse(recovered.containsKey("pendingExchange"));
    assertEquals(1, list(recovered, "turns").size());
    assertEquals(1, PracticeDialogue.count(list(recovered, "turns").get(0)));
    assertEquals(recovered, practice.run(user, project, Map.of()));
  }

  @Test void modelCannotAdvanceOnInventedEvidence() {
    String answer = "数据库使用唯一键拒绝相同请求。";
    var previous = List.<Map<String, Object>>of(Map.of("answer", "请求会带唯一的幂等键。", "reply", "如何处理重复请求？"));
    assertTrue(PracticeDialogue.parse(Map.of(
      "decision", "ADVANCE", "reply", "说清楚了。", "evidence", "使用唯一键拒绝相同请求"), previous, answer).advance());
    assertFalse(PracticeDialogue.parse(Map.of(
      "decision", "FOLLOW_UP", "reply", "重试会收到什么响应？"), previous, answer).advance());
    assertThrows(ResponseStatusException.class, () -> PracticeDialogue.parse(Map.of(
      "decision", "ADVANCE", "reply", "说清楚了。", "evidence", "如何处理重复请求"), previous, answer));
    assertThrows(ResponseStatusException.class, () -> PracticeDialogue.parse(Map.of(
      "decision", "ADVANCE", "reply", "说清楚了。", "evidence", "请求会带唯一的幂等键"), previous, "你好"));
  }
  ModelService dialogueModel() {
    return spy(new ModelService(s, "live", "https://model.example/v1", "synthetic-key", "test", "test"));
  }

  @Test void dialogueReceivesEarlierTopicsWithoutBorrowingTheirEvidence() {
    String answer = "我会从接口请求开始说明";
    var model = dialogueModel();
    var previous = Map.<String, Object>of("id", "before", "question", "如何去重？", "answer", "请求键在服务端持久化",
      "exchanges", List.of(Map.of("answer", "请求键在服务端持久化", "reply", "旧讲解")));
    var exchange = Map.<String, Object>of("answer", "超时会先查询状态", "reply", "然后怎样处理？");
    var current = Map.<String, Object>of("id", "now", "question", "怎样处理超时？", "exchanges", List.of(exchange));
    var future = Map.<String, Object>of("id", "future", "answer", "不应被传入的后续回答");
    var context = Map.<String, Object>of("project", Map.of("name", "合成项目"), "interviewTopic", "幂等",
      "turns", List.of(previous, current, future), "historyTurns", List.of(Map.of("answer", "另一场回答")));
    String saved = s.encode(context);
    doReturn(Map.of("decision", "FOLLOW_UP", "reply", "假设请求仍在处理，先查询已有状态。"))
      .when(model).call(anyString(), any());
    PracticeDialogue.decide(model, context, current, answer);
    var captor = org.mockito.ArgumentCaptor.forClass(Object.class);
    verify(model).call(anyString(), captor.capture());
    var input = PracticeRetest.object(captor.getValue());
    assertEquals(List.of(Map.of("id", "before", "question", "如何去重？", "answer", "请求键在服务端持久化")), input.get("completedTurns"));
    assertEquals(List.of(exchange), input.get("exchanges"));
    assertEquals(false, input.get("exchangesTruncated"));
    assertEquals(answer, input.get("latestAnswer"));
    assertEquals("幂等", input.get("interviewTopic"));
    assertFalse(input.containsKey("historyTurns"));
    assertEquals(saved, s.encode(context));

    if (!answer.equals("不会")) {
      doReturn(Map.of("decision", "ADVANCE", "reply", "好的", "evidence", "请求键在服务端持久化"))
        .when(model).call(anyString(), any());
      assertThrows(ResponseStatusException.class, () -> PracticeDialogue.decide(model, context, current, answer));
    }
  }

  @Test void longDialogueRetainsRecentCompleteExchangesAndTheEntireLatestAnswer() {
    var model = dialogueModel();
    var exchanges = new ArrayList<Map<String, Object>>();
    for (int i = 0; i < 6; i++) exchanges.add(Map.of("answer", "答".repeat(3000), "reply", "追问" + i, "internal", "不发送"));
    var turn = Map.<String, Object>of("id", "current", "question", "如何验证？", "exchanges", exchanges);
    String latest = "最新解释".repeat(750);
    doReturn(Map.of("decision", "FOLLOW_UP", "reply", "请说明预期结果。"))
      .when(model).call(anyString(), any());
    PracticeDialogue.decide(model, Map.of("project", Map.of()), turn, latest);
    var captor = org.mockito.ArgumentCaptor.forClass(Object.class);
    verify(model).call(anyString(), captor.capture());
    var input = PracticeRetest.object(captor.getValue());
    var recent = list(new LinkedHashMap<>(input), "exchanges");
    assertEquals(3, recent.size());
    assertEquals("追问3", recent.get(0).get("reply"));
    assertEquals("追问5", recent.get(2).get("reply"));
    assertEquals(3000, str(recent.get(0), "answer").length());
    assertFalse(recent.get(0).containsKey("internal"));
    assertEquals(true, input.get("exchangesTruncated"));
    assertEquals(latest, input.get("latestAnswer"));
    assertEquals(6, exchanges.size());
    assertTrue(exchanges.get(0).containsKey("internal"));
  }

  @Test void contextLimitKeepsSavedAnswerAndReleasesTheGenerationLease() {
    var f = fixture();
    var model = dialogueModel();
    var service = new ProjectPractice(s, projects, model);
    service.maxTurns = 1;
    service.journey = practice.journey;
    doReturn(new ModelService.GeneratedQuestion("请说明验证方法。", "验证"))
      .when(model).firstDeepQuestion(any());
    doThrow(new ModelContext.TooLarge()).when(model).report(any());
    var state = service.run(f[0], f[1], Map.of());
    String turnId = str(list(state, "turns").get(0), "id");
    assertEquals(413, assertThrows(ModelContext.TooLarge.class, () -> service.run(f[0], f[1],
      Map.of("turnId", turnId, "answer", "已保存的原始回答"))).getStatusCode().value());
    var failed = service.get(f[0], f[1]);
    assertEquals("FAILED", failed.get("status"));
    assertEquals(0L, failed.get("leaseUntil"));
    assertEquals("已保存的原始回答", list(failed, "turns").get(0).get("answer"));
    verify(model, times(1)).report(any());
  }

  @Test void retestContextLimitKeepsTheSupplementAndOriginalReport() {
    var f = fixture();
    var service = new ProjectPractice(s, projects, practice.model);
    service.maxTurns = 1;
    service.journey = practice.journey;
    var state = service.run(f[0], f[1], Map.of());
    String turnId = str(list(state, "turns").get(0), "id");
    state = service.run(f[0], f[1], Map.of("turnId", turnId, "answer", "原始回答"));
    var gateway = spy(practice.model);
    doThrow(new ModelContext.TooLarge()).when(gateway).report(any());
    var retesting = new PracticeRetest(s, service, gateway);
    var input = Map.<String, Object>of("turnId", turnId, "findingIndex", 0, "answer", "新的补答");
    assertEquals(413, assertThrows(ModelContext.TooLarge.class,
      () -> retesting.run(f[0], f[1], input)).getStatusCode().value());
    var failed = service.get(f[0], f[1]);
    assertEquals(state.get("report"), failed.get("report"));
    assertEquals(0L, failed.get("leaseUntil"));
    var saved = PracticeRetest.object(failed.get("retest"));
    assertEquals("FAILED", saved.get("status"));
    assertEquals("新的补答", saved.get("answer"));
    verify(gateway, times(1)).report(any());
  }
}
