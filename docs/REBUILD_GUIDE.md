# AI 反向代理网关 — 精确重建与审核修复提示词

## 项目目标

在 Replit 上构建一个 AI 反向代理网关（Express + TypeScript），使用 **Replit AI Integrations**（无需用户提供 API Key），对外同时暴露：

- `POST /v1/chat/completions` — OpenAI 兼容格式，支持全部 19 个模型
- `POST /v1/messages` — Anthropic 原生格式，支持全部 19 个模型（OpenAI 模型自动双向转换）
- `GET /v1/models` — 返回全部可用模型列表

全部接口均以 Bearer Token 鉴权（`PROXY_API_KEY` 环境变量）。

---

## 一、环境变量（Replit AI Integrations 自动注入）

通过 Replit AI Integrations 面板启用 OpenAI 和 Anthropic 集成后，以下环境变量**自动注入**，值固定为：

```
AI_INTEGRATIONS_OPENAI_BASE_URL   = http://localhost:1106/modelfarm/openai
AI_INTEGRATIONS_OPENAI_API_KEY    = _DUMMY_API_KEY_

AI_INTEGRATIONS_ANTHROPIC_BASE_URL = http://localhost:1106/modelfarm/anthropic
AI_INTEGRATIONS_ANTHROPIC_API_KEY  = _DUMMY_API_KEY_
```

**关键：** 这是 Replit 容器内部的 modelfarm 代理，只在容器运行时有效。`_DUMMY_API_KEY_` 是字面字符串，必须原样传入。

**自行设置的环境变量：**

```
PROXY_API_KEY = <自定义 Bearer Token，用于对外鉴权>
SESSION_SECRET = <Express session 密钥>
```

---

## 二、Replit Modelfarm 实际行为（已通过实测验证，极其关键）

### 2.1 OpenAI 上游

```
BASE_URL: http://localhost:1106/modelfarm/openai
```

**✅ 正确路径：**
```
POST http://localhost:1106/modelfarm/openai/chat/completions
```

**❌ 错误路径（会返回 INVALID_ENDPOINT）：**
```
POST http://localhost:1106/modelfarm/openai/v1/chat/completions   ← 错误
POST http://localhost:1106/modelfarm/openai/v1/responses          ← 不支持
GET  http://localhost:1106/modelfarm/openai/v1/models             ← 返回 405
```

**SDK 行为（openai npm 包 v6.x）：**
当 `baseURL = "http://localhost:1106/modelfarm/openai"` 时，OpenAI SDK 实际发出的请求 URL 是：
```
http://localhost:1106/modelfarm/openai/chat/completions   ← SDK 自动去掉 /v1/ 前缀
```
这与 modelfarm 期望的路径完全一致，**无需任何特殊处理**，直接将 `AI_INTEGRATIONS_OPENAI_BASE_URL` 作为 `baseURL` 传入即可。

### 2.2 Anthropic 上游

```
BASE_URL: http://localhost:1106/modelfarm/anthropic
```

**✅ 正确路径：**
```
POST http://localhost:1106/modelfarm/anthropic/v1/messages
```

**SDK 行为（@anthropic-ai/sdk v0.82+）：**
当 `baseURL = "http://localhost:1106/modelfarm/anthropic"` 时，SDK 实际发出的请求 URL 是：
```
http://localhost:1106/modelfarm/anthropic/v1/messages   ← 正确
```
同样直接将 `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` 传入即可。

**Anthropic 请求必须包含的 Header（SDK 自动添加）：**
```
x-api-key: _DUMMY_API_KEY_
anthropic-version: 2023-06-01
content-type: application/json
```

### 2.3 Modelfarm 不支持的功能

- 不支持 `GET /v1/models`（返回 405）——模型列表需要在代码中硬编码
- 不支持 Responses API（`/v1/responses`）
- 不支持图像、音频生成端点

---

## 三、SDK 客户端初始化（正确写法）

