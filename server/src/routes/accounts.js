import { Router } from 'express'
import supabase from '../db/supabase.js'
import { seedChartOfAccounts } from '../services/accountingEngine.js'
import { sanitizeSearch } from '../helpers/search.js'

const router = Router()

// Get all accounts
router.get('/', async (req, res) => {
  try {
    const { type, search } = req.query
    let query = supabase.from('accounts').select('*').eq('tenant_id', req.user.tenantId).order('code')

    if (type) query = query.eq('account_type', type)
    if (search) {
      const s = sanitizeSearch(search)
      if (s) query = query.or(`name.ilike.%${s}%,code.ilike.%${s}%`)
    }

    const { data, error } = await query
    if (error) throw error

    // Auto-seed if no accounts exist for this tenant
    if (!data || data.length === 0) {
      await seedChartOfAccounts(req.user.tenantId)
      const { data: seeded } = await supabase.from('accounts').select('*').eq('tenant_id', req.user.tenantId).order('code')
      return res.json(seeded || [])
    }

    res.json(data)
  } catch (err) {
    console.error('Get accounts error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get single account
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .eq('id', req.params.id)
      .single()

    if (error || !data) return res.status(404).json({ error: 'Account not found' })
    res.json(data)
  } catch (err) {
    console.error('Get account error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Create account
router.post('/', async (req, res) => {
  try {
    const { code, name, account_type, parent_id, description } = req.body
    if (!code || !name || !account_type) {
      return res.status(400).json({ error: 'Code, name, and type are required' })
    }

    const { data, error } = await supabase
      .from('accounts')
      .insert({ tenant_id: req.user.tenantId, code, name, account_type, parent_id: parent_id || null, description: description || null })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'Account code already exists' })
      throw error
    }
    req.logActivity({ action: 'created', entity_type: 'account', entity_id: data.id, entity_name: `${code} - ${name}` })
    res.status(201).json(data)
  } catch (err) {
    console.error('Create account error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Update account
router.put('/:id', async (req, res) => {
  try {
    const { code, name, account_type, parent_id, description, is_active } = req.body
    const updateData = { updated_at: new Date().toISOString() }
    if (code !== undefined) updateData.code = code
    if (name !== undefined) updateData.name = name
    if (account_type !== undefined) updateData.account_type = account_type
    if (parent_id !== undefined) updateData.parent_id = parent_id || null
    if (description !== undefined) updateData.description = description
    if (is_active !== undefined) updateData.is_active = is_active

    const { data, error } = await supabase
      .from('accounts')
      .update(updateData)
      .eq('tenant_id', req.user.tenantId)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    req.logActivity({ action: 'updated', entity_type: 'account', entity_id: req.params.id, entity_name: data.name })
    res.json(data)
  } catch (err) {
    console.error('Update account error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Delete account
router.delete('/:id', async (req, res) => {
  try {
    // Check if account has journal entry lines
    const { count } = await supabase
      .from('journal_entry_lines')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', req.user.tenantId)
      .eq('account_id', req.params.id)

    if (count > 0) {
      // 409 (not 400): "in use" is a conflict, not a malformed request —
      // mirrors the services/plans guard so the client can distinguish it
      // and show the count-bearing message.
      return res.status(409).json({
        error: `Account is used by ${count} journal line(s) — deactivate it instead`,
        entry_count: count,
      })
    }

    const { error } = await supabase.from('accounts').delete().eq('tenant_id', req.user.tenantId).eq('id', req.params.id)
    if (error) throw error
    req.logActivity({ action: 'deleted', entity_type: 'account', entity_id: req.params.id })
    res.json({ message: 'Account deleted' })
  } catch (err) {
    console.error('Delete account error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Seed default chart of accounts
router.post('/seed', async (req, res) => {
  try {
    await seedChartOfAccounts(req.user.tenantId)
    req.logActivity({ action: 'seeded', entity_type: 'account', entity_name: 'Chart of Accounts' })
    res.json({ message: 'Chart of accounts seeded successfully' })
  } catch (err) {
    console.error('Seed accounts error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Set initial capital (Owner Equity → Cash/Bank journal entry)
router.post('/initial-capital', async (req, res) => {
  try {
    const { amount, description } = req.body
    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than zero' })
    }

    const { createJournalEntry } = await import('../services/accountingEngine.js')

    const equityAccount = await supabase.from('accounts').select('id').eq('tenant_id', req.user.tenantId).eq('code', '3010').single()
    const cashAccount = await supabase.from('accounts').select('id').eq('tenant_id', req.user.tenantId).eq('code', '1010').single()

    if (!equityAccount.data || !cashAccount.data) {
      return res.status(400).json({ error: 'Owner Equity (3010) or Cash (1010) account not found. Run Seed Defaults first.' })
    }

    const entry = await createJournalEntry({
      date: new Date().toISOString().split('T')[0],
      description: description || `Initial capital contribution - ${parseFloat(amount).toFixed(2)} EGP`,
      reference: 'INIT-CAP',
      sourceType: 'initial_capital',
      lines: [
        { accountId: cashAccount.data.id, debit: parseFloat(amount), credit: 0, description: 'Cash received' },
        { accountId: equityAccount.data.id, debit: 0, credit: parseFloat(amount), description: 'Owner equity contribution' },
      ],
    }, req.user.tenantId)

    res.json({ message: 'Initial capital recorded', entryId: entry.id })
    req.logActivity({ action: 'created', entity_type: 'initial_capital', entity_name: `Initial Capital - ${parseFloat(amount).toFixed(2)} EGP`, details: { amount: parseFloat(amount), entry_id: entry.id } })
  } catch (err) {
    console.error('Set initial capital error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Recalculate all account balances from journal entries
router.post('/recalculate-balances', async (req, res) => {
  try {
    const { data: accounts } = await supabase.from('accounts').select('id, code, account_type').eq('tenant_id', req.user.tenantId)

    for (const account of accounts || []) {
      const { data: lines } = await supabase
        .from('journal_entry_lines')
        .select('debit, credit')
        .eq('tenant_id', req.user.tenantId)
        .eq('account_id', account.id)

      const totalDebit = (lines || []).reduce((s, l) => s + parseFloat(l.debit), 0)
      const totalCredit = (lines || []).reduce((s, l) => s + parseFloat(l.credit), 0)

      let balance = 0
      if (['asset', 'expense'].includes(account.account_type)) {
        balance = totalDebit - totalCredit
      } else {
        balance = totalCredit - totalDebit
      }

      await supabase.from('accounts').update({ balance, updated_at: new Date().toISOString() }).eq('tenant_id', req.user.tenantId).eq('id', account.id)
    }

    res.json({ message: 'All account balances recalculated' })
    req.logActivity({ action: 'recalculated', entity_type: 'account', entity_name: 'All account balances' })
  } catch (err) {
    console.error('Recalculate balances error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export { router as accountsRouter }
