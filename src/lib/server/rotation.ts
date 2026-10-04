// Crop-rotation warning logic.
// Two checks, both scoped to a single plot:
//  1. occupancy: the same family is already growing in this plot (as of the
//     planting date) — planting it again is a duplicate.
//  2. rotation: the same family was planted in this plot during the previous
//     calendar year — classic rotation violation ("bed 3 had brassicas last year").
import { and, eq, gte, lt, lte, or, isNull, gt, sql } from 'drizzle-orm';
import { plant, planting } from './schema';
import type { DB } from './seed';

export type Warning = { kind: 'occupancy' | 'rotation' | 'unknown'; message: string };

/**
 * Warnings for planting `plantId` into `plotId` on `plantedOn` (YYYY-MM-DD).
 * Returns [] when everything looks fine.
 */
export function rotationWarnings(
	db: DB,
	plotId: number,
	plantId: number,
	plantedOn: string
): Warning[] {
	const family = db
		.select({ family: plant.family })
		.from(plant)
		.where(eq(plant.id, plantId))
		.get()?.family;
	if (!family) {
		return [{ kind: 'unknown', message: `Unknown plant #${plantId}` }];
	}

	// 1. occupancy: same family actively growing at plantedOn
	const active = db
		.select({ name: plant.name })
		.from(planting)
		.innerJoin(plant, eq(planting.plantId, plant.id))
		.where(
			and(
				eq(planting.plotId, plotId),
				eq(plant.family, family),
				lte(planting.plantedOn, plantedOn),
				or(isNull(planting.endedOn), gt(planting.endedOn, plantedOn))
			)
		)
		.all();
	if (active.length > 0) {
		return [
			{
				kind: 'occupancy',
				message: `${family} is already growing here (${active[0].name}) — this would be a duplicate planting.`
			}
		];
	}

	// 2. rotation: same family planted in the previous calendar year
	const prevYear = Number(plantedOn.slice(0, 4)) - 1;
	const prev = db
		.select({ name: plant.name, plantedOn: planting.plantedOn })
		.from(planting)
		.innerJoin(plant, eq(planting.plantId, plant.id))
		.where(
			and(
				eq(planting.plotId, plotId),
				eq(plant.family, family),
				gte(planting.plantedOn, `${prevYear}-01-01`),
				lt(planting.plantedOn, `${prevYear + 1}-01-01`)
			)
		)
		.all();
	if (prev.length > 0) {
		return [
			{
				kind: 'rotation',
				message: `Rotation warning: bed had ${family.toLowerCase()} last year (${prev[0].name}, planted ${prev[0].plantedOn}). Avoid the same family two years running.`
			}
		];
	}

	return [];
}
