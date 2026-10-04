import { json } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import { getDb } from '#lib/server/db';
import { plant } from '#lib/server/schema';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const rows = await getDb()
		.select({
			id: plant.id,
			name: plant.name,
			family: plant.family,
			emoji: plant.emoji,
			spacing: plant.spacing,
			sun: plant.sun
		})
		.from(plant)
		.orderBy(asc(plant.family), asc(plant.name))
		.all();
	return json({ plants: rows });
};
