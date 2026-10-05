<script lang="ts">
import { api } from '#lib/api';
import { onDestroy, onMount } from 'svelte';

type Editable = { id: number; name: string; type: string; w: number; h: number; notes: string | null };

let {
	plot,
	x,
	y,
	onclose,
	onsaved,
	showToast
}: {
	plot: Editable;
	x: number;
	y: number;
	onclose: () => void;
	onsaved: () => void;
	showToast: (msg: string) => void;
} = $props();

let name = $state('');
let type = $state('');
let w = $state(0);
let h = $state(0);
let notes = $state('');
// seed from the plot (component is {#key}-remounted per plot, and the
// prop only refreshes after save/close — never mid-edit)
$effect(() => {
	name = plot.name;
	type = plot.type;
	w = plot.w;
	h = plot.h;
	notes = plot.notes ?? '';
});
let busy = $state(false);
let err = $state('');
let el: HTMLDivElement | undefined = $state();

// keep the popover on-screen near the click point
const left = $derived(Math.max(8, Math.min(x, window.innerWidth - 300)));
const top = $derived(Math.max(8, Math.min(y, window.innerHeight - 340)));

async function save() {
	if (busy) return;
	busy = true;
	err = '';
	try {
		await api(`/api/plots/${plot.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ name, type, w, h, notes })
		});
		showToast(`${name.trim()} updated`);
		onsaved();
		onclose();
	} catch (e) {
		err = e instanceof Error ? e.message : String(e);
		busy = false;
	}
}

async function del() {
	if (!confirm(`Delete "${plot.name}" and all its planting history?`)) return;
	try {
		await api(`/api/plots/${plot.id}`, { method: 'DELETE' });
		showToast(`Plot "${plot.name}" deleted`);
		onsaved();
		onclose();
	} catch (e) {
		err = e instanceof Error ? e.message : String(e);
	}
}

function onKey(e: KeyboardEvent) {
	if (e.key === 'Escape') {
		e.stopPropagation();
		onclose();
	}
}
function onDocPointer(e: PointerEvent) {
	if (el && !el.contains(e.target as Node)) onclose();
}

onMount(() => {
	document.addEventListener('keydown', onKey, true);
	document.addEventListener('pointerdown', onDocPointer, true);
});
onDestroy(() => {
	document.removeEventListener('keydown', onKey, true);
	document.removeEventListener('pointerdown', onDocPointer, true);
});
</script>

<div
	bind:this={el}
	class="fixed z-50 w-72 rounded-xl border border-stone-200 bg-white p-3 shadow-xl"
	style:left={`${left}px`}
	style:top={`${top}px`}
	role="dialog"
	aria-label={`Edit ${plot.name}`}
>
	<div class="mb-2 flex items-center justify-between">
		<h2 class="text-sm font-bold text-stone-800">Edit plot</h2>
		<button class="text-stone-400 hover:text-stone-600" onclick={onclose} aria-label="Close">✕</button>
	</div>
	<label class="mb-2 block text-xs font-medium text-stone-600">
		Name
		<input
			bind:value={name}
			class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1 text-sm focus:border-green-500 focus:outline-none"
			onkeydown={(e) => e.key === 'Enter' && save()}
		/>
	</label>
	<label class="mb-2 block text-xs font-medium text-stone-600">
		Type
		<select
			bind:value={type}
			class="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm focus:border-green-500 focus:outline-none"
		>
			<option value="in_ground">In-ground</option>
			<option value="raised_bed">Raised bed</option>
			<option value="container">Container</option>
		</select>
	</label>
	<div class="mb-2 grid grid-cols-2 gap-2">
		<label class="block text-xs font-medium text-stone-600">
			Width (ft)
			<input
				type="number"
				min="1"
				step="1"
				bind:value={w}
				class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1 text-sm focus:border-green-500 focus:outline-none"
			/>
		</label>
		<label class="block text-xs font-medium text-stone-600">
			Length (ft)
			<input
				type="number"
				min="1"
				step="1"
				bind:value={h}
				class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1 text-sm focus:border-green-500 focus:outline-none"
			/>
		</label>
	</div>
	<label class="mb-2 block text-xs font-medium text-stone-600">
		Notes
		<textarea
			bind:value={notes}
			rows="2"
			class="mt-1 w-full resize-none rounded-lg border border-stone-300 px-2 py-1 text-sm focus:border-green-500 focus:outline-none"
			placeholder="soil amendments, sun notes…"
		></textarea>
	</label>
	{#if err}<p class="mb-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{err}</p>{/if}
	<div class="flex items-center gap-2">
		<button
			class="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
			disabled={busy || !name.trim()}
			onclick={save}>{busy ? 'Saving…' : 'Save'}</button
		>
		<button class="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100" onclick={onclose}>
			Cancel
		</button>
		<button class="ml-auto rounded-lg px-2 py-1.5 text-sm text-red-600 hover:bg-red-50" onclick={del}>
			🗑️ Delete
		</button>
	</div>
</div>
