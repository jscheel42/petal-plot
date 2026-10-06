<script lang="ts">
// Right-side drawer for the selected plot: plant/harvest, history, delete.
import { api } from '#lib/api';
import { asOfDate, isoDaysAgo } from '#lib/state.svelte.js';


type PlantRow = { id: number; name: string; variety: string; family: string; emoji: string; spacing: number; sun: string };
type HistoryRow = {
	id: number;
	plantId: number;
	name: string;
	variety: string;
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
			variety: string;
			family: string;
			emoji: string;
			quantity: number;
			plantedOn: string;
			fx: number;
			fy: number;
			fw: number;
			fh: number;
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

// inline editor for fixing any planting record (current or past)
let editingId = $state<number | null>(null);
let editName = $state('');
let editPlantId = $state(0);
let editQty = $state(1);
let editPlantedOn = $state('');
let editEndedOn = $state('');
let editErr = $state('');
let editBusy = $state(false);

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
	editingId = null;
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
					p.variety.toLowerCase().includes(search.toLowerCase()) ||
					p.family.toLowerCase().includes(search.toLowerCase())
			)
		: catalog
);
// Catalog arrives sorted family → name → variety; collapse into menu groups.
const groups = $derived.by(() => {
	const out: { family: string; items: PlantRow[] }[] = [];
	for (const p of filtered) {
		const last = out[out.length - 1];
		if (last && last.family === p.family) last.items.push(p);
		else out.push({ family: p.family, items: [p] });
	}
	return out;
});

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
		// explicit LOCAL today — server default is UTC and would roll to
		// tomorrow in UTC-negative zones, keeping the band visible a day longer
		await api(`/api/plantings/${plantingId}`, {
			method: 'PATCH',
			body: JSON.stringify({ endedOn: isoDaysAgo(0) })
		});
		showToast(`${name} harvested`);
		refresh();
		api<{ history: HistoryRow[] }>(`/api/plots/${selected.id}/history`).then((h) => (history = h.history));
	} catch (e) {
		showToast(String(e));
	}
}

function openEdit(r: { id: number; plantId: number; name: string; quantity: number; plantedOn: string; endedOn?: string | null }) {
	editingId = r.id;
	editName = r.name;
	editPlantId = r.plantId;
	editQty = r.quantity;
	editPlantedOn = r.plantedOn;
	editEndedOn = r.endedOn ?? '';
	editErr = '';
	editBusy = false;
}

async function saveEdit() {
	if (editBusy || editingId == null) return;
	editBusy = true;
	editErr = '';
	try {
		await api(`/api/plantings/${editingId}`, {
			method: 'PATCH',
			body: JSON.stringify({
				plantId: editPlantId,
				quantity: editQty,
				plantedOn: editPlantedOn,
				endedOn: editEndedOn === '' ? null : editEndedOn
			})
		});
		showToast('Planting updated');
		editingId = null;
		refresh();
		api<{ history: HistoryRow[] }>(`/api/plots/${selected.id}/history`).then((h) => (history = h.history));
	} catch (e) {
		editErr = e instanceof Error ? e.message : String(e);
		editBusy = false;
	}
}

async function removeEditing() {
	if (editingId == null) return;
	if (!confirm(`Delete the "${editName}" planting record? The plot keeps its history of everything else.`)) return;
	try {
		await api(`/api/plantings/${editingId}`, { method: 'DELETE' });
		showToast(`"${editName}" planting removed`);
		editingId = null;
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
		refresh(); // reload plots — canvas must drop the box without a browser refresh
	} catch (e) {
		showToast(String(e));
	}
}
</script>

