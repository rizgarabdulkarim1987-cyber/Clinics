// Development only: signs in to the local dev app as a seeded user and takes screenshots of the Wholesale screens.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const origin = process.env.WH_ORIGIN ?? 'http://127.0.0.1:3107';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Refusing a non-local origin');
const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
  }),
);
const email = process.env.WH_EMAIL ?? 'owner@buzzify.test';
const out = process.env.WH_OUT ?? 'wh-shots';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const log = [];
for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 375, height: 812 }]]) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && log.push(`${name} console: ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => log.push(`${name} pageerror: ${String(e).slice(0, 200)}`));
  await page.goto(`${origin}/studio/sign-in?next=/wholesale`);
  await page.getByLabel(/email/i).first().fill(email);
  await page.locator('input[type=password]').first().fill(env.DEV_SEED_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).first().click();
  await page.waitForURL(/\/studio(\/|$)/, { timeout: 60000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  for (const path of (process.env.WH_PAGES ?? 'home,catalog,stock,customers,suppliers,staff').split(',')) {
    const res = await page.goto(`${origin}/wholesale/${path}`, { waitUntil: 'networkidle' });
    log.push(`${name} ${path}: ${res?.status()}`);
    await page.screenshot({ path: `${out}/${name}-${path}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log(log.join('\n'));
