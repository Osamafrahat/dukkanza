import ConfirmModal from '../components/ConfirmModal'
import SearchableSelect from '../components/SearchableSelect'
import { Plus, Search, Eye, RotateCcw, Save, X, CheckCircle } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { journalsApi, accountsApi } from '../lib/api'
import { translateDescription } from '../lib/translateDescription'

// Every source_type the accounting engine can emit (see accountingEngine.js);
// each has an accounting.source* translation key.
const SOURCE_TYPES = [
  'manual', 'order', 'refund', 'expense', 'subscription_payment', 'stock_receive',
  'stock_adjust', 'production', 'reversal', 'payment', 'purchase_order',
  'initial_capital', 'credit_payment', 'closing',
]

export default function JournalEntriesPage() {
  const { t, toastSuccess, toastError } = useAppStore()
  const [searchParams] = useSearchParams()
  const [entries, setEntries] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  // Deep link from other pages (e.g. account ledger → journals?search=<code>)
  const [search, setSearch] = useState(() => searchParams.get('search') || '')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sourceType, setSourceType] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [reverseTarget, setReverseTarget] = useState(null)
  const [reversing, setReversing] = useState(false)

  const getAccountName = (account) => {
    if (!account) return ''
    const key = `accounting.account.${account.code}`
    const translated = t(key)
    return translated !== key ? translated : account.name
  }

  const translateDesc = (desc) => translateDescription(t, desc)
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '',
    reference: '',
    lines: [
      { accountId: '', debit: '', credit: '', description: '' },
      { accountId: '', debit: '', credit: '', description: '' },
    ],
  })

  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate trigger list: the loader below is re-created each render and is intentionally NOT a dep, so only these inputs refetch
  useEffect(() => { fetchEntries() }, [page, search, dateFrom, dateTo, sourceType])
  // accounts are fetched once; they never depend on the entry filters above
  useEffect(() => { fetchAccounts() }, [])

  const fetchEntries = async () => {
    try {
      const { data } = await journalsApi.getAll({
        page,
        limit: 20,
        search: search || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        source_type: sourceType || undefined,
      })
      setEntries(data.data)
      setTotal(data.total)
    } catch (err) {
      console.error(err)
      toastError(err.response?.data?.error || t('common.failed'))
    }
    finally { setLoading(false) }
  }

  const fetchAccounts = async () => {
    try {
      const { data } = await accountsApi.getAll()
      setAccounts(data)
    } catch (err) { console.error(err) }
  }

  const addLine = () => {
    setFormData({ ...formData, lines: [...formData.lines, { accountId: '', debit: '', credit: '', description: '' }] })
  }

  const removeLine = (i) => {
    if (formData.lines.length <= 2) return
    setFormData({ ...formData, lines: formData.lines.filter((_, idx) => idx !== i) })
  }

  const updateLine = (i, field, value) => {
    const newLines = [...formData.lines]
    newLines[i] = { ...newLines[i], [field]: value }
    setFormData({ ...formData, lines: newLines })
  }

  const totalDebit = formData.lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0)
  const totalCredit = formData.lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0)
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0

  const handleSubmit = async () => {
    if (!formData.description) return toastError(t('accounting.descRequired'))
    if (!isBalanced) return toastError(t('accounting.entryNotBalanced'))
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      await journalsApi.create({
        ...formData,
        lines: formData.lines.filter(l => l.accountId && (l.debit || l.credit)),
      })
      toastSuccess(t('accounting.entryCreated'))
      setShowForm(false)
      setFormData({ date: new Date().toISOString().split('T')[0], description: '', reference: '', lines: [{ accountId: '', debit: '', credit: '', description: '' }, { accountId: '', debit: '', credit: '', description: '' }] })
      fetchEntries()
    } catch (err) {
      toastError(err.response?.data?.error || t('common.failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReverse = async (id) => {
    setReversing(true)
    try {
      await journalsApi.reverse(id)
      toastSuccess(t('accounting.entryReversed'))
      fetchEntries()
      setReverseTarget(null)
    } catch (err) {
      toastError(err.response?.data?.error || t('common.failed'))
    } finally {
      setReversing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('accounting.journalEntries') || 'Journal Entries'}</h1>
<p className="text-muted">{t('accounting.journalEntriesDesc')||'Double-entry bookkeeping'}</p>
        </div>
<button onClick={()=>setShowForm(true)}className="px-4 py-2 bg-accent hover:bg-primary-700 text-white rounded-xl font-medium flex items-center gap-2">
          <Plus className="w-4 h-4" /> {t('accounting.newEntry') || 'New Entry'}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-surface rounded-2xl shadow-sm border border-border p-4">
          <p className="text-xs uppercase tracking-wider text-muted">{t('accounting.totalEntries')}</p>
          <p className="text-2xl font-bold">{total}</p>
        </div>
        <div className="bg-surface rounded-2xl shadow-sm border border-border p-4">
          <p className="text-xs uppercase tracking-wider text-muted">{t('accounting.entriesInList')}</p>
          <p className="text-2xl font-bold">{entries.length}</p>
        </div>
        <div className="bg-surface rounded-2xl shadow-sm border border-border p-4 flex flex-col justify-center">
          <p className="text-xs uppercase tracking-wider text-muted mb-1">{t('accounting.filters')}</p>
          <p className="text-sm text-muted">
            {[dateFrom && `${t('common.startDate')}: ${dateFrom}`, dateTo && `${t('common.endDate')}: ${dateTo}`, sourceType && t('accounting.source' + sourceType.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(''))].filter(Boolean).join(' · ') || t('common.none')}
          </p>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"/>
<input type="text"value={search}onChange={e=>{setSearch(e.target.value);setPage(1)}}placeholder={t('common.search')||'Search...'}className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-surface ring-focus outline-none"/>
        </div>
        <input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPage(1)}}
          aria-label={t('common.startDate')}
          className="px-3 py-2.5 rounded-xl border border-border bg-surface ring-focus outline-none text-sm"/>
        <input type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setPage(1)}}
          aria-label={t('common.endDate')}
          className="px-3 py-2.5 rounded-xl border border-border bg-surface ring-focus outline-none text-sm"/>
