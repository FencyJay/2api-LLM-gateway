# AI 反向代理网关

基于 Replit AI Integrations 的 AI 反向代理，无需用户提供 API Key，同时兼容 OpenAI 和 Anthropic 协议，支持 19 个模型。

## 功能

- `POST /v1/chat/completions` — OpenAI 兼容格式，支持全部 19 个模型（含 claude-* 自动转换）
- `POST /v1/messages` — Anthropic 原生格式，支持全部 19 个模型（含 gpt-* 自动转换）
- `GET /v1/models` — 返回全部可用模型列表
- Bearer Token 鉴权（`PROXY_API_KEY`）
- 支持流式输出（SSE）和工具调用（Function Calling）

**支持的模型：** gpt-5.2 / gpt-5.1 / gpt-5 / gpt-5-mini / gpt-5-nano / gpt-4.1 / gpt-4.1-mini / gpt-4.1-nano / gpt-4o / gpt-4o-mini / o4-mini / o3 / o3-mini / claude-opus-4-6 / claude-opus-4-5 / claude-opus-4-1 / claude-sonnet-4-6 / claude-sonnet-4-5 / claude-haiku-4-5

---

## 迁移到新账号 — 一键 AI 配置

从 GitHub 导入此项目后，**把 [`docs/MIGRATION_PROMPT.md`](./docs/MIGRATION_PROMPT.md) 的全部内容粘贴给 Replit AI 代理**，它会自动完成所有配置，包括：

- ✅ 自动调用 `setupReplitAIIntegrations` 注入 OpenAI 和 Anthropic 访问凭证
- ✅ 自动生成并设置 `SESSION_SECRET`
- ✅ 引导你设置 `PROXY_API_KEY`（唯一需要你输入的值）
- ✅ 自动运行验证脚本、构建、测试接口
- ✅ 提示发布上线

**整个过程你只需要：设置一个自定义的 `PROXY_API_KEY`（任意字符串），其余全部由 AI 自动完成。**

> ⚠️ Replit AI Integrations（modelfarm）是账号级别的功能，必须在新账号里重新初始化。迁移提示词会指导 AI 自动完成此操作。

---

### 手动配置（如不使用 AI 代理）

如需手动配置，在 Shell 中运行验证脚本查看缺少哪些配置：

```bash
node scripts/check-setup.mjs
```

---

## 快速验证（curl）

```bash
# 替换为你的部署域名和 PROXY_API_KEY
BASE="https://your-app.replit.app"
KEY="your-proxy-api-key"

# 健康检查
curl $BASE/api/healthz

# 列出所有模型
curl $BASE/v1/models -H "Authorization: Bearer $KEY"

# 测试 Anthropic 模型（OpenAI 格式）
curl $BASE/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5","messages":[{"role":"user","content":"Hello!"}],"max_tokens":30}'

# 测试 OpenAI 模型
curl $BASE/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5-mini","messages":[{"role":"user","content":"Hello!"}],"max_tokens":30}'
```

---

## 技术文档

详见 [`docs/REBUILD_GUIDE.md`](./docs/REBUILD_GUIDE.md) — 包含完整的实现原理、协议转换规范、Anthropic 常见失败修复方案，以及所有接口的请求/响应格式说明。

---

## 技术栈

- **Runtime:** Node.js + TypeScript
- **Framework:** Express 5
- **AI SDKs:** openai@^6.33.0 · @anthropic-ai/sdk@^0.82.0
- **Upstream:** Replit Modelfarm (localhost:1106/modelfarm)
- **Frontend:** React + Vite（门户页面）
- **Package Manager:** pnpm workspace
