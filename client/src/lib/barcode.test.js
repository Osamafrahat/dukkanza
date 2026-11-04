import { describe, it, expect } from 'vitest'
import { ean13CheckDigit, isValidEan13, pickBarcodeFormat } from './barcode'

// The POS looks a scan up with an EXACT match on products.barcode
// (GET /products/barcode/:barcode -> eq('barcode', value)), so whatever the
// label encodes must come out of the scanner as the identical string.

describe('ean13CheckDigit', () => {
  it('matches published EAN-13 check digits', () => {
    expect(ean13CheckDigit('544900000099')).toBe('6') // 5449000000996
    expect(ean13CheckDigit('400638133393')).toBe('1') // 4006381333931
    expect(ean13CheckDigit('123456789012')).toBe('8') // 1234567890128
  })

  it('returns a single digit for all-zero input', () => {
    expect(ean13CheckDigit('000000000000')).toBe('0')
  })
})

describe('isValidEan13', () => {
  it('accepts a checksum-valid 13-digit value', () => {
    expect(isValidEan13('5449000000996')).toBe(true)
    expect(isValidEan13('1234567890128')).toBe(true)
  })

  it('rejects a wrong check digit', () => {
    expect(isValidEan13('5449000000999')).toBe(false)
  })

  it('rejects anything that is not exactly 13 digits', () => {
    expect(isValidEan13('544900000099')).toBe(false)   // 12 digits
    expect(isValidEan13('54490000009961')).toBe(false) // 14 digits
    expect(isValidEan13('544900000099A')).toBe(false)  // non-digit
    expect(isValidEan13('')).toBe(false)
    expect(isValidEan13(undefined)).toBe(false)
    expect(isValidEan13(null)).toBe(false)
  })
})

describe('pickBarcodeFormat', () => {
  it('uses EAN-13 only for a checksum-valid 13-digit value', () => {
    expect(pickBarcodeFormat('5449000000996')).toBe('EAN13')
  })

  it('never uses EAN-13 for a bad check digit', () => {
    // JsBarcode would reject this as invalid EAN-13; even a variant that
    // "fixed" it would print a DIFFERENT digit than the stored barcode and
    // the scan would never match. Code 128 prints the value verbatim.
    expect(pickBarcodeFormat('5449000000999')).toBe('CODE128')
  })

  it('never uses EAN-13 for 12-digit values', () => {
    // JsBarcode APPENDS a computed check digit to 12-digit input, so the
    // scanner would emit 13 digits against a 12-digit stored barcode.
    expect(pickBarcodeFormat('544900000099')).toBe('CODE128')
  })

  it('falls back to Code 128 for SKUs and arbitrary strings', () => {
    expect(pickBarcodeFormat('SKU-SUGAR-1')).toBe('CODE128')
    expect(pickBarcodeFormat('abc123')).toBe('CODE128')
    expect(pickBarcodeFormat('')).toBe('CODE128')
    expect(pickBarcodeFormat(undefined)).toBe('CODE128')
  })
})
