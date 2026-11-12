import ConfirmModal from '../components/ConfirmModal'
import CsvImportModal from '../components/CsvImportModal'
import PhoneField from '../components/PhoneField'
import SearchableSelect from '../components/SearchableSelect'
import { X, Plus, Edit2, Trash2, Truck, Phone, Mail, MapPin, DollarSign, Upload, Search, MessageCircle, FileText, Eye } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { useUserStore, PERMISSIONS } from '../stores/userStore'
import { suppliersApi } from '../lib/api'

export default function SuppliersPage() {
  const { t, toastSuccess, toastError } = useAppStore()
  const { hasPermission } = useUserStore()
  const canEdit = hasPermission(PERMISSIONS.SUPPLIERS_EDIT)
  const navigate = useNavigate()
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [overview, setOverview] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailTab, setDetailTab] = useState('products')

  useEffect(() => {
    fetchSuppliers()
  }, [])

  const fetchSuppliers = async () => {
    setLoading(true)
    try {
      const [response, ov] = await Promise.all([
        suppliersApi.getAll(),
        // Header stat only — the page still works if this call fails.
        suppliersApi.overview().catch(() => ({ data: null })),
      ])
      setSuppliers(response.data)
      setOverview(ov.data)
    } catch (err) {
      console.error('Failed to fetch suppliers:', err)
    } finally {
      setLoading(false)
    }
  }

  // Detail drawer: one enriched round trip (balance, stats, aging, lists).
  const openDetail = async (supplier) => {
    setDetailId(supplier.id)
    setDetail(null)
    setDetailTab('products')
    setDetailLoading(true)
    try {
      const res = await suppliersApi.getById(supplier.id)
      setDetail(res.data)
    } catch (err) {
      console.error('Failed to fetch supplier detail:', err)
      toastError(t('suppliers.detailFailed'))
      setDetailId(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleEdit = (supplier) => {
    setEditingSupplier(supplier)
    setShowForm(true)
  }

  // CSV import: batch upsert, refresh the list, hand the per-row report to
  // the modal (rejections surface there, not as a toast).
  const handleImportSuppliers = async (items) => {
    const res = await suppliersApi.importCsv(items)
    fetchSuppliers()
    return res.data
  }

  const handleDelete = async (id) => {
    setDeleting(true)
    try {
      await suppliersApi.delete(id)
      toastSuccess(t('suppliers.deleted') || 'Supplier deleted successfully')
      fetchSuppliers()
      setDeleteTarget(null)
    } catch (err) {
      console.error('Failed to delete supplier:', err)
      toastError(t('suppliers.failedToDelete'))
    } finally {
      setDeleting(false)
    }
  }

  const handleSave = async (supplierData) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      if (editingSupplier) {
        await suppliersApi.update(editingSupplier.id, supplierData)
        toastSuccess(t('suppliers.updated') || 'Supplier updated successfully')
      } else {
        await suppliersApi.create(supplierData)
        toastSuccess(t('suppliers.created') || 'Supplier added successfully')
      }
      setShowForm(false)
      setEditingSupplier(null)
      fetchSuppliers()
    } catch (err) {
      console.error('Failed to save supplier:', err)
      toastError(t('suppliers.failedToSave'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const formatAmount = (val) => {
    const num = parseFloat(val) || 0
    return num.toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  // wa.me wants digits only (PhoneField stores +2010…, which strips clean).
  const waLink = (phone) => `https://wa.me/${phone.replace(/[^0-9]/g, '')}`

  const totalOwed = suppliers.reduce((sum, s) => sum + (parseFloat(s.balance) || 0), 0)

  // Search across identity fields; sort drives the "who do I owe" question.
  const query = search.trim().toLowerCase()
  const visible = suppliers
    .filter((s) =>
      !query ||
      [s.name, s.contact_person, s.phone, s.email].some((v) => (v || '').toLowerCase().includes(query))
    )
    .sort((a, b) => {
      if (sortBy === 'balance_desc') return (parseFloat(b.balance) || 0) - (parseFloat(a.balance) || 0)
      if (sortBy === 'balance_asc') return (parseFloat(a.balance) || 0) - (parseFloat(b.balance) || 0)
      return (a.name || '').localeCompare(b.name || '')
    })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('suppliers.title')}</h1>
<p className="text-muted">{t('suppliers.subtitle')}</p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-surface-tertiary rounded-lg bg-surface-hover min-h-[44px]"
            >
              <Upload className="w-4 h-4" />
              <span className="hidden sm:inline">{t('importCsv.button')}</span>
            </button>
            <button
              onClick={() => {
                setEditingSupplier(null)
                setShowForm(true)
              }}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-primary-700 min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              {t('suppliers.addSupplier')}
            </button>
          </div>
        )}
      </div>

      {/* Summary cards: who we owe, how many suppliers, recent buying */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-surface rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <DollarSign className="w-4 h-4 text-danger" /> {t('suppliers.totalOwed')}
          </div>
          <p className="text-xl font-bold text-danger">{formatAmount(totalOwed)} EGP</p>
        </div>
        <div className="bg-surface rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <Truck className="w-4 h-4 text-accent" /> {t('suppliers.suppliersCount')}
          </div>
          <p className="text-xl font-bold">{suppliers.length}</p>
        </div>
        <div className="bg-surface rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <FileText className="w-4 h-4 text-success" /> {t('suppliers.purchases30d')}
          </div>
          <p className="text-xl font-bold text-success">
            {overview ? `${formatAmount(overview.purchases_30d)} EGP` : '—'}
          </p>
        </div>
      </div>

      {/* Search + sort */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`${t('common.search')}...`}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-surface ring-focus outline-none"
          />
        </div>
        <SearchableSelect
          options={[
            { value: 'name', label: t('suppliers.sortName') },
            { value: 'balance_desc', label: t('suppliers.sortBalanceDesc') },
            { value: 'balance_asc', label: t('suppliers.sortBalanceAsc') },
          ]}
          value={sortBy}
          onChange={(v) => setSortBy(v)}
          placeholder={t('common.searchSelect')}
          className="px-4 py-2.5 rounded-xl border border-border bg-surface outline-none ring-focus"
        />
      </div>

      {/* Suppliers Grid */}
      {suppliers.length === 0 ? (
<div className="bg-surface rounded-xl border border-border p-12 text-center">
<Truck className="w-16 h-16 mx-auto text-foreground mb-4"/>
<h3 className="text-lg font-medium text-foreground mb-2">{t('suppliers.noSuppliers')}</h3>
<p className="text-muted">{t('suppliers.addFirstSupplier')}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-12 text-center">
          <p className="text-muted">{t('suppliers.noMatches')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((supplier) => (
            <div
              key={supplier.id}
className="bg-surface rounded-xl border border-border p-4"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
<div className="p-2 bg-accent-soft rounded-lg">
<Truck className="w-5 h-5 text-accent"/>
                  </div>
                  <div>
                    <h3 className="font-semibold">{supplier.name}</h3>
                    {supplier.contact_person && (
<p className="text-sm text-muted">{supplier.contact_person}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  {canEdit && (
                    <button
                      onClick={() => handleEdit(supplier)}
className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => setDeleteTarget(supplier.id)}
className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted hover:text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Data-quality badges: gaps the CSV import left behind */}
              {(!supplier.phone || !supplier.email) && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {!supplier.phone && (
                    <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-danger-soft text-danger-soft-foreground">
                      {t('suppliers.noPhone')}
                    </span>
                  )}
                  {!supplier.email && (
                    <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-surface-tertiary text-muted">
                      {t('suppliers.noEmail')}
                    </span>
                  )}
                </div>
              )}

              <div className="space-y-2 text-sm">
                {supplier.phone && (
<div className="flex items-center gap-2 text-muted">
                    <Phone className="w-4 h-4" />
                    <span>{supplier.phone}</span>
                  </div>
                )}
                {supplier.email && (
<div className="flex items-center gap-2 text-muted">
                    <Mail className="w-4 h-4" />
                    <span>{supplier.email}</span>
                  </div>
                )}
                {supplier.address && (
<div className="flex items-center gap-2 text-muted">
                    <MapPin className="w-4 h-4" />
                    <span className="line-clamp-1">{supplier.address}</span>
                  </div>
                )}
              </div>

              {supplier.notes && (
<p className="mt-3 text-sm text-muted border-t border-border pt-3">
                  {supplier.notes}
                </p>
              )}

              {/* AP Balance + quick actions */}
              <div className="mt-3 border-t border-border pt-3 space-y-2">
                {supplier.account_code && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <DollarSign className="w-4 h-4" />
                      <span>{t('suppliers.remainingBalance')}</span>
                    </div>
                    <span className={`text-sm font-bold ${parseFloat(supplier.balance)>0 ?'text-danger':'text-success'}`}>
                      {formatAmount(supplier.balance)}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {supplier.phone && (
                    <>
                      <a
                        href={`tel:${supplier.phone}`}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted hover:text-foreground hover:bg-surface-hover rounded-lg"
                      >
                        <Phone className="w-3.5 h-3.5" /> {t('suppliers.call')}
                      </a>
                      <a
                        href={waLink(supplier.phone)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted hover:text-foreground hover:bg-surface-hover rounded-lg"
                      >
                        <MessageCircle className="w-3.5 h-3.5" /> {t('suppliers.whatsapp')}
                      </a>
                    </>
                  )}
                  <button
                    onClick={() => navigate(`/accounting/payments?new=1&type=outbound&supplier=${supplier.id}`)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted hover:text-foreground hover:bg-surface-hover rounded-lg"
                  >
                    <DollarSign className="w-3.5 h-3.5" /> {t('suppliers.pay')}
                  </button>
                  <button
                    onClick={() => navigate(`/purchase-orders?new=1&supplier=${supplier.id}`)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted hover:text-foreground hover:bg-surface-hover rounded-lg"
                  >
                    <FileText className="w-3.5 h-3.5" /> {t('suppliers.newPo')}
                  </button>
                  <button
                    onClick={() => openDetail(supplier)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft rounded-lg"
                  >
                    <Eye className="w-3.5 h-3.5" /> {t('suppliers.details')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CSV Import Modal */}
      <CsvImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        entity="suppliers"
        onImport={handleImportSuppliers}
      />

      {/* Supplier Form Modal */}
      {showForm && (
        <SupplierForm
          supplier={editingSupplier}
          onSave={handleSave}
          onClose={() => {
            setShowForm(false)
            setEditingSupplier(null)
          }}
        />
      )}

      {/* Supplier detail drawer */}
      {detailId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">
                {detail?.name || suppliers.find((s) => s.id === detailId)?.name || ''}
              </h3>
              <button
                onClick={() => { setDetailId(null); setDetail(null) }}
                className="text-muted hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {detailLoading || !detail ? (
              <div className="flex items-center justify-center h-40">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
              </div>
            ) : (
              <>
                <div className="space-y-1.5 text-sm text-muted">
                  {detail.contact_person && <p>{detail.contact_person}</p>}
                  {detail.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4" /> <span>{detail.phone}</span>
                    </div>
                  )}
                  {detail.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4" /> <span>{detail.email}</span>
                    </div>
                  )}
                  {detail.address && (
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4" /> <span>{detail.address}</span>
                    </div>
                  )}
                </div>

                {/* AP balance + aging buckets */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl bg-surface-secondary border border-border p-3">
                    <p className="text-xs text-muted">{t('suppliers.remainingBalance')}</p>
                    <p className={`font-bold ${detail.balance > 0 ? 'text-danger' : 'text-success'}`}>
                      {formatAmount(detail.balance)}
                    </p>
                  </div>
                  {detail.aging && (
                    <>
                      <div className="rounded-xl bg-surface-secondary border border-border p-3">
                        <p className="text-xs text-muted">{t('suppliers.agingCurrent')}</p>
                        <p className="font-bold">{formatAmount(detail.aging.current)}</p>
                      </div>
                      <div className="rounded-xl bg-surface-secondary border border-border p-3">
                        <p className="text-xs text-muted">{t('suppliers.agingD30')}</p>
                        <p className={`font-bold ${detail.aging.d30 > 0 ? 'text-danger' : ''}`}>
                          {formatAmount(detail.aging.d30)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-surface-secondary border border-border p-3">
                        <p className="text-xs text-muted">{t('suppliers.agingD60')}</p>
                        <p className={`font-bold ${detail.aging.d60 > 0 ? 'text-danger' : ''}`}>
                          {formatAmount(detail.aging.d60)}
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {/* Lifetime stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div>
                    <p className="font-bold">{formatAmount(detail.stats.total_purchased)}</p>
                    <p className="text-xs text-muted">{t('suppliers.totalPurchased')}</p>
                  </div>
                  <div>
                    <p className="font-bold">{detail.stats.po_count}</p>
                    <p className="text-xs text-muted">{t('suppliers.orders')}</p>
                  </div>
                  <div>
                    <p className="font-bold">
                      {detail.stats.last_po_date ? new Date(detail.stats.last_po_date).toLocaleDateString() : '—'}
                    </p>
                    <p className="text-xs text-muted">{t('suppliers.lastOrder')}</p>
                  </div>
                  <div>
                    <p className="font-bold">{formatAmount(detail.stats.total_paid)}</p>
                    <p className="text-xs text-muted">{t('suppliers.totalPaid')}</p>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 border-b border-border pb-2">
                  {[
                    { key: 'products', label: t('suppliers.tabProducts') },
                    { key: 'orders', label: t('suppliers.tabOrders') },
                    { key: 'payments', label: t('suppliers.tabPayments') },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setDetailTab(tab.key)}
                      className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
                        detailTab === tab.key
                          ? 'bg-accent text-white'
                          : 'text-muted hover:text-foreground hover:bg-surface-hover'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  {detailTab === 'products' && (
                    detail.products.length === 0 ? (
                      <p className="text-sm text-muted text-center py-4">{t('suppliers.noProducts')}</p>
                    ) : detail.products.map((p) => (
                      <div key={p.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm">
                        <div>
                          <p className="font-medium text-foreground">{p.name}</p>
                          <p className="text-xs text-muted">{p.sku || '—'}</p>
                        </div>
                        <div className="text-end">
                          <p className="font-bold">{formatAmount(p.price)} EGP</p>
                          <p className="text-xs text-muted">{t('suppliers.stock')}: {p.stock_quantity}</p>
                        </div>
                      </div>
                    ))
                  )}

                  {detailTab === 'orders' && (
                    detail.recent_pos.length === 0 ? (
                      <p className="text-sm text-muted text-center py-4">{t('suppliers.noOrders')}</p>
                    ) : detail.recent_pos.map((po) => (
                      <div key={po.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm">
                        <div>
                          <p className="font-medium text-foreground">{po.order_number}</p>
                          <p className="text-xs text-muted">
                            {new Date(po.received_date || po.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-surface-tertiary text-muted">
                            {t(po.status) || po.status}
                          </span>
                          <span className="font-bold">{formatAmount(po.total)} EGP</span>
                        </div>
                      </div>
                    ))
                  )}

                  {detailTab === 'payments' && (
                    detail.recent_payments.length === 0 ? (
                      <p className="text-sm text-muted text-center py-4">{t('suppliers.noPayments')}</p>
                    ) : detail.recent_payments.map((p) => (
                      <div key={p.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-secondary border border-border text-sm">
                        <div>
                          <p className="font-medium text-foreground">{p.payment_number}</p>
                          <p className="text-xs text-muted">{p.payment_date ? new Date(p.payment_date).toLocaleDateString() : ''}</p>
                        </div>
                        <span className="font-bold">{formatAmount(p.amount)} EGP</span>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete(deleteTarget)}
        title={t('suppliers.deleteSupplier') || 'Delete Supplier'}
        message={t('suppliers.deleteConfirm') || 'Are you sure you want to delete this supplier?'}
        type="danger"
        confirmText={t('common.delete') || 'Delete'}
        cancelText={t('common.cancel') || 'Cancel'}
        loading={deleting}
      />
    </div>
  )
}

function SupplierForm({ supplier, onSave, onClose }) {
  const { t } = useAppStore()
  const [formData, setFormData] = useState({
    name: supplier?.name || '',
    contact_person: supplier?.contact_person || '',
    email: supplier?.email || '',
    phone: supplier?.phone || '',
    address: supplier?.address || '',
    notes: supplier?.notes || '',
  })

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave(formData)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
<div className="bg-surface rounded-2xl w-full max-w-lg mx-4 shadow-2xl">
<div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-xl font-semibold">
            {supplier ? t('suppliers.editSupplier') : t('suppliers.addNewSupplier')}
          </h2>
          <button
            onClick={onClose}
className="p-2 rounded-lg bg-surface-hover"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
<label className="block text-sm font-medium text-foreground mb-1">
              {t('suppliers.supplierName')} *
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
<label className="block text-sm font-medium text-foreground mb-1">
                {t('suppliers.contactPerson')}
              </label>
              <input
                type="text"
                name="contact_person"
                value={formData.contact_person}
                onChange={handleChange}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
              />
            </div>
            <div>
              <PhoneField
                id="supplier-phone"
                label={t('suppliers.phone')}
                value={formData.phone}
                onChange={(full) => setFormData(prev => ({ ...prev, phone: full }))}
              />
            </div>
          </div>

          <div>
<label className="block text-sm font-medium text-foreground mb-1">
              {t('suppliers.email')}
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
            />
          </div>

          <div>
<label className="block text-sm font-medium text-foreground mb-1">
              {t('suppliers.address')}
            </label>
            <textarea
              name="address"
              value={formData.address}
              onChange={handleChange}
              rows={2}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
            />
          </div>

          <div>
<label className="block text-sm font-medium text-foreground mb-1">
              {t('suppliers.notes')}
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={2}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
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
className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-primary-700"
            >
              {supplier ? t('suppliers.update') : t('suppliers.add')} {t('suppliers.title')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
