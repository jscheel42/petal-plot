// Anonymous GETs stay open (read-only visitors). Writes must carry a valid
// Cloudflare Access identity: the edge enforces this when the Access app
// exists (allowed_actions POST/PATCH/DELETE); this hook re-validates the
// injected JWT so writes fail closed if the app is ever removed while the
// ACCESS_AUD/ACCESS_TEAM secrets remain set. Dev (no secrets) stays open.
import type { Handle } from '@sveltejs/kit/hooks';
import { validateAccessJwt } from '#lib/server/access';

export const handle: Handle = async ({ event, resolve }) => {
	if (event.request.method !== 'GET') {
		const team = event.platform?.env.ACCESS_TEAM;
		const aud = event.platform?.env.ACCESS_AUD;
		if (aud) {
			const token =
				event.request.headers.get('cf-access-jwt-assertion') ?? event.cookies.get('CF_Authorization');
			const email = token && team ? await validateAccessJwt(token, team, aud) : null;
			if (!email) return Response.json({ error: 'sign-in required' }, { status: 401 });
			event.locals.email = email;
		}
	}
	return resolve(event);
};
