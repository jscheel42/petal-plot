import { json } from '@sveltejs/kit';
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { getDb, todayISO } from '#lib/server/db';
import { autoPlace, footprint, rectsOverlap, type Rect } from '#lib/server/layout';
import { plant, planting, plot } from '#lib/server/schema';
import { rotationWarnings } from '#lib/server/rotation';
import type { RequestHandler } from './$types';

// POST { plantId, quantity, plantedOn?, x?, y? } — plant into this plot.
// x/y: whole feet from the plot's top-left corner; omit to auto-stack.
export const POST: RequestHandler = async ({ params, request }) => {
	const plotId = Number(params.id);
	const b = await request.json().catch(() => ({}));
	const db = getDb();
	const p = await db.select().from(plot).where(eq(plot.id, plotId)).get();
	if (!p) return json({ error: 'plot not found' }, { status: 404 });
	const plantId = Number(b.plantId);
	const quantity = Number(b.quantity);
	const plantedOn = typeof b.plantedOn === 'string' ? b.plantedOn : todayISO();

	const pl = await db.select().from(plant).where(eq(plant.id, plantId)).get();
	if (!pl) return json({ error: 'plant not found' }, { status: 404 });
	if (!Number.isInteger(quantity) || quantity < 1) {
		return json({ error: 'quantity must be a positive integer' }, { status: 400 });
	}
	// clients send LOCAL dates; allow +1 day so UTC-positive zones aren't
	// rejected at local midnight while the server still sits on UTC.
	const maxDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(plantedOn) || plantedOn > maxDate) {
		return json({ error: 'plantedOn must be a valid date, not in the future' }, { status: 400 });
	}

	const fp = footprint(quantity, pl.spacing, p.w);
	const problems: string[] = [];
	let x: number | null = null;
	let y: number | null = null;
	if (b.x !== undefined || b.y !== undefined) {
		if (!Number.isInteger(b.x)) problems.push(`x: whole number required (got ${JSON.stringify(b.x)})`);
		if (!Number.isInteger(b.y)) problems.push(`y: whole number required (got ${JSON.stringify(b.y)})`);
		if (problems.length === 0) {
			x = b.x as number;
			y = b.y as number;
			if (x < 0) problems.push(`x: must be 0 or greater (got ${x})`);
			if (y < 0) problems.push(`y: must be 0 or greater (got ${y})`);
			if (x > Math.max(0, p.w - fp.w))
				problems.push(`x: ${pl.name} band is ${fp.w} ft wide — max x is ${Math.max(0, p.w - fp.w)} (got ${x})`);
			if (y > Math.max(0, p.h - fp.h))
				problems.push(`y: ${pl.name} band is ${fp.h} ft tall — max y is ${Math.max(0, p.h - fp.h)} (got ${y})`);
		}
		if (problems.length > 0) return json({ error: problems.join('; ') }, { status: 400 });
	}

	// Footprints of active plantings, auto-stacking unpositioned rows in id order.
	const actives = await db
		.select({
			id: planting.id,
			x: planting.x,
			y: planting.y,
			quantity: planting.quantity,
			spacing: plant.spacing,
			name: plant.name
		})
		.from(planting)
		.innerJoin(plant, eq(planting.plantId, plant.id))
		.where(and(eq(planting.plotId, plotId), or(isNull(planting.endedOn), gt(planting.endedOn, plantedOn))))
		.orderBy(asc(planting.id))
		.all();
	const occupied: Rect[] = [];
	for (const a of actives) {
		const afp = footprint(a.quantity, a.spacing, p.w);
		const pos =
			a.x != null && a.y != null
				? { x: Math.max(0, Math.min(a.x, p.w - afp.w)), y: Math.max(0, Math.min(a.y, p.h - afp.h)) }
				: autoPlace(p.w, p.h, afp, occupied) ?? { x: 0, y: 0 };
		occupied.push({ x: pos.x, y: pos.y, w: afp.w, h: afp.h });
	}

	if (x !== null && y !== null) {
		const nx = x,
			ny = y;
		const clash = occupied.find((o) => rectsOverlap({ x: nx, y: ny, w: fp.w, h: fp.h }, o));
		if (clash)
			return json(
				{ error: `overlaps an existing band at (${clash.x}, ${clash.y}) ${clash.w}×${clash.h} ft — pick another spot` },
				{ status: 409 }
			);
	} else {
		// Auto placement never rejects (matches legacy stacking): first free
		// slot, else park at the plot bottom where it may visually overflow.
		const pos = autoPlace(p.w, p.h, fp, occupied) ?? { x: 0, y: Math.max(0, p.h - fp.h) };
		x = pos.x;
		y = pos.y;
	}

	// Compute warnings BEFORE insert so the row being created isn't its own occupancy conflict.
	const warnings = await rotationWarnings(db, plotId, plantId, plantedOn);
	const row = await db
		.insert(planting)
		.values({ plotId, plantId, quantity, plantedOn, x, y })
		.returning()
		.get();
	return json({ planting: row, warnings }, { status: 201 });
};
