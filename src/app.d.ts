// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { D1Database, ExecutionContext } from '@cloudflare/workers-types';

declare global {
	namespace App {
		interface Platform {
			env: { DB: D1Database; ACCESS_TEAM?: string; ACCESS_AUD?: string };
			ctx: ExecutionContext;
		}
		interface Locals {
			email?: string;
		}
	}
}

export {};
