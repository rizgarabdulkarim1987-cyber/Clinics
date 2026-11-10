import { describe, expect, it } from 'vitest';
import { whatsappLink, whatsappNumber } from '@/lib/whatsapp';

describe('whatsapp numbers', () => {
  it('turns the ways people write an Iraqi number into one international form', () => {
    expect(whatsappNumber('0770 123 4567')).toBe('9647701234567');
    expect(whatsappNumber('+964 770 123 4567')).toBe('9647701234567');
    expect(whatsappNumber('00964-770-123-4567')).toBe('9647701234567');
    expect(whatsappNumber('964 770 123 4567')).toBe('9647701234567');
    expect(whatsappNumber('7701234567')).toBe('9647701234567');
  });
  it('keeps another country code and refuses what is not a number', () => {
    expect(whatsappNumber('+44 7911 123456')).toBe('447911123456');
    expect(whatsappNumber('')).toBeNull();
    expect(whatsappNumber('12 34')).toBeNull();
  });
  it('builds a link with the message encoded, or nothing without a number', () => {
    expect(whatsappLink('0770 123 4567', 'Hi & bye')).toBe('https://wa.me/9647701234567?text=Hi%20%26%20bye');
    expect(whatsappLink('', 'x')).toBeNull();
  });
});
