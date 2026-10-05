// Footprint + placement math for plantings inside a plot.
// Positions are whole feet relative to the plot origin; footprints derive
// from quantity + plant spacing (cols span the plot width, rows stack).

export type Rect = { x: number; y: number; w: number; h: number };

export function footprint(quantity: number, spacing: number, plotW: number): { w: number; h: number } {
	const cols = Math.max(1, Math.floor(plotW / spacing));
	const rows = Math.max(1, Math.ceil(quantity / cols));
	return { w: cols * spacing, h: rows * spacing };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.w && b.x < a.x + b.w && a.y < b.y + b.h && b.y < a.y + b.h;
}

// First free integer anchor for a footprint in a plot (scan top-to-bottom,
// left-to-right), avoiding occupied rects. Null when the plot is full.
export function autoPlace(
	plotW: number,
	plotH: number,
	fp: { w: number; h: number },
	occupied: Rect[]
): { x: number; y: number } | null {
	if (fp.w > plotW || fp.h > plotH) return null;
	for (let y = 0; y + fp.h <= plotH; y++) {
		for (let x = 0; x + fp.w <= plotW; x++) {
			const r: Rect = { x, y, w: fp.w, h: fp.h };
			if (!occupied.some((o) => rectsOverlap(r, o))) return { x, y };
		}
	}
	return null;
}
