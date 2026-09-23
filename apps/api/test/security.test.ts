import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, verifyMetaSignature } from '../src/security/crypto.js';

describe('secret protection', () => {
  it('uses randomized authenticated encryption', () => {
    const key = randomBytes(32);
    const first = encryptSecret('sensitive-token', key);
    const second = encryptSecret('sensitive-token', key);
    expect(first).not.toBe(second);
    expect(decryptSecret(first, key)).toBe('sensitive-token');
  });

  it('rejects a modified GCM envelope', () => {
    const key = randomBytes(32);
    const encrypted = encryptSecret('sensitive-token', key);
    expect(() => decryptSecret(`${encrypted.slice(0, -1)}A`, key)).toThrow();
  });
});

describe('Meta webhook signature', () => {
  it('accepts only the matching raw payload', () => {
    const secret = 'meta-app-secret';
    const raw = Buffer.from('{"entry":[]}');
    const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    expect(verifyMetaSignature(raw, signature, secret)).toBe(true);
    expect(verifyMetaSignature(Buffer.from('{"entry":[1]}'), signature, secret)).toBe(false);
  });
});
