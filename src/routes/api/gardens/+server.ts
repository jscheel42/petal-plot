import { json } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import { getDb } from '#lib/server/db';
import { garden } from '#lib/server/schema';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const gardens = await getDb()
		.select({ id: garden.id, name: garden.name })
		.from(garden)
		.orderBy(asc(garden.id))
		.all();
	return json({ gardens });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return json({ error: 'name required' }, { status: 400 });
	const row = await getDb()
		.insert(garden)
		.values({ name })
		.returning({ id: garden.id, name: garden.name })
		.get();
	return json({ garden: row }, { status: 201 });
};
