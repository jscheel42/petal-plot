// API route integration tests: garden → plot → plant → harvest lifecycle,
// overlap rejection, validation errors, and as-of replay.
import { describe, expect, it } from 'vitest';
import { testDb } from '#lib/server/test-db';
import { GET as listGardens, POST as createGarden } from './gardens/+server.ts';
import { GET as getPlots, POST as createPlot } from './gardens/[id]/plots/+server.ts';
import { POST as addPlanting } from './plots/[id]/plantings/+server.ts';
import { DELETE as deletePlanting, PATCH as patchPlanting } from './plantings/[id]/+server.ts';
import { GET as getHistory } from './plots/[id]/history/+server.ts';
import { PATCH as patchPlot } from './plots/[id]/+server.ts';

// Alias-resolved harness boots the ephemeral D1 + applies migrations/seed.
await testDb();

// Minimal fake event; routes are RequestHandler, so each call site casts
// through this looser shape.
type Event = {
	params: Record<string, string>;
	request: Request;
	url: URL;
};
type Handler = (event: Event) => Promise<Response>;

async function call<T = Record<string, unknown>>(
	handler: Handler,
	opts: { params?: Record<string, string>; method?: string; body?: unknown; query?: string } = {}
): Promise<{ status: number; json: T }> {
	const req = new Request('http://test.local/' + (opts.query ?? ''), {
		method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
	});
	const res = await handler({
		params: opts.params ?? {},
		request: req,
		url: new URL(req.url)
	});
	return { status: res.status, json: await res.json() };
}

let gardenId = 0;
let plotId = 0;
let plantingId = 0;

describe('planting lifecycle', () => {
	it('creates a garden', async () => {
		const r = await call<{ garden: { id: number } }>(createGarden as Handler, { body: { name: 'Lifecycle Garden' } });
		expect(r.status).toBe(201);
		gardenId = r.json.garden.id;
		const list = await call<{ gardens: { id: number }[] }>(listGardens as Handler);
		expect(list.json.gardens.some((g) => g.id === gardenId)).toBe(true);
	});

	it('creates a plot and rejects overlaps', async () => {
		const r = await call<{ plot: { id: number } }>(createPlot as Handler, {
			params: { id: String(gardenId) },
			body: { name: 'B1', type: 'raised_bed', x: 0, y: 0, w: 4, h: 4 }
		});
		expect(r.status).toBe(201);
		plotId = r.json.plot.id;

		const clash = await call(createPlot as Handler, {
			params: { id: String(gardenId) },
			body: { name: 'B2', type: 'raised_bed', x: 2, y: 2, w: 3, h: 3 }
		});
		expect(clash.status).toBe(409);

		const ok = await call(createPlot as Handler, {
			params: { id: String(gardenId) },
			body: { name: 'B3', type: 'in_ground', x: 10, y: 0, w: 2, h: 2 }
		});
		expect(ok.status).toBe(201);
	});

	it('validates planting input', async () => {
		const badQty = await call(addPlanting as Handler, {
			params: { id: String(plotId) },
			body: { plantId: 1, quantity: 0, plantedOn: '2026-06-01' }
		});
		expect(badQty.status).toBe(400);

		const future = await call(addPlanting as Handler, {
			params: { id: String(plotId) },
			body: { plantId: 1, quantity: 1, plantedOn: '2099-01-01' }
		});
		expect(future.status).toBe(400);

		const missingPlant = await call(addPlanting as Handler, {
			params: { id: String(plotId) },
			body: { plantId: 999999, quantity: 1, plantedOn: '2026-06-01' }
		});
		expect(missingPlant.status).toBe(404);
	});

	it('plants, warns on same-family occupancy, and replays by date', async () => {
		const tomato = await call<{ planting: { id: number }; warnings: unknown[] }>(addPlanting as Handler, {
			params: { id: String(plotId) },
			body: { plantId: 1, quantity: 6, plantedOn: '2026-06-01' }
		});
		expect(tomato.status).toBe(201);
		expect(tomato.json.warnings).toEqual([]);
		plantingId = tomato.json.planting.id;

		const potato = await call<{ warnings: { kind: string }[] }>(addPlanting as Handler, {
			params: { id: String(plotId) },
			body: { plantId: 4, quantity: 2, plantedOn: '2026-06-05' }
		});
		expect(potato.json.warnings[0]?.kind).toBe('occupancy');

		const during = await call<{ plots: { id: number; plantings: { name: string }[] }[] }>(getPlots as Handler, {
			params: { id: String(gardenId) },
			query: '?asof=2026-06-10'
		});
		const b1 = during.json.plots.find((p) => p.id === plotId);
		expect(b1?.plantings.map((x) => x.name)).toContain('Tomato');
	});

	it('harvest ends the planting and shows in history', async () => {
		const h = await call<{ planting: { endedOn: string | null } }>(patchPlanting as Handler, {
			params: { id: String(plantingId) },
			method: 'PATCH',
			body: {}
		});
		expect(h.status).toBe(200);
		expect(h.json.planting.endedOn).not.toBeNull();

		const hist = await call<{ history: { id: number; endedOn: string | null }[] }>(getHistory as Handler, {
			params: { id: String(plotId) }
		});
		const row = hist.json.history.find((x) => x.id === plantingId);
		expect(row?.endedOn).not.toBeNull();

		const after = await call<{ plots: { id: number; plantings: { id: number }[] }[] }>(getPlots as Handler, {
			params: { id: String(gardenId) },
			query: `?asof=${new Date().toISOString().slice(0, 10)}`
		});
		const b1 = after.json.plots.find((p) => p.id === plotId);
		expect(b1?.plantings.some((x) => x.id === plantingId)).toBe(false);
	});

	it('rejects harvest with endedOn before plantedOn', async () => {
		const r = await call(patchPlanting as Handler, {
			params: { id: String(plantingId) },
			method: 'PATCH',
			body: { endedOn: '2000-01-01' }
		});
		expect(r.status).toBe(400);
	});
});

