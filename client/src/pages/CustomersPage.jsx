import ConfirmModal from '../components/ConfirmModal'
import CsvImportModal from '../components/CsvImportModal'
import PhoneField from '../components/PhoneField'
import SearchableSelect from '../components/SearchableSelect'
import { parseFullPhone } from '../lib/phone'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { useUserStore, PERMISSIONS } from '../stores/userStore'
import { customersApi, customerStatementsApi, subscriptionsApi } from '../lib/api'
import { X, Plus, Edit2, Trash2, User, Phone, Mail, MapPin, Star, ChevronDown, ChevronRight, ShoppingCart, Receipt, Calendar, CreditCard, Package, Upload, MessageCircle, FileText, AlertCircle } from 'lucide-react'

export default function CustomersPage() {
  const { t, toastSuccess, toastError } = useAppStore()
  const { hasPermission } = useUserStore()
  const canEdit = hasPermission(PERMISSIONS.CUSTOMERS_EDIT)
  const navigate = useNavigate()
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [sortBy, setSortBy] = useState('name')
  const [overview, setOverview] = useState(null)

  useEffect(() => {
    fetchCustomers()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate trigger list: the loader below is re-created each render and is intentionally NOT a dep, so only these inputs refetch
  }, [])

  const fetchCustomers = async () => {
    setLoading(true)
    try {
      const [response, ov] = await Promise.all([
        customersApi.getAll({ search: searchQuery }),
        // Header stat only — the page still works if this call fails.
        customersApi.overview().catch(() => ({ data: null })),
      ])
      setCustomers(response.data)
      setOverview(ov.data)
    } catch (err) {
      console.error('Failed to fetch customers:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (e) => {
    e.preventDefault()
    fetchCustomers()
  }

  // CSV import: batch upsert, refresh the list, hand the per-row report to
  // the modal (rejections surface there, not as a toast).
  const handleImportCustomers = async (items) => {
    const res = await customersApi.importCsv(items)
    fetchCustomers()
    return res.data
  }

  const handleEdit = (customer) => {
    setEditingCustomer(customer)
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    setDeleting(true)
    try {
      await customersApi.delete(id)
      toastSuccess(t('customers.deleted') || 'Customer deleted successfully')
      fetchCustomers()
      setDeleteTarget(null)
    } catch (err) {
      console.error('Failed to delete customer:', err)
      toastError(t('customers.failedToDelete') || 'Failed to delete customer')
    } finally {
      setDeleting(false)
    }
  }

  const handleSave = async (customerData) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      if (editingCustomer) {
        await customersApi.update(editingCustomer.id, customerData)
        toastSuccess(t('customers.updated') || 'Customer updated successfully')
      } else {
        await customersApi.create(customerData)
        toastSuccess(t('customers.created') || 'Customer added successfully')
      }
      setShowForm(false)
      setEditingCustomer(null)
      fetchCustomers()
    } catch (err) {
      console.error('Failed to save customer:', err)
      const errorMsg = err.response?.data?.error || t('customers.failedToSave') || 'Failed to save customer'
      toastError(errorMsg)
    } finally {
      setIsSubmitting(false)
    }
  }

  // wa.me wants digits only (PhoneField stores +2010…, which strips clean).
  const waLink = (phone) => `https://wa.me/${phone.replace(/[^0-9]/g, '')}`

  // Sort drives the "who's my best customer" question; search stays
  // server-side (the form submits it).
  const visible = [...customers].sort((a, b) => {
    if (sortBy === 'spent_desc') return (parseFloat(b.total_spent) || 0) - (parseFloat(a.total_spent) || 0)
    if (sortBy === 'loyalty_desc') return (b.loyalty_points || 0) - (a.loyalty_points || 0)
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
          <h1 className="text-2xl font-bold">{t('customers.title')}</h1>
<p className="text-muted">{t('customers.subtitle')}</p>
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
                setEditingCustomer(null)
                setShowForm(true)
              }}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-primary-700 min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              {t('customers.addCustomer')}
            </button>
          </div>
        )}
      </div>

      {/* Summary cards: open credit, customer count, recent sales */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-surface rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <CreditCard className="w-4 h-4 text-danger" /> {t('customers.outstandingCredit')}
          </div>
          <p className="text-xl font-bold text-danger">ج.م {overview ? (overview.outstanding_credit || 0).toFixed(2) : '0.00'}</p>
        </div>
        <div className="bg-surface rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <User className="w-4 h-4 text-accent" /> {t('customers.customersCount')}
          </div>
          <p className="text-xl font-bold">{customers.length}</p>
        </div>
        <div className="bg-surface rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <ShoppingCart className="w-4 h-4 text-success" /> {t('customers.sales30d')}
          </div>
          <p className="text-xl font-bold text-success">
            {overview ? `ج.م ${(overview.sales_30d || 0).toFixed(2)}` : '—'}
          </p>
        </div>
      </div>

      {/* Search + sort */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          placeholder={t('customers.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
className="flex-1 min-w-0 px-4 py-2 rounded-lg border border-border bg-surface"
        />
        <button
          type="submit"
className="px-4 py-2 bg-surface-tertiary rounded-lg bg-surface-hover"
        >
          {t('common.search')}
        </button>
        <SearchableSelect
          options={[
            { value: 'name', label: t('customers.sortName') },
            { value: 'spent_desc', label: t('customers.sortSpent') },
            { value: 'loyalty_desc', label: t('customers.sortLoyalty') },
          ]}
          value={sortBy}
          onChange={(v) => setSortBy(v)}
          placeholder={t('common.searchSelect')}
          className="px-4 py-2 rounded-lg border border-border bg-surface outline-none ring-focus"
        />
      </form>

      {/* Customers Grid */}
      {customers.length === 0 ? (
<div className="bg-surface rounded-xl border border-border p-12 text-center">
<User className="w-16 h-16 mx-auto text-foreground mb-4"/>
<h3 className="text-lg font-medium text-foreground mb-2">{t('customers.noCustomers')}</h3>
<p className="text-muted">{t('customers.addFirst')}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-12 text-center">
          <p className="text-muted">{t('customers.noMatches')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((customer) => (
            <div
              key={customer.id}
              onClick={() => setSelectedCustomer(customer)}
className="bg-surface rounded-xl border border-border p-4 cursor-pointer hover:border-primary-300 hover:shadow-md transition-all duration-200"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
<div className="p-2 bg-accent-soft rounded-lg">
<User className="w-5 h-5 text-accent"/>
                  </div>
                  <div>
                    <h3 className="font-semibold">{customer.name}</h3>
<p className="text-sm text-muted">{t('customers.since')}{new Date(customer.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  {canEdit && (
                    <button
                      onClick={() => handleEdit(customer)}
className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => setDeleteTarget(customer.id)}
className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-muted hover:text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Data-quality badges: gaps the CSV import left behind */}
              {(!customer.phone || !customer.email) && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {!customer.phone && (
                    <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-danger-soft text-danger-soft-foreground">
                      {t('customers.noPhone')}
                    </span>
                  )}
                  {!customer.email && (
                    <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-surface-tertiary text-muted">
                      {t('customers.noEmail')}
                    </span>
                  )}
                </div>
              )}

              <div className="space-y-2 text-sm">
                {customer.phone && (
<div className="flex items-center gap-2 text-muted">
                    <Phone className="w-4 h-4" />
                    <span>{customer.phone}</span>
                  </div>
                )}
                {customer.email && (
<div className="flex items-center gap-2 text-muted">
                    <Mail className="w-4 h-4" />
                    <span>{customer.email}</span>
                  </div>
                )}
                {customer.address && (
<div className="flex items-center gap-2 text-muted">
                    <MapPin className="w-4 h-4" />
                    <span className="line-clamp-1">{customer.address}</span>
                  </div>
                )}
              </div>

<div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-sm">
<div className="flex items-center gap-1 text-warning">
                  <Star className="w-4 h-4" />
                  <span>{customer.loyalty_points || 0} {t('customers.points')}</span>
                </div>
<div className="text-muted">
                  {t('customers.totalLabel')} ج.م {customer.total_spent?.toFixed(2) || '0.00'}
                </div>
              </div>

              {/* Quick actions — the card itself already opens the drawer */}
              <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
                {customer.phone && (
                  <>
                    <a
                      href={`tel:${customer.phone}`}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted hover:text-foreground hover:bg-surface-hover rounded-lg"
                    >
                      <Phone className="w-3.5 h-3.5" /> {t('customers.call')}
                    </a>
                    <a
                      href={waLink(customer.phone)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted hover:text-foreground hover:bg-surface-hover rounded-lg"
                    >
                      <MessageCircle className="w-3.5 h-3.5" /> {t('customers.whatsapp')}
                    </a>
                  </>
                )}
                <button
                  onClick={() => navigate(`/pos?new=1&customer=${customer.id}`)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted hover:text-foreground hover:bg-surface-hover rounded-lg"
                >
                  <FileText className="w-3.5 h-3.5" /> {t('customers.newSale')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CSV Import Modal */}
      <CsvImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        entity="customers"
        onImport={handleImportCustomers}
      />

      {/* Customer Form Modal */}
      {showForm && (
        <CustomerForm
          customer={editingCustomer}
          onSave={handleSave}
          onClose={() => {
            setShowForm(false)
            setEditingCustomer(null)
          }}
        />
      )}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete(deleteTarget)}
        title={t('customers.deleteCustomer') || 'Delete Customer'}
        message={t('customers.deleteConfirm') || 'Are you sure you want to delete this customer?'}
        type="danger"
        confirmText={t('common.delete') || 'Delete'}
        cancelText={t('common.cancel') || 'Cancel'}
        loading={deleting}
      />

      {/* Customer Detail Drawer */}
      {selectedCustomer && (
        <CustomerDetailDrawer
          customer={selectedCustomer}
          onClose={() => setSelectedCustomer(null)}
        />
      )}
    </div>
  )
}

function CustomerDetailDrawer({ customer, onClose }) {
  const { t } = useAppStore()
  const [statement, setStatement] = useState(null)
  const [subs, setSubs] = useState([])
  const [loadingData, setLoadingData] = useState(true)
  const [expandedOrder, setExpandedOrder] = useState(null)
  const [tab, setTab] = useState('orders')

  useEffect(() => {
    fetchDrawerData()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate trigger list: only refetch when the opened customer changes
  }, [customer.id])

  const fetchDrawerData = async () => {
    setLoadingData(true)
    try {
      // One statement round trip carries orders + payments + credit sales
      // (the endpoint existed but no page called it — the drawer used to
      // re-sum orders client-side and never saw payments or credit).
      const [stmt, subRes] = await Promise.all([
        customerStatementsApi.getStatement(customer.id),
        subscriptionsApi.getAll({ customer_id: customer.id }).catch(() => ({ data: [] })),
      ])
      setStatement(stmt.data)
      setSubs(subRes.data || [])
    } catch (err) {
      console.error('Failed to fetch customer detail:', err)
    } finally {
      setLoadingData(false)
    }
  }

  const orders = statement?.orders || []
  const creditSales = statement?.credit_sales || []
  const payments = statement?.payments || []
  const openCredit = creditSales.filter((c) => ['pending', 'partial', 'overdue'].includes(c.status))
  const openCreditRemaining = openCredit.reduce((sum, c) => sum + (parseFloat(c.remaining_amount) || 0), 0)

  const totalOrders = orders.length
  const totalSpent = orders.reduce((sum, o) => sum + parseFloat(o.total || 0), 0)
  const avgOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0
  const loyaltyPoints = customer.loyalty_points || 0

  const stats = [
{label: t('customers.totalOrders')||'Total Orders',value: totalOrders,icon: ShoppingCart,color:'text-accent-soft-foreground bg-accent-soft'},
{label: t('customers.totalSpent')||'Total Spent',value:`ج.م ${totalSpent.toFixed(2)}`,icon: Receipt,color:'text-success-soft-foreground bg-success-soft'},
{label: t('customers.avgOrder')||'Avg Order',value:`ج.م ${avgOrderValue.toFixed(2)}`,icon: CreditCard,color:'text-warning-soft-foreground bg-warning-soft'},
{label: t('customers.loyaltyPoints')||'Loyalty Points',value: loyaltyPoints,icon: Star,color:'text-warning-soft-foreground bg-warning-soft'},
  ]

  const paymentMethodLabels = {
    cash: t('pos.cash') || 'Cash',
    card: t('pos.card') || 'Card',
    transfer: t('pos.transfer') || 'Transfer',
    mobile: t('pos.mobile') || 'Mobile',
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
<div className="relative w-full max-w-2xl bg-surface shadow-2xl overflow-y-auto">
        {/* Header */}
<div className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
<div className="p-2 bg-accent-soft rounded-lg">
<User className="w-5 h-5 text-accent"/>
              </div>
              <div>
<h2 className="text-xl font-bold text-foreground">{customer.name}</h2>
<p className="text-sm text-muted">{t('customers.since')}{new Date(customer.created_at).toLocaleDateString()}</p>
              </div>
            </div>
            <button
              onClick={onClose}
className="p-2.5 rounded-lg bg-surface-hover min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* Contact Info */}
          <div className="space-y-2 text-sm">
            {customer.phone && (
<div className="flex items-center gap-2 text-muted">
<Phone className="w-4 h-4 text-muted"/>
                <span>{customer.phone}</span>
              </div>
            )}
            {customer.email && (
<div className="flex items-center gap-2 text-muted">
<Mail className="w-4 h-4 text-muted"/>
                <span>{customer.email}</span>
              </div>
            )}
            {customer.address && (
<div className="flex items-center gap-2 text-muted">
<MapPin className="w-4 h-4 text-muted"/>
                <span>{customer.address}</span>
              </div>
            )}
            {customer.notes && (
<div className="mt-2 p-3 bg-surface-secondary rounded-lg text-muted">
                {customer.notes}
              </div>
            )}
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3">
            {stats.map((stat) => (
<div key={stat.label}className="bg-surface-secondary rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className={`p-1.5 rounded-lg ${stat.color}`}>
                    <stat.icon className="w-4 h-4" />
                  </div>
<span className="text-xs text-muted">{stat.label}</span>
                </div>
<div className="text-lg font-bold text-foreground">{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Open credit highlight — the number the credit tab explains */}
          {openCreditRemaining > 0 && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-danger-soft">
              <div className="flex items-center gap-2 text-sm font-medium text-danger-soft-foreground">
                <AlertCircle className="w-4 h-4" />
                {t('customers.outstandingCredit')}
              </div>
              <span className="font-bold text-danger-soft-foreground">ج.م {openCreditRemaining.toFixed(2)}</span>
            </div>
          )}

          {/* Tabs: purchase history / credit sales / subscriptions */}
          <div className="flex gap-2 border-b border-border pb-2">
            {[
              { key: 'orders', label: t('customers.purchaseHistory') || 'Purchase History' },
              { key: 'credit', label: t('customers.tabCredit') || 'Credit' },
              { key: 'subs', label: t('customers.tabSubscriptions') || 'Subscriptions' },
            ].map((tb) => (
              <button
                key={tb.key}
                onClick={() => setTab(tb.key)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg ${
                  tab === tb.key
                    ? 'bg-accent text-white'
                    : 'text-muted hover:text-foreground hover:bg-surface-hover'
                }`}
              >
                {tb.label}
              </button>
            ))}
          </div>

          {tab === 'orders' && (
            <div>
            {loadingData ? (
              <div className="flex items-center justify-center py-8">
<div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent"></div>
              </div>
            ) : orders.length === 0 ? (
<div className="text-center py-8 text-muted">
                <ShoppingCart className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>{t('customers.noOrders') || 'No orders yet'}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {orders.map((order) => (
                  <div
                    key={order.id}
className="bg-surface-secondary rounded-xl overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
className="w-full px-4 py-3 flex items-center justify-between bg-surface-hover transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="text-left">
<div className="font-medium text-foreground text-sm">{order.order_number}</div>
<div className="text-xs text-muted flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(order.date).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
<div className="font-bold text-foreground text-sm">ج.م{parseFloat(order.total).toFixed(2)}</div>
<div className="text-xs text-muted">
                            {order.items?.length || 0} {t('customers.items') || 'items'}
                          </div>
                        </div>
                        {expandedOrder === order.id ? (
<ChevronDown className="w-4 h-4 text-muted"/>
                        ) : (
<ChevronRight className="w-4 h-4 text-muted"/>
                        )}
                      </div>
                    </button>

                    {/* Expanded Order Items */}
                    {expandedOrder === order.id && (
<div className="px-4 pb-3 border-t border-border">
                        <div className="pt-3 space-y-2">
                          {order.items?.map((item, idx) => (
                            <div key={`${item.product_name}-${idx}`} className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
<Package className="w-4 h-4 text-muted"/>
<span className="text-foreground">{item.product_name}</span>
<span className="text-muted">x{item.quantity}</span>
                              </div>
<span className="font-medium text-foreground">ج.م{parseFloat(item.total).toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
<div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs text-muted">
                          <span>{t('customers.payment') || 'Payment'}: {paymentMethodLabels[payments.find((p) => p.order_id === order.id)?.method] || payments.find((p) => p.order_id === order.id)?.method || '—'}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
order.payment_status==='paid'?'bg-success-soft text-success-soft-foreground':
order.payment_status==='pending'?'bg-warning-soft text-warning-soft-foreground':
'bg-surface-tertiary text-foreground'
                          }`}>
                            {order.payment_status}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            </div>
          )}

          {tab === 'credit' && (
            <div className="space-y-2">
              {creditSales.length === 0 ? (
                <div className="text-center py-8 text-muted">
                  <CreditCard className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>{t('customers.noCredit') || 'No credit sales yet'}</p>
                </div>
              ) : creditSales.map((cs) => (
                <div key={cs.id} className="bg-surface-secondary rounded-xl px-4 py-3 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-medium text-foreground text-sm">{t('customers.order')} #{cs.order_id}</div>
                    <div className="text-xs text-muted flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(cs.date).toLocaleDateString()}
                      {cs.due_date ? ` · ${t('customers.dueDate')}: ${new Date(cs.due_date).toLocaleDateString()}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      cs.status === 'paid' ? 'bg-success-soft text-success-soft-foreground'
                      : cs.status === 'overdue' ? 'bg-danger-soft text-danger-soft-foreground'
                      : 'bg-warning-soft text-warning-soft-foreground'
                    }`}>
                      {t(`customers.creditStatus.${cs.status}`) || cs.status}
                    </span>
                    <div className="text-right">
                      <div className={`font-bold text-sm ${parseFloat(cs.remaining_amount) > 0 ? 'text-danger' : 'text-success'}`}>
                        ج.م {parseFloat(cs.remaining_amount).toFixed(2)}
                      </div>
                      <div className="text-xs text-muted">
                        ج.م {parseFloat(cs.paid_amount || 0).toFixed(2)} / ج.م {parseFloat(cs.total_amount).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'subs' && (
            <div className="space-y-2">
              {subs.length === 0 ? (
                <div className="text-center py-8 text-muted">
                  <Calendar className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>{t('customers.noSubscriptions') || 'No subscriptions yet'}</p>
                </div>
              ) : subs.map((s) => (
                <div key={s.id} className="bg-surface-secondary rounded-xl px-4 py-3 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-medium text-foreground text-sm">
                      {s.plan?.name || s.service?.name || `${t('customers.subscription')} #${s.id}`}
                    </div>
                    <div className="text-xs text-muted flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(s.start_date).toLocaleDateString()} → {s.end_date ? new Date(s.end_date).toLocaleDateString() : '—'}
                      {s.next_billing_date ? ` · ${t('customers.nextBilling')}: ${new Date(s.next_billing_date).toLocaleDateString()}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      s.status === 'active' ? 'bg-success-soft text-success-soft-foreground'
                      : s.status === 'past_due' ? 'bg-danger-soft text-danger-soft-foreground'
                      : 'bg-surface-tertiary text-muted'
                    }`}>
                      {t(`customers.subStatus.${s.status}`) || s.status}
                    </span>
                    <span className="font-bold text-foreground">ج.م {parseFloat(s.billing_amount || 0).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CustomerForm({ customer, onSave, onClose }) {
  const { t } = useAppStore()

  // `phone` holds the FULL stored number ('+201012345678'); PhoneField splits
  // it into dial code + digits for editing and emits it composed again.
  const [formData, setFormData] = useState({
    name: customer?.name || '',
    phone: customer?.phone || '',
    email: customer?.email || '',
    address: customer?.address || '',
    notes: customer?.notes || '',
  })
  const [phoneError, setPhoneError] = useState('')

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const digits = parseFullPhone(formData.phone).number
    if (digits && digits.length !== 10) {
      setPhoneError(t('customers.phoneLengthError'))
      return
    }
    setPhoneError('')
    onSave(formData)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          {/* max-h + scroll: the form is header + 5 fields + actions (~580px),
              taller than a phone viewport once browser chrome is counted, and a
              centered fixed modal with no cap clips its own Save button. Matches
              the max-h-[90vh] convention the other modals already use. */}
<div className="bg-surface rounded-2xl w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
<div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-xl font-semibold">
            {customer ? t('customers.editCustomer') : t('customers.addCustomer')}
          </h2>
          <button
            onClick={onClose}
className="p-2.5 rounded-lg bg-surface-hover min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
<label className="block text-sm font-medium text-foreground mb-1">
              {t('customers.name')} *
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

          <PhoneField
            id="customer-phone"
            label={t('customers.phone')}
            value={formData.phone}
            onChange={(full) => { setFormData(prev => ({ ...prev, phone: full })); setPhoneError('') }}
            error={phoneError}
          />

          <div>
<label className="block text-sm font-medium text-foreground mb-1">
              {t('customers.email')}
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
              {t('customers.address')}
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
              {t('customers.notes')}
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
className="px-4 py-2.5 text-foreground bg-surface-tertiary rounded-lg bg-surface-hover min-h-[44px]"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
className="px-4 py-2.5 bg-accent text-white rounded-lg hover:bg-primary-700 min-h-[44px]"
            >
              {customer ? t('common.edit') : t('common.add')} {t('customers.name')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
