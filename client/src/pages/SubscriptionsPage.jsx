import ConfirmModal from '../components/ConfirmModal'
import SearchableSelect from '../components/SearchableSelect'
import BarcodePrinter from '../components/BarcodePrinter'
import { X, Plus, Edit2, Trash2, RefreshCw, Ban, CreditCard, User, ScanBarcode } from 'lucide-react'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { useUserStore, PERMISSIONS } from '../stores/userStore'
import { subscriptionsApi, servicesApi, servicePlansApi, customersApi } from '../lib/api'
import { subscriptionBarcode, isSubscriptionValid } from '../lib/subscriptions'

const STATUS_STYLES = {
active:'bg-success-soft text-success-soft-foreground',
cancelled:'bg-danger-soft text-danger-soft-foreground',
expired:'bg-surface-tertiary text-muted',
past_due:'bg-warning-soft text-warning-soft-foreground',
}

const STATUS_LABEL_KEYS = {
  active: 'services.statusActive',
  cancelled: 'services.statusCancelled',
  expired: 'services.statusExpired',
  past_due: 'services.statusPastDue',
}

export default function SubscriptionsPage() {
  const { t, toastSuccess, toastError } = useAppStore()
  const { hasPermission } = useUserStore()
  const canEdit = hasPermission(PERMISSIONS.SERVICES_EDIT)
  const [subscriptions, setSubscriptions] = useState([])
  const [services, setServicesList] = useState([])
  const [plans, setPlansList] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [showPayments, setShowPayments] = useState(null)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [renewTarget, setRenewTarget] = useState(null)
  // Subscription whose barcode label is open; the row checkbox reflects it.
  const [barcodeTarget, setBarcodeTarget] = useState(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate trigger list: the loader below is re-created each render and is intentionally NOT a dep, so only these inputs refetch
  useEffect(() => { fetchData() }, [filterStatus])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [subRes, svcRes, planRes, custRes] = await Promise.all([
        subscriptionsApi.getAll(filterStatus ? { status: filterStatus } : {}),
        servicesApi.getAll(),
        servicePlansApi.getAll(),
        customersApi.getAll(),
      ])
      setSubscriptions(subRes.data)
      setServicesList(svcRes.data)
      setPlansList(planRes.data)
      setCustomers(custRes.data)
    } catch (err) {
      console.error('Failed to fetch data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async (id) => {
    try {
      await subscriptionsApi.cancel(id)
      setCancelTarget(null)
      toastSuccess(t('services.subscriptionCancelled') || 'Subscription cancelled')
      fetchData()
    } catch (err) {
      console.error('Failed to cancel:', err)
      toastError(err.response?.data?.error || t('common.error') || 'Error')
    }
  }

  const handleRenew = async (id) => {
    try {
      await subscriptionsApi.renew(id)
      setRenewTarget(null)
      toastSuccess(t('services.subscriptionRenewed') || 'Subscription renewed')
      fetchData()
    } catch (err) {
      console.error('Failed to renew:', err)
      toastError(err.response?.data?.error || t('common.error') || 'Error')
    }
  }

  const handleDelete = async (id) => {
    setDeleting(true)
    try {
      await subscriptionsApi.delete(id)
      setDeleteTarget(null)
      toastSuccess(t('services.subscriptionDeleted') || 'Subscription deleted')
      fetchData()
    } catch (err) {
      console.error('Failed to delete:', err)
      toastError(t('common.error') || 'Error')
    } finally {
      setDeleting(false)
    }
  }

  const barcodeValid = isSubscriptionValid(barcodeTarget)

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('services.subscriptionsTitle') || 'Subscriptions'}</h1>
<p className="text-muted">{t('services.subscriptionsSubtitle')||'Manage customer subscriptions'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/subscriptions/check"
            className="flex items-center gap-2 px-4 py-2 bg-surface-tertiary text-foreground rounded-lg hover:bg-surface-hover"
          >
            <ScanBarcode className="w-4 h-4" />{t('services.checkSubscription') || 'Check Barcode'}
          </Link>
          {canEdit && (
            <button onClick={() => { setEditing(null); setShowForm(true) }}
className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-primary-700">
              <Plus className="w-4 h-4" />{t('services.addSubscription') || 'Add Subscription'}
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {['', 'active', 'expired', 'cancelled', 'past_due'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filterStatus===s ?'bg-accent text-white':'bg-surface-tertiary text-muted bg-surface-hover'}`}>
            {s ? t(STATUS_LABEL_KEYS[s]) || s : t('services.all') || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
<div className="text-center py-8 text-muted">{t('common.loading')||'Loading...'}</div>
      ) : subscriptions.length === 0 ? (
<div className="text-center py-12 bg-surface-secondary rounded-xl">
<CreditCard className="w-12 h-12 mx-auto text-foreground mb-3"/>
<p className="text-muted">{t('services.noSubscriptions')||'No subscriptions yet'}</p>
        </div>
      ) : (
<div className="bg-surface border border-border shadow-sm rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
<tr className="border-b border-border">
<th className="p-4 w-10"><span className="sr-only">{t('services.getBarcode') || 'Get barcode'}</span></th>
<th className="text-start p-4 font-medium text-muted">{t('services.customer')||'Customer'}</th>
<th className="text-start p-4 font-medium text-muted">{t('services.plan')||'Plan'}</th>
<th className="text-start p-4 font-medium text-muted">{t('services.amount')||'Amount'}</th>
<th className="text-start p-4 font-medium text-muted">{t('services.startDate')||'Start'}</th>
<th className="text-start p-4 font-medium text-muted">{t('services.endDate')||'End'}</th>
<th className="text-start p-4 font-medium text-muted">{t('services.validity')||'Validity'}</th>
<th className="text-start p-4 font-medium text-muted">{t('services.status')||'Status'}</th>
{canEdit &&<th className="text-end p-4 font-medium text-muted">{t('common.actions')||'Actions'}</th>}
                </tr>
              </thead>
              <tbody>
                {subscriptions.map(sub => {
                  const valid = isSubscriptionValid(sub)
                  return (
<tr key={sub.id}className="border-b border-border bg-surface-hover">
                    <td className="p-4">
                      {/* Tick to get this subscription's barcode label */}
                      <input
                        type="checkbox"
                        checked={barcodeTarget?.id === sub.id}
                        onChange={(e) => setBarcodeTarget(e.target.checked ? sub : null)}
                        title={t('services.getBarcode') || 'Get barcode'}
                        aria-label={`${t('services.getBarcode') || 'Get barcode'}: ${sub.customer?.name || sub.id}`}
                        className="rounded cursor-pointer"
                      />
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
<User className="w-4 h-4 text-muted"/>
                        {sub.customer?.name || '-'}
                      </div>
                    </td>
                    <td className="p-4">{sub.plan?.name || '-'}</td>
                    <td className="p-4 font-semibold">{sub.billing_amount?.toLocaleString()} {t('common.currency') || 'EGP'}</td>
                    <td className="p-4">{sub.start_date}</td>
                    <td className="p-4">{sub.end_date || '-'}</td>
                    <td className="p-4">
                      {/* Computed: status alone can be stale (nothing
                          auto-expires rows past their end_date). */}
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${valid ? 'bg-success-soft text-success-soft-foreground' : 'bg-danger-soft text-danger-soft-foreground'}`}>
                        {valid ? (t('services.valid') || 'Valid') : (t('services.statusExpired') || 'Expired')}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[sub.status] || ''}`}>
                        {t(STATUS_LABEL_KEYS[sub.status]) || sub.status}
                      </span>
                    </td>
                    {canEdit && (
                      <td className="p-4">
                        <div className="flex items-center justify-end gap-1">
                          {sub.status === 'active' && (
                            <>
                              <button onClick={() => setRenewTarget(sub.id)} title={t('services.renew')}
className="p-1.5 text-muted hover:text-green-600 rounded-lg"><RefreshCw className="w-4 h-4"/></button>
                              <button onClick={() => setCancelTarget(sub.id)} title={t('services.cancel')}
className="p-1.5 text-muted hover:text-red-600 rounded-lg"><Ban className="w-4 h-4"/></button>
                            </>
                          )}
                          <button onClick={() => { setEditing(sub); setShowForm(true) }} title={t('services.edit')}
className="p-1.5 text-muted hover:text-primary-600 rounded-lg"><Edit2 className="w-4 h-4"/></button>
                          <button onClick={() => setShowPayments(sub.id)} title={t('services.payments')}
className="p-1.5 text-muted hover:text-blue-600 rounded-lg"><CreditCard className="w-4 h-4"/></button>
                          <button onClick={() => setDeleteTarget(sub.id)} title={t('services.delete')}
className="p-1.5 text-muted hover:text-red-600 rounded-lg"><Trash2 className="w-4 h-4"/></button>
                        </div>
                      </td>
                    )}
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <SubscriptionForm
          subscription={editing} services={services} plans={plans} customers={customers}
          onSave={async (data) => {
            if (editing) await subscriptionsApi.update(editing.id, data)
            else await subscriptionsApi.create(data)
            setShowForm(false); setEditing(null); fetchData()
          }} onClose={() => { setShowForm(false); setEditing(null) }} />
      )}
      {showPayments && <PaymentsModal subscriptionId={showPayments} onClose={() => setShowPayments(null)} onRecord={async (data) => {
        try {
          await subscriptionsApi.recordPayment(showPayments, data)
          setShowPayments(null)
          toastSuccess(t('services.paymentRecorded') || 'Payment recorded')
        } catch (err) {
          toastError(err.response?.data?.error || t('common.error') || 'Error')
        }
      }} />}
      {barcodeTarget && (
        <BarcodePrinter
          product={{
            id: barcodeTarget.id,
            name: [barcodeTarget.customer?.name, barcodeTarget.plan?.name || barcodeTarget.service?.name]
              .filter(Boolean).join(' — ') || t('barcode.unknownProduct'),
            barcode: subscriptionBarcode(barcodeTarget),
            price: Number(barcodeTarget.billing_amount) || 0,
          }}
          note={barcodeValid ? (t('services.valid') || 'Valid') : (t('services.statusExpired') || 'Expired')}
          noteClass={barcodeValid ? 'text-success' : 'text-danger'}
          onClose={() => setBarcodeTarget(null)}
        />
      )}
      <ConfirmModal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => handleDelete(deleteTarget)}
        title={t('services.deleteSubscription') || 'Delete Subscription'} message={t('services.deleteSubConfirm') || 'Are you sure?'} type="danger" loading={deleting} />
      <ConfirmModal open={!!cancelTarget} onClose={() => setCancelTarget(null)} onConfirm={() => handleCancel(cancelTarget)}
        title={t('services.cancelSubscription') || 'Cancel Subscription'} message={t('services.cancelSubConfirm') || 'Are you sure you want to cancel this subscription?'} type="danger" />
      <ConfirmModal open={!!renewTarget} onClose={() => setRenewTarget(null)} onConfirm={() => handleRenew(renewTarget)}
        title={t('services.renewSubscription') || 'Renew Subscription'} message={t('services.renewSubConfirm') || 'Are you sure you want to renew this subscription?'} type="info" />
    </div>
  )
}

function SubscriptionForm({ subscription, plans, customers, onSave, onClose }) {
  const { t, toastError } = useAppStore()
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({
    customer_id: subscription?.customer_id || '',
    plan_id: subscription?.plan_id || '',
    start_date: subscription?.start_date || today,
    end_date: subscription?.end_date || '',
    next_billing_date: subscription?.next_billing_date || '',
    auto_renew: subscription?.auto_renew !== false,
    billing_amount: subscription?.billing_amount || '',
    notes: subscription?.notes || '',
  })

  const selectedPlan = plans.find(p => p.id === parseInt(form.plan_id))

  const handlePlanChange = (planId) => {
    const plan = plans.find(p => p.id === parseInt(planId))
    setForm({
      ...form,
      plan_id: planId,
      billing_amount: plan?.price || form.billing_amount,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.customer_id) return toastError(t('services.selectCustomer') || 'Select customer')
    await onSave({
      ...form,
      billing_amount: parseFloat(form.billing_amount) || 0,
      customer_id: parseInt(form.customer_id),
      plan_id: form.plan_id ? parseInt(form.plan_id) : null,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
<div className="bg-surface rounded-2xl w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
<div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-xl font-semibold">{subscription ? t('services.editSubscription') : t('services.addSubscription')}</h2>
<button onClick={onClose}className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-surface-hover"><X className="w-5 h-5"/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t('services.customer') || 'Customer'} *</label>
            <SearchableSelect
              options={[{ value: '', label: t('services.selectCustomer') || 'Select customer' }, ...customers.map(c => ({ value: String(c.id), label: c.name }))]}
              value={form.customer_id}
              onChange={(v) => setForm({ ...form, customer_id: v })}
              placeholder={t('common.searchSelect')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('services.plan') || 'Plan'} *</label>
            <SearchableSelect
              options={[{ value: '', label: t('services.selectPlan') || 'Select plan' }, ...plans.map(p => ({ value: String(p.id), label: `${p.name} - ${p.price?.toLocaleString()} ${t('common.currency') || 'EGP'} (${p.billing_cycle})` }))]}
              value={form.plan_id}
              onChange={(v) => handlePlanChange(v)}
              placeholder={t('common.searchSelect')}
            />
            {selectedPlan && (
<p className="text-xs text-muted mt-1">
                {selectedPlan.duration_months} {t('services.months') || 'months'} | {selectedPlan.billing_cycle}
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t('services.startDate') || 'Start Date'} *</label>
              <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} required
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"/>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('services.endDate') || 'End Date'}</label>
              <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"/>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t('services.nextBilling') || 'Next Billing'}</label>
              <input type="date" value={form.next_billing_date} onChange={e => setForm({ ...form, next_billing_date: e.target.value })}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"/>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('services.amount') || 'Amount'} *</label>
              <input type="number" step="0.01" min="0" value={form.billing_amount} onChange={e => setForm({ ...form, billing_amount: e.target.value })} required
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"/>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="auto_renew" checked={form.auto_renew} onChange={e => setForm({ ...form, auto_renew: e.target.checked })}
className="w-4 h-4 text-accent rounded"/>
            <label htmlFor="auto_renew" className="text-sm">{t('services.autoRenew') || 'Auto Renew'}</label>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('services.notes') || 'Notes'}</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"/>
          </div>
          <div className="flex justify-end gap-3 pt-2">
<button type="button"onClick={onClose}className="px-4 py-2 text-foreground bg-surface-tertiary rounded-lg bg-surface-hover">{t('common.cancel')}</button>
<button type="submit"className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-primary-700">{t('common.save')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function PaymentsModal({ subscriptionId, onClose, onRecord }) {
  const { t } = useAppStore()
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showPayForm, setShowPayForm] = useState(false)
  const [form, setForm] = useState({ amount: '', payment_method: 'cash', notes: '' })
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    subscriptionsApi.getPayments(subscriptionId).then(({ data }) => {
      setPayments(data); setLoading(false)
    }).catch(() => setLoading(false))
  }, [subscriptionId])

  const handleRecord = async (e) => {
    e.preventDefault()
    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) return
    setRecording(true)
    try {
      await onRecord({ ...form, amount })
      setForm({ amount: '', payment_method: 'cash', notes: '' })
      setShowPayForm(false)
      const { data } = await subscriptionsApi.getPayments(subscriptionId)
      setPayments(data)
    } finally {
      setRecording(false)
    }
  }

  const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
<div className="bg-surface rounded-2xl w-full max-w-md mx-4 shadow-2xl">
<div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-xl font-semibold">{t('services.payments') || 'Payments'}</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowPayForm(!showPayForm)}
className="px-3 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-primary-700">
              <Plus className="w-4 h-4 inline mr-1" />{t('services.recordPayment') || 'Record Payment'}
            </button>
<button onClick={onClose}className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-surface-hover"><X className="w-5 h-5"/></button>
          </div>
        </div>
        <div className="p-4 max-h-96 overflow-y-auto">
          {showPayForm && (
<form onSubmit={handleRecord}className="mb-4 p-3 bg-surface-secondary rounded-lg space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input type="number" step="0.01" min="0.01" placeholder={t('services.amount') || 'Amount'} value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })} required
className="px-3 py-2 rounded-lg border border-border bg-surface text-sm"/>
                <SearchableSelect
                  options={[{ value: 'cash', label: t('payments.cash') || 'Cash' }, { value: 'card', label: t('payments.card') || 'Card' }, { value: 'bank', label: t('payments.bank') || 'Bank Transfer' }]}
                  value={form.payment_method}
                  onChange={(v) => setForm({ ...form, payment_method: v })}
                  placeholder={t('common.searchSelect')}
                />
              </div>
              <button type="submit" disabled={recording}
className="w-full px-3 py-2 bg-accent text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50">
                {recording ? (t('common.processing') || 'Processing...') : (t('common.save'))}
              </button>
            </form>
          )}
          {loading ? (
<div className="text-center py-4 text-muted">{t('common.loading')}</div>
          ) : payments.length === 0 ? (
<div className="text-center py-6 text-muted">{t('services.noPayments')||'No payments yet'}</div>
          ) : (
            <>
<div className="flex justify-between items-center mb-3 p-3 bg-accent-soft rounded-lg">
                <span className="text-sm font-medium">{t('services.totalPaid') || 'Total Paid'}</span>
<span className="text-lg font-bold text-accent">{totalPaid.toLocaleString()}{t('common.currency')||'EGP'}</span>
              </div>
              <div className="space-y-2">
                {payments.map(p => (
<div key={p.id}className="flex items-center justify-between p-3 bg-surface-secondary rounded-lg">
                    <div>
                      <div className="font-medium">{p.amount?.toLocaleString()} {t('common.currency') || 'EGP'}</div>
<div className="text-xs text-muted">{p.payment_date}-{p.payment_method}</div>
                    </div>
<span className={`text-xs px-2 py-0.5 rounded-full ${p.status==='paid'?'bg-success-soft text-success-soft-foreground':'bg-warning-soft text-warning-soft-foreground'}`}>
                      {p.status === 'paid' ? t('services.paymentPaid') : p.status === 'pending' ? t('services.paymentPending') : t('services.paymentFailed')}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
