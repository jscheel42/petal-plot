<script lang="ts">
// Canvas plot editor: pan/zoom grid, drag-create, move, resize.
// World units = feet. Screen = pixels. view.vx/vy = world coord at screen origin.
import { onMount, tick } from 'svelte';
import { api } from '#lib/api';

type PlantingView = {
	id: number;
	plantId: number;
	name: string;
	variety: string;
	family: string;
	emoji: string;
	quantity: number;
	spacing: number;
	fx: number; // band anchor: whole feet from plot origin
	fy: number;
	fw: number; // band footprint: feet
	fh: number;
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
	onplantmoved,
	onplotcontext,
	onselect
}: {
	plots: PlotView[];
	selectedId: number | null;
	gardenKey: number | null;
	oncreated: (rect: { x: number; y: number; w: number; h: number }) => void;
	onmoved: (id: number, x: number, y: number) => void;
	onresized: (id: number, x: number, y: number, w: number, h: number) => void;
	onplantmoved: (plantingId: number, x: number, y: number) => void;
	onplotcontext: (plotId: number, clientX: number, clientY: number) => void;
	onselect: (id: number | null) => void;
} = $props();

let hoverCorner = $state<'nw' | 'ne' | 'sw' | 'se' | null>(null);
let hoverPlanting = $state(false);
let canvas = $state<HTMLCanvasElement | undefined>();
let view = $state({ vx: 0, vy: 0, scale: 26 }); // px per ft
let drag = $state<Drag | null>(null);
let spaceDown = $state(false);
let fittedFor = $state<number | null>(null);
let positioned = $state(false); // view already placed on real data (or restored)
let userTouched = $state(false); // user panned/zoomed → stop auto-fit, start persisting
let saveT = 0;
// Labels default OFF; explicit 'on' persists across reloads. typeof guard for SSR.
let showLabels = $state(typeof localStorage !== 'undefined' && localStorage.getItem('petalPlot.showLabels') === 'on');

type Drag =
	| { mode: 'pan'; sx: number; sy: number; v0: { vx: number; vy: number; scale: number } }
	| { mode: 'create'; ax: number; ay: number; cx: number; cy: number }
	| { mode: 'move'; id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean; dx: number; dy: number }
	| {
			mode: 'plant';
			id: number;
			plotId: number;
			sx: number;
			sy: number;
			ox: number;
			oy: number;
			dx: number;
			dy: number;
			moved: boolean;
	  }
	| {
			mode: 'resize';
			id: number;
			corner: 'nw' | 'ne' | 'sw' | 'se';
			ox: number;
			oy: number;
			ow: number;
			oh: number;
	  };

// Touch gestures: 1 finger pans (tap = select, long-press = editor),
// 2 fingers pinch-zoom around the midpoint, selected-plot corners resize.
type TouchDrag =
	| { kind: 'tap'; sx: number; sy: number; plotId: number | null; moved: boolean }
	| { kind: 'pan'; sx: number; sy: number; v0: { vx: number; vy: number; scale: number } }
	| { kind: 'corner'; plotId: number; corner: 'nw' | 'ne' | 'sw' | 'se'; ox: number; oy: number; ow: number; oh: number };
let touchDrag: TouchDrag | null = null;
let pinch: { d0: number; mx0: number; my0: number; v0: { vx: number; vy: number; scale: number } } | null = null;
const touches = new Map<number, { x: number; y: number }>();
let longT = 0;
let lastCtx = { id: -1, t: 0 };

function fireContext(id: number, cx: number, cy: number) {
	// iOS can fire both our long-press timer and a native contextmenu — dedupe.
	const now = Date.now();
	if (lastCtx.id === id && now - lastCtx.t < 800) return;
	lastCtx = { id, t: now };
	onplotcontext(id, cx, cy);
}

function applyResize(r: { ox: number; oy: number; ow: number; oh: number; corner: 'nw' | 'ne' | 'sw' | 'se' }, wx: number, wy: number) {
	const X = Math.min(Math.max(0, wx), grid.w),
		Y = Math.min(Math.max(0, wy), grid.h);
	if (r.corner === 'se') {
		r.ow = Math.max(1, Math.ceil(X - r.ox));
		r.oh = Math.max(1, Math.ceil(Y - r.oy));
	} else if (r.corner === 'ne') {
		r.ow = Math.max(1, Math.ceil(X - r.ox));
		const nh = Math.max(1, Math.ceil(r.oy + r.oh - Y));
		r.oy = r.oy + r.oh - nh;
		r.oh = nh;
	} else if (r.corner === 'sw') {
		const nw = Math.max(1, Math.ceil(r.ox + r.ow - X));
		r.ox = r.ox + r.ow - nw;
		r.ow = nw;
		r.oh = Math.max(1, Math.ceil(Y - r.oy));
	} else {
		const nw = Math.max(1, Math.ceil(r.ox + r.ow - X));
		const nh = Math.max(1, Math.ceil(r.oy + r.oh - Y));
		r.ox = r.ox + r.ow - nw;
		r.oy = r.oy + r.oh - nh;
		r.ow = nw;
		r.oh = nh;
	}
}

