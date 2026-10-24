import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { useUserStore } from '../stores/userStore'
import api from '../lib/api'
import { buildPaymentInvoiceHtml } from '../lib/invoiceHtml'
import { CreditCard, Users, Package, ShoppingCart, Clock, ArrowUpRight, ExternalLink, X, Mail, MessageCircle, Send, Loader2, CheckCircle, AlertTriangle, Trash2, Shield } from 'lucide-react'

function getTierLabels(t) {
  return { free: t('billing.free') || 'Free', pro: t('billing.pro') || 'Pro', enterprise: t('billing.enterprise') || 'Enterprise' }
}
const tierColors = {
free:'bg-surface-tertiary text-foreground',
pro:'bg-accent-soft text-accent-soft-foreground',
enterprise:'bg-warning-soft text-warning-soft-foreground',
}
function getStatusLabels(t) {
  return {
    active: t('billing.active') || 'Active',
    trialing: t('billing.trial') || 'Trial',
    cancelled: t('billing.cancelled') || 'Cancelled',
    past_due: t('billing.pastDue') || 'Past Due',
  }
}
const statusColors = {
active:'bg-success-soft text-success-soft-foreground',
trialing:'bg-accent-soft text-accent-soft-foreground',
cancelled:'bg-danger-soft text-danger-soft-foreground',
past_due:'bg-warning-soft text-warning-soft-foreground',
}

const SUPPORT_EMAIL = 'support@dukkanza.com'
const SUPPORT_WHATSAPP = '201555256213'