// Band positioning: explicit anchors validated server-side, auto-stack
// assigns integer-ft slots, PATCH moves re-checked against other bands.
describe('planting positions', () => {
	let posPlotId = 0;
	let kaleId = 0;
	let pepperId = 0;

	it('creates a dedicated 4×8 bed', async () => {
		const r = await call<{ plot: { id: number } }>(createPlot as Handler, {
			params: { id: String(gardenId) },
			body: { name: 'PosBed', type: 'raised_bed', x: 20, y: 0, w: 4, h: 8 }
		});
		expect(r.status).toBe(201);
		posPlotId = r.json.plot.id;
	});

	it('stores explicit x,y', async () => {
		const r = await call<{ planting: { id: number; x: number | null; y: number | null } }>(addPlanting as Handler, {
			params: { id: String(posPlotId) },
			body: { plantId: 5, quantity: 4, plantedOn: '2026-06-01', x: 0, y: 2 }
		});
		expect(r.status).toBe(201);
		expect(r.json.planting.x).toBe(0);
		expect(r.json.planting.y).toBe(2);
		kaleId = r.json.planting.id;
	});

	it('rejects out-of-bounds with per-field messages', async () => {
		const r = await call<{ error: string }>(addPlanting as Handler, {
			params: { id: String(posPlotId) },
			body: { plantId: 2, quantity: 8, plantedOn: '2026-06-01', x: 9, y: -1 }
		});
		expect(r.status).toBe(400);
		expect(r.json.error).toContain('x:');
		expect(r.json.error).toContain('y:');
		expect(r.json.error).toContain('max x is 0');
	});

	it('rejects explicit anchor overlapping an existing band', async () => {
		const r = await call<{ error: string }>(addPlanting as Handler, {
			params: { id: String(posPlotId) },
			body: { plantId: 2, quantity: 4, plantedOn: '2026-06-01', x: 0, y: 2 }
		});
		expect(r.status).toBe(409);
		expect(r.json.error).toContain('overlaps');
	});

	it('auto-stacks unpositioned plantings into free slots', async () => {
		const r = await call<{ planting: { id: number; x: number | null; y: number | null } }>(addPlanting as Handler, {
			params: { id: String(posPlotId) },
			body: { plantId: 2, quantity: 8, plantedOn: '2026-06-01' }
		});
		expect(r.status).toBe(201);
		// kale 4×1 at y=2, pepper 4×2 → first free scan row is y=0
		expect(r.json.planting.x).toBe(0);
		expect(r.json.planting.y).toBe(0);
		pepperId = r.json.planting.id;
	});

	it('GET returns band footprints', async () => {
		const r = await call<{
			plots: { id: number; plantings: { id: number; fx: number; fy: number; fw: number; fh: number }[] }[];
		}>(getPlots as Handler, {
			params: { id: String(gardenId) },
			query: '?asof=2026-06-10'
		});
		const bed = r.json.plots.find((p) => p.id === posPlotId);
		const kale = bed?.plantings.find((x) => x.id === kaleId);
		const pepper = bed?.plantings.find((x) => x.id === pepperId);
		expect(kale).toMatchObject({ fx: 0, fy: 2, fw: 4, fh: 1 });
		expect(pepper).toMatchObject({ fx: 0, fy: 0, fw: 4, fh: 2 });
	});

	it('PATCH moves a planting and rejects overlaps/bad input', async () => {
		const ok = await call<{ planting: { x: number | null; y: number | null } }>(patchPlanting as Handler, {
			params: { id: String(pepperId) },
			method: 'PATCH',
			body: { x: 0, y: 3 }
		});
		expect(ok.status).toBe(200);
		expect(ok.json.planting).toMatchObject({ x: 0, y: 3 });

	const clash = await call<{ error: string }>(patchPlanting as Handler, {
			params: { id: String(pepperId) },
			method: 'PATCH',
			body: { x: 0, y: 2 }
		});
		expect(clash.status).toBe(409);

		const bad = await call<{ error: string }>(patchPlanting as Handler, {
			params: { id: String(pepperId) },
			method: 'PATCH',
			body: { x: 1.5, y: 0 }
		});
		expect(bad.status).toBe(400);
		expect(bad.json.error).toContain('whole number');
	});

	it('harvest still works without x,y', async () => {
		const r = await call<{ planting: { endedOn: string | null } }>(patchPlanting as Handler, {
			params: { id: String(kaleId) },
			method: 'PATCH',
			body: {}
		});
		expect(r.status).toBe(200);
		expect(r.json.planting.endedOn).not.toBeNull();
	});
});

