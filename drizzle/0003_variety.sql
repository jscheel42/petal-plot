-- Varieties: plant rows are now (name, variety) — e.g. Blueberry 'Sunshrine'.
ALTER TABLE `plant` ADD COLUMN `variety` text NOT NULL DEFAULT '';--> statement-breakpoint
DROP INDEX IF EXISTS `plant_name_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `plant_name_variety_idx` ON `plant` (`name`, `variety`);--> statement-breakpoint
INSERT OR IGNORE INTO `plant` (`name`, `variety`, `family`, `emoji`, `spacing`, `sun`) VALUES
('Blueberry', 'Sunshrine', 'Ericaceae', '🫐', 3, 'full');
