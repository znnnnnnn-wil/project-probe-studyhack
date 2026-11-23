# 项目追问官 · StudyHack 参赛开发版

围绕真实项目材料练习连续技术追问，保留原回答与材料依据，把复盘变成可执行的补充任务。

从 `E:\project\new\zhifubao` 复制并改造，原目录未修改。当前副本没有复制原项目的 `.env`、`.secrets`、运行数据库、账号或部署身份。

## 现在可以做什么

- 预约系统、课程资料 RAG 和定时通知三个示例项目已填好材料。访客可直接进入正式语音面试室，并在同一浏览器查看训练记录、报告和复测。
- 登录后可手动填写项目材料，也可上传简历，核对识别出的项目后一次保存。
- 每个项目可直接开始五轮追问。完成后可以查看原回答、引用与补充任务，也可以开始新一轮，在训练记录中回看历次复盘。

默认使用规则模型。两类面试均由后端保存和处理，启用真实模型后共享 AI 追问及复盘能力。访客会话自首次进入起保留 30 天。

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

示例和自有项目的语音面试均使用百炼转写，服务端配置见 `.env.example`。实时模式在本地检测到发言后，把音频发送到 `qwen3-asr-flash-realtime`，说完后将最终文字提交一次。实时识别不可用时，`qwen3-asr-flash` 会转写本地保留的整段录音。用户可以随时暂停麦克风。实时模式需要同源 `/api` 代理支持 WebSocket 升级。

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

前端构建产物为 `frontend/dist`。首页和快捷追问演示可静态部署。示例与自有项目的语音面试、报告及训练记录需要后端和同源 `/api`。

## 比赛交付

产品定位、核心流程与验收标准见 [产品设计文档](docs/PRODUCT_DESIGN.md)。参赛准备与三分钟演示脚本见 [docs/COMPETITION.md](docs/COMPETITION.md)，移植来源和验证记录见 [docs/MIGRATION.md](docs/MIGRATION.md)。

本仓库使用关联 Issue 的 PR 协作。每个 PR 的新增与删除行数合计不超过 500；GitHub Actions 会检查行数和 `Closes #编号`。原版源码首次导入为初始化基线，后续改造按依赖顺序分支审阅。

目前仅完成本地开发与验证，**尚未发布到 Qoder Sites，也尚未提交比赛**。本次改造由 Codex 完成；比赛要求的 Qoder 开发、调试与部署过程需实际完成并保留记录，不能把本次记录写成 Qoder 使用证据。
