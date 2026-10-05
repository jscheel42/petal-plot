-- One-time data port from the retired Cloud Run + Litestream deployment
-- (dumped via its public API on 2026-10-04). Explicit ids preserve identity;
-- plant ids already match the seed catalog. Applied manually, NOT part of
-- `d1 migrations apply`:
--   npx wrangler d1 execute petal-plot --remote --file=scripts/port-cloud-run.sql
INSERT OR IGNORE INTO garden (id, name) VALUES (1, 'Cloud Garden');
INSERT OR IGNORE INTO plot (id, garden_id, name, type, x, y, w, h, notes)
	VALUES (1, 1, 'Bed 1', 'raised_bed', 0, 0, 4, 8, NULL);
INSERT OR IGNORE INTO planting (id, plot_id, plant_id, quantity, planted_on, ended_on, notes)
	VALUES (1, 1, 1, 6, '2026-10-03', NULL, NULL);
