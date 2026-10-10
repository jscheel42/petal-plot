// Tiny fetch helper for the client: JSON in/out, throws on non-2xx.
// Anonymous writes get a 401 from the server gate — surface that as
// "sign-in required" plus the global modal trigger ('ppsignin'). The
// /api/auth/* endpoints themselves must not re-trigger the modal.
export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
	const write = (init?.method ?? 'GET') !== 'GET' && !path.startsWith('/api/auth/');
	let res: Response;
	try {
		res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init });
	} catch (e) {
		if (write) {
			window.dispatchEvent(new Event('ppsignin'));
			throw new Error('sign-in required');
		}
		throw e as Error;
	}
	if (write && (res.status === 401 || res.status === 403)) {
		window.dispatchEvent(new Event('ppsignin'));
		throw new Error('sign-in required');
	}
	const body: unknown = await res.json().catch(() => ({}));
	if (!res.ok) {
		const msg = body && typeof body === 'object' && 'error' in body ? String(body.error) : `HTTP ${res.status}`;
		throw new Error(msg);
	}
	return body as T; // generic response shape is the caller's contract
}
