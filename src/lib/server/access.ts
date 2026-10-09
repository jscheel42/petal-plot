// Cloudflare Access JWT validation — defense-in-depth behind edge enforcement.
// When Access protects the hostname (allowed_actions POST/PATCH/DELETE), the
// edge injects `Cf-Access-Jwt-Assertion` on authenticated writes. We re-verify
// signature, audience and expiry here so a dashboard misconfiguration can never
// silently reopen writes while the secrets are still set.

type Jwk = { kid: string; kty: string; n: string; e: string };

let cache: { keys: Map<string, CryptoKey>; fetched: number } | null = null;

function b64urlDecode(s: string): string {
	return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

function b64urlBytes(s: string): Uint8Array<ArrayBuffer> {
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

async function getKeys(team: string): Promise<Map<string, CryptoKey>> {
	if (cache && Date.now() - cache.fetched < 3_600_000) return cache.keys;
	const res = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
	if (!res.ok) throw new Error(`Access JWKS fetch failed: HTTP ${res.status}`);
	const { keys } = (await res.json()) as { keys: Jwk[] };
	const map = new Map<string, CryptoKey>();
	for (const k of keys) {
		map.set(
			k.kid,
			await crypto.subtle.importKey(
				'jwk',
				{ kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true },
				{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
				false,
				['verify']
			)
		);
	}
	cache = { keys: map, fetched: Date.now() };
	return map;
}

// Returns the verified email, or null when the token is invalid/expired/mismatched.
export async function validateAccessJwt(token: string, team: string, aud: string): Promise<string | null> {
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	const h = parts[0] ?? '';
	const p = parts[1] ?? '';
	const sig = parts[2] ?? '';
	let kid: string;
	try {
		const header = JSON.parse(b64urlDecode(h)) as { alg?: string; kid?: string };
		if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
		kid = header.kid;
	} catch {
		return null;
	}
	let key: CryptoKey | undefined;
	try {
		key = (await getKeys(team)).get(kid);
	} catch {
		return null;
	}
	if (!key) return null;
	const ok = await crypto.subtle.verify(
		'RSASSA-PKCS1-v1_5',
		key,
		b64urlBytes(sig),
		new TextEncoder().encode(`${h}.${p}`)
	);
	if (!ok) return null;
	try {
		const claims = JSON.parse(b64urlDecode(p)) as { aud?: string[]; exp?: number; email?: string };
		const now = Math.floor(Date.now() / 1000);
		if (!claims.exp || claims.exp < now) return null;
		const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud ?? ''];
		if (!auds.includes(aud)) return null;
		return claims.email ?? 'authenticated';
	} catch {
		return null;
	}
}
