import ConfirmModal from '../components/ConfirmModal'
import SearchableSelect from '../components/SearchableSelect'
import { X, Plus, Edit2, Trash2, CreditCard, Repeat, Power, Users, ExternalLink } from 'lucide-react'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { useUserStore, PERMISSIONS } from '../stores/userStore'
import { servicePlansApi, subscriptionsApi } from '../lib/api'
import { isSubscriptionValid } from '../lib/subscriptions'

const BILLING_CYCLE_KEYS = {
  monthly: 'services.monthly',
  annual: 'services.annual',
  one_time: 'services.oneTime',
}

export default function ServicePlansPage() {
  const { t, language, toastSuccess, toastError } = useAppStore()
  const { hasPermission } = useUserStore()
  const canEdit = hasPermission(PERMISSIONS.SERVICES_EDIT)
  const [plans, setPlans] = useState([])
  const [subscriptions, setSubscriptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('name')
  // Plan whose detail drawer is open (click its name on the card).
  const [detailPlan, setDetailPlan] = useState(null)

  useEffect(() => { fetchPlans() }, [])

  const fetchPlans = async () => {
    setLoading(true)
    try {
      const [planRes, subRes] = await Promise.all([
        servicePlansApi.getAll(),
        // Drives the per-plan subscriber chips and the summary card; the
        // page still renders if this call fails.
        subscriptionsApi.getAll({}).catch(() => ({ data: [] })),
      ])
      setPlans(planRes.data)
      setSubscriptions(subRes.data || [])
    } catch (err) {
      console.error('Failed to fetch plans:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id) => {
    setDeleting(true)
    try {
      await servicePlansApi.delete(id)
      setDeleteTarget(null)
      toastSuccess(t('common.success'))
      fetchPlans()
    } catch (err) {
      // 409 = subscriptions still reference this plan; the server refuses
      // because ON DELETE SET NULL would blank their history.
      const msg = err.response?.status === 409
        ? (t('services.planInUse') || 'In use').replace('{count}', err.response.data?.subscription_count ?? '?')
        : err.response?.data?.error || t('common.error') || 'Error'
      toastError(msg)
    } finally {
      setDeleting(false)
    }
  }

  // POS hides plans with is_active === false — this toggle is the admin
  // side of that filter.
  const handleToggleActive = async (plan) => {
    try {
      await servicePlansApi.update(plan.id, { is_active: plan.is_active === false })
      fetchPlans()
    } catch (err) {
      toastError(err.response?.data?.error || t('common.error') || 'Error')
    }
  }

  // Client-side search + sort: the catalogue is small and fully fetched.
  const q = searchQuery.trim().toLowerCase()
  const filtered = q
    ? plans.filter((p) => [p.name, p.name_ar, p.description].some((v) => v && v.toLowerCase().includes(q)))
    : plans
  const visible = [...filtered].sort((a, b) => {
    if (sortBy === 'price_desc') return (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0)
    if (sortBy === 'newest') return new Date(b.created_at || 0) - new Date(a.created_at || 0)
    return (a.name || '').localeCompare(b.name || '')
  })

  const activeCount = plans.filter((p) => p.is_active !== false).length
  // Validity-aware: ended/cancelled rows are history, not subscribers —
  // same rule the server's delete guard reports.
  const isSubscriber = (s) => isSubscriptionValid(s)
  const totalSubscribers = subscriptions.filter(isSubscriber).length
  const subscriberCount = (planId) => subscriptions.filter((s) => s.plan_id === planId && isSubscriber(s)).length

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('services.plansTitle') || 'Service Plans'}</h1>
<p className="text-muted">{t('services.plansSubtitle')||'Manage service packages and pricing'}</p>
        </div>
        {canEdit && (
          <button onClick={() => { setEditing(null); setShowForm(true) }}
className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-primary-700">
            <Plus className="w-4 h-4" />{t('services.addPlan') || 'Add Plan'}
          </button>
        )}
      </div>

      {/* Summary cards: plans / active / tenant-wide subscribers */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-surface rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <CreditCard className="w-4 h-4 text-accent" /> {t('services.plansCount')}
          </div>
          <p className="text-xl font-bold">{plans.length}</p>
        </div>
        <div className="bg-surface rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <Power className="w-4 h-4 text-success" /> {t('services.statusActive')}
          </div>
          <p className="text-xl font-bold text-success">{activeCount}</p>
        </div>
        <div className="bg-surface rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <Users className="w-4 h-4 text-accent" /> {t('services.subscribers')}
          </div>
          <p className="text-xl font-bold">{totalSubscribers}</p>
        </div>
      </div>

      {/* Search + sort */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder={t('services.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 min-w-0 px-4 py-2 rounded-lg border border-border bg-surface"
        />
        <SearchableSelect
          options={[
            { value: 'name', label: t('services.sortName') },
            { value: 'price_desc', label: t('services.sortPrice') },
            { value: 'newest', label: t('services.sortNewest') },
          ]}
          value={sortBy}
          onChange={(v) => setSortBy(v)}
          placeholder={t('common.searchSelect')}
          className="w-full sm:w-56 px-4 py-2 rounded-lg border border-border bg-surface outline-none"
        />
      </div>

      {loading ? (
<div className="text-center py-8 text-muted">{t('common.loading')||'Loading...'}</div>
      ) : plans.length === 0 ? (
<div className="text-center py-12 bg-surface-secondary rounded-xl">
<CreditCard className="w-12 h-12 mx-auto text-foreground mb-3"/>
<p className="text-muted">{t('services.noPlans')||'No plans yet'}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 bg-surface-secondary rounded-xl">
          <p className="text-muted">{t('services.noMatches')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map(plan => {
            const cycleKey = BILLING_CYCLE_KEYS[plan.billing_cycle] || BILLING_CYCLE_KEYS.monthly
            const cycleLabel = t(cycleKey)
            const features = Array.isArray(plan.features) ? plan.features : []
            return (
<div key={plan.id}className={`bg-surface border border-border shadow-sm rounded-xl p-5 ${plan.is_active === false ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3
                        className="font-semibold text-lg cursor-pointer hover:text-accent"
                        onClick={() => setDetailPlan(plan)}
                      >{language === 'ar' && plan.name_ar ? plan.name_ar : plan.name}</h3>
                      {plan.is_active === false && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-surface-tertiary text-muted font-medium">{t('services.inactive')}</span>
                      )}
                    </div>
                    {plan.name_ar && plan.name_ar !== plan.name && (
                      <div className="text-xs text-muted">{language === 'ar' ? plan.name : plan.name_ar}</div>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
<span className="text-xs px-2 py-0.5 rounded-full bg-accent-soft text-accent-soft-foreground flex items-center gap-1">
                        <Repeat className="w-3 h-3" />{cycleLabel}
                      </span>
                      {plan.duration_months > 1 && (
<span className="text-xs px-2 py-0.5 rounded-full bg-surface-tertiary text-muted">
                          {plan.duration_months} {t('services.months') || 'months'}
                        </span>
                      )}
                      <span className="text-xs px-2 py-0.5 rounded-full bg-surface-tertiary text-muted flex items-center gap-1" title={t('services.subscribers')}>
                        <Users className="w-3 h-3" />{subscriberCount(plan.id)}
                      </span>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleToggleActive(plan)}
                        title={plan.is_active === false ? t('services.activate') : t('services.deactivate')}
                        className="p-1.5 text-muted hover:text-green-600 rounded-lg"
                      >
                        <Power className="w-4 h-4"/>
                      </button>
<button onClick={()=>{setEditing(plan);setShowForm(true)}}className="p-1.5 text-muted hover:text-primary-600 rounded-lg"><Edit2 className="w-4 h-4"/></button>
<button onClick={()=>setDeleteTarget(plan.id)}className="p-1.5 text-muted hover:text-red-600 rounded-lg"><Trash2 className="w-4 h-4"/></button>
                    </div>
                  )}
                </div>
{plan.description &&<p className="text-sm text-muted mb-3">{plan.description}</p>}
                {features.length > 0 && (
                  <ul className="mb-3 space-y-1">
                    {features.map((f, i) => (
<li key={i}className="text-sm text-muted flex items-center gap-2">
<span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0"/>{f}
                      </li>
                    ))}
                  </ul>
                )}
<div className="text-2xl font-bold text-accent">
                  {plan.price?.toLocaleString()} {t('common.currency') || 'EGP'}
<span className="text-sm font-normal text-muted">/{cycleLabel}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <PlanForm plan={editing} onSave={async (data) => {
          try {
            if (editing) await servicePlansApi.update(editing.id, data)
            else await servicePlansApi.create(data)
            toastSuccess(t('common.success'))
            setShowForm(false); setEditing(null); fetchPlans()
          } catch (err) {
            toastError(err.response?.data?.error || t('common.error') || 'Error')
          }
        }} onClose={() => { setShowForm(false); setEditing(null) }} />
      )}
      <ConfirmModal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => handleDelete(deleteTarget)}
        title={t('services.deletePlan') || 'Delete Plan'} message={t('services.deletePlanConfirm') || 'Are you sure?'} type="danger" loading={deleting} />
      {detailPlan && (
        <PlanDetailDrawer plan={detailPlan} subscriptions={subscriptions} onClose={() => setDetailPlan(null)} />
      )}
    </div>
  )
}

// Detail drawer for a plan: subscriber list, collected revenue and
// features, plus the cross-link into the filtered Subscriptions page.
// Payment history is fetched lazily so the grid never pays for it.
function PlanDetailDrawer({ plan, subscriptions, onClose }) {
  const { t, language } = useAppStore()
  const [paid, setPaid] = useState(null)

  useEffect(() => {
    let alive = true
    subscriptionsApi.getAllPayments()
      .then(({ data }) => {
        if (!alive) return
        const total = (data || [])
          .filter((p) => Number(p.subscription?.plan_id) === Number(plan.id))
          .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0)
        setPaid(total)
      })
      .catch(() => { if (alive) setPaid(0) })
    return () => { alive = false }
  }, [plan.id])

  const cycleLabel = t(BILLING_CYCLE_KEYS[plan.billing_cycle] || BILLING_CYCLE_KEYS.monthly)
  const mine = subscriptions.filter((s) => Number(s.plan_id) === Number(plan.id))
  // Wrapped: filter passes the index as arg 2, which would clobber the
  // isSubscriptionValid(sub, today) default parameter.
  const live = mine.filter((s) => isSubscriptionValid(s))
  const features = Array.isArray(plan.features) ? plan.features : []

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-surface shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-accent-soft rounded-lg"><CreditCard className="w-5 h-5 text-accent" /></div>
              <div>
                <h2 className="text-xl font-bold text-foreground">{language === 'ar' && plan.name_ar ? plan.name_ar : plan.name}</h2>
                <p className="text-sm text-muted">{cycleLabel} · {plan.price?.toLocaleString()} {t('common.currency')}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2.5 rounded-lg bg-surface-hover min-w-[44px] min-h-[44px] flex items-center justify-center"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface-secondary rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted mb-1"><Users className="w-3.5 h-3.5" />{t('services.subscribers')}</div>
              <p className="text-lg font-bold">{live.length}</p>
            </div>
            <div className="bg-surface-secondary rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted mb-1"><CreditCard className="w-3.5 h-3.5" />{t('services.totalPaid')}</div>
              <p className="text-lg font-bold">{paid === null ? '—' : `${paid.toLocaleString()} ${t('common.currency')}`}</p>
            </div>
            <div className="bg-surface-secondary rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted mb-1"><Repeat className="w-3.5 h-3.5" />{t('services.price')}</div>
              <p className="text-lg font-bold">{plan.price?.toLocaleString()} {t('common.currency')}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="px-2 py-1 rounded-full bg-accent-soft text-accent-soft-foreground text-xs flex items-center gap-1"><Repeat className="w-3 h-3" />{cycleLabel}</span>
            {plan.duration_months > 1 && (
              <span className="px-2 py-1 rounded-full bg-surface-tertiary text-muted text-xs">{plan.duration_months} {t('services.months')}</span>
            )}
            {plan.is_active === false && (
              <span className="px-2 py-1 rounded-full bg-surface-tertiary text-muted text-xs font-medium">{t('services.inactive')}</span>
            )}
          </div>

          {features.length > 0 && (
            <ul className="space-y-1">
              {features.map((f, i) => (
                <li key={i} className="text-sm text-muted flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />{f}</li>
              ))}
            </ul>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">{t('services.subscribers')}</h3>
              <Link to={`/subscriptions?plan=${plan.id}`} className="flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
                <ExternalLink className="w-3.5 h-3.5" />
                {t('customers.viewSubscriptions')}
              </Link>
            </div>
            {mine.length === 0 ? (
              <p className="text-sm text-muted">{t('services.noSubscriptions')}</p>
            ) : (
              <div className="space-y-2">
                {mine.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 p-3 bg-surface-secondary rounded-xl text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{s.customer?.name || `#${s.id}`}</div>
                      <div className="text-xs text-muted">{s.start_date} → {s.end_date || '—'}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="font-semibold">{s.billing_amount?.toLocaleString()} {t('common.currency')}</span>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${isSubscriptionValid(s) ? 'bg-success-soft text-success-soft-foreground' : 'bg-danger-soft text-danger-soft-foreground'}`}>
                        {isSubscriptionValid(s) ? t('services.valid') : t('services.statusExpired')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function PlanForm({ plan, onSave, onClose }) {
  const { t } = useAppStore()
  const [form, setForm] = useState({
    name: plan?.name || '',
    name_ar: plan?.name_ar || '',
    description: plan?.description || '',
    price: plan?.price || '',
    billing_cycle: plan?.billing_cycle || 'monthly',
    duration_months: plan?.duration_months || 1,
    features: Array.isArray(plan?.features) ? plan.features.join('\n') : '',
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    const features = form.features.split('\n').map(f => f.trim()).filter(Boolean)
    await onSave({ ...form, price: parseFloat(form.price) || 0, duration_months: parseInt(form.duration_months) || 1, features })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
<div className="bg-surface rounded-2xl w-full max-w-md mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
<div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-xl font-semibold">{plan ? t('services.editPlan') : t('services.addPlan')}</h2>
<button onClick={onClose}className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-surface-hover"><X className="w-5 h-5"/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t('services.name') || 'Name'} *</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"/>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('services.nameAr')}</label>
            <input type="text" value={form.name_ar} onChange={e => setForm({ ...form, name_ar: e.target.value })} dir="rtl"
className="w-full px-4 py-2 rounded-lg border border-border bg-surface" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('services.description') || 'Description'}</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"/>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t('services.price') || 'Price'} *</label>
              <input type="number" step="0.01" min="0" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} required
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"/>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('services.billingCycle') || 'Billing Cycle'}</label>
              <SearchableSelect
                options={[{ value: 'monthly', label: t('services.monthly') || 'Monthly' }, { value: 'annual', label: t('services.annual') || 'Annual' }, { value: 'one_time', label: t('services.oneTime') || 'One Time' }]}
                value={form.billing_cycle}
                onChange={(v) => setForm({ ...form, billing_cycle: v })}
                placeholder={t('common.searchSelect')}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('services.durationMonths') || 'Duration (months)'}</label>
            <input type="number" min="1" value={form.duration_months} onChange={e => setForm({ ...form, duration_months: e.target.value })}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"/>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('services.features') || 'Features (one per line)'}</label>
            <textarea value={form.features} onChange={e => setForm({ ...form, features: e.target.value })} rows={4}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
              placeholder={t('services.featuresPlaceholder')} />
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
