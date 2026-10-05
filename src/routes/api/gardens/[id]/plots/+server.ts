import { json } from '@sveltejs/kit';
import { and, asc, eq, gte, inArray, isNull, lt, lte, or, gt } from 'drizzle-orm';
import { getDb, todayISO } from '#lib/server/db';
import { garden, plant, planting, plot } from '#lib/server/schema';
import type { RequestHandler } from './$types';

const PLOT_TYPE_VALUES: Record<string, 'in_ground' | 'raised_bed' | 'container'> = {
	in_ground: 'in_ground',
	raised_bed: 'raised_bed',
	container: 'container'
};

function isInt(v: unknown): v is number {
	return typeof v === 'number' && Number.isInteger(v);
}

function rectsOverlap(
	a: { x: number; y: number; w: number; h: number },
	b: { x: number; y: number; w: number; h: number }
): boolean {
	return a.x < b.x + b.w && b.x < a.x + b.w && a.y < b.y + b.h && b.y < a.y + b.h;
}

// GET ?asof=YYYY-MM-DD — plots with plantings active on that date + rotation badges.
export const GET: RequestHandler = async ({ params, url }) => {
	const gardenId = Number(params.id);
	const asof = url.searchParams.get('asof') ?? todayISO();
	const db = getDb();
	if (!(await db.select({ id: garden.id }).from(garden).where(eq(garden.id, gardenId)).get())) {
		return json({ error: 'garden not found' }, { status: 404 });
	}
	const plots = await db.select().from(plot).where(eq(plot.gardenId, gardenId)).orderBy(asc(plot.id)).all();
	const plotIds = plots.map((p) => p.id);

	const actives =
		plotIds.length === 0
			? []
			: await db
					.select({
						id: planting.id,
						plotId: planting.plotId,
						plantId: plant.id,
						name: plant.name,
						family: plant.family,
						emoji: plant.emoji,
						quantity: planting.quantity,
						spacing: plant.spacing,
						plantedOn: planting.plantedOn
					})
					.from(planting)
					.innerJoin(plant, eq(planting.plantId, plant.id))
					.where(
						and(
							inArray(planting.plotId, plotIds),
							lte(planting.plantedOn, asof),
							or(isNull(planting.endedOn), gt(planting.endedOn, asof))
						)
					)
					.all();

	const prevYear = Number(asof.slice(0, 4)) - 1;
	const prevs =
		plotIds.length === 0
			? []
			: await db
					.select({
						plotId: planting.plotId,
						family: plant.family,
						name: plant.name,
						plantedOn: planting.plantedOn
					})
					.from(planting)
					.innerJoin(plant, eq(planting.plantId, plant.id))
					.where(
						and(
							inArray(planting.plotId, plotIds),
							gte(planting.plantedOn, `${prevYear}-01-01`),
							lt(planting.plantedOn, `${prevYear + 1}-01-01`)
						)
					)
					.all();

	return json({
		asof,
		plots: plots.map((p) => {
			const own = actives.filter((a) => a.plotId === p.id);
			const conflict = own.find((a) =>
				prevs.find((v) => v.plotId === p.id && v.family === a.family)
			);
			return {
				...p,
				plantings: own,
				warning: conflict
					? `had ${conflict.family.toLowerCase()} last year (${conflict.name}, planted ${conflict.plantedOn})`
					: null
			};
		})
	});
};

export const POST: RequestHandler = async ({ params, request }) => {
	const gardenId = Number(params.id);
	const b = await request.json().catch(() => ({}));
	const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : null;
	const type = typeof b.type === 'string' ? PLOT_TYPE_VALUES[b.type] : undefined;
	const { x, y, w, h } = b;
	const problems: string[] = [];
	if (name === null) problems.push('name: text required');
	if (type === undefined)
		problems.push(`type: must be one of in_ground, raised_bed, container (got ${JSON.stringify(b.type)})`);
	if (!isInt(x)) problems.push(`x: whole number required (got ${JSON.stringify(x)})`);
	else if (x < 0) problems.push(`x: must be 0 or greater (got ${x})`);
	if (!isInt(y)) problems.push(`y: whole number required (got ${JSON.stringify(y)})`);
	else if (y < 0) problems.push(`y: must be 0 or greater (got ${y})`);
	if (!isInt(w)) problems.push(`w: whole number required (got ${JSON.stringify(w)})`);
	else if (w < 1) problems.push(`w: must be 1 or greater (got ${w})`);
	if (!isInt(h)) problems.push(`h: whole number required (got ${JSON.stringify(h)})`);
	else if (h < 1) problems.push(`h: must be 1 or greater (got ${h})`);
	if (problems.length > 0 || name === null || type === undefined)
		return json({ error: problems.join('; ') || 'invalid plot' }, { status: 400 });
	const db = getDb();
	if (!(await db.select({ id: garden.id }).from(garden).where(eq(garden.id, gardenId)).get())) {
		return json({ error: 'garden not found' }, { status: 404 });
	}
	const existing = await db.select().from(plot).where(eq(plot.gardenId, gardenId)).all();
	const clash = existing.find((p) => rectsOverlap(p, { x, y, w, h }));
	if (clash)
		return json(
			{ error: `overlaps "${clash.name}" at (${clash.x}, ${clash.y}) ${clash.w}×${clash.h} ft — drag somewhere else` },
			{ status: 409 }
		);

	const row = await db
		.insert(plot)
		.values({ gardenId, name, type, x, y, w, h })
		.returning()
		.get();
	return json({ plot: row }, { status: 201 });
};
