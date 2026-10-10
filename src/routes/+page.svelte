<script lang="ts">
import { api } from '#lib/api';
import Canvas from '#lib/components/Canvas.svelte';
import DetailPanel from '#lib/components/DetailPanel.svelte';
import PlotEditor from '#lib/components/PlotEditor.svelte';
import { asOfDate, store } from '#lib/state.svelte.js';


type PlantingView = {
	id: number;
	plantId: number;
	name: string;
	variety: string;
	family: string;
	emoji: string;
	quantity: number;
	spacing: number;
	plantedOn: string;
	fx: number;
	fy: number;
	fw: number;
	fh: number;
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
// right-click editor popover anchored at the click point
let ctx = $state<{ plotId: number; x: number; y: number } | null>(null);
let createName = $state('');
let createType = $state<'in_ground' | 'raised_bed' | 'container'>('raised_bed');
let toast = $state<string | null>(null);

function showToast(msg: string) {
	toast = msg;
	setTimeout(() => (toast = null), 3500);
}

// Edit mode: anonymous visitors are read-only; the shared password unlocks
// writes (pp_admin cookie, 12h). Blocked writes raise 'ppsignin' → modal.
let authed = $state(true);
let showAuth = $state(false);
let pw = $state('');
let authErr = $state('');
$effect(() => {
	const h = () => {
		authed = false;
		showAuth = true;
	};
	window.addEventListener('ppsignin', h);
	return () => window.removeEventListener('ppsignin', h);
});
$effect(() => {
	api<{ authed: boolean }>('/api/auth/session')
		.then((r) => (authed = r.authed))
	.catch(() => {});
});
async function unlock() {
	authErr = '';
	try {
		await api('/api/auth/session', { method: 'POST', body: JSON.stringify({ password: pw }) });
		authed = true;
		showAuth = false;
		pw = '';
		showToast('✏️ Editing unlocked');
	} catch (e) {
		authErr = String(e).replace('Error: ', '');
	}
}
async function lock() {
	await api('/api/auth/session', { method: 'DELETE' }).catch(() => {});
	authed = false;
	showToast('🔒 Locked — read-only');
}

function onPlotContext(plotId: number, x: number, y: number) {
	ctx = { plotId, x, y };
}

// drop the popover if its plot disappears (deleted elsewhere / garden switch)
$effect(() => {
	if (ctx && !plots.some((p) => p.id === ctx?.plotId)) ctx = null;
});

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
	if (!createRect || store.currentGardenId == null || createClash) return;
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

function onPlantMoved(id: number, x: number, y: number) {
	api(`/api/plantings/${id}`, { method: 'PATCH', body: JSON.stringify({ x, y }) })
		.then(refresh)
		.catch((e) => showToast(String(e)));
}

function onSelect(id: number | null) {
	selectedId = id;
}

const selected = $derived(plots.find((p) => p.id === selectedId) ?? null);

const createClash = $derived(
	createRect
		? (plots.find(
				(p) =>
					createRect!.x < p.x + p.w &&
					p.x < createRect!.x + createRect!.w &&
					createRect!.y < p.y + p.h &&
					p.y < createRect!.y + createRect!.h
			) ?? null)
		: null
);
</script>

<div class="absolute inset-0">
	<Canvas
		{plots}
		{selectedId}
		gardenKey={store.currentGardenId}
		oncreated={onCreated}
		onmoved={onMoved}
		onresized={onResized}
		onplantmoved={onPlantMoved}
		onplotcontext={onPlotContext}
		onselect={onSelect}
	/>
</div>

{#if createRect}
	<div class="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
		<div class="w-80 rounded-xl bg-white p-5 shadow-xl">
			<h2 class="mb-3 text-lg font-semibold">New plot</h2>
			{#if createClash}
				<p class="mb-3 text-sm font-medium text-red-600">
					Overlaps "{createClash.name}" at ({createClash.x}, {createClash.y})
					{createClash.w}×{createClash.h} ft — cancel and drag somewhere else
				</p>
			{:else}
				<p class="mb-3 text-sm text-green-700">
					✓ {createRect.w}×{createRect.h} ft at ({createRect.x}, {createRect.y})
				</p>
			{/if}
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
					class="rounded px-3 py-1 text-sm text-white {createClash
						? 'cursor-not-allowed bg-stone-300'
						: 'bg-green-700 hover:bg-green-800'}"
					disabled={createClash !== null}
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

{#if ctx}
	{#key ctx.plotId}
		{@const cp = plots.find((p) => p.id === ctx?.plotId)}
		{#if cp}
			<PlotEditor plot={cp} x={ctx.x} y={ctx.y} onclose={() => (ctx = null)} onsaved={refresh} {showToast} />
		{/if}
	{/key}
{/if}

{#if toast}
	<div class="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-lg bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">
		{toast}
	</div>
{/if}

<div class="fixed left-1/2 top-3 z-40 -translate-x-1/2">
	{#if authed}
		<div class="flex items-center gap-2 rounded-full bg-green-600/90 px-3 py-1 text-xs text-white shadow">
			✏️ Editing
			<button class="underline hover:no-underline" onclick={lock}>Log out</button>
		</div>
	{:else}
		<button class="rounded-full bg-stone-800/85 px-3 py-1 text-xs text-white shadow hover:bg-stone-700" onclick={() => (showAuth = true)}>
			🔒 View-only — unlock editing
		</button>
	{/if}
</div>

{#if showAuth}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-label="Unlock editing">
		<form class="w-72 rounded-xl bg-white p-5 shadow-xl" onsubmit={(e) => { e.preventDefault(); void unlock(); }}>
			<h2 class="mb-1 text-base font-semibold">🔒 Unlock editing</h2>
			<p class="mb-3 text-xs text-stone-500">Anyone can view the garden; the password enables planting, editing and deleting.</p>
			<input
				type="password"
				bind:value={pw}
				class="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
				placeholder="Password"
				autocomplete="current-password"
			/>
			{#if authErr}<p class="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{authErr}</p>{/if}
			<div class="mt-3 flex justify-end gap-2">
				<button type="button" class="rounded px-3 py-1.5 text-sm text-stone-500 hover:bg-stone-100" onclick={() => (showAuth = false)}>Cancel</button>
				<button type="submit" class="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700">Unlock</button>
			</div>
		</form>
	</div>
{/if}