import { test, expect } from "@playwright/test";
import { mockHandsFree, mockPracticeVoice, type TestVoiceWindow } from "./practice-voice-fixture";

test("面试完成后进入本场报告，项目材料单独编辑，复练后仍可回看", async ({ page }) => {
  const firstAnswer = "我负责接口与数据库约束：同一座位时段只写入一条预约，冲突回滚，并发尚未验证。";
  const voice = await mockPracticeVoice(page, () => firstAnswer);
  await page.goto("/#/login");
  await page.getByLabel("用户名", { exact: true }).fill("practice-" + crypto.randomUUID());
  await page.getByLabel("密码", { exact: true }).fill("synthetic-practice-password");
  await page.getByRole("button", { name: "注册并开始" }).click();
  await page.goto("/#/projects/new");
  await expect(page.getByRole("button", { name: "手动填写" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("填写项目名称即可保存，其余信息按需补充。", { exact: true })).toBeVisible();
  await page.getByLabel("项目名称", { exact: true }).fill("合成试练项目");
  await page.getByLabel("项目简介", { exact: true }).fill("我实现预约接口和数据库唯一约束。");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "载入合成示例" }).click();
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue("合成试练项目");
  await expect(page.getByLabel("项目简介")).toHaveValue("我实现预约接口和数据库唯一约束。");
  await page.getByRole("button", { name: "保存项目材料", exact: true }).click();
  const backToProjects = page.getByRole("button", { name: "返回项目列表" });
  await expect(backToProjects).toBeVisible();
  const projectId = page.url().split("/").pop()!;
  const projectEndpoint = `/api/projects/${projectId}`;
  const original = await (await page.request.get(projectEndpoint)).json();
  await backToProjects.click();
  await page.getByRole("link", { name: "进入面试室" }).click();
  const room = page.getByRole("dialog", { name: "项目面试室" });
  await expect(room.getByLabel("面试主题（选填）")).toHaveValue("");
  await expect(page.locator("#project-materials, #project-practice")).toHaveCount(0);
  await room.getByRole("button", { name: "同意并开始语音面试", exact: true }).click();
  await expect(room.getByRole("heading", { name: /请介绍/ })).toBeVisible();
  await expect(room.getByRole("textbox", { name: "我的回答" })).toHaveCount(0);
  await voice.speak();
  const archive = page.getByRole("region", { name: "面试详情" });
  await expect(archive.getByRole("region", { name: "本场评分" })).toBeVisible();
  const firstRound = await (await page.request.get(`${projectEndpoint}/practice`)).json();
  const firstRoundPath = `/#/history/${projectId}/${firstRound.roundId}`;
  await expect(page).toHaveURL(new URL(firstRoundPath, page.url()).href);
  const transcript = archive.getByRole("region", { name: "完整对话" });
  await expect(transcript.getByText(firstAnswer, { exact: true })).toBeVisible();
  await expect(page.locator("#project-materials")).toHaveCount(0);
  await expect(page.getByText("把刚才讲清楚的内容，带到下一轮", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "预览回答补充到材料" })).toHaveCount(0);
  const saved = await (await page.request.get(projectEndpoint)).json();
  expect(saved.version).toBe(original.version);
  expect(saved.materials).toBe(original.materials);
  const review = archive.getByRole("region", { name: "自愿练习反馈" });
  await review.getByRole("button", { name: "4分", exact: true }).click();
  await review.getByRole("button", { name: "愿意继续", exact: true }).click();
  await review.getByLabel("最卡住的一步（可选）").fill("合成调研：需要明确下一步。");
  await review.getByRole("button", { name: "保存练习反馈" }).click();
  await expect(review.getByRole("status")).toContainText("已记录这次练习反馈");
  const feedback = await (await page.request.get("/api/feedback")).json();
  expect(feedback.filter((item: { body: string }) => item.body.includes("练习反馈"))).toHaveLength(1);
  await page.goto("/#/projects");
  await page.getByRole("link", { name: "编辑材料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "项目材料", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "项目简介", exact: true })).toHaveValue("我实现预约接口和数据库唯一约束。");
  await expect(page.getByRole("region", { name: "本场评分" })).toHaveCount(0);
  await expect(page.locator("#project-practice, dialog.practice-room")).toHaveCount(0);
  await backToProjects.click();
  await page.getByRole("link", { name: "进入面试室", exact: true }).click();
  await expect(room.getByRole("heading", { name: "开始新一轮", exact: true })).toBeVisible();
  await room.getByLabel("面试主题（选填）").fill("数据库唯一约束");
  await room.getByRole("button", { name: "同意并开始语音面试", exact: true }).click();
  await expect(room.getByRole("button", { name: "暂停语音面试" })).toBeVisible();
  await expect(room.getByText("本轮主题：数据库唯一约束", { exact: true })).toBeVisible();
  const secondRound = await (await page.request.get(`/api/projects/${projectId}/practice`)).json();
  expect(secondRound.roundId).not.toBe(firstRound.roundId);
  expect(secondRound.interviewTopic).toBe("数据库唯一约束");
  expect(secondRound.turns[0].question).toContain("数据库唯一约束");
  await page.goto(`/#/projects/${projectId}?roundId=${firstRound.roundId}`);
  await expect(page).toHaveURL(new URL(firstRoundPath, page.url()).href);
  await expect(transcript.getByText(firstAnswer, { exact: true })).toBeVisible();
  const projectHistory = `/#/history/${projectId}`;
  await page.goto(projectHistory);
  await page.getByRole("link", { name: "继续训练", exact: true }).click();
  await expect(page).toHaveURL(new URL(`/#/projects/${projectId}?interview=1&from=history`, page.url()).href);
  await expect(room.getByRole("button", { name: "同意并进入语音面试" })).toBeEnabled();
  await room.getByRole("button", { name: "返回项目训练记录", exact: true }).click();
  await expect(page).toHaveURL(new URL(projectHistory, page.url()).href);
  await expect(page.locator("#project-materials, #project-practice, dialog.practice-room")).toHaveCount(0);

  const origin = new URL(page.url()).origin;
  const created = await page.request.post("/api/projects", {
    headers: { Origin: origin }, data: { name: "第二个练习项目", responsibility: "接口开发" },
  });
  expect(created.ok()).toBeTruthy();
  const secondProject = await created.json();
  await page.goto(`/#/projects/${secondProject.id}?interview=1`);
  await room.getByRole("button", { name: "同意并开始语音面试", exact: true }).click();
  await expect(room.getByRole("heading", { name: /请介绍/ })).toBeVisible();
});

test("练习草稿刷新与返回后保留，读取失败可重试", async ({ page }) => {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post("/api" + path, { headers: { Origin: origin }, data });
    expect(r.ok()).toBeTruthy(); return r.json();
  };
  await post("/auth/register", { username: "draft-practice-" + crypto.randomUUID(), password: "synthetic-practice-password" });
  const p = await post("/projects", { name: "草稿练习", responsibility: "预约接口" });
  const active = await post(`/projects/${p.id}/practice`, {});
  const user = await (await page.request.get("/api/me")).json();
  const draft = "未提交的合成回答：数据库唯一约束。";
  await page.addInitScript(({ projectId, turnId, draft, userId }) => {
    if (sessionStorage.getItem("has-seeded-practice-draft")) return;
    sessionStorage.setItem("auth:owner", userId);
    sessionStorage.setItem("has-seeded-practice-draft", "1");
    sessionStorage.setItem("practice-draft:" + projectId, draft);
    sessionStorage.setItem("practice-draft-turn:" + projectId, turnId);
    sessionStorage.setItem("practice-draft-exchange:" + projectId, "0");
  }, { projectId: p.id, turnId: active.turns[0].id, draft, userId: user.id });
  await page.goto(`/#/projects/${p.id}?interview=1`);
  const practice = page.getByRole("dialog", { name: "项目面试室" });
  const savedAnswer = practice.getByRole("region", { name: "未发送的回答" }).getByText(draft, { exact: true });
  await expect(savedAnswer).toBeVisible();
  page.on("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(savedAnswer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/projects$/);
  await expect(page.getByRole("heading", { name: "我的项目", exact: true })).toBeVisible();
  await expect(page.locator("#project-materials, #project-practice, dialog.practice-room")).toHaveCount(0);
  await page.getByRole("link", { name: "进入面试室", exact: true }).click();
  await expect(savedAnswer).toBeVisible();
  let failed = true, writes = 0;
  await page.route(`**/api/projects/${p.id}/practice`, async route => {
    if (route.request().method() !== "GET") { writes++; await route.abort(); return; }
    if (failed) await route.fulfill({ status: 503, json: { message: "合成状态读取失败" } });
    else await route.fulfill({ json: active });
  });
  await page.reload();
  await expect(practice.getByRole("alert")).toContainText("合成状态读取失败");
  await expect(practice.getByRole("button", { name: "同意并开始语音面试", exact: true })).toHaveCount(0);
  failed = false;
  await practice.getByRole("button", { name: "重新读取训练状态" }).click();
  await expect(savedAnswer).toBeVisible();
  expect(writes).toBe(0);
});

test("刷新遇到正在生成只轮询读取，不重复提交", async ({ page }) => {
  const id = "22222222-2222-4222-8222-222222222222";
  let reads = 0, writes = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json;
    if (path === "/api/config") json = { modelMode: "demo" };
    else if (path === "/api/me") json = { id: "synthetic", username: "生成恢复" };
    else if (path === "/api/projects/" + id) json = { id, version: 1, name: "合成项目", responsibility: "接口", resume: "", facts: [] };
    else if (path.endsWith("/practice")) {
      if (route.request().method() !== "GET") { writes++; await route.abort(); return; }
      reads++;
      json = reads === 1 ? { status: "GENERATING" } : { status: "ACTIVE", turns: [{ id: "turn", question: "请说明预约流程。", answer: "" }] };
    } else if (path === "/api/trainings") json = [];
    else throw Error(path);
    await route.fulfill({ json });
  });
  await page.goto(`/#/projects/${id}?interview=1`);
  const room = page.getByRole("dialog", { name: "项目面试室" });
  await expect(room.getByRole("button", { name: /正在生成，自动恢复进度|正在准备/ })).toBeDisabled();
  await expect(room.getByRole("heading", { name: "请说明预约流程。" })).toBeVisible();
  expect(reads).toBeGreaterThan(1); expect(writes).toBe(0);
});

