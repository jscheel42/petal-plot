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

## Sign-in (Cloudflare Access) — anonymous read-only, owner writes

Anonymous visitors GET everything (read-only). Writes (`POST/PATCH/DELETE`) require
Cloudflare Access: the edge enforces it, and `src/hooks.server.ts` re-validates the
injected `Cf-Access-Jwt-Assertion` JWT (RS256, aud, exp) so writes fail closed if the
Access app is ever removed while the secrets remain set. Dev has no secrets → writes open.

One-time setup:

1. **Zero Trust → Access → Applications → Add → Self-hosted.** Destination
   `petal-plot.joshuascheel.com`. The wizard has no method checkboxes (they are
   API-only now) — leave defaults and finish; step 2 trims the methods.
2. **Policy** (inside the wizard): Action **Allow** · add identity rule
   `emails` equals `jscheel42@gmail.com` · Login method: One-time PIN
   (add Google IdP for the button).
3. **Trim allowed actions to writes** (anonymous GETs must pass the edge):
   create a Custom API token (My Profile → API Tokens → Create Token →
   Account → `Access: Apps and Policies` → `Edit`), then
   `CLOUDFLARE_API_TOKEN=<token> node scripts/configure-access.mjs`
   — sets `allowed_actions: POST,PATCH,DELETE` and prints the app's AUD tag.
   ⚠️ Until this runs, anonymous visitors can't even read (app covers GET too).
4. `npx wrangler secret put ACCESS_AUD` (AUD tag from step 3) +
   `npx wrangler secret put ACCESS_TEAM` (Zero Trust subdomain), then redeploy.

UX: a blocked write shows the 🔒 "Sign in to edit" banner; its button POSTs a hidden
form to `/api/auth/sign-in`, Access runs the login, the handler bounces back to `/`.


## Canvas controls

| Action | Input |
| --- | --- |
| Pan | trackpad side-swipe / space+drag · touch: 1-finger drag |
| Zoom | scroll (at cursor) · touch: pinch (at midpoint) · ＋/− buttons · `+` `−` keys |
| Fit / center | ⛶ button (`0`) · ◎ selected plot (`c`) |
| Create plot | drag on empty grid |
| Open panel | click/tap a plot |
| Move / resize | drag plot body / corner handles |
| Reposition plantings | select plot → drag its dashed band (whole-feet snap; server validates bounds + band overlap) |
| Edit / remove planting history | ✏️ any row in the DetailPanel — change plant, qty, planted/harvest dates (empty harvest = reactivates), or delete the record |
| Varieties | catalog is Family → Plant → Variety (e.g. Ericaceae → Blueberry → 'Sunshrine'); the plant picker groups by family and variety text is searchable |
| Edit properties | right-click (touch: long-press) a plot → popover (name, type, size, notes, delete) |
| Replay | 🕰️ slider in the header |
| North | compass rose, top-left (garden north = up) |
| Labels | 🏷️ button or `l` key toggles `Name · W×Hft` labels — **off by default**, choice persisted; ⚠️ warnings always shown |
| View memory | pan/zoom auto-saved per garden; reload restores it. First visit fits all plots |

## Layout

```
src/lib/server/    schema.ts · db.ts · rotation.ts · layout.ts · access.ts · test-db.ts
src/routes/api/    gardens · plots · plantings · plants catalog · auth/sign-in
src/lib/components/ Canvas.svelte · DetailPanel.svelte · PlotEditor.svelte
src/hooks.server.ts Access JWT gate (writes only)
drizzle/           SQL migrations (0000 schema … 0005 seeds) — applied by wrangler
scripts/           one-off SQL (Cloud Run data port)
wrangler.jsonc     worker + D1 binding + assets config
```
