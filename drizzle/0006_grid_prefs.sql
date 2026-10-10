-- Grid preferences move from per-device localStorage to the garden row so
-- bounds + outside color sync across devices. grid_w/h = 0 means auto-size
-- (plots bbox + 5 ft, computed client-side).
ALTER TABLE garden ADD COLUMN grid_w INTEGER NOT NULL DEFAULT 0;
--> nudge
ALTER TABLE garden ADD COLUMN grid_h INTEGER NOT NULL DEFAULT 0;
--> nudge
ALTER TABLE garden ADD COLUMN outside_color TEXT NOT NULL DEFAULT '#d8e3c8';
