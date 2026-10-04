import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			// platformProxy gives `npm run dev` a local D1 (persisted in .wrangler/state);
			// production runs on the real worker after `wrangler deploy`.
			adapter: adapter({ platformProxy: { persist: true } })
		})
	]
});