function touchDown(e: PointerEvent) {
	const el = canvas;
	if (!el) return;
	el.setPointerCapture(e.pointerId);
	touches.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
	if (touches.size === 2) {
		clearTimeout(longT);
		touchDrag = null;
		const [a, b] = [...touches.values()];
		pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx0: (a.x + b.x) / 2, my0: (a.y + b.y) / 2, v0: { ...view } };
		return;
	}
	if (touches.size > 2) return;
	const px = e.offsetX,
		py = e.offsetY;
	const ch = cornerAt(px, py);
	if (ch) {
		touchDrag = { kind: 'corner', plotId: ch.plot.id, corner: ch.corner, ox: ch.plot.x, oy: ch.plot.y, ow: ch.plot.w, oh: ch.plot.h };
		draw();
		return;
	}
	const w = toWorld(px, py);
	const hit = hitTest(Math.floor(w.x), Math.floor(w.y));
	touchDrag = { kind: 'tap', sx: px, sy: py, plotId: hit?.id ?? null, moved: false };
	if (hit) {
		const id = hit.id,
			cx = e.clientX,
			cy = e.clientY;
		longT = window.setTimeout(() => {
			touchDrag = null;
			fireContext(id, cx, cy);
		}, 500);
	}
}

function touchMove(e: PointerEvent) {
	if (!touches.has(e.pointerId)) return;
	const px = e.offsetX,
		py = e.offsetY;
	touches.set(e.pointerId, { x: px, y: py });
	if (pinch && touches.size >= 2) {
		const [a, b] = [...touches.values()];
		const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
		const mx = (a.x + b.x) / 2,
			my = (a.y + b.y) / 2;
		userTouched = true;
		const ns = Math.min(160, Math.max(6, (pinch.v0.scale * d) / pinch.d0));
		// keep the world point under the start-midpoint pinned to the live midpoint
		const wx = pinch.mx0 / pinch.v0.scale + pinch.v0.vx;
		const wy = pinch.my0 / pinch.v0.scale + pinch.v0.vy;
		view.scale = ns;
		view.vx = wx - mx / ns;
		view.vy = wy - my / ns;
		draw();
		return;
	}
	const td = touchDrag;
	if (!td) return;
	if (td.kind === 'tap') {
		if (Math.hypot(px - td.sx, py - td.sy) < 10) return;
		clearTimeout(longT);
		touchDrag = { kind: 'pan', sx: px, sy: py, v0: { ...view } };
		return;
	}
	if (td.kind === 'pan') {
		userTouched = true;
		view.vx = td.v0.vx - (px - td.sx) / td.v0.scale;
		view.vy = td.v0.vy - (py - td.sy) / td.v0.scale;
		draw();
		return;
	}
	const w = toWorld(px, py);
	applyResize(td, w.x, w.y);
	draw();
}

