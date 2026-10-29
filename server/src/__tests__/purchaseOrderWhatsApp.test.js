// Purchase-order WhatsApp channel + the modal's "Copy message" body.
//
// Both read the SAME string (route response `message` -> copy button;
// `message` -> sendPurchaseOrderWhatsApp), so one assertion set covers both.
// WhatsApp sends English-only plain text and sendCustomWhatsApp wrapped it in
// a generic title/footer — pinning bilingual body and no duplicate header.

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'

// email.js pulls in middleware/auth.js, which process.exit(1)s at import time
// without a secret (same trick authorization.test.js uses).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

// ---------------------------------------------------------------------------
// Controllable supabase mock (table-scripted: queue first, then default)
// ---------------------------------------------------------------------------

const queues = new Map()
const defaults = new Map()

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
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range', 'gte', 'lte', 'delete']) {
    chain[m] = jest.fn(() => chain)
  }
  chain.single = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.maybeSingle = jest.fn(() => Promise.resolve(nextResult(table)))
  chain.then = (resolve, reject) => Promise.resolve(nextResult(table)).then(resolve, reject)
  return chain
}

jest.unstable_mockModule('../db/supabase.js', () => ({
  default: { from: (table) => makeFrom(table) },
  supabaseStorage: { from: (table) => makeFrom(table) },
  withTimeout: (p) => p,
}))

// Capture what the route hands each channel instead of sending anything.
const waSpy = jest.fn((args) => Promise.resolve([
  { phone: '01239749147', success: true, link: 'https://wa.me/01239749147?text=stub', message: args.message },
]))
const emailSpy = jest.fn(() => Promise.resolve({ data: { id: 'mail-1' } }))

jest.unstable_mockModule('../services/whatsappService.js', () => ({
  sendPromotionWhatsApp: jest.fn(),
  sendPurchaseOrderWhatsApp: waSpy,
  sendCustomWhatsApp: jest.fn(),
}))
jest.unstable_mockModule('../services/emailService.js', () => ({
  sendPromotionEmail: jest.fn(),
  sendPurchaseOrderEmail: emailSpy,
  sendCustomEmail: jest.fn(),
}))

const { default: emailRouter } = await import('../routes/email.js')
const { generateToken } = await import('../middleware/auth.js')

const app = express()
app.use(express.json())
app.use('/api/notifications', emailRouter)

// The route applies authenticateToken itself (not just the mount in
// index.js), so exercise the real middleware with a genuinely signed token.
const TOKEN = generateToken({
  id: 1, username: 'tester', role: 'MANAGER', tenant_id: 1, session_token: 'sess-1',
})

const PO = {
  id: 15,
  tenant_id: 1,
  order_number: 'PO-1793183963644',
  total: 500,
  expected_date: '2026-10-28',
  notes: null,
  supplier_id: 9,
  suppliers: { name: 'شركة الفتح', contact_person: 'أحمد', email: 'supplier@example.com', phone: '01239749147' },
}
const ITEMS = [{ product_name: 'جبنة', quantity: 10, unit_price: 50, total: 500 }]
const TENANT = { name: 'Metro (test)', address: '', phone: '' }

function prime() {
  // authenticateToken reads this row and compares session_token to the JWT.
  setDefault('users', { data: { session_token: 'sess-1', is_active: true }, error: null })
  setDefault('purchase_orders', { data: PO, error: null })
  setDefault('purchase_order_items', { data: ITEMS, error: null })
  setDefault('tenants', { data: TENANT, error: null })
}

beforeEach(() => {
  queues.clear()
  defaults.clear()
  jest.clearAllMocks()
  prime()
})

const sendWhatsApp = () =>
  request(app)
    .post('/api/notifications/purchase-order')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send({ purchase_order_id: 15, send_whatsapp: true })

describe('purchase-order WhatsApp message', () => {
  it('carries both Arabic and English, Arabic first', async () => {
    const res = await sendWhatsApp()
    expect(res.status).toBe(200)

    const msg = res.body.message
    expect(msg).toContain('أمر شراء PO-1793183963644')
    expect(msg).toContain('Purchase Order PO-1793183963644')
    expect(msg.indexOf('أمر شراء')).toBeLessThan(msg.indexOf('Purchase Order'))
  })

  it('renders the expected date in both locales', async () => {
    const res = await sendWhatsApp()
    const msg = res.body.message

    expect(msg).toContain('التاريخ المتوقع:')
    expect(msg).toContain('Expected date:')
    // Node renders ar-EG with Arabic-Indic digits (٢٨‏/١٠‏/٢٠٢٦) and en-GB
    // with Latin ones (28/10/2026) — assert each side keeps its own digits.
    expect(msg).toMatch(/التاريخ المتوقع: .+٢٠٢٦/)
    expect(msg).toMatch(/Expected date: \d{2}\/\d{2}\/2026/)
  })

  it('keeps each line item on one row with paired labels', async () => {
    const res = await sendWhatsApp()
    const msg = res.body.message

    const line = msg.split('\n').find((l) => l.includes('جبنة'))
    expect(line).toBeDefined()
    expect(line).toContain('الكمية/Qty: 10')
    expect(line).toContain('الوحدة/Unit: 50')
    expect(line).toContain('الإجمالي/Total: 500')
    // One row, not two — a 20-line order must stay readable on a phone.
    expect(msg.split('\n').filter((l) => l.includes('جبنة'))).toHaveLength(1)
  })

  it('states the order total in both languages', async () => {
    const res = await sendWhatsApp()
    const msg = res.body.message

    expect(msg).toContain('إجمالي الطلب: 500')
    expect(msg).toContain('Order total: 500')
  })

  it('appends the bilingual store block', async () => {
    const res = await sendWhatsApp()
    const msg = res.body.message

    expect(msg).toContain('معلومات المتجر / Store information:')
    expect(msg).toContain('المتجر/Store: Metro (test)')
  })

  it('hands the composed message to WhatsApp unwrapped (no duplicate header)', async () => {
    const res = await sendWhatsApp()

    expect(waSpy).toHaveBeenCalledTimes(1)
    const arg = waSpy.mock.calls[0][0]
    // The whole body goes through verbatim: the modal copies it, and the old
    // sendCustomWhatsApp title/footer would repeat the header + store name.
    expect(arg.message).toBe(res.body.message)
    expect(arg.title).toBeUndefined()
    expect(arg.storeName).toBeUndefined()
  })

  it('does not send email when only WhatsApp is requested', async () => {
    await sendWhatsApp()
    expect(emailSpy).not.toHaveBeenCalled()
  })

  it('still reports the supplier phone channel as skipped when absent', async () => {
    setDefault('purchase_orders', {
      data: { ...PO, suppliers: { ...PO.suppliers, phone: null } },
      error: null,
    })

    const res = await sendWhatsApp()
    expect(res.status).toBe(200)
    expect(res.body.results.whatsapp[0]).toMatchObject({
      success: false,
      reason: 'no_supplier_phone',
    })
  })
})
