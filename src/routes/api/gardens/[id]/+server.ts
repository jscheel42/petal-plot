import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db';
import { garden } from '#lib/server/schema';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	const body = await request.json().catch(() => ({}));
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return json({ error: 'name required' }, { status: 400 });
	const row = await getDb()
		.update(garden)
		.set({ name })
		.where(eq(garden.id, id))
		.returning({ id: garden.id, name: garden.name })
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
