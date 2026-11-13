// Accounting core routes: delete guards, journal protections, filters and
// the report math.
//
// Why this file exists:
//   1. DELETE /accounts/:id must 409 (with entry_count) when journal lines
//      reference the account — a 400 conflated "in use" with a malformed
//      request, so the client could never show the count-bearing message;
//   2. trial-balance totals must be TYPE-aware: a negative asset balance is
//      an overdrawn credit and belongs on the CREDIT side (and vice versa).
//      The old sign-only filter dropped every negative from BOTH sides, so
//      one overdrawn account made 0 = 0 look "balanced" (or mis-balanced);
//   3. journal filters (date range / source type / search) and the
//      posted-entry delete protection are easy to regress silently.

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon'

// ---------------------------------------------------------------------------
// Table-scripted supabase mock (same harness as payments.test.js)
// ---------------------------------------------------------------------------

const queues = new Map()
const createdChains = []

function enqueue(table, ...results) {
  if (!queues.has(table)) queues.set(table, [])
  queues.get(table).push(...results)
}
function nextResult(table) {
  const q = queues.get(table)
  if (q && q.length > 0) return q.shift()
  return { data: null, error: null }
}

function makeFrom(table) {
  const chain = {}
  // 'or' is required: GET /journals search builds a PostgREST or-filter.
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range', 'gte', 'lte', 'neq', 'update', 'insert', 'delete', 'or']) {
    chain[m] = jest.fn(() => chain)
  }
  chain.single = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.maybeSingle = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.then = (resolve, reject) => Promise.resolve(nextResult(table)).then(resolve, reject)
  createdChains.push({ table, chain })
  return chain
}

const fromSpy = jest.fn((table) => makeFrom(table))

jest.unstable_mockModule('../db/supabase.js', () => ({
  default: { from: fromSpy },
  supabaseStorage: { from: (table) => makeFrom(table) },
  withTimeout: (p) => p,
}))

// The three routers declare authenticateToken/requirePermission inline (or
// import createJournalEntry/seedChartOfAccounts), so both must be stubbed:
// the real middleware would 401 without a JWT, and the real engine would hit
// the DB through the queue and steal enqueued results.
jest.unstable_mockModule('../middleware/auth.js', () => ({
  authenticateToken: (_req, _res, next) => next(),
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
  requireManager: (_req, _res, next) => next(),
  requireSuperAdmin: () => (_req, _res, next) => next(),
  generateToken: () => 'test-token',
  generateSessionToken: () => 'test-session',
}))

jest.unstable_mockModule('../services/accountingEngine.js', () => ({
  createJournalEntry: jest.fn(async () => ({ id: 77, entry_number: 'JE-77' })),
  seedChartOfAccounts: jest.fn(async () => undefined),
  reverseJournalEntry: jest.fn(async () => ({ id: 78, entry_number: 'JE-78' })),
  postStockReceiveJournal: jest.fn(async () => ({ id: 79 })),
}))

const { accountsRouter } = await import('../routes/accounts.js')
const { journalsRouter } = await import('../routes/journals.js')
const { accountingReportsRouter } = await import('../routes/accountingReports.js')
const { createJournalEntry } = await import('../services/accountingEngine.js')

const app = express()
app.use(express.json())

// Stand in for index.js's authenticateToken + activityLogger mounts.
const asUser = (req, _res, next) => {
  req.user = { id: 1, tenantId: 1, role: 'MANAGER' }
  req.branchId = null
  req.logActivity = jest.fn()
  next()
}
app.use('/accounts', asUser, accountsRouter)
app.use('/journals', asUser, journalsRouter)
app.use('/reports', asUser, accountingReportsRouter)

const lastChain = (table) => createdChains.filter((c) => c.table === table).pop()?.chain
const chainCount = (table) => createdChains.filter((c) => c.table === table).length

