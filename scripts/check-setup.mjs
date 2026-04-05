#!/usr/bin/env node
/**
 * check-setup.mjs
 * 迁移到新账号后，运行此脚本验证所有必须配置项。
 * 用法: node scripts/check-setup.mjs
 */

const RESET  = "\x1b[0m";
const RED    = "\x1b[31m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const BOLD   = "\x1b[1m";

const ok   = (msg) => console.log(`  ${GREEN}✅ ${msg}${RESET}`);
const fail = (msg) => console.log(`  ${RED}❌ ${msg}${RESET}`);
const warn = (msg) => console.log(`  ${YELLOW}⚠️  ${msg}${RESET}`);
const info = (msg) => console.log(`  ${CYAN}ℹ  ${msg}${RESET}`);

console.log();
console.log(`${BOLD}╔═══════════════════════════════════════════════╗${RESET}`);
console.log(`${BOLD}║   AI 反向代理网关 — 迁移配置检查              ║${RESET}`);
console.log(`${BOLD}╚═══════════════════════════════════════════════╝${RESET}`);
console.log();

let hasError = false;
let hasWarn  = false;

// ─── 1. Replit AI Integrations ────────────────────────────────────────────────
console.log(`${BOLD}[1] Replit AI Integrations（必须在新账号重新启用）${RESET}`);

const oaBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const oaKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const anBase = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
const anKey  = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

if (oaBase && oaKey) {
  ok(`OpenAI Integration 已启用 → ${oaBase}`);
} else {
  fail("OpenAI Integration 未配置！");
  info("请前往 Replit 左侧 Tools → Integrations → 启用 OpenAI");
  hasError = true;
}

if (anBase && anKey) {
  ok(`Anthropic Integration 已启用 → ${anBase}`);
} else {
  fail("Anthropic Integration 未配置！");
  info("请前往 Replit 左侧 Tools → Integrations → 启用 Anthropic");
  hasError = true;
}

console.log();

// ─── 2. 自定义 Secrets ────────────────────────────────────────────────────────
console.log(`${BOLD}[2] Secrets（环境变量）${RESET}`);

const proxyKey     = process.env.PROXY_API_KEY;
const sessionSecret = process.env.SESSION_SECRET;

if (proxyKey && proxyKey.length >= 8) {
  ok(`PROXY_API_KEY 已设置（长度 ${proxyKey.length} 位）`);
} else if (proxyKey) {
  warn(`PROXY_API_KEY 已设置，但长度较短（${proxyKey.length} 位），建议 16 位以上`);
  hasWarn = true;
} else {
  fail("PROXY_API_KEY 未设置！");
  info("请前往 Replit 左侧 Tools → Secrets → 添加 PROXY_API_KEY");
  info("值为你自定义的 Bearer Token，例如: my-secret-key-2024");
  hasError = true;
}

if (sessionSecret && sessionSecret.length >= 8) {
  ok(`SESSION_SECRET 已设置（长度 ${sessionSecret.length} 位）`);
} else if (sessionSecret) {
  warn(`SESSION_SECRET 已设置，但长度较短，建议 16 位以上`);
  hasWarn = true;
} else {
  warn("SESSION_SECRET 未设置（可选，但建议配置）");
  info("请前往 Replit 左侧 Tools → Secrets → 添加 SESSION_SECRET");
  info("值为任意随机字符串，例如: random-session-secret-xyz");
  hasWarn = true;
}

console.log();

// ─── 3. Modelfarm 连通性测试 ──────────────────────────────────────────────────
console.log(`${BOLD}[3] Modelfarm 连通性测试${RESET}`);

if (oaBase && oaKey) {
  try {
    // 快速测试 OpenAI modelfarm 是否响应
    const testBody = JSON.stringify({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "hi" }],
      max_completion_tokens: 3,
    });
    const res = await fetch(`${oaBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${oaKey}`,
        "Content-Type": "application/json",
      },
      body: testBody,
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok || res.status === 400) {
      // 400 也说明连通了（参数问题），200 是成功
      const json = await res.json().catch(() => ({}));
      if (json.error?.code === "INVALID_ENDPOINT") {
        fail(`OpenAI modelfarm 路径错误: ${oaBase}/chat/completions`);
        hasError = true;
      } else if (json.choices || json.error) {
        ok(`OpenAI modelfarm 连通 → ${res.status}`);
      } else {
        ok(`OpenAI modelfarm 响应 → HTTP ${res.status}`);
      }
    } else {
      warn(`OpenAI modelfarm 响应 HTTP ${res.status}，请检查 Integration 是否已启用`);
      hasWarn = true;
    }
  } catch (e) {
    if (e.name === "TimeoutError") {
      fail("OpenAI modelfarm 连接超时（10s）");
    } else {
      fail(`OpenAI modelfarm 连接失败: ${e.message}`);
    }
    info("确认 Replit OpenAI Integration 已启用且容器正在运行");
    hasError = true;
  }
} else {
  warn("跳过 OpenAI modelfarm 测试（Integration 未配置）");
}

