# Repository Guidelines

## Project Overview

**Petal Plot** — hobby garden manager: sketch plots on a pan/zoom 2D canvas, track plantings per bed, crop-rotation warnings, date-slider history replay. Live at https://petal-plot.joshuascheel.com (custom domain + workers.dev mirror). Single-user; anonymous visitors are read-only, owner unlocks writes with a shared password.

Stack: SvelteKit 3 (Svelte 5 runes, TS strict) · Tailwind v4 · Drizzle ORM · Cloudflare D1 · Workers (`adapter-cloudflare`). Node ESM (`"type": "module"`), npm.

## Architecture & Data Flow

```
browser (+page.svelte, Canvas/DetailPanel/PlotEditor)
  → src/lib/api.ts  api<T>(path, init)          # fetch wrapper, JSON in/out
  → src/hooks.server.ts                           # write gate: non-GET needs pp_admin cookie
  → src/routes/api/**/+server.ts                 # RequestHandlers, validation here
  → src/lib/server/db.ts  getDb() → drizzle(env.DB)
  → Cloudflare D1 (binding "DB")
```

- **Env access is always `import { env } from 'cloudflare:workers'`** (`env.DB`, `env.ADMIN_PASSWORD`). `event.platform` is NOT populated by this adapter setup — never read secrets/bindings off it.
- **Auth**: `hooks.server.ts` rejects every non-GET (except `/api/auth/*`) without a valid `pp_admin` cookie (`exp.hmac` from `src/lib/server/auth.ts`, verified constant-time, 12 h TTL). Password checked against `ADMIN_PASSWORD` secret in `POST /api/auth/session`. No secret set (dev) → writes open.
- Client 401/403 on a write → `api()` dispatches `window` event `'ppsignin'` → `+page.svelte` opens the password modal. Custom events: no colons (parse as Svelte modifiers); listen via `$effect` + `addEventListener`, not `svelte:window` attrs.
- **Dates**: clients send LOCAL calendar dates (`isoDaysAgo` formats from local components — never `toISOString()`); server clock is UTC. `planting.ended_on` is the harvest day and EXCLUSIVE (row absent from `asof=endedOn`).
- **History is immutable-ish**: harvest sets `ended_on`; planting rows are edited/deleted only via the explicit data-fix endpoints.
- Rotation: `rotation.ts` warns when a plot repeats a plant `family` in consecutive years; `layout.ts` computes footprints/overlap/auto-place (grid unit = 1 ft).

## Key Directories

| Path | Purpose |
| --- | --- |
| `src/routes/` | `+page.svelte` (whole app), `+layout.svelte` (garden switcher), `api/**` endpoints |
| `src/lib/components/` | `Canvas.svelte` (renderer + all pointer interaction), `DetailPanel.svelte`, `PlotEditor.svelte` |
| `src/lib/server/` | `schema.ts` (Drizzle), `db.ts`, `auth.ts`, `rotation.ts`, `layout.ts`, `test-db.ts` (test harness), `cloudflare-workers.d.ts` (ambient env types — add new bindings here) |
| `src/lib/` | `api.ts` (fetch wrapper), `state.svelte.js` (runes store: gardens/currentGardenId/daysAgo), `index.ts` |
| `drizzle/` | SQL migrations 0000–0005, applied alphabetically by wrangler |
| `scripts/` | one-off SQL (`port-cloud-run.sql`) — NEVER put one-offs in `drizzle/`; wrangler applies every `.sql` there |

## Development Commands

```bash
npm run dev               # vite dev @ localhost:5173, local D1 persisted in .wrangler/state
npm test                # vitest run (boots EPHEMERAL platform-proxy D1, applies drizzle/*.sql)
npm run check           # svelte-kit sync + svelte-check (baseline: 0 errors / 706 files)
npx vitest run src/routes/api/lifecycle.test.ts   # single file
npm run db:migrate          # apply migrations to LOCAL D1
npm run db:migrate:remote   # apply to production D1 — run right before promote
npm run deploy:preview     # vite build && wrangler versions upload → prints version id
npx wrangler versions deploy "<version-id>@100" -y   # promote (@, not =)
npm run rollback          # instant revert to previous deployment
```

