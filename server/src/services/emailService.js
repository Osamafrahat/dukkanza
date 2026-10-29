import { Resend } from 'resend'

let resendClient = null

function getResendClient() {
  if (!resendClient && process.env.RESEND_API_KEY) {
    resendClient = new Resend(process.env.RESEND_API_KEY)
  }
  return resendClient
}

// Split senders: each mail category gets its own From address on the
// verified sending domain (support@, billing@, hello@, promotions@, ...).
// MAIL_FROM_<CATEGORY> overrides one category (e.g. MAIL_FROM_BILLING=
// billing@dukkanza.com); otherwise the local part is derived from the
// SMTP_FROM domain, so adding or renaming a sender needs no code change.
// Falls back to the Resend test sender when nothing is configured.
export function senderFor(localPart) {
  const envKey = `MAIL_FROM_${localPart.toUpperCase().replace(/-/g, '_')}`
  if (process.env[envKey]) return process.env[envKey]
  const base = process.env.SMTP_FROM
  if (base && base.includes('@')) return `${localPart}@${base.slice(base.indexOf('@') + 1)}`
  return 'onboarding@resend.dev'
}

// Single choke point for every send so an optional reply mailbox
// (MAIL_REPLY_TO) applies to all categories without touching each template.
// The Resend SDK v6 builds its own wire body and only forwards camelCase
// replyTo (mapping it to the API's reply_to) — snake_case is silently
// dropped, so the payload key here must be replyTo.
export function sendPayload(client, payload) {
  const replyTo = process.env.MAIL_REPLY_TO
  return client.emails.send(replyTo ? { ...payload, replyTo } : payload)
}

export async function sendEmail({ to, subject, html }) {
  const client = getResendClient()
  if (!client) throw new Error('RESEND_API_KEY not configured')

  const from = senderFor('no-reply')
  const { data, error } = await sendPayload(client, { from, to, subject, html })
  if (error) throw new Error(error.message)
  console.log('[EMAIL] Sent:', data?.id)
  return data
}

