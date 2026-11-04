/**
 * The address of a company's own Wholesale system. Wholesale is sold as one separate copy per company, each with its own
 * domain, so Studio keeps that address and nothing else about it. It is only ever an https address with no credentials in
 * it, because the Super Admin's "Open Wholesale" sends the browser there: a `javascript:` or `http:` address, or one that
 * carries a user name and password, is refused rather than followed.
 */

/** The longest address kept; far above any real company domain. */
export const ADMIN_URL_MAX = 300;

/**
 * The address to keep for what the Super Admin typed: its origin and path with no trailing slash, query or fragment; null
 * for an empty entry (the address is cleared); `undefined` when the text is no acceptable address.
 */
export function normalizeAdminUrl(input: string): string | null | undefined {
  const text = input.trim();
  if (text === '') return null;
  if (text.length > ADMIN_URL_MAX) return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || !url.hostname.includes('.')) return undefined;
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}