if (anBase && anKey) {
  try {
    const testBody = JSON.stringify({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 3,
    });
    const res = await fetch(`${anBase}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": anKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: testBody,
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok || res.status === 400) {
      const json = await res.json().catch(() => ({}));
      if (json.content || json.type === "message") {
        ok(`Anthropic modelfarm 连通并响应成功`);
      } else if (json.error) {
        ok(`Anthropic modelfarm 连通 → ${json.error.type ?? "响应正常"}`);
      } else {
        ok(`Anthropic modelfarm 响应 → HTTP ${res.status}`);
      }
    } else {
      warn(`Anthropic modelfarm 响应 HTTP ${res.status}，请检查 Integration 是否已启用`);
      hasWarn = true;
    }
  } catch (e) {
    if (e.name === "TimeoutError") {
      fail("Anthropic modelfarm 连接超时（10s）");
    } else {
      fail(`Anthropic modelfarm 连接失败: ${e.message}`);
    }
    info("确认 Replit Anthropic Integration 已启用且容器正在运行");
    hasError = true;
  }
} else {
  warn("跳过 Anthropic modelfarm 测试（Integration 未配置）");
}

console.log();

// ─── 4. 本地代理健康检查 ──────────────────────────────────────────────────────
console.log(`${BOLD}[4] 本地代理健康检查（需要先启动 API Server 工作流）${RESET}`);

const port = process.env.PORT ?? "8080";
try {
  const res = await fetch(`http://localhost:${port}/api/healthz`, {
    signal: AbortSignal.timeout(5000),
  });
  if (res.ok) {
    const json = await res.json().catch(() => ({}));
    ok(`API Server 健康检查通过 → ${JSON.stringify(json)}`);
  } else {
    warn(`API Server 响应 HTTP ${res.status}，可能未完全启动`);
    hasWarn = true;
  }
} catch {
  warn("API Server 未响应（如果工作流未启动，属正常）");
  info("请先在工作流面板启动 'API Server'，然后重新运行此脚本");
  hasWarn = true;
}

console.log();

// ─── 结果汇总 ──────────────────────────────────────────────────────────────────
console.log(`${BOLD}═══════════════════ 检查结果 ═══════════════════${RESET}`);
if (hasError) {
  console.log(`${RED}${BOLD}  ✗ 存在必须修复的配置错误，服务无法正常运行${RESET}`);
  console.log(`${YELLOW}  → 参考上方提示完成配置后，重新运行: node scripts/check-setup.mjs${RESET}`);
  console.log(`${CYAN}  → 完整迁移指南: docs/REBUILD_GUIDE.md${RESET}`);
} else if (hasWarn) {
  console.log(`${YELLOW}${BOLD}  ⚠ 配置基本就绪，有部分警告项建议处理${RESET}`);
  console.log(`${CYAN}  → 完整迁移指南: docs/REBUILD_GUIDE.md${RESET}`);
} else {
  console.log(`${GREEN}${BOLD}  ✓ 所有配置检查通过！可以启动并发布了。${RESET}`);
  console.log();
  console.log(`  下一步: 在 Replit 工作流面板启动服务，然后点击 Publish 发布`);
}
console.log();
