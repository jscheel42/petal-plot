import { json } from '@sveltejs/kit';
import { and, asc, eq, gt, lte, ne, isNull, or } from 'drizzle-orm';
import { getDb, todayISO } from '#lib/server/db';
import { autoPlace, footprint, rectsOverlap, type Rect } from '#lib/server/layout';
import { plant, planting, plot } from '#lib/server/schema';
import type { RequestHandler } from './$types';

// PATCH { x, y } — reposition a planting band within its plot (whole feet
// from the plot's top-left). PATCH { endedOn? } — harvest/end it.
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

	const endedOn = typeof b.endedOn === 'string' ? b.endedOn : todayISO();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(endedOn) || endedOn > todayISO()) {
		return json({ error: 'endedOn must be a valid date, not in the future' }, { status: 400 });
	}
	const row = await db
		.update(planting)
		.set({ endedOn })
		.where(and(eq(planting.id, id), lte(planting.plantedOn, endedOn)))
		.returning()
		.get();
	if (!row) return json({ error: 'planting not found (or endedOn before plantedOn)' }, { status: 404 });
	return json({ planting: row });
};