```typescript
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// openai@^6.33.0
const openaiClient = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  // 即 "http://localhost:1106/modelfarm/openai"
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "_DUMMY_API_KEY_",
});

// @anthropic-ai/sdk@^0.82.0
const anthropicClient = new Anthropic({
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  // 即 "http://localhost:1106/modelfarm/anthropic"
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? "_DUMMY_API_KEY_",
});
```

**审核检查点：**
- [ ] OpenAI `baseURL` 不要手动加 `/v1`（SDK 自动处理）
- [ ] Anthropic `baseURL` 不要手动加 `/v1/messages`（SDK 自动处理）
- [ ] 两者的 `apiKey` 均设为 `_DUMMY_API_KEY_` 字面字符串

---

## 四、已验证的模型列表（19 个，均通过实测）

### OpenAI 模型（13 个，通过 `/v1/chat/completions`）

| Model ID | 实测返回的完整名称 | 说明 |
|---|---|---|
| `gpt-5.2` | `gpt-5.2-2025-12-11` | 最强通用模型 |
| `gpt-5.1` | `gpt-5.1-2025-11-13` | |
| `gpt-5` | `gpt-5-2025-08-07` | |
| `gpt-5-mini` | `gpt-5-mini-2025-08-07` | 高性价比 |
| `gpt-5-nano` | `gpt-5-nano-2025-08-07` | 最快最便宜 |
| `gpt-4.1` | `gpt-4.1-2025-04-14` | |
| `gpt-4.1-mini` | `gpt-4.1-mini-2025-04-14` | |
| `gpt-4.1-nano` | `gpt-4.1-nano-2025-04-14` | |
| `gpt-4o` | `gpt-4o-2024-11-20` | |
| `gpt-4o-mini` | `gpt-4o-mini-2024-07-18` | |
| `o4-mini` | `o4-mini-2025-04-16` | 思考模型 |
| `o3` | `o3-2025-04-16` | 最强思考模型 |
| `o3-mini` | `o3-mini-2025-01-31` | |

### Anthropic 模型（6 个，通过 `/v1/messages`）

| Model ID | 实测返回的完整名称 | 说明 |
|---|---|---|
| `claude-opus-4-6` | `claude-opus-4-6` | 最强 Claude |
| `claude-opus-4-5` | `claude-opus-4-5-20251101` | |
| `claude-opus-4-1` | `claude-opus-4-1-20250805` | |
| `claude-sonnet-4-6` | `claude-sonnet-4-6` | 均衡 |
| `claude-sonnet-4-5` | `claude-sonnet-4-5-20250929` | |
| `claude-haiku-4-5` | `claude-haiku-4-5-20251001` | 最快 |

**模型路由规则：** `model.startsWith("claude-")` → Anthropic；其余全部 → OpenAI

---

## 五、OpenAI 参数兼容性（关键 Bug 修复）

**问题：** `gpt-5.*`、`gpt-5-mini`、`gpt-5-nano`、`o4-mini`、`o3`、`o3-mini` 不接受 `max_tokens`，必须用 `max_completion_tokens`，否则报错：
```json
{
  "error": {
    "message": "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
    "type": "invalid_request_error",
    "param": "max_tokens",
    "code": "unsupported_parameter"
  }
}
```

**修复函数（必须在所有 OpenAI 请求前调用）：**

```typescript
const COMPLETION_TOKEN_MODELS = new Set([
  "gpt-5.2", "gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-5-nano",
  "o4-mini", "o3", "o3-mini",
]);

function fixOpenAITokenParam(
  model: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (COMPLETION_TOKEN_MODELS.has(model)) {
    const { max_tokens, ...rest } = params as any;
    if (max_tokens && !rest.max_completion_tokens) {
      return { ...rest, max_completion_tokens: max_tokens };
    }
    return rest; // 直接删除 max_tokens，不允许传
  }
  return params; // gpt-4.x, gpt-4o 系列保持原样
}
```

**审核检查点：**
- [ ] 在 `POST /v1/chat/completions` 的 OpenAI 路径，展开 `...rest` 前必须先调用 `fixOpenAITokenParam`
- [ ] 在 `POST /v1/messages` 的 OpenAI 模型路径，同样调用此函数
- [ ] Anthropic 路径不受影响，继续用 `max_tokens`（Anthropic 要求此字段且为必填）

