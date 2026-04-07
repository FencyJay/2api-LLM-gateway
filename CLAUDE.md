# Pnpm-Monorepo — AI Gateway Platform

Monorepo for an AI model gateway that proxies OpenAI/Anthropic APIs, with React admin portals.

## Structure

```
artifacts/api-server     — Express 5 API gateway (proxy, auth, logging)
artifacts/api-portal     — React admin portal (Vite + Radix/shadcn)
artifacts/mockup-sandbox — UI prototyping sandbox
lib/api-zod              — Shared Zod schemas
lib/api-spec             — OpenAPI spec + orval codegen
lib/api-client-react     — React Query API client
lib/db                   — Drizzle ORM (PostgreSQL)
scripts/                 — Dev scripts
```

## Conventions

- **Package runner**: `pnpm` (enforced by preinstall)
- **Module system**: ESM (`"type": "module"`)
- **TypeScript**: ~5.9, strict null checks, `bundler` module resolution
- **Node target**: ES2022
- **Formatter**: Prettier (`pnpm exec prettier --write`)

## Key Commands

```bash
pnpm run typecheck              # Full workspace typecheck
pnpm run build                  # Typecheck + build all packages
pnpm --filter @workspace/api-server run dev      # Start API server
pnpm --filter @workspace/api-portal run dev      # Start admin portal
pnpm exec prettier --write "path"                # Format file
```

## Architecture Rules

1. **Shared schemas via lib/api-zod** — Never duplicate Zod schemas across packages
2. **No console.log in api-server** — Use pino structured logger
3. **No secrets in code** — Use environment variables, never hardcode API keys
4. **Streaming fidelity** — Proxy must byte-passthrough SSE, never parse content
5. **Workspace protocol** — Inter-package deps use `workspace:*`

## Development Workflow (Small-Step Cycle)

```
1. ALIGN   — Pick one feature, confirm scope
2. DEVELOP — Write code (context-guard injects domain rules)
3. TEST    — Write + run tests (mandatory)
4. VERIFY  — All tests pass? → step 6. Fail? → step 5
5. FIX     — Fix bug. If AI habitual error → add LEARNED RULE
6. TYPECHECK — pnpm run typecheck
7. UI TEST — If frontend change: snapshot + screenshot + console check
8. COMMIT  — git commit (pre-commit-guard validates)
9. NEXT    — Back to step 1
```

## Before Commit Checklist

- [ ] `pnpm run typecheck` passes
- [ ] Tests pass for changed packages
- [ ] No `console.log` in server code
- [ ] No hardcoded secrets
- [ ] Prettier formatted

## Dev Docs

See `dev-docs/` for architecture design, progress tracking, and harness changelog.
