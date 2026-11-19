package com.projectprobe;
import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(properties = {"spring.datasource.url=${PROBE_TEST_DB_URL:jdbc:h2:mem:practice;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1}",
  "spring.datasource.username=${PROBE_TEST_DB_USER:sa}", "spring.datasource.password=${PROBE_TEST_DB_PASSWORD:}",
  "app.model-mode=demo", "app.practice-max-turns=1"})
class ProjectPracticeTest {
  @Autowired Store s; @Autowired ProjectService projects; @Autowired ProjectPractice practice;
  @Test void projectsHaveIndependentRoundsAndKeepPastReports() {
    String user = id(); s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    var p = projects.save(user, null, Map.of("name", "合成预约项目", "responsibility", "接口实现"));
    String project = str(p, "id");
    var first = practice.run(user, project, Map.of());
    assertEquals("ACTIVE", first.get("status"));
    assertEquals(first, practice.run(user, project, Map.of()));
    var complete = practice.run(user, project, Map.of("answer", "我在数据库约束中防止重复预约。"));
    assertEquals("COMPLETED", complete.get("status"));
    assertTrue(complete.containsKey("report"));
    assertFalse(PracticeRetest.object(complete.get("report")).containsKey("scoring"));
    assertEquals(complete, practice.run(user, project, Map.of()));
    var another = projects.save(user, null, Map.of("name", "另一项目", "responsibility", "测试"));
    String anotherProject = str(another, "id");
    assertEquals("AVAILABLE", practice.get(user, anotherProject).get("status"));
    var activeOtherProject = practice.run(user, anotherProject, Map.of());
    assertEquals("ACTIVE", activeOtherProject.get("status"));
    assertEquals(complete, practice.get(user, project));
    String oldRoundId = str(complete, "roundId");
    var restart = Map.<String, Object>of("restart", true, "roundId", oldRoundId);
    var next = practice.run(user, project, restart);
    assertEquals("ACTIVE", next.get("status"));
    assertEquals(2L, next.get("roundNumber"));
    assertNotEquals(oldRoundId, next.get("roundId"));
    assertEquals(complete, practice.get(user, project, oldRoundId));
    assertEquals(activeOtherProject, practice.get(user, anotherProject));
    assertEquals(3, practice.history(user).size());
    String oldTurnId = str(list(complete, "turns").get(0), "id");
    String nextTurnId = str(list(next, "turns").get(0), "id");
    assertThrows(ResponseStatusException.class, () -> practice.requireUnansweredTurn(user, project, oldTurnId, 0));
    assertThrows(ResponseStatusException.class, () -> practice.run(user, project, Map.of("turnId", oldTurnId, "answer", "上一轮的迟到发言")));
    assertEquals(nextTurnId, practice.requireUnansweredTurn(user, project, nextTurnId, 0).get("id"));
    assertThrows(ResponseStatusException.class, () -> practice.run(user, project, restart));
    assertThrows(ResponseStatusException.class, () -> practice.get(user, anotherProject, oldRoundId));
    assertThrows(ResponseStatusException.class, () -> practice.get(id(), project));
    assertEquals(0, s.db.queryForObject("SELECT COUNT(*) FROM trainings WHERE user_id=?", Integer.class, user));
  }

  @Test void scoresUseOnlyAnsweredEvidenceAndAreSavedWithThePractice() {
    String user = id();
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    String project = str(projects.save(user, null, Map.of("name", "合成评分项目")), "id");
    var scores = new ArrayList<>(List.of(
      Map.of("key", "clarity", "level", 4, "reason", "直接回答了职责。", "turnIds", List.of("T1"), "evidenceQuote", "我负责测试"),
      Map.of("key", "ownership", "level", 4, "reason", "区分了自己的职责。", "turnIds", List.of("T1"), "evidenceQuote", "我负责测试"),
      Map.of("key", "depth", "level", 3, "reason", "解释了部分实现。", "turnIds", List.of("T1"), "evidenceQuote", "我负责测试"),
      Map.of("key", "validation", "level", 5, "reason", "给出了具体测试。", "turnIds", List.of("T1"), "evidenceQuote", "我负责测试")
    ));
    var model = new ModelService(s, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
      @Override GeneratedQuestion firstDeepQuestion(Map<String, Object> body) {
        return new GeneratedQuestion("你负责哪部分？", "职责边界");
      }

      @Override Map<String, Object> call(String rule, Object input) {
        assertTrue(rule.contains("practiceScores"));
        return new LinkedHashMap<>(Map.of(
          "clearParts", List.of("说清了个人职责。"),
          "findings", List.of(new LinkedHashMap<>(Map.of("topic", "验证", "assessment", "没说清用例。", "task", "补充测试输入和预期结果。", "turnIds", List.of("T1"), "factIds", List.of()))),
          "retestTopics", List.of("验证"),
          "practiceScores", scores
        ));
      }
    };
    var livePractice = new ProjectPractice(s, projects, model);
    livePractice.maxTurns = 1;
    livePractice.journey = practice.journey;
    var first = livePractice.run(user, project, Map.of("topic", "测试用例"));
    String firstRound = str(first, "roundId");
    var legacy = s.decode(s.one("SELECT body FROM project_practice_rounds WHERE user_id=? AND round_id=?", user, firstRound).get("body"));
    legacy.put("kind", "TRIAL");
    s.db.update("UPDATE project_practice_rounds SET body=? WHERE user_id=? AND round_id=?", s.encode(legacy), user, firstRound);
    var completed = livePractice.run(user, project, Map.of("answer", "我负责测试"));
    var scoring = PracticeRetest.object(PracticeRetest.object(completed.get("report")).get("scoring"));
    assertEquals(80, scoring.get("total"));
    assertEquals(List.of(str(list(first, "turns").get(0), "id")), list(scoring, "dimensions").get(0).get("turnIds"));

    var summary = livePractice.history(user).get(0);
    assertEquals(Boolean.TRUE, summary.get("hasScoring"));
    assertEquals(80, summary.get("totalScore"));
    assertEquals("测试用例", summary.get("interviewTopic"));
    assertEquals("补充测试输入和预期结果。", summary.get("prioritySuggestion"));
    assertTrue(((Number) summary.get("startedAt")).longValue() > 0);

    scores.set(0, Map.of("key", "clarity", "level", 5, "reason", "引用了不存在的题目。", "turnIds", List.of("T2"), "evidenceQuote", "我负责测试"));
    scores.set(1, Map.of("key", "ownership", "level", 5, "reason", "引用了不存在的原文。", "turnIds", List.of("T1"), "evidenceQuote", "我负责开发"));
    livePractice.run(user, project, Map.of("restart", true, "roundId", str(completed, "roundId")));
    var second = livePractice.run(user, project, Map.of("answer", "我负责测试"));
    assertEquals("COMPLETED", second.get("status"));
    var secondScoring = PracticeRetest.object(PracticeRetest.object(second.get("report")).get("scoring"));
    assertNull(secondScoring.get("total"));
    assertNull(list(secondScoring, "dimensions").get(0).get("score"));
    assertNull(list(secondScoring, "dimensions").get(1).get("score"));
    assertEquals(15, list(secondScoring, "dimensions").get(2).get("score"));
    assertEquals(80, livePractice.history(user).get(1).get("totalScore"));
  }

