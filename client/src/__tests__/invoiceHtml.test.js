// Payment invoice generation - the billing page's "View" link.
//
// The link used to render href={p.invoiceUrl}, but no server response ever
// produced invoiceUrl (GET /billing/current maps payments to id, amount,
// currency, status, description, date only), so React dropped the href and
// clicking did nothing. The invoice is now built client-side by
// buildPaymentInvoiceHtml and document.write()n into an about:blank window
// that inherits our origin: any unescaped payment or tenant value in that
// markup would be stored XSS (see lib/html.js). These tests pin the
// invoice identity, the description fallback, and the escaping at that sink.

import { describe, it, expect } from 'vitest'
import { buildPaymentInvoiceHtml } from '../lib/invoiceHtml'

const labels = {
  title: 'Payment Invoice',
  invoiceNumber: 'Invoice #',
  date: 'Date',
  description: 'Description',
  status: 'Status',
  amount: 'Amount',
  descriptionFallback: 'Subscription payment',
  footer: 'Thank you for choosing Dukkanza',
  print: 'Print',
}

const payment = (overrides = {}) => ({
  id: 42,
  amount: 1500,
  currency: 'EGP',
  status: 'paid',
  description: 'Pro plan renewal',
  date: '2026-10-01T12:00:00.000Z',
  ...overrides,
})

describe('buildPaymentInvoiceHtml', () => {
  it('renders the invoice number, tenant, description and amount', () => {
    const html = buildPaymentInvoiceHtml({ payment: payment(), tenantName: 'Test Store', labels })
    expect(html).toContain('INV-42')
    expect(html).toContain('Invoice #')
    expect(html).toContain('Test Store')
    expect(html).toContain('Pro plan renewal')
    expect(html).toContain('1,500')
    expect(html).toContain('>paid<')
  })

  it('escapes payment and tenant values before they reach the document', () => {
    const html = buildPaymentInvoiceHtml({
      payment: payment({ description: '<script>alert(1)</script>' }),
      tenantName: '<img src=x onerror=alert(2)>',
      labels,
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })

  it('falls back to the subscription label when no description exists', () => {
    const html = buildPaymentInvoiceHtml({ payment: payment({ description: null }), tenantName: 'T', labels })
    expect(html).toContain('Subscription payment')
  })

  it('keeps the print button out of the markup flow as a plain element', () => {
    // The click handler is attached by the opener (BillingPage), never via
    // an inline <script> in the written document.
    const html = buildPaymentInvoiceHtml({ payment: payment(), tenantName: 'T', labels })
    expect(html).toContain('id="print-now"')
    expect(html).not.toContain('<script')
  })
})
