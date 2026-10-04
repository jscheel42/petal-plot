// Tiny fetch helper for the client: JSON in/out, throws on non-2xx.
export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		headers: { 'content-type': 'application/json' },
		...init
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
	return body as T;
}
