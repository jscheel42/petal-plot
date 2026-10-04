// Ambient types for the adapter-provided `cloudflare:workers` module
// (virtual module in dev, real runtime in production, vi.mock in tests).
declare module 'cloudflare:workers' {
	import type { D1Database, Fetcher } from '@cloudflare/workers-types';

	export const env: {
		DB: D1Database;
		ASSETS_BINDING: Fetcher;
	};
}