  @Test void canScoreAnAlreadyCompletedLiveReportWithoutRewritingFeedback() {
    String user = id();
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    String project = str(projects.save(user, null, Map.of("name", "合成历史评分项目")), "id");
    String round = id();
    var originalReport = Map.of("mode", "live", "clearParts", List.of("说清了职责。"));
    var body = Map.of("kind", "TRIAL", "modelMode", "live", "report", originalReport,
      "turns", List.of(Map.of("id", "answered", "question", "你负责哪部分？", "answer", "我负责测试"),
        Map.of("id", "unanswered", "question", "尚无回答的问题", "answer", "")));
    s.db.update("INSERT INTO project_practice_rounds(user_id,project_id,round_id,round_number,started_at,status,body) VALUES (?,?,?,?,?,'COMPLETED',?)",
      user, project, round, 1, 0, s.encode(body));
    var calls = new java.util.concurrent.atomic.AtomicInteger();
    var live = new ModelService(s, "live", "https://never-called.invalid", "synthetic", "synthetic", "test") {
      @Override Map<String, Object> call(String rule, Object input) {
        assertEquals(Map.of("allowedTurnIds", Set.of("T1"), "answeredTurns", List.of(
          Map.of("id", "T1", "question", "你负责哪部分？", "answer", "我负责测试"))), input);
        if (calls.incrementAndGet() == 1) return Map.of();
        return Map.of("practiceScores", List.of(Map.of("key", "ownership", "level", 4,
          "reason", "说明了测试职责。", "turnIds", List.of("T1"), "evidenceQuote", "我负责测试")));
      }
    };
    var livePractice = new ProjectPractice(s, projects, live);
    assertThrows(ResponseStatusException.class, () -> practice.score(user, project, round));
    assertThrows(ResponseStatusException.class, () -> livePractice.score(user, project, round));
    var afterFailure = livePractice.get(user, project, round);
    assertEquals(originalReport, afterFailure.get("report"));
    assertEquals(0L, afterFailure.get("leaseUntil"));
    var scored = livePractice.score(user, project, round);
    assertEquals("COMPLETED", scored.get("status"));
    assertEquals(afterFailure.get("turns"), scored.get("turns"));
    var scoredReport = PracticeRetest.object(scored.get("report"));
    assertNotNull(scoredReport.get("scoring"));
    assertEquals(originalReport.get("clearParts"), scoredReport.get("clearParts"));
    assertEquals(Boolean.TRUE, livePractice.history(user).get(0).get("hasScoring"));
    assertEquals(scored, livePractice.score(user, project, round));
    assertEquals(2, calls.get());
  }

  @Test void expiredQuestionLeaseCanRecoverWithoutGeneratingAnEmptyReport() {
    String user = id(); s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    var p = projects.save(user, null, Map.of("name", "合成恢复项目", "responsibility", "接口"));
    String project = str(p, "id");
    String roundId = str(practice.run(user, project, Map.of()), "roundId");
    s.db.update("UPDATE project_practice_rounds SET status='GENERATING',lease_until=? WHERE user_id=? AND round_id=?", now() + 60000, user, roundId);
    assertEquals("GENERATING", practice.get(user, project).get("status"));
    assertThrows(ResponseStatusException.class, () -> practice.run(user, project, Map.of()));
    s.db.update("UPDATE project_practice_rounds SET lease_until=? WHERE user_id=? AND round_id=?", now() - 1, user, roundId);
    assertEquals("FAILED", practice.get(user, project).get("status"));
    var recovered = practice.run(user, project, Map.of());
    assertEquals("ACTIVE", recovered.get("status"));
    assertFalse(recovered.containsKey("report"));
  }
}
