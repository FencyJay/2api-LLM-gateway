# AI 反向代理网关

基于 pnpm monorepo 的 AI 反向代理，兼容 OpenAI 和 Anthropic 协议。

## 部署

```bash
pnpm install
```

部署前在运行环境中设置以下环境变量：

| 变量 | 说明 |
|------|------|
| `PROXY_API_KEY` | 网关鉴权密钥（自定义任意字符串） |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI API Key |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | OpenAI 接口地址 |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Anthropic API Key |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Anthropic 接口地址 |

> 非 Replit 平台可将 `AI_INTEGRATIONS_*` 改为标准命名（`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` 等），需同步修改 `artifacts/api-server/src/routes/proxy.ts` 中的环境变量引用。
