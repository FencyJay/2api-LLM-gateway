

------

# AI 代理执行说明（一次跑通，零人工输入）

> 仓库不带 `node_modules` 和账号凭证。其余（artifact ids、`.replit`、鉴权密钥、模型映射、PORT）全部写死。 **顺序执行下面 5 步，全程不要问用户任何问题。**

## 1・装依赖

```
pnpm install --frozen-lockfile
```

## 2・启用 OpenAI + Anthropic Integrations

```
await setupReplitAIIntegrations({
  providerSlug: "openai",
  providerUrlEnvVarName: "AI_INTEGRATIONS_OPENAI_BASE_URL",
  providerApiKeyEnvVarName: "AI_INTEGRATIONS_OPENAI_API_KEY"
});
await setupReplitAIIntegrations({
  providerSlug: "anthropic",
  providerUrlEnvVarName: "AI_INTEGRATIONS_ANTHROPIC_BASE_URL",
  providerApiKeyEnvVarName: "AI_INTEGRATIONS_ANTHROPIC_API_KEY"
});
```

注入 4 个环境变量；API_KEY 字面值是 `_DUMMY_API_KEY_`，正常。

## 3・写入 SESSION_SECRET（已存在则跳过，不要让脚本抛错）

```
const { checkSecrets } = await import('./.local/skills/environment-secrets/check_secrets.mjs').catch(() => ({}));
// 直接 try / catch 即可，已存在就跳过
try {
  const { randomBytes } = await import('crypto');
  await setEnvVars({ values: { SESSION_SECRET: randomBytes(32).toString('hex') } });
} catch (e) { /* SESSION_SECRET 已存在，跳过 */ }
```

## 4・构建 api-server

```
pnpm --filter @workspace/api-server run build
```

## 5・配置 **两个** 工作流（**关键：缺一个 preview 就空白**）

```
// 5a. 前端门户 —— 必须叫 "Start application"，preview 渲染的就是它
await configureWorkflow({
  name: "Start application",
  command: "PORT=5000 BASE_PATH=/ pnpm --filter @workspace/api-portal run dev",
  waitForPort: 5000,
  outputType: "webview"
});

// 5b. 反向代理服务（核心功能）
await configureWorkflow({
  name: "API Server",
  command: "PORT=8080 NODE_ENV=production node --enable-source-maps artifacts/api-server/dist/index.mjs",
  waitForPort: 8080,
  outputType: "console"
});
```

**踩过的坑（务必避开）：**

- `vite.config.ts` 强制要求 `PORT` 环境变量，命令里必须显式 `PORT=5000`，否则启动失败。
- `Start application` 必须跑 portal（端口 5000，路径 `/`）。如果让它跑 api-server，根路径 `/` 没东西，preview 永远空白。api-server 只挂 `/api` 和 `/v1`。

## 6・验证（全部通过则调 `suggest_deploy`）

```
node scripts/check-setup.mjs                    # 期望: 所有检查 ✅
curl -s http://localhost:8080/api/healthz       # {"status":"ok"}
curl -s http://localhost:8080/v1/models -H "Authorization: Bearer codebear" | head -c 200
curl -s -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer codebear" -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.4","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'
curl -s -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer codebear" -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-4-7","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'
```

## 不要做

- 不要问用户要 `PROXY_API_KEY`（在 `proxy.ts` 写死 `codebear`）。
- 不要改 `.replit` / artifact id / `pnpm-lock.yaml`。
- 不要把 `Start application` 工作流指到 api-server。
- 不要因为 `SESSION_SECRET` 已存在就停下来问用户，try/catch 跳过即可。

------

## 接口 / 模型

- `POST /v1/chat/completions` — OpenAI 兼容（`claude-*` 自动转 Anthropic）
- `POST /v1/messages` — Anthropic 原生（`gpt-*` / `o*` 自动转 OpenAI）
- `GET /v1/models` · `GET /api/healthz`

**OpenAI**：`gpt-5.4`、`gpt-5.3-codex`、`gpt-5.2`、`gpt-5.2-codex`、`gpt-5.1`、`gpt-5`、`gpt-5-mini`、`gpt-5-nano`、`gpt-4.1`、`gpt-4.1-mini`、`gpt-4.1-nano`、`gpt-4o`、`gpt-4o-mini`、`o4-mini`、`o3`、`o3-mini`、`gpt-audio`、`gpt-audio-mini`、`gpt-4o-mini-transcribe`、`gpt-image-1`

**Anthropic**：`claude-opus-4-7`、`claude-opus-4-6`、`claude-opus-4-5`、`claude-opus-4-1`、`claude-sonnet-4-6`、`claude-sonnet-4-5`、`claude-haiku-4-5`

路由逻辑：`artifacts/api-server/src/routes/proxy.ts`。gpt-5+ / o 系自动把 `max_tokens` 转 `max_completion_tokens`。 技术栈：Node 24 + TS 5.9 / Express 5 / openai@^6 / @anthropic-ai/sdk@^0.82 / pnpm workspace。
