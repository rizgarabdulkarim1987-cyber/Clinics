import type { Metadata } from 'next';
import { DEMO_CUSTOMER_NAMES, DEMO_ITEM_CODES, DEMO_SUPPLIER_NAMES } from '@/server/wholesale/demoFill';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { periodsQuery, settingsQuery } from '@/server/wholesale/queries/books';
import { customersQuery, itemsQuery, suppliersQuery } from '@/server/wholesale/queries/catalog';
import { getStudioTranslator } from '@/studio/messages';
import { PageHeader, StatusBadge } from '@/studio/ui';
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
      <PageHeader title={t('wh.settings.title')} description={t('wh.settings.description')} />
      <div className="flex flex-col gap-6 px-4 pb-10 md:px-8">
        <section className="rounded-md border border-line bg-raised p-4">
          <SettingsForm values={settings} />
        </section>
        {(canAdd || canRemove) && <DemoFill canAdd={canAdd} canRemove={canRemove} />}
        <section className="flex flex-col gap-3">
          <h2 className="text-md font-semibold">{t('wh.periods.title')}</h2>
          <p className="text-sm text-muted">{t('wh.periods.hint')}</p>
          <ul className="flex flex-col gap-3">
            {periods.map((p) => (
              <li key={p.month} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-raised p-4">
                <span className="flex items-center gap-3">
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
        </section>
      </div>
    </>
  );
}
