import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '#lib/server/db';
import { rotationWarnings } from '#lib/server/rotation';
import { garden, plant, planting, plot } from '#lib/server/schema';

const db = getDb();

function freshPlot(): number {
	const g = db.insert(garden).values({ name: 'Test Garden' }).returning().get();
	const p = db
		.insert(plot)
		.values({ gardenId: g.id, name: 'P', type: 'raised_bed', x: 0, y: 0, w: 4, h: 4 })
		.returning()
		.get();
	return p.id;
}

function idOf(name: string): number {
	const row = db.select({ id: plant.id }).from(plant).where(eq(plant.name, name)).get();
	if (!row) throw new Error(`seed missing plant: ${name}`);
	return row.id;
}

const TOMATO = idOf('Tomato');
const PEPPER = idOf('Pepper');
const POTATO = idOf('Potato');
const EGGPLANT = idOf('Eggplant');
const PEA = idOf('Pea');

function plantNow(plotId: number, plantId: number, plantedOn: string, endedOn: string | null = null): number {
	return db
		.insert(planting)
		.values({ plotId, plantId, quantity: 4, plantedOn, endedOn })
		.returning()
		.get()
		.id;
}

describe('rotationWarnings', () => {
	it('flags occupancy when the same family is actively growing', () => {
		const p = freshPlot();
		plantNow(p, TOMATO, '2026-06-01');
		const w = rotationWarnings(db, p, POTATO, '2026-06-15');
		expect(w.map((x) => x.kind)).toEqual(['occupancy']);
		expect(w[0].message).toContain('already growing');
	});

	it('occupancy clears once the conflicting planting is harvested', () => {
		const p = freshPlot();
		plantNow(p, TOMATO, '2026-06-01', '2026-08-01');
		expect(rotationWarnings(db, p, POTATO, '2026-08-15')).toEqual([]);
	});

	it('flags rotation when the same family grew there in the previous calendar year', () => {
		const p = freshPlot();
		plantNow(p, EGGPLANT, '2025-06-01', '2025-09-01');
		const w = rotationWarnings(db, p, PEPPER, '2026-09-15');
		expect(w.map((x) => x.kind)).toEqual(['rotation']);
		expect(w[0].message).toContain('Eggplant');
	});

	it('occupancy takes precedence over rotation', () => {
		const p = freshPlot();
		plantNow(p, EGGPLANT, '2025-06-01', '2025-09-01');
		plantNow(p, TOMATO, '2026-06-01');
		const w = rotationWarnings(db, p, POTATO, '2026-07-01');
		expect(w.map((x) => x.kind)).toEqual(['occupancy']);
	});

	it('clean plot with unrelated family returns no warnings', () => {
		const p = freshPlot();
		plantNow(p, TOMATO, '2026-06-01');
		expect(rotationWarnings(db, p, PEA, '2026-06-15')).toEqual([]);
	});

	it('unknown plant id returns unknown warning', () => {
		const p = freshPlot();
		const w = rotationWarnings(db, p, 999999, '2026-06-15');
		expect(w.map((x) => x.kind)).toEqual(['unknown']);
	});
});