<SearchableSelect options={[{value:'',label:t('common.all')},...SOURCE_TYPES.map(s=>({value:s,label:t('accounting.source'+s.split('_').map(w=>w.charAt(0).toUpperCase()+ w.slice(1)).join(''))}))]}value={sourceType}onChange={v=>{setSourceType(v);setPage(1)}}placeholder={t('accounting.source')}className="px-4 py-2.5 rounded-xl border border-border bg-surface ring-focus outline-none"/>
        {(dateFrom || dateTo || sourceType || search) && (
          <button onClick={()=>{setDateFrom('');setDateTo('');setSourceType('');setSearch('');setPage(1)}}
            className="px-4 py-2.5 rounded-xl border border-border bg-surface-hover text-sm font-medium text-muted hover:text-foreground">
            {t('common.clear')}
          </button>
        )}
      </div>

      {/* Create Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
<div className="bg-surface rounded-2xl shadow-2xl w-full max-w-3xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold">{t('accounting.newEntry') || 'New Journal Entry'}</h3>
            <div className="grid grid-cols-3 gap-3">
<input type="date"value={formData.date}onChange={e=>setFormData({...formData,date: e.target.value})}className="px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"/>
<input value={formData.description}onChange={e=>setFormData({...formData,description: e.target.value})}placeholder={t('accounting.description')||'Description'}className="col-span-2 px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"/>
            </div>
<input value={formData.reference}onChange={e=>setFormData({...formData,reference: e.target.value})}placeholder={t('accounting.reference')||'Reference(optional)'}className="w-full px-4 py-2.5 rounded-xl border border-border bg-surface-secondary outline-none ring-focus"/>

            <div className="space-y-2">
<div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted">
                <div className="col-span-4">{t('accounting.account') || 'Account'}</div>
                <div className="col-span-2 text-end">{t('accounting.debit') || 'Debit'}</div>
                <div className="col-span-2 text-end">{t('accounting.credit') || 'Credit'}</div>
                <div className="col-span-3">{t('accounting.description') || 'Description'}</div>
                <div className="col-span-1" />
              </div>
              {formData.lines.map((line, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
<div className="col-span-4">
<SearchableSelect options={[{value:'',label:t('accounting.selectAccount')||'Select...'},...accounts.map(a=>({value:String(a.id),label:`${a.code} - ${getAccountName(a)}`}))]}value={line.accountId}onChange={(v)=>updateLine(i,'accountId',v)}placeholder={t('common.searchSelect')}className="px-3 py-2 rounded-lg border border-border bg-surface-secondary text-sm outline-none"/>
                </div>
<input type="number"value={line.debit}onChange={e=>updateLine(i,'debit',e.target.value)}placeholder="0"className="col-span-2 px-3 py-2 rounded-lg border border-border bg-surface-secondary text-sm text-end outline-none"/>
<input type="number"value={line.credit}onChange={e=>updateLine(i,'credit',e.target.value)}placeholder="0"className="col-span-2 px-3 py-2 rounded-lg border border-border bg-surface-secondary text-sm text-end outline-none"/>
<input value={line.description}onChange={e=>updateLine(i,'description',e.target.value)}className="col-span-3 px-3 py-2 rounded-lg border border-border bg-surface-secondary text-sm outline-none"/>
<button onClick={()=>removeLine(i)}className="col-span-1 flex items-center justify-center text-muted hover:text-red-500"><X className="w-4 h-4"/></button>
                </div>
              ))}
            </div>

<button onClick={addLine}className="text-sm text-accent hover:text-primary-700 font-medium">+{t('accounting.addLine')||'Add Line'}</button>

<div className="flex items-center justify-between border-t border-border pt-3">
              <div className="flex gap-4 text-sm">
<span className={`font-medium ${Math.abs(totalDebit - totalCredit)>0.01 ?'text-danger':'text-success'}`}>
                  {t('accounting.debit') || 'Debit'}: {totalDebit.toFixed(2)}
                </span>
<span className={`font-medium ${Math.abs(totalDebit - totalCredit)>0.01 ?'text-danger':'text-success'}`}>
                  {t('accounting.credit') || 'Credit'}: {totalCredit.toFixed(2)}
                </span>
{isBalanced &&<span className="text-success font-bold flex items-center gap-1"><CheckCircle className="w-4 h-4" /> {t('accounting.balanced')}</span>}
              </div>
              <div className="flex gap-3">
<button onClick={handleSubmit}disabled={!isBalanced}className="px-5 py-2.5 bg-accent hover:bg-primary-700 disabled:opacity-50 text-white rounded-xl font-medium flex items-center gap-2">
                  <Save className="w-4 h-4" /> {t('common.save') || 'Save'}
                </button>
<button onClick={()=>setShowForm(false)}className="px-4 py-2.5 bg-surface-tertiary bg-surface-hover rounded-xl font-medium">{t('common.cancel')||'Cancel'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {showDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
<div className="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">{showDetail.entry_number}</h3>
<button onClick={()=>setShowDetail(null)}className="p-2.5 bg-surface-hover rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center"><X className="w-5 h-5"/></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
<div><span className="text-muted">{t('common.date')}:</span>{showDetail.date}</div>
<div><span className="text-muted">{t('accounting.reference')}:</span>{showDetail.reference ||'-'}</div>
<div className="col-span-2"><span className="text-muted">{t('accounting.description')}:</span>{translateDesc(showDetail.description)}</div>
<div><span className="text-muted">{t('accounting.source')}:</span>{t('accounting.source'+(showDetail.source_type ||'manual').split('_').map(w=>w.charAt(0).toUpperCase()+ w.slice(1)).join(''))}</div>
<div><span className="text-muted">{t('accounting.status')}:</span>{showDetail.is_posted ? t('accounting.posted'): t('accounting.draft')}{showDetail.is_reversed ?`(${t('accounting.reversed')})`:''}</div>
            </div>
            <table className="w-full text-sm">
              <thead>
<tr className="border-b border-border text-muted">
                  <th className="text-start py-2">{t('accounting.account')}</th>
                  <th className="text-end py-2">{t('accounting.debit')}</th>
                  <th className="text-end py-2">{t('accounting.credit')}</th>
                </tr>
              </thead>
              <tbody>
                {showDetail.journal_entry_lines?.map(line => (
<tr key={line.id}className="border-b border-border">
                    <td className="py-2">{line.accounts?.code} - {getAccountName(line.accounts)}</td>
                    <td className="py-2 text-end font-mono">{line.debit > 0 ? line.debit.toFixed(2) : ''}</td>
                    <td className="py-2 text-end font-mono">{line.credit > 0 ? line.credit.toFixed(2) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
<tr className="font-bold border-t-2 border-border">
                  <td className="py-2">{t('common.total')}</td>
                  <td className="py-2 text-end font-mono">{showDetail.journal_entry_lines?.reduce((s, l) => s + l.debit, 0).toFixed(2)}</td>
                  <td className="py-2 text-end font-mono">{showDetail.journal_entry_lines?.reduce((s, l) => s + l.credit, 0).toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Entries List */}
      {loading ? (
<div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"/></div>
      ) : (
<div className="bg-surface rounded-2xl shadow-sm border border-border overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
<tr className="text-xs text-muted border-b border-border">
                <th className="text-start px-6 py-3 font-medium">{t('accounting.entryNumber') || 'Entry #'}</th>
                <th className="text-start px-6 py-3 font-medium">{t('common.date') || 'Date'}</th>
                <th className="text-start px-6 py-3 font-medium">{t('accounting.description') || 'Description'}</th>
                <th className="text-start px-6 py-3 font-medium">{t('accounting.source') || 'Source'}</th>
                <th className="text-end px-6 py-3 font-medium">{t('accounting.debit') || 'Debit'}</th>
                <th className="text-end px-6 py-3 font-medium">{t('accounting.credit') || 'Credit'}</th>
                <th className="text-end px-6 py-3 font-medium">{t('common.actions') || 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => {
                const totalDr = entry.journal_entry_lines?.reduce((s, l) => s + l.debit, 0) || 0
                const totalCr = entry.journal_entry_lines?.reduce((s, l) => s + l.credit, 0) || 0
                return (
<tr key={entry.id}className="border-t border-border bg-surface-hover">
                    <td className="px-6 py-3 text-sm font-mono font-bold">{entry.entry_number}</td>
                    <td className="px-6 py-3 text-sm">{entry.date}</td>
                    <td className="px-6 py-3 text-sm">{translateDesc(entry.description)}</td>
                    <td className="px-6 py-3 text-sm">
<span className="px-2 py-0.5 rounded-md text-xs bg-surface-tertiary">{t('accounting.source'+ entry.source_type.split('_').map(w=>w.charAt(0).toUpperCase()+ w.slice(1)).join(''))}</span>
                    </td>
                    <td className="px-6 py-3 text-sm text-end font-mono">{totalDr.toFixed(2)}</td>
                    <td className="px-6 py-3 text-sm text-end font-mono">{totalCr.toFixed(2)}</td>
                    <td className="px-6 py-3 text-end">
                      <div className="flex items-center justify-end gap-1">
<button onClick={()=>setShowDetail(entry)}className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-surface-hover text-muted hover:text-primary-600"><Eye className="w-4 h-4"/></button>
                        {!entry.is_reversed && entry.is_posted && (
<button onClick={()=>setReverseTarget(entry.id)}className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-surface-hover text-muted hover:text-orange-600"title={t('common.reverse')}><RotateCcw className="w-4 h-4"/></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
{entries.length===0 &&<p className="text-center py-8 text-muted">{t('common.noData')||'No entries found'}</p>}
          {total > 20 && (
<div className="flex justify-center gap-2 p-4 border-t border-border">
<button disabled={page===1}onClick={()=>setPage(page - 1)}className="px-3 py-1.5 rounded-lg bg-surface-tertiary disabled:opacity-50 text-sm">{t('accounting.prev')}</button>
<span className="px-3 py-1.5 text-sm text-muted">{t('accounting.page')}{page}</span>
<button disabled={entries.length<20}onClick={()=>setPage(page + 1)}className="px-3 py-1.5 rounded-lg bg-surface-tertiary disabled:opacity-50 text-sm">{t('accounting.next')}</button>
            </div>
          )}
        </div>
      )}
      <ConfirmModal
        open={!!reverseTarget}
        onClose={() => setReverseTarget(null)}
        onConfirm={() => handleReverse(reverseTarget)}
        title={t('accounting.reverseEntry') || 'Reverse Journal Entry'}
        message={t('accounting.reverseConfirm') || 'Are you sure you want to reverse this journal entry?'}
        type="warning"
        confirmText={t('accounting.reverse') || 'Reverse'}
        cancelText={t('common.cancel') || 'Cancel'}
        loading={reversing}
      />
    </div>
  )
}
