// Payments: the journal every create posts, and the partner rules around it.
//
// Why this file exists: the outbound-payment coverage used to live inside
// supplierAdvances.test.js, which left with the advance feature. The path it
// left untested is the one this change actually touched — an outbound
// settlement now posts exactly two lines (Dr supplier AP in full, Cr
// cash/bank in full), with no advance line and no advance_applied in the
// response. The accounts mock resolves BY CODE (not positionally), so each
// assertion proves which account was really debited/credited — the failure
// mode that produced this feature's predecessor bug (journal posted to the
// wrong side entirely while looking successful).

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon'

// ---------------------------------------------------------------------------
// Table-scripted supabase mock (same harness as purchaseOrderReceive.test.js)
// ---------------------------------------------------------------------------

const queues = new Map()
const defaults = new Map()

function enqueue(table, ...results) {
  if (!queues.has(table)) queues.set(table, [])
  queues.get(table).push(...results)
}
function setDefault(table, result) {
  defaults.set(table, result)
}
function nextResult(table) {
  const q = queues.get(table)
  if (q && q.length > 0) return q.shift()
  if (defaults.has(table)) return defaults.get(table)
  return { data: null, error: null }
}

function makeFrom(table) {
  const chain = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range', 'gte', 'lte', 'update', 'insert', 'delete']) {
    chain[m] = jest.fn(() => chain)
  }
  chain.single = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.maybeSingle = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.then = (resolve, reject) => Promise.resolve(nextResult(table)).then(resolve, reject)
  return chain
}

// Accounts resolve BY the code each query filters on: one request looks up
// 1010, 1020, 1030, then the supplier's own payable — assertions need to
// tell those apart. 1150 stays resolvable on purpose: the point of the
// settlement assertions below is that NOTHING posts to it.
const ACCOUNTS = {
  '1010': { id: 1, code: '1010', balance: 0 },      // Cash
  '1020': { id: 2, code: '1020', balance: 0 },      // Bank
  '1030': { id: 3, code: '1030', balance: 0 },      // Accounts Receivable
  '1150': { id: 5, code: '1150', balance: 0 },      // Supplier Advances (legacy)
  '2010': { id: 99, code: '2010', balance: 0 },     // generic Accounts Payable
  '20101': { id: 22, code: '20101', balance: 500 }, // one supplier's payable
}

function makeAccountsFrom() {
  const chain = {}
  for (const m of ['select', 'in', 'order', 'limit', 'range', 'gte', 'lte', 'insert', 'update', 'delete']) {
    chain[m] = jest.fn(() => chain)
  }
  const codes = []
  chain.eq = jest.fn((col, val) => {
    if (col === 'code') codes.push(val)
    return chain
  })
  const result = () => {
    const code = codes[codes.length - 1]
    return { data: ACCOUNTS[code] ?? null, error: null }
  }
  chain.single = jest.fn(() => Promise.resolve(result()))
  chain.maybeSingle = jest.fn(() => Promise.resolve(result()))
  chain.then = (resolve, reject) => Promise.resolve(result()).then(resolve, reject)
  return chain
}

const fromSpy = jest.fn((table) => (table === 'accounts' ? makeAccountsFrom() : makeFrom(table)))

jest.unstable_mockModule('../db/supabase.js', () => ({
  default: { from: fromSpy },
  supabaseStorage: { from: (table) => makeFrom(table) },
  withTimeout: (p) => p,
}))

// Capture journals instead of writing them. createJournalEntry returns the
// entry ROW (not {data}), which is what the caller dereferences.
const journalSpy = jest.fn(async () => ({ id: 501 }))
const seedSpy = jest.fn(async () => undefined)
jest.unstable_mockModule('../services/accountingEngine.js', () => ({
  createJournalEntry: journalSpy,
  seedChartOfAccounts: seedSpy,
}))

const { paymentsRouter } = await import('../routes/payments.js')

const app = express()
app.use(express.json())

// Stand in for index.js's authenticateToken + activityLogger mounts.
const asUser = (req, _res, next) => {
  req.user = { id: 1, tenantId: 1, role: 'MANAGER' }
  req.branchId = null
  req.logActivity = jest.fn()
  next()
}
app.use('/api/accounting/payments', asUser, paymentsRouter)

