<script lang="ts">
// Right-side drawer for the selected plot: plant/harvest, history, delete.
import { api } from '#lib/api';
import { asOfDate } from '#lib/state.svelte.js';


type PlantRow = { id: number; name: string; family: string; emoji: string; spacing: number; sun: string };
type HistoryRow = {
	id: number;
	name: string;
	emoji: string;
	family: string;
	quantity: number;
	plantedOn: string;
	endedOn: string | null;
};

let {
	selected,
	onClose,
	showToast,
	refresh
}: {
	selected: {
		id: number;
		name: string;
		type: 'in_ground' | 'raised_bed' | 'container';
		x: number;
		y: number;
		w: number;
		h: number;
		notes: string | null;
		plantings: {
			id: number;
			plantId: number;
			name: string;
			family: string;
			emoji: string;
			quantity: number;
			plantedOn: string;
		}[];
		warning: string | null;
	};
	onClose: () => void;
	showToast: (msg: string) => void;
	refresh: () => void;
} = $props();

let catalog = $state<PlantRow[]>([]);
let history = $state<HistoryRow[]>([]);
let picking = $state(false);
let search = $state('');
let pickedPlant = $state<PlantRow | null>(null);
let quantity = $state(1);
let plantedOn = $state(asOfDate());

$effect(() => {
	if (catalog.length === 0) {
		api<{ plants: PlantRow[] }>('/api/plants')
			.then((r) => (catalog = r.plants))
			.catch((e) => showToast(String(e)));
	}
});

$effect(() => {
	const id = selected.id;
	picking = false;
	pickedPlant = null;
	search = '';
	quantity = 1;
	plantedOn = asOfDate();
	api<{ history: HistoryRow[] }>(`/api/plots/${id}/history`)
		.then((r) => (history = r.history))
		.catch(() => (history = []));
});

const filtered = $derived(
	search.trim()
		? catalog.filter(
				(p) =>
					p.name.toLowerCase().includes(search.toLowerCase()) ||
					p.family.toLowerCase().includes(search.toLowerCase())
			)
		: catalog
);

async function plant() {
	const p = pickedPlant;
	if (!p) return;
	try {
		const r = await api<{ warnings: { message: string }[] }>(`/api/plots/${selected.id}/plantings`, {
			method: 'POST',
			body: JSON.stringify({ plantId: p.id, quantity, plantedOn })
		});
		picking = false;
		pickedPlant = null;
		if (r.warnings.length > 0) showToast(r.warnings[0].message);
		else showToast(`${p.emoji} ${p.name} planted`);
		// refresh panel data
		refresh();
		api<{ history: HistoryRow[] }>(`/api/plots/${selected.id}/history`).then((h) => (history = h.history));
	} catch (e) {
		showToast(String(e));
	}
}

async function harvest(plantingId: number, name: string) {
	try {
		await api(`/api/plantings/${plantingId}`, { method: 'PATCH', body: JSON.stringify({}) });
		showToast(`${name} harvested`);
		refresh();
		api<{ history: HistoryRow[] }>(`/api/plots/${selected.id}/history`).then((h) => (history = h.history));
	} catch (e) {
		showToast(String(e));
	}
}

async function removePlot() {
	if (!confirm(`Delete "${selected.name}" and all its planting history?`)) return;
	try {
		await api(`/api/plots/${selected.id}`, { method: 'DELETE' });
		onClose();
	} catch (e) {
		showToast(String(e));
	}
}
</script>

