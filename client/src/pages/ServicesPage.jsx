import ConfirmModal from '../components/ConfirmModal'
import SearchableSelect from '../components/SearchableSelect'
import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { useUserStore, PERMISSIONS } from '../stores/userStore'
import { servicesApi } from '../lib/api'
import { X, Plus, Edit2, Trash2, Wrench, Shield, Settings, Power, Ban } from 'lucide-react'

const SERVICE_TYPES = [
  { value: 'maintenance', icon: Wrench },
  { value: 'warranty', icon: Shield },
  { value: 'custom', icon: Settings },
]

export default function ServicesPage() {
  const { t, language, toastSuccess, toastError } = useAppStore()
  const { hasPermission } = useUserStore()
  const canEdit = hasPermission(PERMISSIONS.SERVICES_EDIT)
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('name')

  useEffect(() => { fetchServices() }, [])

  const fetchServices = async () => {
    setLoading(true)
    try {
      const { data } = await servicesApi.getAll()
      setServices(data)
    } catch (err) {
      console.error('Failed to fetch services:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id) => {
    setDeleting(true)
    try {
      await servicesApi.delete(id)
      setDeleteTarget(null)
      toastSuccess(t('common.success'))
      fetchServices()
    } catch (err) {
      // 409 = the server-side guard: subscriptions still reference this
      // service, deactivating is the sanctioned alternative.
      const msg = err.response?.status === 409
        ? (t('services.serviceInUse') || 'In use').replace('{count}', err.response.data?.subscription_count ?? '?')
        : err.response?.data?.error || t('common.error') || 'Error'
      toastError(msg)
    } finally {
      setDeleting(false)
    }
  }

  // POS hides services with is_active === false — this toggle is the admin
  // side of that filter (the card dims and badges when off).
  const handleToggleActive = async (service) => {
    try {
      await servicesApi.update(service.id, { is_active: service.is_active === false })
      fetchServices()
    } catch (err) {
      toastError(err.response?.data?.error || t('common.error') || 'Error')
    }
  }

  const getTypeLabel = (type) => {
    const labels = {
      maintenance: t('services.typeMaintenance'),
      warranty: t('services.typeWarranty'),
      custom: t('services.typeCustom'),
    }
    return labels[type] || type
  }

  // Client-side search + sort: the catalogue is small and always fetched
  // in full, so no server round trip per keystroke.
  const q = searchQuery.trim().toLowerCase()
  const filtered = q
    ? services.filter((s) => [s.name, s.name_ar, s.description].some((v) => v && v.toLowerCase().includes(q)))
    : services
  const visible = [...filtered].sort((a, b) => {
    if (sortBy === 'price_desc') return (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0)
    if (sortBy === 'newest') return new Date(b.created_at || 0) - new Date(a.created_at || 0)
    return (a.name || '').localeCompare(b.name || '')
  })
  const activeCount = services.filter((s) => s.is_active !== false).length

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('services.title') || 'Services'}</h1>
<p className="text-muted">{t('services.subtitle')||'Manage your services'}</p>
        </div>
        {canEdit && (
          <button
            onClick={() => { setEditing(null); setShowForm(true) }}
className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-primary-700"
          >
            <Plus className="w-4 h-4" />
            {t('services.addService') || 'Add Service'}
          </button>
        )}
      </div>

      {/* Summary cards: total / active / inactive (POS hides inactive) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-surface rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <Wrench className="w-4 h-4 text-accent" /> {t('services.services')}
          </div>
          <p className="text-xl font-bold">{services.length}</p>
        </div>
        <div className="bg-surface rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <Power className="w-4 h-4 text-success" /> {t('services.statusActive')}
          </div>
          <p className="text-xl font-bold text-success">{activeCount}</p>
        </div>
        <div className="bg-surface rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 text-sm text-muted mb-1">
            <Ban className="w-4 h-4 text-danger" /> {t('services.inactive')}
          </div>
          <p className="text-xl font-bold text-danger">{services.length - activeCount}</p>
        </div>
      </div>

      {/* Search + sort */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder={t('services.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 min-w-0 px-4 py-2 rounded-lg border border-border bg-surface"
        />
        <SearchableSelect
          options={[
            { value: 'name', label: t('services.sortName') },
            { value: 'price_desc', label: t('services.sortPrice') },
            { value: 'newest', label: t('services.sortNewest') },
          ]}
          value={sortBy}
          onChange={(v) => setSortBy(v)}
          placeholder={t('common.searchSelect')}
          className="w-full sm:w-56 px-4 py-2 rounded-lg border border-border bg-surface outline-none"
        />
      </div>

      {loading ? (
<div className="text-center py-8 text-muted">{t('common.loading')||'Loading...'}</div>
      ) : services.length === 0 ? (
<div className="text-center py-12 bg-surface-secondary rounded-xl">
<Wrench className="w-12 h-12 mx-auto text-foreground mb-3"/>
<p className="text-muted">{t('services.noServices')||'No services yet'}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 bg-surface-secondary rounded-xl">
          <p className="text-muted">{t('services.noMatches')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map(service => {
            const TypeIcon = SERVICE_TYPES.find(t => t.value === service.service_type)?.icon || Settings
            return (
<div key={service.id}className={`bg-surface border border-border shadow-sm rounded-xl p-5 ${service.is_active === false ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
<div className="w-10 h-10 rounded-lg bg-accent-soft flex items-center justify-center">
<TypeIcon className="w-5 h-5 text-accent"/>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{language === 'ar' && service.name_ar ? service.name_ar : service.name}</h3>
                        {service.is_active === false && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-surface-tertiary text-muted font-medium">{t('services.inactive')}</span>
                        )}
                      </div>
<span className="text-xs px-2 py-0.5 rounded-full bg-surface-tertiary text-muted">
                        {getTypeLabel(service.service_type)}
                      </span>
                      {service.name_ar && service.name_ar !== service.name && (
                        <div className="text-xs text-muted mt-0.5">
                          {language === 'ar' ? service.name : service.name_ar}
                        </div>
                      )}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleToggleActive(service)}
                        title={service.is_active === false ? t('services.activate') : t('services.deactivate')}
                        className="p-1.5 text-muted hover:text-green-600 rounded-lg"
                      >
                        <Power className="w-4 h-4"/>
                      </button>
<button onClick={()=>{setEditing(service);setShowForm(true)}}className="p-1.5 text-muted hover:text-primary-600 rounded-lg"><Edit2 className="w-4 h-4"/></button>
<button onClick={()=>setDeleteTarget(service.id)}className="p-1.5 text-muted hover:text-red-600 rounded-lg"><Trash2 className="w-4 h-4"/></button>
                    </div>
                  )}
                </div>
{service.description &&<p className="text-sm text-muted mb-3">{service.description}</p>}
<div className="text-lg font-bold text-accent">{service.price?.toLocaleString()}{t('common.currency')||'EGP'}</div>
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <ServiceForm
          service={editing}
          onSave={async (data) => {
            try {
              if (editing) await servicesApi.update(editing.id, data)
              else await servicesApi.create(data)
              toastSuccess(t('common.success'))
              setShowForm(false)
              setEditing(null)
              fetchServices()
            } catch (err) {
              toastError(err.response?.data?.error || t('common.error') || 'Error')
            }
          }}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete(deleteTarget)}
        title={t('services.deleteService') || 'Delete Service'}
        message={t('services.deleteConfirm') || 'Are you sure you want to delete this service?'}
        type="danger"
        loading={deleting}
      />
    </div>
  )
}

function ServiceForm({ service, onSave, onClose }) {
  const { t } = useAppStore()
  const [form, setForm] = useState({
    name: service?.name || '',
    name_ar: service?.name_ar || '',
    description: service?.description || '',
    price: service?.price || '',
    service_type: service?.service_type || 'maintenance',
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    await onSave({ ...form, price: parseFloat(form.price) || 0 })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
<div className="bg-surface rounded-2xl w-full max-w-md mx-4 shadow-2xl">
<div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-xl font-semibold">{service ? t('services.editService') : t('services.addService')}</h2>
<button onClick={onClose}className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-surface-hover"><X className="w-5 h-5"/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{t('services.name') || 'Name'} *</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"/>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('services.nameAr')}</label>
            <input type="text" value={form.name_ar} onChange={e => setForm({ ...form, name_ar: e.target.value })} dir="rtl"
className="w-full px-4 py-2 rounded-lg border border-border bg-surface" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t('services.description') || 'Description'}</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2}
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"/>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t('services.price') || 'Price'} *</label>
              <input type="number" step="0.01" min="0" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} required
className="w-full px-4 py-2 rounded-lg border border-border bg-surface"/>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('services.type') || 'Type'}</label>
              <SearchableSelect
                options={[{ value: 'maintenance', label: t('services.typeMaintenance') || 'Maintenance' }, { value: 'warranty', label: t('services.typeWarranty') || 'Warranty' }, { value: 'custom', label: t('services.typeCustom') || 'Custom' }]}
                value={form.service_type}
                onChange={(v) => setForm({ ...form, service_type: v })}
                placeholder={t('common.searchSelect')}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
<button type="button"onClick={onClose}className="px-4 py-2 text-foreground bg-surface-tertiary rounded-lg bg-surface-hover">{t('common.cancel')}</button>
<button type="submit"className="px-4 py-2 bg-accent text-white rounded-lg hover:bg-primary-700">{t('common.save')}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
