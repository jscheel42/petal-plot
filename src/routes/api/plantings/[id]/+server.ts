import { json } from '@sveltejs/kit';
import { and, eq, lte } from 'drizzle-orm';
import { getDb, todayISO } from '#lib/server/db';
import { planting } from '#lib/server/schema';
import type { RequestHandler } from './$types';

// PATCH { endedOn? } — harvest/end a planting.
export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	const b = await request.json().catch(() => ({}));
	const endedOn = typeof b.endedOn === 'string' ? b.endedOn : todayISO();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(endedOn) || endedOn > todayISO()) {
		return json({ error: 'endedOn must be a valid date, not in the future' }, { status: 400 });
	}
	const row = await getDb()
		.update(planting)
		.set({ endedOn })
		.where(and(eq(planting.id, id), lte(planting.plantedOn, endedOn)))
		.returning()
		.get();
	if (!row) return json({ error: 'planting not found (or endedOn before plantedOn)' }, { status: 404 });
	return json({ planting: row });
};