beforeEach(() => {
  queues.clear()
  defaults.clear()
  jest.clearAllMocks()
})

const callsFor = (table) => fromSpy.mock.calls.filter((c) => c[0] === table).length

// One outbound create: payments insert + journal-link update, one supplier
// lookup. Everything else (cash/bank/AR/AP accounts) resolves by code.
function primeOutbound({ supplier, amount = 100 } = {}) {
  enqueue('payments',
    { data: { id: 800, payment_number: 'PAY-20261112-0001', payment_date: '2026-11-12' }, error: null },
    { data: null, error: null })
  enqueue('suppliers', { data: supplier, error: null })
  return request(app)
    .post('/api/accounting/payments')
    .send({
      payment_type: 'outbound',
      method: 'cash',
      amount,
      partner_type: 'supplier',
      partner_id: 9,
    })
}

// ---------------------------------------------------------------------------
// Outbound settlement journal (payments.js)
// ---------------------------------------------------------------------------

describe('POST /accounting/payments — outbound settlement journal', () => {
  it('debits the supplier AP in full and credits cash for the whole amount', async () => {
    const res = await primeOutbound({ supplier: { account_code: '20101' }, amount: 100 })

    expect(res.status).toBe(201)
    // No advance feature: the response must not carry the old field.
    expect(res.body).not.toHaveProperty('advance_applied')
    // Nothing ever queries the (now-deleted) advance table.
    expect(callsFor('supplier_advances')).toBe(0)

    expect(journalSpy).toHaveBeenCalledTimes(1)
    const { lines } = journalSpy.mock.calls[0][0]
    expect(lines).toHaveLength(2)
    // 22 = 20101 the supplier's own payable, 1 = 1010 Cash.
    expect(lines[0]).toMatchObject({ accountId: 22, debit: 100, credit: 0 })
    expect(lines[1]).toMatchObject({ accountId: 1, debit: 0, credit: 100 })
    // Balanced, and never a legacy advance line.
    const debits = lines.reduce((s, l) => s + l.debit, 0)
    const credits = lines.reduce((s, l) => s + l.credit, 0)
    expect(debits).toBe(credits)
    expect(lines.some((l) => l.accountId === 5)).toBe(false)
  })

  it('falls back to the generic 2010 payable when the supplier has no account_code', async () => {
    const res = await primeOutbound({ supplier: { account_code: null }, amount: 100 })

    expect(res.status).toBe(201)
    const { lines } = journalSpy.mock.calls[0][0]
    // 99 = generic 2010 Accounts Payable.
    expect(lines[0]).toMatchObject({ accountId: 99, debit: 100, credit: 0 })
    expect(lines[1]).toMatchObject({ accountId: 1, debit: 0, credit: 100 })
  })
})

// ---------------------------------------------------------------------------
// Partner rules
// ---------------------------------------------------------------------------

describe('POST /accounting/payments — partner rules', () => {
  it('rejects an outbound payment with no supplier before writing anything', async () => {
    // Without this guard the journal falls back to generic 2010: the payment
    // posts fine but the supplier's own balance never moves — silent
    // "payment did not decrease the remaining value".
    const res = await request(app)
      .post('/api/accounting/payments')
      .send({ payment_type: 'outbound', method: 'cash', amount: 100 })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('supplier')
    expect(callsFor('payments')).toBe(0)
    expect(journalSpy).not.toHaveBeenCalled()
  })

  it('still accepts an inbound payment without a partner', async () => {
    enqueue('payments',
      { data: { id: 801, payment_number: 'PAY-20261112-0002' }, error: null },
      { data: null, error: null })

    const res = await request(app)
      .post('/api/accounting/payments')
      .send({ payment_type: 'inbound', method: 'cash', amount: 50 })

    expect(res.status).toBe(201)
    expect(journalSpy).toHaveBeenCalledTimes(1)
    const { lines } = journalSpy.mock.calls[0][0]
    expect(lines[0]).toMatchObject({ accountId: 1, debit: 50 })   // cash in
    expect(lines[1]).toMatchObject({ accountId: 3, credit: 50 })  // generic AR
  })
})