test("百炼 ASR 未就绪时可以检查语音服务，页面没有文字答题入口", async ({ page }) => {
  const id = "33333333-3333-4333-8333-333333333333";
  const practice = `/api/projects/${id}/practice`;
  let voiceAvailable = false;
  const responses: Record<string, unknown> = {
    "/api/me": { id: "synthetic", username: "合成用户" },
    ["/api/projects/" + id]: { id, version: 1, name: "合成项目", responsibility: "接口", resume: "", facts: [] },
    [practice]: {
      status: "ACTIVE", maxTurns: 5,
      turns: [{ id: "turn", question: "请说明预约流程。", answer: "" }],
    },
    "/api/trainings": [],
  };
  await page.route("**/api/**", route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/config") return route.fulfill({ json: { modelMode: "demo", speechEnabled: voiceAvailable } });
    expect(request.method()).toBe("GET");
    return route.fulfill({ json: responses[path] ?? null });
  });

  await page.goto(`/#/projects/${id}?interview=1`);
  const room = page.getByRole("dialog", { name: "项目面试室" });
  await expect(room.getByText("百炼 ASR 暂未就绪，当前无法开始语音面试。", { exact: true })).toBeVisible();
  await expect(room.getByRole("combobox", { name: "识别语言" })).toHaveCount(0);
  await expect(room.getByRole("textbox", { name: "我的回答" })).toHaveCount(0);
  await expect(room.getByRole("button", { name: /同意并进入语音面试|开始文字面试|开始语音输入/ })).toHaveCount(0);
  voiceAvailable = true;
  await room.getByRole("button", { name: "重新检查语音服务" }).click();
  await expect(room.getByRole("button", { name: "同意并进入语音面试" })).toBeEnabled();
});

