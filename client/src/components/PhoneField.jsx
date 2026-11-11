import { useEffect, useState } from 'react'
import SearchableSelect from './SearchableSelect'
import { useAppStore } from '../stores/appStore'
import { PHONE_COUNTRIES, PHONE_DIGITS, parseFullPhone, buildFullPhone, sanitizePhoneDigits } from '../lib/phone'

/**
 * The one phone input, used by every screen that types a number. The Add
 * Customer modal grew this layout first (country dial-code picker, digits
 * only, no leading 0, live "digits remaining" hint); every other phone field
 * was a bare text input that happily stored "010 1234" or "+20(123)" — three
 * shapes of the same number for one column. See lib/phone.js for the
 * parse/build half this field is built on.
 *
 * Controlled by ONE parent string (the full stored number) and split into
 * country + digits internally, so callers keep their existing single
 * `phone` field and only swap the markup.
 *
 * `error` is parent-owned: the Add Customer modal validates on submit and
 * passes its message down here for display.
 */
export default function PhoneField({
  label,
  id,
  value = '',
  onChange,
  error = '',
  required = false,
  disabled = false,
  placeholder = '1xxxxxxxxx',
  inputClassName = 'rounded-lg bg-surface',
  wrapperClassName = '',
}) {
  const { t } = useAppStore()
  const [parts, setParts] = useState(() => parseFullPhone(value))

  // The parent may swap the value underneath us (edit another record, reset
  // after save, profile arriving after first paint). Re-split only when its
  // string is NOT what we last emitted — otherwise a value we just produced
  // would be re-parsed on every keystroke — and only when the parts actually
  // differ, or an unrecognized value would loop setParts forever.
  useEffect(() => {
    if (value === buildFullPhone(parts.countryCode, parts.number)) return
    const next = parseFullPhone(value)
    if (next.countryCode !== parts.countryCode || next.number !== parts.number) setParts(next)
  }, [value, parts])

  const emit = (next) => {
    setParts(next)
    if (onChange) onChange(buildFullPhone(next.countryCode, next.number))
  }

  const remaining = PHONE_DIGITS - parts.number.length

  return (
    <div className={wrapperClassName}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-foreground mb-1">
          {label}
          {required && <span className="text-danger"> *</span>}
        </label>
      )}
      {/* The min-w-0 on the phone input is load-bearing: flex-1 alone cannot
          shrink an <input> under its intrinsic (~20ch) min-content width, so
          on a phone the row kept the country select's fixed 128px plus that
          intrinsic width and pushed the input past the modal edge. */}
      <div className="flex gap-2">
        <SearchableSelect
          options={PHONE_COUNTRIES.map(c => ({ value: c.code, label: `${c.flag} ${c.code}` }))}
          value={parts.countryCode}
          onChange={(code) => emit({ ...parts, countryCode: code })}
          placeholder={t('common.searchSelect')}
          disabled={disabled}
          className="w-32 px-3 py-2 rounded-lg border border-border bg-surface text-sm"
        />
        <input
          id={id}
          type="tel"
          inputMode="numeric"
          maxLength={PHONE_DIGITS}
          value={parts.number}
          onChange={(e) => emit({ ...parts, number: sanitizePhoneDigits(e.target.value) })}
          placeholder={placeholder}
          disabled={disabled}
          className={`flex-1 min-w-0 px-4 py-2 border ${error ? 'border-danger' : 'border-border'} ${inputClassName}`}
        />
      </div>
      {error && (
        <p className="mt-1 text-xs text-danger">{error}</p>
      )}
      {!error && parts.number && remaining > 0 && (
        <p className="mt-1 text-xs text-warning">{remaining}{t('customers.digitsRemaining')}</p>
      )}
    </div>
  )
}
