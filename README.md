# 🌱 Pixel Plot

A hobby garden-management web app: sketch your garden on a 2D grid, track what's
planted where, get crop-rotation warnings, and replay any past date with a slider.

**Stack:** SvelteKit 3 (Svelte 5 runes, TS) · Tailwind v4 · Drizzle ORM · Cloudflare D1 (serverless SQLite) · Cloudflare Workers.

**Live:** https://pixel-plot.pixel-plot.workers.dev

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

```bash
npx wrangler login
npx wrangler d1 create pixel-plot        # paste the returned database_id into wrangler.jsonc
npm run db:migrate:remote
npm run deploy                           # vite build && wrangler deploy
```

Free tier covers this comfortably (Workers: 100k requests/day; D1: 5M reads +
100k writes/day, 5 GB). Data is durable across restarts with 7-day point-in-time
restore (30 days on Workers Paid) — no backup sidecar to babysit.

## Canvas controls

| Action | Input |
| --- | --- |
| Pan | scroll / trackpad swipe / space+drag |
| Zoom | ⌘/Ctrl + scroll (pinch) |
| Create plot | drag on empty grid |
| Open panel | click a plot |
| Move / resize | drag plot body / corner handles |
| Replay | 🕰️ slider in the header |

## Layout

```
src/lib/server/    schema.ts · db.ts · rotation.ts · test-db.ts
src/routes/api/    gardens · plots · plantings · plants catalog
src/lib/components/ Canvas.svelte · DetailPanel.svelte
drizzle/           SQL migrations (0000 schema, 0001 seed) — applied by wrangler
scripts/           one-off SQL (Cloud Run data port)
wrangler.jsonc     worker + D1 binding + assets config
```