---

## 六、Anthropic 常见失败原因及修复（核心审核项）

### 失败原因 1：baseURL 包含了 `/v1/messages`

```typescript
// ❌ 错误
const anthropicClient = new Anthropic({
  baseURL: "http://localhost:1106/modelfarm/anthropic/v1/messages",
});
// SDK 会发出 /v1/messages/v1/messages → 404

// ✅ 正确
const anthropicClient = new Anthropic({
  baseURL: "http://localhost:1106/modelfarm/anthropic",
  // SDK 自动追加 /v1/messages
});
```

### 失败原因 2：baseURL 包含了多余的 `/v1`

```typescript
// ❌ 错误
const anthropicClient = new Anthropic({
  baseURL: "http://localhost:1106/modelfarm/anthropic/v1",
});
// SDK 会发出 /modelfarm/anthropic/v1/v1/messages → 404

// ✅ 正确：直接用 AI_INTEGRATIONS_ANTHROPIC_BASE_URL 原值
```

### 失败原因 3：忘记 max_tokens 字段（Anthropic 必填）

```typescript
// ❌ 错误：没有 max_tokens，Anthropic 会报 validation_error
anthropicClient.messages.create({
  model: "claude-haiku-4-5",
  messages: [...],
  // max_tokens 缺失！
});

// ✅ 正确：永远提供 max_tokens，默认值 8192
anthropicClient.messages.create({
  model: "claude-haiku-4-5",
  messages: [...],
  max_tokens: max_tokens ?? 8192,
});
```

### 失败原因 4：OpenAI messages 格式未正确转换为 Anthropic 格式

Anthropic 与 OpenAI 的消息格式差异：

| 字段 | OpenAI | Anthropic |
|---|---|---|
| 系统提示 | `{role:"system", content:"..."}` 在 messages 数组里 | 顶层 `system: "..."` 字段，不在 messages 里 |
| 工具结果 | `{role:"tool", tool_call_id:"...", content:"..."}` | `{role:"user", content:[{type:"tool_result", tool_use_id:"...", content:"..."}]}` |
| 工具调用 | `{role:"assistant", tool_calls:[{id,type,function:{name,arguments}}]}` | `{role:"assistant", content:[{type:"tool_use", id, name, input:{}}]}` |
| 工具参数 | `arguments` 是 JSON 字符串 | `input` 是已解析的对象 |

**完整转换函数：**

```typescript
function openaiMessagesToAnthropic(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): { system?: string; messages: Anthropic.MessageParam[] } {
  let system: string | undefined;
  const converted: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // 系统消息提取为顶层 system 字段
      system = typeof msg.content === "string" ? msg.content : "";
      continue;
    }
    if (msg.role === "user") {
      converted.push({
        role: "user",
        content: typeof msg.content === "string"
          ? msg.content
          : (msg.content as Anthropic.ContentBlock[]),
      });
      continue;
    }
    if (msg.role === "assistant") {
      const blocks: Anthropic.ContentBlock[] = [];
      if (msg.content) {
        blocks.push({ type: "text", text: typeof msg.content === "string" ? msg.content : "" });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(tc.function.arguments); } catch {}
          blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
      }
      converted.push({ role: "assistant", content: blocks });
      continue;
    }
    if (msg.role === "tool") {
      // 工具结果封装为 user 消息的 tool_result block
      converted.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: msg.tool_call_id,
          content: typeof msg.content === "string" ? msg.content : "",
        }],
      });
    }
  }
  return { system, messages: converted };
}
```

### 失败原因 5：流式输出（Streaming）格式错误

OpenAI 流：每行格式为 `data: {...}\n\n`，事件类型内嵌在 JSON 的 `object` 字段

Anthropic 流：每个事件由两行组成：
```
event: <event_type>
data: <json>

```

**Anthropic SSE 事件序列（完整）：**
```
event: message_start
data: {"type":"message_start","message":{"id":"...","type":"message","role":"assistant","content":[],"model":"claude-haiku-4-5","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":14,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":4}}

event: message_stop
data: {"type":"message_stop"}
```

