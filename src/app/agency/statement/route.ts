import { buildStatementWorkbook } from '@/server/accounts/statement';
import { getActor } from '@/server/studio/auth/actor';
import { invokeQuery } from '@/server/studio/framework/invoke';
import { accountsBook } from '@/server/studio/queries/accounts';
import { getStudioTranslator } from '@/studio/messages';

/** One client's statement as an Excel file (`?client=<id>`). Only a Super Admin gets it. */

export const runtime = 'nodejs';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID: 400 };

const refuse = (message: string, status: number) =>
  new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export async function GET(request: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return refuse('Sign in first', 401);
  const clientId = new URL(request.url).searchParams.get('client');
  if (!clientId) return refuse('Unknown client', 400);

  const result = await invokeQuery(accountsBook, {});
  if (!result.ok) return refuse(result.error.message, STATUS[result.error.code] ?? 400);

  const built = await buildStatementWorkbook(result.data, clientId, getStudioTranslator(actor.locale), actor.locale);
  if (!built) return refuse('Unknown client', 404);
  return new Response(Buffer.from(built.bytes), {
    headers: {
      'content-type': XLSX,
      'content-disposition': `attachment; filename="statement-${built.name.replace(/[^a-z0-9-]/gi, '')}.xlsx"`,
      'cache-control': 'no-store',
    },
  });
}
