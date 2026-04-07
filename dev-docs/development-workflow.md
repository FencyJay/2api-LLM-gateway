# Development Workflow

## Small-Step Cycle

每次只做一个功能。小步快跑，快速反馈。

```
┌─────────────────────────────────────────────┐
│  1. ALIGN    — 从 progress.md 选一个功能      │
│  2. DEVELOP  — 编写代码                       │
│  3. TEST     — 编写并运行测试（必须）           │
│  4. VERIFY   — 全通过? → 6. 失败? → 5        │
│  5. FIX+RULE — 修复 + 如果是 AI 惯性错误加规则  │
│  6. TYPECHECK — pnpm run typecheck           │
│  7. UI TEST  — 前端变更必须视觉验证            │
│  8. COMMIT   — git commit                    │
│  9. NEXT     — 回到步骤 1                     │
└─────────────────────────────────────────────┘
```

## Branch Convention

- `feature/<name>` — 新功能
- `fix/<name>` — 修复
- `refactor/<name>` — 重构

## Commit Message Format

```
<type>: <description>

type: feat | fix | refactor | docs | test | chore
```

## Harness Lifecycle Triggers

1. **测试失败模式** — 修复后如果是 AI 惯性错误，添加 LEARNED RULE
2. **优先级阶段完成** — 运行 harness-health 审计
3. **发布前** — 完整 harness 审计
4. **新域引入** — 在 context-guard.sh 添加新模式
5. **会话开始** — 读取 harness-changelog 最近 5 条
