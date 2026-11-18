import { test, expect } from "@playwright/test";

test("新用户只填必要材料即可一题体验，无订单和权益消费", async ({ page }) => {
  await page.goto("/#/login");
  await page.getByLabel("用户名", { exact: true }).fill("trial-" + crypto.randomUUID());
  await page.getByLabel("密码", { exact: true }).fill("synthetic-trial-password");
  await page.getByRole("button", { name: "注册并开始" }).click();
  await page.goto("/#/projects/new");
  await expect(page.getByText("先填两项，就能开始", { exact: true })).toBeVisible();
  await page.getByText("个人职责怎么写？查看填写参考", { exact: true }).click();
  await expect(page.getByText(/合成示例：我负责预约创建接口/)).toBeVisible();
  await page.getByLabel("项目名称", { exact: true }).fill("合成试练项目");
  await page.getByLabel("个人职责（必填）", { exact: true }).fill("我实现预约接口和数据库唯一约束。");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "载入合成示例" }).click();
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue("合成试练项目");
  await expect(page.getByLabel("个人职责（必填）", { exact: true })).toHaveValue("我实现预约接口和数据库唯一约束。");
  await page.getByRole("button", { name: "保存项目材料", exact: true }).click();
  const trial = page.getByRole("region", { name: "我的项目一题体验" });
  await trial.getByRole("button", { name: "开始一题体验", exact: true }).click();
  await expect(trial.getByRole("heading", { name: /请介绍/ })).toBeVisible();
  await trial.getByLabel("体验回答").fill("我负责接口，数据库唯一约束防止重复预约。");
  await trial.getByRole("button", { name: "提交体验回答" }).click();
  await expect(trial.getByRole("heading", { name: "针对你的回答" })).toBeVisible();
  const projectId = page.url().split("/").pop()!;
  const original = await (await page.request.get("/api/projects/" + projectId)).json();
  await trial.getByRole("button", { name: "预览回答补充到材料" }).click();
  await expect(trial.getByLabel("项目材料补充预览")).toContainText("我负责接口");
  expect((await (await page.request.get("/api/projects/" + projectId)).json()).version).toBe(original.version);
  await trial.getByRole("button", { name: "确认保存回答补充" }).click();
  const saved = await (await page.request.get("/api/projects/" + projectId)).json();
  expect(saved.materials).toContain("用户自述，未独立验证");
  expect(saved.version).toBe(original.version + 1);
  expect(saved.factsConfirmed).toBe(false);
  await trial.getByRole("button", { name: "预览回答补充到材料" }).click();
  await expect(trial.getByText("这段回答已在项目材料中，无需重复加入。")).toBeVisible();
  await trial.getByRole("button", { name: "前往事实核对", exact: true }).click();
  await expect(page.getByRole("heading", { name: "项目事实清单" })).toBeVisible();
  const review = page.getByRole("region", { name: "自愿体验反馈" });
  await review.getByRole("button", { name: "4分", exact: true }).click();
  await review.getByRole("button", { name: "愿意继续", exact: true }).click();
  await review.getByLabel("最卡住的一步（可选）").fill("合成调研：需要明确下一步。");
  await review.getByRole("button", { name: "保存体验反馈" }).click();
  await expect(review.getByRole("status")).toContainText("已记录这次体验反馈");
  const feedback = await (await page.request.get("/api/feedback")).json();
  expect(feedback.filter((item: { body: string }) => item.body.includes("非付费记录"))).toHaveLength(1);
  expect((await (await page.request.get("/api/shop")).json()).orders).toHaveLength(0);
  await page.reload();
  await expect(trial.getByRole("heading", { name: "针对你的回答" })).toBeVisible();
});

