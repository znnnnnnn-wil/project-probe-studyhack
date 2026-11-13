package com.projectprobe;

import static com.projectprobe.Store.*;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
class ProjectPractice {
  final Store s; final ProjectService projects; final ModelService model;
  @org.springframework.beans.factory.annotation.Value("${app.practice-max-turns:1}") int maxTurns;
  @org.springframework.beans.factory.annotation.Autowired JourneyMetrics journey;
  ProjectPractice(Store s, ProjectService projects, ModelService model) { this.s = s; this.projects = projects; this.model = model; }
  Map<String, Object> get(String user, String project) {
    projects.get(user, project);
    var rows = s.db.queryForList("SELECT * FROM project_trials WHERE user_id=?", user);
    if (rows.isEmpty()) return Map.of("status", "AVAILABLE", "maxTurns", maxTurns);
    var row = rows.get(0);
    if (!project.equals(row.get("project_id")) || "CLEARED".equals(row.get("status"))) return Map.of("status", "USED");
    var result = s.decode(row.get("body"));
    long lease = ((Number) row.get("lease_until")).longValue();
    result.put("status", "GENERATING".equals(row.get("status")) && lease <= now() ? "FAILED" : row.get("status"));
    result.put("leaseUntil", lease); return result;
  }
  Map<String, Object> run(String user, String projectId, Map<String, Object> input) {
    String token = id();
    var claim = s.locked(user, () -> {
      var current = get(user, projectId); String status = str(current, "status");
      if (status.equals("USED")) throw error(409, "本账号已完成免费训练，请返回原项目查看问答与复盘");
      if (status.equals("COMPLETED")) return null;
      if (status.equals("AVAILABLE")) {
        var project = new LinkedHashMap<>(projects.get(user, projectId));
        project.put("facts", list(project, "facts").stream().filter(f -> Boolean.TRUE.equals(f.get("confirmed"))).toList());
        if (maxTurns < 1 || maxTurns > 5) throw error(503, "免费训练轮数配置不正确");
        current = new LinkedHashMap<>(Map.of("project", project, "kind", "TRIAL", "turns", new ArrayList<>(), "modelMode", model.mode, "maxTurns", maxTurns));
        s.db.update("INSERT INTO project_trials(user_id,project_id,status,body) VALUES (?,?,?,?)", user, projectId, "PENDING", s.encode(current));
        journey.record(user, "TRIAL_STARTED", projectId);
      } else {
        var row = s.one("SELECT * FROM project_trials WHERE user_id=?", user);
        if (status.equals("GENERATING") && ((Number) row.get("lease_until")).longValue() > now()) throw error(409, "体验正在生成，请稍后刷新");
      }
      var turns = list(current, "turns");
      if (!turns.isEmpty()) {
        var turn = turns.get(turns.size() - 1); String answer = str(input, "answer").strip();
        int limit = ((Number) current.getOrDefault("maxTurns", 1)).intValue();
        if (!answer.isBlank() && limit > 1 && !str(turn, "id").equals(str(input, "turnId")))
          throw error(409, "当前问题已变化，请重新读取后再提交");
        if (answer.isBlank() && str(turn, "answer").isBlank()) {
          s.db.update("UPDATE project_trials SET status='ACTIVE',lease_until=0,lease_token=NULL WHERE user_id=?", user);
          return null;
        }
        if (!answer.isBlank()) {
          if (answer.length() > 3000) throw error(400, "体验回答最多3000字");
          if (!str(turn, "answer").isBlank() && !answer.equals(turn.get("answer"))) throw error(409, "体验回答已提交");
          turn.put("answer", answer);
        }
      }
      s.db.update("UPDATE project_trials SET status='GENERATING',body=?,lease_until=?,lease_token=? WHERE user_id=?",
        s.encode(current), now() + 90000, token, user);
      return current;
    });
    if (claim == null) return get(user, projectId);
    try {
      var turns = list(claim, "turns");
      if (turns.isEmpty()) {
        var question = model.firstDeepQuestion(claim);
        turns.add(new LinkedHashMap<>(Map.of("id", id(), "question", question.question(), "topic", question.topic(), "answer", "")));
      } else if (str(turns.get(turns.size() - 1), "answer").isBlank()) {
        // An unanswered question is never replaced by a retry.
      } else if (turns.size() < ((Number) claim.getOrDefault("maxTurns", 1)).intValue()) {
        var question = model.question(claim);
        turns.add(new LinkedHashMap<>(Map.of("id", id(), "question", question.question(), "topic", question.topic(), "answer", "")));
      } else claim.put("report", model.report(claim));
      s.locked(user, () -> {
        var row = s.one("SELECT * FROM project_trials WHERE user_id=?", user);
        if (!token.equals(row.get("lease_token")) || ((Number) row.get("lease_until")).longValue() <= now()) throw error(409, "生成租约已失效，请重试");
        s.db.update("UPDATE project_trials SET status=?,body=?,lease_until=0,lease_token=NULL WHERE user_id=?",
          claim.containsKey("report") ? "COMPLETED" : "ACTIVE", s.encode(claim), user);
        if (claim.containsKey("report")) journey.record(user, "TRIAL_COMPLETED", projectId);
        return null;
      });
    } catch (Exception e) {
      s.db.update("UPDATE project_trials SET status='FAILED',lease_until=0 WHERE user_id=? AND lease_token=?", user, token);
      throw error(503, "体验生成失败，已保存进度，可在原项目重试");
    }
    return get(user, projectId);
  }
}
