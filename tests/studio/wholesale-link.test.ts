import { describe, expect, it } from 'vitest';
import { ADMIN_URL_MAX, DEFAULT_ADMIN_URL, effectiveAdminUrl, normalizeAdminUrl } from '@/server/wholesale/link';

describe('normalizeAdminUrl', () => {
  it('keeps the origin and path of an https address, with no trailing slash, query or fragment', () => {
    expect(normalizeAdminUrl(' https://al-noor.example.com/ ')).toBe('https://al-noor.example.com');
    expect(normalizeAdminUrl('https://al-noor.example.com/admin/?a=1#top')).toBe('https://al-noor.example.com/admin');
    expect(normalizeAdminUrl('HTTPS://Al-Noor.Example.com')).toBe('https://al-noor.example.com');
  });

  it('turns an empty entry into null: the address is cleared', () => {
    expect(normalizeAdminUrl('')).toBeNull();
    expect(normalizeAdminUrl('   ')).toBeNull();
  });

  it('refuses what a browser must never be sent to', () => {
    for (const bad of ['http://a.example.com', 'javascript:alert(1)', 'https://u:p@a.example.com', 'https://u@a.example.com', 'https://localhost', 'not a url', 'ftp://a.example.com']) {
      expect(normalizeAdminUrl(bad), bad).toBeUndefined();
    }
    expect(normalizeAdminUrl(`https://a.example.com/${'x'.repeat(ADMIN_URL_MAX)}`)).toBeUndefined();
  });
});

describe('effectiveAdminUrl', () => {
  it('uses the saved address, else WHOLESALE_URL when it is a good address, else the default', () => {
    expect(effectiveAdminUrl('https://al-noor.example.com', { WHOLESALE_URL: 'https://other.example.com' })).toBe('https://al-noor.example.com');
    expect(effectiveAdminUrl(null, { WHOLESALE_URL: 'https://other.example.com/' })).toBe('https://other.example.com');
    expect(effectiveAdminUrl(null, {})).toBe(DEFAULT_ADMIN_URL);
    expect(effectiveAdminUrl(null, { WHOLESALE_URL: 'http://insecure.example.com' })).toBe(DEFAULT_ADMIN_URL);
    expect(effectiveAdminUrl(null, { WHOLESALE_URL: '' })).toBe(DEFAULT_ADMIN_URL);
  });
});
