# 项目追问官 · StudyHack

给准备技术实习的学生做的项目面试练习工具。围绕项目材料连续追问，把「我做了什么、怎么实现、怎么验证」讲成能核对的细节。

**[打开项目追问官](https://project-probe-ooc80l33zpz.qoder.website/)** · [三分钟演示指引](docs/COMPETITION.md)

## 在线体验

1. 打开站点，点击「开始示例练习」，选择「校园自习室预约系统」。
2. 点击「开始五轮练习」和「同意并开始语音面试」，按浏览器提示授权麦克风。
3. 听数字人提问后开口回答。示例也可以点击「发送参考回答」继续。
4. 练完查看复盘，回看原回答、改进建议和依据。有合适的改进项时可以再答一次做对照，也可以导出复盘。

示例练习免登录，也可以选择「课程资料问答助手」或「校园通知定时发送服务」。登录后可手动填写项目，或上传简历、核对提取结果再保存。自己的项目可以选定主题练习，在训练记录中回看历次复盘。

## 本地启动

需要 Node.js 22.12+、Java 17 和 Maven 3.9+。在仓库根目录打开两个 PowerShell，分别运行：

```powershell
./scripts/start-backend.ps1
```

```powershell
./scripts/start-frontend.ps1
```

浏览器访问 <http://localhost:5273/>。后端默认监听 `127.0.0.1:8180`，H2 数据保存在 `backend/data`。

也可在 `backend` 运行 `mvn spring-boot:run`，在 `frontend` 运行 `npm ci` 和 `npm run dev`。Windows 启动脚本读取根目录 `.env`，直接运行 Maven 时请通过环境变量提供配置。

本地默认使用规则模式，语音能力默认关闭。启用真实模型和云端语音时，参考 [.env.example](.env.example) 设置服务端环境变量，模型密钥只由后端读取。

## 构建与验证

在 `backend` 构建 JAR 并运行单元测试：

```sh
mvn package
```

在 `frontend` 安装依赖、构建并运行参赛路径的浏览器测试：

```sh
npm ci
npm run build
npx playwright test --config playwright.competition.config.ts
```

浏览器测试需要先构建后端 JAR。Windows 使用已安装的 Edge，其他平台先执行 `npx playwright install chromium`。参赛测试默认启动独立的 5175 和 18083 端口，使用合成账号、H2 内存数据库和规则模式。

已启动本地服务时，可在 PowerShell 中先设置 `$env:PROBE_TEST_EXTERNAL_URL = 'http://localhost:5273'`，再运行浏览器测试。测试会创建合成账号。

## 实现与部署

- **前端**使用 React、TypeScript 和 Vite，采用 Hash 路由，产物在 `frontend/dist`。
- **后端**使用 Java 17、Spring Boot 和 Flyway，处理项目材料、练习、复盘和会话。
- **语音**支持百炼实时转写。实时识别不可用时可退回整段录音转写，播报支持云端合成。
- **部署**中，公开前端由 Qoder Sites 托管，面试和语音连接独立的 HTTPS API。本地 Vite 默认将同源 `/api` 代理到后端。自行部署时需接通后端与会话，实时转写的代理还需支持 WebSocket 升级。

更多细节见[产品设计](docs/PRODUCT_DESIGN.md)、[参赛准备](docs/COMPETITION.md)和[初始迁移记录](docs/MIGRATION.md)。

## 贡献方式

通过关联 Issue 的 PR 提交。PR 正文使用 `Closes #编号`，新增与删除合计最多 500 行，附上实际验证记录。
