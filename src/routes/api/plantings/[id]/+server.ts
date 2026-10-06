import { json } from '@sveltejs/kit';
import { and, asc, eq, gt, lte, lt, ne, isNull, or } from 'drizzle-orm';
import { getDb, todayISO } from '#lib/server/db';
import { autoPlace, footprint, rectsOverlap, type Rect } from '#lib/server/layout';
import { plant, planting, plot } from '#lib/server/schema';
import type { RequestHandler } from './$types';

// PATCH { x, y } — reposition a planting band within its plot (whole feet
// from the plot's top-left). PATCH { plantId?, quantity?, plantedOn?,
// endedOn? } — fix up a planting (any mix; endedOn null reactivates it).
// PATCH {} or { endedOn } alone — harvest/end it. DELETE — remove it entirely.
export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	const b = await request.json().catch(() => ({}));
	const db = getDb();

	if (b.x !== undefined || b.y !== undefined) {
		const row = await db.select().from(planting).where(eq(planting.id, id)).get();
		if (!row) return json({ error: 'planting not found' }, { status: 404 });
		const p = await db.select().from(plot).where(eq(plot.id, row.plotId)).get();
		if (!p) return json({ error: 'plot not found' }, { status: 404 });
		const pl = await db.select().from(plant).where(eq(plant.id, row.plantId)).get();
		if (!pl) return json({ error: 'plant not found' }, { status: 404 });

		const problems: string[] = [];
		if (!Number.isInteger(b.x)) problems.push(`x: whole number required (got ${JSON.stringify(b.x)})`);
		if (!Number.isInteger(b.y)) problems.push(`y: whole number required (got ${JSON.stringify(b.y)})`);
		if (problems.length > 0) return json({ error: problems.join('; ') }, { status: 400 });
		const x = b.x as number;
		const y = b.y as number;
		const fp = footprint(row.quantity, pl.spacing, p.w);
		if (x < 0) problems.push(`x: must be 0 or greater (got ${x})`);
		if (y < 0) problems.push(`y: must be 0 or greater (got ${y})`);
		const maxY = Math.max(0, p.h - fp.h);
		if (x > Math.max(0, p.w - fp.w))
			problems.push(`x: band is ${fp.w} ft wide — max x in "${p.name}" is ${Math.max(0, p.w - fp.w)} (got ${x})`);
		if (y > maxY) problems.push(`y: band is ${fp.h} ft tall — max y in "${p.name}" is ${maxY} (got ${y})`);

		// Other active bands in the same plot (auto-stacking unpositioned ones).
		const others = await db
			.select({
				x: planting.x,
				y: planting.y,
				quantity: planting.quantity,
				spacing: plant.spacing
			})
			.from(planting)
			.innerJoin(plant, eq(planting.plantId, plant.id))
			.where(
				and(
					eq(planting.plotId, row.plotId),
					ne(planting.id, id),
					or(isNull(planting.endedOn), gt(planting.endedOn, row.plantedOn))
				)
			)
			.orderBy(asc(planting.id))
			.all();
		const occupied: Rect[] = [];
		for (const o of others) {
			const ofp = footprint(o.quantity, o.spacing, p.w);
			const pos =
				o.x != null && o.y != null
					? { x: Math.max(0, Math.min(o.x, p.w - ofp.w)), y: Math.max(0, Math.min(o.y, p.h - ofp.h)) }
					: autoPlace(p.w, p.h, ofp, occupied) ?? { x: 0, y: 0 };
			occupied.push({ x: pos.x, y: pos.y, w: ofp.w, h: ofp.h });
		}
		const clash = occupied.find((o) => rectsOverlap({ x, y, w: fp.w, h: fp.h }, o));
		if (clash)
			return json(
				{ error: `overlaps another band at (${clash.x}, ${clash.y}) ${clash.w}×${clash.h} ft — pick another spot` },
				{ status: 409 }
			);

		const moved = await db.update(planting).set({ x, y }).where(eq(planting.id, id)).returning().get();
		return json({ planting: moved });
	}

	// Full edit (data fixing): change plant, quantity, and/or harvest window.
	// Dates are LOCAL; +1 day tolerance so UTC-positive zones aren't rejected
	// at local midnight while the server still sits on UTC.
	const maxDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
	const row = await db.select().from(planting).where(eq(planting.id, id)).get();
	if (!row) return json({ error: 'planting not found' }, { status: 404 });
	const p = await db.select().from(plot).where(eq(plot.id, row.plotId)).get();
	if (!p) return json({ error: 'plot not found' }, { status: 404 });

	const problems: string[] = [];
	let plantId = row.plantId;
	if (b.plantId !== undefined) {
		plantId = Number(b.plantId);
		if (!Number.isInteger(plantId) || !(await db.select({ id: plant.id }).from(plant).where(eq(plant.id, plantId)).get()))
			problems.push(`plant ${JSON.stringify(b.plantId)} not found`);
	}
	let quantity = row.quantity;
	if (b.quantity !== undefined) {
		quantity = Number(b.quantity);
		if (!Number.isInteger(quantity) || quantity < 1) problems.push('quantity must be a positive integer');
	}
	let plantedOn = row.plantedOn;
	if (b.plantedOn !== undefined) {
		if (typeof b.plantedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.plantedOn) || b.plantedOn > maxDate)
			problems.push('plantedOn must be a valid date, not in the future');
		else plantedOn = b.plantedOn;
	}
	// bare PATCH {} keeps legacy harvest-today semantics
	let endedOn = b.plantId === undefined && b.quantity === undefined && b.plantedOn === undefined && b.endedOn === undefined ? todayISO() : row.endedOn;
	if (b.endedOn !== undefined) {
		if (b.endedOn === null || b.endedOn === '') endedOn = null; // reactivate: still growing
		else if (typeof b.endedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.endedOn) || b.endedOn > maxDate)
			problems.push('endedOn must be a valid date, not in the future, or null');
		else endedOn = b.endedOn;
	}
	if (endedOn != null && endedOn < plantedOn)
		problems.push(`endedOn (${endedOn}) cannot be before plantedOn (${plantedOn})`);
	if (problems.length > 0) return json({ error: problems.join('; ') }, { status: 400 });

	const pl = await db.select().from(plant).where(eq(plant.id, plantId)).get();
	if (!pl) return json({ error: 'plant not found' }, { status: 404 });
	const fp = footprint(quantity, pl.spacing, p.w);

	// Replay band placement in id order, same rules as POST: bands whose
	// harvest windows overlap this one's new window occupy space; the edited
	// row uses its NEW footprint when its turn comes. Auto-placed rows are
	// never rejected (they park at the plot bottom on overflow, like POST).
	const endRef = endedOn ?? '9999-12-31';
	const rows = await db
		.select({ id: planting.id, x: planting.x, y: planting.y, quantity: planting.quantity, spacing: plant.spacing })
		.from(planting)
		.innerJoin(plant, eq(planting.plantId, plant.id))
		.where(
			and(
				eq(planting.plotId, row.plotId),
				lt(planting.plantedOn, endRef),
				or(isNull(planting.endedOn), gt(planting.endedOn, plantedOn))
			)
		)
		.orderBy(asc(planting.id))
		.all();
	const occupied: Rect[] = [];
	let self: Rect | null = null;
	for (const o of rows) {
		const isSelf = o.id === id;
		const ofp = isSelf ? fp : footprint(o.quantity, o.spacing, p.w);
		const ex = isSelf ? row.x : o.x;
		const ey = isSelf ? row.y : o.y;
		const pos =
			ex != null && ey != null
				? { x: Math.max(0, Math.min(ex, Math.max(0, p.w - ofp.w))), y: Math.max(0, Math.min(ey, Math.max(0, p.h - ofp.h))) }
				: autoPlace(p.w, p.h, ofp, occupied) ?? { x: 0, y: Math.max(0, p.h - ofp.h) };
		const r: Rect = { x: pos.x, y: pos.y, w: ofp.w, h: ofp.h };
		if (isSelf) self = r;
		occupied.push(r);
	}

	const patch: Record<string, unknown> = { plantId, quantity, plantedOn, endedOn };
	// Only re-check occupancy when the footprint actually changes; harvest-
	// only edits must keep working for beds with legacy parked overlaps.
	const fpChanged = quantity !== row.quantity || plantId !== row.plantId;
	if (fpChanged && self != null) {
		const clash = occupied.find((o) => o !== self && rectsOverlap(self, o));
		if (clash)
			return json(
				{
					error: `overlaps another band at (${clash.x}, ${clash.y}) ${clash.w}×${clash.h} ft — shrink the quantity or pick dates that don't overlap`
				},
				{ status: 409 }
			);
		patch.x = self.x;
		patch.y = self.y;
	}

	const updated = await db.update(planting).set(patch).where(eq(planting.id, id)).returning().get();
	return json({ planting: updated });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const db = getDb();
	const row = await db.delete(planting).where(eq(planting.id, Number(params.id))).returning({ id: planting.id }).get();
	if (!row) return json({ error: 'planting not found' }, { status: 404 });
	return json({ deleted: row.id });
};
