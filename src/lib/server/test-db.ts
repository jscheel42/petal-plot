// Test-only D1 harness. In vitest this file is aliased as `cloudflare:workers`
// (see vitest.config.ts), so `getDb()` resolves `env.DB` straight to the
// proxy binding. Boots wrangler's platform proxy (ephemeral local D1, same
// code path the adapter uses in `npm run dev`) and applies the real
// migrations + seed SQL on first use.
import { readdirSync, readFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import type { D1Database } from '@cloudflare/workers-types';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type TestDb = {
	d1: D1Database;
	db: DrizzleD1Database<typeof schema>;
	dispose: () => Promise<void>;
};

// Vitest may load this file twice (once via the `cloudflare:workers` alias),
// so harness state lives on globalThis behind a stable symbol.
type Shared = { promise: Promise<TestDb> | null; resolved: TestDb | undefined };
const store = globalThis as unknown as Record<symbol, Shared | undefined>;
const shared: Shared = (store[Symbol.for('petal-plot:test-db')] ??= { promise: null, resolved: undefined });

async function execSql(d1: D1Database, file: string): Promise<void> {
	// The proxy exec only takes one statement at a time; drizzle-kit files
	// separate statements with `-->` comments, so split on semicolon endings.
	const sql = readFileSync(file, 'utf8');
	for (const stmt of sql.split(/;\s*$/m)) {
		const trimmed = stmt.replace(/-->.*/g, '').trim();
		if (trimmed) await d1.prepare(trimmed).run();
	}
}

async function init(): Promise<TestDb> {
	const proxy = await getPlatformProxy<{ DB: D1Database }>({
		configPath: 'wrangler.jsonc',
		persist: false,
		remoteBindings: false
	});
	const d1 = proxy.env.DB;
	// Apply every migration in filename order (0000, 0001, 0002, …).
	for (const f of readdirSync('drizzle').filter((f) => f.endsWith('.sql')).sort()) {
		await execSql(d1, `drizzle/${f}`);
	}
	return { d1, db: drizzle(d1, { schema }), dispose: () => proxy.dispose() };
}

export function testDb(): Promise<TestDb> {
	shared.promise ??= init().then((t) => {
		shared.resolved = t;
		return t;
	});
	return shared.promise;
}

export const env: { DB: D1Database } = {
	get DB() {
		if (!shared.resolved) throw new Error('D1 binding not ready — await testDb() before calling routes');
		return shared.resolved.d1;
	}
};
