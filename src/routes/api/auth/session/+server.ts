// Edit-mode session endpoints. POST verifies the shared password and issues
// the pp_admin cookie; GET reports status for the UI; DELETE logs out.
// /api/auth/* is exempt from the write gate in hooks.server.ts.
import { env } from 'cloudflare:workers';
import { mintAdminToken, passwordMatches, verifyAdminToken } from '#lib/server/auth';
import type { RequestHandler } from './$types';

const TTL = 12 * 3600; // 12 hours of editing per login

export const GET: RequestHandler = async ({ cookies }) => {
	const secret: string | undefined = env.ADMIN_PASSWORD;
	if (!secret) return Response.json({ authed: true }); // dev: unlocked
	const token = cookies.get('pp_admin');
	return Response.json({ authed: token ? await verifyAdminToken(token, secret) : false });
};

export const POST: RequestHandler = async ({ request, cookies, url }) => {
	const secret: string | undefined = env.ADMIN_PASSWORD;
	if (!secret) return Response.json({ ok: true }); // dev: no password needed
	const body: unknown = await request.json().catch(() => ({}));
	const pw = body && typeof body === 'object' && 'password' in body ? String(body.password) : '';
	if (!pw || !(await passwordMatches(pw, secret))) {
		return Response.json({ error: 'wrong password' }, { status: 401 });
	}
	cookies.set('pp_admin', await mintAdminToken(secret, TTL), {
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		path: '/',
		maxAge: TTL
	});
	return Response.json({ ok: true });
};

export const DELETE: RequestHandler = async ({ cookies }) => {
	cookies.delete('pp_admin', { path: '/' });
	return Response.json({ ok: true });
};
