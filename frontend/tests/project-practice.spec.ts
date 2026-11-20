import { test, expect } from "@playwright/test";
import { mockHandsFree, type TestVoiceWindow } from "./practice-voice-fixture";

test("保存项目即可训练，复练后仍能回看旧复盘", async ({ page }) => {
  await page.goto("/#/login");
  await page.getByLabel("用户名", { exact: true }).fill("practice-" + crypto.randomUUID());
  await page.getByLabel("密码", { exact: true }).fill("synthetic-practice-password");
  await page.getByRole("button", { name: "注册并开始" }).click();
  await page.goto("/#/projects/new");
  await expect(page.getByRole("button", { name: "手动填写" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("填写项目名称和个人职责即可保存。", { exact: true })).toBeVisible();
  await page.getByLabel("项目名称", { exact: true }).fill("合成试练项目");
  await page.getByLabel("个人职责（必填）", { exact: true }).fill("我实现预约接口和数据库唯一约束。");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "载入合成示例" }).click();
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue("合成试练项目");
  await expect(page.getByLabel("个人职责（必填）", { exact: true })).toHaveValue("我实现预约接口和数据库唯一约束。");
  await page.getByRole("button", { name: "保存项目材料", exact: true }).click();
  const practice = page.getByRole("region", { name: "我的项目五轮训练" });
  await page.getByRole("button", { name: "返回项目列表" }).click();
  await page.getByRole("link", { name: "进入面试室" }).click();
  const room = page.getByRole("dialog", { name: "项目面试室" });
  await expect(room.getByLabel("面试主题（选填）")).toHaveValue("");
  await room.getByRole("button", { name: "开始五轮训练", exact: true }).click();
  await expect(room.getByRole("heading", { name: /请介绍/ })).toBeVisible();
  await room.getByLabel("我的回答").fill("我负责接口，数据库唯一约束防止重复预约。");
  await room.getByRole("button", { name: "提交回答" }).click();
  await expect(practice.getByRole("heading", { name: "针对你的回答" })).toBeVisible();
  const projectId = page.url().split("/").pop()!.split("?")[0];
  const firstRound = await (await page.request.get(`/api/projects/${projectId}/practice`)).json();
  const original = await (await page.request.get("/api/projects/" + projectId)).json();
  await practice.getByRole("button", { name: "预览回答补充到材料" }).click();
  await expect(practice.getByLabel("项目材料补充预览")).toContainText("我负责接口");
  expect((await (await page.request.get("/api/projects/" + projectId)).json()).version).toBe(original.version);
  await practice.getByRole("button", { name: "确认保存回答补充" }).click();
  const saved = await (await page.request.get("/api/projects/" + projectId)).json();
  expect(saved.materials).toContain("练习回答补充（用户自述）");
  expect(saved.version).toBe(original.version + 1);
  expect(saved.factsConfirmed).toBe(false);
  await practice.getByRole("button", { name: "预览回答补充到材料" }).click();
  await expect(practice.getByText("这段回答已在项目材料中，无需重复加入。")).toBeVisible();
  await practice.getByRole("button", { name: "查看项目材料", exact: true }).click();
  await expect(page.getByRole("heading", { name: "项目材料", exact: true })).toBeVisible();
  const review = page.getByRole("region", { name: "自愿练习反馈" });
  await review.getByRole("button", { name: "4分", exact: true }).click();
  await review.getByRole("button", { name: "愿意继续", exact: true }).click();
  await review.getByLabel("最卡住的一步（可选）").fill("合成调研：需要明确下一步。");
  await review.getByRole("button", { name: "保存练习反馈" }).click();
  await expect(review.getByRole("status")).toContainText("已记录这次练习反馈");
  const feedback = await (await page.request.get("/api/feedback")).json();
  expect(feedback.filter((item: { body: string }) => item.body.includes("练习反馈"))).toHaveLength(1);
  await page.goto(`/#/projects/${projectId}`);
  await expect(practice.getByRole("heading", { name: "针对你的回答" })).toBeVisible();
  await practice.getByRole("button", { name: "开始新一轮" }).click();
  await room.getByLabel("面试主题（选填）").fill("数据库唯一约束");
  await room.getByRole("button", { name: "开始五轮训练", exact: true }).click();
  await expect(room.getByLabel("我的回答")).toBeEditable();
  const secondRound = await (await page.request.get(`/api/projects/${projectId}/practice`)).json();
  expect(secondRound.roundId).not.toBe(firstRound.roundId);
  expect(secondRound.interviewTopic).toBe("数据库唯一约束");
  expect(secondRound.turns[0].question).toContain("数据库唯一约束");
  await page.goto(`/#/projects/${projectId}?roundId=${firstRound.roundId}`);
  await expect(practice.getByRole("heading", { name: "针对你的回答" })).toBeVisible();
  const transcript = practice.locator("details").filter({
    hasText: "查看本轮已提交问答（1）",
  });
  await transcript.locator("summary").click();
  await expect(transcript.getByText("我负责接口，数据库唯一约束防止重复预约。", { exact: true })).toBeVisible();
  await practice.getByRole("button", { name: "返回当前训练" }).click();
  await expect(practice.getByLabel("我的回答")).toBeEditable();

  const origin = new URL(page.url()).origin;
  const created = await page.request.post("/api/projects", {
    headers: { Origin: origin }, data: { name: "第二个练习项目", responsibility: "接口开发" },
  });
  expect(created.ok()).toBeTruthy();
  const secondProject = await created.json();
  await page.goto(`/#/projects/${secondProject.id}`);
  await practice.getByRole("button", { name: "进入面试室" }).click();
  await room.getByRole("button", { name: "开始五轮训练", exact: true }).click();
  await expect(room.getByLabel("我的回答")).toBeEditable();
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
  await page.goto(`/#/projects/${p.id}`);
  const practice = page.getByRole("region", { name: "我的项目五轮训练" });
  await practice.getByLabel("我的回答").fill("未提交的合成回答：数据库唯一约束。");
  page.on("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(practice.getByLabel("我的回答")).toHaveValue("未提交的合成回答：数据库唯一约束。");
  await page.goto("/#/account");
  await page.goto(`/#/projects/${p.id}`);
  await expect(practice.getByLabel("我的回答")).toHaveValue("未提交的合成回答：数据库唯一约束。");
  let failed = true, writes = 0;
  await page.route(`**/api/projects/${p.id}/practice`, async route => {
    if (route.request().method() !== "GET") { writes++; await route.abort(); return; }
    if (failed) await route.fulfill({ status: 503, json: { message: "合成状态读取失败" } });
    else await route.fulfill({ json: active });
  });
  await page.reload();
  await expect(practice.getByRole("alert")).toContainText("合成状态读取失败");
  await expect(practice.getByRole("button", { name: "开始五轮训练", exact: true })).toHaveCount(0);
  failed = false;
  await practice.getByRole("button", { name: "重新读取训练状态" }).click();
  await expect(practice.getByLabel("我的回答")).toHaveValue("未提交的合成回答：数据库唯一约束。");
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
  await page.goto(`/#/projects/${id}`);
  await expect(page.getByRole("button", { name: "正在生成，自动恢复进度…" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "请说明预约流程。" })).toBeVisible();
  expect(reads).toBeGreaterThan(1); expect(writes).toBe(0);
});

test("结束语音输入后等待浏览器的最终文字", async ({ page }) => {
  const id = "33333333-3333-4333-8333-333333333333";
  const responses: Record<string, unknown> = {
    "/api/config": { modelMode: "demo" },
    "/api/me": { id: "synthetic", username: "合成用户" },
    ["/api/projects/" + id]: { id, version: 1, name: "合成项目", responsibility: "接口", resume: "", facts: [] },
    ["/api/projects/" + id + "/practice"]: {
      status: "ACTIVE", maxTurns: 5,
      turns: [{ id: "turn", question: "请说明预约流程。", answer: "" }],
    },
    "/api/trainings": [],
  };
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: responses[path] ?? null });
  });
  await page.addInitScript(() => {
    let microphone: MediaStream;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        microphone = new AudioContext().createMediaStreamDestination().stream;
        return microphone;
      },
    });
    class Recognition {
      lang = "";
      onstart?: () => void;
      onresult?: (event: { results: { 0: { transcript: string }; isFinal: boolean }[] }) => void;
      onend?: () => void;

      start(track: MediaStreamTrack) {
        if (track !== microphone.getAudioTracks()[0]) throw new Error("Unexpected audio source");
        queueMicrotask(() => this.onstart?.());
      }

      receiveResult = () => {
        const transcript = this.lang === "en-US" ? "The API uses a unique key." : "预约接口使用唯一键。";
        this.onresult?.({ results: [{ 0: { transcript }, isFinal: true }] });
        this.onend?.();
      };

      stop() {
        window.addEventListener("test:speech-result", this.receiveResult, { once: true });
      }

      abort() {
        window.removeEventListener("test:speech-result", this.receiveResult);
      }
    }
    for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
      Object.defineProperty(window, name, { value: Recognition, configurable: true });
    }
  });

  await page.goto("/#/projects/" + id);
  await page.getByRole("button", { name: "进入面试室" }).click();
  const room = page.getByRole("dialog", { name: "项目面试室" });
  const answer = room.getByRole("textbox", { name: "我的回答" });
  await answer.fill("原有草稿");
  await room.getByRole("combobox", { name: "识别语言" }).selectOption("en-US");
  await room.getByRole("button", { name: "开始语音输入" }).click();
  await room.getByRole("button", { name: "结束并填入回答" }).click();
  await expect(room.getByText("正在接收识别结果")).toBeVisible();
  await expect(answer).toHaveValue("原有草稿");

  await page.evaluate(() => window.dispatchEvent(new Event("test:speech-result")));
  await expect(answer).toHaveValue("原有草稿\nThe API uses a unique key.");
  await expect(room.getByText("语音已填入回答")).toBeVisible();
});

