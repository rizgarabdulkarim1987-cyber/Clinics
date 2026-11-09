/**
 * The agency books as an installable app: Chrome and Edge offer "Install" on `agency.buzzify.tech`, which puts an icon on
 * the desktop that opens the books in a window of their own, without the browser's address bar and tabs. It is the same
 * site and the same sign-in, so it updates with every deploy. Nothing here is private: a name, a colour and two icons.
 */
export const dynamic = 'force-static';

export function GET() {
  const manifest = {
    id: '/agency',
    name: 'Buzzify Agency',
    short_name: 'Agency',
    description: 'The agency books: income, expenses and clients on one screen.',
    start_url: '/agency',
    // The whole host, so the sign-in page (under /studio) stays inside the app window.
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/agency/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/agency/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
  return new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