function ContactSupportModal({ open, onClose, t, currentUser }) {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  if (!open) return null

  const handleSend = async () => {
    if (!subject.trim() || !message.trim()) return
    setSending(true)
    try {
      const body = `Support Request\nFrom: ${currentUser?.fullName || currentUser?.username || 'User'}\nSubject: ${subject}\n\n${message}`
      window.open(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`[Dukkanza] ${subject}`)}&body=${encodeURIComponent(body)}`, '_blank')
      setSent(true)
      setTimeout(() => { setSent(false); onClose() }, 2000)
    } catch {
      window.open(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`[Dukkanza] ${subject}`)}&body=${encodeURIComponent(message)}`, '_blank')
      setSent(true)
      setTimeout(() => { setSent(false); onClose() }, 2000)
    } finally {
      setSending(false)
    }
  }

  const openWhatsApp = () => {
    const text = `Hi, I need support with Dukkanza.\nUser: ${currentUser?.fullName || currentUser?.username || 'N/A'}\n`
    window.open(`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`, '_blank')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
<div className="bg-surface rounded-xl shadow-xl w-full max-w-md mx-4 p-6 relative"onClick={e=>e.stopPropagation()}>
<button onClick={onClose}className="absolute top-4 right-4 text-muted text-foreground">
          <X className="w-5 h-5" />
        </button>

<h2 className="text-lg font-semibold text-foreground mb-1">
          {t('billing.contactSupport') || 'Contact Support'}
        </h2>
<p className="text-sm text-muted mb-4">
          {t('billing.supportDesc') || 'How can we help you?'}
        </p>

        {sent ? (
          <div className="text-center py-8">
<CheckCircle className="w-12 h-12 text-success mx-auto mb-3"/>
<p className="text-success font-medium">{t('billing.messageSent')||'Message ready!'}</p>
<p className="text-sm text-muted mt-1">{t('billing.checkEmail')||'Check your email client to send.'}</p>
          </div>
        ) : (
          <>
            <div className="space-y-3 mb-4">
              <button
                onClick={openWhatsApp}
className="w-full flex items-center gap-3 p-3 bg-success-soft border border-success rounded-lg hover:bg-green-100 transition-colors"
              >
<MessageCircle className="w-5 h-5 text-success"/>
                <div className="text-left">
<p className="text-sm font-medium text-foreground">{t('billing.whatsapp')||'WhatsApp'}</p>
<p className="text-xs text-muted">{t('billing.whatsappDesc')||'Chat with us instantly'}</p>
                </div>
              </button>

              <button
                onClick={() => window.open(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('[Dukkanza] Support Request')}`, '_blank')}
className="w-full flex items-center gap-3 p-3 bg-accent-soft border border-accent rounded-lg hover:bg-blue-100 transition-colors"
              >
<Mail className="w-5 h-5 text-accent"/>
                <div className="text-left">
<p className="text-sm font-medium text-foreground">{t('billing.email')||'Email'}</p>
<p className="text-xs text-muted">{SUPPORT_EMAIL}</p>
                </div>
              </button>
            </div>

<div className="border-t border-border pt-4">
<p className="text-xs text-muted mb-2">{t('billing.orSendDirectly')||'Or send a message directly:'}</p>
              <input
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder={t('billing.subject') || 'Subject'}
className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm mb-2"
              />
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder={t('billing.message') || 'Describe your issue...'}
                rows={3}
className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm resize-none"
              />
              <button
                onClick={handleSend}
                disabled={!subject.trim() || !message.trim() || sending}
className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent hover:bg-primary-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {t('billing.sendMessage') || 'Send Message'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function UsageBar({ label, used, max, icon: Icon }) {
  const pct = max === -1 ? 0 : Math.min((used / max) * 100, 100)
  const isUnlimited = max === -1

  return (
<div className="bg-surface rounded-xl p-4 border border-border">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
<Icon className="w-4 h-4 text-muted"/>
<span className="text-sm font-medium text-foreground">{label}</span>
        </div>
<span className="text-sm text-muted">
          {used} / {isUnlimited ? '∞' : max}
        </span>
      </div>
      {!isUnlimited && (
<div className="w-full bg-surface-tertiary rounded-full h-2">
          <div
className={`h-2 rounded-full transition-all ${pct>90 ?'bg-danger': pct>70 ?'bg-warning':'bg-accent'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {isUnlimited && (
<div className="w-full bg-surface-tertiary rounded-full h-2">
<div className="h-2 rounded-full bg-success"style={{width:'100%'}}/>
        </div>
      )}
    </div>
  )
}

export default function BillingPage() {
  const { t, language } = useAppStore()
  const { currentUser } = useUserStore()
  const [billing, setBilling] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showSupport, setShowSupport] = useState(false)
  const [savedCards, setSavedCards] = useState([])
  const [deletingCard, setDeletingCard] = useState(null)
  const [plans, setPlans] = useState([])
  const [addingCard, setAddingCard] = useState(false)

  const fetchBilling = async () => {
    try {
      setLoading(true)
      const { data } = await api.get('/billing/current')
      setBilling(data)
    } catch {
      setBilling({
        tier: currentUser?.subscription_tier || 'free',
        status: 'active',
        trialEndsAt: null,
        productsUsed: 0,
        productsMax: 50,
        usersUsed: 1,
        usersMax: 2,
        ordersThisMonth: 0,
        ordersMax: 100,
        paymentHistory: [],
      })
    } finally {
      setLoading(false)
    }
  }

  // View invoice: payment rows carry no invoice URL (the server maps only
  // id/amount/currency/status/description/date), so the old <a href>
  // rendered with no href and clicking it went nowhere. Generate the
  // document client-side instead, using the repo's print-window pattern
  // (BarcodePrinter): the print handler attaches from this side, so no
  // <script> ever goes into the written markup.
  const openInvoice = (p) => {
    const w = window.open('', '_blank')
    if (!w) return // popup blocked; nothing else we can do
    w.document.write(buildPaymentInvoiceHtml({
      payment: p,
      tenantName: billing?.tenant?.name || '',
      dir: language === 'ar' ? 'rtl' : 'ltr',
      labels: {
        title: t('billing.invoiceTitle') || 'Payment Invoice',
        invoiceNumber: t('billing.invoiceNumber') || 'Invoice #',
        date: t('billing.date') || 'Date',
        description: t('billing.invoiceDescription') || 'Description',
        status: t('billing.status') || 'Status',
        amount: t('billing.amount') || 'Amount',
        descriptionFallback: t('billing.invoiceFor') || 'Subscription payment',
        footer: t('billing.invoiceFooter') || 'Thank you for choosing Dukkanza',
        print: t('common.print') || 'Print',
      },
    }))
    w.document.close()
    w.document.getElementById('print-now')?.addEventListener('click', () => w.print())
  }

  // NOTE: all hooks must be declared before any early return. This role guard
  // used to sit above the useEffects below, so switching the current user to a
  // non-manager role re-rendered the component with more hooks than the
  // previous render and React threw a rules-of-hooks error.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate trigger list: the loader below is re-created each render and is intentionally NOT a dep, so only these inputs refetch
  useEffect(() => { fetchBilling() }, [currentUser])

  useEffect(() => {
    const onFocus = () => fetchBilling()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate trigger list: the loader is re-created each render and is intentionally NOT a dep
  }, [currentUser])

  useEffect(() => {
    api.get('/billing/paymob/cards').then(({ data }) => setSavedCards(data || [])).catch(() => {})
  }, [])

  useEffect(() => {
    api.get('/billing/plans').then(({ data }) => setPlans(data || [])).catch(() => {})
  }, [])

  if (currentUser?.role !== 'MANAGER' && currentUser?.role !== 'SUPER_ADMIN') {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
<Shield className="w-12 h-12 text-muted"/>
<h2 className="text-xl font-semibold text-foreground">{t('common.accessDenied')||'Access Denied'}</h2>
<p className="text-sm text-muted">{t('billing.managerOnly')||'Only managers can access billing.'}</p>
      </div>
    )
  }

  const handleDeleteCard = async (cardId) => {
    setDeletingCard(cardId)
    try {
      await api.delete(`/billing/paymob/cards/${cardId}`)
      setSavedCards(prev => prev.filter(c => c.id !== cardId))
    } catch {
      alert(t('billing.deleteCardFailed') || 'Failed to delete card')
    } finally {
      setDeletingCard(null)
    }
  }

  const handleAddCard = async () => {
    setAddingCard(true)
    try {
      const { data } = await api.post('/billing/paymob/tokenize')
      if (data?.checkout_url) {
        window.location.href = data.checkout_url
      }
    } catch (err) {
      alert(err.response?.data?.error || (t('billing.addCardFailed') || 'Failed to start card save'))
    } finally {
      setAddingCard(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"/>
      </div>
    )
  }

  const tier = billing?.tenant?.plan || billing?.tier || 'free'
  const status = billing?.tenant?.subscription_status || billing?.status || 'active'
  const tierLabels = getTierLabels(t)
  const statusLabels = getStatusLabels(t)
  const trialEnds = billing?.trialEndsAt ? new Date(billing.trialEndsAt) : null
  const trialDaysLeft = trialEnds ? Math.max(0, Math.ceil((trialEnds - Date.now()) / (1000 * 60 * 60 * 24))) : 0

  return (
    <div className="space-y-6">
      <div>
<h1 className="text-2xl font-bold text-foreground">
          {t('billing.title') || 'Billing & Subscription'}
        </h1>
<p className="text-muted mt-1">
          {t('billing.subtitle') || 'Manage your subscription and usage'}
        </p>
      </div>

<div className="bg-surface rounded-xl p-6 border border-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-3">
<h2 className="text-lg font-semibold text-foreground">
                {tierLabels[tier]} {t('billing.plan') || 'Plan'}
              </h2>
              <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${tierColors[tier]}`}>
                {tierLabels[tier]}
              </span>
              <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${statusColors[status]}`}>
                {statusLabels[status] || status}
              </span>
              {tier !== 'free' && billing?.tenant?.subscription_expires_at && (
<span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${(new Date(billing.tenant.subscription_expires_at)- new Date())>60 * 24 * 60 * 60 * 1000 ?'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300':'bg-accent-soft text-accent-soft-foreground'}`}>
                  {(new Date(billing.tenant.subscription_expires_at) - new Date()) > 60 * 24 * 60 * 60 * 1000 ? (t('pricing.yearly') || 'Annual') : (t('pricing.monthly') || 'Monthly')}
                </span>
              )}
            </div>
            {tier !== 'free' && (() => {
              const plan = plans.find(p => p.slug === tier)
              const priceMonthly = plan?.price_monthly || 0
              const priceYearly = plan?.price_yearly || 0
              const expiresAt = billing?.tenant?.subscription_expires_at
              const isYearly = expiresAt && (new Date(expiresAt) - new Date()) > 60 * 24 * 60 * 60 * 1000
              const price = isYearly ? priceYearly : priceMonthly
              const periodLabel = isYearly ? (t('pricing.perYear') || '/yr') : (t('pricing.perMonth') || '/mo')
              return (
<p className="text-sm text-muted mt-1">
                  {price > 0 ? `${price.toLocaleString()} ج.م${periodLabel}` : (t('billing.freePlan') || 'Free')}
                </p>
              )
            })()}
          </div>
          <Link
            to="/pricing"
className="flex items-center gap-1 text-sm text-accent hover:underline"
          >
            {t('billing.viewPlans') || 'View Plans'} <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>

        {status === 'trialing' && trialDaysLeft > 0 && (
<div className="flex items-center gap-2 p-3 bg-accent-soft rounded-lg mb-4">
<Clock className="w-4 h-4 text-accent"/>
<span className="text-sm text-accent">
              {t('billing.trialEndsIn') || 'Trial ends in'} {trialDaysLeft} {t('billing.days') || 'days'}
            </span>
          </div>
        )}

        {billing?.tenant?.renewal_note && (
<div className="flex items-center gap-2 p-3 bg-warning-soft border border-warning rounded-lg mb-4">
<AlertTriangle className="w-4 h-4 text-warning"/>
<span className="text-sm text-warning">{billing.tenant.renewal_note}</span>
          </div>
        )}

        {billing?.tenant?.subscription_expires_at && tier !== 'free' && (
<div className="flex items-center gap-2 p-3 bg-surface-secondary rounded-lg mb-4">
<Clock className="w-4 h-4 text-muted"/>
<span className="text-sm text-muted">
              {t('billing.expiresOn') || 'Expires'} {new Date(billing.tenant.subscription_expires_at).toLocaleDateString()}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <UsageBar
            label={t('billing.products') || 'Products'}
            used={billing?.usage?.products || billing?.productsUsed || 0}
            max={billing?.tenant?.max_products ?? billing?.productsMax ?? 50}
            icon={Package}
          />
          <UsageBar
            label={t('billing.users') || 'Users'}
            used={billing?.usage?.users || billing?.usersUsed || 0}
            max={billing?.tenant?.max_users ?? billing?.usersMax ?? 2}
            icon={Users}
          />
          <UsageBar
            label={t('billing.ordersThisMonth') || 'Orders This Month'}
            used={billing?.usage?.orders_this_month || billing?.ordersThisMonth || 0}
            max={billing?.tenant?.max_orders_monthly ?? billing?.ordersMax ?? -1}
            icon={ShoppingCart}
          />
        </div>

        <div className="flex gap-3 mt-6">
          {tier === 'free' ? (
            <Link
              to="/pricing"
className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <ArrowUpRight className="w-4 h-4" />
              {t('billing.upgrade') || 'Upgrade Plan'}
            </Link>
          ) : (
            <button
              onClick={() => setShowSupport(true)}
className="flex items-center gap-2 px-4 py-2 bg-surface-tertiary text-foreground text-sm font-medium rounded-lg bg-surface-hover transition-colors"
            >
              {t('billing.contactSupport') || 'Contact Support'}
            </button>
          )}
        </div>
      </div>

      {tier !== 'free' && (
<div className="bg-surface rounded-xl p-6 border border-border">
          <div className="flex items-center justify-between mb-4">
<h3 className="text-lg font-semibold text-foreground">
              {t('billing.savedCards') || 'Saved Payment Methods'}
            </h3>
            <button
              onClick={handleAddCard}
              disabled={addingCard}
className="flex items-center gap-1 text-sm text-accent hover:underline disabled:opacity-50"
            >
              {addingCard ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
              {t('billing.addCard') || '+ Add Card'}
            </button>
          </div>
          {savedCards.length > 0 ? (
            <div className="space-y-3">
              {savedCards.map(card => (
<div key={card.id}className="flex items-center justify-between p-3 bg-surface-secondary rounded-lg border border-border">
                  <div className="flex items-center gap-3">
<CreditCard className="w-5 h-5 text-muted"/>
                    <div>
<p className="text-sm font-medium text-foreground">
                        {card.card_brand || 'Card'} •••• {card.card_last_four || '****'}
                      </p>
<p className="text-xs text-muted">
                        {card.is_default ? (t('billing.default') || 'Default') : ''} {card.created_at ? new Date(card.created_at).toLocaleDateString() : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteCard(card.id)}
                    disabled={deletingCard === card.id}
className="p-1.5 text-danger hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {deletingCard === card.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              ))}
            </div>
          ) : (
<div className="text-center py-6 text-muted">
              <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t('billing.noSavedCards') || 'No saved payment methods'}</p>
              <p className="text-xs mt-1">{t('billing.addCardHint') || 'Save a card after your next payment for easy renewal'}</p>
            </div>
          )}
        </div>
      )}

<div className="bg-surface rounded-xl p-6 border border-border">
<h3 className="text-lg font-semibold text-foreground mb-4">
          {t('billing.paymentHistory') || 'Payment History'}
        </h3>
        {billing?.paymentHistory?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
<tr className="text-left text-muted border-b border-border">
                  <th className="pb-2 font-medium">{t('billing.date') || 'Date'}</th>
                  <th className="pb-2 font-medium">{t('billing.amount') || 'Amount'}</th>
                  <th className="pb-2 font-medium">{t('billing.status') || 'Status'}</th>
                  <th className="pb-2 font-medium">{t('billing.invoice') || 'Invoice'}</th>
                </tr>
              </thead>
              <tbody>
                {billing.paymentHistory.map((p, i) => (
<tr key={i}className="border-b border-border">
<td className="py-2.5 text-foreground">{new Date(p.date).toLocaleDateString()}</td>
<td className="py-2.5 text-foreground">{(p.amount || 0).toLocaleString()}ج.م</td>
                    <td className="py-2.5">
<span className={`px-2 py-0.5 rounded-full text-xs ${p.status==='paid'|| p.status==='succeeded'?'bg-success-soft text-success-soft-foreground':'bg-danger-soft text-danger-soft-foreground'}`}>
                        {p.status}
                      </span>
                    </td>
<td className="py-2.5 text-accent">
                      <a href="#" onClick={(e) => { e.preventDefault(); openInvoice(p) }} className="hover:underline">{t('billing.view') || 'View'}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
<div className="text-center py-8 text-muted">
            <CreditCard className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t('billing.noPayments') || 'No payment history yet'}</p>
          </div>
        )}
      </div>
      <ContactSupportModal open={showSupport} onClose={() => setShowSupport(false)} t={t} currentUser={currentUser} />
    </div>
  )
}
