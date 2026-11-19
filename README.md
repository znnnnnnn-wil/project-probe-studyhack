# 项目追问官 · StudyHack 参赛开发版

围绕真实项目材料练习连续技术追问，保留原回答与材料依据，把复盘变成可执行的补充任务。

从 `E:\project\new\zhifubao` 复制并改造，原目录未修改。当前副本没有复制原项目的 `.env`、`.secrets`、运行数据库、账号或部署身份。

## 现在可以做什么

- 免登录示例包含预约系统、课程资料 RAG、定时通知三个合成项目，支持五轮练习、问答回看、自查笔记与 Markdown 导出。
- 登录后可手动填写项目材料，也可上传简历，核对识别出的项目后一次保存。
- 每个项目可直接开始五轮追问。完成后可以查看原回答、引用与补充任务，也可以开始新一轮，在训练记录中回看历次复盘。

**默认是规则演示，未配置模型密钥，不构成真实 AI 技术评估。** 免登录示例完全在浏览器运行；登录后的自有项目练习由本副本后端保存并处理。AI 模式失败会提示恢复，不会自动伪装成规则模式成功。

## 本地启动

要求 Node.js 22+、Java 17、Maven 3.9+。在根目录打开两个 PowerShell：

```powershell
./scripts/start-backend.ps1
```

```powershell
./scripts/start-frontend.ps1
```

访问 **http://localhost:5273/**。后端为 **http://127.0.0.1:8180**，与原项目默认端口分开。默认数据保存在本目录 `backend/data`，不连接原项目数据库。

也可以在 `backend` 执行 `mvn.cmd spring-boot:run`，在 `frontend` 执行 `npm.cmd ci`、`npm.cmd run dev`。Windows 启动脚本支持读取根目录 `.env`；直接用 Maven 启动时需自行提供环境变量。

要启用真实 AI，把 `.env.example` 复制为 `.env`，填写自己的模型配置。密钥不要放入前端。

登录后五轮面试可使用百炼 `qwen3-asr-flash` 转写，服务端按 `.env.example` 配置语音识别。同意进入语音面试后，面试官播报完会自动开启收音。停顿后，录音会发送到阿里云百炼，转写作为当前题的一次发言。用户可以随时暂停麦克风或改用文字回答。模型会根据本题对话判断继续追问还是进入下一题。

## 构建与验证

```powershell
# backend 目录
mvn.cmd package

# frontend 目录
npm.cmd run build
npm.cmd exec playwright test -- --config playwright.competition.config.ts
```

浏览器验收默认使用独立的 5175/18083 端口、合成账号、H2 内存数据库和规则模型。

如果已经启动本副本，可针对该服务执行（将创建合成测试账号）：

```powershell
$env:PROBE_TEST_EXTERNAL_URL='http://localhost:5273'
npm.cmd exec playwright test -- --config playwright.competition.config.ts
```

前端构建产物为 `frontend/dist`；只部署静态产物即可运行首页和免登录示例。自有项目与真实模型功能还需要后端及同源 `/api` 代理。

## 比赛交付

产品定位、核心流程与验收标准见 [产品设计文档](docs/PRODUCT_DESIGN.md)。参赛准备与三分钟演示脚本见 [docs/COMPETITION.md](docs/COMPETITION.md)，移植来源和验证记录见 [docs/MIGRATION.md](docs/MIGRATION.md)。

本仓库使用关联 Issue 的 PR 协作。每个 PR 的新增与删除行数合计不超过 500；GitHub Actions 会检查行数和 `Closes #编号`。原版源码首次导入为初始化基线，后续改造按依赖顺序分支审阅。

目前仅完成本地开发与验证，**尚未发布到 Qoder Sites，也尚未提交比赛**。本次改造由 Codex 完成；比赛要求的 Qoder 开发、调试与部署过程需实际完成并保留记录，不能把本次记录写成 Qoder 使用证据。
