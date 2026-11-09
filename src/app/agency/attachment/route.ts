import { addAccountAttachment } from '@/server/studio/actions/accounts';
import { invoke, invokeQuery } from '@/server/studio/framework/invoke';
import { getActor } from '@/server/studio/auth/actor';
import { accountAttachment } from '@/server/studio/queries/accounts';

/**
 * Files kept with an entry. POST uploads one (`multipart`, fields `entry` and `file`); GET shows or downloads one
 * (`?id=`). Only a Super Admin reaches either; the bytes are checked again by the action, so this route trusts nothing.
 */

export const runtime = 'nodejs';

const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID: 400 };

const refuse = (message: string, status: number) =>
  new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export async function GET(request: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return refuse('Sign in first', 401);
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return refuse('Unknown file', 400);
  const result = await invokeQuery(accountAttachment, { id });
  if (!result.ok) return refuse(result.error.message, STATUS[result.error.code] ?? 400);
  const { fileName, mediaType, bytes } = result.data;
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': mediaType,
      'content-disposition': `inline; filename="${fileName.replace(/[^A-Za-z0-9._ -]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'content-security-policy': "sandbox; default-src 'none'; img-src 'self' data:",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return refuse('Sign in first', 401);
  const form = await request.formData().catch(() => null);
  const entryId = form?.get('entry');
  const file = form?.get('file');
  if (typeof entryId !== 'string' || !(file instanceof File)) return refuse('Send an entry and a file', 400);
  const result = await invoke(addAccountAttachment, { entryId, fileName: file.name, data: new Uint8Array(await file.arrayBuffer()) });
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: STATUS[result.error.code] ?? 400, headers: { 'cache-control': 'no-store' } });
  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
