import { test, expect } from "@playwright/test";
import { demoProject } from "../src/api";

test("按项目归档每场面试，刷新后仍可从评分跳到原对话", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const projectId = "timeflow";
  const completedId = "completed-session";
  const activeId = "active-session";
  const firstAnswer = "我负责把语音指令转换成日程。";
  const followUp = "如何确认相同请求只写入一次？";
  const nextAnswer = "我按请求 ID 查重，准备用并发提交确认。";
  const suggestion = "补充两次并发提交的预期结果。";
  const base = {
    projectId, name: "TimeFlow 开源语音日程助手", maxTurns: 5,
    retestCompleted: false, startedAt: Date.UTC(2026, 10, 19, 2),
  };
  const history = [
    { ...base, roundId: activeId, roundNumber: 2, status: "ACTIVE", answeredCount: 0, interviewTopic: "重复请求", prioritySuggestion: "" },
    {
      ...base, roundId: completedId, roundNumber: 1, status: "COMPLETED", answeredCount: 5,
      interviewTopic: "语音录入", totalScore: 85, hasScoring: true, prioritySuggestion: suggestion,
    },
    { ...base, projectId: "another-project", name: "另一个项目", roundId: "other-session", roundNumber: 1, status: "ACTIVE", answeredCount: 0, interviewTopic: "", prioritySuggestion: "" },
  ];
  const turn = {
    id: "request-turn", topic: "请求处理", question: "请介绍语音录入流程。",
    answer: `${firstAnswer}\n${nextAnswer}`,
    exchanges: [{ answer: firstAnswer, reply: followUp }, { answer: nextAnswer, reply: "" }],
  };
  let archiveReads = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let json: unknown;
    if (url.pathname === "/api/config") json = { modelMode: "live" };
    else if (url.pathname === "/api/me") json = { id: "synthetic", username: "训练记录验证" };
    else if (url.pathname === "/api/practice-history") json = history;
    else if (url.pathname === "/api/training-projects") json = [];
    else if (url.pathname === "/api/training-page") json = { items: [], total: 0, offset: 0, limit: 20, hasMore: false };
    else if (url.pathname === `/api/projects/${projectId}/practice`) {
      archiveReads++;
      if (url.searchParams.get("roundId") === activeId) {
        json = {
          ...history[0], turns: [{ ...turn, answer: "", exchanges: [{ answer: firstAnswer, reply: followUp }] }],
        };
      } else {
        expect(url.searchParams.get("roundId")).toBe(completedId);
        json = {
          ...history[1], turns: [turn], modelMode: "live",
          report: {
            mode: "live", clearParts: ["说明了语音到日程的转换。"], retestTopics: [],
            findings: [{
              topic: "验证重复请求", assessment: "缺少并发验证。", task: suggestion,
              evidence: [{ turnId: turn.id, question: turn.question, quote: nextAnswer }],
              materials: [], turnIds: [turn.id], factIds: [],
            }],
            scoring: {
              total: 85,
              dimensions: [
                { key: "clarity", score: 25, reason: "说明了请求链路。", turnIds: [turn.id] },
                { key: "ownership", score: 25, reason: "说明了本人职责。", turnIds: [turn.id] },
                { key: "depth", score: 20, reason: "说明了请求查重。", turnIds: [turn.id] },
                { key: "validation", score: 15, reason: "给出了验证方法。", turnIds: [turn.id] },
              ],
            },
          },
        };
      }
    } else throw new Error("未预期请求：" + url.pathname);
    await route.fulfill({ json });
  });

  await page.goto("/#/history");
  const projectLink = page.getByRole("link", { name: /TimeFlow 开源语音日程助手/ });
  await expect(projectLink).toHaveCount(1);
  await expect(projectLink).toContainText(/2\s*次/);
  expect(archiveReads).toBe(0);
  await projectLink.click();
  await expect(page.getByText("重复请求", { exact: true })).toBeVisible();
  await expect(page.getByText("语音录入", { exact: true })).toBeVisible();
  await expect(page.getByText(suggestion, { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "继续训练", exact: true })).toBeVisible();
  expect(archiveReads).toBe(0);

  await page.locator(`a[href="#/history/${projectId}/${activeId}"]`).click();
  await expect(page.getByText(followUp, { exact: true })).toBeVisible();
  await expect(page.getByText(firstAnswer, { exact: true })).toBeVisible();
  await page.goBack();
  await page.locator(`a[href="#/history/${projectId}/${completedId}"]`).click();
  await expect(page.getByRole("heading", { name: "讲得好的地方" })).toBeVisible();
  await page.reload();
  const scoring = page.getByRole("region", { name: "本场评分" });
  await expect(scoring.getByText("给出了验证方法。", { exact: true })).toBeVisible();
  await expect(scoring.getByText(/85\s*\/\s*100/)).toBeVisible();
  await scoring.getByRole("button", { name: "查看第 1 题对话" }).last().click();
  await expect(page.locator('[aria-label="第 1 题对话"]')).toBeFocused();
  await expect(page.getByText(firstAnswer, { exact: true })).toBeVisible();
  await expect(page.getByText(followUp, { exact: true })).toBeVisible();
  await expect(page.locator('[aria-label="第 1 题对话"]').getByText(nextAnswer, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test("训练记录分页、服务端筛选与展开后读取原问答", async ({ page }) => {
  const records = Array.from({ length: 21 }, (_, index) => ({
    id: "archive-" + index,
    status: "COMPLETED",
    kind: "DEEP",
    maxTurns: 5,
    createdAt: Date.now() - index,
    project: {
      id: index === 20 ? "b" : "a",
      name: index === 20 ? "项目乙" : "项目甲",
    },
    answeredCount: 1,
    turnCount: 1,
    historyKey: index === 20 ? "key-b" : "key-a",
  }));
  let detailReads = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let json: unknown;
    if (url.pathname === "/api/config")
      json = { modelMode: "demo" };
    else if (url.pathname === "/api/me")
      json = { id: "synthetic", username: "分页回归" };
    else if (url.pathname === "/api/practice-history")
      json = [];
    else if (url.pathname === "/api/training-projects")
      json = [
        { key: "key-a", name: "项目甲" },
        { key: "key-b", name: "项目乙" },
      ];
    else if (url.pathname === "/api/training-page") {
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      const key = url.searchParams.get("key");
      const selected = records.filter(
        (record) => !key || record.historyKey === key,
      );
      json = {
        items: selected.slice(offset, offset + limit),
        total: selected.length,
        offset,
        limit,
        hasMore: offset + limit < selected.length,
      };
    } else if (url.pathname.startsWith("/api/trainings/")) {
      detailReads++;
      json = {
        turns: [
          {
            id: "turn",
            question: "展开后才读取的问题",
            topic: "验证",
            answer: "保留完整原回答",
          },
        ],
      };
    } else throw new Error("未预期请求：" + url.pathname);
    await route.fulfill({ json });
  });
  await page.goto("/#/history");
  await expect(page.locator(".history-record")).toHaveCount(20);
  expect(detailReads).toBe(0);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".history-record")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "下一页", exact: true }),
  ).toBeDisabled();
  await page.locator(".archive-details summary").click();
  await expect(page.getByText("保留完整原回答", { exact: true })).toBeVisible();
  expect(detailReads).toBe(1);
  await page.getByRole("combobox", { name: /筛选训练项目/ }).click();
  await page.getByRole("option", { name: "项目甲", exact: true }).click();
  await expect(page.locator(".history-record")).toHaveCount(20);
  await expect(
    page.getByRole("button", { name: "上一页", exact: true }),
  ).toBeDisabled();
});

