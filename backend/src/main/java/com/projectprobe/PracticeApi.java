package com.projectprobe;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
class PracticeApi {
  final Auth auth; final ProjectPractice practice; final PracticeRetest retest; final InterviewSpeech speech;
  PracticeApi(Auth auth, ProjectPractice practice, PracticeRetest retest, InterviewSpeech speech) {
    this.auth = auth; this.practice = practice; this.retest = retest; this.speech = speech;
  }
  @GetMapping("/practice-history") Object history(HttpServletRequest r) {
    return practice.history(auth.user(r));
  }
  @GetMapping("/projects/{id}/practice") Object get(HttpServletRequest r, @PathVariable String id) { return practice.get(auth.user(r), id); }
  @PostMapping("/projects/{id}/practice") Object run(HttpServletRequest r, @PathVariable String id, @RequestBody Map<String, Object> input) { return practice.run(auth.user(r), id, input); }
  @PostMapping("/projects/{id}/practice/tts") void tts(HttpServletRequest req, HttpServletResponse res, @PathVariable String id, @RequestBody Map<String, Object> input) {
    speech.speak(auth.user(req), id, Store.str(input, "turnId"), res);
  }
  @PostMapping("/projects/{id}/practice/retest") Object retest(HttpServletRequest r, @PathVariable String id, @RequestBody Map<String, Object> input) {
    return retest.run(auth.user(r), id, input);
  }
}
