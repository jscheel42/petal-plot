// Client-side shared state (Svelte 5 runes). Garden selection + as-of date.
export const store = $state({
	/** @type {{id:number,name:string}[]} */
	gardens: [],
	/** @type {number|null} */
	currentGardenId: null,
	// History slider: days back from today. 0 = live view.
	daysAgo: 0
});

/** @param {number} n */
export function isoDaysAgo(n) {
	const d = new Date();
	d.setDate(d.getDate() - n);
	// format from LOCAL components; toISOString() would roll forward in UTC-negative zones
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function asOfDate() {
	return isoDaysAgo(store.daysAgo);
}