test("开始免提语音面试后可用同一段录音重试转写", async ({ page }) => {
  const id = "44444444-4444-4444-8444-444444444444";
  const practice = "/api/projects/" + id + "/practice";
  const firstTurn = { id: "asr-turn", question: "请说明预约流程。", answer: "" };
  const nextTurn = { id: "next", question: "请说明重复请求的处理方式。", answer: "" };
  const recognized = "预约 API 会校验唯一键。";
  const responses: Record<string, unknown> = {
    "/api/config": { modelMode: "live", speechEnabled: true },
    "/api/me": { id: "synthetic", username: "合成用户" },
    ["/api/projects/" + id]: { id, version: 1, name: "合成项目", responsibility: "接口", resume: "", facts: [] },
    [practice]: { status: "AVAILABLE", maxTurns: 5 },
  };
  let starts = 0;
  let submissions = 0;
  const recordings: Buffer[] = [];
  await page.route("**/api/**", route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === practice + "/transcribe") {
      expect(request.method()).toBe("POST");
      expect(request.headers()["content-type"]).toContain("multipart/form-data");
      const upload = request.postDataBuffer()!;
      const form = upload.toString("latin1");
      expect(form).toContain('name="turnId"\r\n\r\nasr-turn');
      expect(form).toContain('name="exchangeCount"\r\n\r\n0');
      const start = upload.indexOf("RIFF");
      expect(start).toBeGreaterThanOrEqual(0);
      recordings.push(upload.subarray(start, start + 8 + upload.readUInt32LE(start + 4)));
      if (recordings.length === 1)
        return route.fulfill({ status: 503, json: { message: "合成转写超时" } });
      return route.fulfill({ json: { text: recognized } });
    }
    if (path === practice && request.method() === "POST") {
      const body = request.postDataJSON();
      if (!body.answer) {
        expect(body).toEqual({ topic: "并发一致性" });
        starts++;
        return route.fulfill({ json: { status: "ACTIVE", maxTurns: 5, turns: [firstTurn] } });
      }
      expect(body).toEqual({ turnId: firstTurn.id, exchangeCount: 0, answer: recognized, dialogue: true });
      submissions++;
      return route.fulfill({ json: { status: "ACTIVE", maxTurns: 5, turns: [{ ...firstTurn, answer: recognized }, nextTurn] } });
    }
    return route.fulfill({ json: responses[path] ?? null });
  });
  const voice = await mockHandsFree(page);
  await page.goto(`/#/projects/${id}?interview=1`);
  const room = page.getByRole("dialog", { name: "项目面试室" });
  await room.getByLabel("面试主题（选填）").fill("并发一致性");
  expect(await voice.micRequested()).toBe(false);
  await room.getByRole("button", { name: "同意并开始语音面试", exact: true }).click();
  await expect.poll(voice.broadcasts).toEqual([{ text: firstTurn.question, micReady: true }]);
  await expect.poll(voice.micState).toEqual(["live", true]);
  expect(recordings).toHaveLength(0);
  await voice.beginSpeech();
  await expect(room.getByText("正在听你说话", { exact: true })).toBeVisible();
  await voice.endSpeech();
  await expect(room.getByRole("alert")).toContainText("合成转写超时");
  expect([recordings.length, submissions]).toEqual([1, 0]);
  await room.getByRole("button", { name: "重试转写刚才的录音", exact: true }).click();
  await expect(room.getByRole("heading", { name: nextTurn.question, exact: true })).toBeVisible();
  expect([starts, recordings.length, submissions]).toEqual([1, 2, 1]);
  expect(recordings[1]).toEqual(recordings[0]);
});

