# Claude Code 调用适配上游文档

> 本文档从 `artifacts/api-server/src/routes/proxy.ts` 完整抽取 Claude Code 工具调用链路中涉及的所有协议翻译核心代码，覆盖流式与非流式、入站与出站全部场景。

---

## 目录

1. [整体架构](#1-整体架构)
2. [协议格式对照](#2-协议格式对照)
3. [上游服务商配置](#3-上游服务商配置)
4. [鉴权](#4-鉴权)
5. [SSE 流式基础设施](#5-sse-流式基础设施)
6. [模型路由](#6-模型路由)
7. [模型注册表与参数修正](#7-模型注册表与参数修正)
8. [翻译函数：OpenAI tools → Anthropic tools](#8-翻译函数openai-tools--anthropic-tools)
9. [翻译函数：OpenAI tool_choice → Anthropic tool_choice](#9-翻译函数openai-tool_choice--anthropic-tool_choice)
10. [翻译函数：OpenAI messages → Anthropic messages + system](#10-翻译函数openai-messages--anthropic-messages--system)
11. [翻译函数：Anthropic response → OpenAI response（非流式）](#11-翻译函数anthropic-response--openai-response非流式)
12. [端点 1：POST /v1/chat/completions（OpenAI 格式入站）](#12-端点-1post-v1chatcompletions)
13. [端点 2：POST /v1/messages（Anthropic 格式入站）](#13-端点-2post-v1messages)
14. [端点 3：GET /v1/models](#14-端点-3get-v1models)
15. [完整映射速查表](#15-完整映射速查表)

---

## 1. 整体架构

```
┌─────────────────────┐
│  Claude Code        │  Anthropic 原生协议
│  CherryStudio       │  POST /v1/messages
│  其他 Anthropic 客户端│
└────────┬────────────┘
         │ Authorization: Bearer PROXY_API_KEY
         ▼
┌─────────────────────────────────────────────────┐
│            代理服务器 (Express)                    │
│                                                   │
│  /v1/messages          → Anthropic 格式入站        │
│  /v1/chat/completions  → OpenAI 格式入站           │
│  /v1/models            → 模型列表                  │
│                                                   │
│  路由逻辑：model.startsWith("claude-")             │
│    ├── true  → anthropicClient (透传/翻译)         │
│    └── false → openaiClient   (透传/翻译)          │
└────────┬──────────────────────┬──────────────────┘
         │                      │
         ▼                      ▼
┌─────────────────┐   ┌─────────────────┐
│ Replit modelfarm │   │ Replit modelfarm │
│ localhost:1106   │   │ localhost:1106   │
│ /modelfarm/      │   │ /modelfarm/      │
│  anthropic       │   │  openai          │
└────────┬────────┘   └────────┬────────┘
         ▼                      ▼
┌──────────────┐       ┌──────────────┐
│ Anthropic API│       │  OpenAI API  │
└──────────────┘       └──────────────┘
```

---

## 2. 协议格式对照

### 工具定义

| 字段 | OpenAI 格式 | Anthropic 格式 |
|------|------------|---------------|
| 外层 | `{ type: "function", function: {...} }` | `{ name, description, input_schema }` |
| 名称 | `function.name` | `name` |
| 描述 | `function.description` | `description` |
| 参数 schema | `function.parameters` | `input_schema` |

### 工具调用（assistant 发起）

| 字段 | OpenAI 格式 | Anthropic 格式 |
|------|------------|---------------|
| 容器 | `message.tool_calls[]` | `content[] (type: "tool_use")` |
| 调用 ID | `tool_call.id` | `content_block.id` |
| 函数名 | `tool_call.function.name` | `content_block.name` |
| 参数 | `tool_call.function.arguments` (JSON string) | `content_block.input` (object) |

### 工具结果（user 返回）

| 字段 | OpenAI 格式 | Anthropic 格式 |
|------|------------|---------------|
| 角色 | `role: "tool"` | `role: "user"` |
| 关联 ID | `tool_call_id` | `content[].tool_use_id` |
| 内容 | `content` (string) | `content[].content` (string) |
| 类型标记 | 无（靠 role 区分） | `content[].type: "tool_result"` |

### 结束原因

| 场景 | OpenAI `finish_reason` | Anthropic `stop_reason` |
|------|----------------------|------------------------|
| 正常结束 | `"stop"` | `"end_turn"` |
| 需要调用工具 | `"tool_calls"` | `"tool_use"` |
| 达到 token 上限 | `"length"` | `"max_tokens"` |

### 流式 SSE 格式

| 特征 | OpenAI | Anthropic |
|------|--------|-----------|
| 事件标记 | 仅 `data:` | `event: <type>` + `data:` |
| 结束标记 | `data: [DONE]` | `event: message_stop` |
| 文本增量 | `delta.content` | `delta.type: "text_delta"` |
| 工具参数增量 | `delta.tool_calls[].function.arguments` | `delta.type: "input_json_delta"` |
| 内容块生命周期 | 无 | `content_block_start` / `content_block_delta` / `content_block_stop` |

---

## 3. 上游服务商配置

```typescript
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const openaiClient = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  // Replit modelfarm: http://localhost:1106/modelfarm/openai
  // SDK 自动拼接 /chat/completions，不要手动加 /v1
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "_DUMMY_API_KEY_",
});

const anthropicClient = new Anthropic({
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  // Replit modelfarm: http://localhost:1106/modelfarm/anthropic
  // SDK 自动拼接 /v1/messages，不要手动加 /v1 或 /v1/messages
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? "_DUMMY_API_KEY_",
});
```

环境变量清单：

| 变量 | 用途 | 示例值 |
|------|------|--------|
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI 上游地址 | `http://localhost:1106/modelfarm/openai` |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI 上游密钥 | `_DUMMY_API_KEY_`（modelfarm 不需要真 key） |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Anthropic 上游地址 | `http://localhost:1106/modelfarm/anthropic` |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Anthropic 上游密钥 | `_DUMMY_API_KEY_` |
| `PROXY_API_KEY` | 代理对外鉴权 Bearer Token | 用户自定义（建议 16 位以上） |

---

## 4. 鉴权

```typescript
function verifyBearer(req: Request, res: Response): boolean {
  const auth = req.headers["authorization"] ?? "";
  const proxyKey = process.env.PROXY_API_KEY;
  if (!proxyKey || auth !== `Bearer ${proxyKey}`) {
    res.status(401).json({
      error: {
        message: "Unauthorized: invalid or missing Bearer token",
        type: "auth_error",
        code: "invalid_api_key",
      },
    });
    return false;
  }
  return true;
}
```

---

## 5. SSE 流式基础设施

```typescript
function flush(res: Response) {
  if (typeof (res as any).flush === "function") (res as any).flush();
}

function sseHeaders(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // 防止 nginx/反代缓冲
  res.flushHeaders();
}

function keepaliveInterval(res: Response): ReturnType<typeof setInterval> {
  return setInterval(() => {
    try {
      res.write(": keepalive\n\n"); // SSE 注释行，客户端忽略，但保持连接活跃
      flush(res);
    } catch {}
  }, 5000);
}
```

---

## 6. 模型路由

```typescript
function isAnthropicModel(model: string): boolean {
  return model.startsWith("claude-");
}
```

所有端点使用同一个判断：模型名以 `claude-` 开头则走 Anthropic 客户端，否则走 OpenAI 客户端。

---

## 7. 模型注册表与参数修正

### 模型注册表

```typescript
export const OPENAI_MODELS = [
  { id: "gpt-5.2",      description: "Most capable general-purpose model" },
  { id: "gpt-5.1",      description: "Strong general-purpose model" },
  { id: "gpt-5",        description: "GPT-5 base" },
  { id: "gpt-5-mini",   description: "Cost-effective, high-volume tasks" },
  { id: "gpt-5-nano",   description: "Fastest and most affordable" },
  { id: "gpt-4.1",      description: "GPT-4.1 (legacy)" },
  { id: "gpt-4.1-mini", description: "GPT-4.1-mini (legacy)" },
  { id: "gpt-4.1-nano", description: "GPT-4.1-nano (legacy)" },
  { id: "gpt-4o",       description: "GPT-4o (legacy)" },
  { id: "gpt-4o-mini",  description: "GPT-4o-mini (legacy)" },
  { id: "o4-mini",      description: "Thinking model for complex reasoning" },
  { id: "o3",           description: "Most capable thinking model" },
  { id: "o3-mini",      description: "Efficient thinking model (legacy)" },
];

export const ANTHROPIC_MODELS = [
  { id: "claude-opus-4-6",   description: "Most capable Claude, complex reasoning" },
  { id: "claude-opus-4-5",   description: "Claude Opus 4.5" },
  { id: "claude-opus-4-1",   description: "Claude Opus 4.1 (legacy)" },
  { id: "claude-sonnet-4-6", description: "Balanced performance and speed" },
  { id: "claude-sonnet-4-5", description: "Claude Sonnet 4.5" },
  { id: "claude-haiku-4-5",  description: "Fastest Claude, simple tasks" },
];

const ALL_MODELS = [
  ...OPENAI_MODELS.map((m) => ({ ...m, provider: "openai" })),
  ...ANTHROPIC_MODELS.map((m) => ({ ...m, provider: "anthropic" })),
];
```

### max_tokens → max_completion_tokens 修正

GPT-5 系列和 o 系列模型要求使用 `max_completion_tokens` 而非 `max_tokens`：

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
    // 该模型不支持 max_tokens，直接丢弃
    return rest;
  }
  return params;
}
```

---

## 8. 翻译函数：OpenAI tools → Anthropic tools

```typescript
function openaiToolsToAnthropic(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    input_schema: (t.function.parameters as Anthropic.Tool["input_schema"]) ?? {
      type: "object",
      properties: {},
    },
  }));
}
```

**字段映射**：

```
OpenAI                              →  Anthropic
──────────────────────────────────────────────────
t.function.name                     →  name
t.function.description              →  description
t.function.parameters               →  input_schema
```

---

## 9. 翻译函数：OpenAI tool_choice → Anthropic tool_choice

```typescript
function openaiToolChoiceToAnthropic(
  tc: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined,
): Anthropic.MessageCreateParamsNonStreaming["tool_choice"] | undefined {
  if (!tc) return undefined;
  if (tc === "auto") return { type: "auto" };
  if (tc === "none") return undefined;
  if (tc === "required") return { type: "any" };
  if (typeof tc === "object" && tc.function) {
    return { type: "tool", name: tc.function.name };
  }
  return undefined;
}
```

**映射表**：

```
OpenAI                              →  Anthropic
──────────────────────────────────────────────────
"auto"                              →  { type: "auto" }
"none"                              →  undefined（不传）
"required"                          →  { type: "any" }
{ function: { name: "xxx" } }       →  { type: "tool", name: "xxx" }
```

---

## 10. 翻译函数：OpenAI messages → Anthropic messages + system

这是最复杂的翻译函数，需要处理 system、user、assistant（含 tool_calls）、tool 四种角色：

```typescript
function openaiMessagesToAnthropic(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): { system?: string; messages: Anthropic.MessageParam[] } {
  let system: string | undefined;
  const converted: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    // ── system 消息 → 提取为独立的 system 参数 ──
    if (msg.role === "system") {
      system = typeof msg.content === "string" ? msg.content : "";
      continue;
    }

    // ── user 消息 → 直接映射 ──
    if (msg.role === "user") {
      converted.push({
        role: "user",
        content: typeof msg.content === "string"
          ? msg.content
          : (msg.content as Anthropic.ContentBlock[]),
      });
      continue;
    }

    // ── assistant 消息 → text + tool_use blocks ──
    if (msg.role === "assistant") {
      const blocks: Anthropic.ContentBlock[] = [];

      // 文本内容 → text block
      if (msg.content) {
        blocks.push({
          type: "text",
          text: typeof msg.content === "string" ? msg.content : "",
        });
      }

      // tool_calls → tool_use blocks
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {}
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }

      converted.push({ role: "assistant", content: blocks });
      continue;
    }

    // ── tool 消息 → user 消息 + tool_result block ──
    if (msg.role === "tool") {
      converted.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.tool_call_id,
            content: typeof msg.content === "string" ? msg.content : "",
          },
        ],
      });
    }
  }

  return { system, messages: converted };
}
```

**字段映射**：

```
OpenAI message                        →  Anthropic message
───────────────────────────────────────────────────────────
role: "system"                        →  提取为顶层 system 参数
role: "user"                          →  role: "user"
role: "assistant" + content           →  role: "assistant" + [{type:"text", text}]
role: "assistant" + tool_calls        →  role: "assistant" + [{type:"tool_use", id, name, input}]
  tool_call.id                        →  tool_use.id
  tool_call.function.name             →  tool_use.name
  JSON.parse(tool_call.function.arguments)  →  tool_use.input (object)
role: "tool"                          →  role: "user" + [{type:"tool_result", tool_use_id, content}]
  tool_call_id                        →  tool_use_id
  content                             →  content
```

---

## 11. 翻译函数：Anthropic response → OpenAI response（非流式）

```typescript
function anthropicToOpenAI(
  msg: Anthropic.Message,
  model: string,
): OpenAI.Chat.Completions.ChatCompletion {
  const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
  let text = "";

  for (const b of msg.content) {
    if (b.type === "text") text += b.text;
    if (b.type === "tool_use") {
      toolCalls.push({
        id: b.id,
        type: "function",
        function: {
          name: b.name,
          arguments: JSON.stringify(b.input),
        },
      });
    }
  }

  const finishReason: OpenAI.Chat.Completions.ChatCompletion.Choice["finish_reason"] =
    msg.stop_reason === "tool_use"
      ? "tool_calls"
      : msg.stop_reason === "max_tokens"
        ? "length"
        : "stop";

  return {
    id: msg.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        logprobs: null,
        finish_reason: finishReason,
        message: {
          role: "assistant",
          content: text || null,
          tool_calls: toolCalls.length ? toolCalls : undefined,
          refusal: null,
        },
      },
    ],
    usage: {
      prompt_tokens: msg.usage.input_tokens,
      completion_tokens: msg.usage.output_tokens,
      total_tokens: msg.usage.input_tokens + msg.usage.output_tokens,
    },
  };
}
```

**字段映射**：

```
Anthropic Message                     →  OpenAI ChatCompletion
───────────────────────────────────────────────────────────────
msg.id                                →  id
msg.content[type:"text"].text         →  choices[0].message.content
msg.content[type:"tool_use"]          →  choices[0].message.tool_calls[]
  .id                                 →  tool_call.id
  .name                               →  tool_call.function.name
  JSON.stringify(.input)              →  tool_call.function.arguments
msg.stop_reason: "tool_use"           →  finish_reason: "tool_calls"
msg.stop_reason: "max_tokens"         →  finish_reason: "length"
msg.stop_reason: "end_turn"           →  finish_reason: "stop"
msg.usage.input_tokens                →  usage.prompt_tokens
msg.usage.output_tokens               →  usage.completion_tokens
```

---

## 12. 端点 1：POST /v1/chat/completions

客户端发送 **OpenAI 格式**请求。

### 12.1 请求体解构

```typescript
router.post("/chat/completions", async (req: Request, res: Response) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as OpenAI.Chat.Completions.ChatCompletionCreateParams;
  const { model, messages, stream, tools, tool_choice, ...rawRest } = body;
  const rest = fixOpenAITokenParam(model, rawRest as Record<string, unknown>);
```

### 12.2 GPT 模型 → OpenAI 直接透传

#### 非流式

```typescript
  if (!isAnthropicModel(model)) {
    if (!stream) {
      const r = await openaiClient.chat.completions.create({
        model,
        messages,
        stream: false,
        ...(tools ? { tools } : {}),
        ...(tool_choice ? { tool_choice } : {}),
        ...rest,
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
      res.json(r);
      return;
    }
```

#### 流式

```typescript
    // stream === true
    sseHeaders(res);
    const ka = keepaliveInterval(res);
    try {
      const s = await openaiClient.chat.completions.create({
        model,
        messages,
        stream: true,
        ...(tools ? { tools } : {}),
        ...(tool_choice ? { tool_choice } : {}),
        ...rest,
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);
      for await (const chunk of s) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        flush(res);
      }
      res.write("data: [DONE]\n\n");
    } finally {
      clearInterval(ka);
      res.end();
    }
    return;
  }
```

### 12.3 Claude 模型 → 翻译后转发 Anthropic

先做入站翻译：

```typescript
  // ── Anthropic 路径 ──
  const { system, messages: aMessages } = openaiMessagesToAnthropic(messages);
  const aTools = tools ? openaiToolsToAnthropic(tools) : undefined;
  const aToolChoice = openaiToolChoiceToAnthropic(tool_choice);
  const maxTokens =
    (rest as any).max_tokens ?? (rest as any).max_completion_tokens ?? 8192;

  const baseParams: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    messages: aMessages,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    ...(aTools ? { tools: aTools } : {}),
    ...(aToolChoice ? { tool_choice: aToolChoice } : {}),
  };
```

#### 非流式

```typescript
  if (!stream) {
    const final = await anthropicClient.messages
      .stream(baseParams as Anthropic.MessageStreamParams)
      .finalMessage();
    res.json(anthropicToOpenAI(final, model));
    return;
  }
```

#### 流式（Anthropic 事件 → OpenAI chunk 翻译）

```typescript
  // stream === true
  sseHeaders(res);
  const ka = keepaliveInterval(res);
  try {
    const msgId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    let toolCallIdx = 0;

    // 发送初始 role chunk
    res.write(
      `data: ${JSON.stringify({
        id: msgId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "" },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );
    flush(res);

    const s = anthropicClient.messages.stream(
      baseParams as Anthropic.MessageStreamParams,
    );

    for await (const event of s) {
      // ── tool_use 块开始 → OpenAI tool_calls 首包 ──
      if (
        event.type === "content_block_start" &&
        event.content_block.type === "tool_use"
      ) {
        res.write(
          `data: ${JSON.stringify({
            id: msgId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: toolCallIdx++,
                      id: event.content_block.id,
                      type: "function",
                      function: {
                        name: event.content_block.name,
                        arguments: "",
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          })}\n\n`,
        );
        flush(res);
      }
      // ── 内容增量 ──
      else if (event.type === "content_block_delta") {
        // 文本增量
        if (event.delta.type === "text_delta") {
          res.write(
            `data: ${JSON.stringify({
              id: msgId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: { content: event.delta.text },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
          );
          flush(res);
        }
        // 工具参数 JSON 增量
        else if (event.delta.type === "input_json_delta") {
          res.write(
            `data: ${JSON.stringify({
              id: msgId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: event.index,
                        function: { arguments: event.delta.partial_json },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            })}\n\n`,
          );
          flush(res);
        }
      }
      // ── 消息结束 ──
      else if (event.type === "message_delta") {
        const fr =
          event.delta.stop_reason === "tool_use"
            ? "tool_calls"
            : event.delta.stop_reason === "max_tokens"
              ? "length"
              : "stop";
        res.write(
          `data: ${JSON.stringify({
            id: msgId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: fr }],
          })}\n\n`,
        );
        flush(res);
      }
    }
    res.write("data: [DONE]\n\n");
  } finally {
    clearInterval(ka);
    res.end();
  }
});
```

**流式事件映射**：

```
Anthropic 事件                         →  OpenAI chunk
──────────────────────────────────────────────────────────
content_block_start (type: tool_use)  →  delta.tool_calls[{index, id, type:"function", function:{name, arguments:""}}]
content_block_delta (text_delta)      →  delta.content: text
content_block_delta (input_json_delta)→  delta.tool_calls[{index, function:{arguments: partial_json}}]
message_delta (stop_reason)           →  finish_reason: "tool_calls"|"length"|"stop"
```

---

## 13. 端点 2：POST /v1/messages

客户端发送 **Anthropic 格式**请求。这是 **Claude Code 的主要调用端点**。

### 13.1 Claude 模型 → Anthropic 直接透传

#### 非流式

```typescript
router.post("/messages", async (req: Request, res: Response) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as Anthropic.MessageCreateParamsNonStreaming & {
    stream?: boolean;
  };
  const { model, stream } = body;

  if (isAnthropicModel(model)) {
    if (!stream) {
      const final = await anthropicClient.messages
        .stream(body as Anthropic.MessageStreamParams)
        .finalMessage();
      res.json(final);
      return;
    }
```

#### 流式

```typescript
    // stream === true, Claude 模型 → 直接透传 Anthropic SSE
    sseHeaders(res);
    const ka = keepaliveInterval(res);
    try {
      const s = anthropicClient.messages.stream(
        body as Anthropic.MessageStreamParams,
      );
      for await (const event of s) {
        res.write(
          `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
        flush(res);
      }
    } finally {
      clearInterval(ka);
      res.end();
    }
    return;
  }
```

### 13.2 GPT 模型 → 翻译后转发 OpenAI

这是最复杂的路径：客户端发 Anthropic 格式，但要调用 OpenAI 模型，再把 OpenAI 的响应翻译回 Anthropic 格式。

#### 入站翻译：Anthropic messages → OpenAI messages

```typescript
  // ── OpenAI 模型，需要翻译 ──
  const oaMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  // system 参数 → system 角色消息
  if (body.system) {
    const sys =
      typeof body.system === "string"
        ? body.system
        : (body.system as Anthropic.TextBlockParam[])
            .map((b) => b.text)
            .join("");
    oaMessages.push({ role: "system", content: sys });
  }

  for (const msg of body.messages) {
    // ── user 消息 ──
    if (msg.role === "user") {
      if (typeof msg.content !== "string") {
        // 检查是否包含 tool_result（工具返回结果）
        const toolResults = (
          msg.content as Anthropic.ContentBlockParam[]
        ).filter((b) => b.type === "tool_result") as Anthropic.ToolResultBlockParam[];

        if (toolResults.length > 0) {
          // tool_result → OpenAI tool 角色消息
          for (const tr of toolResults) {
            oaMessages.push({
              role: "tool",
              tool_call_id: tr.tool_use_id,
              content: typeof tr.content === "string" ? tr.content : "",
            });
          }
          continue;
        }

        // 普通多模态 content blocks → 提取文本
        const text = (msg.content as Anthropic.ContentBlockParam[])
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("");
        oaMessages.push({ role: "user", content: text });
      } else {
        oaMessages.push({ role: "user", content: msg.content });
      }
    }

    // ── assistant 消息 ──
    else if (msg.role === "assistant") {
      const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] =
        [];
      let text = "";

      if (typeof msg.content === "string") {
        text = msg.content;
      } else {
        for (const b of msg.content as Anthropic.ContentBlockParam[]) {
          if (b.type === "text") text += b.text;
          if (b.type === "tool_use") {
            const tb = b as Anthropic.ToolUseBlockParam;
            toolCalls.push({
              id: tb.id,
              type: "function",
              function: {
                name: tb.name,
                arguments: JSON.stringify(tb.input),
              },
            });
          }
        }
      }

      oaMessages.push({
        role: "assistant",
        content: text || null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
    }
  }
```

#### 入站翻译：Anthropic tools → OpenAI tools

```typescript
  const oaTools = body.tools?.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
```

#### 入站翻译：Anthropic tool_choice → OpenAI tool_choice

```typescript
  let oaToolChoice:
    | OpenAI.Chat.Completions.ChatCompletionToolChoiceOption
    | undefined;
  if (body.tool_choice) {
    const tc = body.tool_choice;
    if (tc.type === "auto") oaToolChoice = "auto";
    else if (tc.type === "any") oaToolChoice = "required";
    else if (tc.type === "tool")
      oaToolChoice = {
        type: "function",
        function: { name: (tc as Anthropic.ToolChoiceToolParam).name },
      };
  }
```

**映射表（反向）**：

```
Anthropic                             →  OpenAI
──────────────────────────────────────────────────
{ type: "auto" }                      →  "auto"
{ type: "any" }                       →  "required"
{ type: "tool", name: "xxx" }         →  { type:"function", function:{name:"xxx"} }
```

#### max_tokens 处理

```typescript
  const maxTokens = body.max_tokens ?? 8192;
  const fixedParams = fixOpenAITokenParam(model, { max_tokens: maxTokens });
```

#### 非流式：调用 OpenAI → 响应翻译回 Anthropic 格式

```typescript
  if (!stream) {
    const r = await openaiClient.chat.completions.create({
      model,
      messages: oaMessages,
      stream: false,
      ...(oaTools ? { tools: oaTools } : {}),
      ...(oaToolChoice ? { tool_choice: oaToolChoice } : {}),
      ...fixedParams,
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

    const choice = r.choices[0];
    const blocks: Anthropic.ContentBlock[] = [];

    // text → text block
    if (choice.message.content) {
      blocks.push({ type: "text", text: choice.message.content });
    }

    // tool_calls → tool_use blocks
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {}
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }

    // finish_reason → stop_reason
    const stopReason: Anthropic.Message["stop_reason"] =
      choice.finish_reason === "tool_calls"
        ? "tool_use"
        : choice.finish_reason === "length"
          ? "max_tokens"
          : "end_turn";

    res.json({
      id: r.id,
      type: "message",
      role: "assistant",
      content: blocks,
      model,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: r.usage?.prompt_tokens ?? 0,
        output_tokens: r.usage?.completion_tokens ?? 0,
      },
    } as Anthropic.Message);
    return;
  }
```

#### 流式：OpenAI chunk → Anthropic SSE 事件翻译

这是整个代理中最复杂的翻译逻辑：

```typescript
  // stream === true
  sseHeaders(res);
  const ka = keepaliveInterval(res);
  try {
    const msgId = `msg_${Date.now()}`;
    const estInput = Math.ceil(JSON.stringify(oaMessages).length / 4);

    // ── 发送 Anthropic 协议的初始事件 ──
    // 1. message_start：包含消息元数据和初始 usage
    res.write(
      `event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: {
          id: msgId,
          type: "message",
          role: "assistant",
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: estInput, output_tokens: 0 },
        },
      })}\n\n`,
    );

    // 2. content_block_start：预开一个 text block (index 0)
    res.write(
      `event: content_block_start\ndata: ${JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      })}\n\n`,
    );
    flush(res);

    // ── 调用 OpenAI 流式 API ──
    const s = await openaiClient.chat.completions.create({
      model,
      messages: oaMessages,
      stream: true,
      ...(oaTools ? { tools: oaTools } : {}),
      ...(oaToolChoice ? { tool_choice: oaToolChoice } : {}),
      ...fixedParams,
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);

    let outTokens = 0;
    let textBlockClosed = false;
    const toolBlocks: Record<
      number,
      { id: string; name: string; blockIndex: number }
    > = {};
    let nextBlockIdx = 1; // index 0 已分配给 text block

    for await (const chunk of s) {
      const d = chunk.choices[0]?.delta;
      if (!d) continue;

      // ── 文本增量 → Anthropic text_delta ──
      if (d.content) {
        outTokens += Math.ceil(d.content.length / 4);
        res.write(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: d.content },
          })}\n\n`,
        );
        flush(res);
      }

      // ── 工具调用增量 ──
      if (d.tool_calls) {
        for (const tc of d.tool_calls) {
          const ti = tc.index ?? 0;

          // 首次出现该工具 → 关闭 text block + 开新 tool_use block
          if (!toolBlocks[ti]) {
            if (!textBlockClosed) {
              res.write(
                `event: content_block_stop\ndata: ${JSON.stringify({
                  type: "content_block_stop",
                  index: 0,
                })}\n\n`,
              );
              textBlockClosed = true;
            }
            const bi = nextBlockIdx++;
            toolBlocks[ti] = {
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
              blockIndex: bi,
            };
            res.write(
              `event: content_block_start\ndata: ${JSON.stringify({
                type: "content_block_start",
                index: bi,
                content_block: {
                  type: "tool_use",
                  id: tc.id ?? "",
                  name: tc.function?.name ?? "",
                  input: {},
                },
              })}\n\n`,
            );
            flush(res);
          }

          // 工具参数增量 → input_json_delta
          if (tc.function?.arguments) {
            res.write(
              `event: content_block_delta\ndata: ${JSON.stringify({
                type: "content_block_delta",
                index: toolBlocks[ti].blockIndex,
                delta: {
                  type: "input_json_delta",
                  partial_json: tc.function.arguments,
                },
              })}\n\n`,
            );
            flush(res);
          }
        }
      }

      // ── 流结束 ──
      if (chunk.choices[0]?.finish_reason) {
        const stopReason =
          chunk.choices[0].finish_reason === "tool_calls"
            ? "tool_use"
            : chunk.choices[0].finish_reason === "length"
              ? "max_tokens"
              : "end_turn";

        // 关闭所有 tool blocks
        for (const tb of Object.values(toolBlocks)) {
          res.write(
            `event: content_block_stop\ndata: ${JSON.stringify({
              type: "content_block_stop",
              index: tb.blockIndex,
            })}\n\n`,
          );
        }

        // 如果没有 tool blocks，关闭 text block
        if (!textBlockClosed && Object.keys(toolBlocks).length === 0) {
          res.write(
            `event: content_block_stop\ndata: ${JSON.stringify({
              type: "content_block_stop",
              index: 0,
            })}\n\n`,
          );
        }

        // message_delta：传递 stop_reason 和最终 usage
        res.write(
          `event: message_delta\ndata: ${JSON.stringify({
            type: "message_delta",
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { output_tokens: outTokens },
          })}\n\n`,
        );

        // message_stop：流结束标记
        res.write(
          `event: message_stop\ndata: ${JSON.stringify({
            type: "message_stop",
          })}\n\n`,
        );
        flush(res);
      }
    }
  } finally {
    clearInterval(ka);
    res.end();
  }
});
```

**流式事件映射（OpenAI → Anthropic）**：

```
OpenAI chunk                           →  Anthropic 事件
──────────────────────────────────────────────────────────────
(初始化)                               →  event: message_start
                                          event: content_block_start (text, index:0)
