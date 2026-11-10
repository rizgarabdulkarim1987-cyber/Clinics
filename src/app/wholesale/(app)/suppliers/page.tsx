import type { Metadata } from 'next';
import Link from 'next/link';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { suppliersQuery } from '@/server/wholesale/queries/catalog';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState, StatusBadge } from '@/studio/ui';
import { PageHeader } from '../../_ui/PageHeader';
import { SupplierForm } from '../../_ui/PeopleForms';

export const metadata: Metadata = { title: 'Suppliers' };

export default async function SuppliersPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const suppliers = await queryWh(suppliersQuery);
  return (
    <>
      <PageHeader title={t('wh.suppliers.title')} description={t('wh.suppliers.description')} />
      <div className="flex flex-col gap-4 px-4 pb-6 md:px-6">
        <details className="rounded-md border border-line bg-raised">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.suppliers.new')}</summary>
          <div className="border-t border-line p-4">
            <SupplierForm />
          </div>
        </details>
        {suppliers.length === 0 ? (
          <EmptyState title={t('wh.suppliers.empty')} />
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-y-auto rounded-md border border-line bg-raised md:max-h-[calc(100dvh-12.5rem)]">
            {suppliers.map((s) => (
              <li key={s.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <p className="min-w-0 text-base font-semibold" dir="auto">
                    {s.name} <span className="font-normal text-muted">· {[s.country, s.phone].filter(Boolean).join(' · ')}</span>
                  </p>
                  <div className="flex items-center gap-3">
                    <StatusBadge tone={s.isForeign ? 'ink' : 'neutral'}>{s.isForeign ? t('wh.suppliers.foreign') : t('wh.suppliers.local')}</StatusBadge>
                    <Link href={`/wholesale/suppliers/${s.id}`} className="text-sm font-medium underline">
                      {t('wh.suppliers.statement')}
                    </Link>
                  </div>
                </div>
                <details className="mt-1.5 rounded-md border border-line">
                  <summary className="flex min-h-9 cursor-pointer items-center px-3 text-sm font-medium">{t('wh.common.edit')}</summary>
                  <div className="border-t border-line p-3">
                    <SupplierForm supplier={s} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
