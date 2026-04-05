import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ─── 启动时检查必要配置（迁移到新账号后会在日志里看到明确提示）────────────
function checkConfig() {
  const checks: Array<{ key: string; hint: string; required: boolean }> = [
    {
      key: "AI_INTEGRATIONS_OPENAI_BASE_URL",
      hint: "请在 Replit Tools → Integrations 中启用 OpenAI 集成",
      required: true,
    },
    {
      key: "AI_INTEGRATIONS_OPENAI_API_KEY",
      hint: "请在 Replit Tools → Integrations 中启用 OpenAI 集成",
      required: true,
    },
    {
      key: "AI_INTEGRATIONS_ANTHROPIC_BASE_URL",
      hint: "请在 Replit Tools → Integrations 中启用 Anthropic 集成",
      required: true,
    },
    {
      key: "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
      hint: "请在 Replit Tools → Integrations 中启用 Anthropic 集成",
      required: true,
    },
    {
      key: "PROXY_API_KEY",
      hint: "请在 Replit Tools → Secrets 中设置 PROXY_API_KEY（对外鉴权的 Bearer Token）",
      required: true,
    },
  ];

  const missing = checks.filter((c) => !process.env[c.key]);
  const errors  = missing.filter((c) => c.required);

  if (errors.length > 0) {
    logger.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    logger.warn("⚠  迁移配置不完整，以下必须项未设置：");
    for (const e of errors) {
      logger.warn(`   ✗ ${e.key}`);
      logger.warn(`     → ${e.hint}`);
    }
    logger.warn("   完整配置指南: node scripts/check-setup.mjs");
    logger.warn("   文档: docs/REBUILD_GUIDE.md");
    logger.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  } else {
    logger.info("✓ 所有必要配置项检查通过");
    logger.info({
      openaiBase: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      anthropicBase: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    }, "AI Integrations 已就绪");
  }
}

checkConfig();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
