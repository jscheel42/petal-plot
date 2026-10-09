// Cloudflare Access JWT validation: real RSA signatures against a mocked
// JWKS endpoint. Accepts valid aud/exp; rejects expired, wrong audience,
// wrong signing key, and garbage.
import { beforeAll, describe, expect, it } from 'vitest';
import { validateAccessJwt } from './access';

const KEY_PAIR = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' } as const;

const signKey = await crypto.subtle.generateKey(KEY_PAIR, true, ['sign']);
const pubJwk = (await crypto.subtle.exportKey('jwk', signKey.publicKey)) as JsonWebKey;
const foreignKey = await crypto.subtle.generateKey(KEY_PAIR, true, ['sign']);

const b64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function mint(claims: Record<string, unknown>, key: CryptoKey, kid = 'test-kid'): Promise<string> {
	const h = b64(JSON.stringify({ alg: 'RS256', kid }));
	const p = b64(JSON.stringify(claims));
	const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${h}.${p}`)));
	return `${h}.${p}.${b64(String.fromCharCode(...sig))}`;
}

beforeAll(() => {
	const orig = globalThis.fetch;
	globalThis.fetch = ((input: RequestInfo | URL) => {
		if (String(input).includes('cdn-cgi/access/certs')) {
			return Promise.resolve(
				Response.json({ keys: [{ kid: 'test-kid', kty: 'RSA', n: pubJwk.n, e: pubJwk.e, alg: 'RS256', use: 'sig' }] })
			);
		}
		return orig(input as RequestInfo);
	}) as typeof fetch;
});

const future = () => Math.floor(Date.now() / 1000) + 600;

describe('cloudflare access jwt validation', () => {
	it('accepts a valid token and returns the email', async () => {
		const t = await mint({ aud: ['AUD-TAG'], exp: future(), email: 'me@gmail.com' }, signKey.privateKey);
		expect(await validateAccessJwt(t, 'team', 'AUD-TAG')).toBe('me@gmail.com');
	});

	it('rejects expired tokens', async () => {
		const t = await mint({ aud: ['AUD-TAG'], exp: Math.floor(Date.now() / 1000) - 10 }, signKey.privateKey);
		expect(await validateAccessJwt(t, 'team', 'AUD-TAG')).toBeNull();
	});

	it('rejects wrong audience', async () => {
		const t = await mint({ aud: ['OTHER-APP'], exp: future(), email: 'me@gmail.com' }, signKey.privateKey);
		expect(await validateAccessJwt(t, 'team', 'AUD-TAG')).toBeNull();
	});

	it('rejects tokens signed by a foreign key and unsigned garbage', async () => {
		const forged = await mint({ aud: ['AUD-TAG'], exp: future(), email: 'attacker@evil.com' }, foreignKey.privateKey);
		expect(await validateAccessJwt(forged, 'team', 'AUD-TAG')).toBeNull();
		expect(await validateAccessJwt('garbage', 'team', 'AUD-TAG')).toBeNull();
	});
});
