import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';
import { seedPlants } from './seed';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

let _db: BetterSQLite3Database<typeof schema> | null = null;

/**
 * Lazy singleton: opens the SQLite file, applies pending migrations,
 * and seeds the plant catalog on first access. Safe to call from any
 * server route; the heavy work happens exactly once per process.
 */
export function getDb(): BetterSQLite3Database<typeof schema> {
	if (!_db) {
		const file = process.env.PIXEL_DB ?? '.data/pixel.db';
		const abs = path.resolve(file);
		mkdirSync(path.dirname(abs), { recursive: true });
		const raw = new Database(abs);
		raw.pragma('journal_mode = WAL');
		raw.pragma('foreign_keys = ON');
		_db = drizzle(raw, { schema });
		migrate(_db, { migrationsFolder: path.resolve('drizzle') });
		seedPlants(_db);
	}
	return _db;
}

export function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}
