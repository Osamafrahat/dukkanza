// Purchase-order supplier email.
//
// The PO email used to go out through sendCustomEmail — the promotions blast
// sender (promotions@) with an English-only plain-text body flattened into a
// single <p>. These tests pin the replacement: bilingual AR-first + EN, and
// the orders@ category sender, since a PO is transactional mail a supplier
// replies to.

import { describe, it, expect, jest } from '@jest/globals'

const captured = []
const send = jest.fn((payload) => {
  captured.push(payload)
  return Promise.resolve({ data: { id: 'mail-po-1' }, error: null })
})

jest.unstable_mockModule('resend', () => ({
  Resend: jest.fn(() => ({ emails: { send } })),
}))

const { sendPurchaseOrderEmail } = await import('../services/emailService.js')

const PO = {
  order_number: 'PO-1793183963644',
  total: 500,
  expected_date: '2026-10-28',
  notes: null,
}
const ITEMS = [{ product_name: 'جبنة', quantity: 10, unit_price: 50, total: 500 }]
const STORE = { name: 'Metro (test)', address: '', phone: '' }

beforeEach(() => {
  captured.length = 0
  jest.clearAllMocks()
  // The real client only materialises when a key is present (getResendClient
  // reads it at call time), so stub one — the Resend constructor itself is
  // mocked above, so nothing leaves the machine.
  process.env.RESEND_API_KEY = 're_test_key'
  process.env.MAIL_FROM_ORDERS = 'orders@dukkanza.com'
})

afterEach(() => {
  delete process.env.RESEND_API_KEY
  delete process.env.MAIL_FROM_ORDERS
})

describe('sendPurchaseOrderEmail', () => {
  it('sends from the orders@ sender, not the promotions blast sender', async () => {
    await sendPurchaseOrderEmail({
      to: 'supplier@example.com',
      supplierName: 'شركة الفتح',
      po: PO,
      items: ITEMS,
      store: STORE,
    })

    expect(captured).toHaveLength(1)
    expect(captured[0].from).toBe('orders@dukkanza.com')
    expect(captured[0].from).not.toContain('promotions@')
    expect(captured[0].to).toBe('supplier@example.com')
  })

  it('renders both Arabic and English blocks with the order number', async () => {
    await sendPurchaseOrderEmail({
      to: 'supplier@example.com',
      supplierName: 'شركة الفتح',
      po: PO,
      items: ITEMS,
      store: STORE,
    })

    const { html } = captured[0]
    // Arabic block first (product default), English after it.
    expect(html).toContain('dir="rtl"')
    expect(html).toContain('dir="ltr"')
    expect(html.indexOf('dir="rtl"')).toBeLessThan(html.indexOf('dir="ltr"'))

    expect(html).toContain('أمر شراء PO-1793183963644')
    expect(html).toContain('Purchase Order PO-1793183963644')
    expect(html).toContain('إجمالي الطلب: 500')
    expect(html).toContain('Order total: 500')
  })

  it('carries line items, quantity and both unit and line totals', async () => {
    await sendPurchaseOrderEmail({
      to: 'supplier@example.com',
      supplierName: 'شركة الفتح',
      po: PO,
      items: ITEMS,
      store: STORE,
    })

    const { html } = captured[0]
    expect(html).toContain('جبنة')
    expect(html).toContain('Metro (test)')
    // The item row appears once per direction (AR table + EN table).
    expect(html.match(/<td[^>]*>10<\/td>/g)).toHaveLength(2)
    expect(html.match(/<td[^>]*>500<\/td>/g)).toHaveLength(2)
  })

  it('derives a missing line total from quantity x unit price', async () => {
    await sendPurchaseOrderEmail({
      to: 'supplier@example.com',
      supplierName: 'شركة الفتح',
      po: PO,
      items: [{ product_name: 'زبدة', quantity: 3, unit_price: 25 }],
      store: STORE,
    })

    // 3 x 25 = 75, rendered once per direction.
    expect(captured[0].html.match(/<td[^>]*>75<\/td>/g)).toHaveLength(2)
  })

  it('escapes supplier-supplied text instead of injecting it', async () => {
    await sendPurchaseOrderEmail({
      to: 'supplier@example.com',
      supplierName: '<img src=x onerror=alert(1)>',
      po: { ...PO, notes: '<script>alert("x")</script>' },
      items: ITEMS,
      store: STORE,
    })

    const { html } = captured[0]
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('throws when Resend reports an error, so the route can surface it', async () => {
    send.mockImplementationOnce(() => Promise.resolve({ data: null, error: { message: 'bad from' } }))

    await expect(
      sendPurchaseOrderEmail({
        to: 'supplier@example.com',
        supplierName: 'x',
        po: PO,
        items: ITEMS,
        store: STORE,
      })
    ).rejects.toThrow('bad from')
  })
})
