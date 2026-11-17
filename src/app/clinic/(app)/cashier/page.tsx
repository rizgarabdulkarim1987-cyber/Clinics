import { notFound } from 'next/navigation';
import { invokeCl, requireClScreen } from '@/server/clinic/access';
import { getRate, listBills } from '@/server/clinic/actions/bills';
import { requestClinicLocale } from '@/server/clinic/request-locale';
import { getStudioTranslator } from '@/studio/messages';
import { CashierScreen } from './CashierScreen';

/** Payments: bills from finished visits, for the owner, the receptionist and the one who takes the money. No clinical text is read here. */
export default async function ClinicCashierPage() {
  const { member } = await requireClScreen('cashier');
  const [bills, rate] = await Promise.all([invokeCl(listBills, { status: 'OPEN' }), invokeCl(getRate, {})]);
  if (!bills.ok || !rate.ok) notFound();
  const t = getStudioTranslator(await requestClinicLocale());
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('clinic.app.cashier.title')}</h1>
        <p className="text-muted">{t('clinic.app.cashier.intro')}</p>
      </div>
      <CashierScreen initial={bills.data} initialRate={rate.data.usdRate} canSetRate={member.role === 'OWNER'} />
    </section>
  );
}
