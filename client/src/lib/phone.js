// Phone number helpers shared by every screen that types or edits a number.
// Lives in lib/ (not inside PhoneField.jsx) so the component file exports
// only the component — and so parse/build can be imported without pulling
// the component tree along.

// The one phone input, used by every screen that types a number: the Add
// Customer modal grew this layout first (country dial-code picker + digits
// only, no leading 0), and every other phone field was a bare text input
// that happily stored "010 1234" or "+20(123)" — three shapes of the same
// number for one column. This module is the parse/build half of that
// extraction: an edit screen can never disagree with a create one.
//
// The country list lives here (not per page) because splitting a stored
// number back into code+digits needs the SAME prefixes that wrote it — a
// page with its own subset silently drops the code it doesn't know.

export const PHONE_COUNTRIES = [
  { code: '+20', flag: '\u{1F1EA}\u{1F1EC}', nameKey: 'country.egypt' },
  { code: '+966', flag: '\u{1F1F8}\u{1F1E6}', nameKey: 'country.saudiArabia' },
  { code: '+971', flag: '\u{1F1E6}\u{1F1EA}', nameKey: 'country.uae' },
  { code: '+965', flag: '\u{1F1F0}\u{1F1FC}', nameKey: 'country.kuwait' },
  { code: '+973', flag: '\u{1F1E7}\u{1F1ED}', nameKey: 'country.bahrain' },
  { code: '+974', flag: '\u{1F1F6}\u{1F1E6}', nameKey: 'country.qatar' },
  { code: '+968', flag: '\u{1F1F4}\u{1F1F2}', nameKey: 'country.oman' },
  { code: '+962', flag: '\u{1F1EF}\u{1F1F4}', nameKey: 'country.jordan' },
  { code: '+961', flag: '\u{1F1F1}\u{1F1E7}', nameKey: 'country.lebanon' },
  { code: '+216', flag: '\u{1F1F9}\u{1F1F3}', nameKey: 'country.tunisia' },
  { code: '+212', flag: '\u{1F1F2}\u{1F1E6}', nameKey: 'country.morocco' },
  { code: '+213', flag: '\u{1F1E9}\u{1F1FF}', nameKey: 'country.algeria' },
  { code: '+1', flag: '\u{1F1FA}\u{1F1F8}', nameKey: 'country.usaCanada' },
  { code: '+44', flag: '\u{1F1EC}\u{1F1E7}', nameKey: 'country.uk' },
]

const DEFAULT_CODE = PHONE_COUNTRIES[0].code
export const PHONE_DIGITS = 10 // Egyptian national number length the hint counts down to

/** What every keystroke gets: digits only, no leading 0 (the shape the
 *  customer form produces), capped just above the target length. */
export function sanitizePhoneDigits(value) {
  return String(value ?? '').replace(/\D/g, '').replace(/^0+/, '').slice(0, 11)
}

/**
 * Stored number -> editable parts.
 * '+201012345678' -> { countryCode: '+20', number: '1012345678' }
 * Unknown/absent prefix falls back to the default country and keeps the
 * digits, so a legacy '01012345678' is edited, never blanked.
 */
export function parseFullPhone(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return { countryCode: DEFAULT_CODE, number: '' }
  for (const c of PHONE_COUNTRIES) {
    if (raw.startsWith(c.code)) {
      return { countryCode: c.code, number: raw.slice(c.code.length).replace(/^0+/, '') }
    }
  }
  return { countryCode: DEFAULT_CODE, number: sanitizePhoneDigits(raw) }
}

/** Parts -> stored number. Empty digits stay empty: an untouched optional
 *  field must not save the bare country code '+20'. */
export function buildFullPhone(countryCode, number) {
  return number ? `${countryCode}${number}` : ''
}
