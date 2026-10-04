import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb, todayISO } from '#lib/server/db';
import { plant, planting, plot } from '#lib/server/schema';
import { rotationWarnings } from '#lib/server/rotation';
import type { RequestHandler } from './$types';

// POST { plantId, quantity, plantedOn? } — plant into this plot.
export const POST: RequestHandler = async ({ params, request }) => {
	const plotId = Number(params.id);
	const b = await request.json().catch(() => ({}));
	const db = getDb();
	if (!db.select({ id: plot.id }).from(plot).where(eq(plot.id, plotId)).get()) {
		return json({ error: 'plot not found' }, { status: 404 });
	}
	const plantId = Number(b.plantId);
	const quantity = Number(b.quantity);
	const plantedOn = typeof b.plantedOn === 'string' ? b.plantedOn : todayISO();

	if (!db.select({ id: plant.id }).from(plant).where(eq(plant.id, plantId)).get()) {
		return json({ error: 'plant not found' }, { status: 404 });
	}
	if (!Number.isInteger(quantity) || quantity < 1) {
		return json({ error: 'quantity must be a positive integer' }, { status: 400 });
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(plantedOn) || plantedOn > todayISO()) {
		return json({ error: 'plantedOn must be a valid date, not in the future' }, { status: 400 });
	}

	// Compute warnings BEFORE insert so the row being created isn't its own occupancy conflict.
	const warnings = rotationWarnings(db, plotId, plantId, plantedOn);
	const row = db
		.insert(planting)
		.values({ plotId, plantId, quantity, plantedOn })
		.returning()
		.get();
	return json({ planting: row, warnings }, { status: 201 });
};
