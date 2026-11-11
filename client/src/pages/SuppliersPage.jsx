import ConfirmModal from '../components/ConfirmModal'
import CsvImportModal from '../components/CsvImportModal'
import { X, Plus, Edit2, Trash2, Truck, Phone, Mail, MapPin, DollarSign, Wallet, Upload } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { useUserStore, PERMISSIONS } from '../stores/userStore'
import { suppliersApi, supplierAdvancesApi } from '../lib/api'

export default function SuppliersPage() {
  const { t, toastSuccess, toastError } = useAppStore()
  const { hasPermission } = useUserStore()
  const canEdit = hasPermission(PERMISSIONS.SUPPLIERS_EDIT)
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [advanceTarget, setAdvanceTarget] = useState(null)
  const [advanceForm, setAdvanceForm] = useState({ amount: '', method: 'cash', notes: '' })
  const [isAdvancing, setIsAdvancing] = useState(false)

  useEffect(() => {
    fetchSuppliers()
  }, [])

  const fetchSuppliers = async () => {
    setLoading(true)
    try {
      const response = await suppliersApi.getAll()
      setSuppliers(response.data)
    } catch (err) {
      console.error('Failed to fetch suppliers:', err)
    } finally {
      setLoading(false)
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

  const openAdvanceModal = (supplier) => {
    setAdvanceTarget(supplier)
    setAdvanceForm({ amount: '', method: 'cash', notes: '' })
  }

  const handleAdvanceSubmit = async () => {
    const amount = parseFloat(advanceForm.amount)
    if (!amount || amount <= 0) return toastError(t('suppliers.advanceInvalidAmount') || 'Enter an amount greater than 0')
    if (isAdvancing) return
    setIsAdvancing(true)
    try {
      await supplierAdvancesApi.create({
        supplier_id: advanceTarget.id,
        amount,
        method: advanceForm.method,
        notes: advanceForm.notes || null,
      })
      toastSuccess(t('suppliers.advanceRecorded') || 'Advance recorded')
      setAdvanceTarget(null)
      fetchSuppliers()
    } catch (err) {
      toastError(err.response?.data?.error || t('suppliers.advanceFailed') || 'Failed to record advance')
    } finally {
      setIsAdvancing(false)
    }
  }

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

      {/* Suppliers Grid */}
      {suppliers.length === 0 ? (
<div className="bg-surface rounded-xl border border-border p-12 text-center">
<Truck className="w-16 h-16 mx-auto text-foreground mb-4"/>
<h3 className="text-lg font-medium text-foreground mb-2">{t('suppliers.noSuppliers')}</h3>
<p className="text-muted">{t('suppliers.addFirstSupplier')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {suppliers.map((supplier) => (
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

              {/* AP Balance + Advance */}
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
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-muted">
                    <Wallet className="w-4 h-4" />
                    <span>{t('suppliers.advanceBalance')}</span>
                  </div>
                  <span className={`text-sm font-bold ${(parseFloat(supplier.advance_available)||0)>0 ?'text-accent':'text-muted'}`}>
                    {formatAmount(supplier.advance_available)}
                  </span>
                </div>
                {canEdit && (
                  <button
                    onClick={() => openAdvanceModal(supplier)}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft rounded-lg transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t('suppliers.recordAdvance')}
                  </button>
                )}
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

      {/* Record Advance Modal */}
      {advanceTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">{t('suppliers.recordAdvance')}</h3>
              <button onClick={() => setAdvanceTarget(null)} className="text-muted hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-muted">
              {t('suppliers.advanceModalDesc') || 'Pay an advance to'} <span className="font-medium text-foreground">{advanceTarget.name}</span>
            </p>
            <input
              type="number"
              min="0"
              step="0.01"
              value={advanceForm.amount}
              onChange={(e) => setAdvanceForm({ ...advanceForm, amount: e.target.value })}
              placeholder={`${t('accounting.amount')} (EGP)`}
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus text-lg font-bold"
            />
            <select
              value={advanceForm.method}
              onChange={(e) => setAdvanceForm({ ...advanceForm, method: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"
            >
              <option value="cash">{t('accounting.cash')}</option>
              <option value="bank_transfer">{t('accounting.bankTransfer')}</option>
              <option value="card">{t('accounting.card')}</option>
              <option value="check">{t('accounting.check')}</option>
            </select>
            <textarea
              value={advanceForm.notes}
              onChange={(e) => setAdvanceForm({ ...advanceForm, notes: e.target.value })}
              placeholder={`${t('common.description')} (${t('accounting.optional')})`}
              rows={2}
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"
            />
            <div className="flex gap-3">
              <button
                onClick={handleAdvanceSubmit}
                disabled={isAdvancing}
                className="flex-1 px-4 py-2.5 bg-accent hover:bg-primary-700 text-white rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Wallet className="w-4 h-4" /> {t('suppliers.recordAdvance')}
              </button>
              <button
                onClick={() => setAdvanceTarget(null)}
                className="px-4 py-2.5 bg-surface-tertiary rounded-xl font-medium flex items-center gap-2"
              >
                <X className="w-4 h-4" /> {t('common.cancel')}
              </button>
            </div>
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
<label className="block text-sm font-medium text-foreground mb-1">
                {t('suppliers.phone')}
              </label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"
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