// endedOn is the harvest day and EXCLUSIVE: the planting must vanish from
// asof=that day. Clients send LOCAL dates (server clock is UTC).
describe('harvest dates', () => {
	const local = (daysAgo: number) => {
		const d = new Date();
		d.setDate(d.getDate() - daysAgo);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	};
	let bedId = 0;
	let pId = 0;

	it('sets up a bed with a 2-day-old planting', async () => {
		const bed = await call<{ plot: { id: number } }>(createPlot as Handler, {
			params: { id: String(gardenId) },
			body: { name: 'HarvestBed', type: 'raised_bed', x: 30, y: 0, w: 4, h: 4 }
		});
		expect(bed.status).toBe(201);
		bedId = bed.json.plot.id;
		const p = await call<{ planting: { id: number } }>(addPlanting as Handler, {
			params: { id: String(bedId) },
			body: { plantId: 5, quantity: 1, plantedOn: local(2) }
		});
		expect(p.status).toBe(201);
		pId = p.json.planting.id;
	});

	it('harvest with local today removes the band from today, keeps yesterday', async () => {
		const h = await call<{ planting: { endedOn: string | null } }>(patchPlanting as Handler, {
			params: { id: String(pId) },
			method: 'PATCH',
			body: { endedOn: local(0) }
		});
		expect(h.status).toBe(200);
		expect(h.json.planting.endedOn).toBe(local(0));

		const today = await call<{ plots: { id: number; plantings: { id: number }[] }[] }>(getPlots as Handler, {
			params: { id: String(gardenId) },
			query: `?asof=${local(0)}`
		});
		expect(today.json.plots.find((p) => p.id === bedId)?.plantings.some((a) => a.id === pId)).toBe(false);

		const yesterday = await call<{ plots: { id: number; plantings: { id: number }[] }[] }>(getPlots as Handler, {
			params: { id: String(gardenId) },
			query: `?asof=${local(1)}`
		});
		expect(yesterday.json.plots.find((p) => p.id === bedId)?.plantings.some((a) => a.id === pId)).toBe(true);
	});

	it('accepts a UTC-tomorrow date from UTC-positive clients', async () => {
		const tomorrow = local(-1);
		const p = await call<{ planting: { id: number } }>(addPlanting as Handler, {
			params: { id: String(bedId) },
			body: { plantId: 7, quantity: 1, plantedOn: tomorrow }
		});
		expect(p.status).toBe(201);
		const h = await call(patchPlanting as Handler, {
			params: { id: String(p.json.planting.id) },
			method: 'PATCH',
			body: { endedOn: tomorrow }
		});
		expect(h.status).toBe(200);
	});
});

