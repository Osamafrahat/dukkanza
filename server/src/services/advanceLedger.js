// Supplier advances (prepayments) — recording and FIFO consumption.
//
// An advance is cash paid to a supplier before anything is owed. It posts
// to asset account 1150 "Supplier Advances" (never to AP, which would
// misstate the payable as negative), and it is consumed oldest-first when
// a later settlement runs: the settlement debits the supplier's AP in
// full, credits 1150 for the applied part, and credits cash/bank for the
// remainder — so one payment line still equals the cash that left.

import supabase from '../db/supabase.js'
import { createJournalEntry, seedChartOfAccounts, reverseJournalEntry } from './accountingEngine.js'

const ADVANCE_ACCOUNT_CODE = '1150'

// Payment methods that settle from cash vs bank — mirrors payments.js
// (only 'cash' is drawn from the cash box, everything else from bank).
export const ADVANCE_METHODS = ['cash', 'bank_transfer', 'card', 'check']

// Find an account by code, seeding the chart if it is missing. Pass the
// tenant: seedChartOfAccounts without one seeds nothing, which is why the
// old payments.js copy of this helper never recovered from a miss.
async function findAccount(code, tenantId) {
  let { data } = await supabase
    .from('accounts').select('id').eq('code', code).eq('tenant_id', tenantId).single()
  if (!data) {
    await seedChartOfAccounts(tenantId)
    const retry = await supabase
      .from('accounts').select('id').eq('code', code).eq('tenant_id', tenantId).single()
    data = retry.data
  }
  return data
}

function generatePaymentNumber() {
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '')
  const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0')
  return `PAY-${date}-${rand}`
}

const rowAvailable = (row) => parseFloat(row.amount) - parseFloat(row.consumed_amount || 0)

// All advances for a supplier, oldest first, each with its remaining
// `available`. With no supplierId: every advance in the tenant.
export async function listAdvances(tenantId, supplierId = null) {
  let query = supabase
    .from('supplier_advances')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('id', { ascending: true })
  if (supplierId) query = query.eq('supplier_id', supplierId)

  const { data, error } = await query
  if (error) throw error
  return (data || []).map((row) => ({ ...row, available: rowAvailable(row) }))
}

export async function availableFor(tenantId, supplierId) {
  const rows = await listAdvances(tenantId, supplierId)
  return rows.reduce((sum, row) => sum + row.available, 0)
}

// Consume up to `want` of the oldest available advances. Returns the amount
// actually consumed. Row updates are guarded (consumed_amount must still
// equal what we read) so two concurrent settlements can never double-spend
// the same advance; a lost race re-reads and continues. Row-level failures
// stop the loop and return what was applied — the caller must journal
// exactly the returned amount, so a partial consume is never under-reported.
export async function consumeAdvances(tenantId, supplierId, want) {
  const target = parseFloat(want)
  if (!(target > 0)) return 0

  let applied = 0
  let rows = await listAdvances(tenantId, supplierId)

  for (const row of rows) {
    if (applied >= target) break
    const available = rowAvailable(row)
    if (available <= 0) continue

    const take = Math.min(available, target - applied)
    const seenConsumed = parseFloat(row.consumed_amount || 0)

    // Optimistic guard: only update if nobody else moved this row since we
    // read it. `.select()` echoes the updated rows, so an empty result means
    // we lost the race — re-read and recompute against fresh state.
    let updated = null
    for (let attempt = 0; attempt < 3 && !updated; attempt++) {
      const { data, error } = await supabase
        .from('supplier_advances')
        .update({ consumed_amount: seenConsumed + take })
        .eq('id', row.id)
        .eq('tenant_id', tenantId)
        .eq('consumed_amount', seenConsumed)
        .select('id')
      if (error) return applied // stop cleanly: applied is what is real
      if (data && data.length > 0) {
        updated = data
      } else {
        const fresh = await listAdvances(tenantId, supplierId)
        const again = fresh.find((r) => r.id === row.id)
        if (!again) break // row vanished (supplier deleted) — move on
        row.consumed_amount = again.consumed_amount
        row.amount = again.amount
      }
    }
    if (updated) applied += take
  }

  return applied
}

