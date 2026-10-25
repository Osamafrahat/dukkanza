import ConfirmModal from '../components/ConfirmModal'
import SearchableSelect from '../components/SearchableSelect'
import SupportTab from '../components/superadmin/SupportTab'
import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../stores/appStore'
import { useUserStore } from '../stores/userStore'
import { superAdminApi } from '../lib/api'
import { Search, Shield, Building2, Users, Package, TrendingUp, AlertTriangle, CheckCircle, Plus, Trash2, LogIn, DollarSign, Edit3, X, Save, Eye, Activity, BarChart3, CreditCard, Megaphone, Upload, Link2, Wallet, RefreshCw, Loader2, Mail } from 'lucide-react'

const tierColors = {
free:'bg-surface-tertiary text-foreground',
pro:'bg-accent-soft text-accent-soft-foreground',
enterprise:'bg-warning-soft text-warning-soft-foreground',
}

const statusColors = {
active:'bg-success-soft text-success-soft-foreground',
trialing:'bg-accent-soft text-accent-soft-foreground',
past_due:'bg-warning-soft text-warning-soft-foreground',
cancelled:'bg-danger-soft text-danger-soft-foreground',
}

function MiniBarChart({ data, height = 60 }) {
  const values = Object.values(data)
  const max = Math.max(...values, 1)
  return (
    <div className="flex items-end gap-0.5" style={{ height }}>
      {Object.entries(data).map(([day, val]) => (
        <div
          key={day}
className="flex-1 bg-accent rounded-t min-w-[4px] transition-all"
          style={{ height: `${(val / max) * 100}%` }}
          title={`${day}: ${val.toLocaleString()} EGP`}
        />
      ))}
    </div>
  )
}

export default function SuperAdminPage() {
  // Narrow selector: SessionTimeout writes `lastActivity` on every
  // mousemove/click, so subscribing to the whole store re-rendered this page
  // (and every tab) on every pointer move.
  const t = useAppStore((s) => s.t)
  const currentUser = useUserStore((s) => s.currentUser)
  const [tab, setTab] = useState('dashboard')
  const [toast, setToast] = useState(null)
  // useCallback: child tabs keep `showToast` in their fetch-effect deps, so an
  // unstable identity refired those effects on every parent render (infinite
  // refetch/loading loop on the Wallet Transfers tab). Declared before the
  // role-guard return below (rules of hooks require unconditional order).
  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // Wallet-tab badge: pending transfer count, refreshed on an interval while
  // the panel is open (declared before the role-guard return for the same
  // hook-ordering reason as showToast above).
  const [pendingCount, setPendingCount] = useState(0)
  const refreshPendingCount = useCallback(() => {
    superAdminApi
      .getWalletPendingCount()
      .then(({ data }) => setPendingCount(data?.count || 0))
      .catch(() => {}) // badge is decorative - never surface a poll error
  }, [])
  useEffect(() => {
    refreshPendingCount()
    const id = setInterval(refreshPendingCount, 45000)
    return () => clearInterval(id)
  }, [refreshPendingCount])

  if (currentUser?.role !== 'SUPER_ADMIN') {
    return (
<div className="flex flex-col items-center justify-center h-64 text-muted">
        <Shield className="w-12 h-12 mb-3 opacity-50" />
        <p className="text-lg font-medium">{t('admin.accessDenied') || 'Access Denied'}</p>
        <p className="text-sm">{t('admin.roleRequired') || 'Super Admin role required'}</p>
      </div>
    )
  }

  const tabs = [
    { key: 'dashboard', label: t('admin.tabDashboard') || 'Dashboard', icon: BarChart3 },
    { key: 'tenants', label: t('admin.tabTenants') || 'Tenants', icon: Building2 },
    { key: 'payments', label: t('admin.tabPayments') || 'Payments', icon: CreditCard },
    { key: 'wallet', label: t('admin.tabWallet') || 'Wallet Transfers', icon: Wallet },
    { key: 'plans', label: t('admin.tabPlans') || 'Plans', icon: DollarSign },
    { key: 'banners', label: t('admin.tabBanners') || 'Banners', icon: Megaphone },
    { key: 'support', label: t('admin.tabSupport') || 'Support', icon: Mail },
    { key: 'activity', label: t('admin.tabActivity') || 'Activity', icon: Activity },
  ]

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium ${
toast.type==='error'?'bg-danger text-white':'bg-success text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      <div>
<h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Shield className="w-6 h-6" />
          {t('admin.title') || 'Super Admin Panel'}
        </h1>
<p className="text-muted mt-1">
          {t('admin.subtitle') || 'Manage all tenants, payments, and subscriptions'}
        </p>
      </div>

<div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => {
              setTab(key)
              if (key === 'wallet') refreshPendingCount()
            }}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === key
?'border-accent text-accent'
:'border-transparent text-muted text-foreground'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
            {key === 'wallet' && pendingCount > 0 && (
              <span
                className="min-w-[1.25rem] px-1.5 py-0.5 text-[11px] font-bold leading-none text-white bg-danger rounded-full"
                aria-label={t('admin.pendingWalletTransfers') || 'Pending wallet transfers'}
              >
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab t={t} />}
      {tab === 'tenants' && <TenantsTab t={t} showToast={showToast} />}
      {tab === 'payments' && <PaymentsTab t={t} />}
      {tab === 'wallet' && <WalletPaymentsTab t={t} showToast={showToast} />}
      {tab === 'plans' && <PlansTab t={t} showToast={showToast} />}
      {tab === 'banners' && <BannersTab t={t} showToast={showToast} />}
      {tab === 'support' && <SupportTab t={t} showToast={showToast} />}
      {tab === 'activity' && <ActivityTab t={t} />}
    </div>
  )
}

