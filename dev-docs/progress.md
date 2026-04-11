# Feature Progress

## P0 — Foundation (Critical)
- [x] Monorepo workspace setup
- [x] API server with proxy routing
- [x] Protocol translation (OpenAI ↔ Anthropic)
- [x] SSE streaming proxy
- [x] Database layer (Drizzle + PostgreSQL)

## P1 — Core Features
- [x] Admin portal (React + Vite)
- [x] Shared Zod schemas
- [x] API client React hooks
- [ ] Unit test coverage for api-server
- [ ] Unit test coverage for shared libs

## 2026-04-11: 修复 Anthropic 代理兼容性（支持 Claude Code 非流式输出）

### 变更文件
- `artifacts/api-server/src/routes/proxy.ts`
- `artifacts/api-server/src/app.ts`

### 修复内容
1. **自定义 fetch 拦截器** — 剔除 SDK v0.82.0 自动注入的 `output_config`、`context_management`、`betas` 等 Modelfarm 不支持的字段
2. **兼容 x-api-key 鉴权** — `verifyBearer` 同时接受 `Authorization: Bearer` 和 `x-api-key` 两种认证头
3. **修复非流式请求** — `/v1/chat/completions` 和 `/v1/messages` 的 Anthropic 非流式分支从 `.stream().finalMessage()` 改为 `.create({stream: false})`，解决 SDK MessageStream 解析器与 Modelfarm SSE 格式不兼容导致的崩溃
4. **修复流式请求** — 流式分支从 `.stream()` 高级接口改为 `.create({stream: true})` 低级接口，绕过 MessageStream 内部 Zod v4 事件验证的兼容问题
5. **全局 JSON 错误处理器** — Express 所有路由之后挂载错误中间件，确保异常以 JSON 格式返回，而非默认的 HTML 错误页

---

## P2 — Quality & Operations
- [ ] CI pipeline
- [ ] E2E tests for admin portal
- [ ] API integration tests
- [ ] Logging & monitoring

## P3 — Enhancements
- [ ] Rate limiting
- [ ] Usage analytics dashboard
- [ ] Multi-tenant support
