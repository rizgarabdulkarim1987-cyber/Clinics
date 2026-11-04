import { getActor } from '@/server/studio/auth/actor';
import { query } from '@/server/studio/framework/invoke';
import { wholesaleDetail } from '@/server/studio/queries/wholesale';

/**
 * The Super Admin's "Open Wholesale" for one company, in one place so the Studio's route file stays one line and never
 * touches the database client. It answers a 302 to the address of that company's own Wholesale system, and 404 for anyone
 * who is not a Super Admin, for a business that is no wholesale company and for a company with no address yet. No token is
 * passed: the company signs in to its own system with its own accounts. The answer is `no-store` and sends no referrer.
 */

const HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } as const;
const notFound = () => new Response(null, { status: 404, headers: HEADERS });

export async function openRoute(restaurantId: string): Promise<Response> {
  const actor = await getActor();
  if (!actor?.isSuperAdmin) return notFound();
  try {
    const company = await query(wholesaleDetail, { restaurantId });
    if (!company.adminUrl) return notFound();
    return new Response(null, { status: 302, headers: { ...HEADERS, location: company.adminUrl } });
  } catch {
    return notFound();
  }
}
