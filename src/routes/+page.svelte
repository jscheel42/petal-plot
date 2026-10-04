<script lang="ts">
import { api } from '#lib/api';
import Canvas from '#lib/components/Canvas.svelte';
import DetailPanel from '#lib/components/DetailPanel.svelte';
import { asOfDate, store } from '#lib/state.svelte.js';


type PlantingView = {
	id: number;
	plantId: number;
	name: string;
	family: string;
	emoji: string;
	quantity: number;
	spacing: number;
	plantedOn: string;
};
type PlotView = {
	id: number;
	name: string;
	type: 'in_ground' | 'raised_bed' | 'container';
	x: number;
	y: number;
	w: number;
	h: number;
	notes: string | null;
	plantings: PlantingView[];
	warning: string | null;
};

let plots = $state<PlotView[]>([]);
let selectedId = $state<number | null>(null);
let createRect = $state<{ x: number; y: number; w: number; h: number } | null>(null);
let createName = $state('');
let createType = $state<'in_ground' | 'raised_bed' | 'container'>('raised_bed');
let toast = $state<string | null>(null);

function showToast(msg: string) {
	toast = msg;
	setTimeout(() => (toast = null), 3500);
}

function refresh() {
	if (store.currentGardenId == null) return;
	api<{ plots: PlotView[] }>(`/api/gardens/${store.currentGardenId}/plots?asof=${asOfDate()}`)
		.then((r) => {
			plots = r.plots;
			if (selectedId != null && !plots.some((p) => p.id === selectedId)) selectedId = null;
		})
		.catch((e) => showToast(String(e)));
}

$effect(() => {
	void store.currentGardenId;
	void store.daysAgo;
	const t = setTimeout(refresh, 120); // debounce slider scrubbing
	return () => clearTimeout(t);
});

function onCreated(rect: { x: number; y: number; w: number; h: number }) {
	createRect = rect;
	createName = `Bed ${plots.length + 1}`;
	createType = 'raised_bed';
}

async function submitCreate() {
	if (!createRect || store.currentGardenId == null) return;
	try {
		const r = await api<{ plot: PlotView }>(`/api/gardens/${store.currentGardenId}/plots`, {
			method: 'POST',
			body: JSON.stringify({ ...createRect, name: createName, type: createType })
		});
		createRect = null;
		refresh();
	} catch (e) {
		showToast(String(e));
		createRect = null;
	}
}

function onMoved(id: number, x: number, y: number) {
	api(`/api/plots/${id}`, { method: 'PATCH', body: JSON.stringify({ x, y }) })
		.then(refresh)
		.catch((e) => showToast(String(e)));
}

function onResized(id: number, x: number, y: number, w: number, h: number) {
	api(`/api/plots/${id}`, { method: 'PATCH', body: JSON.stringify({ x, y, w, h }) })
		.then(refresh)
		.catch((e) => showToast(String(e)));
}

function onSelect(id: number | null) {
	selectedId = id;
}

const selected = $derived(plots.find((p) => p.id === selectedId) ?? null);
</script>

<div class="absolute inset-0">
	<Canvas
		{plots}
		{selectedId}
		gardenKey={store.currentGardenId}
		oncreated={onCreated}
		onmoved={onMoved}
		onresized={onResized}
		onselect={onSelect}
	/>
</div>

{#if createRect}
	<div class="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
		<div class="w-80 rounded-xl bg-white p-5 shadow-xl">
			<h2 class="mb-3 text-lg font-semibold">New plot</h2>
			<p class="mb-3 text-sm text-stone-500">
				{createRect.w}×{createRect.h} ft at ({createRect.x}, {createRect.y})
			</p>
			<label class="mb-3 block text-sm">
				Name
				<input
					class="mt-1 w-full rounded border border-stone-300 px-2 py-1"
					bind:value={createName}
					onkeydown={(e) => e.key === 'Enter' && submitCreate()}
				/>
			</label>
			<label class="mb-4 block text-sm">
				Type
				<select class="mt-1 w-full rounded border border-stone-300 px-2 py-1" bind:value={createType}>
					<option value="raised_bed">Raised bed</option>
					<option value="in_ground">In ground</option>
					<option value="container">Container</option>
				</select>
			</label>
			<div class="flex justify-end gap-2">
				<button class="rounded px-3 py-1 text-sm hover:bg-stone-100" onclick={() => (createRect = null)}>
					Cancel
				</button>
				<button
					class="rounded bg-green-700 px-3 py-1 text-sm text-white hover:bg-green-800"
					onclick={submitCreate}
				>
					Create
				</button>
			</div>
		</div>
	</div>
{/if}

{#if selected}
	<DetailPanel {selected} onClose={() => (selectedId = null)} {showToast} {refresh} />
{/if}

{#if toast}
	<div class="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">
		{toast}
	</div>
{/if}