test("体验草稿刷新与返回后保留，读取失败必须显式重试", async ({ page }) => {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post("/api" + path, { headers: { Origin: origin }, data });
    expect(r.ok()).toBeTruthy(); return r.json();
  };
  await post("/auth/register", { username: "draft-trial-" + crypto.randomUUID(), password: "synthetic-trial-password" });
  const p = await post("/projects", { name: "草稿体验", responsibility: "预约接口" });
  const active = await post(`/projects/${p.id}/practice`, {});
  await page.goto(`/#/projects/${p.id}`);
  const trial = page.getByRole("region", { name: "我的项目一题体验" });
  await trial.getByLabel("体验回答").fill("未提交的合成回答：数据库唯一约束。");
  page.on("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(trial.getByLabel("体验回答")).toHaveValue("未提交的合成回答：数据库唯一约束。");
  await page.goto("/#/account");
  await page.goto(`/#/projects/${p.id}`);
  await expect(trial.getByLabel("体验回答")).toHaveValue("未提交的合成回答：数据库唯一约束。");
  let failed = true, writes = 0;
  await page.route(`**/api/projects/${p.id}/practice`, async route => {
    if (route.request().method() !== "GET") { writes++; await route.abort(); return; }
    if (failed) await route.fulfill({ status: 503, json: { message: "合成状态读取失败" } });
    else await route.fulfill({ json: active });
  });
  await page.reload();
  await expect(trial.getByRole("alert")).toContainText("合成状态读取失败");
  await expect(trial.getByRole("button", { name: "开始一题体验", exact: true })).toHaveCount(0);
  failed = false;
  await trial.getByRole("button", { name: "重新读取体验状态" }).click();
  await expect(trial.getByLabel("体验回答")).toHaveValue("未提交的合成回答：数据库唯一约束。");
  expect(writes).toBe(0);
});

