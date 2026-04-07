# Architecture Design

## System Overview

AI Gateway Platform — 聚合代理网关，统一管理多个 AI 模型提供商（OpenAI, Anthropic）的 API 访问。

## Components

### API Server (`artifacts/api-server`)
- Express 5 + ESM + TypeScript
- Protocol translation: OpenAI ↔ Anthropic format
- SSE streaming proxy (byte passthrough)
- Pino structured logging (redact auth headers)

### API Portal (`artifacts/api-portal`)
- React 19 + Vite 7
- Radix UI / shadcn component library
- TanStack React Query for data fetching
- Tailwind CSS 4

### Shared Libraries
- `lib/api-zod` — Zod validation schemas (cross-package)
- `lib/api-spec` — OpenAPI spec, orval codegen
- `lib/api-client-react` — React Query hooks
- `lib/db` — Drizzle ORM, PostgreSQL

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Module system | ESM | Modern, tree-shakeable |
| Monorepo tool | pnpm workspaces | Fast, strict, catalog support |
| ORM | Drizzle | Type-safe, lightweight |
| UI framework | Radix + shadcn | Accessible, composable |
| Supply chain | minimumReleaseAge: 1440 | 24h delay prevents supply-chain attacks |

## Testing Strategy

| Layer | Tool | Scope |
|-------|------|-------|
| Unit | Vitest | Business logic, utilities |
| Type | tsc --noEmit | All packages |
| Format | Prettier | All files |
| E2E/UI | Chrome DevTools MCP | Portal smoke tests |