Deploy gotchas (all burned once already):
- `versions upload` does NOT pick up `wrangler secret put` — secrets attach per-version. Changing a secret: `echo -n '<val>' | npx wrangler versions secret put ADMIN_PASSWORD` → prints a NEW version id → deploy THAT `@100`. Verify gate after: anonymous `POST /api/gardens/1/plots` must return 401.
- Preview versions hit **production D1**. Schema changes: migrate local + `npm test`, then `db:migrate:remote` immediately before promote.
- Seed-only changes (new `drizzle/000N_*.sql` applied to remote) need no worker redeploy — catalog is read from D1 at request time.
- `npm run test:e2e` exists but Playwright is not installed and there is no config — verify UI via throwaway Playwright scripts or the browser tool instead.
- Custom-domain/route changes are dashboard-only (API token can't bind hostnames).

## Code Conventions & Common Patterns

- **Svelte 5 runes only**: `$state`, `$derived`, `$derived.by`, `$effect`, `$props`. No `export let`, no stores. Shared client state lives in `state.svelte.js` (`$state` object exported as `store`).
- **Imports**: `#lib/*` alias everywhere (package.json `imports` + tsconfig `paths`) — never relative `../../`. Kit 3: `Handle` type comes from **`@sveltejs/kit/hooks`**, not `@sveltejs/kit`.
- **TS strict**: no `any` escapes. Narrow unknown JSON with `in`/`typeof` (`body && typeof body === 'object' && 'error' in body`), never inline `<Type>` casts on member access. No explicit return types on functions (inferred). Avoid tiny one-liner helpers with ≤2 call sites — inline unless the name clarifies a non-obvious transform. Prefer `Map`/`Set` over object-as-dict.
- **API errors**: endpoints return `{ error: string }` + proper status; `api()` throws `Error(msg)`; UI catches and shows toast/alert. Validation lives server-side (overlap, bounds, dates) — client validates optimistically but server is authority.
- **localStorage keys**: `petalPlot.*` camelCase (`petalPlot.gardenId`, `petalPlot.showLabels`); guard `typeof localStorage` for SSR; persistence best-effort.
- **Server route shape**: `export const GET: RequestHandler = async ({ params, request, url, cookies }) => Response.json(...)`. Partial PATCHes. Overlap conflicts → 409 with human message.
- Catalog identity: `plant.name` + `plant.variety` (NOT NULL DEFAULT `''` — SQLite unique treats NULLs distinct; `''` preserves uniqueness of plain names), unique index `(name, variety)`. Hierarchy is Family > Plant > Variety, flat in one table.

## Important Files

- `src/hooks.server.ts` — the write gate (security boundary; keep fail-closed).
- `src/lib/server/auth.ts` — HMAC cookie mint/verify + `passwordMatches`; tests in `auth.test.ts`.
- `src/routes/api/auth/session/+server.ts` — GET status / POST login / DELETE logout.
- `src/routes/+page.svelte` — app shell: picker, sign-in chip/modal, banner, event wiring.
- `src/lib/server/cloudflare-workers.d.ts` — ambient `env` type; new secrets/bindings MUST be declared here or `npm run check` fails.
- `wrangler.jsonc` — worker `petal-plot`, D1 binding `DB` (id `2af86df6-e267-41e5-8d80-10ce8e233dcc`), assets binding `ASSETS`.
- `vitest.config.ts` — aliases `cloudflare:workers` → `src/lib/server/test-db.ts`.
- `README.md` — user-facing docs incl. the password/secret workflow; keep in sync.
- `PLAN.md` — historical decisions; phases 0–6 done, don't re-litigate stack choices.

## Runtime/Tooling Preferences

- **npm** (package-lock.json), ESM only. Node ≥ 20 era tooling; wrangler 4.147, vite 8, TS 6, vitest 5.
- No ESLint/Prettier config in repo — formatting is tabs + `npm run check` clean; match surrounding style.
- Auth to Cloudflare via `npx wrangler login` OAuth (account `a6c04dd5ad7cd6d21e455b45302109fb`, scope `account(read)` — dashboard needed for app/domain management).
- Git: `master` on `github.com:jscheel42/petal-plot` (repo dir is `pixel-plot` — remote name differs, that's intentional).

## Testing & QA

- **vitest** (`environment: node`), `src/**/*.test.ts`: `lifecycle.test.ts` (full API integration) + `rotation.test.ts` + `auth.test.ts`. Baseline **38/38** — keep green.
- Harness: `await testDb()` (top-level, before any route call) boots an ephemeral platform-proxy D1 and applies every `drizzle/*.sql` in filename order; harness state on `globalThis[Symbol.for('petal-plot:test-db')]`.
- Route testing pattern: import handlers, call through fake event via local `call()` helper — `call<T>(handler as Handler, { params, method, body, query })` → `{ status, json }`.
- New migrations: just add `drizzle/000N_*.sql` — the harness applies it automatically; split multi-statement files on `;` at line end (proxy execs one statement at a time).
- Before any merge/promote: `npm test` + `npm run check` both clean; UI changes get a browser smoke against `npm run dev` or the preview URL.
