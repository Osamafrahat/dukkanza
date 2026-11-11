// Signup contract: required email, optional phone.
//
// Why this file exists: the phone field is new, so its contract (stored in
// users.phone in the same '+20...' shape the app writes everywhere, blank
// stays NULL, malformed rejected up front) is pinned here. Email is a hard
// requirement by product decision — the tests below pin that a missing OR
// malformed email 400s before any write, and that a valid one is stored
// normalized and welcome-mailed. Everything else in the route is mocked to
// the two tables signup actually writes.

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon'

// Table-scripted supabase mock + write log (payloads captured at call time,
// results resolved at await time) — the harness from csvImport.test.js.
const queues = new Map()

function enqueue(table, ...results) {
  if (!queues.has(table)) queues.set(table, [])
  queues.get(table).push(...results)
}
function nextResult(table) {
  const q = queues.get(table)
  if (q && q.length > 0) return q.shift()
  return { data: null, error: null }
}

const writes = []

function makeFrom(table) {
  const chain = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range', 'gte', 'lte', 'delete', 'update']) {
    chain[m] = jest.fn(() => chain)
  }
  chain.insert = jest.fn((payload) => { writes.push({ table, payload }); return chain })
  chain.single = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.maybeSingle = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.then = (resolve, reject) => Promise.resolve(nextResult(table)).then(resolve, reject)
  return chain
}

const fromSpy = jest.fn((table) => makeFrom(table))

jest.unstable_mockModule('../db/supabase.js', () => ({
  default: { from: fromSpy },
  supabaseStorage: { from: (table) => makeFrom(table) },
  withTimeout: (p) => p,
}))

// Side-effecting collaborators: asserted directly, never executed.
jest.unstable_mockModule('../middleware/auth.js', () => ({
  authenticateToken: (_req, _res, next) => next(),
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
  requireManager: (_req, _res, next) => next(),
  requireSuperAdmin: () => (_req, _res, next) => next(),
  generateToken: () => 'test-token',
  generateSessionToken: () => 'test-session',
}))

const logActivitySpy = jest.fn()
jest.unstable_mockModule('../middleware/activityLogger.js', () => ({
  logActivity: logActivitySpy,
}))

const sendWelcomeEmailSpy = jest.fn(async () => undefined)
jest.unstable_mockModule('../services/emailService.js', () => ({
  sendWelcomeEmail: sendWelcomeEmailSpy,
}))

const notifyOperatorSpy = jest.fn(async () => undefined)
jest.unstable_mockModule('../services/telegramNotify.js', () => ({
  notifyOperator: notifyOperatorSpy,
}))

const ensureDefaultBranchSpy = jest.fn(async () => undefined)
jest.unstable_mockModule('../services/branches.js', () => ({
  ensureDefaultBranch: ensureDefaultBranchSpy,
}))

jest.unstable_mockModule('../services/passwordReset.js', () => ({
  issueResetToken: jest.fn(async () => ({ token: 'reset-token' })),
  consumeResetToken: jest.fn(async () => ({ user: null })),
}))

const { authRouter } = await import('../routes/auth.js')

const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)

// Signup's own write order: users.username lookup -> users.email lookup ->
// tenants slug lookup -> tenants insert -> users insert -> seeding.
const queueSignup = ({ username = 'jane', tenantId = 5, userId = 11 } = {}) => {
  enqueue('users', { data: null, error: null }) // username free
  enqueue('users', { data: null, error: null }) // email free
  enqueue('tenants', { data: null, error: null }) // slug free
  enqueue('tenants', { data: { id: tenantId }, error: null })
  enqueue('users', {
    data: { id: userId, username, full_name: 'Full Name', email: null, role: 'MANAGER', tenant_id: tenantId },
    error: null,
  })
}

const baseBody = { storeName: 'Test Store', username: 'jane', password: 'Abcdefg1', fullName: 'Full Name', email: 'jane@example.com' }

const usersInserts = () => writes.filter((w) => w.table === 'users')

beforeEach(() => {
  queues.clear()
  writes.length = 0
  jest.clearAllMocks()
})

describe('POST /api/auth/signup — email required, phone optional', () => {
  it('creates the store with the required email and no phone', async () => {
    queueSignup()

    const res = await request(app).post('/api/auth/signup').send(baseBody)

    expect(res.status).toBe(201)
    expect(res.body.user).toMatchObject({ username: 'jane', role: 'MANAGER' })
    expect(usersInserts()).toHaveLength(1)
    expect(usersInserts()[0].payload).toMatchObject({ email: 'jane@example.com', phone: null })
    expect(sendWelcomeEmailSpy).toHaveBeenCalledTimes(1)
    expect(sendWelcomeEmailSpy.mock.calls[0][0]).toMatchObject({ to: 'jane@example.com' })
    expect(notifyOperatorSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects a missing email before touching the database', async () => {
    const { email: _omitted, ...withoutEmail } = baseBody
    const res = await request(app).post('/api/auth/signup').send(withoutEmail)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Valid email is required')
    expect(writes).toHaveLength(0)
  })

  it('stores the phone in the canonical +<code><digits> shape and emails the welcome mail', async () => {
    queueSignup({ username: 'bob', tenantId: 6, userId: 12 })

    const res = await request(app).post('/api/auth/signup').send({
      ...baseBody,
      username: 'bob',
      email: '  Bob@Example.COM ',
      phone: '+201012345678',
    })

    expect(res.status).toBe(201)
    expect(usersInserts()[0].payload).toMatchObject({
      email: 'bob@example.com', // normalizeEmail applied
      phone: '+201012345678',
    })
    expect(sendWelcomeEmailSpy).toHaveBeenCalledTimes(1)
    expect(sendWelcomeEmailSpy.mock.calls[0][0]).toMatchObject({ to: 'bob@example.com' })
  })

  it('rejects a malformed phone before touching the database', async () => {
    for (const phone of ['abc', '12345', '+20123456789012345']) {
      const res = await request(app).post('/api/auth/signup').send({ ...baseBody, phone })
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Valid phone number required')
    }
    expect(writes).toHaveLength(0)
  })

  it('rejects a malformed email', async () => {
    const res = await request(app).post('/api/auth/signup').send({ ...baseBody, email: 'not-an-email' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Valid email is required')
    expect(writes).toHaveLength(0)
  })

  it('keeps the hard requirements (username taken, weak password) intact', async () => {
    enqueue('users', { data: { id: 99 }, error: null }) // username exists
    const taken = await request(app).post('/api/auth/signup').send(baseBody)
    expect(taken.status).toBe(400)
    expect(taken.body.error).toBe('Username already exists')

    const weak = await request(app).post('/api/auth/signup').send({ ...baseBody, username: 'other', password: 'short' })
    expect(weak.status).toBe(400)
    expect(weak.body.error).toMatch(/at least 8 characters/)
  })
})
