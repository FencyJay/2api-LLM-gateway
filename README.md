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

## 迁移到新账号 — 快速配置清单

从 GitHub 导入此项目后，**必须完成以下步骤**，否则服务无法正常运行：

### ✅ 第一步：启用 Replit AI Integrations

在 Replit 左侧边栏 **Tools → Integrations** 中，分别启用：

1. **OpenAI** 集成 → 自动注入 `AI_INTEGRATIONS_OPENAI_BASE_URL` 和 `AI_INTEGRATIONS_OPENAI_API_KEY`
2. **Anthropic** 集成 → 自动注入 `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` 和 `AI_INTEGRATIONS_ANTHROPIC_API_KEY`

> ⚠️ 这两个集成是账号级别的，必须在新账号里重新开启。代码中的 `localhost:1106/modelfarm` 地址只在启用了集成的 Replit 容器内有效。

### ✅ 第二步：设置 Secrets（环境变量）

在 Replit 左侧边栏 **Tools → Secrets** 中，添加以下密钥：

| Secret 名称 | 说明 | 示例值 |
|---|---|---|
| `PROXY_API_KEY` | 对外鉴权的 Bearer Token（自定义） | `my-secret-proxy-key-2024` |
| `SESSION_SECRET` | Express session 签名密钥（随机字符串） | `any-random-string-here` |

### ✅ 第三步：验证配置

在 Replit Shell 中运行：

```bash
node scripts/check-setup.mjs
```

输出全部 ✅ 即配置完成。

### ✅ 第四步：启动并部署

1. 在工作流面板启动 `API Server` 和 `API Portal` 工作流
2. 访问门户确认状态显示 **Online**
3. 点击 **Publish** 发布上线

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
