import { renderInvoicePage } from '@/server/accounts/invoice';
import { issueAccountInvoice } from '@/server/studio/actions/accounts';
import { getActor } from '@/server/studio/auth/actor';
import { invoke, invokeQuery } from '@/server/studio/framework/invoke';
import { accountInvoice } from '@/server/studio/queries/accounts';
import { getStudioTranslator } from '@/studio/messages';

/**
 * An income's invoice as a printable page (`?entry=<id>&lang=ar|ckb|en`). The first visit gives the income its invoice
 * number (asking again shows the same one); the browser's Print makes the PDF. Only a Super Admin reaches it.
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
  const entryId = params.get('entry');
  if (!entryId) return refuse('Unknown entry', 400);
  const wanted = params.get('lang');
  const locale = LANGS.find((code) => code === wanted) ?? actor.locale;

  const issued = await invoke(issueAccountInvoice, { entryId });
  if (!issued.ok) return refuse(issued.error.message, STATUS[issued.error.code] ?? 400);
  const result = await invokeQuery(accountInvoice, { entryId });
  if (!result.ok) return refuse(result.error.message, STATUS[result.error.code] ?? 400);

  return new Response(renderInvoicePage(result.data, getStudioTranslator(locale), locale, { entryId }), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    },
  });
}