delta.content                          →  event: content_block_delta (text_delta, index:0)
delta.tool_calls[{id,name}] 首次       →  event: content_block_stop (index:0)   [关闭 text]
                                          event: content_block_start (tool_use, index:N)
delta.tool_calls[{arguments}] 后续     →  event: content_block_delta (input_json_delta, index:N)
finish_reason: "tool_calls"            →  event: content_block_stop (index:N)   [关闭 tool]
                                          event: message_delta (stop_reason:"tool_use")
                                          event: message_stop
finish_reason: "stop"                  →  event: content_block_stop (index:0)
                                          event: message_delta (stop_reason:"end_turn")
                                          event: message_stop
```

**content_block 生命周期管理**（这是 Anthropic 流的核心概念，OpenAI 没有）：

```
                ┌─ content_block_start (index:0, type:"text")
                │   ├─ content_block_delta (index:0, text_delta) ×N
                │   └─ content_block_stop (index:0)
message_start ──┤
                │   ┌─ content_block_start (index:1, type:"tool_use")
                │   │   ├─ content_block_delta (index:1, input_json_delta) ×N
                │   │   └─ content_block_stop (index:1)
                └───┤
                    ├─ content_block_start (index:2, type:"tool_use")  [可并行多个工具]
                    │   ├─ content_block_delta (index:2, input_json_delta) ×N
                    │   └─ content_block_stop (index:2)
                    └─ ...
