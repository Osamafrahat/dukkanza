import ConfirmModal from '../components/ConfirmModal'
import { Link } from 'react-router-dom'
import { Plus, Search, Edit2, Trash2, Save, X, RefreshCw, Landmark, Eye, CheckCircle, XCircle, FileText, Scale } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import api, { accountsApi, accountingReportsApi } from '../lib/api'
import { translateDescription } from '../lib/translateDescription'
import SearchableSelect from '../components/SearchableSelect'

// Bilingual chart of accounts: names resolve through the
// accounting.account.<code> translation key when one exists, else the raw row.
const getAccountName = (t, account) => {
  const key = `accounting.account.${account.code}`
  const translated = t(key)
  return translated !== key ? translated : account.name
}

export default function ChartOfAccountsPage() {
  const { t, toastSuccess, toastError } = useAppStore()
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [sortBy, setSortBy] = useState('code')
  const [ledgerTarget, setLedgerTarget] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formData, setFormData] = useState({ code: '', name: '', account_type: 'asset', description: '' })
  const [showCapitalModal, setShowCapitalModal] = useState(false)
  const [capitalAmount, setCapitalAmount] = useState('')
  const [capitalDesc, setCapitalDesc] = useState('')
  const [capitalLoading, setCapitalLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const ACCOUNT_TYPES = {
asset:{label: t('accounting.asset')||'Asset',color:'bg-accent-soft text-accent-soft-foreground'},
liability:{label: t('accounting.liability')||'Liability',color:'bg-danger-soft text-danger-soft-foreground'},
equity:{label: t('accounting.equity')||'Equity',color:'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'},
revenue:{label: t('accounting.revenue')||'Revenue',color:'bg-success-soft text-success-soft-foreground'},
expense:{label: t('accounting.expenseType')||'Expense',color:'bg-warning-soft text-warning-soft-foreground'},
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate trigger list: the loader below is re-created each render and is intentionally NOT a dep, so only these inputs refetch
  useEffect(() => { fetchAccounts() }, [])

  const fetchAccounts = async () => {
    try {
      // Single unfiltered fetch: search/type/status filtering all happen
      // client-side below (filteredAccounts), so request params here would
      // just double-filter and hide rows the client filter would keep.
      const { data } = await accountsApi.getAll()
      setAccounts(data)
    } catch (err) {
      console.error(err)
      toastError(err.response?.data?.error || t('common.failed'))
    }
    finally { setLoading(false) }
  }

  const handleSeed = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      await accountsApi.seed()
      toastSuccess(t('accounting.seedSuccess'))
      fetchAccounts()
    } catch (err) { toastError(t('accounting.seedFailed')) }
    finally { setIsSubmitting(false) }
  }

  const handleRecalculate = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      await api.post('/accounting/accounts/recalculate-balances')
      toastSuccess(t('accounting.balancesRecalculated') || 'Balances recalculated')
      await fetchAccounts()
    } catch (err) {
      console.error(err)
      toastError(err.response?.data?.error || t('common.error'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSetCapital = async () => {
    if (!capitalAmount || parseFloat(capitalAmount) <= 0) return
    try {
      setCapitalLoading(true)
      await accountsApi.setInitialCapital({ amount: parseFloat(capitalAmount), description: capitalDesc })
      toastSuccess(t('accounting.capitalRecorded') || 'Initial capital recorded')
      setShowCapitalModal(false)
      setCapitalAmount('')
      setCapitalDesc('')
      fetchAccounts()
    } catch (err) {
      toastError(err.response?.data?.error || t('common.error'))
    } finally {
      setCapitalLoading(false)
    }
  }

  const handleSubmit = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      if (editingId) {
        await accountsApi.update(editingId, formData)
        toastSuccess(t('accounting.accountUpdated'))
      } else {
        await accountsApi.create(formData)
        toastSuccess(t('accounting.accountCreated'))
      }
      setShowForm(false)
      setEditingId(null)
      setFormData({ code: '', name: '', account_type: 'asset', description: '' })
      fetchAccounts()
    } catch (err) { toastError(err.response?.data?.error || t('common.error')) }
    finally { setIsSubmitting(false) }
  }

  const handleEdit = (account) => {
    setFormData({ code: account.code, name: account.name, account_type: account.account_type, description: account.description || '' })
    setEditingId(account.id)
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    setDeleting(true)
    try {
      await accountsApi.delete(id)
      toastSuccess(t('accounting.accountDeleted'))
      fetchAccounts()
      setDeleteTarget(null)
    } catch (err) {
      // 409 = the server-side guard: journal lines still reference this
      // account, so it can only be deactivated, not deleted.
      const msg = err.response?.status === 409
        ? (t('accounting.accountInUse') || 'In use').replace('{count}', err.response.data?.entry_count ?? '?')
        : (err.response?.data?.error || t('common.error'))
      toastError(msg)
      setDeleteTarget(null)
    }
    finally { setDeleting(false) }
  }

  const handleToggleActive = async (account) => {
    try {
      await accountsApi.update(account.id, { is_active: account.is_active === false })
      toastSuccess(t('accounting.accountUpdated'))
      fetchAccounts()
    } catch (err) {
      toastError(err.response?.data?.error || t('common.error'))
    }
  }

  const filteredAccounts = accounts.filter(a => {
    if (filterType && a.account_type !== filterType) return false
    if (filterStatus === 'active' && a.is_active === false) return false
    if (filterStatus === 'inactive' && a.is_active !== false) return false
    if (search && !a.name.toLowerCase().includes(search.toLowerCase()) && !a.code.includes(search)) return false
    return true
  })

  const sortedAccounts = [...filteredAccounts].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    if (sortBy === 'balance_desc') return (parseFloat(b.balance) || 0) - (parseFloat(a.balance) || 0)
    if (sortBy === 'balance_asc') return (parseFloat(a.balance) || 0) - (parseFloat(b.balance) || 0)
    return a.code.localeCompare(b.code)
  })

  const grouped = {}
  for (const type of ['asset', 'liability', 'equity', 'revenue', 'expense']) {
    grouped[type] = sortedAccounts.filter(a => a.account_type === type)
  }

  const activeCount = accounts.filter(a => a.is_active !== false).length
  const inactiveCount = accounts.length - activeCount
  const withBalanceCount = accounts.filter(a => Math.abs(parseFloat(a.balance) || 0) >= 0.01).length
  const netBalance = accounts.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('accounting.chartOfAccounts')}</h1>
