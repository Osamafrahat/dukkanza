// Phone number round-trip: the shared field every screen uses.
//
// Why this file exists: six screens used to format phone numbers six ways
// (some raw text, some split into country + digits). The extraction of
// PhoneField from the Add Customer modal is only correct if the split and
// re-compose are exact inverses for every number already stored — an edit
// screen that silently drops a dial code rewrites customer data.

import { describe, it, expect } from 'vitest'
import { PHONE_COUNTRIES, sanitizePhoneDigits, parseFullPhone, buildFullPhone } from '../lib/phone'

describe('sanitizePhoneDigits', () => {
  it('keeps digits only, drops the leading 0, and caps at 11', () => {
    expect(sanitizePhoneDigits('010 1234-5678')).toBe('1012345678')
    expect(sanitizePhoneDigits('+20 (10) 1234')).toBe('20101234')
    // Arabic-Indic digits are stripped, not converted — byte-for-byte what
    // the Add Customer modal's own replace(/\D/g,'') has always done.
    expect(sanitizePhoneDigits('٠١٠١٢٣٤٥٦٧٨')).toBe('')
    expect(sanitizePhoneDigits('')).toBe('')
    expect(sanitizePhoneDigits(undefined)).toBe('')
    expect(sanitizePhoneDigits('123456789012345')).toBe('12345678901')
  })
})

describe('parseFullPhone / buildFullPhone', () => {
  it('splits a stored number and rebuilds it byte-identically', () => {
    for (const c of PHONE_COUNTRIES) {
      const full = `${c.code}1012345678`
      const parts = parseFullPhone(full)
      expect(parts.countryCode).toBe(c.code)
      expect(parts.number).toBe('1012345678')
      expect(buildFullPhone(parts.countryCode, parts.number)).toBe(full)
    }
  })

  it('round-trips an Egyptian number written by every form in the app', () => {
    const stored = '+201012345678'
    const parts = parseFullPhone(stored)
    expect(parts).toEqual({ countryCode: '+20', number: '1012345678' })
    expect(buildFullPhone(parts.countryCode, parts.number)).toBe(stored)
  })

  it('falls back to the default country for legacy shapes instead of blanking them', () => {
    expect(parseFullPhone('01012345678')).toEqual({ countryCode: '+20', number: '1012345678' })
    expect(parseFullPhone('1012345678')).toEqual({ countryCode: '+20', number: '1012345678' })
    expect(parseFullPhone('')).toEqual({ countryCode: '+20', number: '' })
    expect(parseFullPhone(undefined)).toEqual({ countryCode: '+20', number: '' })
    expect(parseFullPhone('+15551234567').countryCode).toBe('+1')
  })

  it('never stores a bare dial code: empty digits mean an empty value', () => {
    expect(buildFullPhone('+20', '')).toBe('')
    expect(buildFullPhone('+966', '')).toBe('')
    expect(buildFullPhone('+20', '1012345678')).toBe('+201012345678')
  })
})
