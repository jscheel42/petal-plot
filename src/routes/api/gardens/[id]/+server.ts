import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db';
import { garden } from '#lib/server/schema';
import type { RequestHandler } from './$types';

const GRID_MIN = 4;
const GRID_MAX = 999;

export const GET: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	const row = await getDb()
		.select({ id: garden.id, name: garden.name, gridW: garden.gridW, gridH: garden.gridH, outsideColor: garden.outsideColor })
		.from(garden)
		.where(eq(garden.id, id))
		.get();
	if (!row) return json({ error: 'garden not found' }, { status: 404 });
	return json({ garden: row });
};

// Partial update: name and/or grid prefs (gridW/H: 0 = auto, else 4–999 ft;
// outsideColor #rrggbb). The canvas PATCHes only the grid fields.
export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	const body = await request.json().catch(() => ({}));
	const upd: Partial<typeof garden.$inferInsert> = {};
	if (body.name !== undefined) {
		const name = typeof body.name === 'string' ? body.name.trim() : '';
		if (!name) return json({ error: 'name required' }, { status: 400 });
		upd.name = name;
	}
	if (body.gridW !== undefined) {
		const v = body.gridW;
		if (typeof v !== 'number' || !Number.isInteger(v) || (v !== 0 && (v < GRID_MIN || v > GRID_MAX)))
			return json({ error: `gridW must be 0 (auto) or ${GRID_MIN}–${GRID_MAX}` }, { status: 400 });
		upd.gridW = v;
	}
	if (body.gridH !== undefined) {
		const v = body.gridH;
		if (typeof v !== 'number' || !Number.isInteger(v) || (v !== 0 && (v < GRID_MIN || v > GRID_MAX)))
			return json({ error: `gridH must be 0 (auto) or ${GRID_MIN}–${GRID_MAX}` }, { status: 400 });
		upd.gridH = v;
	}
	if (body.outsideColor !== undefined) {
		const c = typeof body.outsideColor === 'string' ? body.outsideColor.toLowerCase() : '';
		if (!/^#[0-9a-f]{6}$/.test(c)) return json({ error: 'outsideColor must be #rrggbb' }, { status: 400 });
		upd.outsideColor = c;
	}
	if (Object.keys(upd).length === 0) return json({ error: 'nothing to update' }, { status: 400 });
	const row = await getDb()
		.update(garden)
		.set(upd)
		.where(eq(garden.id, id))
		.returning({ id: garden.id, name: garden.name, gridW: garden.gridW, gridH: garden.gridH, outsideColor: garden.outsideColor })
		.get();
	if (!row) return json({ error: 'garden not found' }, { status: 404 });
	return json({ garden: row });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	const row = await getDb()
		.delete(garden)
		.where(eq(garden.id, id))
		.returning({ id: garden.id })
		.get();
	if (!row) return json({ error: 'garden not found' }, { status: 404 });
	return json({ ok: true });
};