// Right-click editor backend: partial property edits, validation, resize overlap.
describe('plot property edits', () => {
	let bedId = 0;

	it('renames, retypes, and notes a plot', async () => {
		const bed = await call<{ plot: { id: number } }>(createPlot as Handler, {
			params: { id: String(gardenId) },
			body: { name: 'EditBed', type: 'raised_bed', x: 40, y: 0, w: 4, h: 4 }
		});
		expect(bed.status).toBe(201);
		bedId = bed.json.plot.id;
		const r = await call<{ plot: { name: string; type: string; notes: string | null; w: number; h: number } }>(
			patchPlot as Handler,
			{
				params: { id: String(bedId) },
				method: 'PATCH',
				body: { name: ' Tomato Bed ', type: 'container', notes: '  ', w: 4, h: 6 }
			}
		);
		expect(r.status).toBe(200);
		expect(r.json.plot.name).toBe('Tomato Bed');
		expect(r.json.plot.type).toBe('container');
		expect(r.json.plot.notes).toBeNull();
		expect(r.json.plot.h).toBe(6);
	});

	it('rejects blank names, bad types, and zero sizes', async () => {
		const r = await call<{ error: string }>(patchPlot as Handler, {
			params: { id: String(bedId) },
			method: 'PATCH',
			body: { name: '   ', type: 'windowbox', w: 0 }
		});
		expect(r.status).toBe(400);
		expect(r.json.error).toContain('name');
		expect(r.json.error).toContain('type');
		expect(r.json.error).toContain('w');
	});

	it('rejects resize that overlaps a neighbor', async () => {
		const near = await call(createPlot as Handler, {
			params: { id: String(gardenId) },
			body: { name: 'NearBed', type: 'raised_bed', x: 44, y: 0, w: 4, h: 4 }
		});
		expect(near.status).toBe(201);
		const r = await call<{ error: string }>(patchPlot as Handler, {
			params: { id: String(bedId) },
			method: 'PATCH',
			body: { w: 5 }
		});
		expect(r.status).toBe(409);
		expect(r.json.error).toContain('NearBed');
	});
});

