# Contributing

## Development Setup

```bash
git clone https://github.com/zaferdace/roblox-workflow-mcp.git
cd roblox-workflow-mcp
npm install
npm run build
```

## Type Check

```bash
npx tsc --noEmit
```

## Full Quality Check

```bash
npm run check
```

## Pull Request Process

1. Fork the repo and create a branch from `main`
   - `feat/` for new features
   - `fix/` for bug fixes
2. Make your changes
3. Ensure `npm run check` passes (build + typecheck + lint + format + publint)
4. Open a PR against `main`

## Code Style

- TypeScript strict mode — no `any`, use `unknown`
- Minimal comments — only where logic isn't self-evident
- Small, focused functions
- All imports use `.js` extension (ESM with Node16 resolution)
- Self-registering tool pattern: write tool file, call `registerTool()` at bottom, add import to `register-all.ts`
