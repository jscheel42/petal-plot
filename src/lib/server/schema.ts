import { sqliteTable, integer, text, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const garden = sqliteTable('garden', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	// Grid bounds in feet; 0 = auto (plots bbox + 5 ft, client-computed).
	gridW: integer('grid_w').notNull().default(0),
	gridH: integer('grid_h').notNull().default(0),
	outsideColor: text('outside_color').notNull().default('#d8e3c8'),
	createdAt: text('created_at')
		.notNull()
		.default(sql`(date('now'))`)
});

export const plot = sqliteTable(
	'plot',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		gardenId: integer('garden_id')
			.notNull()
			.references(() => garden.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		type: text('type', { enum: ['in_ground', 'raised_bed', 'container'] }).notNull(),
		x: integer('x').notNull(),
		y: integer('y').notNull(),
		w: integer('w').notNull(),
		h: integer('h').notNull(),
		notes: text('notes')
	},
	(t) => [index('plot_garden_idx').on(t.gardenId)]
);

export const plant = sqliteTable(
	'plant',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull(),
		variety: text('variety').notNull().default(''),
		family: text('family').notNull(),
		emoji: text('emoji').notNull(),
		spacing: real('spacing').notNull(),
		sun: text('sun', { enum: ['full', 'partial', 'shade'] }).notNull()
	},
	(t) => [uniqueIndex('plant_name_variety_idx').on(t.name, t.variety)]
);

export const planting = sqliteTable(
	'planting',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		plotId: integer('plot_id')
			.notNull()
			.references(() => plot.id, { onDelete: 'cascade' }),
		plantId: integer('plant_id')
			.notNull()
			.references(() => plant.id, { onDelete: 'cascade' }),
		quantity: integer('quantity').notNull(),
		// Position within plot, whole feet from plot origin; null = auto-stack.
		x: integer('x'),
		y: integer('y'),
		plantedOn: text('planted_on').notNull(),
		endedOn: text('ended_on'),
		notes: text('notes')
	},
	(t) => [index('planting_plot_idx').on(t.plotId)]
);
