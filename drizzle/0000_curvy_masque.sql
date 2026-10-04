CREATE TABLE `garden` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (date('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plant` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`family` text NOT NULL,
	`emoji` text NOT NULL,
	`spacing` real NOT NULL,
	`sun` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plant_name_idx` ON `plant` (`name`);--> statement-breakpoint
CREATE TABLE `planting` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plot_id` integer NOT NULL,
	`plant_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`planted_on` text NOT NULL,
	`ended_on` text,
	`notes` text,
	FOREIGN KEY (`plot_id`) REFERENCES `plot`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plant_id`) REFERENCES `plant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `planting_plot_idx` ON `planting` (`plot_id`);--> statement-breakpoint
CREATE TABLE `plot` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`garden_id` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`w` integer NOT NULL,
	`h` integer NOT NULL,
	`notes` text,
	FOREIGN KEY (`garden_id`) REFERENCES `garden`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plot_garden_idx` ON `plot` (`garden_id`);