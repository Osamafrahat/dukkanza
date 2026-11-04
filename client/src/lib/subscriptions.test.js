import { describe, it, expect } from 'vitest'
import { subscriptionBarcode, isSubscriptionValid } from './subscriptions'

// Nothing auto-expires subscriptions: status can still read 'active' long
// after end_date passed. Validity must therefore be computed, and the
// barcode must be the exact string a future scan will match on.

describe('subscriptionBarcode', () => {
  it('encodes the SUB-{id} form the label prints', () => {
    expect(subscriptionBarcode({ id: 42 })).toBe('SUB-42')
    expect(subscriptionBarcode({ id: 0 })).toBe('SUB-0')
  })

  it('returns empty for a missing subscription or id', () => {
    expect(subscriptionBarcode(null)).toBe('')
    expect(subscriptionBarcode(undefined)).toBe('')
    expect(subscriptionBarcode({})).toBe('')
  })
})

describe('isSubscriptionValid', () => {
  const day = (offset) => {
    const d = new Date(2026, 10, 4) // fixed "today": 2026-11-04 local
    d.setDate(d.getDate() + offset)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const today = new Date(2026, 10, 4)

  it('is valid when active with a future end date', () => {
    expect(isSubscriptionValid({ status: 'active', end_date: day(30) }, today)).toBe(true)
  })

  it('is valid THROUGH the end date (inclusive)', () => {
    expect(isSubscriptionValid({ status: 'active', end_date: day(0) }, today)).toBe(true)
  })

  it('is expired once the end date has passed — even if status says active', () => {
    // The core case: nothing flips stale rows to 'expired'.
    expect(isSubscriptionValid({ status: 'active', end_date: day(-1) }, today)).toBe(false)
  })

  it('is expired when status is terminal regardless of dates', () => {
    expect(isSubscriptionValid({ status: 'expired', end_date: day(30) }, today)).toBe(false)
    expect(isSubscriptionValid({ status: 'cancelled', end_date: day(30) }, today)).toBe(false)
    expect(isSubscriptionValid({ status: 'cancelled' }, today)).toBe(false)
  })

  it('treats past_due as valid until the end date (billing flag, not termination)', () => {
    expect(isSubscriptionValid({ status: 'past_due', end_date: day(5) }, today)).toBe(true)
    expect(isSubscriptionValid({ status: 'past_due', end_date: day(-5) }, today)).toBe(false)
  })

  it('treats a missing end date as open-ended for active rows', () => {
    expect(isSubscriptionValid({ status: 'active', end_date: null }, today)).toBe(true)
  })

  it('compares only the date part of a timestamp end_date', () => {
    expect(isSubscriptionValid({ status: 'active', end_date: `${day(-1)}T23:59:59.000Z` }, today)).toBe(false)
    expect(isSubscriptionValid({ status: 'active', end_date: `${day(1)}T00:00:00.000Z` }, today)).toBe(true)
  })

  it('is false for a missing subscription', () => {
    expect(isSubscriptionValid(null, today)).toBe(false)
    expect(isSubscriptionValid(undefined, today)).toBe(false)
  })

  it('uses the real current date when no today is injected', () => {
    expect(isSubscriptionValid({ status: 'active', end_date: '2000-01-01' })).toBe(false)
    expect(isSubscriptionValid({ status: 'active' })).toBe(true)
  })
})
