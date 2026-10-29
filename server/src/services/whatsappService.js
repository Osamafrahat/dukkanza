// WhatsApp Service - Uses WhatsApp URL scheme
// This generates clickable links that open WhatsApp with pre-filled messages
// No API key needed - works on any device with WhatsApp installed

// Generate WhatsApp message link
function generateWhatsAppLink(phone, message) {
  const formattedPhone = phone.replace(/[^0-9]/g, '')
  const encodedMessage = encodeURIComponent(message)
  return `https://wa.me/${formattedPhone}?text=${encodedMessage}`
}

// Send promotion via WhatsApp (generates links)
export async function sendPromotionWhatsApp({ recipients, promotion, storeName }) {
  const discountText = promotion.type === 'percentage'
    ? `${promotion.value}%`
    : `${promotion.value} ج.م`

  const message = `🎉 *عرض خاص من ${storeName}*\n\n` +
    `خصم *${discountText}*\n\n` +
    `📦 استخدم كود الخصم:\n*${promotion.code}*\n\n` +
    (promotion.min_order_amount ? `📌 الحد الأدنى للطلب: ${promotion.min_order_amount} ج.م\n` : '') +
    `📅 صالح حتى: ${new Date(promotion.end_date).toLocaleDateString('ar-EG')}\n\n` +
    `سارع بالاستفادة! 🛒`

  const results = []
  for (const recipient of recipients) {
    if (!recipient.phone) {
      results.push({ phone: 'N/A', success: false, error: 'No phone number' })
      continue
    }

    const link = generateWhatsAppLink(recipient.phone, message)
    results.push({
      phone: recipient.phone,
      name: recipient.name,
      success: true,
      link,
      message
    })

    console.log(`WhatsApp link for ${recipient.name}: ${link}`)
  }

  return results
}

// Send a purchase order to its supplier. The message arrives already complete
// (bilingual header, lines, totals, store block) because the modal's "Copy
// message" button copies it verbatim — so this must NOT wrap it in the
// generic title/footer that sendCustomWhatsApp adds, or WhatsApp would show
// the header and store name twice.
export async function sendPurchaseOrderWhatsApp({ recipients, message }) {
  const results = []
  for (const recipient of recipients) {
    if (!recipient.phone) {
      results.push({ phone: 'N/A', success: false, error: 'No phone number' })
      continue
    }

    const link = generateWhatsAppLink(recipient.phone, message)
    results.push({
      phone: recipient.phone,
      name: recipient.name,
      success: true,
      link,
      message
    })

    console.log(`WhatsApp link for ${recipient.name}: ${link}`)
  }

  return results
}

// Send custom message via WhatsApp (generates links)
export async function sendCustomWhatsApp({ recipients, title, message, storeName }) {
  const fullMessage = `📢 *${title}*\n\n${message}\n\n— ${storeName}`

  const results = []
  for (const recipient of recipients) {
    if (!recipient.phone) {
      results.push({ phone: 'N/A', success: false, error: 'No phone number' })
      continue
    }

    const link = generateWhatsAppLink(recipient.phone, fullMessage)
    results.push({
      phone: recipient.phone,
      name: recipient.name,
      success: true,
      link,
      message: fullMessage
    })

    console.log(`WhatsApp link for ${recipient.name}: ${link}`)
  }

  return results
}
