import { redirect } from 'next/navigation';

/** Items and stock are one screen now; the old address still works. */
export default function CatalogPage() {
  redirect('/wholesale/stock');
}
