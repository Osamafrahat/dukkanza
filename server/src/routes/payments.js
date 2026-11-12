import { Router } from 'express'
import supabase from '../db/supabase.js'
import { createJournalEntry, seedChartOfAccounts } from '../services/accountingEngine.js'
import { sanitizeSearch } from '../helpers/search.js'

const router = Router()

// Helper: find account by code, auto-seed if missing. seedChartOfAccounts
// needs the tenant — calling it without one seeds nothing, so the retry
// below used to miss forever.
async function findAccount(code, tenantId) {
  let { data } = await supabase.from('accounts').select('id').eq('code', code).eq('tenant_id', tenantId).single()
  if (!data) {
    await seedChartOfAccounts(tenantId)
    const retry = await supabase.from('accounts').select('id').eq('code', code).eq('tenant_id', tenantId).single()
    data = retry.data
  }
  return data
}

// Get all payments
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, payment_type, method, date_from, date_to, search } = req.query
    const offset = (page - 1) * limit

    let query = supabase
      .from('payments')
      .select('*', { count: 'exact' })
      .eq('tenant_id', req.user.tenantId)
      .order('payment_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (payment_type) query = query.eq('payment_type', payment_type)
    if (method) query = query.eq('method', method)
    if (date_from) query = query.gte('payment_date', date_from)
    if (date_to) query = query.lte('payment_date', date_to)
    if (search) {
      const s = sanitizeSearch(search)
      if (s) query = query.or(`payment_number.ilike.%${s}%,reference.ilike.%${s}%,notes.ilike.%${s}%`)
    }

    const { data, error, count } = await query
    if (error) throw error
    res.json({ data, total: count })
  } catch (err) {
    console.error('Get payments error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create payment
router.post('/', async (req, res) => {
  try {
    const { payment_type, method, amount, partner_type, partner_id, reference, notes, payment_date, order_id } = req.body

    if (!payment_type || !method || !amount) {
      return res.status(400).json({ error: 'Payment type, method, and amount are required' })
    }

    // An outbound payment settles a supplier payable. Without a supplier it
    // would fall back to the generic 2010 account, leaving the supplier's
    // own balance untouched — the payment looks recorded but the Remaining
    // Balance on the Suppliers page never moves. Reject loudly instead.
    if (payment_type === 'outbound' && (partner_type !== 'supplier' || !partner_id)) {
      return res.status(400).json({ error: 'Outbound payments must name a supplier' })
    }

    // Generate payment number
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '')
    const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0')
    const paymentNumber = `PAY-${date}-${rand}`

    const { data: payment, error } = await supabase
      .from('payments')
      .insert({
        tenant_id: req.user.tenantId,
        payment_number: paymentNumber,
        payment_type,
        method,
        amount: parseFloat(amount),
        partner_type: partner_type || null,
        partner_id: partner_id || null,
        reference: reference || null,
        notes: notes || null,
        payment_date: payment_date || new Date().toISOString().split('T')[0],
        recorded_by: req.user?.id,
      })
      .select()
      .single()

    if (error) throw error

    // Auto-post journal entry
    const cashAccount = await findAccount('1010', req.user.tenantId)
    const bankAccount = await findAccount('1020', req.user.tenantId)
    const arAccount = await findAccount('1030', req.user.tenantId)

    // For inbound payments from customers, use customer-specific AR account
    let customerArAccount = null
    if (payment_type === 'inbound' && partner_type === 'customer' && partner_id) {
      const { data: customer } = await supabase
        .from('customers')
        .select('account_code')
        .eq('tenant_id', req.user.tenantId)
        .eq('id', partner_id)
        .single()
      if (customer?.account_code) {
        customerArAccount = await findAccount(customer.account_code, req.user.tenantId)
      }
    }
    const effectiveArAccount = customerArAccount || arAccount

    // For outbound payments to suppliers, use supplier-specific AP account
    let apAccount = null
    if (payment_type === 'outbound' && partner_type === 'supplier' && partner_id) {
      const { data: supplier } = await supabase
        .from('suppliers')
        .select('account_code')
        .eq('tenant_id', req.user.tenantId)
        .eq('id', partner_id)
        .single()
      if (supplier?.account_code) {
        apAccount = await findAccount(supplier.account_code, req.user.tenantId)
      }
    }
    if (!apAccount) {
      apAccount = await findAccount('2010', req.user.tenantId)
    }

    // Card, check, bank_transfer all settle to bank account
    const sourceAccount = method === 'cash' ? cashAccount : bankAccount
    const lines = []

    if (payment_type === 'inbound') {
      // Customer pays us: debit cash/bank, credit customer AR
      if (sourceAccount) lines.push({ accountId: sourceAccount.id, debit: parseFloat(amount), credit: 0, description: `Payment received - ${paymentNumber}` })
      if (effectiveArAccount) lines.push({ accountId: effectiveArAccount.id, debit: 0, credit: parseFloat(amount), description: `AR reduction - ${paymentNumber}` })
    } else {
      // We settle with the supplier: debit supplier AP, credit cash/bank.
      if (apAccount) lines.push({ accountId: apAccount.id, debit: parseFloat(amount), credit: 0, description: `AP reduction - ${paymentNumber}` })
      if (sourceAccount) lines.push({ accountId: sourceAccount.id, debit: 0, credit: parseFloat(amount), description: `Payment made - ${paymentNumber}` })
    }

    if (lines.length > 0) {
      try {
        const entry = await createJournalEntry({
          date: payment.payment_date,
          description: `Payment ${payment_type}: ${paymentNumber}`,
          reference: paymentNumber,
          sourceType: 'payment',
          sourceId: payment.id,
          lines,
          createdBy: req.user?.id,
        }, req.user?.tenantId)
        await supabase.from('payments').update({ journal_entry_id: entry.id }).eq('tenant_id', req.user.tenantId).eq('id', payment.id)
        payment.journal_entry_id = entry.id
      } catch (accErr) {
        console.error('Payment journal entry failed:', accErr.message)
      }
    }

    res.status(201).json(payment)
    req.logActivity({ action: 'created', entity_type: 'payment', entity_id: payment.id, entity_name: payment.payment_number, details: { payment_type, method, amount: parseFloat(amount) } })
  } catch (err) {
    console.error('Create payment error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update payment (only if not posted)
router.put('/:id', async (req, res) => {
  try {
    const { data: existing } = await supabase.from('payments').select('journal_entry_id').eq('tenant_id', req.user.tenantId).eq('id', req.params.id).single()
    if (existing?.journal_entry_id) {
      return res.status(400).json({ error: 'Cannot edit posted payment' })
    }

    const { payment_type, method, amount, reference, notes, payment_date } = req.body

    if (!payment_type || !method || !amount) {
      return res.status(400).json({ error: 'Payment type, method, and amount are required' })
    }

    const { data: payment, error } = await supabase
      .from('payments')
      .update({
        payment_type,
        method,
        amount: parseFloat(amount),
        reference: reference || null,
        notes: notes || null,
        payment_date,
      })
      .eq('tenant_id', req.user.tenantId)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    req.logActivity({ action: 'updated', entity_type: 'payment', entity_id: req.params.id, entity_name: payment.payment_number, details: { payment_type, method, amount: parseFloat(amount) } })
    res.json(payment)
  } catch (err) {
    console.error('Update payment error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete payment (auto-reverses journal entry if posted)
router.delete('/:id', async (req, res) => {
  try {
    const { data: payment } = await supabase.from('payments').select('*').eq('tenant_id', req.user.tenantId).eq('id', req.params.id).single()
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' })
    }

    const { error } = await supabase.from('payments').delete().eq('tenant_id', req.user.tenantId).eq('id', req.params.id)
    if (error) throw error

    // Auto-reverse the journal entry
    if (payment.journal_entry_id) {
      try {
        const { reverseJournalEntry } = await import('../services/accountingEngine.js')
        // tenantId is required: reverseJournalEntry scopes its lookup by it,
        // and without it the reversal silently never found the entry.
        await reverseJournalEntry(payment.journal_entry_id, `Payment deleted: ${payment.payment_number}`, req.user?.id, req.user?.tenantId)
      } catch (accErr) {
        console.error('Accounting auto-reverse failed:', accErr.message)
      }
    }

    res.json({ message: 'Payment deleted' })
    req.logActivity({ action: 'deleted', entity_type: 'payment', entity_id: req.params.id, entity_name: payment.payment_number, details: { payment_type: payment.payment_type, method: payment.method, amount: payment.amount } })
  } catch (err) {
    console.error('Delete payment error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export { router as paymentsRouter }
