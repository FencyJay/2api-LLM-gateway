# 本次部署修复记录

记录从源码克隆到线上可用的全部修复内容，按问题发生顺序排列。

---

## 修复 1：注册 `/v1` 路由到反向代理

**文件**：`artifacts/api-server/.replit-artifact/artifact.toml`

**问题**：原始 `artifact.toml` 的 `paths` 只包含 `/api`，导致 `/v1/messages`、`/v1/chat/completions`、`/v1/models` 等 LLM 网关端点无法通过外部域名访问（代理层不转发）。

**修改内容**：

```toml
# 修改前
[[services]]
paths = ["/api"]

# 修改后
[[services]]
paths = ["/api", "/v1"]
```

---

## 修复 2：安装缺失的依赖包

**文件**：`artifacts/api-server/package.json`

**问题**：`proxy.ts` 中 `import OpenAI from "openai"` 和 `import Anthropic from "@anthropic-ai/sdk"` 在原项目 `package.json` 中没有声明，导致 esbuild 构建时报错 `Could not resolve "openai"` 和 `Could not resolve "@anthropic-ai/sdk"`，服务无法启动。

**修改内容**：

```bash
pnpm --filter @workspace/api-server add openai @anthropic-ai/sdk
```

在 `package.json` 的 `dependencies` 中新增：
```json
{
  "openai": "^6.33.0",
  "@anthropic-ai/sdk": "^0.82.0"
}
```

---

## 修复 3：剔除 Anthropic SDK 自动注入的不兼容字段

**文件**：`artifacts/api-server/src/routes/proxy.ts`

**问题**：`@anthropic-ai/sdk v0.82.0` 在每次请求时自动向请求体附加 `output_config` 和 `context_management` 等字段，这些是 SDK 新版引入的功能参数。Replit Modelfarm（Anthropic 代理层）底层 API 版本较旧，不识别这些字段，直接返回：

```json
{"type":"error","error":{"type":"invalid_request_error","message":"output_config.format: Extra inputs are not permitted"}}
{"type":"error","error":{"type":"invalid_request_error","message":"context_management: Extra inputs are not permitted"}}
```

**修改内容**：在初始化 `Anthropic` 客户端时，传入自定义 `fetch` 函数，在请求发出前解析请求体并删除不兼容字段：

```typescript
// 新增：不兼容字段黑名单
const ANTHROPIC_UNSUPPORTED_FIELDS = [
  "output_config",
  "context_management",
  "betas",
];

// 新增：自定义 fetch 拦截器
function anthropicFetch(
  url: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (init?.body && typeof init.body === "string") {
    try {
      const body = JSON.parse(init.body);
      for (const field of ANTHROPIC_UNSUPPORTED_FIELDS) {
        delete body[field];
      }
      init = { ...init, body: JSON.stringify(body) };
    } catch {}
  }
  return globalThis.fetch(url, init);
}

// 修改：客户端初始化时注入自定义 fetch
const anthropicClient = new Anthropic({
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL || "...",
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || "_DUMMY_API_KEY_",
  fetch: anthropicFetch,  // 新增此行
});
```

---

## 修复 4：兼容 `x-api-key` 鉴权头

**文件**：`artifacts/api-server/src/routes/proxy.ts`，函数 `verifyBearer`

**问题**：原代码只检查 `Authorization: Bearer <token>` 头（OpenAI 格式）。但 Cherry Studio 等客户端以 Anthropic 格式接入时，发送的是 `x-api-key: <token>` 头（Anthropic 原生格式），导致所有 Anthropic 格式请求返回 `401 Unauthorized`。

**修改内容**：

```typescript
// 修改前
function verifyBearer(req: Request, res: Response): boolean {
  const auth = req.headers["authorization"] ?? "";
  const proxyKey = process.env.PROXY_API_KEY || "codebear";
  if (!proxyKey || auth !== `Bearer ${proxyKey}`) {
    // 返回 401
  }
}

// 修改后：同时接受两种认证头
function verifyBearer(req: Request, res: Response): boolean {
  const proxyKey = process.env.PROXY_API_KEY || "codebear";
  const auth = req.headers["authorization"] ?? "";
  const xApiKey = req.headers["x-api-key"] ?? "";
  const valid = auth === `Bearer ${proxyKey}` || xApiKey === proxyKey;
  if (!valid) {
    // 返回 401
  }
}
```

