import { entitlementsRoute } from '@/server/wholesale/entitlements-http';

export const dynamic = 'force-dynamic';

/** `GET /api/v1/entitlements/[businessId]/[applicationId]`: see src/server/wholesale/entitlements-http.ts. */
export async function GET(request: Request, context: { params: Promise<{ businessId: string; applicationId: string }> }): Promise<Response> {
  const { businessId, applicationId } = await context.params;
  return entitlementsRoute(request, businessId, applicationId);
}
