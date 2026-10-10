// Anonymous visitors get read-only access: every non-GET must carry a valid
// pp_admin cookie (minted by /api/auth/session after the shared-password
// login). No secrets set (dev) → writes open. /api/auth/* is exempt so the
// login itself can run.
import type { Handle } from '@sveltejs/kit/hooks';
import { verifyAdminToken } from '#lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	if (event.request.method !== 'GET' && !event.url.pathname.startsWith('/api/auth/')) {
		const secret = event.platform?.env.ADMIN_PASSWORD;
		if (secret) {
			const token = event.cookies.get('pp_admin');
			if (!token || !(await verifyAdminToken(token, secret))) {
				return Response.json({ error: 'sign-in required' }, { status: 401 });
			}
		}
	}
	return resolve(event);
};
