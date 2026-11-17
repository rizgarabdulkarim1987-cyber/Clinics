import { invokeCl } from '@/server/clinic/access';
import { saveFile } from '@/server/clinic/actions/patient-files';

const MAX_BODY = 4 * 1024 * 1024;

/** Upload one file for a patient (multipart: `patientId`, `file`). Only from this site's own pages, and only for a member who may save it. */
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || new URL(origin).host !== request.headers.get('host')) return new Response(null, { status: 403 });
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return Response.json({ ok: false, error: { code: 'INVALID' } }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const patientId = form?.get('patientId');
  if (!(file instanceof File) || typeof patientId !== 'string') return Response.json({ ok: false, error: { code: 'INVALID' } }, { status: 400 });
  if (file.size > MAX_BODY) return Response.json({ ok: false, error: { code: 'INVALID' } }, { status: 413 });
  const data = Buffer.from(await file.arrayBuffer()).toString('base64');
  const result = await invokeCl(saveFile, { patientId, name: file.name, mime: file.type, data });
  return Response.json(result.ok ? { ok: true, fileId: result.data.fileId } : { ok: false, error: { code: result.error.code } }, { status: result.ok ? 200 : result.error.code === 'UNAUTHENTICATED' ? 401 : 400 });
}
