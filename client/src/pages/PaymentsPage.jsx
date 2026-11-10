import ConfirmModal from '../components/ConfirmModal'
import SearchableSelect from '../components/SearchableSelect'
import { DollarSign, Plus, Search, Trash2, Save, X, ArrowUpRight, ArrowDownRight, Pencil } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { paymentsApi, suppliersApi } from '../lib/api'

export default function PaymentsPage() {
  const { t, toastSuccess, toastError } = useAppStore()
  const [payments, setPayments] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formData, setFormData] = useState({
    payment_type: 'inbound',
    method: 'cash',
    amount: '',
    reference: '',
    notes: '',
    payment_date: new Date().toISOString().split('T')[0],
    partner_type: '',
    partner_id: '',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchPayments()
    suppliersApi.getAll().then(res => setSuppliers(res.data || [])).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate trigger list: the loader below is re-created each render and is intentionally NOT a dep, so only these inputs refetch
  }, [search, filterType])

  const fetchPayments = async () => {
    try {
      const { data } = await paymentsApi.getAll({ search, payment_type: filterType })
      setPayments(data.data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const handleEdit = (payment) => {
    setEditingId(payment.id)
    setFormData({
      payment_type: payment.payment_type,
      method: payment.method,
      amount: payment.amount.toString(),
      reference: payment.reference || '',
      notes: payment.notes || '',
      payment_date: payment.payment_date,
      partner_type: payment.partner_type || '',
      partner_id: payment.partner_id || '',
    })
    setShowForm(true)
  }

  const handleSubmit = async () => {
    if (!formData.amount || parseFloat(formData.amount) <= 0) return toastError(t('accounting.enterAmount'))
    // Mirror the server's rule so the user is told here rather than bounced
    // off a 400: an outbound payment that names no supplier could never move
    // that supplier's Remaining Balance.
    if (formData.payment_type === 'outbound' && (formData.partner_type !== 'supplier' || !formData.partner_id)) {
      return toastError(t('payments.selectSupplierRequired'))
    }
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      if (editingId) {
        await paymentsApi.update(editingId, formData)
        toastSuccess(t('common.updated') || 'Updated successfully')
      } else {
        const res = await paymentsApi.create(formData)
        const applied = parseFloat(res?.data?.advance_applied) || 0
        toastSuccess(applied > 0
          ? `${t('accounting.paymentRecorded')} — ${t('payments.toastAdvanceApplied')}: ${applied.toLocaleString('en-EG', { minimumFractionDigits: 2 })} EGP`
          : t('accounting.paymentRecorded'))
      }
      setShowForm(false)
      setEditingId(null)
      setFormData({ payment_type: 'inbound', method: 'cash', amount: '', reference: '', notes: '', payment_date: new Date().toISOString().split('T')[0], partner_type: '', partner_id: '' })
      fetchPayments()
      // The advance balance just moved — refresh so the next hint is honest.
      suppliersApi.getAll().then(res => setSuppliers(res.data || [])).catch(() => {})
    } catch (err) {
      toastError(err.response?.data?.error || t('common.failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (id) => {
    setDeleting(true)
    try {
      await paymentsApi.delete(id)
      toastSuccess(t('accounting.paymentDeleted'))
      fetchPayments()
      setDeleteTarget(null)
    } catch (err) {
      toastError(err.response?.data?.error || t('common.failed'))
    } finally {
      setDeleting(false)
    }
  }

  const totalInbound = payments.filter(p => p.payment_type === 'inbound').reduce((s, p) => s + p.amount, 0)
  const totalOutbound = payments.filter(p => p.payment_type === 'outbound').reduce((s, p) => s + p.amount, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('accounting.payments') || 'Payments'}</h1>
<p className="text-muted">{t('accounting.paymentsDesc')||'Track all payments in and out'}</p>
        </div>
<button onClick={()=>setShowForm(true)}className="px-4 py-2 bg-accent hover:bg-primary-700 text-white rounded-xl font-medium flex items-center gap-2">
          <Plus className="w-4 h-4" /> {t('accounting.newPayment') || 'New Payment'}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
<div className="bg-surface rounded-2xl p-4 border border-border">
<div className="flex items-center gap-2 text-sm text-muted mb-1"><ArrowDownRight className="w-4 h-4 text-success"/>{t('accounting.inbound')}</div>
<p className="text-xl font-bold text-success">{totalInbound.toLocaleString('en-EG',{minimumFractionDigits: 2})}EGP</p>
        </div>
<div className="bg-surface rounded-2xl p-4 border border-border">
<div className="flex items-center gap-2 text-sm text-muted mb-1"><ArrowUpRight className="w-4 h-4 text-danger"/>{t('accounting.outbound')}</div>
<p className="text-xl font-bold text-danger">{totalOutbound.toLocaleString('en-EG',{minimumFractionDigits: 2})}EGP</p>
        </div>
<div className="bg-surface rounded-2xl p-4 border border-border">
<div className="flex items-center gap-2 text-sm text-muted mb-1"><DollarSign className="w-4 h-4 text-accent"/>{t('accounting.net')}</div>
<p className={`text-xl font-bold ${(totalInbound - totalOutbound)>=0 ?'text-success':'text-danger'}`}>
            {(totalInbound - totalOutbound).toLocaleString('en-EG', { minimumFractionDigits: 2 })} EGP
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"/>
<input type="text"value={search}onChange={e=>setSearch(e.target.value)}placeholder={t('common.search')||'Search...'}className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-surface ring-focus outline-none"/>
        </div>
<SearchableSelect options={[{value:'',label:t('accounting.allTypes')},{value:'inbound',label:t('accounting.inbound')},{value:'outbound',label:t('accounting.outbound')}]}value={filterType}onChange={(v)=>setFilterType(v)}placeholder={t('common.searchSelect')}className="px-4 py-2.5 rounded-xl border border-border bg-surface outline-none ring-focus"/>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
<div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <h3 className="text-lg font-bold">{editingId ? (t('accounting.editPayment') || 'Edit Payment') : (t('accounting.newPayment') || 'New Payment')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
<SearchableSelect options={[{value:'inbound',label:`${t('accounting.inbound')} (${t('accounting.received')})`},{value:'outbound',label:`${t('accounting.outbound')} (${t('accounting.paid')})`}]}value={formData.payment_type}onChange={(v)=>setFormData({...formData,payment_type:v,partner_type:'',partner_id:''})}placeholder={t('common.searchSelect')}className="px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"/>
<SearchableSelect options={[{value:'cash',label:t('accounting.cash')},{value:'bank_transfer',label:t('accounting.bankTransfer')},{value:'card',label:t('accounting.card')},{value:'check',label:t('accounting.check')}]}value={formData.method}onChange={(v)=>setFormData({...formData,method:v})}placeholder={t('common.searchSelect')}className="px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"/>
            </div>

            {/* Partner Selection */}
            {formData.payment_type === 'outbound' && (
              <SearchableSelect
                options={[
                  { value: ':', label: t('accounting.selectSupplier') || 'Select supplier...' },
                  ...suppliers.map(s => ({ value: `supplier:${s.id}`, label: s.name })),
                ]}
                value={`${formData.partner_type}:${formData.partner_id}`}
                onChange={(v) => {
                  const [type, id] = v.split(':')
                  setFormData({ ...formData, partner_type: type, partner_id: id })
                }}
                placeholder={t('common.searchSelect')}
className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"
              />
            )}

            {/* Settlement hint: what an advance will cover before the user
                commits the payment. Pure preview — the server consumes the
                same FIFO amounts on save. */}
            {formData.payment_type === 'outbound' && formData.partner_type === 'supplier' && formData.partner_id && (() => {
              const supplier = suppliers.find(s => String(s.id) === String(formData.partner_id))
              if (!supplier) return null
              const owed = parseFloat(supplier.balance) || 0
              const available = parseFloat(supplier.advance_available) || 0
              const amount = parseFloat(formData.amount) || 0
              const applied = Math.min(available, amount)
              const cash = amount - applied
              return (
                <div data-testid="settlement-hint" className="px-4 py-3 rounded-xl bg-accent-soft border border-accent/30 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted">{t('payments.owed')}</span>
                    <span className={`font-bold ${owed > 0 ? 'text-danger' : 'text-success'}`}>{owed.toLocaleString('en-EG', { minimumFractionDigits: 2 })} EGP</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">{t('payments.advanceApplied')}</span>
                    <span className={`font-bold ${applied > 0 ? 'text-accent' : 'text-muted'}`}>{applied.toLocaleString('en-EG', { minimumFractionDigits: 2 })} EGP</span>
                  </div>
                  <div className="flex justify-between border-t border-accent/20 pt-1">
                    <span className="text-muted">{t('payments.cashToPay')}</span>
                    <span className="font-bold">{cash.toLocaleString('en-EG', { minimumFractionDigits: 2 })} EGP</span>
                  </div>
                  {applied > 0 && (
                    <p className="text-xs text-accent">{t('payments.advanceHint')}</p>
                  )}
                </div>
              )
            })()}
<input type="number"value={formData.amount}onChange={e=>setFormData({...formData,amount: e.target.value})}placeholder={`${t('accounting.amount')}(EGP)`}className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus text-lg font-bold"/>
<input type="date"value={formData.payment_date}onChange={e=>setFormData({...formData,payment_date: e.target.value})}className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"/>
<input value={formData.reference}onChange={e=>setFormData({...formData,reference: e.target.value})}placeholder={`${t('accounting.reference')}(${t('accounting.optional')})`}className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"/>
<textarea value={formData.notes}onChange={e=>setFormData({...formData,notes: e.target.value})}placeholder={`${t('common.description')}(${t('accounting.optional')})`}rows={2}className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"/>
            <div className="flex gap-3">
<button onClick={handleSubmit}className="flex-1 px-4 py-2.5 bg-accent hover:bg-primary-700 text-white rounded-xl font-medium flex items-center justify-center gap-2">
                <Save className="w-4 h-4" /> {t('common.save') || 'Save'}
              </button>
<button onClick={()=>{setShowForm(false);setEditingId(null);setFormData({payment_type:'inbound',method:'cash',amount:'',reference:'',notes:'',payment_date: new Date().toISOString().split('T')[0],partner_type:'',partner_id:''})}}className="px-4 py-2.5 bg-surface-tertiary bg-surface-hover rounded-xl font-medium flex items-center gap-2">
                <X className="w-4 h-4" /> {t('common.cancel') || 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payments Table */}
      {loading ? (
<div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"/></div>
      ) : (
<div className="bg-surface rounded-2xl shadow-sm border border-border overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
<tr className="text-xs text-muted border-b border-border">
                <th className="text-start px-6 py-3 font-medium">{t('accounting.paymentNumber')}</th>
                <th className="text-start px-6 py-3 font-medium">{t('common.date')}</th>
                <th className="text-start px-6 py-3 font-medium">{t('accounting.type')}</th>
                <th className="text-start px-6 py-3 font-medium">{t('accounting.method')}</th>
                <th className="text-end px-6 py-3 font-medium">{t('accounting.amount')}</th>
                <th className="text-start px-6 py-3 font-medium">{t('accounting.reference')}</th>
                <th className="text-end px-6 py-3 font-medium">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(payment => (
<tr key={payment.id}className="border-t border-border bg-surface-hover">
                  <td className="px-6 py-3 text-sm font-mono font-bold">{payment.payment_number}</td>
                  <td className="px-6 py-3 text-sm">{payment.payment_date}</td>
                  <td className="px-6 py-3 text-sm">
<span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-bold ${payment.payment_type==='inbound'?'bg-success-soft text-success-soft-foreground':'bg-danger-soft text-danger-soft-foreground'}`}>
                      {payment.payment_type === 'inbound' ? <ArrowDownRight className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                      {t('accounting.type' + payment.payment_type.charAt(0).toUpperCase() + payment.payment_type.slice(1))}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm">{t('accounting.method' + payment.method.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(''))}</td>
                  <td className="px-6 py-3 text-sm text-end font-mono font-bold">{payment.amount.toLocaleString('en-EG', { minimumFractionDigits: 2 })} EGP</td>
<td className="px-6 py-3 text-sm text-muted">{payment.reference ||'-'}</td>
                  <td className="px-6 py-3 text-end">
                    {!payment.journal_entry_id && (
                      <div className="flex items-center justify-end gap-1">
<button onClick={()=>handleEdit(payment)}className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-surface-hover text-muted hover:text-primary-600"><Pencil className="w-4 h-4"/></button>
<button onClick={()=>setDeleteTarget(payment.id)}className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-surface-hover text-muted hover:text-red-600"><Trash2 className="w-4 h-4"/></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
{payments.length===0 &&<p className="text-center py-8 text-muted">{t('accounting.noPayments')}</p>}
        </div>
      )}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete(deleteTarget)}
        title={t('accounting.deletePayment') || 'Delete Payment'}
        message={t('accounting.deletePaymentConfirm') || 'Are you sure you want to delete this payment?'}
        type="danger"
        confirmText={t('common.delete') || 'Delete'}
        cancelText={t('common.cancel') || 'Cancel'}
        loading={deleting}
      />
    </div>
  )
}
