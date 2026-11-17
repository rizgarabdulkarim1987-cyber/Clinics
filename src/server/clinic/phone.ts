const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/**
 * A phone number as the clinic stores and matches it: digits only (Arabic-Indic digits included), the Iraqi country
 * code (`+964`, `00964`, `964`) written as a leading 0, and a bare mobile number of ten digits given its 0. Two ways of
 * typing one number are therefore one number, which is what puts a family into one household.
 */
export function normalizePhone(raw: string): string {
  let digits = '';
  for (const char of raw) {
    const arabic = ARABIC_INDIC.indexOf(char);
    const eastern = EASTERN_ARABIC_INDIC.indexOf(char);
    if (arabic >= 0) digits += String(arabic);
    else if (eastern >= 0) digits += String(eastern);
    else if (char >= '0' && char <= '9') digits += char;
  }
  if (digits.startsWith('00964')) digits = `0${digits.slice(5)}`;
  else if (digits.startsWith('964') && digits.length >= 12) digits = `0${digits.slice(3)}`;
  else if (digits.length === 10 && digits.startsWith('7')) digits = `0${digits}`;
  return digits;
}

/** Whether a normalized phone can be a phone number at all. */
export const isPhone = (normalized: string): boolean => normalized.length >= 7 && normalized.length <= 15;
