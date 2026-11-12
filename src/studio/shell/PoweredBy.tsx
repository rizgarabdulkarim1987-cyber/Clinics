import Image from 'next/image';

/** "Powered by" and the Buzzify logo as a rounded square, big enough to read; the brand name is not translated. */
export function PoweredBy({ className }: { className?: string }) {
  return (
    <span dir="ltr" className={`inline-flex items-center gap-2.5 px-3 py-1 text-base font-medium text-muted ${className ?? ''}`}>
      Powered by
      <Image src="/brand/buzzify-square.png" alt="Buzzify" width={64} height={64} unoptimized className="size-16 shrink-0 rounded-xl" />
    </span>
  );
}
