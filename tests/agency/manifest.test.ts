import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/agency/manifest/route';

describe('the agency app manifest', () => {
  it('has what Chrome and Edge need to offer the install', async () => {
    const response = GET();
    expect(response.headers.get('content-type')).toContain('application/manifest+json');
    const manifest = await response.json();
    expect(manifest).toMatchObject({ name: 'Buzzify Agency', start_url: '/agency', display: 'standalone', scope: '/' });
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  it('points at icons that exist', async () => {
    const manifest = await GET().json();
    for (const icon of manifest.icons as { src: string }[]) expect(existsSync(join(process.cwd(), 'public', icon.src)), icon.src).toBe(true);
  });
});
