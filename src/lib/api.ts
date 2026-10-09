// Tiny fetch helper for the client: JSON in/out, throws on non-2xx.
// Cloudflare Access blocks anonymous writes at the edge (403, or a CORS
// failure when fetch follows the login redirect) — both surface as
// "sign-in required" plus a global banner trigger.
export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
	const write = (init?.method ?? 'GET') !== 'GET';
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
