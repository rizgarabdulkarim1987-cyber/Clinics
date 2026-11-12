import Image from 'next/image';

/** "Powered by" and the round Buzzify logo, quiet but easy to see; the brand name is not translated. */
export function PoweredBy({ className }: { className?: string }) {
  return (
    <span dir="ltr" className={`inline-flex items-center gap-2 px-3 py-1 text-sm text-muted ${className ?? ''}`}>
      Powered by
      <Image src="/brand/buzzify-circle.png" alt="Buzzify" width={48} height={48} unoptimized className="size-12 shrink-0 rounded-full" />
    </span>
  );
}
