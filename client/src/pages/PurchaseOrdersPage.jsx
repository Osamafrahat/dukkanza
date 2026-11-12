import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { useBranchStore } from '../stores/branchStore'
import { formatCurrency } from '../lib/utils'
import { purchaseOrdersApi, suppliersApi, productsApi } from '../lib/api'
import SearchableSelect from '../components/SearchableSelect'
import SendPOModal from '../components/inventory/SendPOModal'
import { CheckCircle, Eye, FileText, Loader2, Package, Plus, Search, Send, ShoppingCart, Trash2, Truck, X } from 'lucide-react'



export default function PurchaseOrdersPage() {
  const { t, toastSuccess, toastError } = useAppStore()
  const [orders, setOrders] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [sendPO, setSendPO] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [form, setForm] = useState({
    supplier_id: '',
    expected_date: '',
    branch_id: '',
    notes: '',
    items: [{ product_id: '', quantity: '', unit_price: '' }]
  })

  // Branches: destination select on the create form + label under each PO number
  const branches = useBranchStore((s) => s.branches)
  const loadBranches = useBranchStore((s) => s.loadBranches)

  const branchName = (id) => {
    if (id == null) return null
    const found = branches.find((b) => Number(b.id) === Number(id))
    return found ? found.name : null
  }

  const fetchData = async () => {
    try {
      setLoading(true)
      const [ordersRes, statsRes] = await Promise.all([
        purchaseOrdersApi.getAll({ status: filter === 'all' ? undefined : filter }),
        purchaseOrdersApi.getStats()
      ])
      setOrders(ordersRes.data || [])
      setStats(statsRes.data)
    } catch (err) {
      toastError(err.message || t('purchaseOrders.failedToLoad'))
    } finally {
      setLoading(false)
    }
  }

  const loadDropdowns = async () => {
    try {
      const [supRes, prodRes] = await Promise.all([
        suppliersApi.getAll(),
        productsApi.getAll()
      ])
      setSuppliers(supRes.data.data || supRes.data || [])
      setProducts(prodRes.data.data || prodRes.data || [])
    } catch (err) {
      // silent
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

  const handleItemChange = (index, field, value) => {
    const updated = [...form.items]
    updated[index][field] = value
    setForm({ ...form, items: updated })
  }

  // Selecting a product prefills the price box: acquisition cost first,
  // then the selling price, then empty (user types it). Both fields are
  // written in ONE setForm — handleItemChange closes over `form`, so two
  // sequential calls would drop the product_id change.
  const handleProductSelect = (index, productId) => {
    const product = products.find((p) => String(p.id) === String(productId))
    const price =
      Number(product?.cost_price) > 0 ? product.cost_price
      : Number(product?.price) > 0 ? product.price
      : ''
    const updated = [...form.items]
    updated[index] = {
      ...updated[index],
      product_id: productId,
      unit_price: price === '' ? '' : String(price),
    }
    setForm({ ...form, items: updated })
  }

  const addItem = () => {
    setForm({ ...form, items: [...form.items, { product_id: '', quantity: '', unit_price: '' }] })
  }

  const removeItem = (index) => {
    if (form.items.length <= 1) return
    setForm({ ...form, items: form.items.filter((_, i) => i !== index) })
  }

  const handleCreatePO = async (e) => {
    e.preventDefault()
    if (!form.supplier_id) {
      toastError(t('purchaseOrders.selectSupplierRequired'))
      return
    }
    const validItems = form.items.filter((item) => item.product_id && item.quantity && item.unit_price)
    if (validItems.length === 0) {
      toastError(t('purchaseOrders.addItemRequired'))
      return
    }

    try {
      setSubmitting(true)
      await purchaseOrdersApi.create({
        supplier_id: form.supplier_id,
        expected_date: form.expected_date || null,
        // Optional destination branch; null = server defaults to current branch
        branch_id: form.branch_id === '' ? null : Number(form.branch_id),
        notes: form.notes,
        items: validItems.map((item) => ({
          product_id: item.product_id,
          quantity: parseInt(item.quantity),
          unit_price: parseFloat(item.unit_price)
        }))
      })
      toastSuccess(t('purchaseOrders.created'))
      setShowCreateForm(false)
      setForm({ supplier_id: '', expected_date: '', branch_id: '', notes: '', items: [{ product_id: '', quantity: '', unit_price: '' }] })
      fetchData()
    } catch (err) {
      toastError(err.message || t('purchaseOrders.createFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const viewDetail = async (id) => {
    try {
      const res = await purchaseOrdersApi.getById(id)
      setShowDetail(res.data)
    } catch (err) {
      toastError(err.message || t('purchaseOrders.loadDetailsFailed'))
    }
  }

  // The Send button opens the send modal. It needs the full supplier contact
  // record (email/phone), so fetch the PO first; the list row only carries the
  // supplier name via the `suppliers(name, ...)` join.
  const handleSend = async (id) => {
    try {
      const res = await purchaseOrdersApi.getById(id)
      setSendPO(res.data)
    } catch (err) {
      toastError(err.message || t('purchaseOrders.loadDetailsFailed'))
    }
  }

  // Sending the order to a supplier transitions it from draft to sent. The
  // modal reports delivery success, then we persist the status change. We
  // update state in place (no fetchData here) so the modal's success screen
  // isn't replaced by the page-level loading spinner; stats refresh on close.
  const handleSent = async (id) => {
    try {
      await purchaseOrdersApi.update(id, { status: 'sent' })
      setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: 'sent' } : o)))
      toastSuccess(t('purchaseOrders.markedSent'))
    } catch (err) {
      toastError(err.response?.data?.error || err.message || t('purchaseOrders.sendFailed'))
    }
  }

  // Modal dismissed after a send: re-sync the list and stats with the server
  // (covers the case where status changed elsewhere) without disturbing the
  // row the user is looking at.
  const handleSendClose = () => {
    const wasSent = sendPO && orders.find((o) => o.id === sendPO.id)?.status === 'sent'
    setSendPO(null)
    if (wasSent) fetchData()
  }

  const handleReceive = async (id) => {
    if (!confirm(t('purchaseOrders.confirmReceive'))) return
    try {
      await purchaseOrdersApi.receive(id)
      toastSuccess(t('purchaseOrders.markedReceived'))
      fetchData()
    } catch (err) {
      toastError(err.message || t('purchaseOrders.receiveFailed'))
    }
  }

  const handleDeletePO = async (id) => {
    if (!confirm(t('purchaseOrders.confirmDelete'))) return
    try {
      await purchaseOrdersApi.delete(id)
      toastSuccess(t('purchaseOrders.deleted'))
      fetchData()
    } catch (err) {
      toastError(err.message || t('purchaseOrders.deleteFailed'))
    }
  }

  const getStatusBadge = (status) => {
    switch (status) {
      case 'draft':
return'bg-surface-tertiary text-foreground'
      case 'sent':
return'bg-accent-soft text-accent-soft-foreground'
      case 'received':
return'bg-success-soft text-success-soft-foreground'
      case 'cancelled':
return'bg-danger-soft text-danger-soft-foreground'
      default:
return'bg-surface-tertiary text-foreground'
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'draft':
        return <FileText className="h-4 w-4" />
      case 'sent':
        return <Truck className="h-4 w-4" />
      case 'received':
        return <CheckCircle className="h-4 w-4" />
      case 'cancelled':
        return <X className="h-4 w-4" />
      default:
        return null
    }
  }

  const getSupplierName = (po) => po.suppliers?.name || po.supplier_name || '—'

  const filteredOrders = orders.filter(
    (o) =>
      o.order_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getSupplierName(o).toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
<Loader2 className="h-8 w-8 animate-spin text-accent"/>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
<h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <ShoppingCart className="h-6 w-6" />
          {t('purchaseOrders') || 'Purchase Orders'}
        </h1>
        <button
          onClick={() => setShowCreateForm(true)}
className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          {t('createPO') || 'Create PO'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
<div className="bg-surface rounded-xl shadow-sm border border-border p-5">
          <div className="flex items-center gap-3">
<div className="p-3 bg-accent-soft rounded-lg">
<ShoppingCart className="h-5 w-5 text-accent"/>
            </div>
            <div>
<p className="text-sm text-muted">{t('totalOrders')||'Total Orders'}</p>
<p className="text-2xl font-bold text-foreground">{stats?.total_orders || orders.length}</p>
            </div>
          </div>
        </div>
<div className="bg-surface rounded-xl shadow-sm border border-border p-5">
          <div className="flex items-center gap-3">
<div className="p-3 bg-warning-soft rounded-lg">
<Truck className="h-5 w-5 text-warning"/>
            </div>
            <div>
<p className="text-sm text-muted">{t('pending')||'Pending'}</p>
<p className="text-2xl font-bold text-warning">{stats?.pending_count || 0}</p>
            </div>
          </div>
        </div>
<div className="bg-surface rounded-xl shadow-sm border border-border p-5">
          <div className="flex items-center gap-3">
<div className="p-3 bg-success-soft rounded-lg">
<CheckCircle className="h-5 w-5 text-success"/>
            </div>
            <div>
<p className="text-sm text-muted">{t('received')||'Received'}</p>
<p className="text-2xl font-bold text-success">{stats?.received_count || 0}</p>
            </div>
          </div>
        </div>
<div className="bg-surface rounded-xl shadow-sm border border-border p-5">
          <div className="flex items-center gap-3">
<div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
<Package className="h-5 w-5 text-purple-600 dark:text-purple-400"/>
            </div>
            <div>
<p className="text-sm text-muted">{t('totalValue')||'Total Value'}</p>
<p className="text-2xl font-bold text-foreground">{formatCurrency(stats?.total_value || 0)}</p>
            </div>
          </div>
        </div>
      </div>

<div className="bg-surface rounded-xl shadow-sm border border-border">
<div className="p-5 border-b border-border">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex flex-wrap gap-2">
              {['all', 'draft', 'sent', 'received', 'cancelled'].map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    filter === s
?'bg-accent text-white'
:'bg-surface-tertiary text-muted bg-surface-hover'
                  }`}
                >
                  {t(s) || s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <div className="relative flex-1 max-w-xs">
<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted"/>
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
<th className="px-5 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('poNumber')||'PO #'}</th>
<th className="px-5 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('supplier')||'Supplier'}</th>
<th className="px-5 py-3 text-center text-xs font-medium text-muted uppercase tracking-wider">{t('items')||'Items'}</th>
<th className="px-5 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">{t('total')||'Total'}</th>
<th className="px-5 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">{t('expectedDate')||'Expected Date'}</th>
<th className="px-5 py-3 text-center text-xs font-medium text-muted uppercase tracking-wider">{t('status')||'Status'}</th>
<th className="px-5 py-3 text-center text-xs font-medium text-muted uppercase tracking-wider">{t('actions')||'Actions'}</th>
              </tr>
            </thead>
<tbody className="divide-y divide-border">
              {filteredOrders.length === 0 ? (
                <tr>
<td colSpan={7}className="px-5 py-10 text-center text-muted">
                    {t('noPurchaseOrders') || 'No purchase orders found'}
                  </td>
                </tr>
              ) : (
                filteredOrders.map((po) => (
<tr key={po.id}className="bg-surface-hover transition-colors">
<td className="px-5 py-4 text-sm font-mono font-medium text-foreground">
                      {po.order_number}
                      {branchName(po.branch_id) && (
                        <span className="block text-[11px] font-sans font-normal text-muted">{branchName(po.branch_id)}</span>
                      )}
                    </td>
<td className="px-5 py-4 text-sm text-muted">{getSupplierName(po)}</td>
<td className="px-5 py-4 text-sm text-center text-muted">{po.items_count || po.items?.length || 0}</td>
<td className="px-5 py-4 text-sm text-right text-foreground font-medium">{formatCurrency(po.total)}</td>
<td className="px-5 py-4 text-sm text-muted">
                      {po.expected_date ? new Date(po.expected_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusBadge(po.status)}`}>
                        {getStatusIcon(po.status)}
                        {t(po.status) || po.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <div className="flex items-center justify-center gap-1">
<button onClick={()=>viewDetail(po.id)}className="p-1.5 text-muted hover:text-blue-600 transition-colors"title={t('view')||'View'}>
                          <Eye className="h-4 w-4" />
                        </button>
                        {po.status === 'draft' && (
<button onClick={()=>handleSend(po.id)}className="p-1.5 text-muted hover:text-blue-600 transition-colors"title={t('purchaseOrders.send')||'Send'}>
                            <Send className="h-4 w-4" />
                          </button>
                        )}
                        {(po.status === 'draft' || po.status === 'sent') && (
<button onClick={()=>handleReceive(po.id)}className="p-1.5 text-muted hover:text-green-600 transition-colors"title={t('receive')||'Receive'}>
                            <CheckCircle className="h-4 w-4" />
                          </button>
                        )}
                        {po.status === 'draft' && (
<button onClick={()=>handleDeletePO(po.id)}className="p-1.5 text-muted hover:text-red-600 transition-colors"title={t('delete')||'Delete'}>
                            <Trash2 className="h-4 w-4" />
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

      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
<div className="bg-surface rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
<h3 className="text-lg font-semibold text-foreground">{t('createPO')||'Create Purchase Order'}</h3>
<button onClick={()=>setShowCreateForm(false)}className="text-muted text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreatePO} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
<label className="block text-sm font-medium text-foreground mb-1">{t('supplier')||'Supplier'}*</label>
                  <SearchableSelect
                    options={[
                      { value: '', label: t('selectSupplier') || 'Select supplier...' },
                      ...suppliers.map((s) => ({ value: String(s.id), label: s.name })),
                    ]}
                    value={form.supplier_id}
                    onChange={(v) => setForm({ ...form, supplier_id: v })}
                    placeholder={t('common.searchSelect')}
                  />
                </div>
                <div>
<label className="block text-sm font-medium text-foreground mb-1">{t('expectedDate')||'Expected Date'}</label>
                  <input
                    type="date"
                    value={form.expected_date}
                    onChange={(e) => setForm({ ...form, expected_date: e.target.value })}
className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground ring-focus outline-none"
                  />
                </div>
              </div>

              <div>
<label className="block text-sm font-medium text-foreground mb-1">{t('branches.destinationBranch')}</label>
                <SearchableSelect
                  options={[
                    { value: '', label: t('branches.useCurrent') },
                    ...branches.filter((b) => b.is_active).map((b) => ({ value: b.id, label: b.name })),
                  ]}
                  value={form.branch_id}
                  onChange={(v) => setForm({ ...form, branch_id: String(v ?? '') })}
                  placeholder={t('branches.selectBranch')}
                />
              </div>

              <div>
<label className="block text-sm font-medium text-foreground mb-2">{t('items')||'Items'}</label>
                {form.items.map((item, idx) => (
                  <div key={idx} className="flex gap-2 mb-2">
                    <div className="flex-1">
                      <SearchableSelect
                        options={[
                          { value: '', label: t('selectProduct') || 'Product...' },
                          ...products.map((p) => ({ value: String(p.id), label: p.name })),
                        ]}
                        value={item.product_id}
                        onChange={(v) => handleProductSelect(idx, v)}
                        placeholder={t('common.searchSelect')}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm outline-none"
                      />
                    </div>
                    <input
                      type="number"
                      min="1"
                      placeholder={t('qty') || 'Qty'}
                      value={item.quantity}
                      onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
className="w-20 px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm outline-none"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder={t('price') || 'Price'}
                      value={item.unit_price}
                      onChange={(e) => handleItemChange(idx, 'unit_price', e.target.value)}
className="w-24 px-3 py-2 border border-border rounded-lg bg-surface text-foreground text-sm outline-none"
                    />
<button type="button"onClick={()=>removeItem(idx)}className="px-2 text-muted hover:text-red-500">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
<button type="button"onClick={addItem}className="text-sm text-accent hover:text-blue-700">
                  + {t('addItem') || 'Add Item'}
                </button>
              </div>

              <div>
<label className="block text-sm font-medium text-foreground mb-1">{t('notes')||'Notes'}</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-foreground ring-focus outline-none"
                  rows={3}
                />
              </div>

              <div className="flex gap-3 pt-2">
<button type="button"onClick={()=>setShowCreateForm(false)}className="flex-1 px-4 py-2 border border-border rounded-lg text-foreground bg-surface-hover transition-colors">
                  {t('cancel') || 'Cancel'}
                </button>
<button type="submit"disabled={submitting}className="flex-1 px-4 py-2 bg-accent text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('create') || 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
<div className="bg-surface rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
<h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {showDetail.order_number}
              </h3>
<button onClick={()=>setShowDetail(null)}className="text-muted text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
<p className="text-sm text-muted">{t('supplier')||'Supplier'}</p>
<p className="font-medium text-foreground">{getSupplierName(showDetail)}</p>
              </div>
              <div>
<p className="text-sm text-muted">{t('status')||'Status'}</p>
                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${getStatusBadge(showDetail.status)}`}>
                  {getStatusIcon(showDetail.status)}
                  {t(showDetail.status) || showDetail.status}
                </span>
              </div>
              <div>
<p className="text-sm text-muted">{t('expectedDate')||'Expected Date'}</p>
<p className="font-medium text-foreground">
                  {showDetail.expected_date ? new Date(showDetail.expected_date).toLocaleDateString() : '—'}
                </p>
              </div>
              <div>
<p className="text-sm text-muted">{t('total')||'Total'}</p>
<p className="font-semibold text-foreground">{formatCurrency(showDetail.total)}</p>
              </div>
            </div>

            {showDetail.notes && (
              <div className="mb-4">
<p className="text-sm text-muted">{t('notes')||'Notes'}</p>
<p className="text-sm text-foreground">{showDetail.notes}</p>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
<tr className="bg-surface-secondary">
<th className="px-4 py-2 text-left text-xs font-medium text-muted uppercase">{t('product')||'Product'}</th>
<th className="px-4 py-2 text-right text-xs font-medium text-muted uppercase">{t('qty')||'Qty'}</th>
<th className="px-4 py-2 text-right text-xs font-medium text-muted uppercase">{t('unitPrice')||'Unit Price'}</th>
<th className="px-4 py-2 text-right text-xs font-medium text-muted uppercase">{t('subtotal')||'Subtotal'}</th>
                  </tr>
                </thead>
<tbody className="divide-y divide-border">
                  {showDetail.items?.map((item, idx) => (
                    <tr key={idx}>
<td className="px-4 py-3 text-sm text-foreground">{item.product_name}</td>
<td className="px-4 py-3 text-sm text-right text-muted">{item.quantity}</td>
<td className="px-4 py-3 text-sm text-right text-muted">{formatCurrency(item.unit_price)}</td>
<td className="px-4 py-3 text-sm text-right font-medium text-foreground">
                        {formatCurrency(item.total || item.quantity * item.unit_price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

<div className="mt-4 pt-4 border-t border-border flex justify-end">
<span className="text-lg font-bold text-foreground">
                {t('total') || 'Total'}: {formatCurrency(showDetail.total)}
              </span>
            </div>
          </div>
        </div>
      )}
      {sendPO && (
        <SendPOModal
          po={sendPO}
          onClose={handleSendClose}
          onSent={() => handleSent(sendPO.id)}
        />
      )}
    </div>
  )
}
