import { env } from 'cloudflare:workers';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type DB = DrizzleD1Database<typeof schema>;

/**
 * Bind Drizzle to the D1 binding from the worker environment.
 * In production this is the real workerd `cloudflare:workers` env; in dev
 * the adapter's platformProxy virtual module backs it with local D1.
 * Migrations + seed are applied out-of-band via `wrangler d1 migrations apply`.
 */
export function getDb(): DB {
	return drizzle(env.DB, { schema });
}

export function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}