function touchUp(e: PointerEvent) {
	const el = canvas;
	const had = touches.delete(e.pointerId);
	if (el && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
	if (pinch) {
		if (touches.size < 2) {
			pinch = null;
			// remaining finger keeps panning from where it is — no jump
			const rest = [...touches.values()][0];
			touchDrag = rest ? { kind: 'pan', sx: rest.x, sy: rest.y, v0: { ...view } } : null;
		}
		return;
	}
	clearTimeout(longT);
	if (!had) return;
	const td = touchDrag;
	touchDrag = null;
	if (!td || td.kind === 'pan') {
		draw();
		return;
	}
	if (td.kind === 'corner') onresized(td.plotId, Math.max(0, td.ox), Math.max(0, td.oy), Math.min(td.ow, grid.w - Math.max(0, td.ox)), Math.min(td.oh, grid.h - Math.max(0, td.oy)));
	else if (!td.moved) onselect(td.plotId);
	draw();
}

function onPointerCancel(e: PointerEvent) {
	if (e.pointerType !== 'touch') return;
	touches.delete(e.pointerId);
	clearTimeout(longT);
	touchDrag = null;
	pinch = null;
	draw();
}

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

// Corner grab radius in screen px — generous so corners are easy targets.
const CORNER_PX = 14;
function cornerAt(px: number, py: number): { plot: PlotView; corner: 'nw' | 'ne' | 'sw' | 'se' } | null {
	if (selectedId == null) return null;
	const p = plots.find((q) => q.id === selectedId);
	if (!p) return null;
	const { x: X, y: Y } = toScreen(p.x, p.y);
	const W = p.w * view.scale,
		H = p.h * view.scale;
	const corners: ['nw' | 'ne' | 'sw' | 'se', number, number][] = [
		['nw', X, Y],
		['ne', X + W, Y],
		['sw', X, Y + H],
		['se', X + W, Y + H]
	];
	for (const [corner, cx, cy] of corners) {
		if (Math.abs(px - cx) <= CORNER_PX && Math.abs(py - cy) <= CORNER_PX) return { plot: p, corner };
	}
	return null;
}

// Planting band of the selected plot under a screen point — bands are
// draggable to reposition rows within the bed.
function bandAt(px: number, py: number): { plot: PlotView; band: PlantingView } | null {
	if (selectedId == null) return null;
	const p = plots.find((q) => q.id === selectedId);
	if (!p) return null;
	const w = toWorld(px, py);
	for (const pl of p.plantings) {
		if (w.x >= p.x + pl.fx && w.x < p.x + pl.fx + pl.fw && w.y >= p.y + pl.fy && w.y < p.y + pl.fy + pl.fh)
			return { plot: p, band: pl };
	}
	return null;
}

function overlapsAny(x: number, y: number, w: number, h: number, ignoreId: number): PlotView | null {
	for (const p of plots) {
		if (p.id === ignoreId) continue;
		if (x < p.x + p.w && p.x < x + w && y < p.y + p.h && p.y < y + h) return p;
	}
	return null;
}

// Target rect of a drag in world coords; move/resize clamp to x,y >= 0.
function dragRect(d: Drag): { x: number; y: number; w: number; h: number; ignoreId: number } | null {
	if (d.mode === 'pan') return null;
	if (d.mode === 'create') {
		return {
			x: Math.min(d.ax, d.cx),
			y: Math.min(d.ay, d.cy),
			w: Math.abs(d.cx - d.ax) + 1,
			h: Math.abs(d.cy - d.ay) + 1,
			ignoreId: -1
		};
	}
	if (d.mode === 'move') {
		const p = plots.find((q) => q.id === d.id);
		if (!p) return null;
		return { x: Math.max(0, d.ox + d.dx), y: Math.max(0, d.oy + d.dy), w: p.w, h: p.h, ignoreId: d.id };
	}
	if (d.mode === 'plant') return null;
	return { x: Math.max(0, d.ox), y: Math.max(0, d.oy), w: d.ow, h: d.oh, ignoreId: d.id };
}

function fit() {
	const el = canvas;
	if (!el) return;
	const cw = el.clientWidth,
		ch = el.clientHeight;
	const spanX = grid.w,
		spanY = grid.h;
	const s = Math.min(cw / spanX, ch / spanY);
	view.scale = Math.min(60, Math.max(6, s));
	view.vx = -(cw / view.scale - spanX) / 2;
	view.vy = -(ch / view.scale - spanY) / 2;
	draw();
}

// Zoom anchored at a screen point; wheel, buttons, and keys all share this.
function zoomAt(cx: number, cy: number, factor: number) {
	userTouched = true;
	const wx = cx / view.scale + view.vx,
		wy = cy / view.scale + view.vy;
	const ns = Math.min(160, Math.max(6, view.scale * factor));
	view.scale = ns;
	view.vx = wx - cx / ns;
	view.vy = wy - cy / ns;
	draw();
}

function zoomStep(dir: number) {
	const el = canvas;
	if (!el) return;
	zoomAt(el.clientWidth / 2, el.clientHeight / 2, dir > 0 ? 1.3 : 1 / 1.3);
}

function centerOnSelected() {
	const el = canvas;
	if (!el || selectedId == null) return;
	const p = plots.find((q) => q.id === selectedId);
	if (!p) return;
	userTouched = true;
	view.vx = p.x + p.w / 2 - el.clientWidth / view.scale / 2;
	view.vy = p.y + p.h / 2 - el.clientHeight / view.scale / 2;
	draw();
}

// View persists per garden so a reload keeps position + zoom.
type SavedView = { vx: number; vy: number; scale: number };
function saveView() {
	if (gardenKey == null) return;
	try {
		localStorage.setItem(`petalPlot.view.${gardenKey}`, JSON.stringify({ vx: view.vx, vy: view.vy, scale: view.scale }));
	} catch {
		// storage blocked/full — persistence is best-effort
	}
}
function loadView(): boolean {
	if (gardenKey == null) return false;
	try {
		const raw = localStorage.getItem(`petalPlot.view.${gardenKey}`);
		if (!raw) return false;
		const v = JSON.parse(raw) as Partial<SavedView>;
		if (typeof v.vx !== 'number' || typeof v.vy !== 'number' || typeof v.scale !== 'number') return false;
		if (!Number.isFinite(v.vx) || !Number.isFinite(v.vy) || v.scale < 6 || v.scale > 160) return false;
		view.vx = v.vx;
		view.vy = v.vy;
		view.scale = v.scale;
		return true;
	} catch {
		return false;
	}
}

function toggleLabels() {
	showLabels = !showLabels;
	try {
		localStorage.setItem('petalPlot.showLabels', showLabels ? 'on' : 'off');
	} catch {
		// persistence is best-effort
	}
	draw();
}

// Grid extent + outside styling: manual W×H (persisted per garden) or auto
// = plots bbox + 5 ft snapped to 5. Drags clamp to the grid; ⛶ fits it.
type GridSave = { auto: boolean; w: number; h: number; outside: string };
const DEFAULT_OUTSIDE = '#d8e3c8';
const OUTSIDE_SWATCHES = ['#d8e3c8', '#e7e0d0', '#d7dee8', '#e3d5ca', '#cfd5cf', '#b8b5ad'];
let gridSave = $state<GridSave | null>(null);
let styleOpen = $state(false);
let buffer = $state(5);

const autoGrid = $derived.by(() => {
	let maxX = 16,
		maxY = 10;
	for (const p of plots) {
		maxX = Math.max(maxX, p.x + p.w);
		maxY = Math.max(maxY, p.y + p.h);
	}
	return { w: Math.ceil((maxX + 5) / 5) * 5, h: Math.ceil((maxY + 5) / 5) * 5 };
});
const grid = $derived<GridSave>(
	gridSave && !gridSave.auto
		? gridSave
		: { auto: true, w: autoGrid.w, h: autoGrid.h, outside: gridSave?.outside ?? DEFAULT_OUTSIDE }
);

async function loadGrid() {
	if (gardenKey == null) {
		gridSave = null;
		return;
	}
	const key = gardenKey;
	// One-time promotion of pre-DB per-device prefs (localStorage) to the server.
	let local: GridSave | null = null;
	try {
		const raw = localStorage.getItem(`petalPlot.grid.${key}`);
		if (raw) {
			const v = JSON.parse(raw) as Partial<GridSave>;
			const outside = typeof v.outside === 'string' && /^#[0-9a-f]{6}$/i.test(v.outside) ? v.outside : null;
			if (outside && v.auto === true) local = { auto: true, w: 0, h: 0, outside };
			else if (outside && typeof v.w === 'number' && typeof v.h === 'number' && v.w >= 4 && v.w <= 999 && v.h >= 4 && v.h <= 999)
				local = { auto: false, w: Math.round(v.w), h: Math.round(v.h), outside };
		}
	} catch {
		local = null;
	}
	try {
		const r = await api<{ garden: { gridW: number; gridH: number; outsideColor: string } }>(`/api/gardens/${key}`);
		if (gardenKey !== key) return; // switched gardens mid-flight
		const g = r.garden;
		const outside = /^#[0-9a-f]{6}$/i.test(g.outsideColor) ? g.outsideColor : DEFAULT_OUTSIDE;
		if (g.gridW === 0 && g.gridH === 0 && outside === DEFAULT_OUTSIDE && local) {
			gridSave = local;
			// raw fetch: a background migration must NOT trigger the signin modal on 401
			void fetch(`/api/gardens/${key}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ gridW: local.auto ? 0 : local.w, gridH: local.auto ? 0 : local.h, outsideColor: local.outside })
			})
				.then((res) => {
					if (res.ok) localStorage.removeItem(`petalPlot.grid.${key}`);
				})
				.catch(() => {});
			return;
		}
		const manual = Number.isInteger(g.gridW) && Number.isInteger(g.gridH) && g.gridW >= 4 && g.gridH >= 4;
		gridSave = manual ? { auto: false, w: g.gridW, h: g.gridH, outside } : { auto: true, w: 0, h: 0, outside };
	} catch {
		if (gardenKey === key) gridSave = local;
	}
}
let gridSaveT = 0;
function saveGrid() {
	if (gardenKey == null) return;
	const key = gardenKey;
	clearTimeout(gridSaveT);
	gridSaveT = window.setTimeout(() => {
		const g = grid;
		void api(`/api/gardens/${key}`, {
			method: 'PATCH',
			body: JSON.stringify({ gridW: g.auto ? 0 : g.w, gridH: g.auto ? 0 : g.h, outsideColor: g.outside })
		}).catch(() => {
			// offline / view-only: optimistic UI stands until next change
		});
	}, 300);
}
function applyGridSize(w: number, h: number) {
	const W = Math.round(Number.isFinite(w) ? w : grid.w);
	const H = Math.round(Number.isFinite(h) ? h : grid.h);
	gridSave = { auto: false, w: Math.min(999, Math.max(4, W)), h: Math.min(999, Math.max(4, H)), outside: grid.outside };
	saveGrid();
}
// bbox of all plots + buffer, snapped up to 5-ft, min 10.
function fitGridToPlots() {
	let maxX = 0,
		maxY = 0;
	for (const p of plots) {
		maxX = Math.max(maxX, p.x + p.w);
		maxY = Math.max(maxY, p.y + p.h);
	}
	const b = Math.min(200, Math.max(0, Math.round(Number.isFinite(buffer) ? buffer : 5)));
	gridSave = { auto: false, w: Math.max(10, Math.ceil((maxX + b) / 5) * 5), h: Math.max(10, Math.ceil((maxY + b) / 5) * 5), outside: grid.outside };
	saveGrid();
}
function setOutside(c: string) {
	if (!/^#[0-9a-f]{6}$/i.test(c)) return;
	gridSave = { auto: grid.auto, w: grid.w, h: grid.h, outside: c };
	saveGrid();
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
	// outside the garden grid: custom field color
	ctx.fillStyle = grid.outside;
	ctx.fillRect(0, 0, cw, ch);

	const s = view.scale;
	// the grid is a bounded mat: rounded sheet, drop shadow, checkerboard
	// tint, minor/major lines, foot rulers along the top + left edges
	const g0 = toScreen(0, 0),
		g1 = toScreen(grid.w, grid.h);
	const gw = g1.x - g0.x,
		gh = g1.y - g0.y;
	const sheet = () => {
		ctx.beginPath();
		ctx.roundRect(g0.x, g0.y, gw, gh, 10);
	};
	ctx.save();
	ctx.shadowColor = 'rgba(0,0,0,0.28)';
	ctx.shadowBlur = 16;
	ctx.shadowOffsetY = 5;
	ctx.fillStyle = '#f6f7f4';
	sheet();
	ctx.fill();
	ctx.restore();
	if (gw > 2 && gh > 2) {
		ctx.save();
		sheet();
		ctx.clip();
		// 5-ft checkerboard tint — subtle lawn texture
		const bx0 = Math.max(0, Math.floor(view.vx / 5)),
			by0 = Math.max(0, Math.floor(view.vy / 5));
		const bx1 = Math.min(Math.ceil(grid.w / 5), Math.ceil((view.vx + cw / s) / 5)),
			by1 = Math.min(Math.ceil(grid.h / 5), Math.ceil((view.vy + ch / s) / 5));
		ctx.fillStyle = 'rgba(163,191,140,0.10)';
		for (let bx = bx0; bx < bx1; bx++) {
			for (let by = by0; by < by1; by++) {
				if ((bx + by) % 2 !== 0) continue;
				const b0 = toScreen(bx * 5, by * 5);
				ctx.fillRect(b0.x, b0.y, 5 * s + 1, 5 * s + 1);
			}
		}
		// gridlines: minor ft, major every 5, stronger every 10
		ctx.lineWidth = 1;
		const minX = Math.max(0, Math.floor(view.vx)),
			maxX = Math.min(grid.w, Math.ceil(view.vx + cw / s));
		const minY = Math.max(0, Math.floor(view.vy)),
			maxY = Math.min(grid.h, Math.ceil(view.vy + ch / s));
		for (let gx = minX; gx <= maxX; gx++) {
			const X = Math.round((gx - view.vx) * s) + 0.5;
			ctx.strokeStyle = gx % 10 === 0 ? '#c9c6c3' : gx % 5 === 0 ? '#d6d3d1' : '#e7e5e4';
			ctx.beginPath();
			ctx.moveTo(X, 0);
			ctx.lineTo(X, ch);
			ctx.stroke();
		}
		for (let gy = minY; gy <= maxY; gy++) {
			const Y = Math.round((gy - view.vy) * s) + 0.5;
			ctx.strokeStyle = gy % 10 === 0 ? '#c9c6c3' : gy % 5 === 0 ? '#d6d3d1' : '#e7e5e4';
			ctx.beginPath();
			ctx.moveTo(0, Y);
			ctx.lineTo(cw, Y);
			ctx.stroke();
		}
		// foot rulers along the sheet edges
		if (s >= 12) {
			ctx.fillStyle = '#a8a29e';
			ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'top';
			for (let gx = 5; gx <= grid.w - 2; gx += 5) {
				const X = Math.round((gx - view.vx) * s) + 0.5;
				if (X < 10 || X > cw - 10) continue;
				ctx.fillText(String(gx), X, g0.y + 3);
			}
			ctx.textAlign = 'left';
			ctx.textBaseline = 'middle';
			for (let gy = 5; gy <= grid.h - 2; gy += 5) {
				const Y = Math.round((gy - view.vy) * s) + 0.5;
				if (Y < 10 || Y > ch - 10) continue;
				ctx.fillText(String(gy), g0.x + 4, Y);
			}
		}
		ctx.restore();
	}
	ctx.strokeStyle = '#a8a29e';
	ctx.lineWidth = 2;
	sheet();
	ctx.stroke();

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
		// planting bands at their anchors (server-computed footprints)
		for (const pl of p.plantings) {
			const bx = X + pl.fx * s,
				by = Y + pl.fy * s,
				bw = pl.fw * s,
				bh = pl.fh * s;
			const cols = Math.max(1, Math.floor(pl.fw / pl.spacing));
			const rows = Math.max(0, Math.min(Math.ceil(pl.quantity / cols), Math.floor(pl.fh / pl.spacing)));
			const cell = pl.spacing * s;
			for (let r = 0; r < rows; r++) {
				for (let c = 0; c < cols; c++) {
					const n = r * cols + c;
					if (n >= pl.quantity) break;
					ctx.font = `${Math.max(8, Math.min(28, cell * 0.75))}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
					ctx.textAlign = 'center';
					ctx.textBaseline = 'middle';
					ctx.fillText(pl.emoji, bx + (c + 0.5) * cell, by + (r + 0.5) * cell);
				}
			}
			// selected plot: dashed outlines mark bands as grabbable targets
			if (p.id === selectedId) {
				ctx.setLineDash([4, 3]);
				ctx.strokeStyle = 'rgba(255,255,255,0.75)';
				ctx.lineWidth = 1.5;
				ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
				ctx.setLineDash([]);
			}
		}
		// border + labels
		const sel = p.id === selectedId;
		ctx.strokeStyle = sel ? ACCENT : SOIL_DARK;
		ctx.lineWidth = sel ? 3 : 1.5;
		ctx.strokeRect(X + 0.5, Y + 0.5, W - 1, H - 1);
		if (showLabels) {
			ctx.fillStyle = '#ffffff';
			ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
			ctx.textAlign = 'left';
			ctx.textBaseline = 'top';
			ctx.shadowColor = 'rgba(0,0,0,0.6)';
			ctx.shadowBlur = 3;
			ctx.fillText(`${p.name} · ${p.w}×${p.h}ft`, X + 5, Y + 4);
			ctx.shadowBlur = 0;
		}
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
				ctx.fillRect(hx - 6, hy - 6, 12, 12);
			}
		}
	}

	// drag ghost: green = placeable, red = blocked (negative coords or overlap)
	if (drag) {
		const dg = drag;
		if (dg.mode === 'plant') {
			const p = plots.find((q) => q.id === dg.plotId);
			const pl = p?.plantings.find((q) => q.id === dg.id);
			if (p && pl) {
				const tx = Math.max(0, Math.min(p.w - pl.fw, pl.fx + dg.dx));
				const ty = Math.max(0, Math.min(p.h - pl.fh, pl.fy + dg.dy));
				const clash = p.plantings.find(
					(q) => q.id !== dg.id && tx < q.fx + q.fw && q.fx < tx + pl.fw && ty < q.fy + q.fh && q.fy < ty + pl.fh
				);
			const a = toScreen(p.x + tx, p.y + ty);
			const col = clash ? '#ef4444' : '#22c55e';
			ctx.fillStyle = clash ? 'rgba(239,68,68,0.22)' : 'rgba(34,197,94,0.22)';
			ctx.fillRect(a.x, a.y, pl.fw * s, pl.fh * s);
			ctx.setLineDash([6, 4]);
			ctx.strokeStyle = col;
			ctx.lineWidth = 2;
			ctx.strokeRect(a.x + 0.5, a.y + 0.5, pl.fw * s - 1, pl.fh * s - 1);
			ctx.setLineDash([]);
			ctx.fillStyle = col;
			ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
			ctx.textAlign = 'left';
			ctx.textBaseline = 'top';
			ctx.fillText(clash ? `overlaps ${clash.name}` : `${pl.name} → (${tx}, ${ty})`, a.x + 6, a.y + 6);
		}
	} else {
		const r = dragRect(drag);
		if (r) {
			const a = toScreen(r.x, r.y);
			const W = r.w * s,
				H = r.h * s;
			const clash = overlapsAny(r.x, r.y, r.w, r.h, r.ignoreId);
			const neg = r.x < 0 || r.y < 0;
			const bad = clash !== null || neg;
			const col = bad ? '#ef4444' : '#22c55e';
			ctx.fillStyle = bad ? 'rgba(239,68,68,0.18)' : 'rgba(34,197,94,0.18)';
			ctx.fillRect(a.x, a.y, W, H);
			ctx.setLineDash([6, 4]);
			ctx.strokeStyle = col;
			ctx.lineWidth = 2;
			ctx.strokeRect(a.x + 0.5, a.y + 0.5, W - 1, H - 1);
			ctx.setLineDash([]);
			ctx.fillStyle = col;
			ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
			ctx.textAlign = 'left';
			const label = clash
				? `overlaps ${clash.name}`
				: neg
					? 'x/y must be ≥ 0'
					: `${r.w}×${r.h} ft at (${r.x}, ${r.y})`;
			ctx.fillText(label, a.x + 6, a.y + 6);
		}
	}
	}
	// north indicator — screen-fixed compass rose, garden north is up
	if (cw > 140 && ch > 140) {
		const cx = 30,
			cy = 36;
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, 17, 0, Math.PI * 2);
		ctx.fillStyle = 'rgba(255,255,255,0.88)';
		ctx.fill();
		ctx.strokeStyle = '#a8a29e';
		ctx.lineWidth = 1.5;
		ctx.stroke();
		ctx.fillStyle = '#1c1917';
		ctx.beginPath();
		ctx.moveTo(cx, cy + 1);
		ctx.lineTo(cx - 5, cy + 11);
		ctx.lineTo(cx, cy + 7);
		ctx.lineTo(cx + 5, cy + 11);
		ctx.closePath();
		ctx.fill();
		ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('N', cx, cy - 7);
		ctx.restore();
	}
	if (userTouched) {
		clearTimeout(saveT);
		saveT = window.setTimeout(saveView, 250);
	}
}


