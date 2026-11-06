import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ScanBarcode, Search, BadgeCheck, XCircle, Camera } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { subscriptionsApi } from '../lib/api'
import { parseSubscriptionBarcode, isSubscriptionValid } from '../lib/subscriptions'
import BarcodeScanner from '../components/pos/BarcodeScanner'

// Stored status labels — same mapping the subscriptions table uses.
const STATUS_LABEL_KEYS = {
  active: 'services.statusActive',
  cancelled: 'services.statusCancelled',
  expired: 'services.statusExpired',
  past_due: 'services.statusPastDue',
}

// Scan-to-check desk: scan (or type) a subscription barcode and see at a
// glance whether it is valid or expired. The input keeps focus and clears
// after every attempted lookup so a scanner gun can be triggered again
// immediately — scan, read, scan the next one.
export default function SubscriptionCheckPage() {
  const { t } = useAppStore()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [found, setFound] = useState(null)
  // { kind: 'invalid' | 'notfound' | 'error', code?, message? }
  const [failure, setFailure] = useState(null)
  const [showScanner, setShowScanner] = useState(false)
  const inputRef = useRef(null)

  const focusInput = () => inputRef.current?.focus()

  useEffect(() => { focusInput() }, [])

  // Shared by the typed form and the camera modal: look up one code and
  // render the verdict. Returns the short label the scanner modal displays
  // under its flash, so the operator can read the result WITHOUT closing
  // the modal and keep scanning the next barcode.
  const runCheck = async (raw) => {
    if (loading) return ''

    const attempted = String(raw ?? '').trim()
    const id = parseSubscriptionBarcode(attempted)
    if (!id) {
      // Nothing to ask the server about; keep the typed text so a manual
      // typo can be corrected (a camera scan has nothing to keep).
      setFound(null)
      setFailure({ kind: 'invalid' })
      focusInput()
      return t('services.invalidBarcode') || 'Invalid subscription barcode'
    }

    setLoading(true)
    setFailure(null)
    setFound(null)
    try {
      const res = await subscriptionsApi.getById(id)
      setFound(res.data)
      // Verdict is computed, not read from status — same as the card.
      return isSubscriptionValid(res.data)
        ? (t('services.valid') || 'Valid')
        : (t('services.statusExpired') || 'Expired')
    } catch (err) {
      if (err.response?.status === 404) {
        setFailure({ kind: 'notfound', code: attempted })
        return t('services.notFoundFor', { code: attempted }) || `No subscription found for ${attempted}`
      }
      const message = err.response?.data?.error || t('common.error') || 'Error'
      setFailure({ kind: 'error', message })
      return message
    } finally {
      setLoading(false)
      // Clear and refocus: ready for the very next scan.
      setQuery('')
      focusInput()
    }
  }

  const check = (e) => {
    e.preventDefault()
    runCheck(query)
  }

  // Camera modal → the same lookup; the returned label is what the modal
  // shows after the flash.
  const handleCameraScan = (barcode) => runCheck(barcode)

  const valid = isSubscriptionValid(found)

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link
          to="/subscriptions"
          title={t('services.subscriptionsTitle') || 'Subscriptions'}
className="p-2 rounded-lg bg-surface-tertiary text-muted hover:text-foreground"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t('services.checkSubscription') || 'Check Barcode'}</h1>
          <p className="text-muted">{t('services.checkSubtitle') || 'Scan a subscription barcode to check validity'}</p>
        </div>
      </div>

      {/* Scan input — Enter (what scanners send) submits the form */}
      <form onSubmit={check} className="flex gap-2">
        <div className="relative flex-1">
          <ScanBarcode className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="SUB-123"
            autoComplete="off"
            aria-label={t('services.checkSubscription') || 'Check Barcode'}
            className="w-full pl-10 pr-3 py-3 rounded-lg border border-border bg-surface text-lg font-mono"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowScanner(true)}
          title={t('services.scanWithCamera') || 'Scan with camera'}
          aria-label={t('services.scanWithCamera') || 'Scan with camera'}
          className="flex items-center justify-center px-4 py-3 rounded-lg border border-border bg-surface-tertiary text-foreground hover:bg-surface-hover"
        >
          <Camera className="w-5 h-5" />
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex items-center gap-2 px-5 py-3 bg-accent text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          <Search className="w-4 h-4" />
          {loading ? (t('common.loading') || 'Loading...') : (t('services.check') || 'Check')}
        </button>
      </form>

      {failure && (
        <div role="alert" className="flex items-start gap-3 p-4 rounded-xl border border-danger bg-danger-soft text-danger-soft-foreground">
          <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm">
            {failure.kind === 'invalid' && (
              <p>{t('services.invalidBarcode') || 'Invalid subscription barcode'}</p>
            )}
            {failure.kind === 'notfound' && (
              <p>{t('services.notFoundFor', { code: failure.code }) || `No subscription found for ${failure.code}`}</p>
            )}
            {failure.kind === 'error' && <p>{failure.message}</p>}
          </div>
        </div>
      )}

      {found && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-sm">
          {/* Verdict banner — computed, not trusted from status */}
          <div className={`px-5 py-4 flex items-center gap-3 ${valid ? 'bg-success-soft' : 'bg-danger-soft'}`}>
            <BadgeCheck className={`w-6 h-6 shrink-0 ${valid ? 'text-success' : 'text-danger'}`} />
            <span className={`text-lg font-bold ${valid ? 'text-success-soft-foreground' : 'text-danger-soft-foreground'}`}>
              {valid ? (t('services.valid') || 'Valid') : (t('services.statusExpired') || 'Expired')}
            </span>
            <span className="ml-auto text-sm font-mono text-muted">SUB-{found.id}</span>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-5 text-sm">
            <div>
              <dt className="text-muted">{t('services.customer') || 'Customer'}</dt>
              <dd className="font-medium">{found.customer?.name || '-'}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('services.plan') || 'Plan'}</dt>
              <dd className="font-medium">{found.plan?.name || found.service?.name || '-'}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('services.status') || 'Status'}</dt>
              <dd>{t(STATUS_LABEL_KEYS[found.status]) || found.status || '-'}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('services.amount') || 'Amount'}</dt>
              <dd className="font-medium">{found.billing_amount?.toLocaleString()} {t('common.currency') || 'EGP'}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('services.startDate') || 'Start'}</dt>
              <dd>{found.start_date || '-'}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('services.endDate') || 'End'}</dt>
              <dd>{found.end_date || '-'}</dd>
            </div>
          </dl>
        </div>
      )}

      {/* Camera check — reuses the POS scanner and opens straight into
          camera mode so one tap starts scanning. The verdict comes back as
          the modal's label; the full card renders behind it. */}
      {showScanner && (
        <BarcodeScanner
          initialMode="camera"
          onScan={handleCameraScan}
          onClose={() => {
            setShowScanner(false)
            focusInput()
          }}
        />
      )}
    </div>
  )
}
