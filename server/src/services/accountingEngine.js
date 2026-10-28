import supabase from '../db/supabase.js'

// Round to 2 decimal places (currency minor units) so that summed line items
// reconcile against the order header instead of drifting in float space.
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

// Generate entry number: JE-YYYYMMDD-XXXX
function generateEntryNumber() {
  const now = new Date()
  const date = now.toISOString().split('T')[0].replace(/-/g, '')
  const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0')
  return `JE-${date}-${rand}`
}

// Generate payment number: PAY-YYYYMMDD-XXXX
function generatePaymentNumber() {
  const now = new Date()
  const date = now.toISOString().split('T')[0].replace(/-/g, '')
  const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0')
  return `PAY-${date}-${rand}`
}

// Find account by code, auto-seed if missing
async function findAccountByCode(code, tenantId) {
  let { data } = await supabase.from('accounts').select('id').eq('code', code).eq('tenant_id', tenantId).single()
  if (!data) {
    await seedChartOfAccounts(tenantId)
    const retry = await supabase.from('accounts').select('id').eq('code', code).eq('tenant_id', tenantId).single()
    data = retry.data
  }
  return data
}

// Get or create current open fiscal period
export async function getCurrentPeriod(tenantId) {
  const today = new Date().toISOString().split('T')[0]
  const { data } = await supabase
    .from('fiscal_periods')
    .select('*')
    .eq('tenant_id', tenantId)
    .lte('start_date', today)
    .gte('end_date', today)
    .eq('is_closed', false)
    .single()

  if (data) return data

  // Auto-create fiscal period for current year
  const year = new Date().getFullYear()
  const { data: newPeriod, error } = await supabase
    .from('fiscal_periods')
    .insert({
      tenant_id: tenantId,
      name: `FY ${year}`,
      start_date: `${year}-01-01`,
      end_date: `${year}-12-31`,
    })
    .select()
    .single()

  if (error) throw error
  return newPeriod
}