**Anthropic 流式输出（原生 claude-* 模型）的正确写法：**

```typescript
// ✅ 正确：使用 anthropicClient.messages.stream()
const s = anthropicClient.messages.stream(params);
for await (const event of s) {
  // event.type 就是 message_start / content_block_start / content_block_delta 等
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.flush?.();
}
```

**常见错误写法：**

```typescript
// ❌ 错误1：没有写 event: 行，只写 data: 行（Anthropic 客户端会解析失败）
for await (const event of s) {
  res.write(`data: ${JSON.stringify(event)}\n\n`); // 缺少 event: 行
}

// ❌ 错误2：用 createStream 而不是 stream()
const s = await anthropicClient.messages.create({ ...params, stream: true }); // 不推荐
// 应该用 anthropicClient.messages.stream()
```

### 失败原因 6：tool_choice 格式不同

```typescript
// OpenAI → Anthropic tool_choice 映射
function openaiToolChoiceToAnthropic(tc) {
  if (tc === "auto")     return { type: "auto" };
  if (tc === "none")     return undefined;          // Anthropic 没有 none，直接不传
  if (tc === "required") return { type: "any" };   // OpenAI "required" → Anthropic "any"
  if (typeof tc === "object" && tc.function) {
    return { type: "tool", name: tc.function.name };
  }
}
```

---

## 七、Express 路由结构

```
Express app
├── /api/*          → 内部 API（healthz 等）
└── /v1/*           → proxyRouter（需要 Bearer 鉴权）
    ├── GET  /models
    ├── POST /chat/completions
    └── POST /messages
```

**中间件配置（顺序重要）：**
```typescript
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use("/api", router);
app.use("/v1", proxyRouter);
```

**鉴权：**
```typescript
function verifyBearer(req, res): boolean {
  const auth = req.headers["authorization"] ?? "";
  const proxyKey = process.env.PROXY_API_KEY;
  if (!proxyKey || auth !== `Bearer ${proxyKey}`) {
    res.status(401).json({
      error: { message: "Unauthorized", type: "auth_error", code: "invalid_api_key" }
    });
    return false;
  }
  return true;
}
```

---

## 八、流式响应公共配置

```typescript
// SSE Headers（必须在第一个 write 前调用）
function sseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // 禁用 Nginx 缓冲
  res.flushHeaders();
}

// Keepalive（防止长时间无响应时连接被代理切断）
const ka = setInterval(() => {
  try { res.write(": keepalive\n\n"); res.flush?.(); } catch {}
}, 5000);
// 在 finally 块里 clearInterval(ka)
```

---

## 九、`POST /v1/chat/completions` 完整逻辑

```
接收请求 (OpenAI 格式)
│
├─ verifyBearer() → 401
│
├─ 解构 { model, messages, stream, tools, tool_choice, ...rest }
│
├─ rest = fixOpenAITokenParam(model, rest)  // max_tokens → max_completion_tokens
│
├─ isAnthropicModel(model)?
│   ├─ NO → OpenAI 路径
│   │   ├─ stream=true  → SSE，openaiClient.chat.completions.create(stream:true)
│   │   │               → 逐 chunk 透传: "data: {...}\n\n"
│   │   │               → 结束: "data: [DONE]\n\n"
│   │   └─ stream=false → openaiClient.chat.completions.create(stream:false)
│   │                   → res.json(r)
│   │
│   └─ YES → Anthropic 路径
│       ├─ openaiMessagesToAnthropic(messages) → { system, aMessages }
│       ├─ openaiToolsToAnthropic(tools) → aTools
│       ├─ maxTokens = rest.max_tokens ?? rest.max_completion_tokens ?? 8192
│       ├─ stream=true  → SSE，anthropicClient.messages.stream()
│       │               → 将 Anthropic 事件转为 OpenAI SSE chunk 格式输出
│       │               → content_block_start(tool_use) → tool_calls 开始
│       │               → content_block_delta(text_delta) → content chunk
│       │               → content_block_delta(input_json_delta) → tool arguments
│       │               → message_delta → finish_reason chunk
│       │               → 结束: "data: [DONE]\n\n"
│       └─ stream=false → .stream().finalMessage()
│                       → anthropicToOpenAI(final, model) → res.json()
```

