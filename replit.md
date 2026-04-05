# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Artifacts

### API Server (`artifacts/api-server`)
Express 5 server serving:
- `/api` — core REST API (health check, etc.)
- `/v1` — OpenAI + Anthropic dual-compatible proxy
  - `GET /v1/models` — list all models (requires Bearer token)
  - `POST /v1/chat/completions` — OpenAI-format completions (routes claude-* to Anthropic, gpt-*/o* to OpenAI)
  - `POST /v1/messages` — Anthropic Messages native format (routes OpenAI models automatically)

Auth: `Authorization: Bearer $PROXY_API_KEY`

AI backends via Replit AI Integrations (no user API key needed):
- OpenAI: `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY`
- Anthropic: `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` + `AI_INTEGRATIONS_ANTHROPIC_API_KEY`

Key packages: `openai@^6`, `@anthropic-ai/sdk@^0.82`

### API Portal (`artifacts/api-portal`)
React + Vite frontend portal at `/` showing connection details, endpoints, models, CherryStudio setup guide, and curl examples.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
