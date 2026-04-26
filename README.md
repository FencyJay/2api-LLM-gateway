# 2api-LLM-gateway

基于 Replit AI Integrations 的 OpenAI / Anthropic 反向代理，鉴权 Bearer **写死为 `codebear`**。

---

# 导入 + 启动说明（给 AI 代理看）

> 仓库不包含 `node_modules`（已在 `.gitignore`），依赖不可跨账号复用，必须重新安装。账号凭证也不在仓库里，必须重新启用 Integrations。其余（artifact ids、`.replit`、鉴权密钥、模型映射）都已写死。

## 你（AI）顺序执行以下 4 步

### 1・安装依赖

```bash
pnpm install --frozen-lockfile
```

必须用 pnpm（`package.json` 的 `preinstall` 会拒绝 npm / yarn）。预期安装 ~490 个包。

### 2・启用 OpenAI + Anthropic Integrations（账号级别，新账号必做）

```javascript
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

会注入 4 个环境变量；API_KEY 字面值就是 `_DUMMY_API_KEY_`，这是正常的。

### 3・写入 SESSION_SECRET

```javascript
const { randomBytes } = await import('crypto');
await setEnvVars({
  values: { SESSION_SECRET: randomBytes(32).toString('hex') }
});
```

### 4・构建 + 启动

```bash
pnpm --filter @workspace/api-server run build
```

然后启动工作流 **artifacts/api-server: API Server**（会听 PORT=8080）。

## 不要做的事

- **不要**调 `requestEnvVar` 问用户要 `PROXY_API_KEY` —— 在 `proxy.ts` 里写死 `codebear`，不读环境变量。
- **不要**修改 `.replit` / artifact id —— 已预写为路径式 `artifacts/api-server`、`artifacts/api-portal`、`artifacts/mockup-sandbox`，平台会自动识别。
- **不要**重新生成 lockfile —— `pnpm-lock.yaml` 与当前代码匹配，用 `--frozen-lockfile` 决定性复现。

## 验证（启动后跑）

```bash
node scripts/check-setup.mjs            # 全面体检
curl http://localhost:8080/api/healthz  # 期望：{"status":"ok"}

# 接口联调（Bearer 固定 codebear）
curl -s http://localhost:8080/v1/models -H "Authorization: Bearer codebear" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('模型数:',JSON.parse(d).data.length))"

curl -s -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer codebear" -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.4","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'

curl -s -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer codebear" -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-4-7","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'
```

三项都走通 → 调 `suggest_deploy` 让用户点 Publish。

---

## 接口 / 模型 / 技术栈

- `POST /v1/chat/completions` — OpenAI 兼容（调 Claude 型号会自动转换）
- `POST /v1/messages` — Anthropic 原生（调 GPT 型号会自动转换）
- `GET /v1/models` · `GET /api/healthz`

### 模型列表（名字与上游严格对应）

OpenAI：`gpt-5.4`、`gpt-5.3-codex`、`gpt-5.2`、`gpt-5.2-codex`、`gpt-5.1`、`gpt-5`、`gpt-5-mini`、`gpt-5-nano`、`gpt-4.1`、`gpt-4.1-mini`、`gpt-4.1-nano`、`gpt-4o`、`gpt-4o-mini`、`o4-mini`、`o3`、`o3-mini`、`gpt-audio`、`gpt-audio-mini`、`gpt-4o-mini-transcribe`、`gpt-image-1`

Anthropic：`claude-opus-4-7`、`claude-opus-4-6`、`claude-opus-4-5`、`claude-opus-4-1`、`claude-sonnet-4-6`、`claude-sonnet-4-5`、`claude-haiku-4-5`

路由逻辑在 `artifacts/api-server/src/routes/proxy.ts`：`claude-*` 走 Anthropic 上游，其余走 OpenAI 上游；gpt-5+/o 系自动将 `max_tokens` 改为 `max_completion_tokens`。

### 技术栈

Node.js + TypeScript / Express 5 / openai@^6 / @anthropic-ai/sdk@^0.82 / pnpm workspace。详细原理与协议转换：`docs/REBUILD_GUIDE.md`。
