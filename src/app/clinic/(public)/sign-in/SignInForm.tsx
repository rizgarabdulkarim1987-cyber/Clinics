'use client';

import { clinicSignIn } from '@/app/clinic/_actions/session';
import { requireFields, useActionForm } from '@/studio/forms';
import { useT } from '@/studio/i18n';
import { navigateAway } from '@/studio/navigate';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { Input, PasswordInput } from '@/studio/ui/Input';

export function ClinicSignInForm() {
  const t = useT();
  const form = useActionForm((values) => clinicSignIn({ email: values.email ?? '', password: values.password ?? '' }), {
    keep: ['email'],
    validate: (values) => requireFields(values, { email: t('error.text.emailInvalid'), password: t('error.text.passwordEnter') }),
    onSuccess: (data) => navigateAway(data.next),
  });

  return (
    <form {...form.props} className="flex flex-col gap-5">
      <FormError form={form} fields={['email', 'password']} />
      <Field label={t('clinic.app.signIn.email')} error={form.fieldError('email')}>
        <Input name="email" type="email" size="lg" dir="ltr" className="rtl:text-right" autoComplete="username" autoFocus required defaultValue={form.value('email')} />
      </Field>
      <Field label={t('clinic.app.signIn.password')} error={form.fieldError('password')}>
        <PasswordInput name="password" size="lg" autoComplete="current-password" required />
      </Field>
      <Button type="submit" variant="primary" size="lg" pending={form.pending} className="mt-1 w-full">
        {form.pending ? t('clinic.app.signIn.pending') : t('clinic.app.signIn.submit')}
      </Button>
    </form>
  );
}