---

## 十、`POST /v1/messages` 完整逻辑

```
接收请求 (Anthropic 原生格式)
│
├─ verifyBearer() → 401
│
├─ isAnthropicModel(model)?
│   ├─ YES → Anthropic 原生透传
│   │   ├─ stream=true  → SSE，anthropicClient.messages.stream()
│   │   │               → "event: {type}\ndata: {...}\n\n" (保持 Anthropic SSE 格式)
│   │   └─ stream=false → .stream().finalMessage() → res.json()
│   │
│   └─ NO → OpenAI 模型，Anthropic 格式输入 → OpenAI 执行 → Anthropic 格式输出
│       ├─ 转换 body.system → oaMessages[0] = {role:"system", content:sys}
│       ├─ 转换 body.messages → oaMessages (Anthropic→OpenAI 格式)
│       │   user content block → string 或 OpenAI content
│       │   tool_result block → {role:"tool", tool_call_id, content}
│       │   assistant tool_use → {role:"assistant", tool_calls:[...]}
│       ├─ 转换 body.tools → oaTools (input_schema → parameters)
│       ├─ 转换 body.tool_choice → oaToolChoice (any→required, tool→function)
│       ├─ fixedParams = fixOpenAITokenParam(model, {max_tokens})
│       ├─ stream=true  → 模拟 Anthropic SSE 格式
│       │   → 发 message_start, content_block_start
│       │   → 逐 OpenAI chunk → 转换为 content_block_delta / tool_use 块
│       │   → 发 content_block_stop, message_delta, message_stop
│       └─ stream=false → openaiClient.chat.completions.create()
│                       → 转换响应为 Anthropic.Message 格式 → res.json()
```

---

## 十一、Anthropic ↔ OpenAI 格式转换对照（响应）

### Anthropic Message → OpenAI ChatCompletion

```typescript
function anthropicToOpenAI(msg: Anthropic.Message, model: string) {
  const toolCalls = [];
  let text = "";
  for (const b of msg.content) {
    if (b.type === "text") text += b.text;
    if (b.type === "tool_use") {
      toolCalls.push({
        id: b.id, type: "function",
        function: { name: b.name, arguments: JSON.stringify(b.input) }
      });
    }
  }
  // stop_reason 映射
  const finishReason =
    msg.stop_reason === "tool_use"   ? "tool_calls" :
    msg.stop_reason === "max_tokens" ? "length"     : "stop";

  return {
    id: msg.id, object: "chat.completion",
    created: Math.floor(Date.now() / 1000), model,
    choices: [{
      index: 0, logprobs: null, finish_reason: finishReason,
      message: {
        role: "assistant",
        content: text || null,           // 有工具调用时 content 为 null
        tool_calls: toolCalls.length ? toolCalls : undefined,
        refusal: null,
      },
    }],
    usage: {
      prompt_tokens: msg.usage.input_tokens,
      completion_tokens: msg.usage.output_tokens,
      total_tokens: msg.usage.input_tokens + msg.usage.output_tokens,
    },
  };
}
```

### OpenAI ChatCompletion → Anthropic Message（`/v1/messages` 非流式反向转换）

```typescript
// stop_reason 映射（OpenAI → Anthropic）
finish_reason "tool_calls" → stop_reason "tool_use"
finish_reason "length"     → stop_reason "max_tokens"
finish_reason "stop"       → stop_reason "end_turn"

// 响应结构
{
  id: r.id,
  type: "message",
  role: "assistant",
  content: [
    { type: "text", text: choice.message.content },          // 有文本时
    { type: "tool_use", id, name, input: parsedJSON },       // 有工具调用时
  ],
  model: model,
  stop_reason: stopReason,
  stop_sequence: null,
  usage: {
    input_tokens: r.usage.prompt_tokens,
    output_tokens: r.usage.completion_tokens,
  },
}
```

---

## 十二、依赖版本（package.json dependencies）

