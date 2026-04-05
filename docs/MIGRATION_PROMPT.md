# 迁移初始化指令

> **使用方式：** 将此文档内容完整粘贴给新 Replit 项目的 AI 代理，它会自动完成全部配置。

---

你好！这是一个已有完整代码的项目（从 GitHub 导入的 AI 反向代理网关），代码完整可用，但需要你完成以下初始化配置才能运行。请按顺序执行以下每一步，全部由你自动完成，不要让我手动操作任何配置项。

## 项目说明

这是一个 AI 反向代理网关（Express + TypeScript + pnpm monorepo），对外提供：
- `POST /v1/chat/completions` — OpenAI 兼容接口，支持 13 个 OpenAI 模型 + 6 个 Anthropic 模型（共 19 个）
- `POST /v1/messages` — Anthropic 原生接口，同样支持全部 19 个模型（自动双向转换）
- `GET /v1/models` — 返回所有可用模型列表

所有接口用 Bearer Token 鉴权（`PROXY_API_KEY`）。代理通过 Replit AI Integrations（modelfarm）访问模型，**不需要用户提供任何 API Key**，费用由 Replit 积分承担。

---

## 第一步：配置 Replit AI Integrations（你来执行，无需用户操作）

这是最重要的一步。请在代码执行沙箱中，依次调用 `setupReplitAIIntegrations`，为本项目注入 OpenAI 和 Anthropic 的访问凭证：

```javascript
// 先配置 OpenAI
const openaiResult = await setupReplitAIIntegrations({
    providerSlug: "openai",
    providerUrlEnvVarName: "AI_INTEGRATIONS_OPENAI_BASE_URL",
    providerApiKeyEnvVarName: "AI_INTEGRATIONS_OPENAI_API_KEY"
});
console.log("OpenAI:", openaiResult);

// 等上一步完成后再配置 Anthropic
const anthropicResult = await setupReplitAIIntegrations({
    providerSlug: "anthropic",
    providerUrlEnvVarName: "AI_INTEGRATIONS_ANTHROPIC_BASE_URL",
    providerApiKeyEnvVarName: "AI_INTEGRATIONS_ANTHROPIC_API_KEY"
});
console.log("Anthropic:", anthropicResult);
```

执行成功后，以下环境变量会被自动注入（值类似下方所示，具体由 Replit 平台决定）：
```
AI_INTEGRATIONS_OPENAI_BASE_URL    = http://localhost:1106/modelfarm/openai
AI_INTEGRATIONS_OPENAI_API_KEY     = _DUMMY_API_KEY_
AI_INTEGRATIONS_ANTHROPIC_BASE_URL = http://localhost:1106/modelfarm/anthropic
AI_INTEGRATIONS_ANTHROPIC_API_KEY  = _DUMMY_API_KEY_
```

> ⚠️ 如果调用失败，请重试最多 3 次。如果 3 次后仍失败，告知用户并询问是否要改用用户自己的 API Key 方案。

---

## 第二步：生成并设置 SESSION_SECRET（你来执行）

在代码执行沙箱中生成随机密钥并写入环境变量：

```javascript
const { randomBytes } = await import('crypto');
const sessionSecret = randomBytes(32).toString('hex');
await setEnvVars({ values: { SESSION_SECRET: sessionSecret } });
console.log("SESSION_SECRET 已自动生成并设置，长度:", sessionSecret.length);
```

---

## 第三步：请求用户设置 PROXY_API_KEY（需用户操作）

`PROXY_API_KEY` 是这个代理对外的 Bearer Token，由用户自定义，任意字符串均可（建议 16 位以上）。请调用：

```javascript
await requestEnvVar({
    requestType: "secret",
    keys: ["PROXY_API_KEY"],
    userMessage: "请设置 PROXY_API_KEY：这是你的 AI 代理网关对外的鉴权 Token，在 CherryStudio 或其他客户端填写 API Key 时使用。可以是任意字符串，例如 my-proxy-key-2024"
});
```

等待用户设置完成后继续。

---

## 第四步：运行配置检查（你来执行）

在 Shell 中运行验证脚本，确认所有配置项都已就绪：

```bash
node scripts/check-setup.mjs
```

预期输出应包含全部 ✅。如果有 ❌，根据提示修复后重新运行。

---

## 第五步：安装依赖并构建（你来执行）

```bash
pnpm install --no-frozen-lockfile
cd artifacts/api-server && pnpm run build
```

---

## 第六步：启动工作流并验证（你来执行）

