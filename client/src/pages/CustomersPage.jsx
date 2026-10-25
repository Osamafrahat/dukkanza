import ConfirmModal from '../components/ConfirmModal'
import SearchableSelect from '../components/SearchableSelect'
import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { useUserStore, PERMISSIONS } from '../stores/userStore'
import { customersApi, ordersApi } from '../lib/api'
import { X, Plus, Edit2, Trash2, User, Phone, Mail, MapPin, Star, ChevronDown, ChevronRight, ShoppingCart, Receipt, Calendar, CreditCard, Package } from 'lucide-react'

export default function CustomersPage() {
  const { t, toastSuccess, toastError } = useAppStore()
  const { hasPermission } = useUserStore()
  const canEdit = hasPermission(PERMISSIONS.CUSTOMERS_EDIT)
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState(null)

  useEffect(() => {
    fetchCustomers()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate trigger list: the loader below is re-created each render and is intentionally NOT a dep, so only these inputs refetch
  }, [])

  const fetchCustomers = async () => {
    setLoading(true)
    try {
      const response = await customersApi.getAll({ search: searchQuery })
      setCustomers(response.data)
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
          <button
            onClick={() => {
              setEditingCustomer(null)
              setShowForm(true)
            }}
className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-primary-700"
          >
            <Plus className="w-4 h-4" />
            {t('customers.addCustomer')}
          </button>
        )}
      </div>

      {/* Search */}
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
      </form>

      {/* Customers Grid */}
      {customers.length === 0 ? (
<div className="bg-surface rounded-xl border border-border p-12 text-center">
<User className="w-16 h-16 mx-auto text-foreground mb-4"/>
<h3 className="text-lg font-medium text-foreground mb-2">{t('customers.noCustomers')}</h3>
<p className="text-muted">{t('customers.addFirst')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {customers.map((customer) => (
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
            </div>
          ))}
        </div>
      )}

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
  const [orders, setOrders] = useState([])
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [expandedOrder, setExpandedOrder] = useState(null)

  useEffect(() => {
    fetchCustomerOrders()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate trigger list: the loader below is re-created each render and is intentionally NOT a dep
  }, [customer.id])

  const fetchCustomerOrders = async () => {
    setLoadingOrders(true)
    try {
      const response = await ordersApi.getByCustomer(customer.id)
      setOrders(response.data || [])
    } catch (err) {
      console.error('Failed to fetch customer orders:', err)
    } finally {
      setLoadingOrders(false)
    }
  }

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

          {/* Purchase History */}
          <div>
<h3 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              {t('customers.purchaseHistory') || 'Purchase History'}
            </h3>

            {loadingOrders ? (
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
                            {new Date(order.created_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
<div className="font-bold text-foreground text-sm">ج.م{parseFloat(order.total).toFixed(2)}</div>
<div className="text-xs text-muted">
                            {order.order_items?.length || 0} {t('customers.items') || 'items'}
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
                          {order.order_items?.map((item) => (
                            <div key={item.id} className="flex items-center justify-between text-sm">
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
                          <span>{t('customers.payment') || 'Payment'}: {paymentMethodLabels[order.payment_method] || order.payment_method}</span>
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
        </div>
      </div>
    </div>
  )
}

function CustomerForm({ customer, onSave, onClose }) {
  const { t } = useAppStore()

  const parsePhone = (phone) => {
    if (!phone) return { countryCode: '+20', number: '' }
    const codes = ['+20','+966','+971','+965','+973','+974','+968','+962','+961','+216','+212','+213','+1','+44']
    for (const code of codes) {
      if (phone.startsWith(code)) {
        return { countryCode: code, number: phone.slice(code.length).replace(/^0+/, '') }
      }
    }
    return { countryCode: '+20', number: phone.replace(/^0+/, '') }
  }

  const parsed = parsePhone(customer?.phone)

  const [formData, setFormData] = useState({
    name: customer?.name || '',
    countryCode: parsed.countryCode,
    phone: parsed.number,
    email: customer?.email || '',
    address: customer?.address || '',
    notes: customer?.notes || '',
  })
  const [phoneError, setPhoneError] = useState('')

  const countryCodes = [
    { code: '+20', name: t('country.egypt'), flag: '🇪🇬' },
    { code: '+966', name: t('country.saudiArabia'), flag: '🇸🇦' },
    { code: '+971', name: t('country.uae'), flag: '🇦🇪' },
    { code: '+965', name: t('country.kuwait'), flag: '🇰🇼' },
    { code: '+973', name: t('country.bahrain'), flag: '🇧🇭' },
    { code: '+974', name: t('country.qatar'), flag: '🇶🇦' },
    { code: '+968', name: t('country.oman'), flag: '🇴🇲' },
    { code: '+962', name: t('country.jordan'), flag: '🇯🇴' },
    { code: '+961', name: t('country.lebanon'), flag: '🇱🇧' },
    { code: '+216', name: t('country.tunisia'), flag: '🇹🇳' },
    { code: '+212', name: t('country.morocco'), flag: '🇲🇦' },
    { code: '+213', name: t('country.algeria'), flag: '🇩🇿' },
    { code: '+1', name: t('country.usaCanada'), flag: '🇺🇸' },
    { code: '+44', name: t('country.uk'), flag: '🇬🇧' },
  ]

  const handleChange = (e) => {
    const { name, value } = e.target
    if (name === 'phone') {
      setFormData(prev => ({ ...prev, phone: value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 11) }))
      setPhoneError('')
    } else {
      setFormData(prev => ({ ...prev, [name]: value }))
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (formData.phone && formData.phone.length !== 10) {
      setPhoneError(t('customers.phoneLengthError'))
      return
    }
    setPhoneError('')
    const fullPhone = formData.phone ? `${formData.countryCode}${formData.phone}` : ''
    onSave({ ...formData, phone: fullPhone })
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

          <div>
<label className="block text-sm font-medium text-foreground mb-1">
              {t('customers.phone')}
            </label>
            {/* The min-w-0 on the phone input below is load-bearing: flex-1
                alone cannot shrink an <input> under its intrinsic (~20ch)
                min-content width, so on a phone the row kept the country
                select's fixed 128px plus that intrinsic width and pushed the
                input past the modal edge and off-screen. */}
            <div className="flex gap-2">
              <SearchableSelect
                options={countryCodes.map(c => ({ value: c.code, label: `${c.flag} ${c.code}` }))}
                value={formData.countryCode}
                onChange={(v) => setFormData(prev => ({ ...prev, countryCode: v }))}
                placeholder={t('common.searchSelect')}
                className="w-32 px-3 py-2 rounded-lg border border-border bg-surface text-sm"
              />
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="1xxxxxxxxx"
                inputMode="numeric"
                maxLength={10}
className={`flex-1 min-w-0 px-4 py-2 rounded-lg border bg-surface ${
phoneError ?'border-danger':'border-border'
                }`}
              />
            </div>
            {phoneError && (
<p className="mt-1 text-xs text-danger">{phoneError}</p>
            )}
            {!phoneError && formData.phone && formData.phone.length < 10 && (
<p className="mt-1 text-xs text-warning">{10 - formData.phone.length}{t('customers.digitsRemaining')}</p>
            )}
          </div>

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
