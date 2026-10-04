import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { rotationWarnings } from '#lib/server/rotation';
import { testDb } from '#lib/server/test-db';
import { garden, plant, planting, plot } from '#lib/server/schema';

const { db } = await testDb();

async function freshPlot(): Promise<number> {
	const g = await db.insert(garden).values({ name: 'Test Garden' }).returning().get();
	const p = await db
		.insert(plot)
		.values({ gardenId: g.id, name: 'P', type: 'raised_bed', x: 0, y: 0, w: 4, h: 4 })
		.returning()
		.get();
	return p.id;
}

async function idOf(name: string): Promise<number> {
	const row = await db.select({ id: plant.id }).from(plant).where(eq(plant.name, name)).get();
	if (!row) throw new Error(`seed missing plant: ${name}`);
	return row.id;
}

const TOMATO = await idOf('Tomato');
const PEPPER = await idOf('Pepper');
const POTATO = await idOf('Potato');
const EGGPLANT = await idOf('Eggplant');
const PEA = await idOf('Pea');

async function plantNow(plotId: number, plantId: number, plantedOn: string, endedOn: string | null = null): Promise<number> {
	const row = await db
		.insert(planting)
		.values({ plotId, plantId, quantity: 4, plantedOn, endedOn })
		.returning()
		.get();
	return row.id;
}

describe('rotationWarnings', () => {
	it('flags occupancy when the same family is actively growing', async () => {
		const p = await freshPlot();
		await plantNow(p, TOMATO, '2026-06-01');
		const w = await rotationWarnings(db, p, POTATO, '2026-06-15');
		expect(w.map((x) => x.kind)).toEqual(['occupancy']);
		expect(w[0].message).toContain('already growing');
	});

	it('occupancy clears once the conflicting planting is harvested', async () => {
		const p = await freshPlot();
		await plantNow(p, TOMATO, '2026-06-01', '2026-08-01');
		expect(await rotationWarnings(db, p, POTATO, '2026-08-15')).toEqual([]);
	});

	it('flags rotation when the same family grew there in the previous calendar year', async () => {
		const p = await freshPlot();
		await plantNow(p, EGGPLANT, '2025-06-01', '2025-09-01');
		const w = await rotationWarnings(db, p, PEPPER, '2026-09-15');
		expect(w.map((x) => x.kind)).toEqual(['rotation']);
		expect(w[0].message).toContain('Eggplant');
	});

	it('occupancy takes precedence over rotation', async () => {
		const p = await freshPlot();
		await plantNow(p, EGGPLANT, '2025-06-01', '2025-09-01');
		await plantNow(p, TOMATO, '2026-06-01');
		const w = await rotationWarnings(db, p, POTATO, '2026-07-01');
		expect(w.map((x) => x.kind)).toEqual(['occupancy']);
	});

	it('clean plot with unrelated family returns no warnings', async () => {
		const p = await freshPlot();
		await plantNow(p, TOMATO, '2026-06-01');
		expect(await rotationWarnings(db, p, PEA, '2026-06-15')).toEqual([]);
	});

	it('unknown plant id returns unknown warning', async () => {
		const p = await freshPlot();
		const w = await rotationWarnings(db, p, 999999, '2026-06-15');
		expect(w.map((x) => x.kind)).toEqual(['unknown']);
	});
});
