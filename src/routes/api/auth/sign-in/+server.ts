import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Login trigger: the browser submits a hidden form here (top-level POST).
// Cloudflare Access intercepts it (POST is edge-enforced), runs the
// email-OTP/Google login, then lands back on this handler — bounce to the app.
export const POST: RequestHandler = async ({ url }) => {
	redirect(302, url.searchParams.get('to') ?? '/');
};
