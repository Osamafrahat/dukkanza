import { Router } from 'express'
import supabase from '../db/supabase.js'
import { authenticateToken, requirePermission } from '../middleware/auth.js'
import { sendPromotionEmail, sendPurchaseOrderEmail } from '../services/emailService.js'
import { sendPromotionWhatsApp, sendPurchaseOrderWhatsApp } from '../services/whatsappService.js'

const router = Router()

async function getStoreName(tenantId) {
  try {
    const { data } = await supabase
      .from('store_settings')
      .select('value')
      .eq('key', 'storeName')
      .eq('tenant_id', tenantId)
      .single()
    return data?.value || 'Store'
  } catch {
    return 'Store'
  }
}

async function processPromotionSend(promoId, { send_email, send_whatsapp, tenantId }) {
  console.log(`[BG] === Starting background send for promo_id: ${promoId} ===`)
  try {
    const { data: promo, error: promoError } = await supabase
      .from('promotions')
      .select('*')
      .eq('id', promoId)
      .eq('tenant_id', tenantId)
      .single()

    if (promoError || !promo) {
      console.error(`[BG] Promotion not found:`, promoError?.message)
      return
    }
    console.log(`[BG] Step 1 OK: promo=${promo.code}`)

    const storeName = await getStoreName(tenantId)
    const results = { email: [], whatsapp: [] }

    if (send_email) {
      const { data: emailCustomers, error: emailErr } = await supabase
        .from('customers')
        .select('id, name, email, phone')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .not('email', 'is', null)

      if (!emailErr && emailCustomers?.length > 0) {
        console.log(`[BG] Sending emails to ${emailCustomers.length} customers`)
        results.email = await sendPromotionEmail({
          recipients: emailCustomers,
          promotion: promo,
          storeName
        })
        console.log(`[BG] Emails done: ${results.email.filter(r => r.success).length}/${results.email.length} sent`)
      }
    }

    if (send_whatsapp) {
      const { data: whatsappCustomers, error: waErr } = await supabase
        .from('customers')
        .select('id, name, email, phone')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .not('phone', 'is', null)

      if (!waErr && whatsappCustomers?.length > 0) {
        results.whatsapp = await sendPromotionWhatsApp({
          recipients: whatsappCustomers,
          promotion: promo,
          storeName
        })
      }
    }

    const emailSuccess = results.email.filter(r => r.success).length
    const whatsappSuccess = results.whatsapp.filter(r => r.success).length
    console.log(`[BG] === COMPLETE: email=${emailSuccess}, whatsapp=${whatsappSuccess} ===`)
  } catch (err) {
    console.error(`[BG] FATAL ERROR:`, err.message)
  }
}

router.post('/promotion', authenticateToken, requirePermission('promotions_edit'), (req, res) => {
  try {
    const { promotion_id, send_email, send_whatsapp } = req.body
    const numericId = Number(promotion_id)
    if (!numericId || numericId <= 0) {
      return res.status(400).json({ error: 'Invalid promotion ID' })
    }

    const emailConfigured = !!(process.env.RESEND_API_KEY || (process.env.SMTP_USER && process.env.SMTP_PASS))

    if (send_email && !emailConfigured) {
      return res.json({
        success: true,
        message: 'Email not configured',
        results: { email: [], emailSkipped: true, whatsapp: [] }
      })
    }

    if (!send_email && !send_whatsapp) {
      return res.json({ success: true, message: 'No channels selected', results: { email: [], whatsapp: [] } })
    }

    res.json({
      success: true,
      message: 'Sending in background',
      results: { email: [], whatsapp: [], processing: true }
    })

    processPromotionSend(numericId, {
      send_email: send_email && emailConfigured,
      send_whatsapp,
      tenantId: req.user?.tenantId
    }).catch(err => {
      console.error('[BG] Background send error:', err.message)
    })
  } catch (err) {
    console.error('[EMAIL] Promotion send FAILED:', err.message)
    res.status(500).json({ error: 'Failed to send promotion' })
  }
})