<div class="absolute inset-y-0 right-0 z-10 flex w-96 max-w-full flex-col border-l border-stone-300 bg-white shadow-2xl">
	<div class="flex items-center justify-between border-b border-stone-200 px-4 py-3">
		<h2 class="text-lg font-semibold">{selected.name}</h2>
		<button class="rounded px-2 py-0.5 text-stone-500 hover:bg-stone-100" onclick={onClose}>✕</button>
	</div>

	<div class="flex-1 overflow-y-auto px-4 py-3 text-sm">
		<p class="text-stone-500">
			{selected.type === 'in_ground' ? 'In ground' : selected.type === 'raised_bed' ? 'Raised bed' : 'Container'}
			· {selected.w}×{selected.h} ft at ({selected.x}, {selected.y})
		</p>

		{#if selected.warning}
			<div class="mt-2 rounded-md bg-amber-50 p-2 text-amber-800 ring-1 ring-amber-200">
				⚠️ {selected.warning}
			</div>
		{/if}

		<h3 class="mb-1 mt-4 font-semibold">Current plantings</h3>
		{#if selected.plantings.length === 0}
			<p class="text-stone-400">Nothing planted here right now.</p>
		{:else}
			<ul class="space-y-1">
				{#each selected.plantings as pl (pl.id)}
					<li class="flex items-center justify-between rounded-md bg-stone-50 px-2 py-1.5">
						<span>{pl.emoji} {pl.name} × {pl.quantity}</span>
						<span class="text-stone-400">since {pl.plantedOn}</span>
						<button
							class="rounded bg-green-100 px-2 py-0.5 text-green-800 hover:bg-green-200"
							onclick={() => harvest(pl.id, pl.name)}
						>
							Harvest
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if !picking}
			<button
				class="mt-3 w-full rounded-lg bg-green-700 py-2 font-medium text-white hover:bg-green-800"
				onclick={() => (picking = true)}
			>
				＋ Plant here
			</button>
		{:else}
			<div class="mt-3 rounded-lg border border-green-200 bg-green-50/50 p-3">
				<input
					class="w-full rounded border border-stone-300 px-2 py-1"
					placeholder="Search catalog (tomato, brassica…)"
					bind:value={search}
				/>
				<div class="mt-2 max-h-48 overflow-y-auto rounded border border-stone-200 bg-white">
					{#each filtered as p (p.id)}
						<button
							class="flex w-full items-center justify-between px-2 py-1 text-left hover:bg-green-50 {pickedPlant?.id ===
							p.id
								? 'bg-green-100'
								: ''}"
							onclick={() => (pickedPlant = p)}
						>
							<span>{p.emoji} {p.name}</span>
							<span class="text-xs text-stone-400">{p.family} · {p.spacing}ft · {p.sun}</span>
						</button>
					{/each}
				</div>
				{#if pickedPlant}
					<div class="mt-2 flex items-center gap-2">
						<label class="flex items-center gap-1">
							Qty
							<input
								type="number"
								min="1"
								class="w-16 rounded border border-stone-300 px-1 py-0.5"
								bind:value={quantity}
							/>
						</label>
						<label class="flex items-center gap-1">
							Date
							<input type="date" class="rounded border border-stone-300 px-1 py-0.5" bind:value={plantedOn} />
						</label>
					</div>
					<div class="mt-2 flex justify-end gap-2">
						<button class="rounded px-2 py-1 hover:bg-stone-100" onclick={() => (picking = false)}>Cancel</button>
						<button class="rounded bg-green-700 px-3 py-1 text-white hover:bg-green-800" onclick={plant}>
							Plant {pickedPlant.emoji}
						</button>
					</div>
				{/if}
			</div>
		{/if}

		<h3 class="mb-1 mt-6 font-semibold">History</h3>
		{#if history.length === 0}
			<p class="text-stone-400">No history yet.</p>
		{:else}
			<ul class="space-y-1">
				{#each history as h (h.id)}
					<li class="flex justify-between rounded-md bg-stone-50 px-2 py-1">
						<span>{h.emoji} {h.name} × {h.quantity}</span>
						<span class="text-stone-400">
							{h.plantedOn}
							{h.endedOn ? `→ ${h.endedOn}` : '→ growing'}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<div class="border-t border-stone-200 px-4 py-2">
		<button class="text-red-600 hover:underline" onclick={removePlot}>Delete plot</button>
	</div>
</div>