'use client';

import { Button } from '@/studio/ui';

/** Opens the browser's print dialog; "Save as PDF" there gives the file. Hidden on paper. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" className="print:hidden" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
