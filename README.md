# 🌱 Petal Plot

A hobby garden-management web app: sketch your garden on a 2D grid, track what's
planted where, get crop-rotation warnings, and replay any past date with a slider.

**Stack:** SvelteKit 3 (Svelte 5 runes, TS) · Tailwind v4 · Drizzle ORM · Cloudflare D1 (serverless SQLite) · Cloudflare Workers.

**Live:** https://petal-plot.joshuascheel.com (custom domain bound to the `petal-plot` worker; workers.dev mirror also serves)

## Run locally (dev)

```bash
npm install
npm run db:migrate   # apply migrations + plant-catalog seed to local D1
npm run dev          # http://localhost:5173
```

`npm run dev` serves SSR through a wrangler **platform proxy**: the same
`cloudflare:workers` `env.DB` binding the production worker uses, backed by a
local D1 database persisted in `.wrangler/state/`. No Cloudflare account or
network access needed to develop.

## Tests

```bash
npm test             # vitest: rotation logic + full API lifecycle (ephemeral D1)
npm run check        # svelte-check types
```

Tests boot wrangler's platform proxy with an ephemeral D1 and run the real
migrations + seed, so they exercise the same SQL as production.

## Deploy (Cloudflare Workers + D1)

One-time setup: `npx wrangler login` + `npx wrangler d1 create petal-plot` (paste the
returned `database_id` into `wrangler.jsonc`) + bind the custom domain in the dashboard
(Workers & Pages → petal-plot → Settings → Domains & routes — API cannot bind hostnames).

### Preview → production workflow (Workers Versions)

```bash
npm run deploy:preview    # vite build && wrangler versions upload
# → prints https://<hash>-petal-plot.pixel-plot.workers.dev — test there;
#   production (petal-plot.joshuascheel.com + workers.dev) keeps serving the old version
npm run deploy:promote    # wrangler versions deploy — interactive picker, or non-interactive:
#   npx wrangler versions deploy "<version-id>@100" -y   (note: @, not =)
#   canary: npx wrangler versions deploy "<old>@90" "<new>@10" then @100
npm run rollback          # wrangler rollback — instant revert to previous deployment
npm run deploy            # legacy shortcut: build + straight to production (skips preview)
```

Caveats:
- Preview versions run against the **production D1** (same binding). Fine for code/UI
  changes; for schema changes run migrations locally + `npm test` first, apply
  `db:migrate:remote` immediately before promote. D1 Time Travel (7-day PITR) is the escape hatch.
- `versions upload` does **not** change triggers; custom-domain/route changes need
  `wrangler triggers deploy`.

Free tier covers this comfortably (Workers: 100k requests/day; D1: 5M reads +
100k writes/day, 5 GB). Data is durable across restarts with 7-day point-in-time
restore (30 days on Workers Paid) — no backup sidecar to babysit.

## Canvas controls

| Action | Input |
| --- | --- |
| Pan | trackpad side-swipe / space+drag |
| Zoom | scroll or pinch (at cursor) · ＋/− buttons · `+` `−` keys |
| Fit / center | ⛶ button (`0`) · ◎ selected plot (`c`) |
| Create plot | drag on empty grid |
| Open panel | click a plot |
| Move / resize | drag plot body / corner handles |
| Reposition plantings | select plot → drag its dashed band (whole-feet snap; server validates bounds + band overlap) |
| Edit properties | right-click a plot → popover (name, type, size, notes, delete) |
| Replay | 🕰️ slider in the header |
| North | compass rose, top-left (garden north = up) |
| Labels | 🏷️ button or `l` key toggles `Name · W×Hft` labels — **off by default**, choice persisted; ⚠️ warnings always shown |
| View memory | pan/zoom auto-saved per garden; reload restores it. First visit fits all plots |

## Layout

```
src/lib/server/    schema.ts · db.ts · rotation.ts · layout.ts · test-db.ts
src/routes/api/    gardens · plots · plantings · plants catalog
src/lib/components/ Canvas.svelte · DetailPanel.svelte
drizzle/           SQL migrations (0000 schema, 0001 seed, 0002 planting position) — applied by wrangler
scripts/           one-off SQL (Cloud Run data port)
wrangler.jsonc     worker + D1 binding + assets config
```
