import { parsePeriod, periodKey } from '@/lib/accounts';
import { buildBookWorkbook } from '@/server/accounts/workbook';
import { getActor } from '@/server/studio/auth/actor';
import { invokeQuery } from '@/server/studio/framework/invoke';
import { accountsBook } from '@/server/studio/queries/accounts';
import { getStudioTranslator } from '@/studio/messages';

/**
 * The books as an Excel file: a link the browser downloads (`?period=month:2026-11|year:2026|all`), never base64 in a
 * page. Only a Super Admin gets it; anyone else gets the refusal as plain text.
 */

export const runtime = 'nodejs';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID: 400 };

const refuse = (message: string, status: number) =>
  new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export async function GET(request: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return refuse('Sign in first', 401);
  const period = parsePeriod(new URL(request.url).searchParams.get('period'));
  if (!period) return refuse('Unknown period', 400);

  const result = await invokeQuery(accountsBook, {});
  if (!result.ok) return refuse(result.error.message, STATUS[result.error.code] ?? 400);

  const bytes = await buildBookWorkbook(result.data, period, getStudioTranslator(actor.locale), actor.locale);
  const fileName = `buzzify-accounts-${periodKey(period).replace(':', '-')}.xlsx`;
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': XLSX,
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
    },
  });
}
