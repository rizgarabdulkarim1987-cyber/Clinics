import { openRoute } from '@/server/wholesale/handoff-http';

export const dynamic = 'force-dynamic';

/**
 * `GET /studio/wholesale/open/[restaurantId]`: a Super Admin's "Open Wholesale" for that company; anyone else gets 404
 * (src/server/wholesale/handoff-http.ts). Its static `wholesale/open` segments win over the `(studio)/[...rest]` catch-all.
 */
export async function GET(_request: Request, context: { params: Promise<{ restaurantId: string }> }): Promise<Response> {
  const { restaurantId } = await context.params;
  return openRoute(restaurantId);
}