function DashboardTab({ t }) {
  const [analytics, setAnalytics] = useState(null)
  const [period, setPeriod] = useState('30d')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    superAdminApi.getAnalytics({ period }).then(({ data }) => {
      setAnalytics(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [period])

if(loading)return<div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"/></div>
  if (!analytics) return null

  const fmt = (v) => `${(v || 0).toLocaleString()} ج.م`

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
<SearchableSelect options={[{value:'7d',label:t('admin.period7d')||'7 Days'},{value:'30d',label:t('admin.period30d')||'30 Days'},{value:'90d',label:t('admin.period90d')||'90 Days'}]} value={period} onChange={(v)=>setPeriod(v)} placeholder={t('common.searchSelect')} className="text-sm border border-border rounded-lg bg-surface text-foreground px-3 py-1.5"/>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
{label: t('admin.totalTenants')||'Total Tenants',value: analytics.total_tenants,icon: Building2,color:'text-muted'},
{label: t('admin.estimatedMRR')||'Est. MRR',value: fmt(analytics.estimated_mrr),icon: TrendingUp,color:'text-success'},
{label: t('admin.totalRevenue')||'Total Revenue',value: fmt(analytics.total_revenue),icon: DollarSign,color:'text-accent'},
{label: t('admin.periodRevenue')||'Period Revenue',value: fmt(analytics.period_revenue),icon: BarChart3,color:'text-accent'},
        ].map(({ label, value, icon: Icon, color }) => (
<div key={label}className="bg-surface rounded-xl p-4 border border-border">
            <div className="flex items-center gap-3">
              <Icon className={`w-5 h-5 ${color}`} />
              <div>
<p className="text-xs text-muted">{label}</p>
<p className="text-xl font-bold text-foreground">{value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
<div className="lg:col-span-2 bg-surface rounded-xl p-5 border border-border">
<h3 className="text-sm font-medium text-foreground mb-3">{t('admin.revenueChart')||'Revenue Chart'}</h3>
          {Object.keys(analytics.daily_revenue || {}).length > 0 ? (
            <>
              <MiniBarChart data={analytics.daily_revenue} height={80} />
<div className="flex justify-between mt-2 text-xs text-muted">
                <span>{Object.keys(analytics.daily_revenue)[0]}</span>
                <span>{Object.keys(analytics.daily_revenue).pop()}</span>
              </div>
            </>
          ) : (
<p className="text-sm text-muted py-8 text-center">{t('admin.noPayments')||'No revenue data yet'}</p>
          )}
        </div>

<div className="bg-surface rounded-xl p-5 border border-border">
<h3 className="text-sm font-medium text-foreground mb-3">{t('admin.tierDistribution')||'Tier Distribution'}</h3>
          <div className="space-y-3">
            {Object.entries(analytics.tier_distribution || {}).map(([tier, count]) => {
              const total = analytics.total_tenants || 1
              const pct = Math.round((count / total) * 100)
              return (
                <div key={tier}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tierColors[tier] || tierColors.free}`}>{tier}</span>
<span className="text-muted">{count}({pct}%)</span>
                  </div>
<div className="w-full bg-surface-tertiary rounded-full h-2">
<div className={`h-2 rounded-full ${tier==='pro'?'bg-accent': tier==='enterprise'?'bg-warning':'bg-surface-tertiary'}`}style={{width:`${pct}%`}}/>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
<div className="bg-surface rounded-xl p-5 border border-border">
<h3 className="text-sm font-medium text-foreground mb-3">{t('admin.recentTenants')||'Recent Tenants'}</h3>
          <div className="space-y-2">
            {(analytics.recent_tenants || []).map((tenant) => (
<div key={tenant.id}className="flex items-center justify-between py-2 px-3 bg-surface-secondary rounded-lg">
                <div>
<p className="text-sm font-medium text-foreground">{tenant.name}</p>
<p className="text-xs text-muted">{new Date(tenant.created_at).toLocaleDateString()}</p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tierColors[tenant.subscription_tier] || tierColors.free}`}>{tenant.subscription_tier}</span>
              </div>
            ))}
          </div>
        </div>

<div className="bg-surface rounded-xl p-5 border border-border">
<h3 className="text-sm font-medium text-foreground mb-3">{t('admin.successfulPayments')||'Payments Summary'}</h3>
          <div className="space-y-4">
<div className="flex justify-between items-center py-2 border-b border-border">
<span className="text-sm text-muted">{t('admin.totalOrders')||'Total Payments'}</span>
<span className="text-lg font-bold text-foreground">{analytics.total_payments}</span>
            </div>
<div className="flex justify-between items-center py-2 border-b border-border">
<span className="text-sm text-muted">{t('admin.successfulPayments')||'Successful'}</span>
<span className="text-lg font-bold text-success">{analytics.successful_payments}</span>
            </div>
            <div className="flex justify-between items-center py-2">
<span className="text-sm text-muted">{t('admin.successRate')||'Success Rate'}</span>
<span className="text-lg font-bold text-foreground">
                {analytics.total_payments > 0 ? Math.round((analytics.successful_payments / analytics.total_payments) * 100) : 0}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TenantsTab({ t, showToast }) {
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterTier, setFilterTier] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [actionLoading, setActionLoading] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [detailTenant, setDetailTenant] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const limit = 15

  const statusLabels = {
    active: t('billing.active') || 'Active',
    trialing: t('billing.trial') || 'Trial',
    cancelled: t('billing.cancelled') || 'Cancelled',
    past_due: t('billing.pastDue') || 'Past Due',
  }

  const fetchTenants = useCallback(async () => {
    try {
      const params = { page, limit }
      if (search) params.search = search
      if (filterStatus) params.status = filterStatus
      if (filterTier) params.tier = filterTier
      const { data } = await superAdminApi.getTenants(params)
      setTenants(data.tenants || [])
      setTotal(data.total || 0)
    } catch { setTenants([]) } finally { setLoading(false) }
  }, [page, search, filterStatus, filterTier])

  useEffect(() => { fetchTenants() }, [fetchTenants])

  const handleSearch = (e) => { setSearch(e.target.value); setPage(1) }

  const handleChangeTier = async (tenantId, newTier) => {
    setActionLoading(tenantId)
    try {
      await superAdminApi.updateTenant(tenantId, { subscription_tier: newTier })
      setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, subscription_tier: newTier } : t))
      showToast(t('admin.tierUpdated') || 'Tier updated')
    } catch (err) { showToast(err.response?.data?.error || (t('common.error') || 'Failed'), 'error') } finally { setActionLoading(null) }
  }

  const handleSuspend = async (tenantId, currentStatus) => {
    setActionLoading(tenantId)
    try {
      const newStatus = currentStatus === 'active' ? 'cancelled' : 'active'
      await superAdminApi.updateTenant(tenantId, { subscription_status: newStatus })
      setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, subscription_status: newStatus } : t))
      showToast(t('admin.tierUpdated') || 'Updated')
    } catch (err) { showToast(err.response?.data?.error || (t('common.error') || 'Failed'), 'error') } finally { setActionLoading(null) }
  }

  const handleImpersonate = async (tenantId) => {
    if (!window.confirm(t('admin.impersonateConfirm') || 'Login as this tenant admin?')) return
    setActionLoading(tenantId)
    try {
      const { data } = await superAdminApi.impersonate(tenantId)
      // Hydrate the store, not just localStorage: axios reads auth_token from
      // localStorage but every role/permission/nav check reads currentUser from
      // the store. The hard reload then rebuilds all consumers from that state.
      useUserStore.getState().impersonate(data.token, data.user, data.tenant)
      window.location.href = '/dashboard'
    } catch (err) { showToast(err.response?.data?.error || (t('common.error') || 'Failed'), 'error') } finally { setActionLoading(null) }
  }

  const handleDelete = async (tenantId, tenantName) => {
    setDeleteTarget({ id: tenantId, name: tenantName })
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setActionLoading(deleteTarget.id)
    try {
      await superAdminApi.deleteTenant(deleteTarget.id)
      setTenants(prev => prev.filter(t => t.id !== deleteTarget.id))
      showToast(t('admin.tenantDeleted') || 'Deleted')
    } catch (err) { showToast(err.response?.data?.error || (t('common.error') || 'Failed'), 'error') } finally { setActionLoading(null); setDeleteTarget(null) }
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <>
<div className="bg-surface rounded-xl border border-border">
<div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="relative flex-1 max-w-sm">
<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"/>
<input type="text"value={search}onChange={handleSearch}placeholder={t('admin.searchPlaceholder')||'Search...'}className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-surface text-foreground text-sm ring-focus outline-none"/>
          </div>
          <div className="flex gap-2">
<SearchableSelect options={[{value:'',label:t('admin.allStatuses')||'All Statuses'},{value:'active',label:t('billing.active')||'Active'},{value:'trialing',label:t('billing.trial')||'Trial'},{value:'cancelled',label:t('billing.cancelled')||'Cancelled'}]} value={filterStatus} onChange={(v)=>{setFilterStatus(v);setPage(1)}} placeholder={t('common.searchSelect')} className="text-sm border border-border rounded-lg bg-surface text-foreground px-3 py-2"/>
<SearchableSelect options={[{value:'',label:t('admin.allTiers')||'All Tiers'},{value:'free',label:t('pricing.free')||'Free'},{value:'pro',label:t('pricing.pro')||'Pro'},{value:'enterprise',label:t('pricing.enterprise')||'Enterprise'}]} value={filterTier} onChange={(v)=>{setFilterTier(v);setPage(1)}} placeholder={t('common.searchSelect')} className="text-sm border border-border rounded-lg bg-surface text-foreground px-3 py-2"/>
<button onClick={()=>setShowCreate(true)}className="flex items-center gap-1.5 px-3 py-2 bg-accent hover:bg-primary-700 text-white rounded-lg text-sm font-medium">
              <Plus className="w-4 h-4" /> {t('admin.createNew') || 'Create'}
            </button>
          </div>
        </div>

        {loading ? (
<div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"/></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
<tr className="text-left text-muted border-b border-border">
                  <th className="px-4 py-3 font-medium">{t('common.name') || 'Name'}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.tier') || 'Tier'}</th>
                  <th className="px-4 py-3 font-medium">{t('common.status') || 'Status'}</th>
                  <th className="px-4 py-3 font-medium">{t('common.users') || 'Users'}</th>
                  <th className="px-4 py-3 font-medium">{t('common.products') || 'Products'}</th>
                  <th className="px-4 py-3 font-medium">{t('common.orders') || 'Orders'}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.created') || 'Created'}</th>
                  <th className="px-4 py-3 font-medium">{t('admin.expires') || 'Expires'}</th>
                  <th className="px-4 py-3 font-medium">{t('common.actions') || 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
<tr key={tenant.id}className="border-b border-border bg-surface-hover">
<td className="px-4 py-3"><p className="font-medium text-foreground">{tenant.name}</p><p className="text-xs text-muted">{tenant.slug}</p></td>
                    <td className="px-4 py-3">
                      <SearchableSelect options={[{value:'free',label:t('pricing.free')||'Free'},{value:'pro',label:t('pricing.pro')||'Pro'},{value:'enterprise',label:t('pricing.enterprise')||'Enterprise'}]} value={tenant.subscription_tier} onChange={(v) => handleChangeTier(tenant.id, v)} disabled={actionLoading === tenant.id} placeholder={t('common.searchSelect')} className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${tierColors[tenant.subscription_tier] || tierColors.free}`}/>
                    </td>
                    <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColors[tenant.subscription_status] || statusColors.cancelled}`}>{statusLabels[tenant.subscription_status] || tenant.subscription_status}</span></td>
<td className="px-4 py-3 text-foreground"><Users className="w-3.5 h-3.5 inline mr-1"/>{tenant.user_count ?? 0}</td>
<td className="px-4 py-3 text-foreground"><Package className="w-3.5 h-3.5 inline mr-1"/>{tenant.product_count ?? 0}</td>
<td className="px-4 py-3 text-foreground">{tenant.order_count ?? 0}</td>
<td className="px-4 py-3 text-muted">{tenant.created_at ? new Date(tenant.created_at).toLocaleDateString():'—'}</td>
                    <td className="px-4 py-3">
                      {tenant.subscription_expires_at ? (
<span className={`text-xs font-medium ${new Date(tenant.subscription_expires_at)<new Date()?'text-danger':'text-foreground'}`}>
                          {new Date(tenant.subscription_expires_at).toLocaleDateString()}
                        </span>
                      ) : (
<span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
<button onClick={()=>setDetailTenant(tenant)}className="text-xs p-1.5 rounded-lg bg-surface-secondary text-muted bg-surface-hover"><Eye className="w-3.5 h-3.5"/></button>
<button onClick={()=>handleImpersonate(tenant.id)}disabled={actionLoading===tenant.id || tenant.subscription_status==='cancelled'}className="text-xs p-1.5 rounded-lg bg-accent-soft text-accent-soft-foreground hover:bg-blue-100 disabled:opacity-50"><LogIn className="w-3.5 h-3.5"/></button>
<button onClick={()=>handleSuspend(tenant.id,tenant.subscription_status)}disabled={actionLoading===tenant.id}className={`text-xs p-1.5 rounded-lg ${tenant.subscription_status==='active'?'bg-danger-soft text-danger-soft-foreground hover:bg-red-100':'bg-success-soft text-success-soft-foreground hover:bg-green-100'} disabled:opacity-50`}>
                          {tenant.subscription_status === 'active' ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
                        </button>
<button onClick={()=>handleDelete(tenant.id,tenant.name)}disabled={actionLoading===tenant.id}className="text-xs p-1.5 rounded-lg bg-danger-soft text-danger-soft-foreground hover:bg-red-100 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5"/></button>
                      </div>
                    </td>
                  </tr>
                ))}
{tenants.length===0 &&<tr><td colSpan={8}className="px-4 py-8 text-center text-muted">{t('admin.noTenants')||'No tenants found'}</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
<div className="p-4 border-t border-border flex items-center justify-between text-sm">
<span className="text-muted">{t('admin.showing')||'Showing'}{((page - 1)* limit)+ 1}–{Math.min(page * limit,total)}{t('admin.of')||'of'}{total}</span>
            <div className="flex gap-1">
<button onClick={()=>setPage(p=>Math.max(1,p - 1))}disabled={page===1}className="px-3 py-1 rounded border border-border disabled:opacity-50 text-foreground">{t('common.previous')||'Prev'}</button>
<span className="px-3 py-1 text-muted">{page}/{totalPages}</span>
<button onClick={()=>setPage(p=>Math.min(totalPages,p + 1))}disabled={page===totalPages}className="px-3 py-1 rounded border border-border disabled:opacity-50 text-foreground">{t('common.next')||'Next'}</button>
            </div>
          </div>
        )}
      </div>

      {showCreate && <CreateTenantModal t={t} showToast={showToast} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); fetchTenants() }} />}
      {detailTenant && <TenantDetailModal t={t} tenantId={detailTenant.id} onClose={() => setDetailTenant(null)} />}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={t('admin.deleteConfirm') || 'Delete Tenant'}
        message={deleteTarget ? `Delete "${deleteTarget.name}" and ALL its data? This cannot be undone.` : ''}
        confirmText={t('common.delete') || 'Delete'}
        type="danger"
      />
    </>
  )
}