beforeEach(() => {
  queues.clear()
  createdChains.length = 0
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// GET /journals — filters
// ---------------------------------------------------------------------------

describe('GET /journals — filters', () => {
  it('applies date range, source type and sanitized search', async () => {
    enqueue('journal_entries', {
      data: [{ id: 1, entry_number: 'JE-1', date: '2026-01-15', source_type: 'order' }],
      error: null,
      count: 1,
    })

    const res = await request(app)
      .get('/journals')
      .query({ date_from: '2026-01-01', date_to: '2026-01-31', source_type: 'order', search: 'JE-1' })

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.data).toHaveLength(1)

    const c = lastChain('journal_entries')
    expect(c.gte).toHaveBeenCalledWith('date', '2026-01-01')
    expect(c.lte).toHaveBeenCalledWith('date', '2026-01-31')
    expect(c.eq).toHaveBeenCalledWith('source_type', 'order')
    // sanitizeSearch strips PostgREST metacharacters (%(),.) before the or().
    expect(c.or).toHaveBeenCalledWith(
      'description.ilike.%JE-1%,entry_number.ilike.%JE-1%,reference.ilike.%JE-1%'
    )
  })

  it('skips optional filters that were not provided', async () => {
    enqueue('journal_entries', { data: [], error: null, count: 0 })

    const res = await request(app).get('/journals')

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(0)
    const c = lastChain('journal_entries')
    expect(c.gte).not.toHaveBeenCalled()
    expect(c.lte).not.toHaveBeenCalled()
    expect(c.or).not.toHaveBeenCalled()
    // source_type is only eq'd when present — the always-on tenant filter
    // must be the ONLY eq call.
    expect(c.eq).toHaveBeenCalledTimes(1)
    expect(c.eq).toHaveBeenCalledWith('tenant_id', 1)
  })
})

// ---------------------------------------------------------------------------
// DELETE /journals/:id — posted-entry protection
// ---------------------------------------------------------------------------

describe('DELETE /journals/:id', () => {
  it('refuses to delete a posted entry (reverse instead)', async () => {
    enqueue('journal_entries', { data: { is_posted: true }, error: null })

    const res = await request(app).delete('/journals/5')

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Reverse instead')
    // The delete never ran — only the single() fetch created a chain.
    expect(chainCount('journal_entries')).toBe(1)
  })

  it('deletes a draft entry', async () => {
    enqueue('journal_entries', { data: { is_posted: false }, error: null })
    enqueue('journal_entries', { data: null, error: null })

    const res = await request(app).delete('/journals/5')

    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Entry deleted')
  })
})

// ---------------------------------------------------------------------------
// POST /journals + reverse — engine hand-off
// ---------------------------------------------------------------------------

describe('POST /journals', () => {
  it('rejects an entry with fewer than 2 lines before touching the engine', async () => {
    const res = await request(app)
      .post('/journals')
      .send({ description: 'x', lines: [{ accountId: 1, debit: 1, credit: 0 }] })

    expect(res.status).toBe(400)
    expect(createJournalEntry).not.toHaveBeenCalled()
  })
})

describe('POST /journals/:id/reverse', () => {
  it('swaps debits and credits into a reversal entry', async () => {
    enqueue('journal_entries', {
      data: {
        id: 5,
        entry_number: 'JE-5',
        description: 'Sale',
        is_reversed: false,
        journal_entry_lines: [{ account_id: 1, debit: 100, credit: 0 }],
      },
      error: null,
    })
    enqueue('journal_entries', { data: { id: 99, error: null }, error: null })

    const res = await request(app).post('/journals/5/reverse')

    expect(res.status).toBe(200)
    expect(res.body.entry_number).toBe('JE-77')
    expect(createJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'reversal',
        sourceId: 5,
        lines: [expect.objectContaining({ debit: 0, credit: 100 })],
      }),
      1
    )
  })

  it('404s when the original entry does not exist', async () => {
    enqueue('journal_entries', { data: null, error: { message: 'not found' } })

    const res = await request(app).post('/journals/404/reverse')

    expect(res.status).toBe(404)
    expect(createJournalEntry).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// DELETE /accounts/:id — in-use guard
// ---------------------------------------------------------------------------

describe('DELETE /accounts/:id', () => {
  it('409s with entry_count when journal lines reference the account', async () => {
    enqueue('journal_entry_lines', { data: null, error: null, count: 3 })

    const res = await request(app).delete('/accounts/9')

    expect(res.status).toBe(409)
    expect(res.body.entry_count).toBe(3)
    expect(res.body.error).toContain('3 journal line')
    // The accounts delete never ran.
    expect(chainCount('accounts')).toBe(0)
  })

  it('deletes an unreferenced account', async () => {
    enqueue('journal_entry_lines', { data: null, error: null, count: 0 })
    enqueue('accounts', { data: null, error: null })

    const res = await request(app).delete('/accounts/9')

    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Account deleted')
    expect(lastChain('accounts').delete).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// PUT /accounts/:id — is_active whitelist
// ---------------------------------------------------------------------------

describe('PUT /accounts/:id', () => {
  it('accepts is_active and ignores fields outside the whitelist', async () => {
    enqueue('accounts', { data: { id: 9, is_active: false }, error: null })

    const res = await request(app)
      .put('/accounts/9')
      .send({ is_active: false, balance: 999 })

    expect(res.status).toBe(200)
    const updateArg = lastChain('accounts').update.mock.calls[0][0]
    expect(updateArg).toEqual(expect.objectContaining({ is_active: false }))
    expect(updateArg).not.toHaveProperty('balance')
    // updated_at is stamped on every update.
    expect(updateArg).toHaveProperty('updated_at')
  })

  it('leaves is_active untouched when the body omits it', async () => {
    enqueue('accounts', { data: { id: 9, name: 'Renamed' }, error: null })

    const res = await request(app)
      .put('/accounts/9')
      .send({ name: 'Renamed' })

    expect(res.status).toBe(200)
    const updateArg = lastChain('accounts').update.mock.calls[0][0]
    expect(updateArg).toHaveProperty('name', 'Renamed')
    expect(updateArg).not.toHaveProperty('is_active')
  })
})

// ---------------------------------------------------------------------------
// GET /reports/trial-balance — type-aware totals
// ---------------------------------------------------------------------------

describe('GET /reports/trial-balance', () => {
  it('puts an overdrawn asset on the credit side instead of dropping it', async () => {
    enqueue('accounts', {
      data: [{ id: 1, code: '1010', name: 'Cash', account_type: 'asset', balance: -50 }],
      error: null,
    })

    const res = await request(app).get('/reports/trial-balance')

    expect(res.status).toBe(200)
    // The old sign-only filter reported 0 = 0 (falsely "balanced") here.
    expect(res.body.totalDebit).toBe(0)
    expect(res.body.totalCredit).toBe(50)
    expect(res.body.isBalanced).toBe(false)
    // The row still lands in its type group for the table.
    expect(res.body.accounts.asset).toHaveLength(1)
  })

  it('assigns each balance to the side implied by its account type', async () => {
    enqueue('accounts', {
      data: [
        { id: 1, code: '1010', name: 'Cash', account_type: 'asset', balance: -50 },
        { id: 2, code: '2010', name: 'AP', account_type: 'liability', balance: -30 },
        { id: 3, code: '3010', name: 'Equity', account_type: 'equity', balance: 200 },
        { id: 4, code: '4010', name: 'Sales', account_type: 'revenue', balance: 80 },
        { id: 5, code: '5010', name: 'Rent', account_type: 'expense', balance: 60 },
      ],
      error: null,
    })

    const res = await request(app).get('/reports/trial-balance')

    expect(res.status).toBe(200)
    // debit: liability -30 + expense 60. credit: asset -50 + equity 200 + revenue 80.
    expect(res.body.totalDebit).toBe(90)
    expect(res.body.totalCredit).toBe(330)
    expect(res.body.isBalanced).toBe(false)
  })

  it('reports balanced when type-aware totals match', async () => {
    enqueue('accounts', {
      data: [
        { id: 1, code: '1010', name: 'Cash', account_type: 'asset', balance: 100 },
        { id: 2, code: '2010', name: 'AP', account_type: 'liability', balance: 100 },
      ],
      error: null,
    })

    const res = await request(app).get('/reports/trial-balance')

    expect(res.status).toBe(200)
    expect(res.body.totalDebit).toBe(100)
    expect(res.body.totalCredit).toBe(100)
    expect(res.body.isBalanced).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// GET /reports/account-ledger — running balance
// ---------------------------------------------------------------------------

describe('GET /reports/account-ledger', () => {
  it('walks an asset account oldest-first: debit adds, credit subtracts', async () => {
    // The route orders date DESC, so the newest line comes back first and
    // the handler reverses it before accumulating.
    enqueue('journal_entry_lines', {
      data: [
        { id: 21, debit: 0, credit: 40, journal_entries: { entry_number: 'JE-2', date: '2026-01-02' } },
        { id: 22, debit: 100, credit: 0, journal_entries: { entry_number: 'JE-1', date: '2026-01-01' } },
      ],
      error: null,
    })
    enqueue('accounts', { data: { id: 7, code: '1010', account_type: 'asset', balance: 60 }, error: null })

    const res = await request(app).get('/reports/account-ledger/7')

    expect(res.status).toBe(200)
    expect(res.body.account.code).toBe('1010')
    // Response stays newest-first, each row carrying the balance AFTER it.
    expect(res.body.transactions.map((t) => t.balance)).toEqual([60, 100])
  })

  it('walks a credit-normal account: credit adds, debit subtracts', async () => {
    enqueue('journal_entry_lines', {
      data: [
        { id: 31, debit: 30, credit: 0, journal_entries: { entry_number: 'JE-4', date: '2026-01-02' } },
        { id: 32, debit: 0, credit: 200, journal_entries: { entry_number: 'JE-3', date: '2026-01-01' } },
      ],
      error: null,
    })
    enqueue('accounts', { data: { id: 8, code: '2010', account_type: 'liability', balance: 170 }, error: null })

    const res = await request(app).get('/reports/account-ledger/8')

    expect(res.status).toBe(200)
    expect(res.body.transactions.map((t) => t.balance)).toEqual([170, 200])
  })
})

// ---------------------------------------------------------------------------
// GET /reports/profit-loss — date range
// ---------------------------------------------------------------------------

describe('GET /reports/profit-loss', () => {
  it('passes date_from/date_to to the line query', async () => {
    enqueue('journal_entry_lines', { data: [], error: null })

    const res = await request(app)
      .get('/reports/profit-loss')
      .query({ date_from: '2026-01-01', date_to: '2026-01-31' })

    expect(res.status).toBe(200)
    expect(res.body.totalRevenue).toBe(0)
    const c = lastChain('journal_entry_lines')
    expect(c.gte).toHaveBeenCalledWith('journal_entries.date', '2026-01-01')
    expect(c.lte).toHaveBeenCalledWith('journal_entries.date', '2026-01-31')
  })
})