function onPointerDown(e: PointerEvent) {
	if (e.button === 2) return; // right button is reserved for the context menu
	const el = canvas;
	if (!el) return;
	if (e.pointerType === 'touch') {
		touchDown(e);
		return;
	}
	el.setPointerCapture(e.pointerId);
	const px = e.offsetX,
		py = e.offsetY;
	if (e.button === 1 || spaceDown) {
		drag = { mode: 'pan', sx: px, sy: py, v0: { ...view } };
		return;
	}
	// corners of the selected plot win over hitTest — near shared edges with
	// adjacent plots, hitTest would otherwise grab the neighbor and move it
	// into the selected plot (phantom overlap collisions).
	const ch = cornerAt(px, py);
	if (ch) {
		drag = {
			mode: 'resize',
			id: ch.plot.id,
			corner: ch.corner,
			ox: ch.plot.x,
			oy: ch.plot.y,
			ow: ch.plot.w,
			oh: ch.plot.h
		};
		draw();
		return;
	}
	// planting bands of the selected plot are draggable within the bed
	const band = bandAt(px, py);
	if (band) {
		drag = {
			mode: 'plant',
			id: band.band.id,
			plotId: band.plot.id,
			sx: px,
			sy: py,
			ox: band.band.fx,
			oy: band.band.fy,
			dx: 0,
			dy: 0,
			moved: false
		};
		draw();
		return;
	}
	const w = toWorld(px, py);
	const hit = hitTest(w.x, w.y);
	if (hit) {
		drag = { mode: 'move', id: hit.id, sx: px, sy: py, ox: hit.x, oy: hit.y, moved: false, dx: 0, dy: 0 };
	} else {
		drag = { mode: 'create', ax: Math.floor(w.x), ay: Math.floor(w.y), cx: Math.floor(w.x), cy: Math.floor(w.y) };
	}
	draw();
}

