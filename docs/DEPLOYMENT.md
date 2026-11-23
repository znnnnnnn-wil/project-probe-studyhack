# 部署项目追问官

前端构建产物为 `frontend/dist`，可上传到 Qoder Sites 等静态托管。Spring Boot 后端独立运行，提供面试生成、语音、项目材料和训练记录服务。正式环境使用 HTTPS，模型密钥由后端环境变量提供，参考 [根目录配置示例](../.env.example)。

## 同源部署

在 `frontend` 目录执行 `npm ci` 和 `npm run build`。前端默认向当前站点的 `/api` 发起请求。通过反向代理将 `/api/...` 原样转发给 Spring Boot，保留 WebSocket 升级请求。后端的 `APP_ORIGIN` 设为页面的 HTTPS 来源，`SECURE_COOKIE` 设为 `true`。

## 前端托管在 Qoder Sites，后端独立部署

将后端暴露在经 HTTPS 保护的 API 地址。假设前端为 `https://app.example.com`，反向代理将 `https://api.example.net/project-probe/api/...` 映射到 Spring Boot 的 `/api/...`。

在 `frontend` 目录执行：

```powershell
npm ci
$env:VITE_API_BASE = 'https://api.example.net/project-probe/api'
npm run build
```

`VITE_API_BASE` 是构建时读取的公开地址，包含 API 路径前缀。上传构建生成的 `dist` 并发布。修改 API 地址后，重新构建并上传即可。前端所有 API 请求、云端播报和实时转写 WebSocket 共用这个地址。

后端和反向代理需要以下配置：

- 将 `APP_ORIGIN` 设为前端的准确来源（协议、主机和端口，不带路径），开启 `SECURE_COOKIE=true`，保留 Spring Boot 的来源校验。
- 仅对该前端来源启用携带凭据的 CORS。代理要正确应答预检，并在实际响应中返回该来源和 `Access-Control-Allow-Credentials: true`。保留 `Origin`、`Set-Cookie`、WebSocket 升级和音频、流式响应。
- 两个主机跨站时，在 API 代理针对 `probe_session` 和 `probe_example` 设置 `SameSite=None; Secure`，保留 `HttpOnly` 和原 Cookie 路径。如代理设置了路径前缀，确保 Cookie 的路径也适配该前缀。阻止第三方 Cookie 的浏览器可能无法保持访客和登录会话，要求覆盖这类浏览器时选用同源部署。

## 发布后检查

1. 用访客浏览器打开正式网址，确认首页的「用我的项目练习」可用，配置请求命中实际后端。
2. 进入示例面试，提交回答后刷新，确认本轮进度恢复。另测一次登录，刷新后检查账号和项目列表。
3. 启用语音服务时，检查云端播报可播放、实时转写 WebSocket 成功建立，并验证录音转写的回退路径。
4. 走完示例五轮，打开训练记录中的复盘。