---

## 修复 5：修复非流式请求错误使用流式接口

**文件**：`artifacts/api-server/src/routes/proxy.ts`

**涉及路由**：
- `POST /v1/chat/completions`（Anthropic 模型非流式分支）
- `POST /v1/messages`（Anthropic 原生非流式分支）

**问题**：两处非流式请求均错误地调用了 `anthropicClient.messages.stream().finalMessage()`。SDK 的 `.stream()` 方法内部强制发送 `stream: true` 给 Modelfarm，并在接收 SSE 事件后聚合返回。Modelfarm 返回的 SSE 格式与 SDK v0.82.0 的 `MessageStream` 解析器预期不一致，导致内部 `maybeParseMessage` 报错：

```
TypeError: Cannot use 'in' operator to search for 'parse' in text
    at maybeParseMessage (anthropic-ai/sdk/src/lib/parser.ts:53:20)
    at _MessageStream._createMessage (MessageStream.ts:209:29)
```

**修改内容**：

```typescript
// 修改前（两处）
const final = await anthropicClient.messages
  .stream(params as Anthropic.MessageStreamParams)
  .finalMessage();
res.json(final);

// 修改后：直接使用 create() 发非流式请求
const final = await anthropicClient.messages.create({
  ...params,
  stream: false,
} as Anthropic.MessageCreateParamsNonStreaming);
res.json(final);
```

---

## 修复 6：修复流式请求绕过不兼容的 MessageStream 解析器

**文件**：`artifacts/api-server/src/routes/proxy.ts`

**涉及路由**：
- `POST /v1/chat/completions`（Anthropic 模型流式分支）
- `POST /v1/messages`（Anthropic 原生流式分支）

**问题**：原代码使用 `anthropicClient.messages.stream()` 高级接口，其内部使用 `MessageStream` 类封装 SSE 解析。SDK v0.82.0 的 `MessageStream` 使用 Zod v4 进行事件验证，与 Modelfarm 的 SSE 事件格式存在兼容性问题，导致流式请求在事件解析阶段崩溃。

**修改内容**：改用低级的 `messages.create({stream: true})` 接口，该接口直接返回原始 `RawMessageStreamEvent` 异步迭代器，完全绕过 `MessageStream` 的内部解析器：

```typescript
// 修改前
const s = anthropicClient.messages.stream(params);
for await (const event of s) {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

// 修改后：使用低级接口，直接迭代原始 SSE 事件
const rawStream = await anthropicClient.messages.create({
  ...params,
  stream: true,
} as Anthropic.MessageCreateParamsStreaming);
for await (const event of rawStream) {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}
```

---

## 修复 7：全局 JSON 错误处理器

**文件**：`artifacts/api-server/src/app.ts`

**问题**：Express 默认错误处理器在发生未捕获异常时（如请求体解析失败、路由抛出异常）返回 HTML 格式的错误页面（`<pre>Bad Request</pre>`），Claude Code 等 API 客户端无法解析 HTML，只能看到 `400 <!DOCTYPE html>...` 这样的错误。

**修改内容**：在所有路由之后挂载全局错误处理中间件，确保任何错误都以 JSON 格式返回：

```typescript
import { type NextFunction } from "express";

// 挂载于所有路由之后
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? err.statusCode ?? 500;
  const message = err.message ?? "Internal Server Error";
  logger.error({ err, url: req.url, method: req.method }, "Unhandled error");
  res.status(status).json({
    error: {
      message,
      type: "server_error",
      code: String(status),
    },
  });
});
```

---

## 受影响文件汇总

| 文件 | 修改类型 |
|------|----------|
| `artifacts/api-server/.replit-artifact/artifact.toml` | 添加 `/v1` 路由路径 |
| `artifacts/api-server/package.json` | 添加 `openai`、`@anthropic-ai/sdk` 依赖 |
| `artifacts/api-server/src/routes/proxy.ts` | 自定义 fetch 拦截器、双头鉴权、修复非流式和流式调用方式 |
| `artifacts/api-server/src/app.ts` | 添加全局 JSON 错误处理器 |
| `artifacts/api-portal/`（整个目录） | 新增前端门户 artifact |
