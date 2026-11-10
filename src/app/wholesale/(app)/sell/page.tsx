import { redirect } from 'next/navigation';

/** Selling is its own screen again; the old address still works. */
export default function SellPage() {
  redirect('/wholesale/sales');
}
