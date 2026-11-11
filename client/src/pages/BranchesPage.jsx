import ConfirmModal from '../components/ConfirmModal'
import PhoneField from '../components/PhoneField'
import SearchableSelect from '../components/SearchableSelect'
import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { useUserStore } from '../stores/userStore'
import { useBranchStore } from '../stores/branchStore'
import { branchesApi, productsApi, stockApi } from '../lib/api'
import { AlertCircle, Archive, ArrowRight, Building2, CheckCircle, Edit2, MapPin, Package, Phone, Plus, RefreshCw, X } from 'lucide-react'

export default function BranchesPage() {
  const { t } = useAppStore()
  const currentUser = useUserStore((s) => s.currentUser)
  // Matches the API: branch mutations are requireManager (strictly MANAGER).
  const isManager = currentUser?.role === 'MANAGER'
  // Shared with the header switcher: branchStore is the single source of truth
  const branches = useBranchStore((s) => s.branches)
  const currentBranchId = useBranchStore((s) => s.currentBranchId)
  const loadBranches = useBranchStore((s) => s.loadBranches)
  const branchesLoading = useBranchStore((s) => s.loading)

  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [archiving, setArchiving] = useState(false)

  // Stock transfers
  const [products, setProducts] = useState([])
  const [transfers, setTransfers] = useState([])
  const [transfersLoading, setTransfersLoading] = useState(true)
  const [transferring, setTransferring] = useState(false)
  const [transferForm, setTransferForm] = useState({
    from_branch_id: '',
    to_branch_id: '',
    notes: '',
    items: [{ product_id: '', quantity: '' }],
  })

  const showMessage = (type, text) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  const loadTransfers = async () => {
    setTransfersLoading(true)
    try {
      const res = await stockApi.getTransfers()
      setTransfers(res.data?.data || [])
    } catch (err) {
      console.error('Failed to load transfers:', err)
      showMessage('error', t('transfers.loadFailed'))
    } finally {
      setTransfersLoading(false)
    }
  }

  const loadProducts = async () => {
    try {
      const res = await productsApi.getAll()
      setProducts(res.data?.data || res.data || [])
    } catch (err) {
      console.error('Failed to load products:', err)
    }
  }

  useEffect(() => {
    const init = async () => {
      await loadBranches()
      // The spinner hides the page until this resolves, so the transfer form
      // can be seeded with the (server-corrected) current branch right away.
      const state = useBranchStore.getState()
      setTransferForm((f) => ({ ...f, from_branch_id: f.from_branch_id || state.currentBranchId || '' }))
      setLoading(false)
      // `loading` still true = another mount owns an in-flight load; don't
      // flash a false "failed" toast while its response is on its way.
      if (!state.loading && state.branches.length === 0) showMessage('error', t('branches.loadFailed'))
    }
    init()
    loadTransfers()
    loadProducts()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate mount-only loaders: loadBranches/loadTransfers/loadProducts are re-created each render and intentionally NOT deps
  }, [])

  const activeBranches = branches.filter((b) => b.is_active)

  const branchName = (id) => {
    if (id == null) return '-'
    const found = branches.find((b) => Number(b.id) === Number(id))
    return found ? found.name : `#${id}`
  }

  const handleSave = async (data) => {
    if (saving) return
    const name = (data.name || '').trim()
    if (!name) return
    setSaving(true)
    try {
      const payload = {
        name,
        code: (data.code || '').trim() || null,
        type: data.type,
        address: (data.address || '').trim() || null,
        phone: (data.phone || '').trim() || null,
      }
      if (editing) {
        await branchesApi.update(editing.id, payload)
        showMessage('success', t('branches.updated'))
      } else {
        await branchesApi.create(payload)
        showMessage('success', t('branches.created'))
      }
      setShowForm(false)
      setEditing(null)
      await loadBranches(true)
    } catch (err) {
      showMessage('error', err.response?.data?.error || t('branches.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async () => {
    if (!archiveTarget || archiving) return
    const wasCurrent = Number(archiveTarget.id) === Number(currentBranchId)
    setArchiving(true)
    try {
      await branchesApi.archive(archiveTarget.id)
      showMessage('success', t('branches.archiveSuccess'))
      setArchiveTarget(null)
      await loadBranches(true)
      // Archiving the branch we are currently working under moves us to the
      // server-resolved branch — drop the old branch's caches and reload, the
      // same way setBranch does, so no stale stock stays on screen.
      if (wasCurrent) {
        const { currentBranchId: next } = useBranchStore.getState()
        if (next != null && next !== archiveTarget.id) {
          await useBranchStore.getState().setBranch(next)
        }
      }
    } catch (err) {
      showMessage('error', err.response?.data?.error || t('branches.saveFailed'))
      setArchiving(false)
      return
    }
    setArchiving(false)
  }

  // ---- Transfer form helpers ----
  const handleFromChange = (value) => {
    setTransferForm((f) => ({
      ...f,
      from_branch_id: value,
      // Never allow sending a branch to itself
      to_branch_id: Number(f.to_branch_id) === Number(value) ? '' : f.to_branch_id,
    }))
  }

  const handleItemChange = (index, field, value) => {
    setTransferForm((prev) => {
      const items = [...prev.items]
      items[index] = { ...items[index], [field]: value }
      return { ...prev, items }
    })
  }

  const addItemRow = () => {
    setTransferForm((prev) => ({
      ...prev,
      items: [...prev.items, { product_id: '', quantity: '' }],
    }))
  }

  const removeItemRow = (index) => {
    setTransferForm((prev) => {
      if (prev.items.length <= 1) return prev
      return { ...prev, items: prev.items.filter((_, i) => i !== index) }
    })
  }

  const handleTransfer = async (e) => {
    e.preventDefault()
    if (transferring) return
    const fromId = Number(transferForm.from_branch_id) || 0
    const toId = Number(transferForm.to_branch_id) || 0
    if (!fromId) {
      showMessage('error', t('branches.noBranches'))
      return
    }
    if (!toId || fromId === toId) {
      showMessage('error', t('error.branchSame'))
      return
    }
    const items = transferForm.items.filter((i) => i.product_id !== '')
    if (items.length === 0) {
      showMessage('error', t('error.branchEmpty'))
      return
    }
    if (items.some((i) => i.quantity === '' || Number(i.quantity) < 1)) {
      showMessage('error', t('transfers.invalidQuantity'))
      return
    }
    try {
      setTransferring(true)
      const payload = {
        from_branch_id: fromId,
        to_branch_id: toId,
        items: items.map((i) => ({ product_id: Number(i.product_id), quantity: Number(i.quantity) })),
      }
      const notes = (transferForm.notes || '').trim()
      if (notes) payload.notes = notes
      await stockApi.createTransfer(payload)
      showMessage('success', t('transfers.created'))
      setTransferForm({
        from_branch_id: transferForm.from_branch_id,
        to_branch_id: '',
        notes: '',
        items: [{ product_id: '', quantity: '' }],
      })
      loadTransfers()
      // Quantities moved: refresh the availability hints
      loadProducts()
    } catch (err) {
      showMessage('error', err.response?.data?.error || t('transfers.failed'))
    } finally {
      setTransferring(false)
    }
  }

  const fromId = Number(transferForm.from_branch_id) || 0
  const toOptions = activeBranches.filter((b) => Number(b.id) !== fromId)
  const formatDate = (date) => (date ? new Date(date).toLocaleString() : '-')

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 transition-all duration-300 ${
          message.type === 'success' ? 'bg-success text-white' : 'bg-danger text-white'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          {message.text}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="w-7 h-7" />
            {t('branches.title')}
          </h1>
          <p className="text-sm text-muted mt-1">{t('branches.subtitle')}</p>
        </div>
        {isManager && (
          <button
            onClick={() => {
              setEditing(null)
              setShowForm(true)
            }}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-primary-700"
          >
            <Plus className="w-4 h-4" />
            {t('branches.newBranch')}
          </button>
        )}
      </div>

      {/* Branches List */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-bold text-foreground flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            {t('branches.title')} ({branches.length})
          </h3>
          <button onClick={() => loadBranches(true)} className="p-2 rounded-lg bg-surface-hover transition-colors">
            <RefreshCw className={`w-4 h-4 ${branchesLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {branches.length === 0 ? (
          <div className="p-8 text-center text-muted">
            <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>{t('branches.noBranches')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-surface-secondary">
                <tr>
                  <th className="px-6 py-3 text-start text-sm font-medium text-muted">{t('branches.name')}</th>
                  <th className="px-4 py-3 text-start text-sm font-medium text-muted">{t('branches.code')}</th>
                  <th className="px-4 py-3 text-start text-sm font-medium text-muted">{t('branches.type')}</th>
                  <th className="px-4 py-3 text-start text-sm font-medium text-muted">{t('branches.status')}</th>
                  {isManager && <th className="px-4 py-3 text-end text-sm font-medium text-muted">{t('common.actions')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {branches.map((b) => (
                  <tr key={b.id} className="bg-surface-hover">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground">{b.name}</span>
                        {b.is_default && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning-soft text-warning-soft-foreground">
                            {t('branches.default')}
                          </span>
                        )}
                      </div>
                      {(b.address || b.phone) && (
                        <div className="mt-1 space-y-0.5">
                          {b.address && (
                            <p className="text-xs text-muted flex items-center gap-1">
                              <MapPin className="w-3 h-3 flex-shrink-0" />
                              {b.address}
                            </p>
                          )}
                          {b.phone && (
                            <p className="text-xs text-muted flex items-center gap-1">
                              <Phone className="w-3 h-3 flex-shrink-0" />
                              {b.phone}
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm text-muted">{b.code || '-'}</td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                        b.type === 'warehouse'
                          ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                          : 'bg-accent-soft text-accent-soft-foreground'
                      }`}>
                        {b.type === 'warehouse' ? t('branches.typeWarehouse') : t('branches.typeStore')}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                        b.is_active
                          ? 'bg-success-soft text-success-soft-foreground'
                          : 'bg-surface-tertiary text-muted'
                      }`}>
                        {b.is_active ? t('branches.active') : t('branches.archived')}
                      </span>
                    </td>
                    {isManager && (
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => {
                              setEditing(b)
                              setShowForm(true)
                            }}
                            className="p-2 text-muted hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                            title={t('branches.editBranch')}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setArchiveTarget(b)}
                            disabled={b.is_default}
                            title={b.is_default ? t('branches.defaultProtected') : t('branches.archive')}
                            className={`p-2 rounded-lg transition-colors ${
                              b.is_default
                                ? 'text-muted opacity-50 cursor-not-allowed'
                                : 'text-muted hover:text-red-600 hover:bg-red-50'
                            }`}
                          >
                            <Archive className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stock Transfers */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="font-bold text-foreground flex items-center gap-2">
            <Package className="w-5 h-5" />
            {t('transfers.title')}
          </h3>
          <p className="text-xs text-muted mt-1">{t('transfers.subtitle')}</p>
        </div>

        <form onSubmit={handleTransfer} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">{t('transfers.from')}</label>
              <SearchableSelect
                options={[
                  { value: '', label: t('branches.branch') },
                  ...activeBranches.map((b) => ({ value: String(b.id), label: b.name })),
                ]}
                value={transferForm.from_branch_id}
                onChange={(v) => handleFromChange(v)}
                placeholder={t('common.searchSelect')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">{t('transfers.to')}</label>
              <SearchableSelect
                options={[
                  { value: '', label: t('branches.branch') },
                  ...toOptions.map((b) => ({ value: String(b.id), label: b.name })),
                ]}
                value={transferForm.to_branch_id}
                onChange={(v) => setTransferForm((f) => ({ ...f, to_branch_id: v }))}
                placeholder={t('common.searchSelect')}
              />
            </div>
          </div>

          {/* Availability shown here is the CURRENT branch's stock — warn when
              the operator is about to transfer from a different source */}
          {fromId !== 0 && fromId !== Number(currentBranchId) && (
            <p className="text-xs text-warning bg-warning-soft border border-warning rounded-lg px-3 py-2 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {t('branches.sourceHint')}
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">{t('transfers.items')}</label>
            {transferForm.items.map((item, idx) => {
              const product = products.find((p) => Number(p.id) === Number(item.product_id))
              return (
                <div key={idx} className="mb-3">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <SearchableSelect
                        options={[
                          { value: '', label: t('transfers.selectProduct') },
                          ...products.map((p) => ({
                            value: String(p.id),
                            label: `${p.name}${p.sku ? ` (${p.sku})` : ''}`,
                          })),
                        ]}
                        value={item.product_id}
                        onChange={(v) => handleItemChange(idx, 'product_id', v)}
                        placeholder={t('common.searchSelect')}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm outline-none"
                      />
                    </div>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder={t('transfers.quantity')}
                      value={item.quantity}
                      onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                      className="w-24 px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeItemRow(idx)}
                      className="px-2 text-muted hover:text-red-500"
                      title={t('transfers.items')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {product && (
                    <p className="text-xs text-muted mt-1">
                      {product.sku ? `${product.sku} · ` : ''}
                      {t('transfers.availability', { qty: product.stock_quantity ?? 0 })}
                    </p>
                  )}
                </div>
              )
            })}
            <button type="button" onClick={addItemRow} className="text-sm text-accent hover:text-blue-700">
              + {t('transfers.addItem')}
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t('transfers.notes')}</label>
            <textarea
              value={transferForm.notes}
              onChange={(e) => setTransferForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder={t('transfers.notesPlaceholder')}
              rows={2}
              className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={transferring}
              className="px-5 py-2 bg-accent text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
            >
              {transferring && <RefreshCw className="w-4 h-4 animate-spin" />}
              {transferring ? t('transfers.creating') : t('transfers.submit')}
            </button>
          </div>
        </form>
      </div>

      {/* Transfer History */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-bold text-foreground flex items-center gap-2">
            <ArrowRight className="w-5 h-5" />
            {t('transfers.history')} ({transfers.length})
          </h3>
          <button onClick={loadTransfers} className="p-2 rounded-lg bg-surface-hover transition-colors">
            <RefreshCw className={`w-4 h-4 ${transfersLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {transfersLoading ? (
          <div className="p-8 text-center text-muted">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
            {t('common.loading')}
          </div>
        ) : transfers.length === 0 ? (
          <div className="p-8 text-center text-muted">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>{t('transfers.noTransfers')}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {transfers.map((tr) => (
              <div key={tr.id} className="px-6 py-4 bg-surface-hover">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span>{branchName(tr.from_branch_id)}</span>
                    <ArrowRight className="w-4 h-4 text-muted" />
                    <span>{branchName(tr.to_branch_id)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-success-soft text-success-soft-foreground">
                      {tr.status === 'completed' ? t('transfers.completed') : tr.status}
                    </span>
                    <span className="text-xs text-muted">{formatDate(tr.created_at)}</span>
                  </div>
                </div>
                {tr.notes && <p className="text-sm text-muted mt-1">{tr.notes}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {tr.items?.map((it, idx) => (
                    <span key={idx} className="text-xs bg-surface-tertiary rounded-full px-2 py-1 text-muted">
                      {it.product?.name || `#${it.product?.id}`} × {it.quantity}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Branch Form Modal */}
      {showForm && (
        <BranchForm
          branch={editing}
          saving={saving}
          onSave={handleSave}
          onClose={() => {
            setShowForm(false)
            setEditing(null)
          }}
        />
      )}

      <ConfirmModal
        open={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onConfirm={handleArchive}
        title={t('branches.archive')}
        message={archiveTarget ? t('branches.archiveConfirm', { name: archiveTarget.name }) : ''}
        type="warning"
        confirmText={t('branches.archive')}
        cancelText={t('common.cancel')}
        loading={archiving}
      />
    </div>
  )
}

function BranchForm({ branch, saving, onSave, onClose }) {
  const { t } = useAppStore()
  const [formData, setFormData] = useState({
    name: branch?.name || '',
    code: branch?.code || '',
    type: branch?.type || 'store',
    address: branch?.address || '',
    phone: branch?.phone || '',
  })

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave(formData)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface rounded-2xl w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-xl font-semibold">
            {branch ? t('branches.editBranch') : t('branches.newBranch')}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg bg-surface-hover">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('branches.name')} *
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                placeholder={t('branches.namePlaceholder')}
                className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                {t('branches.code')}
              </label>
              <input
                type="text"
                name="code"
                value={formData.code}
                onChange={handleChange}
                className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('branches.type')} *
            </label>
            <SearchableSelect
              options={[
                { value: 'store', label: t('branches.typeStore') },
                { value: 'warehouse', label: t('branches.typeWarehouse') },
              ]}
              value={formData.type}
              onChange={(v) => setFormData((prev) => ({ ...prev, type: v }))}
              placeholder={t('common.searchSelect')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('branches.address')}
            </label>
            <input
              type="text"
              name="address"
              value={formData.address}
              onChange={handleChange}
              className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
            />
          </div>

          <div>
            <PhoneField
              id="branch-phone"
              label={t('branches.phone')}
              value={formData.phone}
              onChange={(full) => setFormData((prev) => ({ ...prev, phone: full }))}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-foreground bg-surface-tertiary rounded-lg bg-surface-hover"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
