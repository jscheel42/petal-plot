<script lang="ts">
// Canvas plot editor: pan/zoom grid, drag-create, move, resize.
// World units = feet. Screen = pixels. view.vx/vy = world coord at screen origin.
import { onMount, tick } from 'svelte';

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

let {
	plots,
	selectedId,
	gardenKey,
	oncreated,
	onmoved,
	onresized,
	onselect
}: {
	plots: PlotView[];
	selectedId: number | null;
	gardenKey: number | null;
	oncreated: (rect: { x: number; y: number; w: number; h: number }) => void;
	onmoved: (id: number, x: number, y: number) => void;
	onresized: (id: number, x: number, y: number, w: number, h: number) => void;
	onselect: (id: number | null) => void;
} = $props();

let canvas = $state<HTMLCanvasElement | undefined>();
let view = $state({ vx: 0, vy: 0, scale: 26 }); // px per ft
let drag = $state<Drag | null>(null);
let spaceDown = $state(false);
let fittedFor = $state<number | null>(null);

type Drag =
	| { mode: 'pan'; sx: number; sy: number; v0: { vx: number; vy: number; scale: number } }
	| { mode: 'create'; ax: number; ay: number; cx: number; cy: number }
	| { mode: 'move'; id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean }
	| {
			mode: 'resize';
			id: number;
			corner: 'nw' | 'ne' | 'sw' | 'se';
			ox: number;
			oy: number;
			ow: number;
			oh: number;
	  };

const FAMILY_COLORS: Record<string, string> = {
	Solanaceae: '#e74c3c',
	Brassicaceae: '#16a34a',
	Cucurbitaceae: '#84cc16',
	Fabaceae: '#f59e0b',
	Amaryllidaceae: '#8b5cf6',
	Apiaceae: '#f97316',
	Amaranthaceae: '#14b8a6',
	Asteraceae: '#eab308',
	Lamiaceae: '#6366f1',
	Rosaceae: '#ec4899',
	Poaceae: '#a8a29e'
};
const SOIL = '#8d6e63';
const SOIL_DARK = '#5d4037';
const ACCENT = '#0ea5e9';

function toWorld(px: number, py: number) {
	return { x: px / view.scale + view.vx, y: py / view.scale + view.vy };
}
function toScreen(wx: number, wy: number) {
	return { x: (wx - view.vx) * view.scale, y: (wy - view.vy) * view.scale };
}
function hitTest(wx: number, wy: number): PlotView | null {
	for (let i = plots.length - 1; i >= 0; i--) {
		const p = plots[i];
		if (wx >= p.x && wx < p.x + p.w && wy >= p.y && wy < p.y + p.h) return p;
	}
	return null;
}

function fit(plotsToDraw: PlotView[]) {
	const el = canvas;
	if (!el) return;
	const cw = el.clientWidth,
		ch = el.clientHeight;
	let minX = 0,
		minY = 0,
		maxX = 16,
		maxY = 10;
	for (const p of plotsToDraw) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x + p.w);
		maxY = Math.max(maxY, p.y + p.h);
	}
	const spanX = maxX - minX,
		spanY = maxY - minY;
	const s = Math.min(cw / spanX, ch / spanY);
	view.scale = Math.min(60, Math.max(6, s));
	view.vx = minX - (cw / view.scale - spanX) / 2;
	view.vy = minY - (ch / view.scale - spanY) / 2;
	draw();
}

