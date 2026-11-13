import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("无后端也能完成五轮、恢复草稿并导出带原文的复盘", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { message: "测试：后端离线" } }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /做过的项目/ })).toBeVisible();
  await page.getByRole("link", { name: "免登录体验五轮" }).click();
  await page.getByRole("button", { name: "开始五轮练习" }).click();
  await page.getByLabel("本轮回答").fill("第一轮草稿：我负责预约接口。");
  await page.reload();
  await expect(page.getByLabel("本轮回答")).toHaveValue(
    "第一轮草稿：我负责预约接口。",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
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

test("自己的项目免费练五轮，无订单，刷新后题目与草稿对应", async ({ page }) => {
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
    .getByLabel("个人职责（必填）", { exact: true })
    .fill("我负责预约接口和数据库唯一约束，前端由同学负责。");
  await page.getByRole("button", { name: "保存项目材料", exact: true }).click();
  const trial = page.getByRole("region", { name: "我的项目五轮训练" });
  await trial.getByRole("button", { name: "开始五轮训练" }).click();
  for (let i = 0; i < 5; i++) {
    await expect(trial.getByLabel("体验回答")).toBeEnabled();
    await trial
      .getByLabel("体验回答")
      .fill(
        `第${i + 1}题：我负责预约接口，通过唯一约束避免重复，尚未验证并发。`,
      );
    if (i === 1) {
      page.once("dialog", (dialog) => dialog.accept());
      await page.reload();
      await expect(trial.getByLabel("体验回答")).toHaveValue(/第2题/);
    }
    await trial.getByRole("button", { name: "提交体验回答" }).click();
    if (i < 4) await expect(trial.getByLabel("体验回答")).toHaveValue("");
  }
  await expect(
    trial.getByRole("heading", { name: "针对你的回答" }),
  ).toBeVisible();
  const exportEvent = page.waitForEvent("download");
  await trial.getByRole("button", { name: "导出本轮复盘" }).click();
  const exported = await exportEvent;
  expect(await readFile((await exported.path())!, "utf8")).toContain("第5题");
  const project = page.url().split("/").pop();
  const state = await (
    await page.request.get(`/api/projects/${project}/practice`)
  ).json();
  expect(state.status).toBe("COMPLETED");
  expect(state.turns).toHaveLength(5);
  for (let i = 0; i < 5; i++)
    expect(state.turns[i].answer).toContain(`第${i + 1}题`);
  expect(
    (await (await page.request.get("/api/shop")).json()).orders,
  ).toHaveLength(0);
  const retest = page.getByRole("region", { name: "专项复测" });
  await retest.getByLabel("选择复测反馈").selectOption("1");
  const revised = "测试输入：两次并发预约。预期结果：只有一笔有效预约。";
  await retest.getByLabel("补答").fill(revised);
  await retest.getByRole("button", { name: "提交补答并对照" }).click();
  await expect(retest.getByText(/新增了标注：测试输入、预期结果/)).toBeVisible();
  await page.reload();
  await expect(retest.getByText(revised, { exact: true })).toBeVisible();

  await page.goto("/#/history");
  const record = page.getByRole("region", { name: "免费项目训练" });
  await expect(record.getByText(/专项复测已完成/)).toBeVisible();
  await record.getByRole("link", { name: /我的合成训练项目/ }).click();
  await expect(retest.getByText("前后对照", { exact: true })).toBeVisible();
  const finalExport = page.waitForEvent("download");
  await trial.getByRole("button", { name: "导出本轮复盘" }).click();
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
  await page.getByLabel("本轮回答").fill("我负责文档切分。");
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
