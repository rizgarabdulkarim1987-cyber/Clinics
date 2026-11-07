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

/** Where a wholesale company's system is when no address of its own is saved: the shared Wholesale host. */
export const DEFAULT_ADMIN_URL = 'https://wholesales.buzzify.tech';

/**
 * The address the Studio uses for a company: the one saved for it, else the default (`WHOLESALE_URL` when it is a valid
 * address, otherwise `DEFAULT_ADMIN_URL`). So the company's link shows up without anyone saving it first; saving an address
 * of its own replaces it, which is what a second company on its own domain does.
 */
export function effectiveAdminUrl(saved: string | null, env: Record<string, string | undefined> = process.env): string {
  if (saved) return saved;
  const fromEnv = normalizeAdminUrl(env.WHOLESALE_URL ?? '');
  return fromEnv ?? DEFAULT_ADMIN_URL;
}
