import type { Metadata } from 'next';
import Link from 'next/link';
import { getWhAccess, queryWh } from '@/server/wholesale/access';
import { suppliersQuery } from '@/server/wholesale/queries/catalog';
import { getStudioTranslator } from '@/studio/messages';
import { EmptyState, PageHeader, StatusBadge } from '@/studio/ui';
import { SupplierForm } from '../../_ui/PeopleForms';

export const metadata: Metadata = { title: 'Suppliers' };

export default async function SuppliersPage() {
  const { actor } = await getWhAccess();
  const t = getStudioTranslator(actor!.locale);
  const suppliers = await queryWh(suppliersQuery);
  return (
    <>
      <PageHeader title={t('wh.suppliers.title')} description={t('wh.suppliers.description')} />
      <div className="flex flex-col gap-6 px-4 pb-10 md:px-8">
        <details className="rounded-md border border-line bg-raised">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-base font-semibold">{t('wh.suppliers.new')}</summary>
          <div className="border-t border-line p-4">
            <SupplierForm />
          </div>
        </details>
        {suppliers.length === 0 ? (
          <EmptyState title={t('wh.suppliers.empty')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {suppliers.map((s) => (
              <li key={s.id} className="rounded-md border border-line bg-raised p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-base font-semibold" dir="auto">{s.name}</p>
                  <StatusBadge tone={s.isForeign ? 'ink' : 'neutral'}>{s.isForeign ? t('wh.suppliers.foreign') : t('wh.suppliers.local')}</StatusBadge>
                </div>
                <p className="text-sm text-muted" dir="auto">
                  {[s.country, s.phone].filter(Boolean).join(' · ')}
                </p>
                <Link href={`/wholesale/suppliers/${s.id}`} className="mt-2 inline-flex min-h-11 items-center text-base underline">
                  {t('wh.suppliers.statement')}
                </Link>
                <details className="mt-3 rounded-md border border-line">
                  <summary className="flex min-h-11 cursor-pointer items-center px-3 text-base">{t('wh.common.edit')}</summary>
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
