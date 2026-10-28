import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { formatCurrency } from '../lib/utils'
import { manufacturingApi, productsApi } from '../lib/api'
import { mfgError } from '../lib/mfgErrors'
import SearchableSelect from '../components/SearchableSelect'
import {
  Archive,
  CheckCircle,
  Clock,
  Edit,
  Layers,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'

const BOM_STATUSES = ['draft', 'active', 'archived']

const STATUS_BADGE = {
  draft: 'bg-surface-tertiary text-foreground',
  active: 'bg-success-soft text-success-soft-foreground',
  archived: 'bg-danger-soft text-danger-soft-foreground',
}

const emptyItem = () => ({ product_id: '', quantity: '', waste_factor: '0', is_byproduct: false })
const emptyOp = () => ({ name: '', work_center_id: '', expected_minutes: '' })

const emptyBomForm = () => ({
  product_id: '',
  output_quantity: '1',
  status: 'active',
  notes: '',
  items: [emptyItem()],
  operations: [],
})

const emptyWcForm = () => ({
  name: '',
  cost_per_hour: '0',
  time_efficiency: '100',
  description: '',
  is_active: true,
})

// Live cost preview for the editor: priced per BOM run (output_quantity) from
// current product cost_price + work-center rates. Display-only — the server
// recomputes authoritative numbers when an MO starts.
function computePreview(form, products, workCenters) {
  const byId = new Map(products.map((p) => [String(p.id), p]))
  const wcById = new Map(workCenters.map((w) => [String(w.id), w]))
  let component = 0
  for (const item of form.items) {
    if (item.is_byproduct || !item.product_id) continue
    const qty = Number(item.quantity) || 0
    const waste = Number(item.waste_factor) || 0
    const cost = Number(byId.get(String(item.product_id))?.cost_price) || 0
    component += qty * (1 + waste / 100) * cost
  }
  let operations = 0
  for (const op of form.operations) {
    const minutes = Number(op.expected_minutes) || 0
    const rate = Number(wcById.get(String(op.work_center_id))?.cost_per_hour) || 0
    operations += (minutes / 60) * rate
  }
  const output = Number(form.output_quantity) || 0
  const total = component + operations
  return {
    component: Math.round(component * 100) / 100,
    operations: Math.round(operations * 100) / 100,
    total: Math.round(total * 100) / 100,
    perUnit: output > 0 ? Math.round((total / output) * 10000) / 10000 : 0,
  }
}

export default function BOMPage() {
  const { t, toastSuccess, toastError } = useAppStore()

  const [tab, setTab] = useState('boms')
  const [loading, setLoading] = useState(true)
  const [boms, setBoms] = useState([])
  const [workCenters, setWorkCenters] = useState([])
  const [products, setProducts] = useState([])
  const [searchTerm, setSearchTerm] = useState('')

  const [editor, setEditor] = useState(null) // { mode, id?, form }
  const [submitting, setSubmitting] = useState(false)

  const [wcEditor, setWcEditor] = useState(null) // { mode, id?, form }
  const [wcSubmitting, setWcSubmitting] = useState(false)

  const fetchData = async () => {
    try {
      setLoading(true)
      const [bomRes, wcRes] = await Promise.all([
        manufacturingApi.boms.getAll(),
        manufacturingApi.workCenters.getAll(),
      ])
      setBoms(Array.isArray(bomRes.data) ? bomRes.data : [])
      setWorkCenters(Array.isArray(wcRes.data) ? wcRes.data : [])
    } catch (err) {
      toastError(mfgError(err, t))
    } finally {
      setLoading(false)
    }
  }

  const loadProducts = async () => {
    try {
      const res = await productsApi.getAll()
      setProducts(res.data?.data || res.data || [])
    } catch {
      // silent — editor shows what loaded
    }
  }

  useEffect(() => {
    fetchData()
    loadProducts()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only load; re-running on t/toastError identity would refetch in a loop
  }, [])

  // ---- BOM editor ----

  const openCreate = () => setEditor({ mode: 'create', form: emptyBomForm() })

  const openEdit = async (bom) => {
    try {
      const res = await manufacturingApi.boms.getById(bom.id)
      const data = res.data
      setEditor({
        mode: 'edit',
        id: bom.id,
        form: {
          product_id: String(data.product_id),
          output_quantity: String(data.output_quantity),
          status: data.status,
          notes: data.notes || '',
          items: (data.items || []).map((i) => ({
            product_id: String(i.product_id),
            quantity: String(i.quantity),
            waste_factor: String(i.waste_factor ?? 0),
            is_byproduct: !!i.is_byproduct,
          })),
          operations: (data.operations || []).map((o) => ({
            name: o.name,
            work_center_id: o.work_center_id ? String(o.work_center_id) : '',
            expected_minutes: String(o.expected_minutes ?? ''),
          })),
        },
      })
    } catch (err) {
      toastError(mfgError(err, t))
    }
  }

  const setForm = (patch) => setEditor((e) => ({ ...e, form: { ...e.form, ...patch } }))

  const setItem = (idx, patch) => {
    const items = [...editor.form.items]
    items[idx] = { ...items[idx], ...patch }
    setForm({ items })
  }

  const setOp = (idx, patch) => {
    const operations = [...editor.form.operations]
    operations[idx] = { ...operations[idx], ...patch }
    setForm({ operations })
  }

  const handleSaveBom = async (e) => {
    e.preventDefault()
    const form = editor.form
    if (!form.product_id) {
      toastError(t('bom.err.productRequired'))
      return
    }
    const items = form.items.filter((i) => i.product_id && Number(i.quantity) > 0)
    if (items.filter((i) => !i.is_byproduct).length === 0) {
      toastError(t('mfg.err.bomNoInputs'))
      return
    }
    const operations = form.operations
      .filter((o) => o.name.trim())
      .map((o, idx) => ({
        name: o.name.trim(),
        work_center_id: o.work_center_id ? parseInt(o.work_center_id, 10) : null,
        expected_minutes: Number(o.expected_minutes) || 0,
        sequence: idx + 1,
      }))
    const payload = {
      product_id: parseInt(form.product_id, 10),
      output_quantity: Number(form.output_quantity) > 0 ? Number(form.output_quantity) : 1,
      status: form.status,
      notes: form.notes || null,
      items: items.map((i) => ({
        product_id: parseInt(i.product_id, 10),
        quantity: Number(i.quantity),
        waste_factor: Number(i.waste_factor) || 0,
        is_byproduct: !!i.is_byproduct,
      })),
      operations,
    }
    try {
      setSubmitting(true)
      if (editor.mode === 'edit') {
        await manufacturingApi.boms.update(editor.id, payload)
        toastSuccess(t('bom.updated'))
      } else {
        await manufacturingApi.boms.create(payload)
        toastSuccess(t('bom.created'))
      }
      setEditor(null)
      fetchData()
    } catch (err) {
      toastError(mfgError(err, t))
    } finally {
      setSubmitting(false)
    }
  }

  const setStatus = async (bom, status) => {
    if (status === 'archived' && !confirm(t('bom.confirmArchive'))) return
    try {
      await manufacturingApi.boms.update(bom.id, { status })
      toastSuccess(status === 'archived' ? t('bom.archived') : t('bom.activated'))
      fetchData()
    } catch (err) {
      toastError(mfgError(err, t))
    }
  }

  const handleDelete = async (bom) => {
    if (!confirm(t('bom.confirmDelete'))) return
    try {
      await manufacturingApi.boms.delete(bom.id)
      toastSuccess(t('bom.deleted'))
      fetchData()
    } catch (err) {
      toastError(mfgError(err, t))
    }
  }

  // ---- Work center editor ----

  const openWcCreate = () => setWcEditor({ mode: 'create', form: emptyWcForm() })

  const openWcEdit = (wc) =>
    setWcEditor({
      mode: 'edit',
      id: wc.id,
      form: {
        name: wc.name,
        cost_per_hour: String(wc.cost_per_hour),
        time_efficiency: String(wc.time_efficiency),
        description: wc.description || '',
        is_active: wc.is_active,
      },
    })

  const setWcForm = (patch) => setWcEditor((e) => ({ ...e, form: { ...e.form, ...patch } }))

  const handleSaveWc = async (e) => {
    e.preventDefault()
    if (!wcEditor.form.name.trim()) {
      toastError(t('wc.err.nameRequired'))
      return
    }
    const payload = {
      name: wcEditor.form.name.trim(),
      cost_per_hour: Number(wcEditor.form.cost_per_hour) || 0,
      time_efficiency: Number(wcEditor.form.time_efficiency) || 100,
      description: wcEditor.form.description || null,
      is_active: !!wcEditor.form.is_active,
    }
    try {
      setWcSubmitting(true)
      if (wcEditor.mode === 'edit') {
        await manufacturingApi.workCenters.update(wcEditor.id, payload)
        toastSuccess(t('wc.updated'))
      } else {
        await manufacturingApi.workCenters.create(payload)
        toastSuccess(t('wc.created'))
      }
      setWcEditor(null)
      fetchData()
    } catch (err) {
      toastError(mfgError(err, t))
    } finally {
      setWcSubmitting(false)
    }
  }

  const handleDeleteWc = async (wc) => {
    if (!confirm(t('wc.confirmDelete'))) return
    try {
      await manufacturingApi.workCenters.delete(wc.id)
      toastSuccess(t('wc.deleted'))
      fetchData()
    } catch (err) {
      toastError(mfgError(err, t))
    }
  }

  const filteredBoms = boms.filter((b) => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return true
    return b.products?.name?.toLowerCase().includes(term) || b.products?.sku?.toLowerCase().includes(term)
  })

  const preview = editor ? computePreview(editor.form, products, workCenters) : null

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
          <Layers className="h-6 w-6" />
          {t('bom.title') || 'Bills of Materials'}
        </h1>
        {tab === 'boms' ? (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {t('bom.new') || 'New BOM'}
          </button>
        ) : (
          <button
            onClick={openWcCreate}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {t('wc.new') || 'New Work Center'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {[['boms', t('bom.tabBoms'), Layers], ['workcenters', t('bom.tabWorkCenters'), Clock]].map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === key ? 'bg-accent text-white' : 'bg-surface-tertiary text-muted bg-surface-hover'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'boms' ? (
        <div className="bg-surface rounded-xl shadow-sm border border-border">
          <div className="p-5 border-b border-border">
            <div className="relative max-w-xs">
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
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-secondary">
                  <th className="px-5 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('product') || 'Product'}</th>
                  <th className="px-5 py-3 text-center text-xs font-medium text-muted uppercase tracking-wider">{t('bom.outputQuantity')}</th>
                  <th className="px-5 py-3 text-center text-xs font-medium text-muted uppercase tracking-wider">{t('mfg.components')}</th>
                  <th className="px-5 py-3 text-center text-xs font-medium text-muted uppercase tracking-wider">{t('mfg.steps')}</th>
                  <th className="px-5 py-3 text-center text-xs font-medium text-muted uppercase tracking-wider">{t('status') || 'Status'}</th>
                  <th className="px-5 py-3 text-center text-xs font-medium text-muted uppercase tracking-wider">{t('actions') || 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredBoms.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-muted">
                      {t('bom.noBoms') || 'No bills of materials yet'}
                    </td>
                  </tr>
                ) : (
                  filteredBoms.map((b) => (
                    <tr key={b.id} className="bg-surface-hover transition-colors">
                      <td className="px-5 py-4 text-sm font-medium text-foreground">
                        {b.products?.name || `#${b.product_id}`}
                        <span className="block text-[11px] font-normal text-muted font-mono">BOM-{b.id}</span>
                      </td>
                      <td className="px-5 py-4 text-sm text-center text-muted">{b.output_quantity}</td>
                      <td className="px-5 py-4 text-sm text-center text-muted">{b.item_count ?? 0}</td>
                      <td className="px-5 py-4 text-sm text-center text-muted">{b.operation_count ?? 0}</td>
                      <td className="px-5 py-4 text-center">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${STATUS_BADGE[b.status] || STATUS_BADGE.draft}`}>
                          {t(`bom.status.${b.status}`) || b.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEdit(b)}
                            className="p-1.5 text-muted hover:text-blue-600 transition-colors"
                            title={t('common.edit') || 'Edit'}
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          {b.status !== 'archived' && (
                            <button
                              onClick={() => setStatus(b, 'archived')}
                              className="p-1.5 text-muted hover:text-orange-600 transition-colors"
                              title={t('bom.archive')}
                            >
                              <Archive className="h-4 w-4" />
                            </button>
                          )}
                          {b.status === 'archived' && (
                            <button
                              onClick={() => setStatus(b, 'active')}
                              className="p-1.5 text-muted hover:text-green-600 transition-colors"
                              title={t('bom.activate')}
                            >
                              <CheckCircle className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(b)}
                            className="p-1.5 text-muted hover:text-red-600 transition-colors"
                            title={t('delete') || 'Delete'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-surface rounded-xl shadow-sm border border-border">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-secondary">
                  <th className="px-5 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('common.name') || 'Name'}</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">{t('wc.costPerHour')}</th>
                  <th className="px-5 py-3 text-center text-xs font-medium text-muted uppercase tracking-wider">{t('wc.efficiency')}</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('common.description') || 'Description'}</th>
                  <th className="px-5 py-3 text-center text-xs font-medium text-muted uppercase tracking-wider">{t('status') || 'Status'}</th>
                  <th className="px-5 py-3 text-center text-xs font-medium text-muted uppercase tracking-wider">{t('actions') || 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {workCenters.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-muted">
                      {t('wc.noWorkCenters') || 'No work centers yet'}
                    </td>
                  </tr>
                ) : (
                  workCenters.map((w) => (
                    <tr key={w.id} className="bg-surface-hover transition-colors">
                      <td className="px-5 py-4 text-sm font-medium text-foreground">{w.name}</td>
                      <td className="px-5 py-4 text-sm text-right text-muted">{formatCurrency(w.cost_per_hour)}</td>
                      <td className="px-5 py-4 text-sm text-center text-muted">{w.time_efficiency}%</td>
                      <td className="px-5 py-4 text-sm text-muted">{w.description || '—'}</td>
                      <td className="px-5 py-4 text-center">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          w.is_active ? 'bg-success-soft text-success-soft-foreground' : 'bg-surface-tertiary text-muted'
                        }`}>
                          {w.is_active ? t('common.active') || 'Active' : t('common.inactive') || 'Inactive'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openWcEdit(w)}
                            className="p-1.5 text-muted hover:text-blue-600 transition-colors"
                            title={t('common.edit') || 'Edit'}
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteWc(w)}
                            className="p-1.5 text-muted hover:text-red-600 transition-colors"
                            title={t('delete') || 'Delete'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* BOM editor */}
      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-3xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                {editor.mode === 'edit' ? t('bom.editTitle') : t('bom.createTitle')}
              </h3>
              <button onClick={() => setEditor(null)} className="text-muted text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBom} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-foreground mb-1">{t('product') || 'Product'}*</label>
                  <SearchableSelect
                    options={[
                      { value: '', label: t('selectProduct') || 'Product...' },
                      ...products.map((p) => ({ value: String(p.id), label: p.name })),
                    ]}
                    value={editor.form.product_id}
                    onChange={(v) => setForm({ product_id: v })}
                    placeholder={t('common.searchSelect')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">{t('bom.outputQuantity')}</label>
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    value={editor.form.output_quantity}
                    onChange={(e) => setForm({ output_quantity: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground ring-focus outline-none"
                  />
                </div>
              </div>

              {/* Components */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-foreground">{t('mfg.components')}*</label>
                  <button
                    type="button"
                    onClick={() => setForm({ items: [...editor.form.items, emptyItem()] })}
                    className="text-sm text-accent hover:text-blue-700"
                  >
                    + {t('bom.addComponent')}
                  </button>
                </div>
                {editor.form.items.map((item, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-2 mb-2 p-2 border border-border rounded-lg">
                    <div className="flex-1 min-w-[180px]">
                      <SearchableSelect
                        options={[
                          { value: '', label: t('selectProduct') || 'Product...' },
                          ...products.map((p) => ({ value: String(p.id), label: p.name })),
                        ]}
                        value={item.product_id}
                        onChange={(v) => setItem(idx, { product_id: v })}
                        placeholder={t('common.searchSelect')}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm outline-none"
                      />
                    </div>
                    <input
                      type="number"
                      min="0.0001"
                      step="any"
                      placeholder={t('qty') || 'Qty'}
                      value={item.quantity}
                      onChange={(e) => setItem(idx, { quantity: e.target.value })}
                      className="w-24 px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm outline-none"
                    />
                    <input
                      type="number"
                      min="0"
                      max="99"
                      step="any"
                      placeholder={t('bom.waste')}
                      value={item.waste_factor}
                      onChange={(e) => setItem(idx, { waste_factor: e.target.value })}
                      className="w-24 px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm outline-none"
                      title={t('bom.waste')}
                    />
                    <label className="flex items-center gap-1 text-xs text-muted whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={item.is_byproduct}
                        onChange={(e) => setItem(idx, { is_byproduct: e.target.checked })}
                      />
                      {t('bom.byproduct')}
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          items: editor.form.items.length > 1
                            ? editor.form.items.filter((_, i) => i !== idx)
                            : editor.form.items,
                        })
                      }
                      className="px-2 text-muted hover:text-red-500"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Routing */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-foreground">{t('mfg.workOrders')}</label>
                  <button
                    type="button"
                    onClick={() => setForm({ operations: [...editor.form.operations, emptyOp()] })}
                    className="text-sm text-accent hover:text-blue-700"
                  >
                    + {t('bom.addStep')}
                  </button>
                </div>
                {editor.form.operations.map((op, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-2 mb-2 p-2 border border-border rounded-lg">
                    <input
                      type="text"
                      placeholder={t('bom.stepName')}
                      value={op.name}
                      onChange={(e) => setOp(idx, { name: e.target.value })}
                      className="flex-1 min-w-[140px] px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm outline-none"
                    />
                    <div className="min-w-[160px]">
                      <SearchableSelect
                        options={[
                          { value: '', label: t('bom.noWorkCenter') },
                          ...workCenters.filter((w) => w.is_active).map((w) => ({ value: String(w.id), label: w.name })),
                        ]}
                        value={op.work_center_id}
                        onChange={(v) => setOp(idx, { work_center_id: String(v ?? '') })}
                        placeholder={t('common.searchSelect')}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm outline-none"
                      />
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder={t('mfg.minutes')}
                      value={op.expected_minutes}
                      onChange={(e) => setOp(idx, { expected_minutes: e.target.value })}
                      className="w-24 px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setForm({ operations: editor.form.operations.filter((_, i) => i !== idx) })}
                      className="px-2 text-muted hover:text-red-500"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Live cost preview */}
              <div className="p-3 bg-surface-tertiary rounded-lg text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted">{t('mfg.componentCost')}</span>
                  <span className="text-foreground font-medium">{formatCurrency(preview.component)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">{t('mfg.operationsCost')}</span>
                  <span className="text-foreground font-medium">{formatCurrency(preview.operations)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1">
                  <span className="text-muted">{t('bom.previewRun')}</span>
                  <span className="text-foreground font-semibold">{formatCurrency(preview.total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">{t('bom.previewUnit')}</span>
                  <span className="text-foreground font-semibold">{formatCurrency(preview.perUnit)}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">{t('status') || 'Status'}</label>
                  <select
                    value={editor.form.status}
                    onChange={(e) => setForm({ status: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground ring-focus outline-none"
                  >
                    {BOM_STATUSES.map((s) => (
                      <option key={s} value={s}>{t(`bom.status.${s}`) || s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">{t('notes') || 'Notes'}</label>
                  <input
                    type="text"
                    value={editor.form.notes}
                    onChange={(e) => setForm({ notes: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground ring-focus outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditor(null)}
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
                  {t('common.save') || 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Work center editor */}
      {wcEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                {wcEditor.mode === 'edit' ? t('wc.editTitle') : t('wc.createTitle')}
              </h3>
              <button onClick={() => setWcEditor(null)} className="text-muted text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveWc} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">{t('common.name') || 'Name'}*</label>
                <input
                  type="text"
                  value={wcEditor.form.name}
                  onChange={(e) => setWcForm({ name: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground ring-focus outline-none"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">{t('wc.costPerHour')}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={wcEditor.form.cost_per_hour}
                    onChange={(e) => setWcForm({ cost_per_hour: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground ring-focus outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">{t('wc.efficiency')}</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={wcEditor.form.time_efficiency}
                    onChange={(e) => setWcForm({ time_efficiency: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground ring-focus outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">{t('common.description') || 'Description'}</label>
                <textarea
                  value={wcEditor.form.description}
                  onChange={(e) => setWcForm({ description: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground ring-focus outline-none"
                  rows={2}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={wcEditor.form.is_active}
                  onChange={(e) => setWcForm({ is_active: e.target.checked })}
                />
                {t('common.active') || 'Active'}
              </label>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setWcEditor(null)}
                  className="flex-1 px-4 py-2 border border-border rounded-lg text-foreground bg-surface-hover transition-colors"
                >
                  {t('cancel') || 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={wcSubmitting}
                  className="flex-1 px-4 py-2 bg-accent text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {wcSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('common.save') || 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
