'use client';

import { UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { addWholesaleStaff } from '@/app/studio/_actions/people';
import { requireFields, useActionForm } from '@/studio/forms';
import { useT } from '@/studio/i18n';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { Input } from '@/studio/ui/Input';
import { Select } from '@/studio/ui/Select';

/** The form a Super Admin uses to make a partner's or a rep's account for a wholesale company, with a password, no invitation. */
export function WholesaleStaffPanel({ restaurantId }: { restaurantId: string }) {
  const t = useT();
  const router = useRouter();
  const add = useActionForm(
    (values) => addWholesaleStaff({ restaurantId, name: values.name ?? '', email: values.email ?? '', role: values.role ?? 'REP', password: values.password ?? '' }),
    {
      validate: (values) => requireFields(values, { name: t('error.text.nameEnter'), email: t('error.text.emailInvalid'), password: t('error.text.passwordChoose') }),
      onSuccess: () => {
        toast.success(t('restaurants.people.wh.added'));
        router.refresh();
      },
    },
  );
  return (
    <section aria-labelledby="wh-staff-title" className="flex max-w-4xl flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="wh-staff-title" className="text-md font-semibold text-text">
          {t('restaurants.people.wh.title')}
        </h2>
        <p className="max-w-[64ch] text-sm text-muted">{t('restaurants.people.wh.intro')}</p>
      </div>
      <form {...add.props} className="flex max-w-md flex-col gap-3">
        <FormError form={add} fields={['name', 'email', 'password', 'role']} />
        <Field label={t('restaurants.people.till.name')} error={add.fieldError('name')}>
          <Input name="name" autoComplete="off" />
        </Field>
        <Field label={t('restaurants.people.till.email')} error={add.fieldError('email')}>
          <Input name="email" type="email" dir="ltr" className="rtl:text-right" autoComplete="off" />
        </Field>
        <Field label={t('restaurants.people.till.password')} error={add.fieldError('password')}>
          <Input name="password" type="password" dir="ltr" className="rtl:text-right" autoComplete="new-password" />
        </Field>
        <Field label={t('restaurants.people.till.role')} error={add.fieldError('role')}>
          <Select
            name="role"
            defaultValue="REP"
            options={[
              { value: 'REP', label: t('restaurants.people.wh.rep') },
              { value: 'PARTNER', label: t('restaurants.people.wh.partner') },
            ]}
          />
        </Field>
        <Button type="submit" variant="primary" icon={<UserPlus aria-hidden />} pending={add.pending} className="self-start">
          {add.pending ? t('restaurants.people.till.adding') : t('restaurants.people.till.submit')}
        </Button>
      </form>
    </section>
  );
}
