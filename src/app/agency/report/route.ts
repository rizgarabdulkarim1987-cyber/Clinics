import { parsePeriod } from '@/lib/accounts';
import { renderReportPage } from '@/server/accounts/report';
import { getActor } from '@/server/studio/auth/actor';
import { invokeQuery } from '@/server/studio/framework/invoke';
import { accountsBook } from '@/server/studio/queries/accounts';
import { getStudioTranslator } from '@/studio/messages';

/**
 * The books for a period as a printable page (`?period=month:2026-11|year:2026|all&lang=ar|ckb|en`); the browser's Print
 * makes the PDF. Only a Super Admin reaches it.
 */

export const runtime = 'nodejs';

const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID: 400 };
const LANGS = ['ar', 'ckb', 'en'] as const;

const refuse = (message: string, status: number) =>
  new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export async function GET(request: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return refuse('Sign in first', 401);
  const params = new URL(request.url).searchParams;
  const period = parsePeriod(params.get('period'));
  if (!period) return refuse('Unknown period', 400);
  const locale = LANGS.find((code) => code === params.get('lang')) ?? actor.locale;

  const result = await invokeQuery(accountsBook, {});
  if (!result.ok) return refuse(result.error.message, STATUS[result.error.code] ?? 400);

  return new Response(renderReportPage(result.data, period, getStudioTranslator(locale), locale), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    },
  });
}
