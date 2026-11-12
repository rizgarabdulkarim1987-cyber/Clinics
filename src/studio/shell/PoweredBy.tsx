import { BrandLogo } from './BrandLogo';

/** "Powered by" and the Buzzify logo, small and quiet; the brand name is not translated. */
export function PoweredBy({ className }: { className?: string }) {
  return (
    <span dir="ltr" className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs text-muted ${className ?? ''}`}>
      Powered by
      <BrandLogo height={14} />
    </span>
  );
}