<p className="text-muted">{t('accounting.manageAccounts')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
<button onClick={handleSeed}className="px-4 py-2 bg-surface-tertiary bg-surface-hover rounded-xl font-medium flex items-center gap-2 text-sm">
            <RefreshCw className="w-4 h-4" /> <span className="hidden sm:inline">{t('accounting.seedDefaults')}</span>
          </button>
<button onClick={handleRecalculate}className="px-4 py-2 bg-warning-soft hover:bg-yellow-200 text-warning-soft-foreground rounded-xl font-medium flex items-center gap-2 text-sm">
            <RefreshCw className="w-4 h-4" /> <span className="hidden sm:inline">{t('accounting.recalculateBalances')}</span>
          </button>
<button onClick={()=>setShowCapitalModal(true)}className="px-4 py-2 bg-success-soft hover:bg-green-200 text-success-soft-foreground rounded-xl font-medium flex items-center gap-2 text-sm">
            <Landmark className="w-4 h-4" /> <span className="hidden sm:inline">{t('accounting.setCapital')}</span>
          </button>
<button onClick={()=>{setShowForm(true);setEditingId(null);setFormData({code:'',name:'',account_type:'asset',description:''})}}className="px-4 py-2 bg-accent hover:bg-primary-700 text-white rounded-xl font-medium flex items-center gap-2">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">{t('accounting.addAccount')}</span>
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-surface rounded-2xl shadow-sm border border-border p-4">
          <p className="text-xs uppercase tracking-wider text-muted">{t('common.total')} {t('accounting.accountsCount')}</p>
          <p className="text-2xl font-bold">{accounts.length}</p>
        </div>
        <div className="bg-surface rounded-2xl shadow-sm border border-border p-4">
          <p className="text-xs uppercase tracking-wider text-muted">{t('accounting.withBalance')}</p>
          <p className="text-2xl font-bold">{withBalanceCount}</p>
        </div>
        <div className="bg-surface rounded-2xl shadow-sm border border-border p-4">
          <p className="text-xs uppercase tracking-wider text-muted">{t('common.active')} / {t('common.inactive')}</p>
          <p className="text-2xl font-bold"><span className="text-success">{activeCount}</span> <span className="text-muted">/</span> <span className="text-danger">{inactiveCount}</span></p>
        </div>
        <div className="bg-surface rounded-2xl shadow-sm border border-border p-4">
          <p className="text-xs uppercase tracking-wider text-muted">{t('accounting.balance')}</p>
          <p className="text-2xl font-bold font-mono">{netBalance.toFixed(2)} {t('common.currency')}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"/>
<input type="text"value={search}onChange={(e)=>setSearch(e.target.value)}placeholder={t('common.search')}className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-surface ring-focus outline-none"/>
        </div>
<SearchableSelect options={[{value:'',label:t('accounting.allTypes')},...Object.entries(ACCOUNT_TYPES).map(([key,val])=>({value:key,label:val.label}))]}value={filterType}onChange={(v)=>setFilterType(v)}placeholder={t('common.searchSelect')}className="px-4 py-2.5 rounded-xl border border-border bg-surface ring-focus outline-none"/>
<SearchableSelect options={[{value:'',label:t('common.all')}, {value:'active',label:t('common.active')}, {value:'inactive',label:t('common.inactive')}]}value={filterStatus}onChange={(v)=>setFilterStatus(v)}placeholder={t('common.searchSelect')}className="px-4 py-2.5 rounded-xl border border-border bg-surface ring-focus outline-none"/>
<SearchableSelect options={[
          { value: 'code', label: t('accounting.sortCode') },
          { value: 'name', label: t('accounting.sortName') },
          { value: 'balance_desc', label: t('accounting.sortBalanceDesc') },
          { value: 'balance_asc', label: t('accounting.sortBalanceAsc') },
        ]}value={sortBy}onChange={(v)=>setSortBy(v)}placeholder={t('common.searchSelect')}className="px-4 py-2.5 rounded-xl border border-border bg-surface ring-focus outline-none"/>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
<div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold">{editingId ? t('accounting.editAccount') : t('accounting.addAccount')}</h3>
<input value={formData.code}onChange={e=>setFormData({...formData,code: e.target.value})}placeholder={t('accounting.code')}className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"/>
<input value={formData.name}onChange={e=>setFormData({...formData,name: e.target.value})}placeholder={t('accounting.name')}className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"/>
<SearchableSelect options={Object.entries(ACCOUNT_TYPES).map(([key,val])=>({value:key,label:val.label}))}value={formData.account_type}onChange={(v)=>setFormData({...formData,account_type:v})}placeholder={t('common.searchSelect')}className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"/>
<textarea value={formData.description}onChange={e=>setFormData({...formData,description: e.target.value})}placeholder={t('common.description')}rows={2}className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"/>
            <div className="flex gap-3">
<button onClick={handleSubmit}className="flex-1 px-4 py-2.5 bg-accent hover:bg-primary-700 text-white rounded-xl font-medium flex items-center justify-center gap-2">
                <Save className="w-4 h-4" /> {t('common.save')}
              </button>
<button onClick={()=>{setShowForm(false);setEditingId(null)}}className="px-4 py-2.5 bg-surface-tertiary bg-surface-hover rounded-xl font-medium flex items-center gap-2">
                <X className="w-4 h-4" /> {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCapitalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
<div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold">{t('accounting.setCapital')}</h3>
<p className="text-sm text-muted">{t('accounting.capitalDescription')}</p>
            <input
              type="number"
              value={capitalAmount}
              onChange={e => setCapitalAmount(e.target.value)}
              placeholder={t('accounting.capitalAmount')}
              min="0"
              step="0.01"
className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"
            />
            <input
              value={capitalDesc}
              onChange={e => setCapitalDesc(e.target.value)}
              placeholder={t('accounting.capitalOptionalDesc')}
className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"
            />
            <div className="flex gap-3">
              <button
                onClick={handleSetCapital}
                disabled={!capitalAmount || parseFloat(capitalAmount) <= 0 || capitalLoading}
className="flex-1 px-4 py-2.5 bg-success hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-medium flex items-center justify-center gap-2"
              >
                <Landmark className="w-4 h-4" /> {capitalLoading ? t('common.saving') || 'Saving...' : t('common.save')}
              </button>
<button onClick={()=>{setShowCapitalModal(false);setCapitalAmount('');setCapitalDesc('')}}className="px-4 py-2.5 bg-surface-tertiary bg-surface-hover rounded-xl font-medium flex items-center gap-2">
                <X className="w-4 h-4" /> {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
<div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"/></div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([type, items]) => (
            items.length > 0 && (
<div key={type}className="bg-surface rounded-2xl shadow-sm border border-border overflow-hidden">
<div className="px-6 py-3 border-b border-border flex items-center justify-between">
                  <h3 className="font-semibold capitalize flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded-lg text-xs font-bold ${ACCOUNT_TYPES[type].color}`}>{ACCOUNT_TYPES[type].label}</span>
                    {items.length} {t('accounting.accountsCount')}
                  </h3>
<span className="text-sm font-medium text-muted">{items.reduce((s,a)=>s +(a.balance || 0),0).toFixed(2)} {t('common.currency')}</span>
                </div>
                <div className="overflow-x-auto">
                <table className="w-full min-w-[450px]">
                  <thead>
<tr className="text-xs text-muted border-b border-border">
                      <th className="text-start px-6 py-2 font-medium">{t('accounting.code')}</th>
                      <th className="text-start px-6 py-2 font-medium">{t('accounting.name')}</th>
                      <th className="text-end px-6 py-2 font-medium">{t('accounting.balance')}</th>
                      <th className="text-end px-6 py-2 font-medium">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(account => (
<tr key={account.id}className="border-t border-border bg-surface-hover">
                        <td className="px-6 py-3 text-sm font-mono font-bold">{account.code}</td>
                        <td className="px-6 py-3 text-sm font-medium">
                          <span className="flex items-center gap-2">
                            {getAccountName(t, account)}
                            <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${account.is_active !== false ? 'bg-success-soft text-success-soft-foreground' : 'bg-surface-tertiary text-muted'}`}>
                              {account.is_active !== false ? t('common.active') : t('common.inactive')}
                            </span>
                          </span>
                        </td>
                        <td className="px-6 py-3 text-sm font-medium text-end">{(account.balance || 0).toFixed(2)} {t('common.currency')}</td>
                        <td className="px-6 py-3 text-end">
                          <div className="flex items-center justify-end gap-1">
<button onClick={()=>setLedgerTarget(account)}title={t('accounting.accountLedger')}className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-surface-hover text-muted hover:text-primary-600"><Eye className="w-4 h-4"/></button>
<button onClick={()=>handleToggleActive(account)}title={account.is_active !== false ? t('accounting.deactivate') : t('accounting.activate')}className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-surface-hover text-muted hover:text-success">
                              {account.is_active !== false ? <XCircle className="w-4 h-4"/> : <CheckCircle className="w-4 h-4"/>}
                            </button>
<button onClick={()=>handleEdit(account)}className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-surface-hover text-muted hover:text-primary-600"><Edit2 className="w-4 h-4"/></button>
<button onClick={()=>setDeleteTarget(account.id)}className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-surface-hover text-muted hover:text-red-600"><Trash2 className="w-4 h-4"/></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )
          ))}
        </div>
      )}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete(deleteTarget)}
        title={t('accounting.deleteAccount') || 'Delete Account'}
        message={t('accounting.deleteConfirm') || 'Are you sure you want to delete this account?'}
        type="danger"
        confirmText={t('common.delete') || 'Delete'}
        cancelText={t('common.cancel') || 'Cancel'}
        loading={deleting}
      />
      {ledgerTarget && (
        <AccountDetailDrawer account={ledgerTarget} onClose={() => setLedgerTarget(null)} />
      )}
    </div>
  )
}

function AccountDetailDrawer({ account, onClose }) {
  const { t } = useAppStore()
  const [ledger, setLedger] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    accountingReportsApi.getAccountLedger(account.id)
      .then(({ data }) => { if (alive) setLedger(data) })
      .catch(() => { if (alive) setLedger({ account, transactions: [] }) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [account.id, account])

  const typeKey = `accounting.${account.account_type}`
  const typeLabel = t(typeKey) !== typeKey ? t(typeKey) : account.account_type
  const transactions = ledger?.transactions || []

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-surface shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-accent-soft rounded-lg"><Landmark className="w-5 h-5 text-accent" /></div>
              <div>
                <h2 className="text-xl font-bold text-foreground">{account.code} — {getAccountName(t, account)}</h2>
                <p className="text-sm text-muted">{typeLabel} · {(parseFloat(account.balance) || 0).toFixed(2)} {t('common.currency')}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2.5 rounded-lg bg-surface-hover min-w-[44px] min-h-[44px] flex items-center justify-center"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface-secondary rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted mb-1"><FileText className="w-3.5 h-3.5" />{t('accounting.totalEntries')}</div>
              <p className="text-lg font-bold">{loading ? '—' : transactions.length}</p>
            </div>
            <div className="bg-surface-secondary rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted mb-1"><Scale className="w-3.5 h-3.5" />{t('accounting.balance')}</div>
              <p className="text-lg font-bold font-mono">{(parseFloat(account.balance) || 0).toFixed(2)} {t('common.currency')}</p>
            </div>
            <div className="bg-surface-secondary rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted mb-1"><CheckCircle className="w-3.5 h-3.5" />{t('common.status')}</div>
              <p className="text-lg font-bold">{account.is_active !== false ? t('common.active') : t('common.inactive')}</p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">{t('accounting.transactions')}</h3>
              <Link to={`/accounting/journals?search=${encodeURIComponent(account.code)}`} className="flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
                <FileText className="w-3.5 h-3.5" />
                {t('accounting.viewInJournals')}
              </Link>
            </div>
            {loading ? (
              <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" /></div>
            ) : transactions.length === 0 ? (
              <p className="text-sm text-muted py-4">{t('common.noData')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px]">
                  <thead>
                    <tr className="text-xs text-muted border-b border-border">
                      <th className="text-start px-3 py-2 font-medium">{t('common.date')}</th>
                      <th className="text-start px-3 py-2 font-medium">{t('accounting.entryNumber')}</th>
                      <th className="text-start px-3 py-2 font-medium">{t('common.description')}</th>
                      <th className="text-end px-3 py-2 font-medium">{t('accounting.debit')}</th>
                      <th className="text-end px-3 py-2 font-medium">{t('accounting.credit')}</th>
                      <th className="text-end px-3 py-2 font-medium">{t('accounting.balance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(line => (
                      <tr key={line.id} className="border-t border-border bg-surface-hover">
                        <td className="px-3 py-2.5 text-sm">{line.journal_entries?.date}</td>
                        <td className="px-3 py-2.5 text-sm font-mono">{line.journal_entries?.entry_number}</td>
                        <td className="px-3 py-2.5 text-sm">{translateDescription(t, line.description || line.journal_entries?.description)}</td>
                        <td className="px-3 py-2.5 text-sm text-end font-mono">{line.debit > 0 ? parseFloat(line.debit).toFixed(2) : ''}</td>
                        <td className="px-3 py-2.5 text-sm text-end font-mono">{line.credit > 0 ? parseFloat(line.credit).toFixed(2) : ''}</td>
                        <td className="px-3 py-2.5 text-sm text-end font-mono font-medium">{(parseFloat(line.balance) || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