```json
{
  "express": "^5",
  "openai": "^6.33.0",
  "@anthropic-ai/sdk": "^0.82.0",
  "cors": "^2",
  "pino": "^9",
  "pino-http": "^10"
}
```

---

## 十三、Artifact 路由配置（artifact.toml）

API Server 需要同时处理 `/api` 和 `/v1` 两个路径：

```toml
[[services]]
localPort = 8080
name = "API Server"
paths = ["/api", "/v1"]           # 两个路径都要暴露

[services.production]
[services.production.build]
args = ["pnpm", "--filter", "@workspace/api-server", "run", "build"]

[services.production.run]
args = ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]

[services.production.run.env]
PORT = "8080"
NODE_ENV = "production"

[services.production.health.startup]
path = "/api/healthz"
```

---

## 十四、审核检查清单

在生成或审核代码时，必须逐项确认：

**Anthropic 集成（最常见的失败点）：**
- [ ] `anthropicClient` 的 `baseURL` 是 `http://localhost:1106/modelfarm/anthropic`，不含 `/v1` 或 `/v1/messages`
- [ ] 所有 Anthropic 请求都包含 `max_tokens`（必填字段，无默认值）
- [ ] `system` 提示词是顶层字段，不在 `messages` 数组内
- [ ] `tool_result` 消息封装在 `role:"user"` 的 content block 里（不是 `role:"tool"`）
- [ ] 工具参数 `input` 是对象（不是 JSON 字符串）
- [ ] 流式响应每个事件输出两行：`event: <type>\ndata: <json>\n\n`
- [ ] `tool_choice: "none"` → Anthropic 不传 tool_choice（无 none 类型）
- [ ] `tool_choice: "required"` → Anthropic `{ type: "any" }`

**OpenAI 集成：**
- [ ] `openaiClient` 的 `baseURL` 是 `http://localhost:1106/modelfarm/openai`，不含 `/v1`
- [ ] gpt-5+ 和 o 系列模型调用前调用 `fixOpenAITokenParam`
- [ ] 流式结束必须发送 `data: [DONE]\n\n`

**通用：**
- [ ] 所有端点检查 `Authorization: Bearer {PROXY_API_KEY}` header
- [ ] SSE 响应设置 `X-Accel-Buffering: no`（防止 Nginx 缓冲导致流式卡顿）
- [ ] `artifact.toml` 的 `paths` 同时包含 `/api` 和 `/v1`
- [ ] 模型列表硬编码（上游不暴露 `/models` 端点）

---

## 十五、最小可运行验证（curl 测试）

```bash
# 1. 健康检查
curl https://YOUR_DOMAIN/api/healthz

# 2. 模型列表（应返回 19 个模型）
curl https://YOUR_DOMAIN/v1/models \
  -H "Authorization: Bearer YOUR_PROXY_API_KEY"

# 3. Anthropic 模型（OpenAI 格式入，OpenAI 格式出）
curl https://YOUR_DOMAIN/v1/chat/completions \
  -H "Authorization: Bearer YOUR_PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5","messages":[{"role":"user","content":"say hi"}],"max_tokens":20}'

# 4. OpenAI 模型（含 max_tokens 自动转换测试）
curl https://YOUR_DOMAIN/v1/chat/completions \
  -H "Authorization: Bearer YOUR_PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5-mini","messages":[{"role":"user","content":"say hi"}],"max_tokens":15}'

# 5. Anthropic 原生格式
curl https://YOUR_DOMAIN/v1/messages \
  -H "Authorization: Bearer YOUR_PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5","messages":[{"role":"user","content":"say hi"}],"max_tokens":20}'

# 6. 流式测试（Anthropic 模型，OpenAI 格式）
curl https://YOUR_DOMAIN/v1/chat/completions \
  -H "Authorization: Bearer YOUR_PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5","messages":[{"role":"user","content":"say hi"}],"stream":true,"max_tokens":30}'
```

---

*本文档基于 Replit AI 反向代理网关项目的实际运行结果提炼，所有 URL、模型名称、参数规则均经过实测验证（2026年4月）。*
