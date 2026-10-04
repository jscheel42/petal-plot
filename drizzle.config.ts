import type { Config } from 'drizzle-kit';

// Generate-only: migrations are applied by `wrangler d1 migrations apply`.
export default {
	schema: './src/lib/server/schema.ts',
	out: './drizzle',
	dialect: 'sqlite'
} satisfies Config;