function draw() {
	const el = canvas;
	if (!el) return;
	const parent = el.parentElement;
	if (!parent) return;
	const cw = parent.clientWidth,
		ch = parent.clientHeight;
	const dpr = window.devicePixelRatio || 1;
	if (el.width !== Math.round(cw * dpr) || el.height !== Math.round(ch * dpr)) {
		el.width = Math.round(cw * dpr);
		el.height = Math.round(ch * dpr);
		el.style.width = `${cw}px`;
		el.style.height = `${ch}px`;
	}
	const ctx = el.getContext('2d');
	if (!ctx) return;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.fillStyle = '#f6f7f4';
	ctx.fillRect(0, 0, cw, ch);

	const s = view.scale;
	// grid
	ctx.lineWidth = 1;
	const minX = Math.floor(view.vx),
		maxX = Math.ceil(view.vx + cw / s);
	const minY = Math.floor(view.vy),
		maxY = Math.ceil(view.vy + ch / s);
	for (let gx = minX; gx <= maxX; gx++) {
		const X = Math.round((gx - view.vx) * s) + 0.5;
		ctx.strokeStyle = gx % 5 === 0 ? '#d6d3d1' : '#e7e5e4';
		ctx.beginPath();
		ctx.moveTo(X, 0);
		ctx.lineTo(X, ch);
		ctx.stroke();
	}
	for (let gy = minY; gy <= maxY; gy++) {
		const Y = Math.round((gy - view.vy) * s) + 0.5;
		ctx.strokeStyle = gy % 5 === 0 ? '#d6d3d1' : '#e7e5e4';
		ctx.beginPath();
		ctx.moveTo(0, Y);
		ctx.lineTo(cw, Y);
		ctx.stroke();
	}

	// plots
	for (const p of plots) {
		const { x: X, y: Y } = toScreen(p.x, p.y);
		const W = p.w * s,
			H = p.h * s;
		if (X + W < 0 || Y + H < 0 || X > cw || Y > ch) continue;
		// soil fill
		ctx.fillStyle = SOIL;
		ctx.fillRect(X, Y, W, H);
		// furrow texture
		ctx.strokeStyle = 'rgba(0,0,0,0.08)';
		for (let fy = Y + 4; fy < Y + H; fy += 6) {
			ctx.beginPath();
			ctx.moveTo(X, fy);
			ctx.lineTo(X + W, fy);
			ctx.stroke();
		}
		// planting bands (stacked vertically, emoji grid per planting)
		let usedRows = 0;
		for (const pl of p.plantings) {
			const cols = Math.max(1, Math.floor(p.w / pl.spacing));
			const maxRows = Math.max(0, Math.floor((p.h - usedRows * pl.spacing) / pl.spacing));
			const rows = Math.max(0, Math.min(Math.ceil(pl.quantity / cols), maxRows));
			const cell = pl.spacing * s;
			for (let r = 0; r < rows; r++) {
				for (let c = 0; c < cols; c++) {
					const n = r * cols + c;
					if (n >= pl.quantity) break;
					const ex = X + (c + 0.5) * cell;
					const ey = Y + ((usedRows + r) * pl.spacing + 0.5) * s;
					ctx.font = `${Math.max(8, Math.min(28, cell * 0.75))}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
					ctx.textAlign = 'center';
					ctx.textBaseline = 'middle';
					ctx.fillText(pl.emoji, ex, ey);
				}
			}
			usedRows += rows;
		}
		// border + labels
		const sel = p.id === selectedId;
		ctx.strokeStyle = sel ? ACCENT : SOIL_DARK;
		ctx.lineWidth = sel ? 3 : 1.5;
		ctx.strokeRect(X + 0.5, Y + 0.5, W - 1, H - 1);
		ctx.fillStyle = '#ffffff';
		ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		ctx.shadowColor = 'rgba(0,0,0,0.6)';
		ctx.shadowBlur = 3;
		ctx.fillText(`${p.name} · ${p.w}×${p.h}ft`, X + 5, Y + 4);
		ctx.shadowBlur = 0;
		if (p.warning) {
			ctx.textAlign = 'right';
			ctx.fillText('⚠️', X + W - 5, Y + 4);
		}
		// selection handles
		if (sel) {
			ctx.fillStyle = ACCENT;
			for (const [hx, hy] of [
				[X, Y],
				[X + W, Y],
				[X, Y + H],
				[X + W, Y + H]
			]) {
				ctx.fillRect(hx - 4, hy - 4, 8, 8);
			}
		}
	}

	// rubber band
	if (drag && drag.mode === 'create') {
		const a = toScreen(drag.ax, drag.ay);
		const b = toScreen(drag.cx, drag.cy);
		const rx = Math.min(a.x, b.x),
			ry = Math.min(a.y, b.y);
		const rw = Math.abs(b.x - a.x),
			rh = Math.abs(b.y - a.y);
		ctx.setLineDash([6, 4]);
		ctx.strokeStyle = ACCENT;
		ctx.lineWidth = 2;
		ctx.strokeRect(rx, ry, rw, rh);
		ctx.setLineDash([]);
		ctx.fillStyle = ACCENT;
		ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
		ctx.textAlign = 'left';
		ctx.fillText(
			`${Math.round(rw / s)}×${Math.round(rh / s)} ft`,
			rx + 6,
			ry + 6
		);
	}
}


function onPointerDown(e: PointerEvent) {
	const el = canvas;
	if (!el) return;
	el.setPointerCapture(e.pointerId);
	const px = e.offsetX,
		py = e.offsetY;
	if (e.button === 1 || spaceDown) {
		drag = { mode: 'pan', sx: px, sy: py, v0: { ...view } };
		return;
	}
	const w = toWorld(px, py);
	const hit = hitTest(w.x, w.y);
	if (hit && hit.id === selectedId) {
		const { x: X, y: Y } = toScreen(hit.x, hit.y);
		const W = hit.w * view.scale,
			H = hit.h * view.scale;
		const corners: [string, number, number][] = [
			['nw', X, Y],
			['ne', X + W, Y],
			['sw', X, Y + H],
			['se', X + W, Y + H]
		];
		for (const [corner, cx, cy] of corners) {
			if (Math.abs(px - cx) <= 9 && Math.abs(py - cy) <= 9) {
				drag = {
					mode: 'resize',
					id: hit.id,
					corner: corner as 'nw' | 'ne' | 'sw' | 'se',
					ox: hit.x,
					oy: hit.y,
					ow: hit.w,
					oh: hit.h
				};
				return;
			}
		}
	}
	if (hit) {
		drag = { mode: 'move', id: hit.id, sx: px, sy: py, ox: hit.x, oy: hit.y, moved: false };
	} else {
		drag = { mode: 'create', ax: Math.floor(w.x), ay: Math.floor(w.y), cx: Math.floor(w.x), cy: Math.floor(w.y) };
	}
	draw();
}

function onPointerMove(e: PointerEvent) {
	if (!drag) return;
	const px = e.offsetX,
		py = e.offsetY;
	if (drag.mode === 'pan') {
		view.vx = drag.v0.vx - (px - drag.sx) / drag.v0.scale;
		view.vy = drag.v0.vy - (py - drag.sy) / drag.v0.scale;
	} else if (drag.mode === 'create') {
		const w = toWorld(px, py);
		drag.cx = Math.floor(w.x);
		drag.cy = Math.floor(w.y);
	} else if (drag.mode === 'move') {
		const dx = Math.round((px - drag.sx) / view.scale);
		const dy = Math.round((py - drag.sy) / view.scale);
		if (dx !== 0 || dy !== 0) drag.moved = true;
	} else if (drag.mode === 'resize') {
		const w = toWorld(px, py);
		if (drag.corner === 'se') {
			drag.ow = Math.max(1, Math.ceil(w.x - drag.ox));
			drag.oh = Math.max(1, Math.ceil(w.y - drag.oy));
		} else if (drag.corner === 'ne') {
			drag.ow = Math.max(1, Math.ceil(w.x - drag.ox));
			const nh = Math.max(1, Math.ceil(drag.oy + drag.oh - w.y));
			drag.oy = drag.oy + drag.oh - nh;
			drag.oh = nh;
		} else if (drag.corner === 'sw') {
			const nw = Math.max(1, Math.ceil(drag.ox + drag.ow - w.x));
			drag.ox = drag.ox + drag.ow - nw;
			drag.ow = nw;
			drag.oh = Math.max(1, Math.ceil(w.y - drag.oy));
		} else {
			const nw = Math.max(1, Math.ceil(drag.ox + drag.ow - w.x));
			const nh = Math.max(1, Math.ceil(drag.oy + drag.oh - w.y));
			drag.ox = drag.ox + drag.ow - nw;
			drag.oy = drag.oy + drag.oh - nh;
			drag.ow = nw;
			drag.oh = nh;
		}
	}
	draw();
}

function onPointerUp(e: PointerEvent) {
	const el = canvas;
	if (!el) return;
	el.releasePointerCapture(e.pointerId);
	if (!drag) return;
	const d = drag;
	drag = null;
	if (d.mode === 'create') {
		const w = d.cx - d.ax + (d.cx >= d.ax ? 1 : 1);
		const h = d.cy - d.ay + (d.cy >= d.ay ? 1 : 1);
		const rx = Math.min(d.ax, d.cx),
			ry = Math.min(d.ay, d.cy);
		if (w >= 1 && h >= 1) oncreated({ x: rx, y: ry, w, h });
		else onselect(null);
	} else if (d.mode === 'move') {
		if (!d.moved) onselect(d.id);
		else {
			const dx = Math.round((e.offsetX - d.sx) / view.scale);
			const dy = Math.round((e.offsetY - d.sy) / view.scale);
			onmoved(d.id, d.ox + dx, d.oy + dy);
		}
	} else if (d.mode === 'resize') {
		onresized(d.id, d.ox, d.oy, d.ow, d.oh);
	}
	draw();
}

function onWheel(e: WheelEvent) {
	e.preventDefault();
	const px = e.offsetX,
		py = e.offsetY;
	if (e.ctrlKey || e.metaKey) {
		const wx = px / view.scale + view.vx,
			wy = py / view.scale + view.vy;
		const ns = Math.min(160, Math.max(6, view.scale * Math.exp(-e.deltaY * 0.0022)));
		view.scale = ns;
		view.vx = wx - px / ns;
		view.vy = wy - py / ns;
	} else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
		view.vx += e.deltaX / view.scale;
	} else {
		view.vy += e.deltaY / view.scale;
	}
	draw();
}

onMount(async () => {
	await tick();
	fit(plots);
	window.addEventListener('keydown', (e) => {
		if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
			spaceDown = true;
			e.preventDefault();
		}
	});
	window.addEventListener('keyup', (e) => {
		if (e.code === 'Space') spaceDown = false;
	});
});

// redraw when data changes; re-fit when garden changes
$effect(() => {
	void plots;
	if (fittedFor !== gardenKey) {
		fittedFor = gardenKey;
		fit(plots);
	} else {
		draw();
	}
});

// cursor feedback
const cursor = $derived(spaceDown ? 'grab' : 'crosshair');
</script>

<canvas
	bind:this={canvas}
	style:cursor={cursor}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onwheel={onWheel}
></canvas>