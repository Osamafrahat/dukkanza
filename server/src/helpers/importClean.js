// Row-level cleaners shared by the three CSV import endpoints
// (products, customers, suppliers).
//
// CSV exported from Excel/legacy POS systems is dirty: thousands
// separators, currency symbols, Arabic-Indic digits, and phone numbers
// written five different ways. The cleaners are deliberately lenient —
// an import that rejects a row costs the user a whole migration pass, so
// anything recoverable is recovered and only structurally broken rows
// (no name, no price) become errors. All of them are idempotent: the
// client runs the same normalization for its preview, the server runs it
// again for safety, and a second pass must not change the value.

const ARABIC_INDIC = /[\u0660-\u0669\u06F0-\u06F9]/g

// '٠١٢٣٤٥٦٧٨٩' and Persian '۰۱۲۳۴۵۶۷۸۹' -> '0123456789'
export function toAsciiDigits(value) {
  return String(value ?? '').replace(ARABIC_INDIC, (d) => {
    const code = d.charCodeAt(0)
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660)
  })
}

export function cleanText(value, max = 255) {
  return String(value ?? '').trim().slice(0, max)
}

// '1,250.50 ج.م' -> 1250.5, '١٢٥' -> 125, '' / 'abc' -> null.
// Strips everything but digits, dot and minus; null when no digit is
// left, because Number('') is 0 and would silently price a product free.
// Multiple dots need care: either a unit suffix glued on ('ج.م' leaves a
// trailing dot after stripping) or thousand separators ('1.250.500') that
// Number() would silently misread — drop the trailing dots, then refuse
// anything that still has a dot between digits.
export function cleanNum(value) {
  if (value === null || value === undefined) return null
  let stripped = toAsciiDigits(value).replace(/[^0-9.\-]/g, '')
  if ((stripped.match(/\./g) || []).length > 1) {
    stripped = stripped.replace(/\.+$/, '')
    if ((stripped.match(/\./g) || []).length > 1) return null
  }
  if (!/[0-9]/.test(stripped)) return null
  const n = Number(stripped)
  return Number.isFinite(n) ? n : null
}

// Canonical phone = digits only, Egyptian formats collapsed to the
// 10-digit no-leading-0 shape the customer form produces:
//   '01012345678' / '+20 10 1234 5678' / '201012345678' / '00201012345678'
//   -> '1012345678'
// Length is NOT enforced: rejecting an odd number would drop an entire
// migrated row for one bad cell, and no customer/supplier route validates
// phone length server-side anyway.
export function cleanPhone(value) {
  let digits = toAsciiDigits(value).replace(/\D/g, '')
  if (digits.startsWith('0020')) digits = digits.slice(4)
  if (digits.startsWith('20') && digits.length >= 12) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '')
  return digits
}
