<script lang="ts">
import '../app.css';
import { api } from '#lib/api';
import { asOfDate, store } from '#lib/state.svelte.js';
import { onMount } from 'svelte';

let { children } = $props();

onMount(async () => {
	try {
		const { gardens } = await api<{ gardens: { id: number; name: string }[] }>('/api/gardens');
		store.gardens = gardens;
		const saved = Number(localStorage.getItem('petalPlot.gardenId'));
		store.currentGardenId = gardens.some((g) => g.id === saved) ? saved : gardens[0]?.id ?? null;
	} catch (e) {
		console.error(e);
	}
});

function selectGarden() {
	if (store.currentGardenId != null) localStorage.setItem('petalPlot.gardenId', String(store.currentGardenId));
}

async function newGarden() {
	const name = prompt('Name your new garden:');
	if (!name?.trim()) return;
	try {
		const { garden } = await api<{ garden: { id: number; name: string } }>('/api/gardens', {
			method: 'POST',
			body: JSON.stringify({ name })
		});
		const { gardens } = await api<{ gardens: { id: number; name: string }[] }>('/api/gardens');
		store.gardens = gardens;
		store.currentGardenId = garden.id;
		localStorage.setItem('petalPlot.gardenId', String(garden.id));
	} catch (e) {
		alert(String(e));
	}
}
</script>

<div class="flex h-screen flex-col">
	<header class="flex items-center gap-4 border-b border-stone-300 bg-white px-4 py-2 shadow-sm max-sm:gap-2 max-sm:px-2">
		<div class="text-lg font-bold text-green-800">🌱 <span class="max-sm:hidden">Petal Plot</span></div>

		<select
			class="rounded border border-stone-300 bg-white px-2 py-1 text-sm"
			bind:value={store.currentGardenId}
			onchange={selectGarden}
		>
			{#if store.gardens.length === 0}
				<option value={null}>No gardens yet</option>
			{/if}
			{#each store.gardens as g (g.id)}
				<option value={g.id}>{g.name}</option>
			{/each}
		</select>
		<button class="rounded bg-green-700 px-2 py-1 text-sm text-white hover:bg-green-800" onclick={newGarden}>
			＋<span class="max-sm:hidden"> New garden</span>
		</button>

		<div class="ml-auto flex items-center gap-3 max-sm:gap-1.5">
			{#if store.daysAgo > 0}
				<span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold tracking-wide text-amber-800">
					REPLAY
				</span>
			{/if}
			<label class="flex items-center gap-2 text-sm">
				🕰️
				<input type="range" min="0" max="365" bind:value={store.daysAgo} class="w-52 max-sm:w-24" />
				<span class="w-24 tabular-nums font-medium max-sm:w-20 max-sm:text-xs">{asOfDate()}</span>
			</label>
			{#if store.daysAgo > 0}
				<button
					class="rounded bg-stone-800 px-2 py-1 text-xs text-white hover:bg-stone-700"
					onclick={() => (store.daysAgo = 0)}
				>
					Today
				</button>
			{/if}
			<details class="relative">
				<summary class="cursor-pointer list-none rounded px-2 py-1 text-sm hover:bg-stone-100">?</summary>
				<div
					class="absolute right-0 top-8 z-40 w-72 rounded-lg border border-stone-200 bg-white p-3 text-xs shadow-xl"
				>
					<p class="mb-1 font-bold">Controls</p>
					<ul class="list-disc space-y-0.5 pl-4">
						<li>Drag empty grid → create plot</li>
						<li>Click plot → open panel (plant/harvest/history)</li>
						<li>Drag plot → move · corner handles → resize</li>
						<li>✏️ any planting (now or past) → fix plant, qty, dates · remove it</li>
						<li>Touch: 1 finger drag → pan · tap → select</li>
						<li>Touch: pinch → zoom · long-press plot → edit popover</li>
						<li>Scroll → zoom at cursor · space + drag → pan</li>
						<li>🏷️ (`l`) → show/hide plot labels (off by default)</li>
						<li>Esc → close panels</li>
						<li>North ↑ compass · view auto-saves per garden</li>
						<li>Slider → replay any past date</li>
					</ul>
				</div>
			</details>
		</div>
	</header>

	<main class="relative flex-1 overflow-hidden">
		{@render children()}
	</main>
</div>