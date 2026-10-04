// API route integration tests: garden → plot → plant → harvest lifecycle,
// overlap rejection, validation errors, and as-of replay.
import { describe, expect, it } from 'vitest';
import { GET as listGardens, POST as createGarden } from './gardens/+server.ts';
import { GET as getPlots, POST as createPlot } from './gardens/[id]/plots/+server.ts';
import { POST as addPlanting } from './plots/[id]/plantings/+server.ts';
import { PATCH as harvest } from './plantings/[id]/+server.ts';
import { GET as getHistory } from './plots/[id]/history/+server.ts';

type Handler = (event: { params: Record<string, string>; request: Request; url: URL }) => Promise<Response>;

async function call<T = Record<string, unknown>>(
	handler: Handler,
	opts: { params?: Record<string, string>; method?: string; body?: unknown; query?: string } = {}
): Promise<{ status: number; json: T }> {
	const req = new Request('http://test.local/' + (opts.query ?? ''), {
		method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
	});
	const res = await handler({ params: opts.params ?? {}, request: req, url: new URL(req.url) });
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
		const h = await call<{ planting: { endedOn: string | null } }>(harvest as Handler, {
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
		const r = await call(harvest as Handler, {
			params: { id: String(plantingId) },
			method: 'PATCH',
			body: { endedOn: '2000-01-01' }
		});
		expect(r.status).toBe(404);
	});
});
