import type { Metadata } from 'next';
import { CalendarDays, Settings } from 'lucide-react';
import { Chip, Fold } from '../../_ui/Ui';
import { DEMO_CUSTOMER_NAMES, DEMO_ITEM_CODES, DEMO_SUPPLIER_NAMES } from '@/server/wholesale/demoFill';
import { canWh } from '@/server/domain/wholesale/permissions';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { periodsQuery, settingsQuery } from '@/server/wholesale/queries/books';
import { customersQuery, itemsQuery, suppliersQuery } from '@/server/wholesale/queries/catalog';
import { getStudioTranslator } from '@/studio/messages';
import { StatusBadge } from '@/studio/ui';
import { HeaderLink, PageHeader } from '../../_ui/PageHeader';
import { PeriodButton, SettingsForm } from '../../_ui/BooksForms';
import { DemoFill } from '../../_ui/DemoFill';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const [settings, periods, items, suppliers, customers] = await Promise.all([queryWh(settingsQuery), queryWh(periodsQuery), queryWh(itemsQuery), queryWh(suppliersQuery), queryWh(customersQuery)]);
  const demoItems = new Set(DEMO_ITEM_CODES);
  const demoSuppliers = new Set(DEMO_SUPPLIER_NAMES);
  const demoCustomers = new Set(DEMO_CUSTOMER_NAMES);
  const canAdd = !(items.some((i) => i.code === 'SUGAR-1') && suppliers.some((s) => s.name === 'Al-Rafidain Food Trading') && customers.some((c) => c.name === 'Al-Amin Supermarket'));
  const canRemove = items.some((i) => demoItems.has(i.code) && i.active) || suppliers.some((s) => demoSuppliers.has(s.name)) || customers.some((c) => demoCustomers.has(c.name));
  return (
    <>
      <PageHeader icon={Settings} tone="violet" title={t('wh.settings.title')} description={t('wh.settings.description')} actions={canWh(actor!.role, 'import.apply') ? <HeaderLink href="/wholesale/opening">{t('wh.nav.opening')}</HeaderLink> : undefined} />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-6">
        <section className="rounded-md border border-line bg-raised p-4">
          <SettingsForm values={settings} />
        </section>
        {(canAdd || canRemove) && <DemoFill canAdd={canAdd} canRemove={canRemove} />}
        <Fold icon={CalendarDays} tone="teal" title={t('wh.periods.title')}>
          <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t('wh.periods.hint')}</p>
          <ul className="grid gap-2 overflow-y-auto md:max-h-[40dvh] md:grid-cols-2">
            {periods.map((p) => (
              <li key={p.month} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised px-3 py-2">
                <span className="flex items-center gap-3">
                  <Chip icon={CalendarDays} tone="teal" size="size-8" />
                  <span className="text-base font-semibold tabular-nums" dir="ltr">
                    {p.month}
                  </span>
                  <span className="text-sm text-muted">
                    {p.entries} {t('wh.periods.entries')}
                  </span>
                  {p.closed && <StatusBadge tone="ink">{t('wh.periods.closedBadge')}</StatusBadge>}
                </span>
                <PeriodButton month={p.month} closed={p.closed} />
              </li>
            ))}
          </ul>
          </div>
        </Fold>
      </div>
    </>
  );
}
