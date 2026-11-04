// Barcode symbology selection for printed inventory labels.
//
// The label must encode EXACTLY the string the POS looks up
// (productsApi.getByBarcode -> GET /products/barcode/:barcode -> eq('barcode',
// value)), so the encoded output has to equal the stored value digit for
// digit. The choice:
//
//   - EAN-13: only when the value is a real, checksum-valid 13-digit number.
//     JsBarcode renders EAN-13 with all 13 digits as the human-readable
//     text, and a scanner emits those same 13 digits -> lookup matches.
//     A 12-digit value would be printed with an ADDED check digit, so the
//     scanner would return 13 digits against a 12-digit column and never
//     match — so never use EAN-13 unless the correct check digit is already
//     the last character.
//
//   - Code 128: everything else (SKU, alphanumerics, arbitrary strings).
//     Encodes the value verbatim in its human-readable text, so scan
//     output === stored value.
//
// (The previous hand-rolled "Code 128" drew bars from charCodeAt % 3 with
// no start/stop patterns, no checksum and no symbol structure at all —
// decorative, decodable by nothing.)

/** EAN-13 check digit for the first 12 digits (odd positions x1, even x3). */
export function ean13CheckDigit(first12) {
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const digit = Number(first12[i])
    sum += i % 2 === 0 ? digit : digit * 3
  }
  return String((10 - (sum % 10)) % 10)
}

/** True when value is exactly 13 digits with a valid EAN-13 check digit. */
export function isValidEan13(value) {
  if (typeof value !== 'string' || !/^\d{13}$/.test(value)) return false
  return ean13CheckDigit(value.slice(0, 12)) === value[12]
}

/** JsBarcode format for a value: 'EAN13' only when provably scannable as one. */
export function pickBarcodeFormat(value) {
  return isValidEan13(value) ? 'EAN13' : 'CODE128'
}
