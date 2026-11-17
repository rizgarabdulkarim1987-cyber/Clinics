import { invokeCl } from '@/server/clinic/access';
import { saveFile } from '@/server/clinic/actions/patient-files';

const MAX_BODY = 4 * 1024 * 1024;

/** Upload one file for a patient (multipart: `patientId`, `file`). Only from this site's own pages, and only for a member who may save it. */
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || new URL(origin).host !== request.headers.get('host')) return new Response(null, { status: 403 });
  const declared = Number(request.headers.get('content-length'));
  if (!Number.isFinite(declared) || declared <= 0 || declared > MAX_BODY) return Response.json({ ok: false, error: { code: 'INVALID' } }, { status: 413 });
  // Count the bytes that actually arrive and stop at the cap, whatever the header claimed.
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ ok: false, error: { code: 'INVALID' } }, { status: 400 });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BODY) {
      await reader.cancel().catch(() => undefined);
      return Response.json({ ok: false, error: { code: 'INVALID' } }, { status: 413 });
    }
    chunks.push(value);
  }
  const form = await new Response(new Blob(chunks as BlobPart[]), { headers: { 'content-type': request.headers.get('content-type') ?? '' } })
    .formData()
    .catch(() => null);
  const file = form?.get('file');
  const patientId = form?.get('patientId');
  if (!(file instanceof File) || typeof patientId !== 'string') return Response.json({ ok: false, error: { code: 'INVALID' } }, { status: 400 });
  if (file.size > MAX_BODY) return Response.json({ ok: false, error: { code: 'INVALID' } }, { status: 413 });
  const data = Buffer.from(await file.arrayBuffer()).toString('base64');
  const result = await invokeCl(saveFile, { patientId, name: file.name, mime: file.type, data });
  return Response.json(result.ok ? { ok: true, fileId: result.data.fileId } : { ok: false, error: { code: result.error.code } }, { status: result.ok ? 200 : result.error.code === 'UNAUTHENTICATED' ? 401 : 400 });
}
