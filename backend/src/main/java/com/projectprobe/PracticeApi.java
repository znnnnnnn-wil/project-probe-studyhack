package com.projectprobe;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
class PracticeApi {
  final Auth auth; final ProjectPractice practice; final PracticeRetest retest;
  PracticeApi(Auth auth, ProjectPractice practice, PracticeRetest retest) {
    this.auth = auth; this.practice = practice; this.retest = retest;
  }
  @GetMapping("/practice-history") Object history(HttpServletRequest r) {
    return practice.history(auth.user(r));
  }
  @GetMapping("/projects/{id}/practice") Object get(HttpServletRequest r, @PathVariable String id) { return practice.get(auth.user(r), id); }
  @PostMapping("/projects/{id}/practice") Object run(HttpServletRequest r, @PathVariable String id, @RequestBody Map<String, Object> input) { return practice.run(auth.user(r), id, input); }
  @PostMapping("/projects/{id}/practice/retest") Object retest(HttpServletRequest r, @PathVariable String id, @RequestBody Map<String, Object> input) {
    return retest.run(auth.user(r), id, input);
  }
}