启动 `artifacts/api-server: API Server` 工作流，然后验证服务正常：

```bash
# 等待服务启动后运行
curl http://localhost:8080/api/healthz
# 预期返回: {"status":"ok"}
```

查看启动日志，确认包含以下内容（说明配置正常）：
```
✓ 所有必要配置项检查通过
AI Integrations 已就绪
```

如果日志中出现 `⚠ 迁移配置不完整`，说明某项环境变量未设置，按提示补充后重启。

---

## 第七步：测试关键接口（你来执行）

用实际 API 调用验证代理是否工作：

```bash
PROXY_KEY="$(node -e \"console.log(process.env.PROXY_API_KEY||'')\")"

# 1. 模型列表（应返回 19 个模型）
curl -s http://localhost:8080/v1/models \
  -H "Authorization: Bearer $PROXY_KEY" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log('模型数量:',j.data.length);})"

# 2. Anthropic 模型测试（通过 OpenAI 格式）
curl -s -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5","messages":[{"role":"user","content":"回复一个词：你好"}],"max_tokens":10}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log('Anthropic回复:',j.choices?.[0]?.message?.content || JSON.stringify(j.error));});"

# 3. OpenAI 模型测试（max_tokens 自动转换）
curl -s -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5-mini","messages":[{"role":"user","content":"回复一个词：你好"}],"max_tokens":10}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log('OpenAI回复:',j.choices?.[0]?.message?.content ?? JSON.stringify(j.error));});"
```

三项测试全部通过后进入下一步。

---

## 第八步：发布上线（你来建议，用户来点击）

验证全部通过后，调用 `suggest_deploy` 工具，提示用户点击 Publish 按钮完成发布。

发布后告知用户：
- 部署域名即为 Base URL，格式：`https://你的项目名.replit.app`
- 在 CherryStudio / 其他 OpenAI 兼容客户端中：
  - Base URL：`https://你的项目名.replit.app`
  - API Key：填写你设置的 `PROXY_API_KEY` 值
  - 可用模型：19 个（gpt-5.2 / claude-opus-4-6 等，完整列表见 `/v1/models`）

---

## 关键技术说明（供你排查问题参考）

### AI Integrations 工作原理
- `setupReplitAIIntegrations` 向 Replit 平台申请 modelfarm 访问权限，自动注入 `AI_INTEGRATIONS_*` 环境变量
- 上游地址是 Replit 容器内部的 `localhost:1106/modelfarm/openai` 和 `localhost:1106/modelfarm/anthropic`
- API Key 固定为 `_DUMMY_API_KEY_`（字面值），这是正确的，不是错误

### OpenAI SDK 行为（v6.x）
- `baseURL = "http://localhost:1106/modelfarm/openai"` 时，SDK 实际调用 `http://localhost:1106/modelfarm/openai/chat/completions`（SDK 自动去掉 `/v1/` 前缀，这是预期行为）
- `gpt-5.*`、`gpt-5-mini`、`gpt-5-nano`、`o4-mini`、`o3`、`o3-mini` 必须用 `max_completion_tokens`，代理已自动处理此转换

### Anthropic SDK 行为（v0.82+）
- `baseURL = "http://localhost:1106/modelfarm/anthropic"` 时，SDK 调用 `http://localhost:1106/modelfarm/anthropic/v1/messages`
- 所有请求必须包含 `max_tokens` 字段（必填，无默认值）
- 流式响应每个事件格式为 `event: <type>\ndata: <json>\n\n`（双行，不能只有 `data:` 行）

### 常见问题
| 症状 | 原因 | 修复 |
|---|---|---|
| `AI_INTEGRATIONS_*` 环境变量未设置 | setupReplitAIIntegrations 未调用 | 重新执行第一步 |
| Anthropic 请求返回 validation_error | max_tokens 字段缺失 | 检查 baseParams 是否包含 max_tokens |
| OpenAI 返回 INVALID_ENDPOINT | baseURL 拼接错误（多了 /v1/） | 检查 openaiClient 的 baseURL 配置 |
| 流式响应客户端解析失败 | Anthropic SSE 缺少 event: 行 | 每次 write 前加 `event: ${event.type}\n` |
| 401 Unauthorized | PROXY_API_KEY 未设置或值不匹配 | 确认 Secret 已设置，客户端 Bearer 值正确 |

### 完整重建文档
如需了解完整的协议转换逻辑、格式对照表、接口规范，请查阅：`docs/REBUILD_GUIDE.md`
