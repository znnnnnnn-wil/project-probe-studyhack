package com.projectprobe;

import static com.projectprobe.Store.*;
import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(properties = {"spring.datasource.url=jdbc:h2:mem:competition-practice;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
  "app.model-mode=demo", "app.payment.mode=mock", "app.payment.reconcile-enabled=false", "app.practice-max-turns=5"})
class CompetitionPracticeTest {
  @Autowired Store s;
  @Autowired ProjectService projects;
  @Autowired ProjectPractice practice;
  String[] fixture() {
    String user = id();
    s.db.update("INSERT INTO app_users VALUES (?,?,?,?)", user, user, "unused", now());
    var project = projects.save(user, null, Map.of("name", "合成预约项目", "responsibility", "预约接口、数据库约束", "verification", "并发测试尚未完成"));
    return new String[]{user, str(project, "id")};
  }
  @Test void completesFiveTurnsWithoutOrdersAndRejectsStaleSubmissions() {
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
    assertEquals(0, s.db.queryForObject("SELECT COUNT(*) FROM purchase_orders WHERE user_id=?", Integer.class, f[0]));
    assertEquals(0, s.db.queryForObject("SELECT COUNT(*) FROM training_packages WHERE user_id=?", Integer.class, f[0]));
    assertThrows(ResponseStatusException.class, () -> practice.get(id(), f[1]));
  }
  @Test void resumesSavedAnswerAfterExpiredGenerationWithoutLosingOrDuplicatingIt() {
    var f = fixture();
    var state = practice.run(f[0], f[1], Map.of());
    list(state, "turns").get(0).put("answer", "已经提交的回答，故障后应保留。");
    s.db.update("UPDATE project_trials SET body=?,status='GENERATING',lease_until=? WHERE user_id=?", s.encode(state), now()-1, f[0]);
    assertEquals("FAILED", practice.get(f[0], f[1]).get("status"));
    var recovered = practice.run(f[0], f[1], Map.of());
    assertEquals("ACTIVE", recovered.get("status"));
    assertEquals(2, list(recovered, "turns").size());
    assertEquals("已经提交的回答，故障后应保留。", list(recovered, "turns").get(0).get("answer"));
    assertEquals(recovered, practice.run(f[0], f[1], Map.of()));
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
}
