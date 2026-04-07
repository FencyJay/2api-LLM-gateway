# SSE 流式协议翻译深度解析

> 本文档从 `artifacts/api-server/src/routes/proxy.ts` 提取流式处理的全部核心原理、技术实现、状态机逻辑和参数转换细节。

---

## 目录

1. [SSE 协议基础](#1-sse-协议基础)
2. [两种 SSE 方言对比](#2-两种-sse-方言对比)
3. [流式基础设施层](#3-流式基础设施层)
4. [四种流式场景总览](#4-四种流式场景总览)
5. [场景 A：OpenAI 透传流](#5-场景-aopenai-透传流)
6. [场景 B：Anthropic 透传流](#6-场景-banthropic-透传流)
7. [场景 C：Anthropic 流 → OpenAI 格式输出](#7-场景-canthropic-流--openai-格式输出)
8. [场景 D：OpenAI 流 → Anthropic 格式输出（最复杂）](#8-场景-dopenai-流--anthropic-格式输出)
9. [content_block 状态机详解](#9-content_block-状态机详解)
10. [token 计数的流式估算](#10-token-计数的流式估算)
11. [连接可靠性保障](#11-连接可靠性保障)
12. [缓冲区控制与背压](#12-缓冲区控制与背压)
13. [错误处理与资源清理](#13-错误处理与资源清理)
14. [完整的一次工具调用流式交互时序](#14-完整的一次工具调用流式交互时序)

---

## 1. SSE 协议基础

Server-Sent Events (SSE) 是基于 HTTP 的单向流式推送协议。服务器通过保持 HTTP 连接不关闭，持续向客户端写入文本帧。

### 帧格式

```
[field]: [value]\n
\n
```

每个帧由一个或多个 `field: value` 行组成，以一个空行 `\n` 结尾表示帧边界。

### 三种帧类型

```
# 1. 数据帧 — 客户端触发 onmessage
data: {"text": "hello"}

# 2. 命名事件帧 — 客户端通过 addEventListener(eventName) 监听
event: content_block_delta
data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hi"}}

# 3. 注释帧 — 客户端忽略，仅用于保持连接活跃
: keepalive

```

关键区别：**OpenAI 只用数据帧**（`data:`），**Anthropic 用命名事件帧**（`event:` + `data:`）。这是两种流式方言的根本差异。

---

## 2. 两种 SSE 方言对比

### OpenAI 流式格式

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

特征：
- 每帧只有 `data:` 行，没有 `event:` 行
- 所有信息打平在 `choices[0].delta` 中
- 以 `data: [DONE]` 字面文本（不是 JSON）结束
- **无内容块生命周期概念**，文本和工具调用增量扁平排列
- `finish_reason` 从 `null` 变为具体值即表示结束

### Anthropic 流式格式

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_xxx","role":"assistant","content":[],"model":"claude-3","usage":{"input_tokens":100,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}

event: message_stop
data: {"type":"message_stop"}
```

特征：
- 每帧必有 `event:` 行指定事件类型，`data:` 行携带 JSON payload
- **有严格的内容块生命周期**：每个内容块（文本或工具调用）都要经历 `start → delta × N → stop`
- 内容块通过 `index` 字段区分，0 是第一个块，1、2、… 是后续块
- 消息级别有独立的开始（`message_start`）和结束（`message_delta` + `message_stop`）事件
- `usage` 分两次传递：`message_start` 带 `input_tokens`，`message_delta` 带 `output_tokens`

### 核心差异一览

```
维度              OpenAI                      Anthropic
─────────────────────────────────────────────────────────────
帧格式            data: 单行                   event: + data: 双行
内容块管理        无（扁平 delta）              有（start/delta/stop 三阶段）
文本增量          delta.content                delta.type: "text_delta"
工具名称          delta.tool_calls[i].function.name   content_block.name（在 start 中）
工具参数增量      delta.tool_calls[i].function.arguments  delta.type: "input_json_delta"
工具索引          tool_calls[i].index          content_block_start 的 index
结束标记          data: [DONE]                 event: message_stop
结束原因          finish_reason 字段            stop_reason 字段
用量统计          不在流中（或在最后一个 chunk）  message_start + message_delta 分两次
```

---

## 3. 流式基础设施层

### 3.1 SSE 响应头设置

```typescript
function sseHeaders(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");   // 告知客户端这是 SSE 流
  res.setHeader("Cache-Control", "no-cache");            // 禁止缓存
  res.setHeader("Connection", "keep-alive");             // 保持长连接
  res.setHeader("X-Accel-Buffering", "no");              // 禁止 nginx 反代缓冲
  res.flushHeaders();                                    // 立即发送响应头，不等 body
}
```

**为什么需要 `res.flushHeaders()`？**

在正常 HTTP 中，Node.js/Express 可能会等待第一个 `res.write()` 才把响应头发出去。对 SSE 来说，客户端需要先收到 `200 + text/event-stream` 头才能建立事件源连接。`flushHeaders()` 确保响应头立即发送，客户端可以马上开始监听事件。

**为什么需要 `X-Accel-Buffering: no`？**

nginx 等反向代理默认开启 proxy_buffering，会攒够一定数据量才转发给客户端，这会导致 SSE 事件延迟到达。此头部指令让 nginx 关闭对该响应的缓冲，逐帧透传。

### 3.2 缓冲区刷新

```typescript
function flush(res: Response) {
  if (typeof (res as any).flush === "function") (res as any).flush();
}
```

**原理**：Node.js 的 `res.write()` 不保证数据立即发送到 TCP 层。当使用 compression 中间件（gzip）时，数据会在压缩缓冲区中积攒。`flush()` 强制将缓冲区中的数据推送到客户端。

**为什么用 `typeof` 检查？** `flush` 不是标准的 Node.js API，它由 compression 中间件注入。如果没启用压缩，该方法不存在，直接调用会报错。

### 3.3 心跳保活

```typescript
function keepaliveInterval(res: Response): ReturnType<typeof setInterval> {
  return setInterval(() => {
    try {
      res.write(": keepalive\n\n");  // SSE 注释帧
      flush(res);
    } catch {}
  }, 5000);
}
```

**为什么需要心跳？**

1. **代理超时**：nginx、Cloudflare、AWS ALB 等反代/负载均衡器默认 60-120 秒无数据就断连。LLM 模型在 thinking 阶段可能几十秒不产出 token
2. **TCP 保活**：操作系统的 TCP keep-alive 间隔通常是 2 小时，远大于反代超时
3. **客户端检测**：部分 SSE 客户端会在长时间无数据时主动断连重试

**为什么用 SSE 注释帧（`: keepalive`）？**

以 `:` 开头的行是 SSE 规范定义的注释，客户端的 `EventSource` API 会静默忽略它。这样心跳不会触发 `onmessage` 回调，不会干扰业务逻辑。

**为什么 try-catch？** 如果客户端已经断开，`res.write()` 会抛异常。心跳是后台 interval，不能让异常打断整个进程。

**5 秒间隔的选择**：小于最常见的反代超时（60s），留出足够余量；大于 LLM 正常的 token 间隔（~50-200ms），避免不必要的带宽开销。

---

## 4. 四种流式场景总览

```
                        上游模型
                   GPT          Claude
               ┌──────────┬──────────────┐
客户端    OpenAI │  A: 透传   │  C: 翻译      │
格式            │ (最简单)  │ Anthropic→OA │
               ├──────────┼──────────────┤
       Anthropic│  D: 翻译   │  B: 透传      │
               │ OA→Anthropic│ (最简单)     │
               │ (最复杂)  │              │
               └──────────┴──────────────┘
```

| 场景 | 端点 | 客户端格式 | 上游模型 | 复杂度 | 翻译方向 |
|------|------|-----------|---------|--------|---------|
| A | `/v1/chat/completions` | OpenAI | GPT | 低 | 无（透传） |
| B | `/v1/messages` | Anthropic | Claude | 低 | 无（透传） |
| C | `/v1/chat/completions` | OpenAI | Claude | 中 | Anthropic 事件 → OpenAI chunk |
| D | `/v1/messages` | Anthropic | GPT | **高** | OpenAI chunk → Anthropic 事件 |

---

## 5. 场景 A：OpenAI 透传流

```typescript
// 端点: POST /v1/chat/completions，模型: gpt-*
sseHeaders(res);
const ka = keepaliveInterval(res);
try {
  const s = await openaiClient.chat.completions.create({
    model, messages, stream: true,
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
```

**零翻译**：上游返回 OpenAI chunk，直接 `JSON.stringify` 写入。客户端期望的也是 OpenAI 格式。唯一的工作是套上 `data:` 前缀和双换行。

---

## 6. 场景 B：Anthropic 透传流

```typescript
// 端点: POST /v1/messages，模型: claude-*
sseHeaders(res);
const ka = keepaliveInterval(res);
try {
  const s = anthropicClient.messages.stream(body as Anthropic.MessageStreamParams);
  for await (const event of s) {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    flush(res);
  }
} finally {
  clearInterval(ka);
  res.end();
}
```

**零翻译**：上游返回 Anthropic 事件对象，`event.type` 作为 SSE 事件名，`event` 本身序列化为 data。Anthropic SDK 的 stream 迭代器已经将原始 SSE 解析为结构化对象，这里重新编码回 SSE 帧。

**与场景 A 的区别**：这里需要写两行（`event:` + `data:`），而 OpenAI 只写一行（`data:`）。

---

## 7. 场景 C：Anthropic 流 → OpenAI 格式输出

客户端通过 `/v1/chat/completions` 调用 Claude 模型。上游返回 Anthropic 事件，需要翻译成 OpenAI chunk 格式。

### 完整代码

```typescript
sseHeaders(res);
const ka = keepaliveInterval(res);
try {
  const msgId = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  let toolCallIdx = 0;

  // ── 初始帧：发送 role ──
  // OpenAI 流的惯例：第一个 chunk 携带 role:"assistant"
  res.write(`data: ${JSON.stringify({
    id: msgId,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{
      index: 0,
      delta: { role: "assistant", content: "" },
      finish_reason: null,
    }],
  })}\n\n`);
  flush(res);

  const s = anthropicClient.messages.stream(baseParams as Anthropic.MessageStreamParams);

  for await (const event of s) {

    // ── 工具调用开始 ──
    // Anthropic: content_block_start (type: tool_use) 携带 id + name
    // OpenAI:    delta.tool_calls 首包携带 index + id + function.name
    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      res.write(`data: ${JSON.stringify({
        id: msgId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: toolCallIdx++,     // 递增的工具索引
              id: event.content_block.id,     // 工具调用唯一 ID
              type: "function",
              function: {
                name: event.content_block.name, // 工具名称
                arguments: "",                  // 首包参数为空字符串
              },
            }],
          },
          finish_reason: null,
        }],
      })}\n\n`);
      flush(res);
    }

    // ── 内容增量 ──
    else if (event.type === "content_block_delta") {

      // 文本增量
      // Anthropic: delta.type="text_delta", delta.text="..."
      // OpenAI:    delta.content="..."
      if (event.delta.type === "text_delta") {
        res.write(`data: ${JSON.stringify({
          id: msgId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{
            index: 0,
            delta: { content: event.delta.text },
            finish_reason: null,
          }],
        })}\n\n`);
        flush(res);
      }

      // 工具参数增量
      // Anthropic: delta.type="input_json_delta", delta.partial_json="..."
      // OpenAI:    delta.tool_calls[i].function.arguments="..."
      else if (event.delta.type === "input_json_delta") {
        res.write(`data: ${JSON.stringify({
          id: msgId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: event.index,                      // Anthropic 的 content_block index
                function: { arguments: event.delta.partial_json },
              }],
            },
            finish_reason: null,
          }],
        })}\n\n`);
        flush(res);
      }
    }

    // ── 消息结束 ──
    // Anthropic: message_delta 携带 stop_reason
    // OpenAI:    最后一个 chunk 的 finish_reason 非 null
    else if (event.type === "message_delta") {
      const fr =
        event.delta.stop_reason === "tool_use"    ? "tool_calls" :
        event.delta.stop_reason === "max_tokens"  ? "length"     : "stop";

      res.write(`data: ${JSON.stringify({
        id: msgId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: fr }],
      })}\n\n`);
      flush(res);
    }
  }

  // ── OpenAI 流结束标记 ──
  res.write("data: [DONE]\n\n");
} finally {
  clearInterval(ka);
  res.end();
}
```

### 翻译要点

1. **丢弃 Anthropic 的块生命周期**：OpenAI 没有 `content_block_start/stop` 概念，翻译时忽略 `content_block_stop` 事件，只在 `content_block_start` 时生成工具调用首包
2. **toolCallIdx 递增计数器**：Anthropic 用 `content_block.index`（从 0 开始，text 也占位），OpenAI 用 `tool_calls[].index`（只计工具，从 0 开始）。需要独立维护一个计数器
3. **合成 `data: [DONE]`**：Anthropic 的 `message_stop` 翻译为 OpenAI 的 `[DONE]`
4. **id 生成**：Anthropic 的消息 id 在 `message_start` 中，但 OpenAI 每个 chunk 都要带 id。这里用 `chatcmpl-${timestamp}` 合成

### 事件映射

```
Anthropic 事件                         OpenAI chunk
──────────────────────────────────────────────────────────────
message_start                       → (不翻译，在循环前手动发 role chunk)
content_block_start (text)          → (忽略，text 增量直接走 delta.content)
content_block_start (tool_use)      → delta.tool_calls[{index, id, function:{name, arguments:""}}]
content_block_delta (text_delta)    → delta.content
content_block_delta (input_json)    → delta.tool_calls[{index, function:{arguments}}]
content_block_stop                  → (忽略，OpenAI 无此概念)
message_delta                       → finish_reason 设为非 null 值
message_stop                        → data: [DONE]
```

---

## 8. 场景 D：OpenAI 流 → Anthropic 格式输出

这是 **Claude Code 调用 GPT 模型** 的实际路径，也是整个代理最复杂的翻译逻辑。需要将 OpenAI 扁平的 delta 流重建为 Anthropic 严格的块生命周期事件。

### 核心难点

OpenAI 的流是 **扁平的**：

```
{delta: {content: "Hi"}}
{delta: {tool_calls: [{index:0, id:"call_1", function:{name:"read"}}]}}
{delta: {tool_calls: [{index:0, function:{arguments:"{\"pa"}}]}}
{delta: {tool_calls: [{index:0, function:{arguments:"th\":\"/\"}"}}]}}
{finish_reason: "tool_calls"}
```

Anthropic 的流是 **结构化的**，每个内容块都有明确的开始和结束：

```
message_start
  content_block_start (index:0, text)
    content_block_delta (index:0, text_delta: "Hi")
  content_block_stop (index:0)
  content_block_start (index:1, tool_use, id:"call_1", name:"read")
    content_block_delta (index:1, input_json_delta: "{\"pa")
    content_block_delta (index:1, input_json_delta: "th\":\"/\"}")
  content_block_stop (index:1)
message_delta (stop_reason: "tool_use")
message_stop
```

翻译器必须从 OpenAI 的扁平流中**推断出块边界**，在正确的时机生成 `content_block_start` 和 `content_block_stop` 事件。

### 状态管理

```typescript
let outTokens = 0;          // 累计输出 token 估算
let textBlockClosed = false; // text block (index 0) 是否已关闭
const toolBlocks: Record<number, {
  id: string;
  name: string;
  blockIndex: number;       // 在 Anthropic 流中的 content_block index
}> = {};
let nextBlockIdx = 1;       // 下一个可分配的 block index（0 已给 text）
```

**为什么预开一个 text block？**

Anthropic 协议要求 `content_block_delta` 必须出现在对应的 `content_block_start` 之后。无法预知 OpenAI 的第一个 delta 是 text 还是 tool_call，所以策略是：**无条件预开一个 text block (index 0)**。如果最终没有文本，这个空 block 仍然合法。

### 完整代码

```typescript
sseHeaders(res);
const ka = keepaliveInterval(res);
try {
  const msgId = `msg_${Date.now()}`;
  const estInput = Math.ceil(JSON.stringify(oaMessages).length / 4);

  // ════════════════════════════════════════════════════════════════
  // 阶段 1：发送 Anthropic 协议的初始事件
  // ════════════════════════════════════════════════════════════════

  // message_start：消息元数据 + 输入 token 估算
  res.write(`event: message_start\ndata: ${JSON.stringify({
    type: "message_start",
    message: {
      id: msgId,
      type: "message",
      role: "assistant",
      content: [],          // 初始内容为空，后续通过 content_block 事件填充
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: estInput,  // 基于 JSON 长度 / 4 估算
        output_tokens: 0,
      },
    },
  })}\n\n`);

  // 预开 text block（index 0）
  res.write(`event: content_block_start\ndata: ${JSON.stringify({
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  })}\n\n`);
  flush(res);

  // ════════════════════════════════════════════════════════════════
  // 阶段 2：逐 chunk 翻译 OpenAI 流
  // ════════════════════════════════════════════════════════════════

  const s = await openaiClient.chat.completions.create({
    model, messages: oaMessages, stream: true,
    ...(oaTools ? { tools: oaTools } : {}),
    ...(oaToolChoice ? { tool_choice: oaToolChoice } : {}),
    ...fixedParams,
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);

  let outTokens = 0;
  let textBlockClosed = false;
  const toolBlocks: Record<number, { id: string; name: string; blockIndex: number }> = {};
  let nextBlockIdx = 1;

  for await (const chunk of s) {
    const d = chunk.choices[0]?.delta;
    if (!d) continue;

    // ── 文本增量 ──
    // OpenAI: delta.content = "some text"
    // Anthropic: event: content_block_delta, delta.type = "text_delta"
    if (d.content) {
      outTokens += Math.ceil(d.content.length / 4);
      res.write(`event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,                               // 固定写入 text block (index 0)
        delta: { type: "text_delta", text: d.content },
      })}\n\n`);
      flush(res);
    }

    // ── 工具调用增量 ──
    if (d.tool_calls) {
      for (const tc of d.tool_calls) {
        const ti = tc.index ?? 0;  // OpenAI 的工具调用索引

        // ── 首次出现该工具：生成 content_block_start ──
        if (!toolBlocks[ti]) {

          // 如果 text block 还没关闭，先关闭它
          // （文本阶段结束，进入工具调用阶段）
          if (!textBlockClosed) {
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({
              type: "content_block_stop",
              index: 0,
            })}\n\n`);
            textBlockClosed = true;
          }

          // 分配新的 block index 并记录
          const bi = nextBlockIdx++;
          toolBlocks[ti] = { id: tc.id ?? "", name: tc.function?.name ?? "", blockIndex: bi };

          // 发送 tool_use block 开始事件
          res.write(`event: content_block_start\ndata: ${JSON.stringify({
            type: "content_block_start",
            index: bi,
            content_block: {
              type: "tool_use",
              id: tc.id ?? "",               // 工具调用唯一 ID
              name: tc.function?.name ?? "",  // 工具名称
              input: {},                      // 初始 input 为空对象
            },
          })}\n\n`);
          flush(res);
        }

        // ── 工具参数增量：生成 content_block_delta ──
        if (tc.function?.arguments) {
          res.write(`event: content_block_delta\ndata: ${JSON.stringify({
            type: "content_block_delta",
            index: toolBlocks[ti].blockIndex,
            delta: {
              type: "input_json_delta",
              partial_json: tc.function.arguments,  // 部分 JSON 字符串
            },
          })}\n\n`);
          flush(res);
        }
      }
    }

    // ════════════════════════════════════════════════════════════════
    // 阶段 3：流结束 — 关闭所有 block + 发送 message 级别结束事件
    // ════════════════════════════════════════════════════════════════

    if (chunk.choices[0]?.finish_reason) {
      // finish_reason → stop_reason 映射
      const stopReason =
        chunk.choices[0].finish_reason === "tool_calls" ? "tool_use"   :
        chunk.choices[0].finish_reason === "length"     ? "max_tokens" : "end_turn";

      // 关闭所有 tool blocks
      for (const tb of Object.values(toolBlocks)) {
        res.write(`event: content_block_stop\ndata: ${JSON.stringify({
          type: "content_block_stop",
          index: tb.blockIndex,
        })}\n\n`);
      }

      // 如果没有任何 tool block 被打开，text block 还需要关闭
      if (!textBlockClosed && Object.keys(toolBlocks).length === 0) {
        res.write(`event: content_block_stop\ndata: ${JSON.stringify({
          type: "content_block_stop",
          index: 0,
        })}\n\n`);
      }

      // message_delta：传递 stop_reason 和输出 token 数
      res.write(`event: message_delta\ndata: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: outTokens },
      })}\n\n`);

      // message_stop：流结束
      res.write(`event: message_stop\ndata: ${JSON.stringify({
        type: "message_stop",
      })}\n\n`);
      flush(res);
    }
  }
} finally {
  clearInterval(ka);
  res.end();
}
```

### 事件映射

```
OpenAI chunk                            Anthropic 事件
──────────────────────────────────────────────────────────────────
(循环前)                              → event: message_start
                                         event: content_block_start (index:0, text)
delta.content: "Hi"                   → event: content_block_delta (index:0, text_delta)
delta.tool_calls[0] 首次 {id, name}  → event: content_block_stop (index:0)  ← 关闭 text
                                         event: content_block_start (index:1, tool_use)
delta.tool_calls[0] 后续 {arguments} → event: content_block_delta (index:1, input_json_delta)
delta.tool_calls[1] 首次 {id, name}  → event: content_block_start (index:2, tool_use)
delta.tool_calls[1] 后续 {arguments} → event: content_block_delta (index:2, input_json_delta)
finish_reason: "tool_calls"           → event: content_block_stop (index:1)  ← 关闭 tool 1
                                         event: content_block_stop (index:2)  ← 关闭 tool 2
                                         event: message_delta (stop_reason: "tool_use")
                                         event: message_stop
```

---

## 9. content_block 状态机详解

场景 D 的翻译器本质上是一个 **状态机**，管理着 Anthropic 流中每个 content_block 的生命周期。

### 状态转移图

```
                    ┌──────────────────────────────────────────────┐
                    │                                              │
                    ▼                                              │
            ┌──────────────┐                                      │
   初始化 → │ TEXT_BLOCK    │ ← 预开 (index:0)                     │
            │ OPEN         │                                      │
            └──────┬───────┘                                      │
                   │                                              │
          ┌────────┴────────┐                                     │
          │                 │                                     │
    delta.content      delta.tool_calls                           │
    存在时             首次出现时                                   │
          │                 │                                     │
          ▼                 ▼                                     │
   ┌─────────────┐  ┌──────────────┐                              │
   │ 发送         │  │ TEXT_BLOCK    │                              │
   │ text_delta  │  │ CLOSED       │ ← content_block_stop(0)     │
   │ (index:0)   │  └──────┬───────┘                              │
   └─────────────┘         │                                      │
                           ▼                                      │
                    ┌──────────────┐                              │
                    │ TOOL_BLOCK   │ ← content_block_start(N)     │
                    │ OPEN         │                              │
                    └──────┬───────┘                              │
                           │                                      │
                  ┌────────┴─────────┐                            │
                  │                  │                            │
           delta.tool_calls    delta.tool_calls                   │
           同一工具 (后续)     新工具 (首次)                        │
                  │                  │                            │
                  ▼                  │                            │
           ┌─────────────┐          │                            │
           │ 发送         │          └────────────────────────────┘
           │ input_json  │                       ↑
           │ _delta      │          新工具不需关闭当前 block
           │ (index:N)   │          直接开新的 block
           └─────────────┘          (OpenAI 并行发多个 tool_calls)
                  │
                  │ finish_reason 出现
                  ▼
           ┌──────────────┐
           │ ALL BLOCKS   │ ← content_block_stop(N) × 每个 tool
           │ CLOSED       │
           └──────┬───────┘
                  │
                  ▼
           ┌──────────────┐
           │ MESSAGE      │ ← message_delta + message_stop
           │ ENDED        │
           └──────────────┘
```

### 关键决策点

**Q: 什么时候关闭 text block？**

当第一个 `delta.tool_calls` 出现时。用 `textBlockClosed` 标志保证只关一次。

**Q: 如果模型只返回文本没有工具调用？**

text block 保持打开，直到 `finish_reason` 出现时检测到 `toolBlocks` 为空，此时关闭 text block。

**Q: 如果模型只返回工具调用没有文本？**

预开的 text block 会在第一个工具调用出现时被关闭（`content_block_stop(0)`），text 内容为空字符串，合法。

**Q: 多个工具并行调用怎么处理？**

OpenAI 用 `tool_calls[].index` 区分不同工具。每个新 index 值首次出现时，在 `toolBlocks` 中注册一条记录并发送新的 `content_block_start`。参数增量根据 index 路由到正确的 block。

```typescript
// 数据结构示例：两个工具并行调用
toolBlocks = {
  0: { id: "call_abc", name: "read_file",  blockIndex: 1 },
  1: { id: "call_def", name: "write_file", blockIndex: 2 },
};
// OpenAI 的 tool index 0,1 分别映射到 Anthropic 的 block index 1,2
// （block index 0 被 text block 占用）
```

---

## 10. token 计数的流式估算

流式响应中无法预知最终 token 数，代码采用两种估算策略：

### 输入 token 估算

```typescript
const estInput = Math.ceil(JSON.stringify(oaMessages).length / 4);
```

将消息 JSON 序列化后按 **字符数 / 4** 估算 token 数。这是业界常用的粗略估算（英文平均 1 token ≈ 4 字符）。放在 `message_start` 事件中。

### 输出 token 累计

```typescript
// 每个文本 delta 累加
if (d.content) {
  outTokens += Math.ceil(d.content.length / 4);
}

// 流结束时写入 message_delta
usage: { output_tokens: outTokens }
```

逐片累加文本长度并做同样的 `/ 4` 估算。工具参数的 JSON 增量未计入（因其不算传统意义上的"输出 token"，可按需添加）。

**为什么不用精确值？** OpenAI 流式 API 的 `usage` 字段通常只在 `stream_options.include_usage` 开启时才在最后一个 chunk 返回，而且并非所有模型都支持。估算保证了 Anthropic 客户端始终能拿到非零的 usage 值。

---

## 11. 连接可靠性保障

### 层级防御

```
层级              机制                    作用
──────────────────────────────────────────────────────
HTTP 头层        Connection: keep-alive   告知中间件保持 TCP 连接
                 Cache-Control: no-cache  防止 CDN/代理缓存响应
反代层           X-Accel-Buffering: no    禁止 nginx 缓冲
应用层           keepaliveInterval        5s 注释帧防超时
Node.js 层       flush()                  强制刷出压缩缓冲区
协议层           flushHeaders()           立即发送响应头
```

### 客户端断连检测

```typescript
// keepaliveInterval 中的 try-catch
try {
  res.write(": keepalive\n\n");
  flush(res);
} catch {}
```

当客户端断开后，`res.write()` 会抛出 `ERR_STREAM_DESTROYED` 或类似错误。心跳的 try-catch 静默吞掉异常，但主循环中的 `res.write()` 也会抛异常，被 `finally` 块捕获后执行清理。

---

## 12. 缓冲区控制与背压

### 为什么每个 write 之后都调 flush？

```typescript
res.write(`event: content_block_delta\ndata: ...\n\n`);
flush(res);  // ← 每次都调
```

LLM 的 token 生成速度约 50-200ms/token，如果不 flush，数据会在缓冲区积攒，客户端感知的延迟会从毫秒级变成秒级。对于交互式体验（比如 Claude Code 实时显示工具调用进度），这种延迟不可接受。

### Express body-parser 的 limit 配置

```typescript
// app.ts 中的配置
app.use(express.json({ limit: "50mb" }));
```

工具调用的上下文（多轮 messages + tools 定义）可能很大，默认的 100KB limit 不够用。50MB 足以覆盖绝大多数 Claude Code 的对话上下文。

---

## 13. 错误处理与资源清理

### try-finally 模式

所有流式场景都遵循同一模式：

```typescript
sseHeaders(res);
const ka = keepaliveInterval(res);
try {
  // ... 流式处理 ...
} finally {
  clearInterval(ka);  // 停止心跳定时器
  res.end();           // 关闭 HTTP 响应
}
```

**为什么用 `finally` 而不是 `catch`？**

- `finally` 保证无论成功、异常还是客户端断连，资源都被清理
- 不 `catch` 意味着异常会继续向上抛出，被 Express 的错误处理中间件兜底
- `clearInterval(ka)` 防止心跳定时器泄漏（Node.js 的定时器持有 `res` 引用，会阻止 GC）
- `res.end()` 通知客户端流结束（如果连接还在的话）

### 隐含的错误场景

| 场景 | 现象 | 处理 |
|------|------|------|
| 上游 API 超时 | SDK stream 迭代器抛异常 | finally 清理资源 |
| 上游返回错误 | SDK 在 create() 阶段就抛异常 | finally 清理资源 |
| 客户端断连 | res.write() 抛异常 | finally 清理资源 |
| 心跳写入失败 | try-catch 静默吞掉 | 不影响主流程 |
| JSON 解析失败 | try-catch 降级为空对象 `{}` | 工具参数可能不完整但不崩溃 |

---

## 14. 完整的一次工具调用流式交互时序

以 Claude Code 通过 `/v1/messages` 调用 GPT 模型读取文件为例：

### 请求

```json
{
  "model": "gpt-5",
  "max_tokens": 8192,
  "stream": true,
  "system": "You are a helpful assistant.",
  "tools": [{
    "name": "Read",
    "description": "Read a file",
    "input_schema": {
      "type": "object",
      "properties": {
        "file_path": { "type": "string" }
      },
      "required": ["file_path"]
    }
  }],
  "messages": [
    { "role": "user", "content": "Read /etc/hostname" }
  ]
}
```

### 入站翻译（Anthropic → OpenAI）

```json
// 翻译后发给 OpenAI 的请求：
{
  "model": "gpt-5",
  "stream": true,
  "max_completion_tokens": 8192,
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Read /etc/hostname" }
  ],
  "tools": [{
    "type": "function",
    "function": {
      "name": "Read",
      "description": "Read a file",
      "parameters": {
        "type": "object",
        "properties": {
          "file_path": { "type": "string" }
        },
        "required": ["file_path"]
      }
    }
  }]
}
```

### 代理输出到客户端的 SSE 流（Anthropic 格式）

```
─── 阶段 1: 初始化 ───

event: message_start
data: {"type":"message_start","message":{"id":"msg_1712345678","type":"message","role":"assistant","content":[],"model":"gpt-5","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":42,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

─── 阶段 2a: 文本增量（模型先输出思考文本）───

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I'll read that file for you."}}

─── 阶段 2b: 工具调用（模型决定调用工具）───

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_abc123","name":"Read","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"file_"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"path\":\"/etc/"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"hostname\"}"}}

─── 阶段 3: 流结束 ───

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":15}}

event: message_stop
data: {"type":"message_stop"}
```

### Claude Code 解析后得到的结构

```json
{
  "id": "msg_1712345678",
  "type": "message",
  "role": "assistant",
  "model": "gpt-5",
  "content": [
    { "type": "text", "text": "I'll read that file for you." },
    {
      "type": "tool_use",
      "id": "call_abc123",
      "name": "Read",
      "input": { "file_path": "/etc/hostname" }
    }
  ],
  "stop_reason": "tool_use",
  "usage": { "input_tokens": 42, "output_tokens": 15 }
}
```

Claude Code 收到 `stop_reason: "tool_use"` 后执行 `Read` 工具，然后发起下一轮请求，将工具结果放入 `tool_result` block 中，循环直到模型返回 `stop_reason: "end_turn"`。