export async function sendPromotionEmail({ recipients, promotion, storeName }) {
  const client = getResendClient()
  if (!client) throw new Error('RESEND_API_KEY not configured')

  const discountText = promotion.type === 'percentage'
    ? `${promotion.value}%`
    : `${promotion.value} ج.م`

  const htmlContent = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { padding: 30px; }
        .promo-box { background: #f8f9fa; border: 2px dashed #667eea; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0; }
        .promo-code { font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 3px; font-family: monospace; }
        .discount { font-size: 24px; color: #28a745; font-weight: bold; margin: 15px 0; }
        .details { color: #666; font-size: 14px; line-height: 1.8; }
        .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #999; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎉 عرض خاص من ${storeName}</h1>
        </div>
        <div class="content">
          <p>عزيزي العميل،</p>
          <p>يسعدنا تقديم لكم عرض خاص حصري!</p>
          <div class="promo-box">
            <div class="discount">خصم ${discountText}</div>
            <p>استخدم كود الخصم:</p>
            <div class="promo-code">${promotion.code}</div>
          </div>
          <div class="details">
            ${promotion.min_order_amount ? `<p>📌 الحد الأدنى للطلب: ${promotion.min_order_amount} ج.م</p>` : ''}
            <p>📅 صالح حتى: ${new Date(promotion.end_date).toLocaleDateString('ar-EG')}</p>
            ${promotion.max_uses ? `<p>⏳ عدد الاستخدامات المتبقية: ${promotion.max_uses - (promotion.used_count || 0)}</p>` : ''}
          </div>
          <p style="margin-top: 20px;">سارع بالاستفادة من العرض قبل انتهائه!</p>
        </div>
        <div class="footer">
          <p>${storeName} | © ${new Date().getFullYear()} Dukkanza. All rights reserved. | جميع الحقوق محفوظة</p>
        </div>
      </div>
    </body>
    </html>
  `

  const from = senderFor('promotions')
  const results = []

  for (const recipient of recipients) {
    try {
      const { data, error } = await sendPayload(client, {
        from,
        to: recipient.email,
        subject: `🎉 عرض خاص: خصم ${discountText} - ${storeName}`,
        html: htmlContent,
      })
      if (error) throw new Error(error.message)
      results.push({ email: recipient.email, success: true, messageId: data?.id })
      console.log(`[EMAIL] Sent to ${recipient.email}: ${data?.id}`)
    } catch (err) {
      results.push({ email: recipient.email, success: false, error: err.message })
      console.error(`[EMAIL] Failed to ${recipient.email}:`, err.message)
    }
  }

  return results
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Shared chrome for transactional emails (password reset, welcome,
// activation). Bilingual: the app supports AR + EN and the server does not
// store a per-user language, so both are stacked with the Arabic block
// first, matching the product's default.
function transactionalShell({ titleEn, titleAr, bodyEn, bodyAr }) {
  return `
    <!DOCTYPE html>
    <html lang="ar">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 28px 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 22px; }
        .content { padding: 28px 30px; color: #333; line-height: 1.8; }
        .btn { display: inline-block; background: #667eea; color: white !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: bold; margin: 16px 0; }
        .divider { border: 0; border-top: 1px solid #eee; margin: 22px 0; }
        .muted { color: #888; font-size: 13px; word-break: break-all; }
        .footer { background: #f8f9fa; padding: 18px 30px; text-align: center; color: #999; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>${escapeHtml(titleAr)}</h1><p style="margin:6px 0 0;opacity:.85">${escapeHtml(titleEn)}</p></div>
        <div class="content" dir="rtl">${bodyAr}</div>
        <hr class="divider">
        <div class="content" dir="ltr" style="padding-top:0">${bodyEn}</div>
        <div class="footer">© ${new Date().getFullYear()} Dukkanza. All rights reserved. | جميع الحقوق محفوظة</div>
      </div>
    </body>
    </html>
  `
}

export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const client = getResendClient()
  if (!client) throw new Error('RESEND_API_KEY not configured')
  const safeName = escapeHtml(name || '')
  const safeUrl = escapeHtml(resetUrl)

  const html = transactionalShell({
    titleAr: 'إعادة تعيين كلمة المرور',
    titleEn: 'Reset your password',
    bodyAr: `
      <p>مرحباً ${safeName}،</p>
      <p>تلقينا طلباً لإعادة تعيين كلمة المرور لحسابك. اضغط الزر بالأسفل للمتابعة (صالح لمدة 30 دقيقة):</p>
      <p style="text-align:center"><a class="btn" href="${safeUrl}">إعادة تعيين كلمة المرور</a></p>
      <p class="muted">إذا لم تطلب هذا، تجاهل هذه الرسالة — لن يتغير شيء بحسابك.</p>
    `,
    bodyEn: `
      <p>Hi ${safeName},</p>
      <p>We received a request to reset your password. Click the button below to continue (valid for 30 minutes):</p>
      <p style="text-align:center"><a class="btn" href="${safeUrl}">Reset password</a></p>
      <p class="muted">If you didn't request this, ignore this message — nothing about your account changes.</p>
      <p class="muted">${safeUrl}</p>
    `,
  })

  const from = senderFor('support')
  const { data, error } = await sendPayload(client, {
    from,
    to,
    subject: 'إعادة تعيين كلمة المرور / Reset your password',
    html,
  })
  if (error) throw new Error(error.message)
  console.log('[EMAIL] Password reset sent:', data?.id)
  return data
}

export async function sendWelcomeEmail({ to, name, storeName, trial = true }) {
  const client = getResendClient()
  if (!client) throw new Error('RESEND_API_KEY not configured')
  const safeName = escapeHtml(name || '')
  const safeStore = escapeHtml(storeName || '')

  const html = transactionalShell({
    titleAr: `مرحباً بك في المتجر ${safeStore}`,
    titleEn: `Welcome to ${safeStore}`,
    bodyAr: `
      <p>أهلاً ${safeName}! تم إنشاء حسابك بنجاح${trial ? ' وبدأ تجربتك المجانية' : ''}.</p>
      <p>للبدء:</p>
      <ul>
        <li>أضف منتجاتك من صفحة المخزون</li>
        <li>افتح شاشة البيع (POS) وابدأ البيع</li>
        <li>راجع تقاريرك اليومية من لوحة التحكم</li>
      </ul>
    `,
    bodyEn: `
      <p>Hi ${safeName}! Your account is ready${trial ? ' and your free trial has started' : ''}.</p>
      <p>To get started:</p>
      <ul>
        <li>Add your products from the Inventory page</li>
        <li>Open the POS screen and make your first sale</li>
        <li>Track your daily numbers from the Dashboard</li>
      </ul>
    `,
  })

  const from = senderFor('hello')
  const { data, error } = await sendPayload(client, {
    from,
    to,
    subject: `مرحباً بك في ${safeStore} / Welcome to ${safeStore}`,
    html,
  })
  if (error) throw new Error(error.message)
  console.log('[EMAIL] Welcome sent:', data?.id)
  return data
}

export async function sendSubscriptionActivatedEmail({ to, name, storeName, planName, expiresAt }) {
  const client = getResendClient()
  if (!client) throw new Error('RESEND_API_KEY not configured')
  const safeName = escapeHtml(name || '')
  const safeStore = escapeHtml(storeName || '')
  const safePlan = escapeHtml(planName || '')
  const until = expiresAt ? new Date(expiresAt).toLocaleDateString('ar-EG') : ''

  const html = transactionalShell({
    titleAr: 'تم تفعيل اشتراكك',
    titleEn: 'Your subscription is active',
    bodyAr: `
      <p>مرحباً ${safeName}،</p>
      <p>تم تأكيد دفعتك وتفعيل باقة <strong>${safePlan}</strong> لمتجر ${safeStore}${until ? ` حتى ${until}` : ''}.</p>
      <p>كل الميزات المدفوعة متاحة الآن في حسابك.</p>
    `,
    bodyEn: `
      <p>Hi ${safeName},</p>
      <p>Your payment was confirmed and the <strong>${safePlan}</strong> plan is now active for ${safeStore}${until ? ` until ${until}` : ''}.</p>
      <p>All paid features are now unlocked in your account.</p>
    `,
  })

  const from = senderFor('billing')
  const { data, error } = await sendPayload(client, {
    from,
    to,
    subject: `تم تفعيل الاشتراك / Subscription activated - ${safeStore}`,
    html,
  })
  if (error) throw new Error(error.message)
  console.log('[EMAIL] Activation sent:', data?.id)
  return data
}

// Purchase-order email to a supplier. Bilingual AR-first + EN, the same
// stacking the other transactional templates use (the server holds no
// per-contact language). This deliberately does NOT reuse sendCustomEmail:
// that one is the promotions blast sender, escapes the body into a single
// <p> (which flattens the line breaks into one run-on paragraph), and has no
// notion of line items. A PO is transactional mail a supplier replies to, so
// it gets the orders@ sender and a real table of lines.
export async function sendPurchaseOrderEmail({ to, supplierName, po, items = [], store = {} }) {
  const client = getResendClient()
  if (!client) throw new Error('RESEND_API_KEY not configured')

  const safeOrder = escapeHtml(po.order_number || '')
  const safeSupplier = escapeHtml(supplierName || '')
  const safeStore = escapeHtml(store.name || '')
  const expectedAr = po.expected_date ? new Date(po.expected_date).toLocaleDateString('ar-EG') : ''
  const expectedEn = po.expected_date ? new Date(po.expected_date).toLocaleDateString('en-GB') : ''
  const amount = (v) => escapeHtml(String(parseFloat(v)))

  // Line items are pre-escaped once, then rendered into whichever table the
  // direction needs — so AR and EN can never drift in content.
  const lines = (items || []).map((item) => ({
    name: escapeHtml(item.product_name || ''),
    qty: escapeHtml(String(item.quantity)),
    unit: amount(item.unit_price),
    total: amount(
      item.total != null
        ? item.total
        : parseFloat(item.quantity) * parseFloat(item.unit_price)
    ),
  }))

  const table = (dir) => {
    const align = dir === 'rtl' ? 'right' : 'left'
    const head = dir === 'rtl'
      ? ['المنتج', 'الكمية', 'سعر الوحدة', 'الإجمالي']
      : ['Product', 'Qty', 'Unit price', 'Line total']
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:14px 0;font-size:14px">
        <thead>
          <tr>
            ${head.map((h) => `<th align="${align}" style="padding:8px 10px;border-bottom:2px solid #667eea;color:#333">${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${lines.map((l) => `
          <tr>
            <td align="${align}" style="padding:8px 10px;border-bottom:1px solid #eee">${l.name}</td>
            <td align="${align}" style="padding:8px 10px;border-bottom:1px solid #eee">${l.qty}</td>
            <td align="${align}" style="padding:8px 10px;border-bottom:1px solid #eee">${l.unit}</td>
            <td align="${align}" style="padding:8px 10px;border-bottom:1px solid #eee">${l.total}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
  }

  const html = `
    <!DOCTYPE html>
    <html lang="ar">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 28px 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 22px; }
        .content { padding: 28px 30px; color: #333; line-height: 1.8; }
        .total { font-size: 17px; font-weight: bold; color: #667eea; margin: 12px 0; }
        .divider { border: 0; border-top: 1px solid #eee; margin: 22px 0; }
        .muted { color: #888; font-size: 13px; }
        .footer { background: #f8f9fa; padding: 18px 30px; text-align: center; color: #999; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>أمر شراء ${safeOrder}</h1>
          <p style="margin:6px 0 0;opacity:.85">Purchase Order ${safeOrder}</p>
        </div>

        <div class="content" dir="rtl">
          <p>مرحباً ${safeSupplier}،</p>
          ${expectedAr ? `<p class="muted">التاريخ المتوقع للتسليم: <strong>${expectedAr}</strong></p>` : ''}
          ${table('rtl')}
          <p class="total">إجمالي الطلب: ${amount(po.total)}</p>
          ${po.notes ? `<p class="muted">ملاحظات: ${escapeHtml(po.notes)}</p>` : ''}
          <hr class="divider">
          <p class="muted">
            معلومات المتجر<br>
            المتجر: ${safeStore}${store.address ? `<br>الموقع: ${escapeHtml(store.address)}` : ''}${store.phone ? `<br>الهاتف: ${escapeHtml(store.phone)}` : ''}
          </p>
        </div>

        <hr class="divider" style="margin:0">

        <div class="content" dir="ltr" style="padding-top:24px">
          <p>Hi ${safeSupplier || 'there'},</p>
          ${expectedEn ? `<p class="muted">Expected delivery date: <strong>${expectedEn}</strong></p>` : ''}
          ${table('ltr')}
          <p class="total">Order total: ${amount(po.total)}</p>
          ${po.notes ? `<p class="muted">Notes: ${escapeHtml(po.notes)}</p>` : ''}
          <hr class="divider">
          <p class="muted">
            Store information<br>
            Store: ${safeStore}${store.address ? `<br>Location: ${escapeHtml(store.address)}` : ''}${store.phone ? `<br>Phone: ${escapeHtml(store.phone)}` : ''}
          </p>
        </div>

        <div class="footer">© ${new Date().getFullYear()} Dukkanza. All rights reserved. | جميع الحقوق محفوظة</div>
      </div>
    </body>
    </html>
  `

  const from = senderFor('orders')
  const subject = `أمر شراء ${safeOrder} — ${safeStore} / Purchase Order ${po.order_number} — ${store.name}`
  const { data, error } = await sendPayload(client, { from, to, subject, html })
  if (error) throw new Error(error.message)
  console.log('[EMAIL] Purchase order sent:', data?.id)
  return data
}

export async function sendCustomEmail({ recipients, subject, message, storeName }) {
  const client = getResendClient()
  if (!client) throw new Error('RESEND_API_KEY not configured')

  const htmlContent = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
        .content { padding: 30px; color: #333; line-height: 1.8; }
        .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #999; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>${escapeHtml(subject)}</h1></div>
        <div class="content"><p>${escapeHtml(message)}</p></div>
        <div class="footer"><p>${storeName} | © ${new Date().getFullYear()} Dukkanza. All rights reserved. | جميع الحقوق محفوظة</p></div>
      </div>
    </body>
    </html>
  `

  const from = senderFor('promotions')
  const results = []

  for (const recipient of recipients) {
    try {
      const { data, error } = await sendPayload(client, {
        from,
        to: recipient.email,
        subject,
        html: htmlContent,
      })
      if (error) throw new Error(error.message)
      results.push({ email: recipient.email, success: true })
    } catch (err) {
      results.push({ email: recipient.email, success: false, error: err.message })
    }
  }

  return results
}