function onPointerMove(e: PointerEvent) {
	if (e.pointerType === 'touch') {
		touchMove(e);
		return;
	}
	const px = e.offsetX,
		py = e.offsetY;
	if (!drag) {
		hoverCorner = cornerAt(px, py)?.corner ?? null;
		hoverPlanting = bandAt(px, py) !== null;
		return;
	}
	if (drag.mode === 'pan') {
		userTouched = true;
		view.vx = drag.v0.vx - (px - drag.sx) / drag.v0.scale;
		view.vy = drag.v0.vy - (py - drag.sy) / drag.v0.scale;
	} else if (drag.mode === 'create') {
		const w = toWorld(px, py);
		drag.cx = Math.min(grid.w - 1, Math.floor(w.x));
		drag.cy = Math.min(grid.h - 1, Math.floor(w.y));
	} else if (drag.mode === 'move') {
		const dm = drag;
		const p = plots.find((q) => q.id === dm.id);
		const limX = p ? grid.w - (dm.ox + p.w) : 0;
		const limY = p ? grid.h - (dm.oy + p.h) : 0;
		drag.dx = Math.min(limX, Math.max(-dm.ox, Math.round((px - dm.sx) / view.scale)));
		drag.dy = Math.min(limY, Math.max(-dm.oy, Math.round((py - dm.sy) / view.scale)));
		if (drag.dx !== 0 || drag.dy !== 0) drag.moved = true;
	} else if (drag.mode === 'plant') {
		drag.dx = Math.round((px - drag.sx) / view.scale);
		drag.dy = Math.round((py - drag.sy) / view.scale);
		if (drag.dx !== 0 || drag.dy !== 0) drag.moved = true;
	} else if (drag.mode === 'resize') {
		const w = toWorld(px, py);
		applyResize(drag, w.x, w.y);
	}
	draw();
}

