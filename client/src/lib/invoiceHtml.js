import { escapeHtml } from './html'

/**
 * Build a self-contained printable invoice document for one subscription
 * payment (tenant_payments row as mapped by GET /api/billing/current).
 *
 * Pure and string-only so it is unit-testable. The caller opens a blank
 * window and document.write()s the result - the same print-window pattern
 * ReceiptModal/BarcodePrinter use - then attaches the print handler from
 * the parent side (no <script> inside the written markup).
 *
 * Every interpolated value passes through escapeHtml at this sink:
 * description is user-controlled, and about:blank inherits our origin,
 * so an unescaped value there would be stored XSS (see lib/html.js).
 * Labels come from the caller's t() so EN/AR stay in translations.js.
 *
 * Amounts display ج.م like the payment-history table next to this link -
 * the schema's currency default ('USD') is not what the app bills in, and
 * showing two currencies for the same number would be worse than matching
 * the row the user just clicked.
 *
 * @param {{
 *   payment: { id: *, amount: *, status: *, description: *, date: * },
 *   tenantName: string,
 *   labels: { title: string, invoiceNumber: string, date: string,
 *             description: string, status: string, amount: string,
 *             descriptionFallback: string, footer: string, print: string },
 *   dir?: 'ltr' | 'rtl',
 * }} args
 * @returns {string} complete HTML document
 */
export function buildPaymentInvoiceHtml({ payment, tenantName, labels, dir = 'ltr' }) {
  const amount = Number(payment.amount || 0)
  const parsedDate = payment.date ? new Date(payment.date) : null
  const dateText = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleDateString() : ''
  const description = payment.description || labels.descriptionFallback || ''
  const status = String(payment.status || '')
  const invoiceNumber = `INV-${payment.id}`

  return `<!DOCTYPE html>
<html dir="${dir}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(labels.title)} ${escapeHtml(invoiceNumber)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #f3f4f6; color: #111827; padding: 32px; }
  .sheet { max-width: 640px; margin: 0 auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 40px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
  .brand { font-size: 22px; font-weight: 800; color: #2563eb; }
  .tenant { font-size: 13px; color: #6b7280; margin-top: 4px; }
  .title { font-size: 18px; font-weight: 700; }
  .number { font-size: 13px; color: #6b7280; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: start; padding: 10px 8px; font-size: 14px; border-bottom: 1px solid #f3f4f6; }
  th { color: #6b7280; font-weight: 600; font-size: 12px; text-transform: uppercase; }
  tr.total td { font-weight: 800; font-size: 16px; border-top: 2px solid #e5e7eb; border-bottom: 0; }
  .status { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #dcfce7; color: #166534; font-size: 12px; font-weight: 700; text-transform: uppercase; }
  .footer { font-size: 12px; color: #6b7280; text-align: center; margin-top: 24px; }
  .print-btn { display: block; margin: 24px auto 0; padding: 10px 24px; font-size: 14px; font-weight: 700; color: #fff; background: #2563eb; border: 0; border-radius: 8px; cursor: pointer; }
  .print-btn:hover { background: #1d4ed8; }
  @media print { body { background: #fff; padding: 0; } .sheet { border: 0; padding: 0; } .print-btn { display: none; } }
</style>
</head>
<body>
  <div class="sheet">
    <div class="head">
      <div>
        <div class="brand">Dukkanza</div>
        <div class="tenant">${escapeHtml(tenantName)}</div>
      </div>
      <div style="text-align: end">
        <div class="title">${escapeHtml(labels.title)}</div>
        <div class="number">${escapeHtml(labels.invoiceNumber)} ${escapeHtml(invoiceNumber)}</div>
      </div>
    </div>
    <table>
      <tbody>
        <tr><th>${escapeHtml(labels.date)}</th><td>${escapeHtml(dateText)}</td></tr>
        <tr><th>${escapeHtml(labels.description)}</th><td>${escapeHtml(description)}</td></tr>
        <tr><th>${escapeHtml(labels.status)}</th><td><span class="status">${escapeHtml(status)}</span></td></tr>
        <tr class="total"><th>${escapeHtml(labels.amount)}</th><td>${amount.toLocaleString()} ج.م</td></tr>
      </tbody>
    </table>
    <div class="footer">${escapeHtml(labels.footer)}</div>
    <button class="print-btn" id="print-now" type="button">${escapeHtml(labels.print)}</button>
  </div>
</body>
</html>`
}

export default buildPaymentInvoiceHtml
