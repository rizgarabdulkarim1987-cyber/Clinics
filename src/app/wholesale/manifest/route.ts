/**
 * Wholesale as an installable app: Chrome and Edge (desktop) and Chrome on Android offer "Install" on the Wholesale host, which puts an
 * icon on the desktop or the phone's home screen and opens the company in a window of its own, without the address bar and tabs. It is the
 * same site and the same sign-in, so it updates with every deploy. Nothing here is private: a name, a colour and two icons.
 */
export const dynamic = 'force-static';

export function GET() {
  const manifest = {
    id: '/wholesale',
    name: 'Buzzify Wholesale',
    short_name: 'Wholesale',
    description: 'Wholesale: sales, stock, customers and the books on one screen.',
    start_url: '/wholesale',
    // The whole host, so the sign-in page (under /studio) stays inside the app window.
    scope: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#ffffff',
    icons: [
      { src: '/wholesale/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/wholesale/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
  return new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
