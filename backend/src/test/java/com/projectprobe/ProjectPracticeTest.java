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
