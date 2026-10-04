import { json } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import { getDb } from '#lib/server/db';
import { plot } from '#lib/server/schema';
import type { RequestHandler } from './$types';

const PLOT_TYPE_VALUES: Record<string, 'in_ground' | 'raised_bed' | 'container'> = {
	in_ground: 'in_ground',
	raised_bed: 'raised_bed',
	container: 'container'
};

function rectsOverlap(
	a: { x: number; y: number; w: number; h: number },
	b: { x: number; y: number; w: number; h: number }
): boolean {
	return a.x < b.x + b.w && b.x < a.x + b.w && a.y < b.y + b.h && b.y < a.y + b.h;
}

// PATCH accepts any subset of { name, type, x, y, w, h }.
export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	const b = await request.json().catch(() => ({}));
	const db = getDb();
	const existing = await db.select().from(plot).where(eq(plot.id, id)).get();
	if (!existing) return json({ error: 'plot not found' }, { status: 404 });

	const type = typeof b.type === 'string' ? PLOT_TYPE_VALUES[b.type] : undefined;
	const next = {
		name: typeof b.name === 'string' && b.name.trim() ? b.name.trim() : existing.name,
		type: type ?? existing.type,
		x: typeof b.x === 'number' && Number.isInteger(b.x) ? b.x : existing.x,
		y: typeof b.y === 'number' && Number.isInteger(b.y) ? b.y : existing.y,
		w: typeof b.w === 'number' && Number.isInteger(b.w) ? Math.max(1, b.w) : existing.w,
		h: typeof b.h === 'number' && Number.isInteger(b.h) ? Math.max(1, b.h) : existing.h
	};
	if (next.x < 0 || next.y < 0) return json({ error: 'x/y must be >= 0' }, { status: 400 });

	const others = await db
		.select()
		.from(plot)
		.where(and(eq(plot.gardenId, existing.gardenId), ne(plot.id, id)))
		.all();
	const clash = others.find((p) => rectsOverlap(p, next));
	if (clash) return json({ error: `overlaps ${clash.name}` }, { status: 409 });

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
