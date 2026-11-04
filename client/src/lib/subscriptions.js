// Subscription barcode + validity helpers.

/**
 * Barcode encoded on a subscription label. The `SUB-` prefix keeps it
 * distinguishable from numeric product barcodes (Code 128 prints the value
 * verbatim, so a scanner emits exactly this string). Nothing looks
 * subscriptions up by barcode yet — this is the value a future scan will
 * match on.
 */
export function subscriptionBarcode(sub) {
  const id = sub?.id
  return id === null || id === undefined ? '' : `SUB-${id}`
}

/**
 * Validity is COMPUTED, not read from `status`: nothing auto-expires stale
 * rows, so status can still say 'active' long after end_date has passed —
 * which is exactly the case this check exists to catch.
 *
 * Valid iff status is not terminal (expired, cancelled) AND end_date (if
 * any) is today or later:
 *
 * - `end_date` comes from <input type="date"> as 'YYYY-MM-DD' (the renew
 *   handler writes the same shape), so a lexicographic compare is an exact
 *   date compare; a timestamp value is trimmed to its date part first.
 * - The end date is inclusive: a subscription is valid through its last day.
 * - `past_due` is a billing flag, not a termination — it stays valid until
 *   the end date says otherwise.
 */
export function isSubscriptionValid(sub, today = new Date()) {
  if (!sub) return false
  if (sub.status === 'expired' || sub.status === 'cancelled') return false

  if (sub.end_date) {
    const end = String(sub.end_date).slice(0, 10)
    const now = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    if (end < now) return false
  }

  return true
}
