import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const APP = path.join(ROOT, 'src/app/studio/(studio)/(app)');
const SPACE = 'wholesale/(space)';
const read = (relative: string) => readFileSync(path.join(APP, relative), 'utf8');
const readRoot = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

describe('the Wholesale space routes', () => {
  it('has a page for each screen of the space and each tab of a company', () => {
    for (const screen of ['page', 'new/page', 'overview/page', 'billing/page', 'people/page', 'announcements/page', 'activity/page', 'settings/page']) {
      expect(existsSync(path.join(APP, SPACE, `${screen}.tsx`)), screen).toBe(true);
    }
    for (const tab of ['page', 'billing/page', 'people/page', 'activity/page', 'wholesale/page']) {
      expect(existsSync(path.join(APP, SPACE, '[id]', `${tab}.tsx`)), tab).toBe(true);
    }
    // Wholesale keeps no branches of its companies.
    expect(existsSync(path.join(APP, SPACE, '[id]/branches'))).toBe(false);
  });

  it('is closed to everyone but a Super Admin, and refuses a business of another project', () => {
    expect(read(`${SPACE}/layout.tsx`)).toMatch(/!actor\.isSuperAdmin\) notFound\(\)/);
    expect(read(`${SPACE}/layout.tsx`)).toContain('<SpaceWords space="wholesale">');
    expect(read(`${SPACE}/[id]/layout.tsx`)).toMatch(/sector !== 'WHOLESALE'\) notFound\(\)/);
    expect(read(`${SPACE}/[id]/layout.tsx`)).toContain('space="wholesale"');
  });

  it('keeps its plans and prices in its own Settings, and sends the shared plans screen there', () => {
    expect(read(`${SPACE}/settings/page.tsx`)).toContain('applicationId="wholesale"');
    expect(read('billing/plans/page.tsx')).toContain('/studio/wholesale/settings');
  });

  it('opens a company’s own system through a Super Admin handoff that carries no token', () => {
    const route = path.join(ROOT, 'src/app/studio/wholesale/open/[restaurantId]/route.ts');
    expect(existsSync(route)).toBe(true);
    expect(readFileSync(route, 'utf8')).toContain('openRoute');
    expect(existsSync(path.join(ROOT, 'src/app/studio/wholesale/layout.tsx'))).toBe(false);
  });

  it('moves a wholesale company out of the Menu and Cashier address, and shows its tab only to a Super Admin', () => {
    expect(readRoot('src/app/studio/(studio)/(app)/restaurants/[id]/layout.tsx')).toContain("'WHOLESALE'");
    const layout = readRoot('src/app/studio/(studio)/(app)/restaurants/[id]/BusinessLayout.tsx');
    expect(layout).toContain('restaurants.tabs.wholesale');
    expect(layout).toContain('wholesale.title');
  });

  it('puts the company picker and the address form where the other spaces keep theirs', () => {
    expect(readRoot('src/studio/pickers.ts')).toContain('wholesale');
    expect(existsSync(path.join(APP, 'restaurants/[id]/wholesale/WholesalePanel.tsx'))).toBe(true);
  });
});
