import { json } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { getDb } from '#lib/server/db';
import { rectsOverlap } from '#lib/server/layout';
import { plot } from '#lib/server/schema';
import type { RequestHandler } from './$types';

const PLOT_TYPE_VALUES: Record<string, 'in_ground' | 'raised_bed' | 'container'> = {
	in_ground: 'in_ground',
	raised_bed: 'raised_bed',
	container: 'container'
};


// PATCH accepts any subset of { name, type, x, y, w, h, notes }.
export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	const b = await request.json().catch(() => ({}));
	const db = getDb();
	const existing = await db.select().from(plot).where(eq(plot.id, id)).get();
	if (!existing) return json({ error: 'plot not found' }, { status: 404 });

	const problems: string[] = [];
	const type = typeof b.type === 'string' ? PLOT_TYPE_VALUES[b.type] : undefined;
	if (b.type !== undefined && type === undefined)
		problems.push(`type: must be one of in_ground, raised_bed, container (got ${JSON.stringify(b.type)})`);
	if (b.name !== undefined && !(typeof b.name === 'string' && b.name.trim())) problems.push('name: text required');
	const notes =
		b.notes === undefined ? existing.notes : typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : null;
	const next = {
		name: typeof b.name === 'string' && b.name.trim() ? b.name.trim() : existing.name,
		type: type ?? existing.type,
		x: b.x ?? existing.x,
		y: b.y ?? existing.y,
		w: b.w ?? existing.w,
		h: b.h ?? existing.h,
		notes
	};
	for (const k of ['x', 'y', 'w', 'h'] as const) {
		if (!Number.isInteger(next[k])) problems.push(`${k}: whole number required (got ${JSON.stringify(next[k])})`);
	}
	if (Number.isInteger(next.x) && next.x < 0) problems.push(`x: must be 0 or greater (got ${next.x})`);
	if (Number.isInteger(next.y) && next.y < 0) problems.push(`y: must be 0 or greater (got ${next.y})`);
	if (Number.isInteger(next.w) && next.w < 1) problems.push(`w: must be 1 or greater (got ${next.w})`);
	if (Number.isInteger(next.h) && next.h < 1) problems.push(`h: must be 1 or greater (got ${next.h})`);
	if (problems.length > 0) return json({ error: problems.join('; ') }, { status: 400 });

	const others = await db
		.select()
		.from(plot)
		.where(and(eq(plot.gardenId, existing.gardenId), ne(plot.id, id)))
		.all();
	const clash = others.find((p) => rectsOverlap(p, next));
	if (clash)
		return json(
			{ error: `overlaps "${clash.name}" at (${clash.x}, ${clash.y}) ${clash.w}×${clash.h} ft` },
			{ status: 409 }
		);

	const row = await db.update(plot).set(next).where(eq(plot.id, id)).returning().get();
	return json({ plot: row });
};

export const DELETE: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	const row = await getDb()
		.delete(plot)
		.where(eq(plot.id, id))
		.returning({ id: plot.id })
		.get();
	if (!row) return json({ error: 'plot not found' }, { status: 404 });
	return json({ ok: true });
};