test("刷新遇到正在生成只轮询读取，不重复提交", async ({ page }) => {
  const id = "22222222-2222-4222-8222-222222222222";
  let reads = 0, writes = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json;
    if (path === "/api/config") json = { modelMode: "demo", paymentMode: "mock" };
    else if (path === "/api/me") json = { id: "synthetic", username: "生成恢复" };
    else if (path === "/api/projects/" + id) json = { id, version: 1, name: "合成项目", responsibility: "接口", resume: "", facts: [] };
    else if (path.endsWith("/practice")) {
      if (route.request().method() !== "GET") { writes++; await route.abort(); return; }
      reads++;
      json = reads === 1 ? { status: "GENERATING" } : { status: "ACTIVE", turns: [{ id: "turn", question: "请说明预约流程。", answer: "" }] };
    } else if (path === "/api/trainings") json = [];
    else if (path === "/api/shop") json = { orders: [], packages: [] };
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
    "/api/config": { modelMode: "demo", paymentMode: "mock" },
    "/api/me": { id: "synthetic", username: "合成用户" },
    ["/api/projects/" + id]: { id, version: 1, name: "合成项目", responsibility: "接口", resume: "", facts: [] },
    ["/api/projects/" + id + "/practice"]: {
      status: "ACTIVE", maxTurns: 5,
      turns: [{ id: "turn", question: "请说明预约流程。", answer: "" }],
    },
    "/api/trainings": [],
    "/api/shop": { orders: [], packages: [] },
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
  const answer = room.getByRole("textbox", { name: "体验回答" });
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
    "/api/config": { modelMode: "live", paymentMode: "mock", speechEnabled: true },
    "/api/me": { id: "synthetic", username: "合成用户" },
    ["/api/projects/" + id]: { id, version: 1, name: "合成项目", responsibility: "接口", resume: "", facts: [] },
    [practice]: {
      status: "ACTIVE", maxTurns: 5,
      turns: [{ id: "asr-turn", question: "请说明预约流程。", answer: "" }],
    },
    "/api/trainings": [],
    "/api/shop": { orders: [], packages: [] },
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
  const answer = room.getByRole("textbox", { name: "体验回答" });
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

test("同意语音面试后自动接话，问候留在同一题", async ({ page }) => {
  const id = "55555555-5555-4555-8555-555555555555";
  const path = "/api/projects/" + id + "/practice";
  const responses: Record<string, unknown> = {
    "/api/config": { modelMode: "demo", paymentMode: "mock", speechEnabled: true },
    "/api/me": { id: "synthetic", username: "合成用户" },
    ["/api/projects/" + id]: { id, version: 1, name: "预约系统", responsibility: "预约接口", resume: "", facts: [] },
    "/api/trainings": [],
    "/api/shop": { orders: [], packages: [] },
  };
  const initialTurn = { id: "first", question: "如何避免重复预约？", answer: "" };
  const response = { status: "ACTIVE", maxTurns: 5, turns: [initialTurn] };
  const sufficient = "我们在数据库设置请求标识的唯一约束，重复请求读取原结果，并验证两次同时提交只产生一条记录。";
  const sentences = ["你好", sufficient];
  const replies = [
    { ...response, turns: [{ ...initialTurn, exchanges: [{ answer: "你好", reply: "你好，我们继续说说重复预约。" }] }] },
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

  await page.route(/\/src\/voice-activity\.ts(?:\?|$)/, route => route.fulfill({
    contentType: "text/javascript",
    body: [
      "export class VoiceActivity {",
      "  static async create(_rate, begin, end) {",
      "    let armed = false;",
      "    window.testSpeak = () => { if (armed) { begin(); end(new Float32Array(16000)); } };",
      "    return { feed() {}, pause() { armed = false }, async resume() { armed = true }, async destroy() { armed = false } };",
      "  }",
      "}",
    ].join("\n"),
  }));
  await page.addInitScript(() => {
    const state = window as unknown as {
      testMic?: MediaStreamTrack;
      testPlayback?: SpeechSynthesisUtterance;
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const stream = new AudioContext().createMediaStreamDestination().stream;
        state.testMic = stream.getAudioTracks()[0];
        return stream;
      },
    });
    Object.defineProperties(speechSynthesis, {
      speak: { value: (utterance: SpeechSynthesisUtterance) => {
        state.testPlayback = utterance;
        queueMicrotask(() => utterance.onstart?.(new Event("start") as SpeechSynthesisEvent));
      } },
      cancel: { value: () => { state.testPlayback = undefined; } },
    });
  });

  await page.goto("/#/projects/" + id);
  const micState = () => page.evaluate(() => {
    const mic = (window as unknown as { testMic?: MediaStreamTrack }).testMic;
    return mic ? [mic.readyState, mic.enabled] : null;
  });
  const endPlayback = () => page.evaluate(() => {
    const state = window as unknown as { testPlayback: SpeechSynthesisUtterance };
    state.testPlayback.onend?.(new Event("end") as SpeechSynthesisEvent);
  });
  const saySomething = () => page.evaluate(() => {
    (window as unknown as { testSpeak: () => void }).testSpeak();
  });
  const start = page.getByRole("button", { name: "同意并进入语音面试" });
  await expect(start).toHaveAccessibleDescription(/自动发往阿里云百炼/);
  expect(await micState()).toBeNull();
  await start.click();
  const room = page.getByRole("dialog", { name: "项目面试室" });
  await expect(room.getByText("轮到你时，麦克风会自动恢复")).toBeVisible();
  await expect.poll(micState).toEqual(["live", false]);
  expect(uploads).toBe(0);
  await endPlayback();
  await expect(room.getByText("麦克风已开启，可以直接说话")).toBeVisible();
  await saySomething();
  await expect(room.getByText("你好，我们继续说说重复预约。")).toBeVisible();
  await expect(room.getByText("第 1 / 5 题")).toBeVisible();
  await expect.poll(micState).toEqual(["live", false]);
  await endPlayback();
  await expect(room.getByText("麦克风已开启，可以直接说话")).toBeVisible();
  await saySomething();
  await expect(room.getByText("第 2 / 5 题")).toBeVisible();
  await expect(room.getByRole("heading", { name: "如何处理缓存失效？" })).toBeVisible();
  expect([uploads, submissions]).toEqual([2, 2]);
  await room.getByRole("button", { name: "返回项目" }).click();
  await expect(room).toBeHidden();
  await expect.poll(micState).toEqual(["ended", false]);
});
