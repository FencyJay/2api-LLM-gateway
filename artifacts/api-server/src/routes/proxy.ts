import { Router, type Request, type Response } from "express";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const router = Router();

const openaiClient = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "dummy",
});

const anthropicClient = new Anthropic({
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? "dummy",
});

const OPENAI_MODELS = [
  { id: "gpt-5.2", provider: "openai" },
  { id: "gpt-5-mini", provider: "openai" },
  { id: "gpt-5-nano", provider: "openai" },
  { id: "o4-mini", provider: "openai" },
  { id: "o3", provider: "openai" },
];

const ANTHROPIC_MODELS = [
  { id: "claude-opus-4-6", provider: "anthropic" },
  { id: "claude-sonnet-4-6", provider: "anthropic" },
  { id: "claude-haiku-4-5", provider: "anthropic" },
];

const ALL_MODELS = [...OPENAI_MODELS, ...ANTHROPIC_MODELS];

function verifyBearer(req: Request, res: Response): boolean {
  const auth = req.headers["authorization"] ?? "";
  const proxyKey = process.env.PROXY_API_KEY;
  if (!proxyKey || auth !== `Bearer ${proxyKey}`) {
    res.status(401).json({ error: { message: "Unauthorized", type: "auth_error" } });
    return false;
  }
  return true;
}

function isAnthropicModel(model: string): boolean {
  return model.startsWith("claude-");
}

// Convert OpenAI tools format → Anthropic tools format
function openaiToolsToAnthropic(tools: OpenAI.Chat.Completions.ChatCompletionTool[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    input_schema: (t.function.parameters as Anthropic.Tool["input_schema"]) ?? { type: "object", properties: {} },
  }));
}

// Convert OpenAI tool_choice → Anthropic tool_choice
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

// Convert OpenAI messages → Anthropic messages + system
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
      converted.push({ role: "user", content: typeof msg.content === "string" ? msg.content : (msg.content as Anthropic.ContentBlock[]) });
      continue;
    }

    if (msg.role === "assistant") {
      const contentBlocks: Anthropic.ContentBlock[] = [];
      if (msg.content) {
        contentBlocks.push({ type: "text", text: typeof msg.content === "string" ? msg.content : "" });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let parsedInput: Record<string, unknown> = {};
          try { parsedInput = JSON.parse(tc.function.arguments); } catch {}
          contentBlocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: parsedInput });
        }
      }
      converted.push({ role: "assistant", content: contentBlocks });
      continue;
    }

    if (msg.role === "tool") {
      converted.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: msg.tool_call_id, content: typeof msg.content === "string" ? msg.content : "" }],
      });
      continue;
    }
  }

  return { system, messages: converted };
}

// Convert Anthropic response → OpenAI chat completion response
function anthropicToOpenaiResponse(msg: Anthropic.Message, model: string): OpenAI.Chat.Completions.ChatCompletion {
  const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
  let textContent = "";

  for (const block of msg.content) {
    if (block.type === "text") {
      textContent += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input) },
      });
    }
  }

  const finishReason: OpenAI.Chat.Completions.ChatCompletion.Choice["finish_reason"] =
    msg.stop_reason === "tool_use" ? "tool_calls" :
    msg.stop_reason === "end_turn" ? "stop" :
    msg.stop_reason === "max_tokens" ? "length" : "stop";

  return {
    id: msg.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: textContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        refusal: null,
      },
      finish_reason: finishReason,
      logprobs: null,
    }],
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
    })),
  });
});

