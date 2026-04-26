#!/bin/bash
set -e

# 1. 安装依赖
pnpm install --frozen-lockfile

# 2. 推送数据库 schema（若 lib/db 已配置）
pnpm --filter db push || true

# 3. 自动生成 SESSION_SECRET 占位（仅本进程可见；Secrets 仍需在 Replit 平台写入，
#    迁移提示词会让 AI 自动调用 setEnvVars 持久化）
if [ -z "$SESSION_SECRET" ]; then
  export SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo "[post-merge] 已为本次会话生成临时 SESSION_SECRET（持久化请由 AI 写入 Secrets）"
fi