// Compose the outbound purchase-order message (order details + store
// name/location/phone) as plain text. This feeds the WhatsApp channel and the
// modal's "Copy message" button — both read the same string. Email has its own
// HTML template in emailService.js (sendPurchaseOrderEmail).
//
// Bilingual AR-first + EN, the same stacking the email template uses: the
// server stores no per-contact language, so both ship together. Section
// headers and totals get a full line per language; line items stay one row
// with paired labels, otherwise a 20-line order becomes unreadable on a
// phone. WhatsApp renders *text* as bold, so emphasis uses asterisks.
function buildPurchaseOrderMessage(po, items, store) {
  const lines = []
  lines.push(`*أمر شراء ${po.order_number}*`)
  lines.push(`*Purchase Order ${po.order_number}*`)
  lines.push('')
  if (po.expected_date) {
    const d = new Date(po.expected_date)
    lines.push(`التاريخ المتوقع: ${d.toLocaleDateString('ar-EG')}`)
    lines.push(`Expected date: ${d.toLocaleDateString('en-GB')}`)
    lines.push('')
  }
  lines.push('*البنود / Items:*')
  for (const item of items) {
    const lineTotal = item.total != null
      ? parseFloat(item.total)
      : parseFloat(item.quantity) * parseFloat(item.unit_price)
    lines.push(
      `- ${item.product_name} | الكمية/Qty: ${item.quantity} | الوحدة/Unit: ${parseFloat(item.unit_price)} | الإجمالي/Total: ${lineTotal}`
    )
  }
  lines.push('')
  lines.push(`*إجمالي الطلب: ${parseFloat(po.total)}*`)
  lines.push(`*Order total: ${parseFloat(po.total)}*`)
  if (po.notes) {
    lines.push('')
    lines.push(`ملاحظات/Notes: ${po.notes}`)
  }
  lines.push('')
  lines.push('*معلومات المتجر / Store information:*')
  lines.push(`المتجر/Store: ${store.name}`)
  if (store.address) lines.push(`الموقع/Location: ${store.address}`)
  if (store.phone) lines.push(`الهاتف/Phone: ${store.phone}`)
  return lines.join('\n')
}

// Send a purchase order to its supplier by email and/or WhatsApp.
// Email is actually delivered via Resend; WhatsApp returns a wa.me link the
// client opens (the same approach the promotion flow uses).
router.post('/purchase-order', authenticateToken, async (req, res) => {
  try {
    const { purchase_order_id, send_email, send_whatsapp } = req.body
    const poId = Number(purchase_order_id)
    if (!poId || poId <= 0) {
      return res.status(400).json({ error: 'Invalid purchase order ID' })
    }
    if (!send_email && !send_whatsapp) {
      return res.status(400).json({ error: 'No channels selected' })
    }

    const tenantId = req.user?.tenantId

    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .select('*, suppliers(name, contact_person, email, phone)')
      .eq('id', poId)
      .eq('tenant_id', tenantId)
      .single()
    if (poError || !po) {
      return res.status(404).json({ error: 'Purchase order not found' })
    }

    const { data: items } = await supabase
      .from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', po.id)
      .eq('tenant_id', tenantId)

    const { data: tenant } = await supabase
      .from('tenants')
      .select('name, address, phone')
      .eq('id', tenantId)
      .single()
    const store = {
      name: tenant?.name || (await getStoreName(tenantId)),
      address: tenant?.address || '',
      phone: tenant?.phone || '',
    }

    const supplier = po.suppliers || {}
    const message = buildPurchaseOrderMessage(po, items || [], store)
    const emailConfigured = !!(process.env.RESEND_API_KEY || (process.env.SMTP_USER && process.env.SMTP_PASS))

    const results = { email: [], whatsapp: [] }

    if (send_email) {
      if (!supplier.email) {
        results.email = [{ success: false, skipped: true, reason: 'no_supplier_email' }]
      } else if (!emailConfigured) {
        results.email = [{ success: false, skipped: true, reason: 'email_not_configured' }]
      } else {
        try {
          await sendPurchaseOrderEmail({
            to: supplier.email,
            supplierName: supplier.contact_person || supplier.name,
            po,
            items: items || [],
            store,
          })
          results.email = [{ success: true, email: supplier.email }]
        } catch (mailErr) {
          console.error('[EMAIL] Purchase order email FAILED:', mailErr.message)
          results.email = [{ success: false, email: supplier.email, reason: 'send_failed' }]
        }
      }
    }

    if (send_whatsapp) {
      if (!supplier.phone) {
        results.whatsapp = [{ success: false, skipped: true, reason: 'no_supplier_phone' }]
      } else {
        results.whatsapp = await sendPurchaseOrderWhatsApp({
          recipients: [{ phone: supplier.phone, name: supplier.contact_person || supplier.name }],
          message,
        })
      }
    }

    res.json({
      success: true,
      supplier: { name: supplier.name, email: supplier.email || null, phone: supplier.phone || null },
      message,
      results,
    })
  } catch (err) {
    console.error('[EMAIL] Purchase order send FAILED:', err.message)
    res.status(500).json({ error: 'Failed to send purchase order' })
  }
})

export default router
