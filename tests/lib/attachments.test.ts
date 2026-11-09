import { describe, expect, it } from 'vitest';
import { cleanAttachmentName, sniffAttachment } from '@/lib/attachments';

describe('attachments', () => {
  it('reads the type from the first bytes, whatever the name says', () => {
    expect(sniffAttachment(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]))).toBe('image/png');
    expect(sniffAttachment(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffAttachment(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe('application/pdf');
    expect(sniffAttachment(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
    expect(sniffAttachment(new TextEncoder().encode('<script>alert(1)</script>'))).toBeNull();
    expect(sniffAttachment(new Uint8Array())).toBeNull();
  });
  it('keeps a name safe and gives it the real extension', () => {
    expect(cleanAttachmentName('..\\evil/path\\invoice "1".exe', 'application/pdf')).toBe('invoice 1.pdf');
    expect(cleanAttachmentName('', 'image/png')).toBe('file.png');
    expect(cleanAttachmentName('receipt.JPG', 'image/jpeg')).toBe('receipt.jpg');
  });
});