test("免提面试播报时可开口打断，问候留在同一题", async ({ page }) => {
  const id = "55555555-5555-4555-8555-555555555555";
  const path = "/api/projects/" + id + "/practice";
  const responses: Record<string, unknown> = {
    "/api/config": { modelMode: "demo", speechEnabled: true },
    "/api/me": { id: "synthetic", username: "合成用户" },
    ["/api/projects/" + id]: { id, version: 1, name: "预约系统", responsibility: "预约接口", resume: "", facts: [] },
    "/api/projects": [],
    "/api/training-overview": { items: [] },
  };
  const initialTurn = { id: "first", question: "如何避免重复预约？", answer: "" };
  const response = { status: "ACTIVE", roundId: "voice-round", maxTurns: 5, turns: [initialTurn] };
  const followUp = "你好，我们继续说说重复预约。";
  const sufficient = "我们在数据库设置请求标识的唯一约束，重复请求读取原结果，并验证两次同时提交只产生一条记录。";
  const sentences = ["你好", sufficient];
  const replies = [
    { ...response, turns: [{ ...initialTurn, exchanges: [{ answer: "你好", reply: followUp }] }] },
    { ...response, turns: [{ ...initialTurn, answer: sufficient }, { id: "second", question: "如何处理缓存失效？", answer: "" }] },
  ];
  let uploads = 0;
  let submissions = 0;
  await page.route("**/api/**", route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === path + "/transcribe") {
      const form = request.postDataBuffer()!.toString("latin1");
      expect(form).toContain('name="turnId"\r\n\r\nfirst');
      expect(form).toContain('name="exchangeCount"\r\n\r\n' + uploads);
      expect(form).toContain("RIFF");
      return route.fulfill({ json: { text: sentences[uploads++] } });
    }
    if (pathname !== path) return route.fulfill({ json: responses[pathname] ?? null });
    if (request.method() === "GET") return route.fulfill({ json: response });
    expect(request.postDataJSON()).toEqual({
      answer: sentences[submissions], dialogue: true, turnId: "first", exchangeCount: submissions,
    });
    return route.fulfill({ json: replies[submissions++] });
  });

  const voice = await mockHandsFree(page, true);
  await page.goto(`/#/projects/${id}?interview=1`);
  const room = page.getByRole("dialog", { name: "项目面试室" });
  const canInterrupt = room.getByText("面试官正在播报，可以直接开口打断", { exact: true });
  const listening = room.getByText("正在听你说话", { exact: true });
  const start = room.getByRole("button", { name: "同意并进入语音面试" });
  await expect(start).toHaveAccessibleDescription(/自动发往阿里云百炼/);
  expect(await voice.micRequested()).toBe(false);
  expect(await voice.broadcasts()).toEqual([]);
  await start.click();
  await expect.poll(voice.micRequested).toBe(true);
  await expect(room.getByText("正在准备麦克风", { exact: true })).toBeVisible();
  expect(await voice.broadcasts()).toEqual([]);
  expect(await voice.micState()).toBeNull();
  await voice.grantMic();
  await expect(canInterrupt).toBeVisible();
  await expect.poll(voice.playback).toEqual({ playing: initialTurn.question, interrupted: [] });
  expect(await voice.broadcasts()).toEqual([{ text: initialTurn.question, micReady: true }]);
  await expect.poll(voice.micState).toEqual(["live", true]);
  await voice.beginSpeech();
  await expect(listening).toBeVisible();
  await expect.poll(voice.playback).toEqual({ playing: null, interrupted: [initialTurn.question] });
  expect([uploads, submissions]).toEqual([0, 0]);
  await voice.endSpeech();
  await expect(room.getByText(followUp)).toBeVisible();
  await expect(room.getByText("第 1 / 5 题")).toBeVisible();
  await expect(canInterrupt).toBeVisible();
  await expect.poll(voice.playback).toEqual({ playing: followUp, interrupted: [initialTurn.question] });
  await expect.poll(voice.micState).toEqual(["live", true]);

  await page.evaluate(async () => {
    // A cancelled browser utterance may report completion after the next one starts.
    (window as TestVoiceWindow).testInterrupted[0].onend?.(new Event("end") as SpeechSynthesisEvent);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(canInterrupt).toBeVisible();
  await voice.beginSpeech();
  await expect(listening).toBeVisible();
  await expect.poll(voice.playback).toEqual({ playing: null, interrupted: [initialTurn.question, followUp] });
  expect([uploads, submissions]).toEqual([1, 1]);
  await voice.endSpeech();
  await expect(room.getByText("第 2 / 5 题")).toBeVisible();
  await expect(room.getByRole("heading", { name: "如何处理缓存失效？" })).toBeVisible();
  expect([uploads, submissions]).toEqual([2, 2]);
});
