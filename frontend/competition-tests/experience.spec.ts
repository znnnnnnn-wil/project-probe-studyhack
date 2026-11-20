import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { mockPracticeVoice } from "../tests/practice-voice-fixture";

test("无后端也能完成五轮、恢复草稿并导出带原文的复盘", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { message: "测试：后端离线" } }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /把项目经历[，,]\s*讲清楚/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "开始示例练习", exact: true }).click();
  await page.getByRole("button", { name: "开始五轮练习" }).click();
  const room = page.getByRole("dialog", { name: "示例面试室" });
  await expect(room).toBeVisible();
  await expect(room.getByText("第 1 / 5 题", { exact: true })).toBeVisible();
  await expect(room.getByRole("button", { name: "同意并开始语音面试" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("example-room-desktop.png"), fullPage: true });
  await room.getByLabel("本轮回答").fill("第一轮草稿：我负责预约接口。");
  await room.getByRole("button", { name: "返回练习", exact: true }).click();
  await expect(room).not.toBeVisible();
  await expect(page.getByLabel("本轮回答")).toHaveValue("第一轮草稿：我负责预约接口。");
  await page.getByRole("button", { name: "进入面试室", exact: true }).click();
  await expect(room.getByLabel("本轮回答")).toHaveValue("第一轮草稿：我负责预约接口。");
  await page.reload();
  await expect(page.getByLabel("本轮回答")).toHaveValue(
    "第一轮草稿：我负责预约接口。",
  );
  await expect(room).not.toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "进入面试室", exact: true }).click();
  await expect(room).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await page
      .getByLabel("本轮回答")
      .fill(`第${i + 1}轮的真实输入：数据库约束仍需并发验证。`);
    await page
      .getByRole("button", {
        name: i === 4 ? "保存并查看复盘" : "保存回答，继续追问",
      })
      .click();
    if (i < 4) await expect(page.getByLabel("本轮回答")).toHaveValue("");
  }
  await expect(room).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "这轮练习，留下了什么？" }),
  ).toBeVisible();
  await page
    .getByLabel("补充笔记")
    .first()
    .fill("补做两个请求同时预约的测试。");
  await page.getByRole("checkbox").first().check();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出复盘 Markdown" }).click();
  const file = await event;
  const content = await readFile((await file.path())!, "utf8");
  expect(content).toContain("不构成 AI 技术评估");
  expect(content).toContain("第5轮的真实输入");
  expect(content).toContain("材料原文（关键实现）");
  expect(content).toContain("补做两个请求同时预约的测试");
  await page.reload();
  await expect(page.getByLabel("补充笔记").first()).toHaveValue(
    "补做两个请求同时预约的测试。",
  );
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  expect(errors).toEqual([]);
});

