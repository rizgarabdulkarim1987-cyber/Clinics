import type { Locale } from '@/lib/locale';

/** What an error boundary says. A crash page cannot trust the area's own message catalog, so the words live here. */
export const errorCopy: Record<Locale, { title: string; retry: string }> = {
  en: { title: 'Something went wrong on this page.', retry: 'Try again' },
  ar: { title: 'حدث خطأ في هذه الصفحة.', retry: 'أعد المحاولة' },
  ckb: { title: 'هەڵەیەک لەم پەڕەیەدا ڕوویدا.', retry: 'دووبارە هەوڵبدەرەوە' },
};
