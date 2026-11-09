'use client';

import { Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { setAppearance } from '@/app/studio/_actions/account';
import { parseStoredAppearance, switchTone, toneOf, type Appearance } from '@/lib/appearance';
import { describeFailure } from '@/studio/errors';
import { useLocale, useT } from '@/studio/i18n';
import { IconButton } from '@/studio/ui/IconButton';

/**
 * Light and dark in one press. It saves the person's own look (the same one as in their account), so the Studio, the till
 * and the books all follow, and it keeps the font and the button shape they picked there.
 */
export function ThemeToggle({ appearance }: { appearance: Appearance | null }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const dark = toneOf(parseStoredAppearance(appearance).bg) === 'dark';

  const toggle = () =>
    start(async () => {
      const result = await setAppearance(switchTone(appearance));
      if (!result.ok) {
        toast.error(describeFailure(t, locale, result.error).message);
        return;
      }
      router.refresh();
    });

  return <IconButton label={t(dark ? 'accounts.theme.light' : 'accounts.theme.dark')} onClick={toggle} disabled={pending} icon={dark ? <Sun aria-hidden /> : <Moon aria-hidden />} />;
}