function onPointerUp(e: PointerEvent) {
	const el = canvas;
	if (!el) return;
	if (e.pointerType === 'touch') {
		touchUp(e);
		return;
	}
	el.releasePointerCapture(e.pointerId);
	if (!drag) return;
	const d = drag;
	drag = null;
	if (d.mode === 'create') {
		const r = dragRect(d);
		if (r && r.w >= 1 && r.h >= 1) {
			const x = Math.max(0, r.x),
				y = Math.max(0, r.y);
			oncreated({ x, y, w: Math.min(r.w, grid.w - x), h: Math.min(r.h, grid.h - y) });
		} else onselect(null);
	} else if (d.mode === 'move') {
		if (!d.moved) onselect(d.id);
		else {
			const p = plots.find((q) => q.id === d.id);
			onmoved(d.id, Math.max(0, Math.min(grid.w - (p?.w ?? 1), d.ox + d.dx)), Math.max(0, Math.min(grid.h - (p?.h ?? 1), d.oy + d.dy)));
		}
	} else if (d.mode === 'resize') {
		onresized(d.id, Math.max(0, d.ox), Math.max(0, d.oy), Math.min(d.ow, grid.w - Math.max(0, d.ox)), Math.min(d.oh, grid.h - Math.max(0, d.oy)));
	} else if (d.mode === 'plant') {
		const p = plots.find((q) => q.id === d.plotId);
		const pl = p?.plantings.find((q) => q.id === d.id);
		if (p && pl && d.moved) {
			onplantmoved(d.id, Math.max(0, Math.min(p.w - pl.fw, d.ox + d.dx)), Math.max(0, Math.min(p.h - pl.fh, d.oy + d.dy)));
		} else if (!d.moved) onselect(d.plotId);
	}
	draw();
}

