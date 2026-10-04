import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'cloudflare:workers': './src/lib/server/test-db.ts'
		}
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
