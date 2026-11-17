import type { Metadata } from 'next';
import ClinicRootLayout from '../clinic/layout';

export const metadata: Metadata = {
  title: { default: 'Buzzify Beauty', template: '%s · Buzzify Beauty' },
  robots: { index: false, follow: false },
};

/** A beauty centre's root layout: the clinic app's document and language choice, with the beauty centre's own words (chosen by the `/beauty` path). */
export default ClinicRootLayout;
