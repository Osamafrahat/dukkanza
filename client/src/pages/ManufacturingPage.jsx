import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { useBranchStore } from '../stores/branchStore'
import { formatCurrency } from '../lib/utils'
import { manufacturingApi, productsApi } from '../lib/api'
import { mfgError } from '../lib/mfgErrors'
import SearchableSelect from '../components/SearchableSelect'
import {
  AlertTriangle,
  Ban,
  CheckCircle,
  Eye,
  Factory,
  FileText,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'

// Statuses shown as filter tabs (quality_check exists in the state machine
// but has no dedicated transition endpoint yet — the badge map still covers
// it in case an order lands there).
const TAB_STATUSES = ['draft', 'confirmed', 'in_progress', 'paused', 'done', 'cancelled']

const STATUS_BADGE = {
  draft: 'bg-surface-tertiary text-foreground',
  confirmed: 'bg-accent-soft text-accent-soft-foreground',
  in_progress: 'bg-warning-soft text-warning',
  paused: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
  quality_check: 'bg-warning-soft text-warning',
  done: 'bg-success-soft text-success-soft-foreground',
  cancelled: 'bg-danger-soft text-danger-soft-foreground',
}

const RESULT_BADGE = {
  pending: 'bg-surface-tertiary text-foreground',
  pass: 'bg-success-soft text-success-soft-foreground',
  fail: 'bg-danger-soft text-danger-soft-foreground',
}

const ACTION_TOAST = {
  confirm: 'mfg.toast.confirmed',
  start: 'mfg.toast.started',
  pause: 'mfg.toast.paused',
  resume: 'mfg.toast.resumed',
}

// Client-side cost preview shown in the complete modal. The server recomputes
// the authoritative numbers from the same frozen rows — this is display-only.
function estimateCost(detail) {
  const inputs = (detail?.items || []).filter((i) => !i.is_byproduct)
  const component = inputs.reduce(
    (a, i) => a + ((Number(i.quantity_planned) || 0) + (Number(i.scrap_quantity) || 0)) * (Number(i.unit_cost) || 0),
    0,
  )
  const operations = (detail?.work_orders || [])
    .filter((w) => w.status !== 'skipped')
    .reduce(
      (a, w) => a + ((Number(w.expected_minutes) || 0) / 60) * (Number(w.work_centers?.cost_per_hour) || 0),
      0,
    )
  return {
    component: Math.round(component * 100) / 100,
    operations: Math.round(operations * 100) / 100,
    total: Math.round((component + operations) * 100) / 100,
  }
}

export default function ManufacturingPage() {
  const { t, toastSuccess, toastError } = useAppStore()
  const { branches, loadBranches } = useBranchStore()

  const [orders, setOrders] = useState([])
  const [stats, setStats] = useState(null)
  const [costTotal, setCostTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [products, setProducts] = useState([])
  const [boms, setBoms] = useState([])
  const [form, setForm] = useState({ product_id: '', bom_id: '', quantity: '1', branch_id: '', notes: '' })

  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showComplete, setShowComplete] = useState(false)
  const [completeForm, setCompleteForm] = useState({ quantity_produced: '', update_cost_price: true })
  const [completeError, setCompleteError] = useState(null)
  const [newCheck, setNewCheck] = useState('')

  const fetchData = async () => {
    try {
      setLoading(true)
      const [ordersRes, statsRes, costsRes] = await Promise.all([
        manufacturingApi.orders.getAll({ status: filter === 'all' ? undefined : filter, limit: 100 }),
        manufacturingApi.orders.getStats(),
        manufacturingApi.reports.getCosts({ limit: 100 }).catch(() => null),
      ])
      setOrders(ordersRes.data?.orders || [])
      setStats(statsRes.data)
      setCostTotal(costsRes?.data?.totals?.totalCost || 0)
    } catch (err) {
      toastError(mfgError(err, t))
    } finally {
      setLoading(false)
    }
  }

  const loadDropdowns = async () => {
    try {
      const [prodRes, bomRes] = await Promise.all([
        productsApi.getAll(),
        manufacturingApi.boms.getAll({ status: 'active' }),
      ])
      setProducts(prodRes.data?.data || prodRes.data || [])
      setBoms(Array.isArray(bomRes.data) ? bomRes.data : [])
    } catch {
      // silent — the create modal shows what loaded
    }
  }

  useEffect(() => {
    fetchData()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate trigger list: the loader below is re-created each render and is intentionally NOT a dep, so only these inputs refetch
  }, [filter])

  useEffect(() => {
    loadDropdowns()
    loadBranches()
  }, [loadBranches])

  const openDetail = async (id) => {
    try {
      setDetailLoading(true)
      const res = await manufacturingApi.orders.getById(id)
      setDetail(res.data)
    } catch (err) {
      toastError(mfgError(err, t))
    } finally {
      setDetailLoading(false)
    }
  }

  // Generic lifecycle transition (confirm/start/pause/resume). The response
  // carries the refreshed detail, so the open drawer stays in sync.
  const act = async (action, id) => {
    try {
      const res = await manufacturingApi.orders[action](id)
      setDetail(res.data)
      toastSuccess(t(ACTION_TOAST[action]))
      fetchData()
    } catch (err) {
      toastError(mfgError(err, t))
    }
  }

  const handleCancel = async (id) => {
    if (!confirm(t('mfg.confirmCancel'))) return
    try {
      const res = await manufacturingApi.orders.cancel(id)
      setDetail(res.data)
      toastSuccess(t('mfg.toast.cancelled'))
      fetchData()
    } catch (err) {
      toastError(mfgError(err, t))
    }
  }

  const openComplete = (order) => {
    setCompleteError(null)
    setCompleteForm({ quantity_produced: String(order.quantity || ''), update_cost_price: true })
    setShowComplete(true)
  }

  const handleComplete = async (e) => {
    e.preventDefault()
    if (!detail) return
    const produced = parseFloat(completeForm.quantity_produced)
    if (!Number.isFinite(produced) || produced <= 0) {
      setCompleteError(t('mfg.err.producedRequired'))
      return
    }
    try {
      setSubmitting(true)
      setCompleteError(null)
      const res = await manufacturingApi.orders.complete(detail.id, {
        quantity_produced: produced,
        update_cost_price: completeForm.update_cost_price,
      })
      setDetail(res.data)
      setShowComplete(false)
      toastSuccess(t('mfg.toast.completed'))
      fetchData()
    } catch (err) {
      const data = err.response?.data
      if (data?.code === 'STOCK_INSUFFICIENT' && Array.isArray(data.shortages)) {
        setCompleteError(mfgError(err, t))
      } else {
        setShowComplete(false)
        toastError(mfgError(err, t))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const runStep = async (woId, kind) => {
    if (!detail) return
    try {
      const res = await manufacturingApi.orders[kind](detail.id, woId)
      setDetail(res.data)
      toastSuccess(t('mfg.toast.progressSaved'))
    } catch (err) {
      toastError(mfgError(err, t))
    }
  }

  const setCheckResult = async (qcId, result) => {
    if (!detail) return
    try {
      const res = await manufacturingApi.orders.updateQuality(detail.id, qcId, { result })
      setDetail({ ...detail, quality_checks: detail.quality_checks.map((q) => (q.id === qcId ? res.data : q)) })
      toastSuccess(t('mfg.toast.progressSaved'))
    } catch (err) {
      toastError(mfgError(err, t))
    }
  }

  const deleteCheck = async (qcId) => {
    if (!detail) return
    if (!confirm(t('mfg.confirmDeleteCheck'))) return
    try {
      await manufacturingApi.orders.deleteQuality(detail.id, qcId)
      setDetail({ ...detail, quality_checks: detail.quality_checks.filter((q) => q.id !== qcId) })
      toastSuccess(t('mfg.toast.checkDeleted'))
    } catch (err) {
      toastError(mfgError(err, t))
    }
  }

  const addCheck = async () => {
    if (!detail || !newCheck.trim()) return
    try {
      const res = await manufacturingApi.orders.addQuality(detail.id, {
        check_name: newCheck.trim(),
        result: 'pending',
      })
      setDetail({ ...detail, quality_checks: [res.data, ...(detail.quality_checks || [])] })
      setNewCheck('')
      toastSuccess(t('mfg.toast.checkAdded'))
    } catch (err) {
      toastError(mfgError(err, t))
    }
  }

  const activeBomsForProduct = (productId) =>
    productId ? boms.filter((b) => String(b.product_id) === String(productId)) : boms

  const handleProductSelect = (productId) => {
    const forProduct = activeBomsForProduct(productId)
    setForm((f) => ({
      ...f,
      product_id: productId,
      bom_id: forProduct.length === 1 ? String(forProduct[0].id) : '',
      quantity: f.quantity || '1',
    }))
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!form.product_id || !form.bom_id) {
      toastError(t('mfg.selectBomRequired'))
      return
    }
    if (!(parseFloat(form.quantity) > 0)) {
      toastError(t('mfg.err.quantityRequired'))
      return
    }
    try {
      setSubmitting(true)
      const res = await manufacturingApi.orders.create({
        product_id: parseInt(form.product_id, 10),
        bom_id: parseInt(form.bom_id, 10),
        quantity: parseFloat(form.quantity),
        branch_id: form.branch_id ? parseInt(form.branch_id, 10) : null,
        notes: form.notes || null,
      })
      toastSuccess(t('mfg.toast.created'))
      setShowCreate(false)
      setForm({ product_id: '', bom_id: '', quantity: '1', branch_id: '', notes: '' })
      fetchData()
      if (res.data?.id) openDetail(res.data.id)
    } catch (err) {
      toastError(mfgError(err, t))
    } finally {
      setSubmitting(false)
    }
  }

  const getStatusBadge = (status) => STATUS_BADGE[status] || STATUS_BADGE.draft

  const estimate = estimateCost(detail)

  const filteredOrders = orders.filter((o) => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return true
    return (
      o.order_number?.toLowerCase().includes(term) ||
      o.products?.name?.toLowerCase().includes(term) ||
      o.products?.sku?.toLowerCase().includes(term)
    )
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Factory className="h-6 w-6" />
          {t('mfg.title') || 'Manufacturing'}
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          {t('mfg.newOrder') || 'New Production Order'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface rounded-xl shadow-sm border border-border p-5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-accent-soft rounded-lg">
              <Factory className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-sm text-muted">{t('totalOrders') || 'Total Orders'}</p>
              <p className="text-2xl font-bold text-foreground">{stats?.total ?? orders.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-surface rounded-xl shadow-sm border border-border p-5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-warning-soft rounded-lg">
              <Play className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-sm text-muted">{t('mfg.stats.inProgress') || 'In Progress'}</p>
              <p className="text-2xl font-bold text-warning">{stats?.counts?.in_progress || 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-surface rounded-xl shadow-sm border border-border p-5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-success-soft rounded-lg">
              <CheckCircle className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-sm text-muted">{t('mfg.stats.done') || 'Completed'}</p>
              <p className="text-2xl font-bold text-success">{stats?.counts?.done || 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-surface rounded-xl shadow-sm border border-border p-5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <svg className="h-5 w-5 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 9v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-muted">{t('mfg.stats.totalCost') || 'Production Cost'}</p>
              <p className="text-2xl font-bold text-foreground">{formatCurrency(costTotal)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-surface rounded-xl shadow-sm border border-border">
        <div className="p-5 border-b border-border">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex flex-wrap gap-2">
              {['all', ...TAB_STATUSES].map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    filter === s
                      ? 'bg-accent text-white'
                      : 'bg-surface-tertiary text-muted bg-surface-hover'
                  }`}
                >
                  {s === 'all'
                    ? t('mfg.all') || 'All'
                    : t(`mfg.status.${s}`) || s}
                  {s !== 'all' && stats?.counts?.[s] != null ? ` (${stats.counts[s]})` : ''}
                </button>
              ))}
            </div>
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
              <input
                type="text"
                placeholder={t('search') || 'Search...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-border rounded-lg bg-surface text-foreground ring-focus outline-none"
              />
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-secondary">
                <th className="px-5 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('mfg.orderNumber') || 'MO #'}</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('product') || 'Product'}</th>
                <th className="px-5 py-3 text-center text-xs font-medium text-muted uppercase tracking-wider">{t('qty') || 'Qty'}</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">{t('mfg.totalCost') || 'Total Cost'}</th>
                <th className="px-5 py-3 text-center text-xs font-medium text-muted uppercase tracking-wider">{t('status') || 'Status'}</th>
                <th className="px-5 py-3 text-center text-xs font-medium text-muted uppercase tracking-wider">{t('actions') || 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted">
                    {t('mfg.noOrders') || 'No production orders found'}
                  </td>
                </tr>
              ) : (
                filteredOrders.map((o) => (
                  <tr key={o.id} className="bg-surface-hover transition-colors">
                    <td className="px-5 py-4 text-sm font-mono font-medium text-foreground">{o.order_number}</td>
                    <td className="px-5 py-4 text-sm text-muted">
                      {o.products?.name || '—'}
                      {o.branches?.name && (
                        <span className="block text-[11px] text-muted">{o.branches.name}</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-sm text-center text-muted">{o.quantity}</td>
                    <td className="px-5 py-4 text-sm text-right text-foreground font-medium">
                      {o.status === 'done' ? formatCurrency(o.total_cost) : '—'}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusBadge(o.status)}`}>
                        {t(`mfg.status.${o.status}`) || o.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openDetail(o.id)}
                          className="p-1.5 text-muted hover:text-blue-600 transition-colors"
                          title={t('view') || 'View'}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {o.status === 'draft' && (
                          <button
                            onClick={() => act('confirm', o.id)}
                            className="p-1.5 text-muted hover:text-green-600 transition-colors"
                            title={t('mfg.action.confirm')}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </button>
                        )}
                        {o.status === 'confirmed' && (
                          <button
                            onClick={() => act('start', o.id)}
                            className="p-1.5 text-muted hover:text-green-600 transition-colors"
                            title={t('mfg.action.start')}
                          >
                            <Play className="h-4 w-4" />
                          </button>
                        )}
                        {(o.status === 'draft' || o.status === 'confirmed' || o.status === 'in_progress' || o.status === 'paused') && (
                          <button
                            onClick={() => handleCancel(o.id)}
                            className="p-1.5 text-muted hover:text-red-600 transition-colors"
                            title={t('mfg.action.cancel')}
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">{t('mfg.createTitle') || 'Create Production Order'}</h3>
              <button onClick={() => setShowCreate(false)} className="text-muted text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">{t('product') || 'Product'}*</label>
                <SearchableSelect
                  options={[
                    { value: '', label: t('selectProduct') || 'Product...' },
                    ...products.map((p) => ({ value: String(p.id), label: p.name })),
                  ]}
                  value={form.product_id}
                  onChange={handleProductSelect}
                  placeholder={t('common.searchSelect')}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">{t('mfg.bom') || 'BOM'}*</label>
                <SearchableSelect
                  options={[
                    { value: '', label: t('mfg.selectBom') || 'Select bill of materials...' },
                    ...activeBomsForProduct(form.product_id).map((b) => ({
                      value: String(b.id),
                      label: `${t('mfg.bom')} #${b.id} · ${t('bom.outputQuantity')} ${b.output_quantity}`,
                    })),
                  ]}
                  value={form.bom_id}
                  onChange={(v) => setForm((f) => ({ ...f, bom_id: v }))}
                  placeholder={t('common.searchSelect')}
                />
                {form.product_id && activeBomsForProduct(form.product_id).length === 0 && (
                  <p className="text-xs text-danger mt-1">{t('mfg.noBomForProduct')}</p>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">{t('mfg.quantity') || 'Quantity'}*</label>
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    value={form.quantity}
                    onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground ring-focus outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">{t('mfg.branch') || 'Branch'}</label>
                  <SearchableSelect
                    options={[
                      { value: '', label: t('branches.useCurrent') },
                      ...branches.filter((b) => b.is_active).map((b) => ({ value: String(b.id), label: b.name })),
                    ]}
                    value={form.branch_id}
                    onChange={(v) => setForm((f) => ({ ...f, branch_id: String(v ?? '') }))}
                    placeholder={t('branches.selectBranch')}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">{t('notes') || 'Notes'}</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground ring-focus outline-none"
                  rows={3}
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="flex-1 px-4 py-2 border border-border rounded-lg text-foreground bg-surface-hover transition-colors"
                >
                  {t('cancel') || 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2 bg-accent text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('create') || 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-3xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
            {detailLoading || !detail ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="h-8 w-8 animate-spin text-accent" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    {detail.order_number}
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusBadge(detail.status)}`}>
                      {t(`mfg.status.${detail.status}`) || detail.status}
                    </span>
                  </h3>
                  <button onClick={() => setDetail(null)} className="text-muted text-foreground">
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 text-sm">
                  <div>
                    <p className="text-muted">{t('product') || 'Product'}</p>
                    <p className="font-medium text-foreground">{detail.products?.name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted">{t('mfg.quantity') || 'Quantity'}</p>
                    <p className="font-medium text-foreground">
                      {detail.quantity_produced > 0 ? `${detail.quantity_produced} / ` : ''}{detail.quantity}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted">{t('mfg.branch') || 'Branch'}</p>
                    <p className="font-medium text-foreground">{detail.branches?.name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted">{t('mfg.startedAt') || 'Started'}</p>
                    <p className="font-medium text-foreground">
                      {detail.started_at ? new Date(detail.started_at).toLocaleString() : '—'}
                    </p>
                  </div>
                </div>

                {detail.notes && (
                  <div className="mb-4 text-sm">
                    <p className="text-muted">{t('notes') || 'Notes'}</p>
                    <p className="text-foreground">{detail.notes}</p>
                  </div>
                )}

                {/* Lifecycle actions */}
                <div className="flex flex-wrap gap-2 mb-5 pb-4 border-b border-border">
                  {detail.status === 'draft' && (
                    <button
                      onClick={() => act('confirm', detail.id)}
                      className="flex items-center gap-2 px-3 py-2 bg-accent text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
                    >
                      <CheckCircle className="h-4 w-4" /> {t('mfg.action.confirm')}
                    </button>
                  )}
                  {detail.status === 'confirmed' && (
                    <button
                      onClick={() => act('start', detail.id)}
                      className="flex items-center gap-2 px-3 py-2 bg-success-soft text-success rounded-lg text-sm hover:opacity-80 transition-opacity"
                    >
                      <Play className="h-4 w-4" /> {t('mfg.action.start')}
                    </button>
                  )}
                  {detail.status === 'in_progress' && (
                    <button
                      onClick={() => act('pause', detail.id)}
                      className="flex items-center gap-2 px-3 py-2 bg-warning-soft text-warning rounded-lg text-sm hover:opacity-80 transition-opacity"
                    >
                      <Pause className="h-4 w-4" /> {t('mfg.action.pause')}
                    </button>
                  )}
                  {(detail.status === 'paused' || detail.status === 'quality_check') && (
                    <button
                      onClick={() => act('resume', detail.id)}
                      className="flex items-center gap-2 px-3 py-2 bg-accent-soft text-accent rounded-lg text-sm hover:opacity-80 transition-opacity"
                    >
                      <RotateCcw className="h-4 w-4" /> {t('mfg.action.resume')}
                    </button>
                  )}
                  {['in_progress', 'paused', 'quality_check'].includes(detail.status) && (
                    <button
                      onClick={() => openComplete(detail)}
                      className="flex items-center gap-2 px-3 py-2 bg-success-soft text-success rounded-lg text-sm hover:opacity-80 transition-opacity"
                    >
                      <CheckCircle className="h-4 w-4" /> {t('mfg.action.complete')}
                    </button>
                  )}
                  {['draft', 'confirmed', 'in_progress', 'paused', 'quality_check'].includes(detail.status) && (
                    <button
                      onClick={() => handleCancel(detail.id)}
                      className="flex items-center gap-2 px-3 py-2 bg-danger-soft text-danger rounded-lg text-sm hover:opacity-80 transition-opacity"
                    >
                      <Ban className="h-4 w-4" /> {t('mfg.action.cancel')}
                    </button>
                  )}
                </div>

                {/* Cost breakdown (completed runs) */}
                {detail.status === 'done' && (
                  <div className="mb-5 p-4 bg-surface-tertiary rounded-lg">
                    <p className="text-sm font-medium text-foreground mb-2">{t('mfg.costBreakdown')}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div>
                        <p className="text-muted">{t('mfg.componentCost')}</p>
                        <p className="font-semibold text-foreground">{formatCurrency(detail.component_cost)}</p>
                      </div>
                      <div>
                        <p className="text-muted">{t('mfg.operationsCost')}</p>
                        <p className="font-semibold text-foreground">{formatCurrency(detail.operations_cost)}</p>
                      </div>
                      <div>
                        <p className="text-muted">{t('mfg.totalCost')}</p>
                        <p className="font-semibold text-foreground">{formatCurrency(detail.total_cost)}</p>
                      </div>
                      <div>
                        <p className="text-muted">{t('mfg.unitCost')}</p>
                        <p className="font-semibold text-foreground">{formatCurrency(detail.unit_cost)}</p>
                      </div>
                    </div>
                    {detail.journal_entry_id && (
                      <p className="text-xs text-muted mt-2">
                        {t('mfg.journalPosted')} #{detail.journal_entry_id}
                      </p>
                    )}
                  </div>
                )}

                {/* Components (frozen at start) */}
                <div className="mb-5">
                  <p className="text-sm font-medium text-foreground mb-2">{t('mfg.components')}</p>
                  {!detail.items?.length ? (
                    <p className="text-sm text-muted">{t('mfg.notStarted')}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-surface-secondary">
                            <th className="px-3 py-2 text-left text-xs font-medium text-muted uppercase">{t('product') || 'Product'}</th>
                            <th className="px-3 py-2 text-center text-xs font-medium text-muted uppercase">{t('mfg.type')}</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase">{t('qty') || 'Qty'}</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase">{t('mfg.waste')}</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase">{t('mfg.unitCost')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {detail.items.map((i) => (
                            <tr key={i.id}>
                              <td className="px-3 py-2 text-sm text-foreground">{i.products?.name || `#${i.product_id}`}</td>
                              <td className="px-3 py-2 text-sm text-center">
                                <span className={`px-2 py-0.5 rounded-full text-xs ${i.is_byproduct ? 'bg-accent-soft text-accent' : 'bg-surface-tertiary text-muted'}`}>
                                  {i.is_byproduct ? t('bom.byproduct') : t('mfg.input')}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-sm text-right text-muted">{i.quantity_planned}</td>
                              <td className="px-3 py-2 text-sm text-right text-muted">{i.scrap_quantity || 0}</td>
                              <td className="px-3 py-2 text-sm text-right text-muted">{formatCurrency(i.unit_cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Work orders */}
                {detail.work_orders?.length > 0 && (
                  <div className="mb-5">
                    <p className="text-sm font-medium text-foreground mb-2">{t('mfg.workOrders')}</p>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-surface-secondary">
                            <th className="px-3 py-2 text-left text-xs font-medium text-muted uppercase">#</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-muted uppercase">{t('mfg.step')}</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-muted uppercase">{t('bom.workCenter')}</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted uppercase">{t('mfg.minutes')}</th>
                            <th className="px-3 py-2 text-center text-xs font-medium text-muted uppercase">{t('status') || 'Status'}</th>
                            <th className="px-3 py-2 text-center text-xs font-medium text-muted uppercase">{t('actions') || 'Actions'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {detail.work_orders.map((w) => (
                            <tr key={w.id}>
                              <td className="px-3 py-2 text-sm text-muted">{w.sequence}</td>
                              <td className="px-3 py-2 text-sm text-foreground">{w.name}</td>
                              <td className="px-3 py-2 text-sm text-muted">{w.work_centers?.name || '—'}</td>
                              <td className="px-3 py-2 text-sm text-right text-muted">{w.expected_minutes}</td>
                              <td className="px-3 py-2 text-sm text-center">
                                <span className={`px-2 py-0.5 rounded-full text-xs ${
                                  w.status === 'done' ? 'bg-success-soft text-success-soft-foreground'
                                    : w.status === 'running' ? 'bg-warning-soft text-warning'
                                      : w.status === 'skipped' ? 'bg-danger-soft text-danger-soft-foreground'
                                        : 'bg-surface-tertiary text-muted'
                                }`}>
                                  {t(`mfg.wo.${w.status}`) || w.status}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  {w.status === 'pending' && (
                                    <button
                                      onClick={() => runStep(w.id, 'startWorkOrder')}
                                      className="p-1 text-muted hover:text-green-600 transition-colors"
                                      title={t('mfg.stepStart')}
                                    >
                                      <Play className="h-4 w-4" />
                                    </button>
                                  )}
                                  {w.status === 'running' && (
                                    <button
                                      onClick={() => runStep(w.id, 'completeWorkOrder')}
                                      className="p-1 text-muted hover:text-green-600 transition-colors"
                                      title={t('mfg.stepFinish')}
                                    >
                                      <CheckCircle className="h-4 w-4" />
                                    </button>
                                  )}
                                  {(w.status === 'pending' || w.status === 'running') && (
                                    <button
                                      onClick={() => runStep(w.id, 'skipWorkOrder')}
                                      className="p-1 text-muted hover:text-red-600 transition-colors"
                                      title={t('mfg.stepSkip')}
                                    >
                                      <Ban className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Quality checks */}
                <div className="mb-2">
                  <p className="text-sm font-medium text-foreground mb-2">{t('mfg.qualityChecks')}</p>
                  {detail.quality_checks?.length > 0 && (
                    <table className="w-full mb-3">
                      <tbody className="divide-y divide-border">
                        {detail.quality_checks.map((q) => (
                          <tr key={q.id}>
                            <td className="px-3 py-2 text-sm text-foreground">{q.check_name}</td>
                            <td className="px-3 py-2 text-sm text-center">
                              <span className={`px-2 py-0.5 rounded-full text-xs ${RESULT_BADGE[q.result] || RESULT_BADGE.pending}`}>
                                {t(`mfg.qc.${q.result}`) || q.result}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-sm text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => setCheckResult(q.id, 'pass')}
                                  className="p-1 text-muted hover:text-green-600 transition-colors"
                                  title={t('mfg.qc.pass')}
                                >
                                  <CheckCircle className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => setCheckResult(q.id, 'fail')}
                                  className="p-1 text-muted hover:text-red-600 transition-colors"
                                  title={t('mfg.qc.fail')}
                                >
                                  <AlertTriangle className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => deleteCheck(q.id)}
                                  className="p-1 text-muted hover:text-red-600 transition-colors"
                                  title={t('delete') || 'Delete'}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {['draft', 'confirmed', 'in_progress', 'paused', 'quality_check'].includes(detail.status) && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newCheck}
                        onChange={(e) => setNewCheck(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            addCheck()
                          }
                        }}
                        placeholder={t('mfg.newCheck')}
                        className="flex-1 px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm ring-focus outline-none"
                      />
                      <button
                        onClick={addCheck}
                        disabled={!newCheck.trim()}
                        className="px-3 py-2 bg-accent text-white rounded-lg text-sm disabled:opacity-50 transition-colors"
                      >
                        {t('mfg.addCheck')}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Complete modal */}
      {showComplete && detail && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">{t('mfg.completeTitle')}</h3>
              <button onClick={() => setShowComplete(false)} className="text-muted text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleComplete} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">{t('mfg.quantityProduced')}*</label>
                <input
                  type="number"
                  min="0.0001"
                  step="any"
                  value={completeForm.quantity_produced}
                  onChange={(e) => setCompleteForm((f) => ({ ...f, quantity_produced: e.target.value }))}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground ring-focus outline-none"
                  autoFocus
                />
              </div>

              <label className="flex items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={completeForm.update_cost_price}
                  onChange={(e) => setCompleteForm((f) => ({ ...f, update_cost_price: e.target.checked }))}
                  className="mt-0.5"
                />
                {t('mfg.updateCostPrice')}
              </label>

              <div className="p-3 bg-surface-tertiary rounded-lg text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted">{t('mfg.componentCost')}</span>
                  <span className="text-foreground font-medium">{formatCurrency(estimate.component)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">{t('mfg.operationsCost')}</span>
                  <span className="text-foreground font-medium">{formatCurrency(estimate.operations)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1">
                  <span className="text-muted">{t('mfg.totalCost')}</span>
                  <span className="text-foreground font-semibold">{formatCurrency(estimate.total)}</span>
                </div>
                <p className="text-xs text-muted">{t('mfg.estimateNote')}</p>
              </div>

              {completeError && (
                <div className="p-3 bg-danger-soft rounded-lg text-sm text-danger flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{completeError}</span>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowComplete(false)}
                  className="flex-1 px-4 py-2 border border-border rounded-lg text-foreground bg-surface-hover transition-colors"
                >
                  {t('cancel') || 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2 bg-success text-white rounded-lg disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('mfg.action.complete')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