test("项目语音面试刷新后可续训，完成后可回看档案", async ({ page }) => {
  let answer = "";
  const voice = await mockPracticeVoice(page, () => answer);
  await page.goto("/#/login");
  await page
    .getByLabel("用户名", { exact: true })
    .fill("competition-" + crypto.randomUUID());
  await page
    .getByLabel("密码", { exact: true })
    .fill("synthetic-test-password");
  await page.getByRole("button", { name: "注册并开始" }).click();
  await expect(page).toHaveURL(/#\/projects$/);
  await page.goto("/#/projects/new");
  await page.getByLabel("项目名称", { exact: true }).fill("我的合成训练项目");
  await page
    .getByLabel("项目经历", { exact: true })
    .fill("我负责预约接口和数据库唯一约束，前端由同学负责。");
  await page.getByRole("button", { name: "保存项目材料", exact: true }).click();
  await page.getByRole("button", { name: "返回项目列表" }).click();
  await page.getByRole("link", { name: "进入面试室" }).click();
  const room = page.getByRole("dialog", { name: "项目面试室" });
  await room.getByRole("button", { name: "同意并开始语音面试" }).click();
  const project = new URL(page.url()).hash.split("/").pop()!.split("?")[0];
  for (let i = 0; i < 5; i++) {
    const progress = room.getByText(`第 ${i + 1} / 5 题`, { exact: true });
    await expect(progress).toBeVisible();
    if (i === 1) {
      await page.reload();
      await expect(progress).toBeVisible();
      await room.getByRole("button", { name: "同意并进入语音面试" }).click();
    }
    answer = `第${i + 1}题：我负责预约接口，通过数据库唯一约束避免重复写入，尚未验证并发。`;
    await voice.speak();
  }
  await expect(page).toHaveURL(new RegExp(`#/history/${project}/[^/]+$`));
  const archive = page.getByRole("region", { name: "面试详情" });
  await expect(archive.getByRole("region", { name: "本场评分" })).toContainText("未评分");
  await expect(page.locator("#project-materials")).toHaveCount(0);
  const exportEvent = page.waitForEvent("download");
  await archive.getByRole("button", { name: "导出本轮复盘" }).click();
  const exported = await exportEvent;
  expect(await readFile((await exported.path())!, "utf8")).toContain("第5题");
  const state = await (
    await page.request.get(`/api/projects/${project}/practice`)
  ).json();
  await expect(page).toHaveURL(new URL(`/#/history/${project}/${state.roundId}`, page.url()).href);
  expect(state.status).toBe("COMPLETED");
  expect(state.turns).toHaveLength(5);
  for (let i = 0; i < 5; i++)
    expect(state.turns[i].answer).toContain(`第${i + 1}题`);
  const retest = archive.getByRole("region", { name: "专项复测" });
  const feedbackChoices = retest.getByRole("radio");
  if (await feedbackChoices.count() > 1) {
    await feedbackChoices.first().focus();
    await feedbackChoices.first().press("ArrowRight");
    await expect(feedbackChoices.nth(1)).toBeChecked();
  }
  const revised = "测试输入：两次并发预约。预期结果：只有一笔有效预约。";
  await retest.getByLabel("补答").fill(revised);
  await retest.getByRole("button", { name: "提交补答并对照" }).click();
  await expect(retest.getByText(/新增了标注：测试输入、预期结果/)).toBeVisible();
  await page.reload();
  await expect(retest.getByText(revised, { exact: true })).toBeVisible();

  await page.goto("/#/history");
  await page.getByRole("link", { name: /我的合成训练项目/ }).click();
  await expect(page.getByText("专项复测已完成", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "查看报告与对话" }).click();
  await expect(archive.getByRole("region", { name: "本场评分" })).toContainText("未评分");
  await expect(archive.getByRole("region", { name: "完整对话" })).toContainText("第5题：我负责预约接口");
  await expect(archive.getByRole("region", { name: "专项复测" }).getByText(revised, { exact: true })).toBeVisible();
  const finalExport = page.waitForEvent("download");
  await archive.getByRole("button", { name: "导出本轮复盘" }).click();
  const finalContent = await readFile((await (await finalExport).path())!, "utf8");
  expect(finalContent).toContain("## 专项复测");
  expect(finalContent).toContain(revised);
});

test("手机端可选择 RAG 场景，回看旧回答不会覆盖当前草稿", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/experience?sample=rag");
  await expect(
    page.getByRole("button", { name: /RAG \/ Agent/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "开始五轮练习" }).click();
  const room = page.getByRole("dialog", { name: "示例面试室" });
  await expect(room).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("example-room-mobile.png"), fullPage: true });
  await room.getByLabel("本轮回答").fill("我负责文档切分。");
  await page.getByRole("button", { name: "保存回答，继续追问" }).click();
  await page.getByLabel("本轮回答").fill("当前题目的未提交草稿");
  await page.getByRole("button", { name: "个人职责", exact: true }).click();
  await expect(
    page.getByText("我负责文档切分。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "回到当前追问" }).click();
  await expect(page.getByLabel("本轮回答")).toHaveValue("当前题目的未提交草稿");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
