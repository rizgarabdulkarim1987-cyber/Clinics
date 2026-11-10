import { buildBookWorkbook } from '@/server/accounts/workbook';
import { getActor } from '@/server/studio/auth/actor';
import { invokeQuery } from '@/server/studio/framework/invoke';
import { accountsBackup } from '@/server/studio/queries/accounts';
import { getStudioTranslator } from '@/studio/messages';

/** One day's backup of the books as an Excel file (`?id=<backup>&lang=ar|ckb|en`). Only a Super Admin gets it. */

export const runtime = 'nodejs';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID: 400 };
const LANGS = ['ar', 'ckb', 'en'] as const;

const refuse = (message: string, status: number) =>
  new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export async function GET(request: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return refuse('Sign in first', 401);
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  if (!id) return refuse('Unknown backup', 400);
  const locale = LANGS.find((code) => code === params.get('lang')) ?? actor.locale;

  const result = await invokeQuery(accountsBackup, { id });
  if (!result.ok) return refuse(result.error.message, STATUS[result.error.code] ?? 400);

  const bytes = await buildBookWorkbook(result.data.book, { kind: 'all' }, getStudioTranslator(locale), locale);
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': XLSX,
      'content-disposition': `attachment; filename="buzzify-accounts-backup-${result.data.takenOn}.xlsx"`,
      'cache-control': 'no-store',
    },
  });
}
