package com.projectprobe;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
  properties = {
    "app.origin=http://localhost:5173",
    "spring.datasource.url=jdbc:h2:mem:request-boundary;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "app.model-mode=demo",
  }
)
@AutoConfigureMockMvc
class RequestBoundaryTest {

  @Autowired
  MockMvc mvc;
  @Autowired Store store;
  @Autowired ExampleSessions examples;

  @Test
  void requestIdIsGeneratedByServerAndMalformedJsonIsClientError()
    throws Exception {
    var response = mvc
      .perform(
        post("/api/auth/register")
          .header("Origin", "http://localhost:5173")
          .header("X-Request-ID", "untrusted-request-id")
          .contentType("application/json")
          .content("{broken")
      )
      .andExpect(status().isBadRequest())
      .andReturn()
      .getResponse();
    assertNotEquals("untrusted-request-id", response.getHeader("X-Request-ID"));
    assertDoesNotThrow(() ->
      java.util.UUID.fromString(response.getHeader("X-Request-ID"))
    );
  }

  @Test
  void oversizedJsonIsRejectedBeforeBinding() throws Exception {
    mvc
      .perform(
        post("/api/auth/register")
          .header("Origin", "http://localhost:5173")
          .contentType("application/json")
          .content(" ".repeat(200001))
      )
      .andExpect(status().isPayloadTooLarge());
  }

  @Test
  void examplesCanRestartAndExpireWithoutGrantingAccountAccess() throws Exception {
    String origin = "http://localhost:5173";
    String open = "/api/examples/projects/booking/open";
    mvc.perform(post(open).header("Origin", "https://other.example"))
      .andExpect(status().isForbidden());
    var first = mvc.perform(post(open).header("Origin", origin))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.name").value("校园自习室预约系统"))
      .andReturn().getResponse();
    var cookie = first.getCookie("probe_example");
    assertNotNull(cookie);
    assertEquals("/api/examples", cookie.getPath());
    assertTrue(cookie.isHttpOnly());
    String id = store.json.readTree(first.getContentAsByteArray()).path("id").asText();
    String practice = "/api/examples/projects/" + id + "/practice";
    mvc.perform(post(open).header("Origin", origin).cookie(cookie))
      .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id));
    mvc.perform(get("/api/me").cookie(cookie)).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/projects/" + id + "/practice").cookie(cookie))
      .andExpect(status().isUnauthorized());
    mvc.perform(get(practice)).andExpect(status().isNotFound());
    var started = mvc.perform(post(practice).header("Origin", origin).cookie(cookie)
        .contentType("application/json").content("{}"))
      .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ACTIVE"))
      .andReturn().getResponse();
    JsonNode round = store.json.readTree(started.getContentAsByteArray());
    mvc.perform(get("/api/examples/practice-history").cookie(cookie))
      .andExpect(status().isOk()).andExpect(jsonPath("$[0].roundId").value(round.path("roundId").asText()));
    var other = mvc.perform(post(open).header("Origin", origin))
      .andExpect(status().isOk()).andReturn().getResponse();
    assertNotEquals(id, store.json.readTree(other.getContentAsByteArray()).path("id").asText());
    mvc.perform(get(practice).cookie(other.getCookie("probe_example"))).andExpect(status().isNotFound());

    String hash = Auth.hash(cookie.getValue());
    String user = store.db.queryForObject("SELECT user_id FROM example_sessions WHERE token_hash=?", String.class, hash);
    store.db.update("UPDATE example_sessions SET expires_at=? WHERE token_hash=?", Store.now(), hash);
    mvc.perform(get("/api/examples/practice-history").cookie(cookie))
      .andExpect(status().isOk()).andExpect(content().json("[]"));
    examples.purgeExpired();
    assertEquals(0, store.db.queryForObject("SELECT COUNT(*) FROM app_users WHERE id=?", Integer.class, user));
    assertEquals(0, store.db.queryForObject("SELECT COUNT(*) FROM projects WHERE id=?", Integer.class, id));
  }
}
