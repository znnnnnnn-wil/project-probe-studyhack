package com.projectprobe;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api")
class PracticeApi {
  final Auth auth; final ProjectPractice practice; final PracticeRetest retest; final InterviewSpeech speech;
  final InputService inputs;
  PracticeApi(Auth auth, ProjectPractice practice, PracticeRetest retest, InterviewSpeech speech, InputService inputs) {
    this.auth = auth; this.practice = practice; this.retest = retest; this.speech = speech;
    this.inputs = inputs;
  }
  @GetMapping("/practice-history") Object history(HttpServletRequest r) {
    return practice.history(auth.user(r));
  }
  @GetMapping("/projects/{id}/practice") Object get(HttpServletRequest r, @PathVariable String id) { return practice.get(auth.user(r), id); }
  @PostMapping("/projects/{id}/practice") Object run(HttpServletRequest r, @PathVariable String id, @RequestBody Map<String, Object> input) { return practice.run(auth.user(r), id, input); }
  @PostMapping("/projects/{id}/practice/tts") void tts(HttpServletRequest req, HttpServletResponse res, @PathVariable String id, @RequestBody Map<String, Object> input) {
    speech.speak(auth.user(req), id, Store.str(input, "turnId"), input.get("exchangeCount"), res);
  }
  @PostMapping(value = "/projects/{id}/practice/transcribe", consumes = "multipart/form-data")
  Map<String, Object> transcribe(
    HttpServletRequest r,
    @PathVariable String id,
    @RequestParam("turnId") String turnId,
    @RequestParam(value = "exchangeCount", required = false) Integer exchangeCount,
    @RequestParam("file") MultipartFile file
  ) {
    String user = auth.user(r);
    practice.requireUnansweredTurn(user, id, turnId, exchangeCount);
    var result = inputs.transcribe(user, file);
    practice.requireUnansweredTurn(user, id, turnId, exchangeCount);
    return result;
  }
  @PostMapping("/projects/{id}/practice/retest") Object retest(HttpServletRequest r, @PathVariable String id, @RequestBody Map<String, Object> input) {
    return retest.run(auth.user(r), id, input);
  }
}