test("五轮练习仅在确认发送时上传录音，失败后可重试并追加转写", async ({ page }) => {
  const id = "44444444-4444-4444-8444-444444444444";
  const practice = "/api/projects/" + id + "/practice";
  const responses: Record<string, unknown> = {
    "/api/config": { modelMode: "live", speechEnabled: true },
    "/api/me": { id: "synthetic", username: "合成用户" },
    ["/api/projects/" + id]: { id, version: 1, name: "合成项目", responsibility: "接口", resume: "", facts: [] },
    [practice]: {
      status: "ACTIVE", maxTurns: 5,
      turns: [{ id: "asr-turn", question: "请说明预约流程。", answer: "" }],
    },
    "/api/trainings": [],
  };
  const uploads: Buffer[] = [];
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === practice + "/transcribe") {
      expect(route.request().method()).toBe("POST");
      expect(route.request().headers()["content-type"]).toContain("multipart/form-data");
      uploads.push(route.request().postDataBuffer()!);
      if (uploads.length === 1)
        return route.fulfill({ status: 503, json: { message: "合成转写超时" } });
      return route.fulfill({ json: { text: "预约 API 会校验唯一键。" } });
    }
    return route.fulfill({ json: responses[path] ?? null });
  });
  await page.route("**/vad/**/*.onnx", route => route.fulfill({ status: 503 }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => new AudioContext().createMediaStreamDestination().stream,
    });
  });

  await page.goto("/#/projects/" + id);
  await page.getByRole("button", { name: "进入面试室" }).click();
  const room = page.getByRole("dialog", { name: "项目面试室" });
  const answer = room.getByRole("textbox", { name: "我的回答" });
  await answer.fill("原有草稿");
  await room.getByRole("button", { name: "开始语音输入" }).click();
  const stop = room.getByRole("button", { name: "结束录音" });
  await expect(stop).toBeVisible();
  await expect(room.getByText("0:01", { exact: false })).toBeVisible();
  await stop.click();

  const send = room.getByRole("button", { name: "发送至百炼转写" });
  await expect(send).toBeEnabled();
  expect(uploads).toHaveLength(0);
  await send.click();
  await expect(room.getByRole("alert")).toContainText("合成转写超时");
  await expect(answer).toHaveValue("原有草稿");
  await expect(room.locator("audio")).toBeVisible();
  await send.click();
  await expect(answer).toHaveValue("原有草稿\n预约 API 会校验唯一键。");
  expect(uploads).toHaveLength(2);
  for (const upload of uploads) {
    expect(upload.includes(Buffer.from('name="turnId"'))).toBeTruthy();
    expect(upload.includes(Buffer.from("asr-turn"))).toBeTruthy();
    expect(upload.includes(Buffer.from("RIFF"))).toBeTruthy();
  }
});

test("免提面试播报时可开口打断，问候留在同一题", async ({ page }) => {
  const id = "55555555-5555-4555-8555-555555555555";
  const path = "/api/projects/" + id + "/practice";
  const responses: Record<string, unknown> = {
    "/api/config": { modelMode: "demo", speechEnabled: true },
    "/api/me": { id: "synthetic", username: "合成用户" },
    ["/api/projects/" + id]: { id, version: 1, name: "预约系统", responsibility: "预约接口", resume: "", facts: [] },
    "/api/trainings": [],
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
  await page.goto(`/#/projects/${id}`);
  const room = page.getByRole("dialog", { name: "项目面试室" });
  const canInterrupt = room.getByText("面试官正在播报，可以直接开口打断", { exact: true });
  const listening = room.getByText("正在听你说话", { exact: true });
  const start = page.getByRole("button", { name: "同意并进入语音面试" });
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
