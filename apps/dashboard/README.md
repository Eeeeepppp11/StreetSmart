# apps/dashboard — Public scorecard site (Next.js)

**Phase 4.** The public accountability surface: repair-time scorecards by
district and the anonymised road-risk snapshot, rendered by the **real
aggregation engine** (`@potholeproof/analytics`) — currently over a labelled
demo dataset (`app/demo-data.ts`) until the live backend is connected.

- Server-rendered (App Router, no client JS beyond the Next runtime).
- `buildScorecard` + `buildRouteRiskExport` run at build/request time, so the
  page exercises the same code paths that will serve live data.

## Develop

```bash
# from repo root: build the analytics engine first (dashboard imports its dist)
node node_modules/typescript/bin/tsc -p services/analytics/tsconfig.json
# then, in apps/dashboard:
corepack pnpm@9.12.0 exec next dev     # local dev server
corepack pnpm@9.12.0 exec next build   # production build (also type-checks)
```

Swapping demo data for live data = replacing the imports in `app/page.tsx`
with a fetch from `services/analytics`' HTTP layer once it exists.
