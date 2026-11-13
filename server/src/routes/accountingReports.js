import { Router } from 'express'
import supabase from '../db/supabase.js'
import { createJournalEntry } from '../services/accountingEngine.js'

const router = Router()

// Trial Balance
router.get('/trial-balance', async (req, res) => {
  try {
    const { period_id } = req.query
    let query = supabase
      .from('accounts')
      .select('id, code, name, account_type, balance')
      .eq('tenant_id', req.user.tenantId)
      .eq('is_active', true)
      .order('code')

    const { data: accounts, error } = await query
    if (error) throw error

    const safeAccounts = accounts || []

    // Group by type
    const grouped = {
      asset: safeAccounts.filter(a => a.account_type === 'asset'),
      liability: safeAccounts.filter(a => a.account_type === 'liability'),
      equity: safeAccounts.filter(a => a.account_type === 'equity'),
      revenue: safeAccounts.filter(a => a.account_type === 'revenue'),
      expense: safeAccounts.filter(a => a.account_type === 'expense'),
    }

    // Type-aware side assignment: a debit-normal account (asset/expense)
    // with a negative balance is an overdrawn credit — it belongs on the
    // credit side, and vice versa. Filtering on sign alone (the old code)
    // dropped every negative balance from BOTH sides, so a tenant with one
    // overdrawn account always looked unbalanced.
    const DEBIT_TYPES = ['asset', 'expense']
    let totalDebit = 0
    let totalCredit = 0
    for (const a of safeAccounts) {
      const balance = parseFloat(a.balance) || 0
      const debitNormal = DEBIT_TYPES.includes(a.account_type)
      const onDebitSide = debitNormal ? balance >= 0 : balance < 0
      const magnitude = Math.abs(balance)
      if (onDebitSide) totalDebit += magnitude
      else totalCredit += magnitude
    }

    res.json({
      accounts: grouped,
      totalDebit,
      totalCredit,
      isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
    })
  } catch (err) {
    console.error('Trial balance error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Balance Sheet
router.get('/balance-sheet', async (req, res) => {
  try {
    const { data: accounts, error } = await supabase
      .from('accounts')
      .select('id, code, name, account_type, balance')
      .eq('tenant_id', req.user.tenantId)
      .eq('is_active', true)
      .in('account_type', ['asset', 'liability', 'equity'])
      .order('code')

    if (error) throw error

    const safeAccounts = accounts || []

    const assets = safeAccounts.filter(a => a.account_type === 'asset')
    const liabilities = safeAccounts.filter(a => a.account_type === 'liability')
    const equity = safeAccounts.filter(a => a.account_type === 'equity')

    const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0)
    const totalLiabilities = liabilities.reduce((sum, a) => sum + a.balance, 0)
    const totalEquity = equity.reduce((sum, a) => sum + a.balance, 0)

    res.json({
      assets: { items: assets, total: totalAssets },
      liabilities: { items: liabilities, total: totalLiabilities },
      equity: { items: equity, total: totalEquity },
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
      isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    })
  } catch (err) {
    console.error('Balance sheet error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Profit & Loss Statement
router.get('/profit-loss', async (req, res) => {
  try {
    const { date_from, date_to } = req.query

    let entryQuery = supabase
      .from('journal_entry_lines')
      .select('debit, credit, accounts(code, name, account_type), journal_entries!inner(date)')
      .eq('tenant_id', req.user.tenantId)

    if (date_from) entryQuery = entryQuery.gte('journal_entries.date', date_from)
    if (date_to) entryQuery = entryQuery.lte('journal_entries.date', date_to)

    const { data: lines, error } = await entryQuery
    if (error) throw error

    const safeLines = lines || []

    // Group by revenue and expense accounts
    const revenueMap = {}
    const expenseMap = {}

    for (const line of safeLines) {
      const account = line.accounts
      if (!account) continue

      if (account.account_type === 'revenue') {
        if (!revenueMap[account.code]) revenueMap[account.code] = { ...account, total: 0 }
        revenueMap[account.code].total += line.credit - line.debit
      }
      if (account.account_type === 'expense') {
        if (!expenseMap[account.code]) expenseMap[account.code] = { ...account, total: 0 }
        expenseMap[account.code].total += line.debit - line.credit
      }
    }

    const revenues = Object.values(revenueMap)
    const expenses = Object.values(expenseMap)
    const totalRevenue = revenues.reduce((sum, r) => sum + r.total, 0)
    const totalExpenses = expenses.reduce((sum, e) => sum + e.total, 0)
    const netIncome = totalRevenue - totalExpenses

    res.json({
      revenues,
      expenses,
      totalRevenue,
      totalExpenses,
      netIncome,
    })
  } catch (err) {
    console.error('Profit & loss error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Get account ledger (transactions for a specific account)
router.get('/account-ledger/:accountId', async (req, res) => {
  try {
    const { date_from, date_to } = req.query

    let query = supabase
      .from('journal_entry_lines')
      .select('*, journal_entries!inner(entry_number, date, description, source_type)')
      .eq('tenant_id', req.user.tenantId)
      .eq('account_id', req.params.accountId)
      .order('journal_entries.date', { ascending: false })

    if (date_from) query = query.gte('journal_entries.date', date_from)
    if (date_to) query = query.lte('journal_entries.date', date_to)

    const { data, error } = await query
    if (error) throw error

    const { data: account } = await supabase
      .from('accounts')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .eq('id', req.params.accountId)
      .single()

    // Calculate running balance
    let runningBalance = 0
    const transactions = data.reverse().map(line => {
      if (['asset', 'expense'].includes(account?.account_type)) {
        runningBalance += line.debit - line.credit
      } else {
        runningBalance += line.credit - line.debit
      }
      return { ...line, balance: runningBalance }
    })

    res.json({ account, transactions: transactions.reverse() })
  } catch (err) {
    console.error('Account ledger error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Fiscal periods
router.get('/fiscal-periods', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('fiscal_periods')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .order('start_date', { ascending: false })

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('Get fiscal periods error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Close fiscal period
router.post('/fiscal-periods/:id/close', async (req, res) => {
  try {
    const { data: period } = await supabase
      .from('fiscal_periods')
      .select('*')
      .eq('tenant_id', req.user.tenantId)
      .eq('id', req.params.id)
      .single()

    if (!period) return res.status(404).json({ error: 'Period not found' })
    if (period.is_closed) return res.status(400).json({ error: 'Period is already closed' })

    // Post net income to retained earnings
    const { data: accounts, error: accountsErr } = await supabase
      .from('accounts')
      .select('id, account_type, balance')
      .eq('tenant_id', req.user.tenantId)

    if (accountsErr) throw accountsErr

    const revenue = (accounts || []).filter(a => a.account_type === 'revenue')
    const expenses = (accounts || []).filter(a => a.account_type === 'expense')
    const totalRevenue = revenue.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0)
    const totalExpenses = expenses.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0)
    const netIncome = totalRevenue - totalExpenses

    if (totalRevenue > 0.01 || totalExpenses > 0.01) {
      // Ensure Retained Earnings account exists
      let { data: retainedEarnings } = await supabase.from('accounts').select('id').eq('tenant_id', req.user.tenantId).eq('code', '3020').single()

      if (!retainedEarnings) {
        const { data: newAcct } = await supabase.from('accounts').insert({
          tenant_id: req.user.tenantId, code: '3020', name: 'Retained Earnings', account_type: 'equity', balance: 0, is_active: true
        }).select('id').single()
        retainedEarnings = newAcct
      }

      if (!retainedEarnings) {
        return res.status(500).json({ error: 'Could not find or create Retained Earnings account (3020)' })
      }

      const lines = []

      // Close revenue accounts (debit positive balances, credit negative balances to zero)
      for (const acc of revenue) {
        const bal = parseFloat(acc.balance) || 0
        if (bal > 0) {
          lines.push({ accountId: acc.id, debit: bal, credit: 0, description: 'Year-end closing' })
        } else if (bal < 0) {
          lines.push({ accountId: acc.id, debit: 0, credit: Math.abs(bal), description: 'Year-end closing' })
        }
      }

      // Close expense accounts (credit positive balances, debit negative balances to zero)
      for (const acc of expenses) {
        const bal = parseFloat(acc.balance) || 0
        if (bal > 0) {
          lines.push({ accountId: acc.id, debit: 0, credit: bal, description: 'Year-end closing' })
        } else if (bal < 0) {
          lines.push({ accountId: acc.id, debit: Math.abs(bal), credit: 0, description: 'Year-end closing' })
        }
      }

      // Transfer net income/loss to Retained Earnings (3020)
      if (Math.abs(netIncome) > 0.01) {
        if (netIncome > 0) {
          lines.push({ accountId: retainedEarnings.id, debit: 0, credit: netIncome, description: 'Transfer net income to retained earnings' })
        } else {
          lines.push({ accountId: retainedEarnings.id, debit: Math.abs(netIncome), credit: 0, description: 'Transfer net loss to retained earnings' })
        }
      }

      console.log('Close period lines:', JSON.stringify(lines, null, 2))

      if (lines.length > 0) {
        await createJournalEntry({
          date: period.end_date,
          description: `Year-end closing for ${period.name}`,
          sourceType: 'closing',
          lines,
          createdBy: req.user?.id,
        }, req.user?.tenantId)
      }
    }

    // Close the period
    await supabase
      .from('fiscal_periods')
      .update({
        is_closed: true,
        closed_by: req.user?.id,
        closed_at: new Date().toISOString(),
      })
      .eq('tenant_id', req.user.tenantId)
      .eq('id', req.params.id)

    req.logActivity?.({ action: 'closed', entity_type: 'fiscal_period', entity_id: req.params.id, entity_name: period.name, details: { total_revenue: totalRevenue, total_expenses: totalExpenses, net_income: netIncome } })
    res.json({ message: 'Fiscal period closed successfully' })
  } catch (err) {
    console.error('Close fiscal period error:', err.message, err.stack)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Force recalculate Current Year Earnings (3030)
router.post('/recalculate-cye', async (req, res) => {
  try {
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, account_type, balance')
      .eq('tenant_id', req.user.tenantId)
      .in('account_type', ['revenue', 'expense'])

    const totalRevenue = (accounts || [])
      .filter(a => a.account_type === 'revenue')
      .reduce((sum, a) => sum + (parseFloat(a.balance) || 0), 0)

    const totalExpenses = (accounts || [])
      .filter(a => a.account_type === 'expense')
      .reduce((sum, a) => sum + (parseFloat(a.balance) || 0), 0)

    const netIncome = totalRevenue - totalExpenses

    // Find or create 3030
    let { data: cye } = await supabase.from('accounts').select('id, balance').eq('tenant_id', req.user.tenantId).eq('code', '3030').single()

    if (!cye) {
      const { data: newAccount } = await supabase
        .from('accounts')
        .insert({ tenant_id: req.user.tenantId, code: '3030', name: 'Current Year Earnings', account_type: 'equity', balance: netIncome })
        .select('id, balance')
        .single()
      cye = newAccount
    } else if (Math.abs(cye.balance - netIncome) > 0.01) {
      await supabase
        .from('accounts')
        .update({ balance: netIncome, updated_at: new Date().toISOString() })
        .eq('tenant_id', req.user.tenantId)
        .eq('id', cye.id)
    }

    res.json({
      totalRevenue,
      totalExpenses,
      netIncome,
      cyeBalance: netIncome,
      updated: true
    })
  } catch (err) {
    console.error('Recalculate CYE error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export { router as accountingReportsRouter }
