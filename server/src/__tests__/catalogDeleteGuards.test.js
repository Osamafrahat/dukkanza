// Catalog delete guards (services + service plans).
//
// Subscriptions reference both tables with ON DELETE SET NULL, so deleting a
// referenced row used to silently blank every subscription that pointed at
// it (the subscriptions table just shows '-'). The guard answers 409 with a
// count and points at the is_active toggle instead. The empty-reference path
// must keep deleting — the guard can't become a lockout.

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon'

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

function makeFrom(table) {
  const chain = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range', 'gte', 'lte', 'neq', 'or', 'update', 'insert']) {
    chain[m] = jest.fn(() => chain)
  }
  chain.delete = jest.fn(() => chain)
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

const { default: servicePlansRouter } = await import('../routes/servicePlans.js')
const { default: servicesRouter } = await import('../routes/services.js')

const app = express()
app.use(express.json())

// These routers call authenticateToken themselves, so the requests carry a
// real bearer token (no sessionToken → the rotation checks stay inert).
const token = jwt.sign({ id: 1, role: 'MANAGER', tenantId: 1 }, process.env.JWT_SECRET)
const BEARER = `Bearer ${token}`

// Stand in for index.js's authenticateToken mounts; MANAGER short-circuits
// requirePermission without touching the database.
const asUser = (req, _res, next) => {
  req.user = { id: 1, tenantId: 1, role: 'MANAGER', permissions: [] }
  next()
}
app.use('/api/service-plans', asUser, servicePlansRouter)
app.use('/api/services', asUser, servicesRouter)

beforeEach(() => {
  queues.clear()
  jest.clearAllMocks()
  // authenticateToken resolves the caller's row before every request.
  enqueue('users', { data: { session_token: null, is_active: true }, error: null })
})

const callsFor = (table) => fromSpy.mock.calls.filter((c) => c[0] === table).length

describe('DELETE /service-plans/:id', () => {
  it('409s with a count while subscriptions reference the plan', async () => {
    enqueue('subscriptions', { data: [{ id: 1 }, { id: 2 }], error: null })

    const res = await request(app).delete('/api/service-plans/5').set('Authorization', BEARER)

    expect(res.status).toBe(409)
    expect(res.body.subscription_count).toBe(2)
    expect(res.body.error).toMatch(/deactivate/)
    // The delete never reaches the table.
    expect(callsFor('service_plans')).toBe(0)
  })

  it('deletes normally when nothing references the plan', async () => {
    enqueue('subscriptions', { data: [], error: null })
    enqueue('service_plans', { data: null, error: null })

    const res = await request(app).delete('/api/service-plans/5').set('Authorization', BEARER)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
  })
})

describe('DELETE /services/:id', () => {
  it('409s with a count while subscriptions reference the service', async () => {
    enqueue('subscriptions', { data: [{ id: 3 }], error: null })

    const res = await request(app).delete('/api/services/8').set('Authorization', BEARER)

    expect(res.status).toBe(409)
    expect(res.body.subscription_count).toBe(1)
    expect(callsFor('services')).toBe(0)
  })

  it('deletes normally when nothing references the service', async () => {
    enqueue('subscriptions', { data: [], error: null })
    enqueue('services', { data: null, error: null })

    const res = await request(app).delete('/api/services/8').set('Authorization', BEARER)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
  })
})