// Record a new advance: payment row (outbound/supplier) + journal
// (Dr 1150 / Cr cash-bank) + supplier_advances row. Throws on failure; the
// caller decides whether that aborts a surrounding operation (PO create
// rolls back) or is reported on its own (the advances route returns 500).
export async function recordSupplierAdvance({
  tenantId,
  supplierId,
  amount,
  method = 'cash',
  notes = null,
  reference = null,
  paymentDate = null,
  poId = null,
  userId = null,
}) {
  const value = parseFloat(amount)
  if (!(value > 0)) throw new Error('Advance amount must be positive')
  const effectiveMethod = ADVANCE_METHODS.includes(method) ? method : 'cash'
  const date = paymentDate || new Date().toISOString().split('T')[0]

  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .insert({
      tenant_id: tenantId,
      payment_number: generatePaymentNumber(),
      payment_type: 'outbound',
      method: effectiveMethod,
      amount: value,
      partner_type: 'supplier',
      partner_id: supplierId,
      reference: reference || null,
      notes: notes || null,
      payment_date: date,
      recorded_by: userId,
    })
    .select()
    .single()
  if (paymentError) throw paymentError

  // Journal: debit the advance asset, credit the money source. Mirrors the
  // payment-journal failure policy elsewhere — log loudly, never take the
  // request down over accounting, but the advance row still follows.
  let journalEntryId = null
  try {
    const advanceAccount = await findAccount(ADVANCE_ACCOUNT_CODE, tenantId)
    const sourceAccount = await findAccount(effectiveMethod === 'cash' ? '1010' : '1020', tenantId)
    const lines = []
    if (advanceAccount) {
      lines.push({ accountId: advanceAccount.id, debit: value, credit: 0, description: `Supplier advance - ${payment.payment_number}` })
    }
    if (sourceAccount) {
      lines.push({ accountId: sourceAccount.id, debit: 0, credit: value, description: `Advance paid - ${payment.payment_number}` })
    }
    if (lines.length > 0) {
      const entry = await createJournalEntry({
        date,
        description: `Supplier advance: ${payment.payment_number}`,
        reference: payment.payment_number,
        sourceType: 'payment',
        sourceId: payment.id,
        lines,
        createdBy: userId,
      }, tenantId)
      journalEntryId = entry?.id ?? null
      if (journalEntryId) {
        await supabase.from('payments').update({ journal_entry_id: journalEntryId })
          .eq('tenant_id', tenantId).eq('id', payment.id)
        payment.journal_entry_id = journalEntryId
      }
    }
  } catch (accErr) {
    console.error('[ADVANCE] Journal entry failed:', accErr.message)
  }

  const { data: advance, error: advanceError } = await supabase
    .from('supplier_advances')
    .insert({
      tenant_id: tenantId,
      supplier_id: supplierId,
      amount: value,
      consumed_amount: 0,
      payment_id: payment.id,
      po_id: poId,
      notes: notes || null,
    })
    .select()
    .single()
  if (advanceError) {
    // The payment row and its journal exist ONLY to carry this advance, so
    // an advance that cannot be written must take them with it — otherwise
    // cash is credited with nothing to show for it (payment 46 / entry 113:
    // 200 EGP booked to 1150 with no supplier_advances row, which is what
    // happened while the migration was still pending). Undo both, then
    // surface the original failure so the caller still reports an error.
    try {
      const { error: deleteError } = await supabase
        .from('payments')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('id', payment.id)
      if (deleteError) throw deleteError
      if (journalEntryId) {
        await reverseJournalEntry(
          journalEntryId,
          `Supplier advance failed: ${payment.payment_number}`,
          userId,
          tenantId
        )
      }
    } catch (cleanupErr) {
      console.error('[ADVANCE] Cleanup after failed advance insert:', cleanupErr.message)
    }
    throw advanceError
  }

  return { payment, advance, journalEntryId }
}
