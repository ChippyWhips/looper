import { describe, expect, it } from 'vitest';
import { sha256Hex } from './hash';

describe('sha256', () => {
	it('matches the known digest of "abc"', async () => {
		expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});
});
