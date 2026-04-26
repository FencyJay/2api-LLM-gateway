import { Router, type Request, type Response } from "express";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const router = Router();

const openaiClient = new OpenAI({
  baseURL:
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ||
    "http://localhost:1106/modelfarm/openai",
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "_DUMMY_API_KEY_",
});

// 不兼容字段黑名单：SDK 自动注入但 Modelfarm 不支持的字段
const ANTHROPIC_UNSUPPORTED_FIELDS = [
  "output_config",
  "context_management",
  "betas",
];

// 自定义 fetch 拦截器：在请求发出前删除不兼容字段
function anthropicFetch(
  url: string | URL | globalThis.Request,
  init?: globalThis.RequestInit,
): Promise<globalThis.Response> {
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

const anthropicClient = new Anthropic({
  baseURL:
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ||
    "http://localhost:1106/modelfarm/anthropic",
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || "_DUMMY_API_KEY_",
  fetch: anthropicFetch,
});

// ─── Model registry (verified live against Replit modelfarm) ─────────────────
export const OPENAI_MODELS = [
  { id: "gpt-5.4", description: "最强通用模型，非编程任务首选" },
  { id: "gpt-5.3-codex", description: "最强编程模型" },
  { id: "gpt-5.2", description: "GPT-5.2" },
  { id: "gpt-5.2-codex", description: "GPT-5.2 编程版" },
  { id: "gpt-5.1", description: "GPT-5.1" },
  { id: "gpt-5", description: "GPT-5" },
  { id: "gpt-5-mini", description: "高并发、性价比高" },
  { id: "gpt-5-nano", description: "最快最便宜" },
  { id: "gpt-4.1", description: "GPT-4.1 (legacy)" },
  { id: "gpt-4.1-mini", description: "GPT-4.1-mini (legacy)" },
  { id: "gpt-4.1-nano", description: "GPT-4.1-nano (legacy)" },
  { id: "gpt-4o", description: "GPT-4o (legacy)" },
  { id: "gpt-4o-mini", description: "GPT-4o-mini (legacy)" },
  { id: "o4-mini", description: "推理模型，复杂逻辑首选" },
  { id: "o3", description: "更强但更慢的推理模型" },
  { id: "o3-mini", description: "o3-mini (legacy)" },
  { id: "gpt-audio", description: "语音模型" },
  { id: "gpt-audio-mini", description: "语音模型 mini" },
  { id: "gpt-4o-mini-transcribe", description: "语音转写" },
  { id: "gpt-image-1", description: "图像生成" },
];

export const ANTHROPIC_MODELS = [
  { id: "claude-opus-4-7", description: "最强 Opus，复杂推理/编程首选" },
  { id: "claude-opus-4-6", description: "Claude Opus 4.6 (legacy)" },
  { id: "claude-opus-4-5", description: "Claude Opus 4.5 (legacy)" },
  { id: "claude-opus-4-1", description: "Claude Opus 4.1 (legacy)" },
  { id: "claude-sonnet-4-6", description: "平衡型，日常使用首推" },
  { id: "claude-sonnet-4-5", description: "Claude Sonnet 4.5 (legacy)" },
  { id: "claude-haiku-4-5", description: "最快最轻量" },
];

const ALL_MODELS = [
  ...OPENAI_MODELS.map((m) => ({ ...m, provider: "openai" })),
  ...ANTHROPIC_MODELS.map((m) => ({ ...m, provider: "anthropic" })),
];

// gpt-5+ and o-series require max_completion_tokens, not max_tokens
const COMPLETION_TOKEN_MODELS = new Set([
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.1",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "o4-mini",
  "o3",
  "o3-mini",
]);

function isAnthropicModel(model: string): boolean {
  return model.startsWith("claude-");
}

// Fix max_tokens → max_completion_tokens for newer OpenAI models
function fixOpenAITokenParam(
  model: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (COMPLETION_TOKEN_MODELS.has(model)) {
    const { max_tokens, ...rest } = params as any;
    if (max_tokens && !rest.max_completion_tokens) {
      return { ...rest, max_completion_tokens: max_tokens };
    }
    // Drop max_tokens entirely if model doesn't support it
    return rest;
  }
  return params;
}

function verifyBearer(req: Request, res: Response): boolean {
  // 鉴权密钥写死：导入任何 Replit 账号均为 `codebear`，不走环境变量
  const proxyKey = "codebear";
  const auth = req.headers["authorization"] ?? "";
  const xApiKey = (req.headers["x-api-key"] as string) ?? "";
  const valid = auth === `Bearer ${proxyKey}` || xApiKey === proxyKey;
  if (!valid) {
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

function flush(res: Response) {
  if (typeof (res as any).flush === "function") (res as any).flush();
}

function sseHeaders(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

function keepaliveInterval(res: Response): ReturnType<typeof setInterval> {
  return setInterval(() => {
    try {
      res.write(": keepalive\n\n");
      flush(res);
    } catch {}
  }, 5000);
}

// ─── Convert OpenAI tools → Anthropic tools ──────────────────────────────────
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

function openaiToolChoiceToAnthropic(
  tc: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined,
): Anthropic.MessageCreateParamsNonStreaming["tool_choice"] | undefined {
  if (!tc) return undefined;
  if (tc === "auto") return { type: "auto" };
  if (tc === "none") return undefined;
  if (tc === "required") return { type: "any" };
  if (typeof tc === "object" && tc.function)
    return { type: "tool", name: tc.function.name };
  return undefined;
}

// ─── Convert OpenAI messages → Anthropic messages + system ───────────────────
function openaiMessagesToAnthropic(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): { system?: string; messages: Anthropic.MessageParam[] } {
  let system: string | undefined;
  const converted: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system = typeof msg.content === "string" ? msg.content : "";
      continue;
    }
    if (msg.role === "user") {
      converted.push({
        role: "user",
        content:
          typeof msg.content === "string"
            ? msg.content
            : (msg.content as Anthropic.ContentBlock[]),
      });
      continue;
    }
    if (msg.role === "assistant") {
      const blocks: Anthropic.ContentBlock[] = [];
      if (msg.content)
        blocks.push({
          type: "text",
          text: typeof msg.content === "string" ? msg.content : "",
        });
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

// ─── Convert Anthropic response → OpenAI format ──────────────────────────────
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
        function: { name: b.name, arguments: JSON.stringify(b.input) },
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

// ─── GET /v1/models ───────────────────────────────────────────────────────────
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

// ─── POST /v1/chat/completions ────────────────────────────────────────────────
router.post("/chat/completions", async (req: Request, res: Response) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as OpenAI.Chat.Completions.ChatCompletionCreateParams;
  const { model, messages, stream, tools, tool_choice, ...rawRest } = body;
  const rest = fixOpenAITokenParam(model, rawRest as Record<string, unknown>);

  if (!isAnthropicModel(model)) {
    // ── OpenAI path ─────────────────────────────────────────────────────────
    if (stream) {
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
    } else {
      const r = await openaiClient.chat.completions.create({
        model,
        messages,
        stream: false,
        ...(tools ? { tools } : {}),
        ...(tool_choice ? { tool_choice } : {}),
        ...rest,
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
      res.json(r);
    }
    return;
  }

  // ── Anthropic path ──────────────────────────────────────────────────────────
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

  if (stream) {
    sseHeaders(res);
    const ka = keepaliveInterval(res);
    try {
      const msgId = `chatcmpl-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      let toolCallIdx = 0;

      res.write(
        `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}\n\n`,
      );
      flush(res);

      const rawStream = await anthropicClient.messages.create({
        ...baseParams,
        stream: true,
      } as Anthropic.MessageCreateParamsStreaming);
      for await (const event of rawStream) {
        if (
          event.type === "content_block_start" &&
          event.content_block.type === "tool_use"
        ) {
          res.write(
            `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { tool_calls: [{ index: toolCallIdx++, id: event.content_block.id, type: "function", function: { name: event.content_block.name, arguments: "" } }] }, finish_reason: null }] })}\n\n`,
          );
          flush(res);
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            res.write(
              `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: event.delta.text }, finish_reason: null }] })}\n\n`,
            );
            flush(res);
          } else if (event.delta.type === "input_json_delta") {
            res.write(
              `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { tool_calls: [{ index: event.index, function: { arguments: event.delta.partial_json } }] }, finish_reason: null }] })}\n\n`,
            );
            flush(res);
          }
        } else if (event.type === "message_delta") {
          const fr =
            event.delta.stop_reason === "tool_use"
              ? "tool_calls"
              : event.delta.stop_reason === "max_tokens"
                ? "length"
                : "stop";
          res.write(
            `data: ${JSON.stringify({ id: msgId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: fr }] })}\n\n`,
          );
          flush(res);
        }
      }
      res.write("data: [DONE]\n\n");
    } finally {
      clearInterval(ka);
      res.end();
    }
  } else {
    const final = await anthropicClient.messages.create({
      ...baseParams,
      stream: false,
    } as Anthropic.MessageCreateParamsNonStreaming);
    res.json(anthropicToOpenAI(final, model));
  }
});

// ─── POST /v1/messages ────────────────────────────────────────────────────────
router.post("/messages", async (req: Request, res: Response) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as Anthropic.MessageCreateParamsNonStreaming & {
    stream?: boolean;
  };
  const { model, stream } = body;

  if (isAnthropicModel(model)) {
    // ── Anthropic native pass-through ────────────────────────────────────────
    if (stream) {
      sseHeaders(res);
      const ka = keepaliveInterval(res);
      try {
        const rawStream = await anthropicClient.messages.create({
          ...body,
          stream: true,
        } as Anthropic.MessageCreateParamsStreaming);
        for await (const event of rawStream) {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          flush(res);
        }
      } finally {
        clearInterval(ka);
        res.end();
      }
    } else {
      const final = await anthropicClient.messages.create({
        ...body,
        stream: false,
      } as Anthropic.MessageCreateParamsNonStreaming);
      res.json(final);
    }
    return;
  }

  // ── OpenAI model via /v1/messages (Anthropic format in, OpenAI out, Anthropic format back) ──
  const oaMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
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
    if (msg.role === "user") {
      if (typeof msg.content !== "string") {
        const toolResults = (
          msg.content as Anthropic.ContentBlockParam[]
        ).filter(
          (b) => b.type === "tool_result",
        ) as Anthropic.ToolResultBlockParam[];
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            oaMessages.push({
              role: "tool",
              tool_call_id: tr.tool_use_id,
              content: typeof tr.content === "string" ? tr.content : "",
            });
          }
          continue;
        }
        const text = (msg.content as Anthropic.ContentBlockParam[])
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("");
        oaMessages.push({ role: "user", content: text });
      } else {
        oaMessages.push({ role: "user", content: msg.content });
      }
    } else if (msg.role === "assistant") {
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
              function: { name: tb.name, arguments: JSON.stringify(tb.input) },
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

  const oaTools = body.tools?.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
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

  const maxTokens = body.max_tokens ?? 8192;
  const fixedParams = fixOpenAITokenParam(model, { max_tokens: maxTokens });

  if (stream) {
    sseHeaders(res);
    const ka = keepaliveInterval(res);
    try {
      const msgId = `msg_${Date.now()}`;
      const estInput = Math.ceil(JSON.stringify(oaMessages).length / 4);

      res.write(
        `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: msgId, type: "message", role: "assistant", content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: estInput, output_tokens: 0 } } })}\n\n`,
      );
      res.write(
        `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
      );
      flush(res);

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
      let nextBlockIdx = 1;

      for await (const chunk of s) {
        const d = chunk.choices[0]?.delta;
        if (!d) continue;
        if (d.content) {
          outTokens += Math.ceil(d.content.length / 4);
          res.write(
            `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: d.content } })}\n\n`,
          );
          flush(res);
        }
        if (d.tool_calls) {
          for (const tc of d.tool_calls) {
            const ti = tc.index ?? 0;
            if (!toolBlocks[ti]) {
              if (!textBlockClosed) {
                res.write(
                  `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
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
                `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: bi, content_block: { type: "tool_use", id: tc.id ?? "", name: tc.function?.name ?? "", input: {} } })}\n\n`,
              );
              flush(res);
            }
            if (tc.function?.arguments) {
              res.write(
                `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: toolBlocks[ti].blockIndex, delta: { type: "input_json_delta", partial_json: tc.function.arguments } })}\n\n`,
              );
              flush(res);
            }
          }
        }
        if (chunk.choices[0]?.finish_reason) {
          const stopReason =
            chunk.choices[0].finish_reason === "tool_calls"
              ? "tool_use"
              : chunk.choices[0].finish_reason === "length"
                ? "max_tokens"
                : "end_turn";
          for (const tb of Object.values(toolBlocks)) {
            res.write(
              `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: tb.blockIndex })}\n\n`,
            );
          }
          if (!textBlockClosed && Object.keys(toolBlocks).length === 0) {
            res.write(
              `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
            );
          }
          res.write(
            `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outTokens } })}\n\n`,
          );
          res.write(
            `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
          );
          flush(res);
        }
      }
    } finally {
      clearInterval(ka);
      res.end();
    }
  } else {
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
    if (choice.message.content)
      blocks.push({ type: "text", text: choice.message.content });
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
  }
});

export default router;
