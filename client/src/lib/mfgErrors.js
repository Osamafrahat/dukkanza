// Manufacturing (MRP) error localization.
//
// The manufacturing routes return stable machine codes (see server/
// src/routes/productionOrders.js mapRpcError + the BOM/work-center guards).
// This maps them to translated strings — including the dynamic parts the
// server attaches (remaining work orders, pending/failed check counts, and
// the named shortage list) — so both manufacturing pages show errors in the
// active language. Unknown codes fall back to the raw server message.
import { translations } from './translations'

function tr(key) {
  let lang = 'en'
  try {
    lang = localStorage.getItem('app_language') || 'en'
  } catch {
    // Non-browser test environment: fall back to English
  }
  return translations[lang]?.[key] || translations.en[key] || null
}

/**
 * @param {object} err   caught axios error
 * @param {function} t   app translate fn (used only for the final fallback)
 * @returns {string} localized message
 */
export function mfgError(err, t) {
  const data = err?.response?.data
  const code = typeof data?.code === 'string' ? data.code : null

  switch (code) {
    case 'ORDER_STATE':
      return tr('mfg.err.orderState')
    case 'WO_PENDING':
      return `${tr('mfg.err.woPending')}${data.remaining != null ? ` (${data.remaining})` : ''}`
    case 'QC_PENDING':
      return `${tr('mfg.err.qcPending')}${data.pending != null ? ` (${data.pending})` : ''}`
    case 'QC_FAILED':
      return `${tr('mfg.err.qcFailed')}${data.failed != null ? ` (${data.failed})` : ''}`
    case 'STOCK_INSUFFICIENT':
      if (Array.isArray(data.shortages) && data.shortages.length > 0) {
        const list = data.shortages
          .map((s) => `${s.name || '#' + s.product_id} (${s.available}/${s.required})`)
          .join(', ')
        return `${tr('mfg.err.stockInsufficient')}: ${list}`
      }
      return tr('mfg.err.stockInsufficient')
    case 'NOT_STARTED':
      return tr('mfg.err.notStarted')
    case 'BOM_REQUIRED':
      return tr('mfg.err.bomRequired')
    case 'BOM_NOT_ACTIVE':
      return tr('mfg.err.bomNotActive')
    case 'BOM_PRODUCT_MISMATCH':
      return tr('mfg.err.bomMismatch')
    case 'BOM_NO_INPUTS':
      return tr('mfg.err.bomNoInputs')
    case 'BOM_ACTIVE_EXISTS':
      return tr('mfg.err.bomActiveExists')
    case 'BOM_IN_USE':
      return tr('mfg.err.bomInUse')
    case 'WC_IN_USE':
      return tr('mfg.err.wcInUse')
    case 'WC_NAME_EXISTS':
      return tr('mfg.err.wcNameExists')
    case 'PRODUCED_REQUIRED':
      return tr('mfg.err.producedRequired')
    default:
      return data?.error || err?.message || t?.('common.error') || 'Error'
  }
}