function CreateTenantModal({ t, showToast, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', adminUsername: '', adminPassword: '', adminEmail: '', adminFullName: '', tier: 'free' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('')
    try { await superAdminApi.createTenant(form); showToast(t('admin.tenantCreated') || 'Created'); onCreated() }
    catch (err) { setError(err.response?.data?.error || (t('common.error') || 'Failed')) } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
<div className="bg-surface rounded-xl shadow-xl w-full max-w-md mx-4"onClick={(e)=>e.stopPropagation()}>
<div className="flex items-center justify-between p-4 border-b border-border">
<h2 className="text-lg font-semibold text-foreground">{t('admin.createNew')||'Create Tenant'}</h2>
<button onClick={onClose}className="text-muted text-foreground"><X className="w-5 h-5"/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
{error &&<p className="text-sm text-danger-soft-foreground bg-danger-soft p-2 rounded">{error}</p>}
<input value={form.name}onChange={(e)=>setForm({...form,name: e.target.value})}placeholder={t('admin.storeName')||'Store Name'}className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm"required />
<input value={form.adminFullName}onChange={(e)=>setForm({...form,adminFullName: e.target.value})}placeholder={t('admin.adminFullName')||'Admin Full Name'}className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm"required />
<input value={form.adminUsername}onChange={(e)=>setForm({...form,adminUsername: e.target.value})}placeholder={t('admin.adminUsername')||'Admin Username'}className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm"required />
<input value={form.adminEmail}onChange={(e)=>setForm({...form,adminEmail: e.target.value})}placeholder={t('admin.adminEmail')||'Admin Email'}type="email"className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm"required />
<input value={form.adminPassword}onChange={(e)=>setForm({...form,adminPassword: e.target.value})}placeholder={t('admin.adminPassword')||'Admin Password'}type="password"className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm"required minLength={8}/>
<SearchableSelect options={[{value:'free',label:t('pricing.free')||'Free'},{value:'pro',label:t('pricing.pro')||'Pro'},{value:'enterprise',label:t('pricing.enterprise')||'Enterprise'}]} value={form.tier} onChange={(v)=>setForm({...form,tier: v})} placeholder={t('common.searchSelect')} className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm"/>
          <div className="flex gap-2 justify-end pt-2">
<button type="button"onClick={onClose}className="px-4 py-2 text-sm text-foreground bg-surface-hover rounded-lg">{t('common.cancel')||'Cancel'}</button>
<button type="submit"disabled={loading}className="px-4 py-2 text-sm bg-accent hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">{loading ?'...':(t('common.add')||'Create')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function TenantDetailModal({ t, tenantId, onClose }) {
  const [tenant, setTenant] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    superAdminApi.getTenant(tenantId).then(({ data }) => setTenant(data)).catch(() => {}).finally(() => setLoading(false))
  }, [tenantId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
<div className="bg-surface rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] overflow-y-auto"onClick={(e)=>e.stopPropagation()}>
<div className="flex items-center justify-between p-4 border-b border-border">
<h2 className="text-lg font-semibold text-foreground">{t('admin.details')||'Tenant Details'}</h2>
<button onClick={onClose}className="text-muted text-foreground"><X className="w-5 h-5"/></button>
        </div>
{loading ?<div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"/></div>
        : tenant ? (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[{ label: t('common.users') || 'Users', value: tenant.user_count }, { label: t('common.products') || 'Products', value: tenant.product_count }, { label: t('common.orders') || 'Orders', value: tenant.order_count }, { label: t('admin.tier') || 'Tier', value: tenant.subscription_tier }].map(({ label, value }) => (
<div key={label}className="bg-surface-secondary rounded-lg p-3 text-center">
<p className="text-xs text-muted">{label}</p>
<p className="text-lg font-bold text-foreground">{value}</p>
                </div>
              ))}
            </div>
            {tenant.users?.length > 0 && (
<div><h3 className="text-sm font-medium text-foreground mb-2">{t('common.users')||'Users'}</h3>
                <div className="space-y-1">{tenant.users.map((u) => (
<div key={u.id}className="flex items-center justify-between text-sm py-1.5 px-3 bg-surface-secondary rounded-lg">
<div><span className="font-medium text-foreground">{u.username}</span><span className="text-muted ml-2">{u.role}</span></div>
<span className={`text-xs ${u.is_active ?'text-success':'text-danger'}`}>{u.is_active ?(t('common.active')||'Active'):(t('common.inactive')||'Inactive')}</span>
                  </div>
                ))}</div>
              </div>
            )}
            {tenant.recent_orders?.length > 0 && (
<div><h3 className="text-sm font-medium text-foreground mb-2">{t('admin.recentOrders')||'Recent Orders'}</h3>
                <div className="space-y-1">{tenant.recent_orders.map((o) => (
<div key={o.id}className="flex items-center justify-between text-sm py-1.5 px-3 bg-surface-secondary rounded-lg">
<span className="text-foreground">{o.order_number}</span><span className="text-muted">{o.total_amount}ج.م</span>
                  </div>
                ))}</div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function PaymentsTab({ t }) {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    superAdminApi.getPayments({ limit: 50, status: 'paid' }).then(({ data }) => {
      setPayments(data || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

if(loading)return<div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"/></div>

  return (
<div className="bg-surface rounded-xl border border-border">
<div className="p-4 border-b border-border flex items-center justify-between">
<h3 className="font-medium text-foreground">{t('billing.paymentHistory')||'Payment History'}</h3>
      </div>
      {payments.length === 0 ? (
<div className="p-8 text-center text-muted"><CreditCard className="w-8 h-8 mx-auto mb-2 opacity-50"/><p>{t('admin.noPayments')||'No payments recorded'}</p></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
<tr className="text-left text-muted border-b border-border">
                <th className="px-4 py-3 font-medium">{t('admin.tenant') || 'Tenant'}</th>
                <th className="px-4 py-3 font-medium">{t('common.amount') || 'Amount'}</th>
                <th className="px-4 py-3 font-medium">{t('common.status') || 'Status'}</th>
                <th className="px-4 py-3 font-medium">{t('common.date') || 'Date'}</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
<tr key={p.id}className="border-b border-border">
<td className="px-4 py-3"><p className="text-foreground">{p.tenant?.name ||(t('admin.unknown')||'Unknown')}</p><p className="text-xs text-muted">{p.tenant?.subscription_tier ||''}</p></td>
<td className="px-4 py-3 font-medium text-foreground">{(p.amount || 0).toLocaleString()}ج.م</td>
<td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-1 rounded-full ${p.status==='paid'?'bg-success-soft text-success-soft-foreground': p.status==='pending'?'bg-warning-soft text-warning-soft-foreground':'bg-danger-soft text-danger-soft-foreground'}`}>{p.status}</span></td>
<td className="px-4 py-3 text-muted">{p.created_at ? new Date(p.created_at).toLocaleString():'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Manual Egyptian-wallet transfer proofs (InstaPay / Vodafone Cash / ...)
// awaiting superadmin review. The screenshot itself is fetched per-row via
// the detail endpoint so the list stays light.
function WalletPaymentsTab({ t, showToast }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [selected, setSelected] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    superAdminApi.getWalletPayments({ status: statusFilter })
      .then(({ data }) => setRows(data?.requests || []))
      .catch((err) => showToast(err.response?.data?.error || (t('common.error') || 'Failed'), 'error'))
      .finally(() => setLoading(false))
  }, [statusFilter, showToast, t])

  useEffect(() => { load() }, [load])

  const openDetail = async (row) => {
    setSelected(null)
    setRejecting(false)
    setRejectReason('')
    setDetailLoading(true)
    try {
      const { data } = await superAdminApi.getWalletPayment(row.id)
      setSelected(data.request)
    } catch (err) {
      showToast(err.response?.data?.error || (t('common.error') || 'Failed'), 'error')
    } finally {
      setDetailLoading(false)
    }
  }

  const confirmRow = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await superAdminApi.confirmWalletPayment(selected.id)
      showToast(t('admin.walletConfirmed') || 'Payment confirmed and plan activated')
      setSelected(null)
      load()
    } catch (err) {
      showToast(err.response?.data?.error || (t('common.error') || 'Failed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const rejectRow = async () => {
    if (!selected) return
    if (!rejectReason.trim()) {
      showToast(t('admin.walletReasonRequired') || 'Please provide a rejection reason', 'error')
      return
    }
    setBusy(true)
    try {
      await superAdminApi.rejectWalletPayment(selected.id, { reason: rejectReason.trim() })
      showToast(t('admin.walletRejected') || 'Payment request rejected')
      setSelected(null)
      load()
    } catch (err) {
      showToast(err.response?.data?.error || (t('common.error') || 'Failed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const chip = (s) =>
    s === 'confirmed'
      ? 'bg-success-soft text-success-soft-foreground'
      : s === 'rejected'
        ? 'bg-danger-soft text-danger-soft-foreground'
        : 'bg-warning-soft text-warning-soft-foreground'

  const statusLabel = (s) =>
    s === 'confirmed'
      ? (t('admin.walletConfirmedTab') || 'Confirmed')
      : s === 'rejected'
        ? (t('admin.walletRejectedTab') || 'Rejected')
        : (t('admin.walletPendingTab') || 'Pending')

  return (
    <div className="bg-surface rounded-xl border border-border">
      <div className="p-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-medium text-foreground">{t('admin.walletTitle') || 'Wallet Transfer Payments'}</h3>
        <div className="flex items-center gap-2">
          {['pending', 'confirmed', 'rejected'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === s ? 'bg-accent text-white' : 'bg-surface-secondary text-muted hover:text-foreground'
              }`}
            >
              {statusLabel(s)}
            </button>
          ))}
          <button
            onClick={load}
            title={t('common.refresh') || 'Refresh'}
            className="p-1.5 rounded-lg bg-surface-secondary text-muted hover:text-foreground"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-muted">
          <Wallet className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>{t('admin.walletEmpty') || 'No wallet transfer requests'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="px-4 py-3 font-medium">{t('admin.tenant') || 'Tenant'}</th>
                <th className="px-4 py-3 font-medium">{t('admin.walletPlan') || 'Plan'}</th>
                <th className="px-4 py-3 font-medium">{t('common.amount') || 'Amount'}</th>
                <th className="px-4 py-3 font-medium">{t('admin.walletMethod') || 'Method'}</th>
                <th className="px-4 py-3 font-medium">{t('common.date') || 'Date'}</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border">
                  <td className="px-4 py-3">
                    <p className="text-foreground">{r.tenant?.name || (t('admin.unknown') || 'Unknown')}</p>
                    <p className="text-xs text-muted">{r.user?.full_name || r.user?.username || ''}</p>
                  </td>
                  <td className="px-4 py-3 text-foreground">{r.plan_slug} <span className="text-xs text-muted">({r.billing_period})</span></td>
                  <td className="px-4 py-3 font-medium text-foreground">{Number(r.amount_egp).toLocaleString()} ج.م</td>
                  <td className="px-4 py-3">
                    <p className="text-foreground">{r.wallet_type}</p>
                    {r.reference_note && <p className="text-xs text-muted break-all">{r.reference_note}</p>}
                  </td>
                  <td className="px-4 py-3 text-muted">{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full mr-2 ${chip(r.status)}`}>{statusLabel(r.status)}</span>
                    <button
                      onClick={() => openDetail(r)}
                      className="text-xs font-medium text-accent hover:underline"
                    >
                      {t('common.view') || 'View'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail + confirm/reject modal */}
      {(selected || detailLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelected(null)}>
          <div
            className="bg-surface rounded-xl shadow-xl w-full max-w-lg p-5 relative max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => setSelected(null)} className="absolute top-3 right-3 text-muted hover:text-foreground">
              <X className="w-5 h-5" />
            </button>

            {detailLoading || !selected ? (
              <div className="flex items-center justify-center h-40">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" />
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-foreground">
                    {selected.tenant?.name || (t('admin.unknown') || 'Unknown')} — {selected.plan_slug} ({selected.billing_period})
                  </h3>
                  <span className={`inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full ${chip(selected.status)}`}>
                    {statusLabel(selected.status)}
                  </span>
                </div>

                <div className="space-y-1 text-sm text-muted">
                  <p>
                    <span className="text-foreground font-medium">{t('common.amount')}: </span>
                    {Number(selected.amount_egp).toLocaleString()} ج.م
                  </p>
                  <p>
                    <span className="text-foreground font-medium">{t('admin.walletMethod')}: </span>
                    {selected.wallet_type}
                  </p>
                  {selected.reference_note && (
                    <p>
                      <span className="text-foreground font-medium">{t('admin.walletReference')}: </span>
                      {selected.reference_note}
                    </p>
                  )}
                  {selected.user && (
                    <p>
                      <span className="text-foreground font-medium">{t('admin.walletSubmittedBy')}: </span>
                      {selected.user.full_name || selected.user.username}
                    </p>
                  )}
                  <p>
                    <span className="text-foreground font-medium">{t('common.date')}: </span>
                    {selected.created_at ? new Date(selected.created_at).toLocaleString() : '—'}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-muted mb-1">{t('admin.walletScreenshot') || 'Payment screenshot'}</p>
                  {selected.screenshot ? (
                    <img
                      src={selected.screenshot}
                      alt={t('admin.walletScreenshot') || 'Payment screenshot'}
                      className="w-full max-h-80 object-contain bg-surface-secondary rounded-lg border border-border"
                    />
                  ) : (
                    <p className="text-sm text-muted">—</p>
                  )}
                </div>

                {selected.status === 'pending' && !rejecting && (
                  <div className="flex gap-2">
                    <button
                      onClick={confirmRow}
                      disabled={busy}
                      className="flex-1 py-2 bg-success text-white rounded-lg font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                      {t('admin.walletConfirm') || 'Confirm payment'}
                    </button>
                    <button
                      onClick={() => setRejecting(true)}
                      disabled={busy}
                      className="px-4 py-2 bg-danger-soft text-danger rounded-lg font-medium disabled:opacity-50"
                    >
                      {t('admin.walletReject') || 'Reject'}
                    </button>
                  </div>
                )}

                {selected.status === 'pending' && rejecting && (
                  <div className="space-y-2">
                    <input
                      type="text"
                      maxLength={300}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder={t('admin.walletReason') || 'Rejection reason'}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm focus:outline-none focus:border-accent"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={rejectRow}
                        disabled={busy || !rejectReason.trim()}
                        className="flex-1 py-2 bg-danger text-white rounded-lg font-medium disabled:opacity-50"
                      >
                        {t('admin.walletRejectSubmit') || 'Confirm rejection'}
                      </button>
                      <button
                        onClick={() => setRejecting(false)}
                        disabled={busy}
                        className="px-4 py-2 bg-surface-secondary text-foreground rounded-lg font-medium"
                      >
                        {t('common.cancel') || 'Cancel'}
                      </button>
                    </div>
                  </div>
                )}

                {selected.status !== 'pending' && (
                  <p className="text-sm text-muted">
                    {selected.status === 'rejected' && selected.rejection_reason
                      ? `${t('admin.walletReason') || 'Reason'}: ${selected.rejection_reason}`
                      : selected.status === 'confirmed'
                        ? `${t('admin.walletConfirmedAt') || 'Confirmed'}: ${selected.confirmed_at ? new Date(selected.confirmed_at).toLocaleString() : '—'}`
                        : ''}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PlansTab({ t, showToast }) {
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    superAdminApi.getPlans().then(({ data }) => setPlans(data || [])).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const handleEdit = (plan) => {
    setEditing(plan.id)
    setEditForm({ price_monthly: plan.price_monthly, price_yearly: plan.price_yearly, max_products: plan.max_products, max_users: plan.max_users, max_orders_monthly: plan.max_orders_monthly })
  }

  const handleSave = async (planId) => {
    setSaving(true)
    try {
      const { data } = await superAdminApi.updatePlan(planId, editForm)
      setPlans(prev => prev.map(p => p.id === planId ? data : p))
      setEditing(null)
      showToast(t('admin.planSaved') || 'Plan updated')
    } catch (err) { showToast(err.response?.data?.error || (t('common.error') || 'Failed'), 'error') } finally { setSaving(false) }
  }

  const fmt = (v) => v === -1 || v === Infinity ? '∞' : v?.toLocaleString()

if(loading)return<div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"/></div>

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {plans.map((plan) => (
<div key={plan.id}className={`bg-surface rounded-xl border p-5 ${editing===plan.id ?'border-accent ring-2 ring-primary-500/20':'border-border'}`}>
          <div className="flex items-center justify-between mb-4">
<h3 className="text-lg font-bold text-foreground">{plan.name}</h3>
            {editing === plan.id ? (
              <div className="flex gap-1">
<button onClick={()=>handleSave(plan.id)}disabled={saving}className="p-1.5 rounded-lg bg-success-soft text-success-soft-foreground hover:bg-green-100"><Save className="w-4 h-4"/></button>
<button onClick={()=>setEditing(null)}className="p-1.5 rounded-lg bg-surface-secondary text-muted bg-surface-hover"><X className="w-4 h-4"/></button>
              </div>
):<button onClick={()=>handleEdit(plan)}className="p-1.5 rounded-lg bg-surface-secondary text-muted bg-surface-hover"><Edit3 className="w-4 h-4"/></button>}
          </div>
          <div className="space-y-3">
            <div>
<label className="text-xs text-muted">{t('admin.monthlyPrice')||'Monthly Price'}(ج.م)</label>
{editing===plan.id ?<input type="number"value={editForm.price_monthly}onChange={(e)=>setEditForm({...editForm,price_monthly: Number(e.target.value)})}className="w-full mt-1 px-3 py-1.5 border border-border rounded-lg bg-surface text-foreground text-sm"/>
:<p className="text-2xl font-bold text-foreground">{plan.price_monthly?.toLocaleString()}<span className="text-sm font-normal text-muted">ج.م/{t('pricing.perMonth')||'mo'}</span></p>}
            </div>
            <div>
<label className="text-xs text-muted">{t('admin.yearlyPrice')||'Yearly Price'}(ج.م)</label>
{editing===plan.id ?<input type="number"value={editForm.price_yearly}onChange={(e)=>setEditForm({...editForm,price_yearly: Number(e.target.value)})}className="w-full mt-1 px-3 py-1.5 border border-border rounded-lg bg-surface text-foreground text-sm"/>
:<p className="text-lg font-semibold text-foreground">{plan.price_yearly?.toLocaleString()}<span className="text-sm font-normal text-muted">ج.م/{t('pricing.perYear')||'yr'}</span></p>}
            </div>
<div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
              {[{ label: t('common.products') || 'Products', key: 'max_products' }, { label: t('common.users') || 'Users', key: 'max_users' }, { label: t('admin.ordersPerMonth') || 'Orders/mo', key: 'max_orders_monthly' }].map(({ label, key }) => (
                <div key={key}>
<label className="text-xs text-muted">{label}</label>
{editing===plan.id ?<input type="number"value={editForm[key]}onChange={(e)=>setEditForm({...editForm,[key]: Number(e.target.value)})}className="w-full mt-1 px-2 py-1 border border-border rounded bg-surface text-foreground text-sm"/>
:<p className="text-sm font-medium text-foreground">{fmt(plan[key])}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function BannersTab({ t, showToast }) {
  const [banners, setBanners] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingBanner, setEditingBanner] = useState(null)
  const [form, setForm] = useState({ title: '', content: '', image_url: '', link_url: '', is_active: true, position: 0, background_color: '#3b82f6', text_color: '#ffffff' })

  const fetchBanners = async () => {
    try {
      const { data } = await superAdminApi.getBanners ? await superAdminApi.getBanners() : { data: [] }
      setBanners(data || [])
    } catch {
      try {
        const res = await fetch('/api/super-admin/banners', {
          headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` }
        })
        const data = await res.json()
        setBanners(Array.isArray(data) ? data : [])
      } catch { setBanners([]) }
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchBanners() }, [])

  const handleSave = async () => {
    if (!form.title.trim()) return showToast(t('banners.titleRequired') || 'Title is required', 'error')
    try {
      const res = await fetch(editingBanner ? `/api/super-admin/banners/${editingBanner.id}` : '/api/super-admin/banners', {
        method: editingBanner ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error('Failed')
      showToast(t('banners.saved') || 'Banner saved', 'success')
      setShowModal(false)
      setEditingBanner(null)
      setForm({ title: '', content: '', image_url: '', link_url: '', is_active: true, position: 0, background_color: '#3b82f6', text_color: '#ffffff' })
      fetchBanners()
    } catch { showToast(t('banners.saveFailed') || 'Failed to save', 'error') }
  }

  const handleDelete = async (id) => {
    if (!confirm(t('banners.confirmDelete') || 'Delete this banner?')) return
    try {
      const res = await fetch(`/api/super-admin/banners/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
      })
      if (!res.ok) throw new Error(`Delete failed with status ${res.status}`)
      showToast(t('banners.deleted') || 'Banner deleted', 'success')
      fetchBanners()
    } catch { showToast(t('banners.deleteFailed') || 'Failed to delete', 'error') }
  }

  const openEdit = (banner) => {
    setEditingBanner(banner)
    setForm({ title: banner.title, content: banner.content || '', image_url: banner.image_url || '', link_url: banner.link_url || '', is_active: banner.is_active, position: banner.position || 0, background_color: banner.background_color || '#3b82f6', text_color: banner.text_color || '#ffffff' })
    setShowModal(true)
  }

  const openCreate = () => {
    setEditingBanner(null)
    setForm({ title: '', content: '', image_url: '', link_url: '', is_active: true, position: 0, background_color: '#3b82f6', text_color: '#ffffff' })
    setShowModal(true)
  }

if(loading)return<div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"/></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
<h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Megaphone className="h-5 w-5" />
          {t('admin.banners') || 'Dashboard Banners'}
        </h2>
<button onClick={openCreate}className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
          <Plus className="h-4 w-4" /> {t('banners.create') || 'Create Banner'}
        </button>
      </div>
<p className="text-sm text-muted">{t('banners.description')||'Manage banners shown on all tenant dashboards.'}</p>

      {banners.length === 0 ? (
<div className="text-center py-12 bg-surface rounded-xl border border-border">
<Megaphone className="h-12 w-12 text-foreground mx-auto mb-3"/>
<p className="text-muted">{t('banners.noBanners')||'No banners yet'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {banners.map((b) => (
<div key={b.id}className="bg-surface rounded-xl border border-border overflow-hidden">
              <div className="flex items-center">
                {b.image_url && (
                  <div className="w-32 h-20 flex-shrink-0 overflow-hidden">
                    <img src={b.image_url} alt={b.title} className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="flex-1 p-4">
                  <div className="flex items-center gap-2 mb-1">
<span className={`px-2 py-0.5 rounded text-xs font-medium ${b.is_active ?'bg-success-soft text-success-soft-foreground':'bg-surface-tertiary text-muted'}`}>
                      {b.is_active ? (t('active') || 'Active') : (t('inactive') || 'Inactive')}
                    </span>
<span className="text-xs text-muted">#{b.position}</span>
                  </div>
<p className="font-semibold text-foreground text-sm">{b.title}</p>
{b.content &&<p className="text-xs text-muted line-clamp-1">{b.content}</p>}
                </div>
                <div className="flex items-center gap-2 pr-4">
<div className="w-6 h-6 rounded border border-border"style={{backgroundColor: b.background_color}}title="Background"/>
<button onClick={()=>openEdit(b)}className="p-1.5 text-muted hover:text-blue-600 transition-colors"><Edit3 className="h-4 w-4"/></button>
<button onClick={()=>handleDelete(b.id)}className="p-1.5 text-muted hover:text-red-600 transition-colors"><Trash2 className="h-4 w-4"/></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
<div className="bg-surface rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
<h3 className="text-lg font-semibold text-foreground">
                {editingBanner ? (t('banners.edit') || 'Edit Banner') : (t('banners.create') || 'Create Banner')}
              </h3>
<button onClick={()=>{setShowModal(false);setEditingBanner(null)}}className="text-muted text-foreground"><X className="h-5 w-5"/></button>
            </div>
            <div className="space-y-4">
              <div>
<label className="block text-sm font-medium text-foreground mb-1">{t('banners.title')||'Title'}*</label>
<input value={form.title}onChange={e=>setForm({...form,title: e.target.value})}className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm"/>
              </div>
              <div>
<label className="block text-sm font-medium text-foreground mb-1">{t('banners.content')||'Content'}</label>
<textarea value={form.content}onChange={e=>setForm({...form,content: e.target.value})}rows={3}className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm"/>
              </div>
              <div>
<label className="block text-sm font-medium text-foreground mb-1">{t('banners.image')||'Image'}</label>
                {form.image_url && form.image_url.startsWith('data:') ? (
                  <div className="space-y-2">
<div className="flex items-center gap-2 text-sm text-success-soft-foreground bg-success-soft border border-success rounded-lg px-3 py-2">
                      <CheckCircle className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate">{t('banners.fileUploaded') || 'Image uploaded successfully'}</span>
                    </div>
                    <div className="relative inline-block">
                      <img src={form.image_url} alt="Preview" className="h-20 rounded-lg object-cover" />
<button onClick={()=>setForm({...form,image_url:''})}className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-danger text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600"><X className="h-3 w-3"/></button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
<div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                          <Link2 className="h-4 w-4" />
                        </div>
<input value={form.image_url}onChange={e=>setForm({...form,image_url: e.target.value})}className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm"placeholder="https://example.com/image.jpg"/>
                      </div>
<label className="flex items-center gap-2 px-4 py-2 bg-surface-tertiary border border-border rounded-lg text-sm text-foreground bg-surface-hover cursor-pointer transition-colors flex-shrink-0">
                        <Upload className="h-4 w-4" />
                        <span className="hidden sm:inline">{t('banners.upload') || 'Upload'}</span>
                        <input type="file" accept="image/*" className="hidden" onChange={e => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          if (file.size > 2 * 1024 * 1024) { alert(t('banners.fileTooLarge') || 'File too large (max 2MB)'); return }
                          const reader = new FileReader()
                          reader.onload = (ev) => setForm({ ...form, image_url: ev.target.result })
                          reader.readAsDataURL(file)
                        }} />
                      </label>
                    </div>
                    {form.image_url && (
                      <div className="relative inline-block">
                        <img src={form.image_url} alt="Preview" className="h-20 rounded-lg object-cover" onError={e => e.target.style.display = 'none'} />
<button onClick={()=>setForm({...form,image_url:''})}className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-danger text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600"><X className="h-3 w-3"/></button>
                      </div>
                    )}
                  </div>
                )}
<p className="text-xs text-muted mt-1">{t('banners.imageHint')||'Paste a URL or upload a file(max 2MB). Uploads are stored as base64.'}</p>
              </div>
              <div>
<label className="block text-sm font-medium text-foreground mb-1">{t('banners.linkUrl')||'Link URL'}</label>
<input value={form.link_url}onChange={e=>setForm({...form,link_url: e.target.value})}className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm"placeholder="https://..."/>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
<label className="block text-sm font-medium text-foreground mb-1">{t('banners.bgColor')||'Background'}</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={form.background_color} onChange={e => setForm({ ...form, background_color: e.target.value })} className="w-8 h-8 rounded border-0 cursor-pointer" />
<span className="text-xs text-muted">{form.background_color}</span>
                  </div>
                </div>
                <div>
<label className="block text-sm font-medium text-foreground mb-1">{t('banners.textColor')||'Text Color'}</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={form.text_color} onChange={e => setForm({ ...form, text_color: e.target.value })} className="w-8 h-8 rounded border-0 cursor-pointer" />
<span className="text-xs text-muted">{form.text_color}</span>
                  </div>
                </div>
                <div>
<label className="block text-sm font-medium text-foreground mb-1">{t('banners.position')||'Position'}</label>
<input type="number"value={form.position}onChange={e=>setForm({...form,position: parseInt(e.target.value)|| 0})}className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm"/>
                </div>
              </div>
              <div className="flex items-center gap-2">
<input type="checkbox"checked={form.is_active}onChange={e=>setForm({...form,is_active: e.target.checked})}className="rounded border-border"id="banner-active"/>
<label htmlFor="banner-active"className="text-sm text-foreground">{t('banners.isActive')||'Active'}</label>
              </div>
              {/* Live Preview */}
              <div>
<label className="block text-sm font-medium text-foreground mb-1">{t('banners.preview')||'Preview'}</label>
<div className="rounded-lg overflow-hidden border border-border"style={{backgroundColor: form.background_color,color: form.text_color}}>
                  <div className="flex items-center">
                    {form.image_url && <div className="w-20 h-16 flex-shrink-0 overflow-hidden"><img src={form.image_url} alt="" className="w-full h-full object-cover" onError={e => e.target.style.display='none'} /></div>}
                    <div className="flex-1 p-3">
                      <p className="font-bold text-sm">{form.title || 'Banner Title'}</p>
                      {form.content && <p className="text-xs opacity-90 line-clamp-1">{form.content}</p>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
<button onClick={()=>{setShowModal(false);setEditingBanner(null)}}className="px-4 py-2 text-sm text-foreground bg-surface-hover rounded-lg">{t('cancel')||'Cancel'}</button>
<button onClick={handleSave}className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-blue-700 font-medium">{t('save')||'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ActivityTab({ t }) {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 })
  const [filterEntity, setFilterEntity] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [search, setSearch] = useState('')
  const limit = 30

  const fetchActivities = useCallback(async (page = 1) => {
    setLoading(true)
    const params = { page, limit }
    if (filterEntity) params.entity_type = filterEntity
    if (filterAction) params.action = filterAction
    if (search) params.search = search
    superAdminApi.getActivity(params).then(({ data }) => {
      setActivities(data?.data || [])
      setPagination(data?.pagination || { page: 1, totalPages: 1, total: 0 })
    }).catch(() => {}).finally(() => setLoading(false))
  }, [filterEntity, filterAction, search])

  useEffect(() => { fetchActivities(1) }, [fetchActivities])

  const actionColors = {
created:'bg-success-soft text-success-soft-foreground',
updated:'bg-accent-soft text-accent-soft-foreground',
deleted:'bg-danger-soft text-danger-soft-foreground',
upgraded:'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
downgraded:'bg-warning-soft text-warning-soft-foreground',
expired:'bg-warning-soft text-warning-soft-foreground',
logged_in:'bg-surface-tertiary text-foreground',
signed_up:'bg-accent-soft text-accent-soft-foreground',
    refunded: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  }

  return (
<div className="bg-surface rounded-xl border border-border">
<div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
<div className="flex items-center gap-2 text-sm text-muted">
          <Activity className="w-4 h-4" />
          <span>{pagination.total} {t('admin.totalActivities') || 'activities'}</span>
        </div>
        <div className="flex flex-wrap gap-2">
<input type="text"value={search}onChange={(e)=>setSearch(e.target.value)}placeholder={t('common.search')||'Search...'}className="text-sm px-3 py-1.5 border border-border rounded-lg bg-surface text-foreground w-40"/>
<SearchableSelect options={[{value:'',label:t('admin.allEntities')||'All Entities'},{value:'subscription',label:'Subscription'},{value:'product',label:'Product'},{value:'order',label:'Order'},{value:'customer',label:'Customer'},{value:'user',label:'User'},{value:'employee',label:'Employee'},{value:'auth',label:'Auth'}]} value={filterEntity} onChange={(v)=>setFilterEntity(v)} placeholder={t('common.searchSelect')} className="text-sm border border-border rounded-lg bg-surface text-foreground px-3 py-1.5"/>
<SearchableSelect options={[{value:'',label:t('admin.allActions')||'All Actions'},{value:'created',label:t('admin.actionCreated')||'Created'},{value:'updated',label:t('admin.actionUpdated')||'Updated'},{value:'deleted',label:t('admin.actionDeleted')||'Deleted'},{value:'upgraded',label:t('admin.actionUpgraded')||'Upgraded'},{value:'downgraded',label:t('admin.actionDowngraded')||'Downgraded'},{value:'expired',label:t('admin.actionExpired')||'Expired'},{value:'logged_in',label:t('admin.actionLogin')||'Login'}]} value={filterAction} onChange={(v)=>setFilterAction(v)} placeholder={t('common.searchSelect')} className="text-sm border border-border rounded-lg bg-surface text-foreground px-3 py-1.5"/>
        </div>
      </div>
      {loading ? (
<div className="flex items-center justify-center h-32"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"/></div>
      ) : activities.length === 0 ? (
<div className="p-8 text-center text-muted"><Activity className="w-8 h-8 mx-auto mb-2 opacity-50"/><p>{t('admin.noActivity')||'No activity recorded'}</p></div>
      ) : (
        <>
<div className="divide-y divide-border">
            {activities.map((a) => (
<div key={a.id}className="px-4 py-3 flex items-center justify-between bg-surface-hover">
                <div className="flex items-center gap-3 min-w-0">
<span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${actionColors[a.action] ||'bg-surface-tertiary text-foreground'}`}>
                    {a.action}
                  </span>
                  <div className="min-w-0">
<p className="text-sm text-foreground truncate">
                      {a.entity_name || a.entity_type}
                      {a.details?.from_tier && a.details?.to_tier ? (
<span className="text-muted">—{a.details.from_tier}→{a.details.to_tier}</span>
                      ) : a.entity_id ? (
<span className="text-muted">#{a.entity_id}</span>
                      ) : null}
                    </p>
<p className="text-xs text-muted truncate">
                      {a.users?.full_name || a.user_name || 'System'}
{a.tenant_name ?<span className="ml-1 text-foreground">•{a.tenant_name}</span>: null}
                    </p>
                  </div>
                </div>
<span className="text-xs text-muted shrink-0 ml-4">{a.created_at ? new Date(a.created_at).toLocaleString():'—'}</span>
              </div>
            ))}
          </div>
          {pagination.totalPages > 1 && (
<div className="p-4 border-t border-border flex items-center justify-between text-sm">
<span className="text-muted">{t('admin.showing')||'Showing'}{((pagination.page - 1)* limit)+ 1}–{Math.min(pagination.page * limit,pagination.total)}{t('admin.of')||'of'}{pagination.total}</span>
              <div className="flex gap-1">
<button onClick={()=>fetchActivities(pagination.page - 1)}disabled={pagination.page===1}className="px-3 py-1 rounded border border-border disabled:opacity-50 text-foreground">{t('common.previous')||'Prev'}</button>
<span className="px-3 py-1 text-muted">{pagination.page}/{pagination.totalPages}</span>
<button onClick={()=>fetchActivities(pagination.page + 1)}disabled={pagination.page===pagination.totalPages}className="px-3 py-1 rounded border border-border disabled:opacity-50 text-foreground">{t('common.next')||'Next'}</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
