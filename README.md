# 2api-LLM-gateway

基于 Replit AI Integrations 的 OpenAI / Anthropic 反向代理，鉴权 Bearer **写死为 `codebear`**。

---

# 导入 + 启动说明（给 AI 代理看）

> 仓库不包含 `node_modules`（已在 `.gitignore`），依赖不可跨账号复用，必须重新安装。账号凭证也不在仓库里，必须重新启用 Integrations。其余（artifact ids、`.replit`、鉴权密钥）都已写死。

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

