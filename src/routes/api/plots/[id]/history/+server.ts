import { json } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '#lib/server/db';
import { plant, planting, plot } from '#lib/server/schema';
import type { RequestHandler } from './$types';

// All plantings (active + ended) for one plot, newest first.
export const GET: RequestHandler = async ({ params }) => {
	const plotId = Number(params.id);
	const db = getDb();
	if (!(await db.select({ id: plot.id }).from(plot).where(eq(plot.id, plotId)).get())) {
		return json({ error: 'plot not found' }, { status: 404 });
	}
	const history = await db
		.select({
			id: planting.id,
			plantId: planting.plantId,
			name: plant.name,
			emoji: plant.emoji,
			family: plant.family,
			quantity: planting.quantity,
			plantedOn: planting.plantedOn,
			endedOn: planting.endedOn
		})
		.from(planting)
		.innerJoin(plant, eq(planting.plantId, plant.id))
		.where(eq(planting.plotId, plotId))
		.orderBy(desc(planting.plantedOn))
		.all();
	return json({ history });
};