message_delta ──── (stop_reason, usage)
message_stop ───── (流结束)
```

---

## 14. 端点 3：GET /v1/models

```typescript
router.get("/models", (req: Request, res: Response) => {
  if (!verifyBearer(req, res)) return;
  const now = Math.floor(Date.now() / 1000);
  res.json({
    object: "list",
    data: ALL_MODELS.map((m) => ({
      id: m.id,
      object: "model",
      created: now,
      owned_by: m.provider,
      description: m.description,
    })),
  });
});
```

---

## 15. 完整映射速查表

### 请求方向：客户端 → 代理 → 上游

| 场景 | 入站格式 | 上游模型 | 需要翻译？ | 出站格式 |
|------|---------|---------|-----------|---------|
| `/v1/chat/completions` + GPT | OpenAI | OpenAI | 否 | OpenAI 透传 |
| `/v1/chat/completions` + Claude | OpenAI | Anthropic | **是** | Anthropic |
| `/v1/messages` + Claude | Anthropic | Anthropic | 否 | Anthropic 透传 |
| `/v1/messages` + GPT | Anthropic | OpenAI | **是** | OpenAI |

### 响应方向：上游 → 代理 → 客户端

| 场景 | 上游响应格式 | 客户端期望 | 需要翻译？ |
|------|------------|-----------|-----------|
| `/v1/chat/completions` + GPT | OpenAI | OpenAI | 否 |
| `/v1/chat/completions` + Claude | Anthropic | OpenAI | **是** |
| `/v1/messages` + Claude | Anthropic | Anthropic | 否 |
| `/v1/messages` + GPT | OpenAI | Anthropic | **是** |

### Claude Code 专用链路

```
Claude Code
  │  POST /v1/messages (Anthropic 格式)
  │  包含: model, messages, tools, tool_choice, max_tokens, stream
  ▼
代理 /v1/messages 端点
  │
  ├── model="claude-*" → 直接透传给 anthropicClient → 响应原样返回
  │
  └── model="gpt-*"   → 翻译为 OpenAI 格式:
        │  system 参数 → role:"system" 消息
        │  tool_result blocks → role:"tool" 消息
        │  tool_use blocks → tool_calls 数组
        │  tools[] → functions[] 包装
        │  tool_choice → "auto"/"required"/指定函数
        ▼
      openaiClient.chat.completions.create()
        │
        ▼
      响应翻译回 Anthropic 格式:
        text → content[{type:"text"}]
        tool_calls → content[{type:"tool_use"}]
        finish_reason → stop_reason
        usage 字段名映射
```