for (const width of [1440, 390]) {
  test(`多轮首题变化、完整问答刷新与项目筛选 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const post = async (path: string, data: unknown = {}) => {
      const response = await page.request.post("/api" + path, {
        headers: { Origin: new URL(test.info().project.use.baseURL || "http://localhost:5174").origin },
        data,
      });
      expect(response.ok()).toBeTruthy();
      return response.json();
    };
    await post("/auth/register", {
      username: "history-" + crypto.randomUUID(),
      password: "synthetic-test-password",
    });
    const project = async (name: string) => {
      let p = await post("/projects", {
        ...demoProject,
        name,
        resume: name + "：我负责接口与并发测试。",
      });
      p = await post("/projects/" + p.id + "/extract");
      return post("/projects/" + p.id + "/confirm", {
        version: p.version,
        facts: p.facts,
      });
    };
    const p = await project("多轮合成预约项目");
    const first = await post("/trainings", {
      projectId: p.id,
      requestKey: crypto.randomUUID(),
    });
    const firstQuestion = first.turns[0].question;
    await post("/trainings/" + first.id + "/answer", {
      turnId: first.turns[0].id,
      answer: "第一轮：我负责预约接口，实际验证结果待补充。",
    });
    const second = await post("/trainings", {
      projectId: p.id,
      requestKey: crypto.randomUUID(),
    });
    expect(second.turns[0].question).not.toBe(firstQuestion);
    await post("/trainings/" + second.id + "/answer", {
      turnId: second.turns[0].id,
      answer: "第二轮：我补充了错误恢复说明，尚未记录测试结果。",
    });
    const other = await project("另一份合成项目");
    await post("/trainings", {
      projectId: other.id,
      requestKey: crypto.randomUUID(),
    });
    await page.goto("/#/history");
    await expect(page.locator(".history-record")).toHaveCount(3);
    await page.getByRole("combobox", { name: /筛选训练项目/ }).click();
    await page.getByRole("option", { name: first.project.name, exact: true }).click();
    await expect(page.locator(".history-record")).toHaveCount(2);
    await page.locator(".history-record summary").first().click();
    await page.locator(".history-record summary").nth(1).click();
    await expect(page.getByText(firstQuestion, { exact: true })).toBeVisible();
    await expect(
      page.getByText(second.turns[0].question, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("第一轮：我负责预约接口，实际验证结果待补充。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("第二轮：我补充了错误恢复说明，尚未记录测试结果。", {
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/training-history-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.reload();
    await expect(page.locator(".history-record")).toHaveCount(3);
    await page.getByRole("combobox", { name: /筛选训练项目/ }).click();
    await page.getByRole("option", { name: first.project.name, exact: true }).click();
    await page.locator(".history-record summary").nth(1).click();
    await expect(
      page.getByText("第一轮：我负责预约接口，实际验证结果待补充。", {
        exact: true,
      }),
    ).toBeVisible();
  });
}
