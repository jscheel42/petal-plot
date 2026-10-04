# 🌱 Pixel Plot

A hobby garden-management web app: sketch your garden on a 2D grid, track what's
planted where, get crop-rotation warnings, and replay any past date with a slider.

**Stack:** SvelteKit 3 (Svelte 5 runes, TS) · Tailwind v4 · Drizzle ORM · SQLite (better-sqlite3) · adapter-node · Docker · Google Cloud Run + Litestream→GCS.

## Run locally (dev)

```bash
npm install
npm run dev          # http://localhost:5173
```

The SQLite database lives at `.data/pixel.db` (override with `PIXEL_DB=/path/to.db`).
Migrations in `drizzle/` and the 45-plant catalog seed are applied automatically on first DB access.

## Tests

```bash
npm test             # vitest: rotation logic + full API lifecycle
npm run check        # svelte-check types
```

## Run with Docker

```bash
docker compose up --build   # http://localhost:3000
```

Data persists in the `pixel-data` named volume (`/data/pixel.db` in the container).
Restart the container and your garden survives.

## Canvas controls

| Action | Input |
| --- | --- |
| Pan | scroll / trackpad swipe / space+drag |
| Zoom | ⌘/Ctrl + scroll (pinch) |
| Create plot | drag on empty grid |
| Open panel | click a plot |
| Move / resize | drag plot body / corner handles |
| Replay | 🕰️ slider in the header |

## Deploy (Cloud Run)

One container, SQLite on a volume replicated to Cloud Storage via a Litestream
sidecar, `--max-instances=1` (Litestream is single-writer; traffic is negligible
for a hobby app). See `PLAN.md` for the full rationale and the exact deploy
commands in `deploy/`.

## Layout

```
src/lib/server/    schema.ts · db.ts · seed.ts · rotation.ts
src/routes/api/    gardens · plots · plantings · plants catalog
src/lib/components/ Canvas.svelte · DetailPanel.svelte
drizzle/           generated SQL migrations
```
