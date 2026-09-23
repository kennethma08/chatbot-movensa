import { describe, expect, it } from 'vitest';
import { domainAllowed } from '../src/routes/webchat.js';

describe('webchat allowed domains', () => {
  it('accepts normalized domains and legacy URL entries', () => {
    expect(domainAllowed('example.com', ['example.com'])).toBe(true);
    expect(domainAllowed('127.0.0.1', ['http://127.0.0.1:5173/ruta/anterior'])).toBe(true);
  });

  it('supports subdomain wildcards without allowing the root domain', () => {
    expect(domainAllowed('chat.example.com', ['*.example.com'])).toBe(true);
    expect(domainAllowed('example.com', ['*.example.com'])).toBe(false);
  });

  it('rejects malformed and unrelated entries', () => {
    expect(domainAllowed('example.com', ['not a domain', 'otro.example'])).toBe(false);
    expect(domainAllowed('example.com', [])).toBe(false);
  });
});
