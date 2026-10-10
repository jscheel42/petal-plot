// Admin token + password checks: round-trip, tamper, expiry, wrong password.
import { describe, expect, it } from 'vitest';
import { mintAdminToken, passwordMatches, verifyAdminToken } from './auth';

describe('admin session tokens', () => {
	it('round-trips a freshly minted token', async () => {
		const t = await mintAdminToken('s3cret', 3600);
		expect(await verifyAdminToken(t, 's3cret')).toBe(true);
	});

	it('rejects tokens for a different secret', async () => {
		const t = await mintAdminToken('s3cret', 3600);
		expect(await verifyAdminToken(t, 'other')).toBe(false);
	});

	it('rejects expired tokens', async () => {
		const t = await mintAdminToken('s3cret', -10);
		expect(await verifyAdminToken(t, 's3cret')).toBe(false);
	});

	it('rejects tampered or malformed tokens', async () => {
		const t = await mintAdminToken('s3cret', 3600);
		const [exp, sig] = t.split('.') as [string, string];
		expect(await verifyAdminToken(`${Number(exp) + 86400}.${sig}`, 's3cret')).toBe(false);
		expect(await verifyAdminToken(`${exp}.AAAA`, 's3cret')).toBe(false);
		expect(await verifyAdminToken('garbage', 's3cret')).toBe(false);
		expect(await verifyAdminToken('', 's3cret')).toBe(false);
	});
});

describe('password matching', () => {
	it('accepts the right password, rejects wrong/empty', async () => {
		expect(await passwordMatches('amber-hedgehog-42', 'amber-hedgehog-42')).toBe(true);
		expect(await passwordMatches('amber-hedgehog-43', 'amber-hedgehog-42')).toBe(false);
		expect(await passwordMatches('', 'amber-hedgehog-42')).toBe(false);
	});
});