function onContextMenu(e: MouseEvent) {
	const el = canvas;
	if (!el) return;
	e.preventDefault();
	const rect = el.getBoundingClientRect();
	const w = toWorld(e.clientX - rect.left, e.clientY - rect.top);
	const hit = hitTest(Math.floor(w.x), Math.floor(w.y));
	if (hit) fireContext(hit.id, e.clientX, e.clientY);
}

// Wheel zooms at cursor (no modifier needed); horizontal-dominant
// trackpad swipes pan instead.
function onWheel(e: WheelEvent) {
	e.preventDefault();
	if (!(e.ctrlKey || e.metaKey) && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
		view.vx += e.deltaX / view.scale;
		draw();
		return;
	}
	zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0022));
}

onMount(async () => {
	await tick();
	window.addEventListener('keydown', (e) => {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
		if (e.code === 'Space') {
			spaceDown = true;
			e.preventDefault();
		} else if (e.key === '+' || e.key === '=') {
			zoomStep(1);
		} else if (e.key === '-') {
			zoomStep(-1);
		} else if (e.key === '0') {
			userTouched = true;
			fit();
		} else if (e.key === 'c') {
			centerOnSelected();
		} else if (e.key === 'l') {
			toggleLabels();
		}
	});
	window.addEventListener('keyup', (e) => {
		if (e.code === 'Space') spaceDown = false;
	});
});

// Grid config persists per garden; changing size/color repaints at once.
$effect(() => {
	void gardenKey;
	void loadGrid();
});
$effect(() => {
	void grid.w;
	void grid.h;
	void grid.outside;
	draw();
});

