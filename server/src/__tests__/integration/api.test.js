import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'

const BASE = process.env.TEST_API_URL || 'http://localhost:3001'

describe('Health & Public Endpoints', () => {
  it('GET /api/health returns ok', async () => {
    const res = await fetch(`${BASE}/api/health`)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.status).toBe('ok')
    expect(data.timestamp).toBeDefined()
  })

  it('GET /api/banners returns array', async () => {
    const res = await fetch(`${BASE}/api/banners`)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  it('GET /api/nonexistent returns 404', async () => {
    const res = await fetch(`${BASE}/api/nonexistent`)
    expect(res.status).toBe(404)
  })
})

describe('Auth Endpoints', () => {
  it('POST /api/auth/login without body returns error', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    expect(res.status).not.toBe(200)
    expect(data.error).toBeDefined()
  })

  it('POST /api/auth/login with invalid credentials fails', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nonexistent_user_xyz', password: 'wrongpass' }),
    })
    expect(res.status).not.toBe(200)
  })
})

describe('Protected Endpoints', () => {
  it('GET /api/products without token returns 401', async () => {
    const res = await fetch(`${BASE}/api/products`)
    expect(res.status).toBe(401)
  })

  it('GET /api/orders without token returns 401', async () => {
    const res = await fetch(`${BASE}/api/orders`)
    expect(res.status).toBe(401)
  })

  it('GET /api/users without token returns 401', async () => {
    const res = await fetch(`${BASE}/api/users`)
    expect(res.status).toBe(401)
  })

  it('GET /api/customers without token returns 401', async () => {
    const res = await fetch(`${BASE}/api/customers`)
    expect(res.status).toBe(401)
  })

  it('GET /api/employees without token returns 401', async () => {
    const res = await fetch(`${BASE}/api/employees`)
    expect(res.status).toBe(401)
  })

  it('GET /api/commissions without token returns 401', async () => {
    const res = await fetch(`${BASE}/api/commissions`)
    expect(res.status).toBe(401)
  })

  it('GET /api/products with fake token returns 401/403', async () => {
    const res = await fetch(`${BASE}/api/products`, {
      headers: { Authorization: 'Bearer fake-invalid-token-xyz' },
    })
    expect([401, 403]).toContain(res.status)
  })
})

describe('Rate Limiting', () => {
  it('auth endpoint accepts first request', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // loginLimiter latches this IP after 3 rejected credentials, and the
        // OTHER tests in this suite supply several of them (against a shared
        // server, possibly from a parallel worker). A dedicated source IP
        // keeps "first request" literally first instead of order-dependent.
        'X-Forwarded-For': '203.0.113.10',
      },
      body: JSON.stringify({ username: 'test', password: 'test' }),
    })
    expect(res.status).not.toBe(429)
  })
})