// Create journal entry with balanced lines
export async function createJournalEntry({ date, description, reference, sourceType, sourceId, lines, createdBy }, tenantId) {
  // Validate: total debits must equal total credits
  const totalDebit = lines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0)
  const totalCredit = lines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0)

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Journal entry is not balanced. Debit: ${totalDebit}, Credit: ${totalCredit}`)
  }

  if (totalDebit === 0 && totalCredit === 0) {
    throw new Error('Journal entry must have non-zero amounts')
  }

  const period = await getCurrentPeriod(tenantId)
  const entryNumber = generateEntryNumber()

  // Create entry
  const { data: entry, error: entryError } = await supabase
    .from('journal_entries')
    .insert({
      tenant_id: tenantId,
      entry_number: entryNumber,
      date: date || new Date().toISOString().split('T')[0],
      description,
      reference: reference || null,
      source_type: sourceType || 'manual',
      source_id: sourceId || null,
      period_id: period.id,
      is_posted: true,
      created_by: createdBy || null,
    })
    .select()
    .single()

  if (entryError) throw entryError

  // Create lines
  const linesData = lines.map(l => ({
    tenant_id: tenantId,
    entry_id: entry.id,
    account_id: l.accountId,
    debit: parseFloat(l.debit) || 0,
    credit: parseFloat(l.credit) || 0,
    description: l.description || null,
  }))

  const { error: linesError } = await supabase
    .from('journal_entry_lines')
    .insert(linesData)

  if (linesError) throw linesError

  // Update account balances
  for (const line of linesData) {
    await updateAccountBalance(line.account_id, period.id, line.debit, line.credit, tenantId)
  }

  console.log('Journal entry created:', {
    entryNumber,
    entryId: entry.id,
    totalDebit,
    totalCredit,
    linesCount: linesData.length
  })

  // Recalculate current year earnings after every journal entry
  recalculateCurrentYearEarnings(tenantId).catch(err =>
    console.error('[CYE] Recalculate failed:', err.message)
  )

  return entry
}

// Update account balance
async function updateAccountBalance(accountId, periodId, debit, credit, tenantId) {
  const { data: existing } = await supabase
    .from('account_balances')
    .select('*')
    .eq('account_id', accountId)
    .eq('period_id', periodId)
    .eq('tenant_id', tenantId)
    .single()

  if (existing) {
    await supabase
      .from('account_balances')
      .update({
        debit_total: existing.debit_total + debit,
        credit_total: existing.credit_total + credit,
        closing_balance: existing.opening_balance + existing.debit_total + debit - existing.credit_total - credit,
      })
      .eq('id', existing.id)
  } else {
    await supabase
      .from('account_balances')
      .insert({
        tenant_id: tenantId,
        account_id: accountId,
        period_id: periodId,
        opening_balance: 0,
        debit_total: debit,
        credit_total: credit,
        closing_balance: debit - credit,
      })
  }

  // Also update the account's running balance
  const { data: account } = await supabase
    .from('accounts')
    .select('account_type, balance')
    .eq('id', accountId)
    .eq('tenant_id', tenantId)
    .single()

  if (account) {
    let newBalance = account.balance
    if (['asset', 'expense'].includes(account.account_type)) {
      newBalance = account.balance + debit - credit
    } else {
      newBalance = account.balance + credit - debit
    }
    await supabase
      .from('accounts')
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq('id', accountId)
      .eq('tenant_id', tenantId)
    
    console.log('Account balance updated:', {
      accountId,
      accountType: account.account_type,
      oldBalance: account.balance,
      newBalance,
      debit,
      credit
    })
  }
}

// Recalculate Current Year Earnings (3030) = Total Revenue - Total Expenses
async function recalculateCurrentYearEarnings(tenantId) {
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, account_type, balance')
    .eq('tenant_id', tenantId)
    .in('account_type', ['revenue', 'expense'])

  if (!accounts) return

  const totalRevenue = accounts
    .filter(a => a.account_type === 'revenue')
    .reduce((sum, a) => sum + (parseFloat(a.balance) || 0), 0)

  const totalExpenses = accounts
    .filter(a => a.account_type === 'expense')
    .reduce((sum, a) => sum + (parseFloat(a.balance) || 0), 0)

  const netIncome = totalRevenue - totalExpenses

  // Find or create 3030 account
  let { data: cyeAccount } = await supabase
    .from('accounts')
    .select('id, balance')
    .eq('code', '3030')
    .eq('tenant_id', tenantId)
    .single()

  if (!cyeAccount) {
    const { data: newAcc } = await supabase
      .from('accounts')
      .insert({ tenant_id: tenantId, code: '3030', name: 'Current Year Earnings', account_type: 'equity', balance: netIncome })
      .select('id, balance')
      .single()
    cyeAccount = newAcc
    console.log('[CYE] Created 3030 account with balance:', netIncome)
  } else if (Math.abs(cyeAccount.balance - netIncome) > 0.01) {
    await supabase
      .from('accounts')
      .update({ balance: netIncome, updated_at: new Date().toISOString() })
      .eq('id', cyeAccount.id)
      .eq('tenant_id', tenantId)

    console.log('[CYE] Current Year Earnings updated:', netIncome)
  }
}

// Auto-post order to journal
export async function postOrderJournal(order, orderItems, customer = null, tenantId) {
  // Ensure accounts exist
  await seedChartOfAccounts(tenantId)

  // Find accounts - use customer-specific AR if available
  let arAccount = null
  if (customer && customer.account_code) {
    const { data } = await supabase.from('accounts').select('id').eq('code', customer.account_code).eq('tenant_id', tenantId).single()
    arAccount = data
  }
  if (!arAccount) {
    const { data } = await supabase.from('accounts').select('id').eq('code', '1030').eq('tenant_id', tenantId).single()
    arAccount = data
  }
  const { data: salesAccount } = await supabase.from('accounts').select('id').eq('code', '4010').eq('tenant_id', tenantId).single()
  const { data: serviceRevenueAccount } = await supabase.from('accounts').select('id').eq('code', '4015').eq('tenant_id', tenantId).single()
  const { data: vatAccount } = await supabase.from('accounts').select('id').eq('code', '2030').eq('tenant_id', tenantId).single()
  const { data: cogsAccount } = await supabase.from('accounts').select('id').eq('code', '5010').eq('tenant_id', tenantId).single()
  const { data: inventoryAccount } = await supabase.from('accounts').select('id').eq('code', '1050').eq('tenant_id', tenantId).single()

  const lines = []

  const orderTotal = parseFloat(order.total) || 0
  const orderVat = parseFloat(order.tax_amount) || 0

  // Debit AR (accounts receivable) — payment will clear this
  if (arAccount) {
    lines.push({
      accountId: arAccount.id,
      debit: orderTotal,
      credit: 0,
      description: `AR - ${order.order_number}`,
    })
  } else {
    // Without a debit side the entry can never balance. Skip rather than
    // throwing (the caller only logs the failure, which used to hide the
    // fact that discounted sales never posted at all).
    console.error(`[ORDER JOURNAL] No AR account for ${order.order_number}; skipping`)
    return null
  }

  // Gross revenue per type, from the line items.
  let grossProductRevenue = 0
  let grossServiceRevenue = 0
  if (orderItems && orderItems.length > 0) {
    for (const item of orderItems) {
      const itemTotal = (parseFloat(item.unit_price) || 0) * (parseInt(item.quantity, 10) || 0)
      if (item._type === 'service') {
        grossServiceRevenue += itemTotal
      } else {
        grossProductRevenue += itemTotal
      }
    }
  } else {
    // Fallback: derive the product/service split from the order header only.
    grossProductRevenue = Math.max(orderTotal - orderVat, 0)
  }

  // Net revenue recognised = total charged minus the VAT component. Deriving
  // it from order.total (rather than summing line items) guarantees the entry
  // balances even when the header carries a discount, a promo, or any other
  // client-supplied adjustment. Previously revenue was credited at the gross
  // line-item sum while AR was debited at the discounted total, so any order
  // with discount_amount > 0 produced an unbalanced entry that threw and was
  // silently swallowed -- revenue journals were simply lost.
  const netRevenue = round2(orderTotal - orderVat)
  const grossRevenue = grossProductRevenue + grossServiceRevenue
  let productRevenue = 0
  let serviceRevenue = 0
  if (grossRevenue > 0) {
    productRevenue = round2(netRevenue * (grossProductRevenue / grossRevenue))
    serviceRevenue = round2(netRevenue - productRevenue)
  } else {
    productRevenue = netRevenue
  }

  // Credit product sales revenue (4010)
  if (salesAccount && productRevenue > 0) {
    lines.push({
      accountId: salesAccount.id,
      debit: 0,
      credit: productRevenue,
      description: `Product sale - ${order.order_number}`,
    })
  }

  // Credit service revenue (4015)
  if (serviceRevenueAccount && serviceRevenue > 0) {
    lines.push({
      accountId: serviceRevenueAccount.id,
      debit: 0,
      credit: serviceRevenue,
      description: `Service sale - ${order.order_number}`,
    })
  }

  // Credit VAT payable
  if (vatAccount && orderVat > 0) {
    lines.push({
      accountId: vatAccount.id,
      debit: 0,
      credit: orderVat,
      description: `VAT for ${order.order_number}`,
    })
  }

  // COGS entry (debit expense, credit inventory) - only for product items
  if (orderItems && orderItems.length > 0) {
    let totalCost = 0
    for (const item of orderItems) {
      if (item.cost_price && item._type !== 'service') {
        totalCost += parseFloat(item.cost_price) * item.quantity
      }
    }
    if (totalCost > 0) {
      if (cogsAccount) {
        lines.push({
          accountId: cogsAccount.id,
          debit: totalCost,
          credit: 0,
          description: `COGS for ${order.order_number}`,
        })
      }
      if (inventoryAccount) {
        lines.push({
          accountId: inventoryAccount.id,
          debit: 0,
          credit: totalCost,
          description: `Inventory out - ${order.order_number}`,
        })
      }
    }
  }

  if (lines.length === 0) return null

  return createJournalEntry({
    date: order.completed_at ? new Date(order.completed_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    description: `Sale - ${order.order_number}`,
    reference: order.order_number,
    sourceType: 'order',
    sourceId: order.id,
    lines,
    createdBy: order.user_id,
  }, tenantId)
}

// Auto-post refund to journal
export async function postRefundJournal(refund, refundItems = null, tenantId) {
  const { data: returnsAccount } = await supabase.from('accounts').select('id').eq('code', '4020').eq('tenant_id', tenantId).single()
  const { data: cashAccount } = await supabase.from('accounts').select('id').eq('code', '1010').eq('tenant_id', tenantId).single()
  const { data: bankAccount } = await supabase.from('accounts').select('id').eq('code', '1020').eq('tenant_id', tenantId).single()
  const { data: vatAccount } = await supabase.from('accounts').select('id').eq('code', '2030').eq('tenant_id', tenantId).single()
  const { data: cogsAccount } = await supabase.from('accounts').select('id').eq('code', '5010').eq('tenant_id', tenantId).single()
  const { data: inventoryAccount } = await supabase.from('accounts').select('id').eq('code', '1050').eq('tenant_id', tenantId).single()

  let creditAccount = cashAccount
  let orderTaxAmount = 0
  let orderTotal = 0

  if (refund.order_id) {
    const { data: orderPayments } = await supabase
      .from('payments')
      .select('method')
      .eq('order_id', refund.order_id)
      .eq('tenant_id', tenantId)
      .limit(1)
    if (orderPayments && orderPayments.length > 0) {
      const originalMethod = orderPayments[0].method
      creditAccount = originalMethod === 'cash' ? cashAccount : bankAccount
    } else {
      creditAccount = cashAccount
    }

    // Get order VAT info for proportional calculation
    const { data: order } = await supabase
      .from('orders')
      .select('tax_amount, total')
      .eq('id', refund.order_id)
      .eq('tenant_id', tenantId)
      .single()
    if (order) {
      orderTaxAmount = parseFloat(order.tax_amount || 0)
      orderTotal = parseFloat(order.total || 0)
    }
  }

  // Calculate VAT portion of this refund
  let refundVat = 0
  if (orderTaxAmount > 0 && orderTotal > 0) {
    refundVat = (orderTaxAmount * parseFloat(refund.amount)) / orderTotal
    refundVat = Math.round(refundVat * 100) / 100
  }

  const preVatAmount = parseFloat(refund.amount) - refundVat

  const lines = []

  // Debit Sales Returns (4020) — pre-VAT amount
  if (returnsAccount && preVatAmount > 0) {
    lines.push({
      accountId: returnsAccount.id,
      debit: preVatAmount,
      credit: 0,
      description: refundItems ? 'Refund - partial' : 'Refund - full order',
    })
  }

  // Debit VAT Payable (2030) — reverse VAT
  if (vatAccount && refundVat > 0) {
    lines.push({
      accountId: vatAccount.id,
      debit: refundVat,
      credit: 0,
      description: `VAT reversed - refund`,
    })
  }

  // Credit cash/bank — total refund amount
  if (creditAccount) {
    lines.push({
      accountId: creditAccount.id,
      debit: 0,
      credit: parseFloat(refund.amount),
      description: 'Refund payment',
    })
  }

  // Reverse COGS: restore inventory value
  if (refund.order_id && cogsAccount && inventoryAccount) {
    let refundCost = 0

    if (refundItems && refundItems.length > 0) {
      // Item-level refund: look up cost_price from products for each refunded item
      for (const ri of refundItems) {
        const { data: product } = await supabase
          .from('products')
          .select('cost_price')
          .eq('id', ri.product_id)
          .eq('tenant_id', tenantId)
          .single()

        const cost = product?.cost_price ? parseFloat(product.cost_price) : parseFloat(ri.unit_price) * 0.5
        refundCost += cost * ri.quantity
      }
    } else {
      // Full refund: use proportional cost calculation
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('quantity, unit_price, product_id')
        .eq('order_id', refund.order_id)
        .eq('tenant_id', tenantId)

      if (orderItems && orderItems.length > 0) {
        const { data: order } = await supabase
          .from('orders')
          .select('total')
          .eq('id', refund.order_id)
          .eq('tenant_id', tenantId)
          .single()

        if (order && parseFloat(order.total) > 0) {
          const refundRatio = parseFloat(refund.amount) / parseFloat(order.total)
          let totalCost = 0
          for (const item of orderItems) {
            const { data: product } = await supabase
              .from('products')
              .select('cost_price')
              .eq('id', item.product_id)
              .eq('tenant_id', tenantId)
              .single()

            const cost = product?.cost_price ? parseFloat(product.cost_price) : parseFloat(item.unit_price) * 0.5
            totalCost += cost * item.quantity
          }
          refundCost = totalCost * refundRatio
        }
      }
    }

    if (refundCost > 0) {
      // Debit inventory (restore asset)
      lines.push({
        accountId: inventoryAccount.id,
        debit: refundCost,
        credit: 0,
        description: 'Inventory restored - refund',
      })

      // Credit COGS (reverse expense)
      lines.push({
        accountId: cogsAccount.id,
        debit: 0,
        credit: refundCost,
        description: 'COGS reversed - refund',
      })
    }
  }

  if (lines.length === 0) return null

  return createJournalEntry({
    date: new Date().toISOString().split('T')[0],
    description: refundItems ? `Partial refund - ${refundItems.length} item(s)` : 'Full order refund',
    reference: `REF-${refund.id}`,
    sourceType: 'refund',
    sourceId: refund.id,
    lines,
    createdBy: refund.processed_by,
  }, tenantId)
}

// Auto-post expense to journal
export async function postExpenseJournal(expense, tenantId) {
  // Map expense category to correct account
  const categoryAccountMap = {
    'Rent': '5040',
    'Utilities': '5050',
    'Salaries': '5030',
    'Salary': '5030',
    'Marketing': '5020',
    'Maintenance': '5020',
    'Supplies': '5020',
  }
  const accountCode = categoryAccountMap[expense.category] || '5020'
  const { data: expenseAccount } = await supabase.from('accounts').select('id').eq('code', accountCode).eq('tenant_id', tenantId).single()

  // Use correct source account based on payment method
  const method = expense.method || 'cash'
  const sourceCode = method === 'cash' ? '1010' : '1020'
  const { data: sourceAccount } = await supabase.from('accounts').select('id').eq('code', sourceCode).eq('tenant_id', tenantId).single()

  const lines = []

  if (expenseAccount) {
    lines.push({
      accountId: expenseAccount.id,
      debit: parseFloat(expense.amount),
      credit: 0,
      description: `Expense: ${expense.category}`,
    })
  }

  if (sourceAccount) {
    lines.push({
      accountId: sourceAccount.id,
      debit: 0,
      credit: parseFloat(expense.amount),
      description: `Payment for expense`,
    })
  }

  if (lines.length === 0) return null

  return createJournalEntry({
    date: expense.expense_date || new Date().toISOString().split('T')[0],
    description: `Expense: ${expense.category} - ${expense.description || ''}`,
    sourceType: 'expense',
    sourceId: expense.id,
    lines,
    createdBy: expense.recorded_by,
  }, tenantId)
}

// Auto-post subscription payment to journal
export async function postSubscriptionPaymentJournal(payment, subscription, plan, tenantId) {
  await seedChartOfAccounts(tenantId)

  // Determine revenue account based on subscription type
  const revenueCode = '4025' // Subscription Revenue
  const revenueAccount = await findAccountByCode(revenueCode, tenantId)

  // Determine cash/bank account based on payment method
  const method = payment.payment_method || 'cash'
  const sourceCode = method === 'card' || method === 'bank' ? '1020' : '1010'
  const sourceAccount = await findAccountByCode(sourceCode, tenantId)

  const lines = []

  // Debit Cash/Bank
  if (sourceAccount) {
    lines.push({
      accountId: sourceAccount.id,
      debit: parseFloat(payment.amount),
      credit: 0,
      description: `Subscription payment - ${plan?.name || 'subscription'}`,
    })
  }

  // Credit Subscription Revenue
  if (revenueAccount) {
    lines.push({
      accountId: revenueAccount.id,
      debit: 0,
      credit: parseFloat(payment.amount),
      description: `Subscription revenue - ${plan?.name || 'subscription'}`,
    })
  }

  if (lines.length === 0) return null

  return createJournalEntry({
    date: payment.payment_date || new Date().toISOString().split('T')[0],
    description: `Subscription payment - ${plan?.name || 'subscription'}`,
    reference: `SUB-${subscription.id}`,
    sourceType: 'subscription_payment',
    sourceId: payment.id,
    lines,
    createdBy: null,
  }, tenantId)
}

// Auto-post stock receive to journal (with per-supplier AP)
export async function postStockReceiveJournal(movement, product, supplier, tenantId) {
  const inventoryAccount = await findAccountByCode('1050', tenantId)

  const costValue = (product.cost_price || 0) * movement.quantity

  // Per-supplier AP account
  let apAccount = null
  if (supplier && supplier.account_code) {
    apAccount = await findAccountByCode(supplier.account_code, tenantId)
    if (!apAccount) {
      // Auto-create supplier AP account
      const { data: newAcc } = await supabase
        .from('accounts')
        .insert({
          tenant_id: tenantId,
          code: supplier.account_code,
          name: `AP - ${supplier.name}`,
          account_type: 'liability',
        })
        .select('id')
        .single()
      apAccount = newAcc
    }
  } else {
    // Fallback to generic AP
    apAccount = await findAccountByCode('2010', tenantId)
  }

  const lines = []
  if (inventoryAccount) {
    lines.push({
      accountId: inventoryAccount.id,
      debit: costValue,
      credit: 0,
      description: `Stock in: ${product.name} x${movement.quantity}`,
    })
  }
  if (apAccount) {
    lines.push({
      accountId: apAccount.id,
      debit: 0,
      credit: costValue,
      description: `AP - ${product.name} x${movement.quantity}`,
    })
  }

  if (lines.length === 0) return null

  return createJournalEntry({
    date: new Date().toISOString().split('T')[0],
    description: `Stock receive - ${product.name} x${movement.quantity}`,
    sourceType: 'stock_receive',
    sourceId: movement.id,
    lines,
    createdBy: null,
  }, tenantId)
}

// Auto-post stock adjustment to journal
export async function postStockAdjustJournal(movement, product, tenantId) {
  const inventoryAccount = await findAccountByCode('1050', tenantId)
  const cogsAccount = await findAccountByCode('5010', tenantId)

  const costValue = (product.cost_price || 0) * Math.abs(movement.quantity)

  const lines = []

  if (movement.quantity > 0) {
    // Stock increase: debit inventory, credit COGS
    if (inventoryAccount) lines.push({ accountId: inventoryAccount.id, debit: costValue, credit: 0, description: `Stock adj up: ${product.name}` })
    if (cogsAccount) lines.push({ accountId: cogsAccount.id, debit: 0, credit: costValue, description: `Stock adj up: ${product.name}` })
  } else {
    // Stock decrease (shrinkage): debit COGS, credit inventory
    if (cogsAccount) lines.push({ accountId: cogsAccount.id, debit: costValue, credit: 0, description: `Stock adj down: ${product.name}` })
    if (inventoryAccount) lines.push({ accountId: inventoryAccount.id, debit: 0, credit: costValue, description: `Stock adj down: ${product.name}` })
  }

  if (lines.length === 0) return null

  return createJournalEntry({
    date: new Date().toISOString().split('T')[0],
    description: `Stock adjust - ${product.name} (${movement.quantity > 0 ? '+' : ''}${movement.quantity})`,
    sourceType: 'stock_adjust',
    sourceId: movement.id,
    lines,
    createdBy: null,
  }, tenantId)
}

// Auto-post production completion to journal (ADDITIVE export — no
// existing symbol or call path is modified).
//
// Flat-inventory model (house convention, mirrors postStockAdjustJournal):
//   Dr 1050 Inventory            total_cost     (finished goods value in)
//   Cr 1050 Inventory            component_cost (raw materials value out)
//   Cr 5010 COGS                 operations_cost (conversion value added)
// Debits always equal credits by construction (total = component +
// operations); if an account the entry needs is missing we return null and
// skip, exactly like the stock posters do.
export async function postProductionJournal(order, product, tenantId) {
  const component = Number(order.component_cost) || 0
  const operations = Number(order.operations_cost) || 0
  const total = Number(order.total_cost) || 0
  if (total <= 0) return null

  const inventoryAccount = await findAccountByCode('1050', tenantId)
  if (!inventoryAccount) return null

  const lines = [{
    accountId: inventoryAccount.id,
    debit: total,
    credit: 0,
    description: `Production in: ${product.name || ''} x${order.quantity_produced}`,
  }]
  if (component > 0) {
    lines.push({
      accountId: inventoryAccount.id,
      debit: 0,
      credit: component,
      description: `Production components - ${order.order_number}`,
    })
  }
  if (operations > 0) {
    const cogsAccount = await findAccountByCode('5010', tenantId)
    if (!cogsAccount) return null
    lines.push({
      accountId: cogsAccount.id,
      debit: 0,
      credit: operations,
      description: `Production conversion - ${order.order_number}`,
    })
  }

  return createJournalEntry({
    date: (order.completed_at || new Date().toISOString()).split('T')[0],
    description: `Production ${order.order_number} - ${product.name || ''}`,
    reference: order.order_number,
    sourceType: 'production',
    sourceId: order.id,
    lines,
    createdBy: null,
  }, tenantId)
}

// Reverse a journal entry (creates opposite entry)
export async function reverseJournalEntry(entryId, reason, userId, tenantId) {
  const { data: originalEntry } = await supabase
    .from('journal_entries')
    .select('*, journal_entry_lines(*)')
    .eq('id', entryId)
    .eq('tenant_id', tenantId)
    .single()

  if (!originalEntry) throw new Error('Journal entry not found')
  if (originalEntry.is_reversed) throw new Error('Journal entry already reversed')

  // Create reversal lines (swap debits and credits)
  const reversalLines = originalEntry.journal_entry_lines.map(line => ({
    accountId: line.account_id,
    debit: line.credit,
    credit: line.debit,
    description: `Reversal: ${line.description}`,
  }))

  const entry = await createJournalEntry({
    date: new Date().toISOString().split('T')[0],
    description: `Reversal of ${originalEntry.entry_number}: ${reason}`,
    reference: originalEntry.entry_number,
    sourceType: 'reversal',
    sourceId: originalEntry.id,
    lines: reversalLines,
    createdBy: userId,
  }, tenantId)

  // Mark original as reversed
  await supabase
    .from('journal_entries')
    .update({ is_reversed: true, reversed_by: entry.id })
    .eq('id', entryId)
    .eq('tenant_id', tenantId)

  return entry
}

// Post expense update: reverse old entry, create new entry
export async function postExpenseUpdateJournal(oldExpense, newExpense, tenantId) {
  // Find and reverse the original journal entry
  const { data: oldEntry } = await supabase
    .from('journal_entries')
    .select('id')
    .eq('source_type', 'expense')
    .eq('source_id', oldExpense.id)
    .eq('is_reversed', false)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (oldEntry) {
    await reverseJournalEntry(oldEntry.id, `Expense updated: ${newExpense.category}`, newExpense.recorded_by, tenantId)
  }

  // Create new entry for updated expense
  return postExpenseJournal(newExpense, tenantId)
}

// Post payment delete: reverse the journal entry
export async function postPaymentDeleteJournal(payment, tenantId) {
  if (!payment.journal_entry_id) return null

  const { data: entry } = await supabase
    .from('journal_entries')
    .select('id, is_reversed')
    .eq('id', payment.journal_entry_id)
    .eq('tenant_id', tenantId)
    .single()

  if (entry && !entry.is_reversed) {
    return reverseJournalEntry(entry.id, `Payment deleted: ${payment.payment_number}`, payment.recorded_by, tenantId)
  }

  return null
}

// Seed default chart of accounts
export async function seedChartOfAccounts(tenantId) {
  const defaultAccounts = [
    // Assets
    { code: '1010', name: 'Cash', account_type: 'asset' },
    { code: '1020', name: 'Bank Account', account_type: 'asset' },
    { code: '1030', name: 'Accounts Receivable', account_type: 'asset' },
    { code: '1050', name: 'Inventory', account_type: 'asset' },
    // Liabilities
    { code: '2010', name: 'Accounts Payable', account_type: 'liability' },
    { code: '2030', name: 'VAT Payable', account_type: 'liability' },
    // Equity
    { code: '3010', name: 'Owner Equity', account_type: 'equity' },
    { code: '3020', name: 'Retained Earnings', account_type: 'equity' },
    { code: '3030', name: 'Current Year Earnings', account_type: 'equity' },
    // Revenue
    { code: '4010', name: 'Sales Revenue', account_type: 'revenue' },
    { code: '4015', name: 'Service Revenue', account_type: 'revenue' },
    { code: '4020', name: 'Sales Returns', account_type: 'revenue' },
    { code: '4025', name: 'Subscription Revenue', account_type: 'revenue' },
    // Expenses
    { code: '5010', name: 'Cost of Goods Sold', account_type: 'expense' },
    { code: '5020', name: 'Operating Expenses', account_type: 'expense' },
    { code: '5030', name: 'Salary Expense', account_type: 'expense' },
    { code: '5040', name: 'Rent Expense', account_type: 'expense' },
    { code: '5050', name: 'Utilities Expense', account_type: 'expense' },
  ]

  for (const account of defaultAccounts) {
    const { data: existing } = await supabase
      .from('accounts')
      .select('id')
      .eq('code', account.code)
      .eq('tenant_id', tenantId)
      .single()

    if (!existing) {
      await supabase.from('accounts').insert({ ...account, tenant_id: tenantId })
    }
  }
}
