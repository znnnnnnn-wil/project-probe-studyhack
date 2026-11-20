package com.projectprobe;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class PracticeTranscriptionTest {
  private final Auth auth = mock(Auth.class);
  private final ProjectPractice practice = mock(ProjectPractice.class);
  private final InputService inputs = mock(InputService.class);
  private final MockMvc mvc = MockMvcBuilders.standaloneSetup(
    new PracticeApi(auth, practice, null, null, inputs)
  ).setControllerAdvice(new Errors()).build();

  private MockMultipartHttpServletRequestBuilder transcribe() {
    when(auth.user(any())).thenReturn("user");
    var request = multipart("/api/projects/project/practice/transcribe")
      .file(new MockMultipartFile("file", "answer.wav", "audio/wav", new byte[] { 1 }));
    request.param("turnId", "turn").param("exchangeCount", "0");
    return request;
  }

  @ParameterizedTest
  @ValueSource(strings = { "已有识别正在执行，请稍后再试", "识别已超时，请重新发起" })
  void transcriptionLeaseFailureUsesRetryableStatus(String message) throws Exception {
    when(inputs.transcribe(eq("user"), any())).thenThrow(Store.error(409, message));

    mvc.perform(transcribe())
      .andExpect(status().isServiceUnavailable())
      .andExpect(header().string("Retry-After", "3"))
      .andExpect(jsonPath("$.message").value(message));
  }

  @Test
  void staleQuestionIsRejectedBeforeTranscription() throws Exception {
    when(practice.requireUnansweredTurn("user", "project", "turn", 0))
      .thenThrow(Store.error(409, "本题已结束，请重新加载当前问题"));

    mvc.perform(transcribe()).andExpect(status().isConflict());
    verifyNoInteractions(inputs);
  }

  @Test
  void questionChangedDuringTranscriptionStillReturnsConflict() throws Exception {
    when(inputs.transcribe(eq("user"), any())).thenReturn(Map.of("text", "合成回答"));
    when(practice.requireUnansweredTurn("user", "project", "turn", 0))
      .thenReturn(Map.of("id", "turn"))
      .thenThrow(Store.error(409, "本题已结束，请重新加载当前问题"));

    mvc.perform(transcribe())
      .andExpect(status().isConflict())
      .andExpect(jsonPath("$.text").doesNotExist());
  }
}
