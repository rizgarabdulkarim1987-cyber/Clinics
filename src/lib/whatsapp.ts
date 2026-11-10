/**
 * A phone number as WhatsApp wants it: digits only, with the country code and no leading zero. Numbers are typed the way
 * people write them in Iraq (`0770 123 4567`, `+964 770 123 4567`, `00964...`), and a number with no country code is
 * taken to be Iraqi. Returns null when there are not enough digits to be a phone number.
 */
export function whatsappNumber(phone: string, defaultCountry = '964'): string | null {
  let digits = phone.replace(/[^\d+]/g, '');
  const international = digits.startsWith('+') || digits.startsWith('00');
  digits = digits.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!international) digits = digits.startsWith('0') ? defaultCountry + digits.slice(1) : digits.startsWith(defaultCountry) ? digits : defaultCountry + digits;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

/** The `wa.me` link that opens a chat with the message already typed, or null when the phone cannot be used. */
export function whatsappLink(phone: string, text: string): string | null {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
}