// Data fixing: edit plant/qty/window of any planting (current or past),
// reactivate by clearing endedOn, delete records outright.
describe('planting record edits', () => {
	const local = (daysAgo: number) => {
		const d = new Date();
		d.setDate(d.getDate() - daysAgo);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	};
	let bedId = 0;
	let pId = 0;

	it('edits quantity and harvest window of a past planting', async () => {
		const bed = await call<{ plot: { id: number } }>(createPlot as Handler, {
			params: { id: String(gardenId) },
			body: { name: 'FixBed', type: 'raised_bed', x: 50, y: 0, w: 4, h: 4 }
		});
		expect(bed.status).toBe(201);
		bedId = bed.json.plot.id;
		const p = await call<{ planting: { id: number } }>(addPlanting as Handler, {
			params: { id: String(bedId) },
			body: { plantId: 5, quantity: 4, plantedOn: local(10), x: 0, y: 0 }
		});
		expect(p.status).toBe(201);
		pId = p.json.planting.id;

		const r = await call<{ planting: { quantity: number; plantedOn: string; endedOn: string | null } }>(
			patchPlanting as Handler,
			{
				params: { id: String(pId) },
				method: 'PATCH',
				body: { quantity: 6, plantedOn: local(9), endedOn: local(1) }
			}
		);
		expect(r.status).toBe(200);
		expect(r.json.planting.quantity).toBe(6);
		expect(r.json.planting.plantedOn).toBe(local(9));
		expect(r.json.planting.endedOn).toBe(local(1));

		const h = await call<{ history: { id: number; quantity: number; endedOn: string | null }[] }>(
			getHistory as Handler,
			{ params: { id: String(bedId) } }
		);
		const row = h.json.history.find((x) => x.id === pId);
		expect(row?.quantity).toBe(6);
		expect(row?.endedOn).toBe(local(1));
	});

	it('rejects window, plant, and quantity mistakes', async () => {
		const bad = await call<{ error: string }>(patchPlanting as Handler, {
			params: { id: String(pId) },
			method: 'PATCH',
			body: { plantedOn: local(0), endedOn: local(5) }
		});
		expect(bad.status).toBe(400);
		expect(bad.json.error).toContain('before plantedOn');

		const noPlant = await call<{ error: string }>(patchPlanting as Handler, {
			params: { id: String(pId) },
			method: 'PATCH',
			body: { plantId: 999 }
		});
		expect(noPlant.status).toBe(400);
		expect(noPlant.json.error).toContain('not found');

		const zeroQty = await call<{ error: string }>(patchPlanting as Handler, {
			params: { id: String(pId) },
			method: 'PATCH',
			body: { quantity: 0 }
		});
		expect(zeroQty.status).toBe(400);

		const future = await call<{ error: string }>(patchPlanting as Handler, {
			params: { id: String(pId) },
			method: 'PATCH',
			body: { endedOn: local(-3) }
		});
		expect(future.status).toBe(400);
	});

	it('reactivates a harvested planting when endedOn is cleared', async () => {
		const todayOff = await call<{ plots: { id: number; plantings: { id: number }[] }[] }>(getPlots as Handler, {
			params: { id: String(gardenId) },
			query: `?asof=${local(0)}`
		});
		expect(todayOff.json.plots.find((p) => p.id === bedId)?.plantings.some((a) => a.id === pId)).toBe(false);

		const r = await call<{ planting: { endedOn: string | null } }>(patchPlanting as Handler, {
			params: { id: String(pId) },
			method: 'PATCH',
			body: { endedOn: null }
		});
		expect(r.status).toBe(200);
		expect(r.json.planting.endedOn).toBeNull();

		const todayOn = await call<{ plots: { id: number; plantings: { id: number }[] }[] }>(getPlots as Handler, {
			params: { id: String(gardenId) },
			query: `?asof=${local(0)}`
		});
		expect(todayOn.json.plots.find((p) => p.id === bedId)?.plantings.some((a) => a.id === pId)).toBe(true);
	});

	it('refuses quantity growth that collides with an overlapping band', async () => {
		// cucumber (spacing 0.5) qty 8 → 4×1 auto-stacked below the kale band
		const cuc = await call<{ planting: { id: number } }>(addPlanting as Handler, {
			params: { id: String(bedId) },
			body: { plantId: 7, quantity: 8, plantedOn: local(8) }
		});
		expect(cuc.status).toBe(201);
		// kale qty 12 → 4×3 ft, no longer clears the cucumber band
		const r = await call<{ error: string }>(patchPlanting as Handler, {
			params: { id: String(pId) },
			method: 'PATCH',
			body: { quantity: 12 }
		});
		expect(r.status).toBe(409);
		expect(r.json.error).toContain('overlaps');
	});

	it('deletes a planting record', async () => {
		const t = await call<{ planting: { id: number } }>(addPlanting as Handler, {
			params: { id: String(bedId) },
			body: { plantId: 1, quantity: 1, plantedOn: local(3) }
		});
		expect(t.status).toBe(201);
		const d = await call<{ deleted: number }>(deletePlanting as Handler, {
			params: { id: String(t.json.planting.id) },
			method: 'DELETE'
		});
		expect(d.status).toBe(200);
		expect(d.json.deleted).toBe(t.json.planting.id);

		const h = await call<{ history: { id: number }[] }>(getHistory as Handler, { params: { id: String(bedId) } });
		expect(h.json.history.some((x) => x.id === t.json.planting.id)).toBe(false);

		const again = await call(deletePlanting as Handler, {
			params: { id: String(t.json.planting.id) },
			method: 'DELETE'
		});
		expect(again.status).toBe(404);
	});
});
