import { useMemo, useRef, useState } from 'react'
import { Upload, X, Search, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { ENTITY_FIELDS, parseCsv, autoMap, buildImportItems, previewIssues } from '../lib/csvImport'

const PREVIEW_LIMIT = 5 // raw rows shown in the preview table
const ISSUE_LIMIT = 10 // preview/result errors listed before "…and N more"

/**
 * CSV import wizard for products / customers / suppliers.
 *
 * The flow is deliberately inspectable: paste or pick the file into a big
 * textarea (the raw data stays visible the whole time), press Analyze to
 * get an auto-mapping of columns -> fields (EN + AR synonyms, value-gated),
 * correct anything in the dropdowns while the preview shows what will
 * happen, then import. The server answers with a per-row report which is
 * rendered as-is (snake_case codes translated through t(), unknown codes
 * fall back to the raw code so nothing renders as a key).
 *
 * The parent owns persistence: onImport(items) returns the POST response
 * and the page refreshes its list; errors reject and are shown here.
 */
export default function CsvImportModal({ open, onClose, entity, onImport }) {
  const { t } = useAppStore()
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [analysis, setAnalysis] = useState(null)
  const [mapping, setMapping] = useState({})
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef(null)

  const fields = ENTITY_FIELDS[entity] || []
  const items = useMemo(
    () => (analysis ? buildImportItems(analysis.rows, mapping, entity, analysis.headerLine) : []),
    [analysis, mapping, entity]
  )
  const issues = useMemo(
    () => (analysis ? previewIssues(items, entity) : []),
    [analysis, items, entity]
  )

  if (!open) return null

  const isMapped = (field) => {
    const v = mapping[field]
    return v !== undefined && v !== null && v !== ''
  }

  // A disabled import must always say why — a dead button with no reason
  // is the most common "it doesn't work" report.
  const blockedReason = !analysis
    ? ''
    : items.length === 0
      ? t('importCsv.noRows')
      : !isMapped('name')
        ? t('importCsv.missingName')
        : entity === 'products' && !isMapped('price')
          ? t('importCsv.missingPrice')
          : ''

  const errText = (code) => {
    const key = 'importCsv.err.' + code
    const label = t(key)
    return label === key ? String(code) : label
  }

  const invalidate = () => {
    setAnalysis(null)
    setResult(null)
    setError('')
  }

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setCsvText(String(reader.result || ''))
      setFileName(file.name)
      setMapping({})
      invalidate()
    }
    reader.readAsText(file)
    e.target.value = '' // allow picking the same file twice in a row
  }

  const handleTextChange = (value) => {
    setCsvText(value)
    setFileName('')
    setMapping({})
    invalidate()
  }

  const handleAnalyze = () => {
    setError('')
    setResult(null)
    const parsed = parseCsv(csvText)
    if (parsed.headers.length === 0 || parsed.headers.every((h) => h === '')) {
      setAnalysis(null)
      setMapping({})
      setError(t('importCsv.parseError'))
      return
    }
    setAnalysis(parsed)
    setMapping(autoMap(parsed.headers, parsed.rows, entity))
  }

  const handleImport = async () => {
    if (blockedReason || importing) return
    setImporting(true)
    setError('')
    try {
      const data = await onImport(items)
      setResult(data || {})
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || t('importCsv.importFailed'))
    } finally {
      setImporting(false)
    }
  }

  const handleReset = () => {
    setCsvText('')
    setFileName('')
    setMapping({})
    setAnalysis(null)
    setResult(null)
    setError('')
  }

  const errorList = result && Array.isArray(result.errors) ? result.errors : []
  const shownErrors = errorList.slice(0, ISSUE_LIMIT)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-5 border-b border-border">
          <div>
            <h3 className="text-lg font-bold text-foreground">{t('importCsv.title')}</h3>
            <p className="text-sm text-muted mt-1 leading-relaxed">{t('importCsv.subtitle')}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg bg-surface-hover text-muted hover:text-foreground transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Raw CSV — the "large text" view the whole flow is built around */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-foreground">{t('importCsv.rawLabel')}</label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-surface-hover text-sm text-foreground"
              >
                <Upload className="w-4 h-4" />
                {t('importCsv.chooseFile')}
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={handleFile}
            />
            {fileName && (
              <p className="text-xs text-muted">{fileName}</p>
            )}
            <textarea
              dir="ltr"
              value={csvText}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder={t('importCsv.placeholder')}
              spellCheck={false}
              className="w-full h-64 resize-y font-mono text-xs leading-5 p-3 rounded-xl border border-border bg-surface-secondary text-foreground focus:outline-none focus:border-accent"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={!csvText.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-50"
              >
                <Search className="w-4 h-4" />
                {t('importCsv.analyze')}
              </button>
            </div>
          </div>

          {error && (
            <div className="px-3 py-2.5 rounded-lg bg-danger-soft text-danger text-sm">{error}</div>
          )}

          {analysis && (
            <>
              {/* Detected shape */}
              <div className="flex flex-wrap gap-2">
                <span className="px-2.5 py-1 rounded-full bg-surface-tertiary text-xs text-muted">
                  {t('importCsv.rowsFound', { n: items.length })}
                </span>
                <span className="px-2.5 py-1 rounded-full bg-surface-tertiary text-xs text-muted">
                  {t('importCsv.colsFound', { n: analysis.headers.length })}
                </span>
              </div>

              {/* Column -> field mapping */}
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-foreground">{t('importCsv.mappingTitle')}</h4>
                <p className="text-xs text-muted">{t('importCsv.mappingHint')}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {fields.map((def) => (
                  <div key={def.field} className="space-y-1">
                    <label className="block text-sm font-medium text-foreground">
                      {t(`importCsv.f.${def.field}`)}
                      {def.required && <span className="text-danger"> *</span>}
                    </label>
                    <select
                      value={mapping[def.field] ?? ''}
                      onChange={(e) => {
                        const v = e.target.value
                        setMapping((m) => ({ ...m, [def.field]: v === '' ? '' : Number(v) }))
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-foreground text-sm"
                    >
                      <option value="">{t('importCsv.noColumn')}</option>
                      {analysis.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || t('importCsv.column', { n: i + 1 })}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Preview of the raw rows */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-foreground">{t('importCsv.previewTitle')}</h4>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-surface-tertiary">
                        <th className="px-2 py-2 text-start font-medium text-muted whitespace-nowrap">#</th>
                        {analysis.headers.map((h, i) => (
                          <th key={i} className="px-2 py-2 text-start font-medium text-muted whitespace-nowrap">
                            {h || t('importCsv.column', { n: i + 1 })}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.rows.slice(0, PREVIEW_LIMIT).map((row, r) => (
                        <tr key={r} className="border-t border-border">
                          <td className="px-2 py-1.5 text-muted whitespace-nowrap">{r + analysis.headerLine + 1}</td>
                          {analysis.headers.map((_, c) => (
                            <td key={c} className="px-2 py-1.5 text-foreground max-w-[14rem] truncate">
                              {String(row[c] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Preview issues — what the server WILL report */}
              {issues.length > 0 ? (
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-danger flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" />
                    {t('importCsv.previewIssues')}
                  </h4>
                  <ul className="space-y-0.5 text-sm text-danger">
                    {issues.slice(0, ISSUE_LIMIT).map((issue, i) => (
                      <li key={i}>
                        {t('importCsv.row', { row: issue.row })} — {errText(issue.error)}
                      </li>
                    ))}
                    {issues.length > ISSUE_LIMIT && (
                      <li className="text-muted">{t('importCsv.andMore', { n: issues.length - ISSUE_LIMIT })}</li>
                    )}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted">{t('importCsv.noIssues')}</p>
              )}
            </>
          )}

          {/* Server result — authoritative per-row report */}
          {result && (
            <div className="rounded-xl border border-border bg-surface-secondary p-4 space-y-3">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-accent" />
                {t('importCsv.resultTitle')}
              </h4>
              <div className="flex flex-wrap gap-2">
                <span className="px-2.5 py-1 rounded-full bg-surface-tertiary text-xs text-foreground">
                  {t('importCsv.created', { n: result.created || 0 })}
                </span>
                <span className="px-2.5 py-1 rounded-full bg-surface-tertiary text-xs text-foreground">
                  {t('importCsv.updated', { n: result.updated || 0 })}
                </span>
                <span className={`px-2.5 py-1 rounded-full text-xs ${errorList.length ? 'bg-danger-soft text-danger' : 'bg-surface-tertiary text-muted'}`}>
                  {t('importCsv.errorsCount', { n: errorList.length })}
                </span>
                {result.categories_created > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-surface-tertiary text-xs text-muted">
                    {t('importCsv.catsCreated', { n: result.categories_created })}
                  </span>
                )}
                {result.suppliers_created > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-surface-tertiary text-xs text-muted">
                    {t('importCsv.supsCreated', { n: result.suppliers_created })}
                  </span>
                )}
              </div>
              {errorList.length > 0 && (
                <ul className="space-y-0.5 text-sm text-danger">
                  {shownErrors.map((issue, i) => (
                    <li key={i}>
                      {t('importCsv.row', { row: issue.row })} — {errText(issue.error)}
                    </li>
                  ))}
                  {errorList.length > ISSUE_LIMIT && (
                    <li className="text-muted">{t('importCsv.andMore', { n: errorList.length - ISSUE_LIMIT })}</li>
                  )}
                </ul>
              )}
              <button
                type="button"
                onClick={handleReset}
                className="text-sm text-accent font-medium"
              >
                {t('importCsv.reset')}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-surface-secondary border-t border-border space-y-2">
          {blockedReason && <p className="text-xs text-danger">{blockedReason}</p>}
          <div className="flex gap-3 justify-end">
            <button
              onClick={onClose}
              disabled={importing}
              className="px-4 py-2.5 rounded-xl border border-border text-foreground bg-surface-hover font-medium text-sm disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleImport}
              disabled={importing || !!blockedReason}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-white font-medium text-sm disabled:opacity-50"
            >
              {importing && (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {importing ? t('importCsv.importing') : t('importCsv.import')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