<div class="absolute inset-y-0 right-0 z-10 flex w-96 max-w-full flex-col border-l border-stone-300 bg-white shadow-2xl max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:h-[55vh] max-sm:w-full max-sm:rounded-t-2xl max-sm:border-l-0 max-sm:border-t">
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
		<p class="mb-1 text-xs text-stone-400">Drag a dashed band on the map to reposition rows.</p>
		{#if selected.plantings.length === 0}
			<p class="text-stone-400">Nothing planted here right now.</p>
		{:else}
			<ul class="space-y-1">
				{#each selected.plantings as pl (pl.id)}
					<li class="rounded-md bg-stone-50">
						<div class="flex items-center justify-between px-2 py-1.5">
							<span>
								{pl.emoji} {pl.name}{pl.variety ? ` · ${pl.variety}` : ''} × {pl.quantity}
								<span class="text-xs text-stone-400">at ({pl.fx}, {pl.fy}) {pl.fw}×{pl.fh} ft</span>
							</span>
							<span class="flex items-center gap-1.5">
								<span class="text-stone-400">since {pl.plantedOn}</span>
								<button class="rounded px-1.5 hover:bg-stone-200" title="Edit planting" onclick={() => openEdit(pl)}>✏️</button>
								<button
									class="rounded bg-green-100 px-2 py-0.5 text-green-800 hover:bg-green-200"
									onclick={() => harvest(pl.id, pl.name)}
								>
									Harvest
								</button>
							</span>
						</div>
						{#if editingId === pl.id}
							<div class="px-2 pb-2">{@render editForm()}</div>
						{/if}
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
					{#each groups as g (g.family)}
						<div class="sticky top-0 z-[1] bg-stone-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-stone-500">
							{g.family}
						</div>
						{#each g.items as p (p.id)}
							<button
								class="flex w-full items-center justify-between px-2 py-1 text-left hover:bg-green-50 {pickedPlant?.id ===
								p.id
									? 'bg-green-100'
									: ''}"
								onclick={() => (pickedPlant = p)}
							>
								<span>{p.emoji} {p.name}{p.variety ? ` · ${p.variety}` : ''}</span>
								<span class="text-xs text-stone-400">{p.spacing}ft · {p.sun}</span>
							</button>
						{/each}
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
					<li class="rounded-md bg-stone-50">
						<div class="flex items-center justify-between px-2 py-1">
							<span>{h.emoji} {h.name}{h.variety ? ` · ${h.variety}` : ''} × {h.quantity}</span>
							<span class="flex items-center gap-1.5">
								<span class="text-stone-400">
									{h.plantedOn}
									{h.endedOn ? `→ ${h.endedOn}` : '→ growing'}
								</span>
								<button class="rounded px-1.5 hover:bg-stone-200" title="Edit record" onclick={() => openEdit(h)}>✏️</button>
							</span>
						</div>
						{#if editingId === h.id}
							<div class="px-2 pb-2">{@render editForm()}</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<div class="border-t border-stone-200 px-4 py-2">
		<button class="text-red-600 hover:underline" onclick={removePlot}>Delete plot</button>
	</div>
</div>

{#snippet editForm()}
	<div class="rounded-lg border border-sky-200 bg-sky-50/60 p-3">
		<p class="mb-2 text-xs font-bold uppercase tracking-wide text-sky-800">Fix planting record</p>
		<label class="mb-2 block text-xs font-medium text-stone-600">
			Plant
			<select class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-1" bind:value={editPlantId}>
				{#each catalog as p (p.id)}
					<option value={p.id}>{p.emoji} {p.name}{p.variety ? ` · ${p.variety}` : ''}</option>
				{/each}
			</select>
		</label>
		<div class="mb-1 grid grid-cols-3 gap-2">
			<label class="block text-xs font-medium text-stone-600">
				Qty
				<input
					type="number"
					min="1"
					step="1"
					class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1"
					bind:value={editQty}
				/>
			</label>
			<label class="block text-xs font-medium text-stone-600">
				Planted
				<input type="date" class="mt-1 w-full rounded-lg border border-stone-300 px-1 py-1" bind:value={editPlantedOn} />
			</label>
			<label class="block text-xs font-medium text-stone-600">
				Harvested
				<input type="date" class="mt-1 w-full rounded-lg border border-stone-300 px-1 py-1" bind:value={editEndedOn} />
			</label>
		</div>
		<p class="text-[11px] text-stone-400">Empty "Harvested" = still growing.</p>
		{#if editErr}<p class="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{editErr}</p>{/if}
		<div class="mt-2 flex items-center gap-2">
			<button
				class="rounded-lg bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
				disabled={editBusy}
				onclick={saveEdit}>{editBusy ? 'Saving…' : 'Save'}</button
			>
			<button class="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50" onclick={removeEditing}>
				🗑 Delete
			</button>
			<button class="ml-auto rounded-lg px-2 py-1 text-xs hover:bg-stone-100" onclick={() => (editingId = null)}>
				Cancel
			</button>
		</div>
	</div>
{/snippet}