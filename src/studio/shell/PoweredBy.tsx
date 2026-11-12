import Image from 'next/image';

/** "Powered by" and the Buzzify logo on a black circle (the white wordmark), small and quiet; the brand name is not translated. */
export function PoweredBy({ className }: { className?: string }) {
  return (
    <span dir="ltr" className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs text-muted ${className ?? ''}`}>
      Powered by
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-black">
        <Image src="/brand/buzzify-on-dark.png" alt="Buzzify" width={28} height={10} unoptimized style={{ width: 28, height: 'auto' }} />
      </span>
    </span>
  );
}