// ─── POST /v1/chat/completions ────────────────────────────────────────────────
router.post("/chat/completions", async (req: Request, res: Response) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as OpenAI.Chat.Completions.ChatCompletionCreateParams;
  const { model, messages, stream, tools, tool_choice, ...rest } = body;

  if (!isAnthropicModel(model)) {
    // ── OpenAI path ──
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const keepalive = setInterval(() => {
        try { res.write(": keepalive\n\n"); if (typeof (res as any).flush === "function") (res as any).flush(); } catch {}
      }, 5000);

      try {
        const streamResp = await openaiClient.chat.completions.create({
          model, messages, stream: true, tools, tool_choice, ...rest,
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);

        for await (const chunk of streamResp) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          if (typeof (res as any).flush === "function") (res as any).flush();
        }
        res.write("data: [DONE]\n\n");
      } finally {
        clearInterval(keepalive);
        res.end();
      }
    } else {
      const result = await openaiClient.chat.completions.create({
        model, messages, stream: false, tools, tool_choice, ...rest,
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
      res.json(result);
    }
    return;
  }

  // ── Anthropic path ──
  const { system, messages: anthropicMessages } = openaiMessagesToAnthropic(messages);
  const anthropicTools = tools ? openaiToolsToAnthropic(tools) : undefined;
  const anthropicToolChoice = openaiToolChoiceToAnthropic(tool_choice);
  const maxTokens = (rest as any).max_tokens ?? (rest as any).max_completion_tokens ?? 8192;

  const baseParams: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    messages: anthropicMessages,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    ...(anthropicTools ? { tools: anthropicTools } : {}),
    ...(anthropicToolChoice ? { tool_choice: anthropicToolChoice } : {}),
  };

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const keepalive = setInterval(() => {
      try { res.write(": keepalive\n\n"); if (typeof (res as any).flush === "function") (res as any).flush(); } catch {}
    }, 5000);

    try {
      const msgId = `chatcmpl-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      let toolCallIndex = 0;
      const toolCallIdMap: Record<number, string> = {};

      // Send initial role chunk
      res.write(`data: ${JSON.stringify({
        id: msgId, object: "chat.completion.chunk", created, model,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      })}\n\n`);
      if (typeof (res as any).flush === "function") (res as any).flush();

      const streamResp = anthropicClient.messages.stream({ ...baseParams, stream: true } as Anthropic.MessageStreamParams);

      for await (const event of streamResp) {
        if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            const idx = event.index;
            toolCallIdMap[idx] = event.content_block.id;
            const chunk = {
              id: msgId, object: "chat.completion.chunk", created, model,
              choices: [{
                index: 0,
                delta: {
                  tool_calls: [{
                    index: toolCallIndex++,
                    id: event.content_block.id,
                    type: "function",
                    function: { name: event.content_block.name, arguments: "" },
                  }],
                },
                finish_reason: null,
              }],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            if (typeof (res as any).flush === "function") (res as any).flush();
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            const chunk = {
              id: msgId, object: "chat.completion.chunk", created, model,
              choices: [{ index: 0, delta: { content: event.delta.text }, finish_reason: null }],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            if (typeof (res as any).flush === "function") (res as any).flush();
          } else if (event.delta.type === "input_json_delta") {
            const idx = event.index;
            const chunk = {
              id: msgId, object: "chat.completion.chunk", created, model,
              choices: [{
                index: 0,
                delta: { tool_calls: [{ index: idx, function: { arguments: event.delta.partial_json } }] },
                finish_reason: null,
              }],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            if (typeof (res as any).flush === "function") (res as any).flush();
          }
        } else if (event.type === "message_delta") {
          const finishReason =
            event.delta.stop_reason === "tool_use" ? "tool_calls" :
            event.delta.stop_reason === "end_turn" ? "stop" :
            event.delta.stop_reason === "max_tokens" ? "length" : "stop";
          const chunk = {
            id: msgId, object: "chat.completion.chunk", created, model,
            choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          if (typeof (res as any).flush === "function") (res as any).flush();
        }
      }

      res.write("data: [DONE]\n\n");
    } finally {
      clearInterval(keepalive);
      res.end();
    }
  } else {
    // Non-streaming: use stream internally to avoid 10-min timeout
    const finalMsg = await anthropicClient.messages.stream(baseParams as Anthropic.MessageStreamParams).finalMessage();
    res.json(anthropicToOpenaiResponse(finalMsg, model));
  }
});

// ─── POST /v1/messages ────────────────────────────────────────────────────────
router.post("/messages", async (req: Request, res: Response) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as Anthropic.MessageCreateParamsNonStreaming & { stream?: boolean };
  const { model, stream } = body;

  if (isAnthropicModel(model)) {
    // ── Anthropic path: pass through ──
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const keepalive = setInterval(() => {
        try { res.write(": keepalive\n\n"); if (typeof (res as any).flush === "function") (res as any).flush(); } catch {}
      }, 5000);

      try {
        const anthropicStream = anthropicClient.messages.stream(body as Anthropic.MessageStreamParams);
        for await (const event of anthropicStream) {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          if (typeof (res as any).flush === "function") (res as any).flush();
        }
      } finally {
        clearInterval(keepalive);
        res.end();
      }
    } else {
      const finalMsg = await anthropicClient.messages.stream(body as Anthropic.MessageStreamParams).finalMessage();
      res.json(finalMsg);
    }
    return;
  }

  // ── OpenAI model via /v1/messages ──
  // Convert Anthropic format → OpenAI
  const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  if (body.system) {
    const sysContent = typeof body.system === "string" ? body.system : body.system.map((b) => (b.type === "text" ? b.text : "")).join("");
    openaiMessages.push({ role: "system", content: sysContent });
  }

  for (const msg of body.messages) {
    if (msg.role === "user") {
      const content = typeof msg.content === "string"
        ? msg.content
        : msg.content.map((b) => {
            if (b.type === "text") return b.text;
            if (b.type === "tool_result") return typeof b.content === "string" ? b.content : "";
            return "";
          }).join("");
      // Handle tool_result blocks as tool messages
      if (typeof msg.content !== "string") {
        const toolResults = (msg.content as Anthropic.ToolResultBlockParam[]).filter((b) => b.type === "tool_result");
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            openaiMessages.push({
              role: "tool",
              tool_call_id: tr.tool_use_id,
              content: typeof tr.content === "string" ? tr.content : "",
            });
          }
          continue;
        }
      }
      openaiMessages.push({ role: "user", content });
    } else if (msg.role === "assistant") {
      const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
      let textContent = "";
      if (typeof msg.content === "string") {
        textContent = msg.content;
      } else {
        for (const b of msg.content) {
          if (b.type === "text") textContent += b.text;
          if (b.type === "tool_use") {
            toolCalls.push({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input) } });
          }
        }
      }
      openaiMessages.push({
        role: "assistant",
        content: textContent || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
    }
  }

  // Convert tools
  let openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined;
  if (body.tools) {
    openaiTools = body.tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description ?? "", parameters: t.input_schema as Record<string, unknown> },
    }));
  }

  // Convert tool_choice
  let openaiToolChoice: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined;
  if (body.tool_choice) {
    const tc = body.tool_choice;
    if (tc.type === "auto") openaiToolChoice = "auto";
    else if (tc.type === "any") openaiToolChoice = "required";
    else if (tc.type === "tool") openaiToolChoice = { type: "function", function: { name: (tc as Anthropic.ToolChoiceToolParam).name } };
  }

  const maxTokens = body.max_tokens ?? 8192;

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const keepalive = setInterval(() => {
      try { res.write(": keepalive\n\n"); if (typeof (res as any).flush === "function") (res as any).flush(); } catch {}
    }, 5000);

    try {
      const msgId = `msg_${Date.now()}`;
      const inputTokensEst = Math.ceil(JSON.stringify(openaiMessages).length / 4);

      // message_start
      res.write(`event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: { id: msgId, type: "message", role: "assistant", content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokensEst, output_tokens: 0 } },
      })}\n\n`);

      // content_block_start for text
      res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`);
      if (typeof (res as any).flush === "function") (res as any).flush();

      const openaiStream = await openaiClient.chat.completions.create({
        model, messages: openaiMessages, stream: true, max_tokens: maxTokens,
        ...(openaiTools ? { tools: openaiTools } : {}),
        ...(openaiToolChoice ? { tool_choice: openaiToolChoice } : {}),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);

      let outputTokens = 0;
      let textIndex = 0;
      const toolBlocks: Record<number, { id: string; name: string; args: string; blockIndex: number }> = {};
      let nextBlockIndex = 1;

      for await (const chunk of openaiStream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (delta.content) {
          outputTokens += Math.ceil(delta.content.length / 4);
          res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: textIndex, delta: { type: "text_delta", text: delta.content } })}\n\n`);
          if (typeof (res as any).flush === "function") (res as any).flush();
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const tIdx = tc.index ?? 0;
            if (!toolBlocks[tIdx]) {
              const blockIndex = nextBlockIndex++;
              toolBlocks[tIdx] = { id: tc.id ?? "", name: tc.function?.name ?? "", args: "", blockIndex };
              // Close text block first if we haven't
              res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: textIndex })}\n\n`);
              // Start tool_use block
              res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: blockIndex, content_block: { type: "tool_use", id: tc.id ?? "", name: tc.function?.name ?? "", input: {} } })}\n\n`);
              if (typeof (res as any).flush === "function") (res as any).flush();
            } else if (tc.id) {
              toolBlocks[tIdx].id = tc.id;
            }
            if (tc.function?.name) toolBlocks[tIdx].name += tc.function.name;
            if (tc.function?.arguments) {
              toolBlocks[tIdx].args += tc.function.arguments;
              res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: toolBlocks[tIdx].blockIndex, delta: { type: "input_json_delta", partial_json: tc.function.arguments } })}\n\n`);
              if (typeof (res as any).flush === "function") (res as any).flush();
            }
          }
        }

        if (choice.finish_reason) {
          const stopReason = choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason === "length" ? "max_tokens" : "end_turn";
          // Close all open blocks
          for (const tb of Object.values(toolBlocks)) {
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: tb.blockIndex })}\n\n`);
          }
          if (Object.keys(toolBlocks).length === 0) {
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: textIndex })}\n\n`);
          }
          res.write(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } })}\n\n`);
          res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
          if (typeof (res as any).flush === "function") (res as any).flush();
        }
      }
    } finally {
      clearInterval(keepalive);
      res.end();
    }
  } else {
    const result = await openaiClient.chat.completions.create({
      model, messages: openaiMessages, stream: false, max_tokens: maxTokens,
      ...(openaiTools ? { tools: openaiTools } : {}),
      ...(openaiToolChoice ? { tool_choice: openaiToolChoice } : {}),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

    const choice = result.choices[0];
    const contentBlocks: Anthropic.ContentBlock[] = [];

    if (choice.message.content) {
      contentBlocks.push({ type: "text", text: choice.message.content });
    }
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(tc.function.arguments); } catch {}
        contentBlocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
    }

    const stopReason: Anthropic.Message["stop_reason"] =
      choice.finish_reason === "tool_calls" ? "tool_use" :
      choice.finish_reason === "length" ? "max_tokens" : "end_turn";

    const anthropicResp: Anthropic.Message = {
      id: result.id,
      type: "message",
      role: "assistant",
      content: contentBlocks,
      model,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: result.usage?.prompt_tokens ?? 0, output_tokens: result.usage?.completion_tokens ?? 0 },
    };
    res.json(anthropicResp);
  }
});

export default router;
