import { MessageCircle } from 'lucide-react';

const BASE = 'inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150 [&_svg]:size-4';

/**
 * Opens a WhatsApp chat with the client with the reminder already typed. With no usable phone number it stays visible
 * but off, and its tooltip says what to do, so the missing number is never a mystery.
 */
export function RemindButton({ href, label, missing }: { href: string | null; label: string; missing: string }) {
  if (!href) {
    return (
      <span role="img" aria-label={missing} title={missing} className={`${BASE} cursor-not-allowed text-muted opacity-45`}>
        <MessageCircle aria-hidden />
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className={`${BASE} text-muted hover:bg-hover hover:text-text active:bg-pressed`}>
      <MessageCircle aria-hidden />
    </a>
  );
}
