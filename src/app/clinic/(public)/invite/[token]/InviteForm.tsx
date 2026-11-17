'use client';

import { clinicAcceptInvitation } from '@/app/clinic/_actions/session';
import { requireFields, useActionForm } from '@/studio/forms';
import { useT } from '@/studio/i18n';
import { navigateAway } from '@/studio/navigate';
import { Button } from '@/studio/ui/Button';
import { Field } from '@/studio/ui/Field';
import { FormError } from '@/studio/ui/FormError';
import { Input, PasswordInput } from '@/studio/ui/Input';

/** Accepting an invitation: a new address chooses a name and a password; an address with a clinic account gives its password. */
export function ClinicInviteForm({ token, accountExists }: { token: string; accountExists: boolean }) {
  const t = useT();
  const form = useActionForm((values) => clinicAcceptInvitation({ token, name: values.name ?? '', password: values.password ?? '' }), {
    validate: (values) => requireFields(values, { ...(accountExists ? {} : { name: t('error.text.nameEnter') }), password: t('error.text.passwordEnter') }),
    onSuccess: (data) => navigateAway(data.next),
  });

  return (
    <form {...form.props} className="flex flex-col gap-5">
      <FormError form={form} fields={['name', 'password']} />
      {!accountExists && (
        <Field label={t('clinic.app.invite.name')} error={form.fieldError('name')}>
          <Input name="name" size="lg" autoComplete="name" autoFocus required defaultValue={form.value('name')} />
        </Field>
      )}
      <Field label={accountExists ? t('clinic.app.invite.passwordExisting') : t('clinic.app.invite.password')} error={form.fieldError('password')}>
        <PasswordInput name="password" size="lg" autoComplete={accountExists ? 'current-password' : 'new-password'} required />
      </Field>
      <Button type="submit" variant="primary" size="lg" pending={form.pending} className="mt-1 w-full">
        {form.pending ? t('clinic.app.invite.pending') : t('clinic.app.invite.submit')}
      </Button>
    </form>
  );
}
