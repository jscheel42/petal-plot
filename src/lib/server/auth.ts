// Stateless admin session: `exp.hmac(secret, exp)` cookie, verified with a
// constant-time compare. No sessions table, no IdP — the password lives in
// the ADMIN_PASSWORD worker secret; the cookie is derived from it, so the
// password never travels after login.

function b64url(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlBytes(s: string): Uint8Array<ArrayBuffer> {
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

async function sign(secret: string, data: string): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
	return diff === 0;
}

export async function mintAdminToken(secret: string, ttlSec: number): Promise<string> {
	const exp = Math.floor(Date.now() / 1000) + ttlSec;
	return `${exp}.${b64url(await sign(secret, String(exp)))}`;
}

export async function verifyAdminToken(token: string, secret: string): Promise<boolean> {
	const dot = token.indexOf('.');
	if (dot <= 0) return false;
	const exp = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	if (!/^\d+$/.test(exp) || Number(exp) * 1000 < Date.now()) return false;
	return constantTimeEqual(b64urlBytes(sig), await sign(secret, exp));
}

export async function passwordMatches(input: string, secret: string): Promise<boolean> {
	if (input.length === 0 || secret.length === 0) return false;
	return constantTimeEqual(await sign(input, 'petal-plot-login'), await sign(secret, 'petal-plot-login'));
}