// Garden change: restore saved view, else fit. Plots load async — if the
// first fit saw an empty garden, re-fit once the boxes arrive (unless the
// user already took control of the view).
$effect(() => {
	void plots;
	if (fittedFor !== gardenKey) {
		fittedFor = gardenKey;
		positioned = loadView();
		if (!positioned) fit();
	} else if (!positioned && !userTouched && plots.length > 0) {
		fit();
		positioned = true;
	} else {
		draw();
	}
});

// cursor feedback
const cursor = $derived(
	spaceDown || hoverPlanting ? 'grab' : hoverCorner === 'nw' || hoverCorner === 'se' ? 'nwse-resize' : hoverCorner ? 'nesw-resize' : 'crosshair'
);
</script>

<canvas
	bind:this={canvas}
	class="touch-none select-none [-webkit-touch-callout:none]"
	style:cursor={cursor}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerCancel}
	onwheel={onWheel}
	oncontextmenu={onContextMenu}
></canvas>

<div class="absolute bottom-4 left-4 z-10 flex flex-col gap-0.5 rounded-xl border border-stone-200 bg-white/90 p-1 shadow-md backdrop-blur">
	<button
		class="flex h-8 w-8 items-center justify-center rounded-lg text-lg leading-none text-stone-700 hover:bg-stone-100"
		title="Zoom in (+)"
		onclick={() => zoomStep(1)}>＋</button>
	<button
		class="flex h-8 w-8 items-center justify-center rounded-lg text-lg leading-none text-stone-700 hover:bg-stone-100"
		title="Zoom out (−)"
		onclick={() => zoomStep(-1)}>−</button>
	<div class="mx-1.5 h-px bg-stone-200"></div>
	<button
		class="flex h-8 w-8 items-center justify-center rounded-lg text-base leading-none text-stone-700 hover:bg-stone-100"
		title="Fit garden to screen (0)"
		onclick={() => {
			userTouched = true;
			fit();
		}}>⛶</button>
	<button
		class="flex h-8 w-8 items-center justify-center rounded-lg text-base leading-none text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:text-stone-300"
		title="Center on selected plot (c)"
		disabled={selectedId === null}
		onclick={centerOnSelected}>◎</button>
	<div class="mx-1.5 h-px bg-stone-200"></div>
	<button
		class="flex h-8 w-8 items-center justify-center rounded-lg text-base leading-none text-stone-700 hover:bg-stone-100"
		title="Toggle plot labels (l)"
		onclick={toggleLabels}>🏷️</button>
	<button
		class="flex h-8 w-8 items-center justify-center rounded-lg text-base leading-none text-stone-700 hover:bg-stone-100"
		title="Grid style & bounds"
		onclick={() => (styleOpen = !styleOpen)}>⚙️</button>
</div>
{#if styleOpen}
	<div class="fixed inset-0 z-10" role="presentation" onclick={() => (styleOpen = false)}></div>
	<div class="absolute bottom-4 left-16 z-20 w-64 rounded-xl border border-stone-200 bg-white/95 p-3 text-xs text-stone-700 shadow-lg backdrop-blur">
		<div class="mb-1 flex items-baseline justify-between">
			<span class="font-semibold text-stone-800">Grid size (ft)</span>
			{#if grid.auto}<span class="text-[10px] text-stone-400">auto · plots＋5</span>{/if}
		</div>
		<div class="mb-2 flex items-end gap-1.5">
			<label class="flex-1">W
				<input class="mt-0.5 w-full rounded-md border border-stone-300 px-1.5 py-1" type="number" min="4" max="999" value={grid.w} onchange={(e) => applyGridSize(Number(e.currentTarget.value), grid.h)} />
			</label>
			<label class="flex-1">H
				<input class="mt-0.5 w-full rounded-md border border-stone-300 px-1.5 py-1" type="number" min="4" max="999" value={grid.h} onchange={(e) => applyGridSize(grid.w, Number(e.currentTarget.value))} />
			</label>
			<label class="w-12">Buf
				<input class="mt-0.5 w-full rounded-md border border-stone-300 px-1.5 py-1" type="number" min="0" max="200" bind:value={buffer} />
			</label>
			<button class="rounded-md bg-stone-800 px-2 py-1 text-white hover:bg-stone-700" title="Set grid to plots bounding box + buffer" onclick={fitGridToPlots}>Fit</button>
		</div>
		<div class="mb-1 font-semibold text-stone-800">Outside color</div>
		<div class="mb-2 flex items-center gap-1.5">
			<input class="h-7 w-9 cursor-pointer rounded-md border border-stone-300" type="color" value={grid.outside} oninput={(e) => setOutside(e.currentTarget.value)} />
			{#each OUTSIDE_SWATCHES as c}
				<button class="h-6 w-6 rounded-full border border-stone-300 hover:scale-110" style:background={c} title={c} onclick={() => setOutside(c)}></button>
			{/each}
		</div>
		<button class="w-full rounded-md border border-stone-300 py-1 hover:bg-stone-100" onclick={() => { gridSave = { auto: true, w: 0, h: 0, outside: grid.outside }; saveGrid(); }}>Auto-size to content</button>
	</div>
{/if}