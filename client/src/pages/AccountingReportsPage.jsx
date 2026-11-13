import ConfirmModal from '../components/ConfirmModal'
import { useState, useEffect, Fragment } from 'react'
import { useAppStore } from '../stores/appStore'
import { accountingReportsApi } from '../lib/api'
import { BarChart3, FileText, Scale, TrendingUp, TrendingDown, Download } from 'lucide-react'

export default function AccountingReportsPage() {
  const { t, toastSuccess, toastError } = useAppStore()
  const [activeTab, setActiveTab] = useState('trial-balance')
  const [trialBalance, setTrialBalance] = useState(null)
  const [balanceSheet, setBalanceSheet] = useState(null)
  const [profitLoss, setProfitLoss] = useState(null)
  const [fiscalPeriods, setFiscalPeriods] = useState([])
  const [loading, setLoading] = useState(false)
  const [closeTarget, setCloseTarget] = useState(null)
  const [closing, setClosing] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    loadReport()
    loadFiscalPeriods()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate trigger list: the loader below is re-created each render and is intentionally NOT a dep, so only these inputs refetch
  }, [activeTab, dateFrom, dateTo])

  const loadReport = async () => {
    setLoading(true)
    try {
      if (activeTab === 'trial-balance') {
        const { data } = await accountingReportsApi.getTrialBalance()
        setTrialBalance(data)
      } else if (activeTab === 'balance-sheet') {
        const { data } = await accountingReportsApi.getBalanceSheet()
        setBalanceSheet(data)
      } else if (activeTab === 'profit-loss') {
        const { data } = await accountingReportsApi.getProfitLoss({
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
        })
        setProfitLoss(data)
      }
    } catch (err) {
      console.error(err)
      toastError(err.response?.data?.error || t('common.failed'))
    } finally { setLoading(false) }
  }

  const loadFiscalPeriods = async () => {
    try {
      const { data } = await accountingReportsApi.getFiscalPeriods()
      setFiscalPeriods(data)
    } catch (err) {
      console.error(err)
      toastError(err.response?.data?.error || t('common.failed'))
    }
  }

  const handleClosePeriod = async (id) => {
    setClosing(true)
    try {
      await accountingReportsApi.closeFiscalPeriod(id)
      toastSuccess(t('accounting.periodClosed'))
      loadFiscalPeriods()
      setCloseTarget(null)
    } catch (err) {
      toastError(err.response?.data?.error || t('common.failed'))
    } finally {
      setClosing(false)
    }
  }

  const handlePrint = () => {
    const printContent = document.querySelector('.report-print-area .print\\:pt-0')
    if (!printContent) return

    const printWindow = window.open('', '_blank', 'width=900,height=700')
    // Popup blocker returned null — bail instead of throwing on .document.
    if (!printWindow) return
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${t('accounting.financialReports')} - ${activeTab}</title>
        <style>
          @page { size: A4 portrait; margin: 12mm; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #1f2937; font-size: 11px; }
          h2 { font-size: 16px; font-weight: bold; margin-bottom: 8px; color: #1e40af; }
          h3 { font-size: 13px; font-weight: 600; margin: 10px 0 6px; color: #374151; border-bottom: 2px solid #e5e7eb; padding-bottom: 4px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
          th { background: #1e40af; color: white; padding: 5px 8px; text-align: left; font-size: 10px; text-transform: uppercase; }
          td { padding: 4px 8px; border-bottom: 1px solid #e5e7eb; font-size: 10px; }
          tr:nth-child(even) { background: #f9fafb; }
          .text-right { text-align: right; }
          .font-bold { font-weight: 700; }
          .total-row { background: #f3f4f6 !important; font-weight: 700; }
          .section-header { background: #f3f4f6; padding: 4px 8px; font-weight: 600; font-size: 11px; }
        </style>
      </head>
      <body>
        ${printContent.innerHTML}
      </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.onload = () => { printWindow.print() }
  }

  const tabs = [
    { key: 'trial-balance', label: t('accounting.trialBalance') || 'Trial Balance', icon: Scale },
    { key: 'balance-sheet', label: t('accounting.balanceSheet') || 'Balance Sheet', icon: BarChart3 },
    { key: 'profit-loss', label: t('accounting.profitLoss') || 'Profit & Loss', icon: TrendingUp },
    { key: 'fiscal-periods', label: t('accounting.fiscalPeriods') || 'Fiscal Periods', icon: FileText },
  ]

  const formatAmount = (val) => {
    const num = parseFloat(val) || 0
    return num.toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const getAccountName = (acc) => {
    const key = `accounting.account.${acc.code}`
    const translated = t(key)
    return translated !== key ? translated : acc.name
  }

  return (
    <div className="space-y-6 report-print-area">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('accounting.financialReports') || 'Financial Reports'}</h1>
<p className="text-muted">{t('accounting.financialReportsDesc')||'View financial statements and reports'}</p>
        </div>
<button onClick={handlePrint}className="px-4 py-2 bg-surface-tertiary bg-surface-hover rounded-xl font-medium flex items-center gap-2 text-sm">
          <Download className="w-4 h-4" /> {t('common.print') || 'Print'}
        </button>
      </div>

      {/* Tabs */}
<div className="flex gap-2 border-b border-border pb-2 overflow-x-auto">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-sm whitespace-nowrap transition-colors ${activeTab===tab.key ?'bg-accent text-white shadow-lg shadow-primary-500/20':'text-muted bg-surface-hover'}`}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
<div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"/></div>
      ) : (
        <div className="print:pt-0">
          {/* Trial Balance */}
          {activeTab === 'trial-balance' && trialBalance && (
<div className="bg-surface rounded-2xl shadow-sm border border-border overflow-hidden">
<div className="px-4 sm:px-6 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="text-lg font-bold">{t('accounting.trialBalance')}</h2>
                <span className={`self-start px-2.5 py-1 rounded-lg text-xs font-bold ${trialBalance.isBalanced ? 'bg-success-soft text-success-soft-foreground' : 'bg-danger-soft text-danger-soft-foreground'}`}>
                  {trialBalance.isBalanced ? t('accounting.balanced') : t('accounting.unbalanced')}
                </span>
              </div>
              <div className="px-4 sm:px-6 py-4 grid grid-cols-1 sm:grid-cols-3 gap-3 border-b border-border">
                <div className="rounded-xl bg-surface-secondary p-3">
                  <p className="text-xs uppercase tracking-wider text-muted">{t('accounting.totalDebit')}</p>
                  <p className="text-lg font-bold font-mono">{formatAmount(trialBalance.totalDebit)}</p>
                </div>
                <div className="rounded-xl bg-surface-secondary p-3">
                  <p className="text-xs uppercase tracking-wider text-muted">{t('accounting.totalCredit')}</p>
                  <p className="text-lg font-bold font-mono">{formatAmount(trialBalance.totalCredit)}</p>
                </div>
                <div className="rounded-xl bg-surface-secondary p-3">
                  <p className="text-xs uppercase tracking-wider text-muted">{t('accounting.accountsCount')}</p>
                  <p className="text-lg font-bold font-mono">
                    {['asset', 'liability', 'equity', 'revenue', 'expense'].reduce((sum, type) => sum + (trialBalance.accounts[type]?.length || 0), 0)}
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px]">
                  <thead>
<tr className="bg-surface-secondary border-b border-border text-xs uppercase tracking-wider text-muted">
                      <th className="text-start px-4 sm:px-6 py-3 font-semibold">{t('accounting.code') || 'Code'}</th>
                      <th className="text-start px-4 sm:px-6 py-3 font-semibold">{t('accounting.name') || 'Name'}</th>
                      <th className="text-end px-4 sm:px-6 py-3 font-semibold">{t('accounting.debit') || 'Debit'}</th>
                      <th className="text-end px-4 sm:px-6 py-3 font-semibold">{t('accounting.credit') || 'Credit'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {['asset', 'liability', 'equity', 'revenue', 'expense'].map(type => (
                      trialBalance.accounts[type]?.length > 0 && (
                        <Fragment key={type}>
                          <tr>
<td colSpan={4}className="px-4 sm:px-6 py-2 bg-surface-tertiary border-b border-border">
<span className="text-xs font-bold uppercase tracking-wider text-muted">
                                {t('accounting.' + type + 'Accounts') || `${type} Accounts`}
                              </span>
                            </td>
                          </tr>
                          {trialBalance.accounts[type].map(acc => {
                            // Type-aware columns mirroring the server totals:
                            // asset/expense are debit-normal, liability/equity/
                            // revenue are credit-normal. A negative balance on
                            // a debit-normal account belongs in the CREDIT
                            // column (and vice versa) — sign alone lies.
                            const debitNormal = type === 'asset' || type === 'expense'
                            const balance = parseFloat(acc.balance) || 0
                            const onDebitSide = debitNormal ? balance >= 0 : balance < 0
                            return (
<tr key={acc.id}className="border-b border-border bg-surface-hover transition-colors">
<td className="px-4 sm:px-6 py-2.5 text-sm font-mono font-bold text-foreground">{acc.code}</td>
<td className="px-4 sm:px-6 py-2.5 text-sm text-foreground">{getAccountName(acc)}</td>
<td className="px-4 sm:px-6 py-2.5 text-sm text-end font-mono font-medium text-foreground">
                                {onDebitSide ? formatAmount(Math.abs(balance)) : ''}
                              </td>
<td className="px-4 sm:px-6 py-2.5 text-sm text-end font-mono font-medium text-foreground">
                                {!onDebitSide ? formatAmount(Math.abs(balance)) : ''}
                              </td>
                            </tr>
                            )
                          })}
                        </Fragment>
                      )
                    ))}
                  </tbody>
                  <tfoot>
<tr className="bg-surface-secondary border-t-2 border-border font-bold">
                      <td colSpan={2} className="px-4 sm:px-6 py-3 text-sm">{t('common.total') || 'Total'}</td>
                      <td className="px-4 sm:px-6 py-3 text-sm text-end font-mono">{formatAmount(trialBalance.totalDebit)}</td>
                      <td className="px-4 sm:px-6 py-3 text-sm text-end font-mono">{formatAmount(trialBalance.totalCredit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Balance Sheet */}
          {activeTab === 'balance-sheet' && balanceSheet && (
<div className="bg-surface rounded-2xl shadow-sm border border-border overflow-hidden">
<div className="px-6 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="text-lg font-bold">{t('accounting.balanceSheet')}</h2>
                <span className={`self-start px-2.5 py-1 rounded-lg text-xs font-bold ${balanceSheet.isBalanced ? 'bg-success-soft text-success-soft-foreground' : 'bg-danger-soft text-danger-soft-foreground'}`}>
                  {balanceSheet.isBalanced ? t('accounting.balanced') : t('accounting.unbalanced')}
                </span>
              </div>
              <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-3 gap-3 border-b border-border">
                <div className="rounded-xl bg-surface-secondary p-3">
                  <p className="text-xs uppercase tracking-wider text-muted">{t('accounting.totalAssets')}</p>
                  <p className="text-lg font-bold font-mono">{formatAmount(balanceSheet.assets.total)}</p>
                </div>
                <div className="rounded-xl bg-surface-secondary p-3">
                  <p className="text-xs uppercase tracking-wider text-muted">{t('accounting.totalLiabilities')}</p>
                  <p className="text-lg font-bold font-mono">{formatAmount(balanceSheet.liabilities.total)}</p>
                </div>
                <div className="rounded-xl bg-surface-secondary p-3">
                  <p className="text-xs uppercase tracking-wider text-muted">{t('accounting.totalEquity')}</p>
                  <p className="text-lg font-bold font-mono">{formatAmount(balanceSheet.equity.total)}</p>
                </div>
              </div>
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Assets */}
                <div>
<h3 className="font-bold text-accent mb-3 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" /> {t('accounting.assets')}
                  </h3>
                  {balanceSheet.assets.items.map(acc => (
<div key={acc.id}className="flex justify-between py-1.5 text-sm border-b border-border">
                      <span>{acc.code} - {getAccountName(acc)}</span>
                      <span className="font-mono font-medium">{formatAmount(acc.balance)}</span>
                    </div>
                  ))}
<div className="flex justify-between py-2 text-sm font-bold border-t-2 border-border mt-2">
                    <span>{t('accounting.totalAssets')}</span>
                    <span className="font-mono">{formatAmount(balanceSheet.assets.total)}</span>
                  </div>
                </div>

                {/* Liabilities */}
                <div>
<h3 className="font-bold text-danger mb-3 flex items-center gap-2">
                    <TrendingDown className="w-4 h-4" /> {t('accounting.liabilities')}
                  </h3>
                  {balanceSheet.liabilities.items.map(acc => (
<div key={acc.id}className="flex justify-between py-1.5 text-sm border-b border-border">
                      <span>{acc.code} - {getAccountName(acc)}</span>
                      <span className="font-mono font-medium">{formatAmount(acc.balance)}</span>
                    </div>
                  ))}
<div className="flex justify-between py-2 text-sm font-bold border-t-2 border-border mt-2">
                    <span>{t('accounting.totalLiabilities')}</span>
                    <span className="font-mono">{formatAmount(balanceSheet.liabilities.total)}</span>
                  </div>
                </div>
              </div>

              {/* Equity */}
              <div className="px-6 pb-6">
<h3 className="font-bold text-purple-600 dark:text-purple-400 mb-3">{t('accounting.equity')}</h3>
                {balanceSheet.equity.items.map(acc => (
<div key={acc.id}className="flex justify-between py-1.5 text-sm border-b border-border">
                    <span>{acc.code} - {getAccountName(acc)}</span>
                    <span className="font-mono font-medium">{formatAmount(acc.balance)}</span>
                  </div>
                ))}
<div className="flex justify-between py-2 text-sm font-bold border-t-2 border-border mt-2">
                  <span>{t('accounting.totalEquity')}</span>
                  <span className="font-mono">{formatAmount(balanceSheet.equity.total)}</span>
                </div>
              </div>

<div className="px-6 py-4 bg-surface-secondary border-t-2 border-border flex justify-between font-bold">
                <span>{t('accounting.totalLiabilities')} & {t('accounting.equity')}</span>
                <span className="font-mono">{formatAmount(balanceSheet.totalLiabilitiesAndEquity)}</span>
              </div>
              {!balanceSheet.isBalanced && (
<div className="px-6 py-2 bg-danger-soft text-danger-soft-foreground text-sm font-medium">{t('accounting.balanceWarning')}</div>
              )}
            </div>
          )}

          {/* Profit & Loss */}
          {activeTab === 'profit-loss' && profitLoss && (
<div className="bg-surface rounded-2xl shadow-sm border border-border overflow-hidden">
<div className="px-6 py-4 border-b border-border flex flex-col lg:flex-row lg:items-end justify-between gap-3">
                <h2 className="text-lg font-bold">{t('accounting.profitLoss')}</h2>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                    {t('common.startDate')}
                    <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-border bg-surface text-sm text-foreground outline-none ring-focus" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                    {t('common.endDate')}
                    <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-border bg-surface text-sm text-foreground outline-none ring-focus" />
                  </label>
                  {(dateFrom || dateTo) && (
                    <button onClick={() => { setDateFrom(''); setDateTo('') }}
                      className="px-3 py-2 min-h-[40px] text-sm font-medium text-muted hover:text-foreground rounded-xl border border-border">
                      {t('common.clear')}
                    </button>
                  )}
                </div>
              </div>
              <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-3 gap-3 border-b border-border">
                <div className="rounded-xl bg-surface-secondary p-3">
                  <p className="text-xs uppercase tracking-wider text-muted">{t('accounting.totalRevenue')}</p>
                  <p className="text-lg font-bold font-mono text-success">{formatAmount(profitLoss.totalRevenue)}</p>
                </div>
                <div className="rounded-xl bg-surface-secondary p-3">
                  <p className="text-xs uppercase tracking-wider text-muted">{t('accounting.totalExpenses')}</p>
                  <p className="text-lg font-bold font-mono text-warning">{formatAmount(profitLoss.totalExpenses)}</p>
                </div>
                <div className="rounded-xl bg-surface-secondary p-3">
                  <p className="text-xs uppercase tracking-wider text-muted">{profitLoss.netIncome >= 0 ? t('accounting.netIncome') : t('accounting.netLoss')}</p>
                  <p className={`text-lg font-bold font-mono ${profitLoss.netIncome >= 0 ? 'text-success' : 'text-danger'}`}>
                    {formatAmount(profitLoss.netIncome)}
                  </p>
                </div>
              </div>
              <div className="p-6 space-y-6">
                {/* Revenue */}
                <div>
<h3 className="font-bold text-success mb-3 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" /> {t('accounting.revenue')}
                  </h3>
                  {profitLoss.revenues.map(acc => (
<div key={acc.code}className="flex justify-between py-1.5 text-sm border-b border-border">
                      <span>{acc.code} - {getAccountName(acc)}</span>
                      <span className="font-mono font-medium">{formatAmount(acc.total)}</span>
                    </div>
                  ))}
<div className="flex justify-between py-2 text-sm font-bold border-t-2 border-border mt-2">
                    <span>{t('accounting.totalRevenue')}</span>
<span className="font-mono text-success">{formatAmount(profitLoss.totalRevenue)}</span>
                  </div>
                </div>

                {/* Expenses */}
                <div>
<h3 className="font-bold text-warning mb-3 flex items-center gap-2">
                    <TrendingDown className="w-4 h-4" /> {t('accounting.expenses')}
                  </h3>
                  {profitLoss.expenses.map(acc => (
<div key={acc.code}className="flex justify-between py-1.5 text-sm border-b border-border">
                      <span>{acc.code} - {getAccountName(acc)}</span>
                      <span className="font-mono font-medium">{formatAmount(acc.total)}</span>
                    </div>
                  ))}
<div className="flex justify-between py-2 text-sm font-bold border-t-2 border-border mt-2">
                    <span>{t('accounting.totalExpenses')}</span>
<span className="font-mono text-warning">{formatAmount(profitLoss.totalExpenses)}</span>
                  </div>
                </div>

                {/* Net Income */}
<div className={`flex justify-between py-3 text-lg font-bold border-t-2 ${profitLoss.netIncome>=0 ?'border-success text-success':'border-danger text-danger'}`}>
                  <span>{profitLoss.netIncome >= 0 ? t('accounting.netIncome') : t('accounting.netLoss')}</span>
                  <span className="font-mono">{formatAmount(profitLoss.netIncome)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Fiscal Periods */}
          {activeTab === 'fiscal-periods' && (
<div className="bg-surface rounded-2xl shadow-sm border border-border overflow-hidden">
<div className="px-6 py-4 border-b border-border">
                <h2 className="text-lg font-bold">{t('accounting.fiscalPeriods') || 'Fiscal Periods'}</h2>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
<tr className="text-xs text-muted border-b border-border">
                    <th className="text-start px-6 py-3 font-medium">{t('common.name')}</th>
                    <th className="text-start px-6 py-3 font-medium">{t('common.startDate')}</th>
                    <th className="text-start px-6 py-3 font-medium">{t('common.endDate')}</th>
                    <th className="text-center px-6 py-3 font-medium">{t('accounting.status')}</th>
                    <th className="text-end px-6 py-3 font-medium">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {fiscalPeriods.map(period => (
<tr key={period.id}className="border-t border-border">
                      <td className="px-6 py-3 text-sm font-medium">{period.name}</td>
                      <td className="px-6 py-3 text-sm">{period.start_date}</td>
                      <td className="px-6 py-3 text-sm">{period.end_date}</td>
                      <td className="px-6 py-3 text-center">
<span className={`px-2.5 py-0.5 rounded-lg text-xs font-bold ${period.is_closed ?'bg-surface-tertiary text-muted':'bg-success-soft text-success-soft-foreground'}`}>
                          {period.is_closed ? t('accounting.closed') : t('accounting.open')}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-end">
                        {!period.is_closed && (
<button onClick={()=>setCloseTarget(period.id)}className="px-3 py-2 min-h-[44px] text-sm font-medium text-danger hover:bg-red-50 rounded-lg">
                            {t('accounting.closePeriod')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
{fiscalPeriods.length===0 &&<p className="text-center py-8 text-muted">{t('accounting.noPeriods')}</p>}
              </div>
            </div>
          )}
        </div>
      )}
      <ConfirmModal
        open={!!closeTarget}
        onClose={() => setCloseTarget(null)}
        onConfirm={() => handleClosePeriod(closeTarget)}
        title={t('accounting.closePeriod') || 'Close Fiscal Period'}
        message={t('accounting.periodCloseConfirm') || 'Are you sure you want to close this fiscal period? This action cannot be undone.'}
        type="warning"
        confirmText={t('accounting.closePeriod') || 'Close Period'}
        cancelText={t('common.cancel') || 'Cancel'}
        loading={closing}
      />
    </div>
  )
}
