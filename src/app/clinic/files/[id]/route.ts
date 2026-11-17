import { invokeCl } from '@/server/clinic/access';
import { readFile } from '@/server/clinic/actions/patient-files';

/** One patient file, for a signed-in member who may read it. Served as the type it was checked to be, never cached, never run as a page. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await invokeCl(readFile, { fileId: id });
  if (!result.ok) return new Response(null, { status: result.error.code === 'UNAUTHENTICATED' ? 401 : 404 });
  const { name, mime, data } = result.data;
  return new Response(Buffer.from(data, 'base64'), {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
