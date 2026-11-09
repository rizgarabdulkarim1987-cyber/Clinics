/**
 * What the agency books accept as an attachment: a photo or a PDF of a receipt, an invoice or a contract. The type is
 * read from the first bytes, never from the name or the type the browser claims.
 */

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENTS_PER_ENTRY = 10;

export type AttachmentType = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';

const EXTENSION: Record<AttachmentType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** The type the bytes really are, or null when they are none of the accepted ones. */
export function sniffAttachment(bytes: Uint8Array): AttachmentType | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return 'image/webp';
  if (at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46) return 'application/pdf';
  return null;
}

/** A name safe to show and to put in a download header: no path, no control characters, at most 80 characters, ends with the real extension. */
export function cleanAttachmentName(raw: string, type: AttachmentType): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const stem = base
    .replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .replace(/[\u0000-\u001f"\\<>:|?*]/g, '')
    .trim()
    .slice(0, 70);
  return `${stem || 'file'}.${EXTENSION[type]}`;
}
