// Super Admin → Support: send and read mail for support@dukkanza.com.
//
// The server proxies Resend (no copy of any message reaches our database),
// so this tab is a flat list + reader: folder switch (Inbox / Sent), message
// list, reader pane, compose/reply modal.
//
// SECURITY. Mail bodies are attacker-controlled markup — a message can be
// anything, including a phishing attempt aimed at whoever reads it here. The
// body therefore never touches our DOM: it is handed to a sandboxed iframe
// (sandbox="" — no scripts, no forms, no same-origin, no top navigation) as
// srcDoc, so nothing it contains can run or reach our tokens. Everything
// else (subject, addresses, filenames) goes through React's own escaping.
import { useState, useEffect, useCallback } from 'react'
import {
  Inbox, Send, RefreshCw, Loader2, Paperclip, Reply, X, ShieldCheck,
  ShieldX, ArrowLeft, Download, Mail,
} from 'lucide-react'
import { superAdminApi } from '../../lib/api'

const AUTH_LABELS = ['spf', 'dkim', 'dmarc']

// `Osama <osama@x.com>` -> `osama@x.com` (a reply's To must be a bare
// address; the display name would fail the server's recipient validation).
function addressOf(value) {
  const raw = String(value || '')
  const angled = raw.match(/<([^>]+)>/)
  return (angled ? angled[1] : raw).trim()
}

function displayName(value) {
  const raw = String(value || '')
  const angled = raw.match(/^\s*([^<]*?)\s*<[^>]+>/)
  return (angled ? angled[1] : raw).trim() || raw
}

function formatSize(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size <= 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function AuthBadge({ label, status }) {
  const ok = status === 'pass'
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${
        ok ? 'bg-success-soft text-success-soft-foreground' : 'bg-danger-soft text-danger-soft-foreground'
      }`}
      title={`${label.toUpperCase()}: ${status || 'unknown'}`}
    >
      {ok ? <ShieldCheck className="w-3 h-3" /> : <ShieldX className="w-3 h-3" />}
      {label}
    </span>
  )
}

export default function SupportTab({ t, showToast }) {
  const [folder, setFolder] = useState('inbox')
  const [items, setItems] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')

  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

  const [compose, setCompose] = useState(null) // { to, subject, message, inReplyTo, references }
  const [sending, setSending] = useState(false)

  const load = useCallback(async (targetFolder, append = false) => {
    setLoading(true)
    setListError('')
    try {
      const params = { folder: targetFolder, limit: 25 }
      if (append) {
        const last = items[items.length - 1]
        if (last?.id) params.after = last.id
      }
      const { data } = await superAdminApi.getSupportMessages(params)
      const next = data?.items || []
      setItems((prev) => (append ? [...prev, ...next] : next))
      setHasMore(!!data?.hasMore && next.length > 0)
    } catch (err) {
      setListError(err.response?.data?.error || (t('common.error') || 'Failed to load'))
      if (!append) setItems([])
    } finally {
      setLoading(false)
    }
    // `items` only participates so "Load more" can use the current tail as
    // its cursor; callers pass append explicitly to avoid a re-fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  useEffect(() => {
    setSelected(null)
    setDetail(null)
    load(folder)
  }, [folder, load])

  const open = useCallback(async (message) => {
    setSelected(message)
    setDetail(null)
    setDetailError('')
    setDetailLoading(true)
    try {
      const { data } = await superAdminApi.getSupportMessage(message.id, { folder })
      setDetail(data)
    } catch (err) {
      setDetailError(err.response?.data?.error || (t('common.error') || 'Failed to load'))
    } finally {
      setDetailLoading(false)
    }
  }, [folder, t])

  const download = useCallback(async (attachment) => {
    try {
      const { data } = await superAdminApi.getSupportAttachment(selected.id, attachment.id)
      const url = data?.download_url
      if (!url) throw new Error('missing url')
      // Signed, short-lived Resend CDN link — opened directly rather than
      // proxied through our API, so attachment bytes never hit this server.
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      showToast(t('common.error') || 'Failed to load', 'error')
    }
  }, [selected, showToast, t])

  const startReply = (message) => {
    const target = detail || message
    const original = String(target?.subject || '')
    const reference = String(target?.message_id || '').trim()
    setCompose({
      to: addressOf(target?.from),
      subject: /^re:/i.test(original) ? original : `Re: ${original || t('admin.supportNoSubject') || '(no subject)'}`,
      message: '',
      inReplyTo: reference,
      references: reference,
    })
  }

  const send = async () => {
    setSending(true)
    try {
      const recipients = compose.to
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      await superAdminApi.sendSupportMessage({
        to: recipients,
        subject: compose.subject,
        message: compose.message,
        ...(compose.inReplyTo ? { inReplyTo: compose.inReplyTo, references: compose.references } : {}),
      })
      showToast(t('admin.supportSentOk') || 'Support email sent')
      setCompose(null)
      if (folder === 'sent') load('sent')
    } catch (err) {
      showToast(err.response?.data?.error || (t('common.error') || 'Failed to send'), 'error')
    } finally {
      setSending(false)
    }
  }

  const emptyText =
    folder === 'sent'
      ? (t('admin.supportEmptySent') || 'No messages sent from support yet')
      : (t('admin.supportEmptyInbox') || 'No messages in the inbox')

  const bodyHtml = detail?.html
    ? String(detail.html)
    : detail?.text
      ? `<pre style="white-space:pre-wrap;font-family:'Segoe UI',Tahoma,Arial,sans-serif;font-size:14px;line-height:1.6;margin:0">${
          String(detail.text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
        }</pre>`
      : ''

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-border overflow-hidden">
          {['inbox', 'sent'].map((key) => (
            <button
              key={key}
              onClick={() => setFolder(key)}
              className={`px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors ${
                folder === key ? 'bg-accent text-white' : 'bg-surface text-muted hover:text-foreground'
              }`}
            >
              {key === 'inbox' ? <Inbox className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              {key === 'inbox'
                ? (t('admin.supportInbox') || 'Inbox')
                : (t('admin.supportSent') || 'Sent')}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <button
          onClick={() => load(folder)}
          disabled={loading}
          className="px-3 py-2 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-surface-secondary flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh') || 'Refresh'}
        </button>
        <button
          onClick={() => setCompose({ to: '', subject: '', message: '', inReplyTo: '', references: '' })}
          className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium hover:opacity-90 flex items-center gap-2"
        >
          <Mail className="w-4 h-4" />
          {t('admin.supportCompose') || 'Compose'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* List */}
        <div className={`bg-surface border border-border rounded-xl overflow-hidden ${selected ? 'hidden lg:block' : ''}`}>
          {listError && (
            <p className="p-4 text-sm text-danger-soft-foreground bg-danger-soft">{listError}</p>
          )}
          {loading && items.length === 0 && (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" />
            </div>
          )}
          {!loading && items.length === 0 && !listError && (
            <p className="p-8 text-center text-sm text-muted">{emptyText}</p>
          )}

          <ul className="divide-y divide-border max-h-[65vh] overflow-y-auto">
            {items.map((message) => {
              const active = selected?.id === message.id
              return (
                <li key={message.id}>
                  <button
                    onClick={() => open(message)}
                    className={`w-full text-left px-4 py-3 hover:bg-surface-secondary transition-colors ${
                      active ? 'bg-surface-secondary' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm truncate ${active ? 'font-semibold text-accent' : 'font-medium text-foreground'}`}>
                        {folder === 'sent'
                          ? (Array.isArray(message.to) ? message.to.join(', ') : message.to)
                          : displayName(message.from)}
                      </span>
                      <span className="text-[11px] text-muted whitespace-nowrap">
                        {formatDate(message.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground truncate mt-0.5">
                      {message.subject || (t('admin.supportNoSubject') || '(no subject)')}
                    </p>
                    {Array.isArray(message.attachments) && message.attachments.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted mt-1">
                        <Paperclip className="w-3 h-3" />
                        {message.attachments.length}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>

          {hasMore && (
            <button
              onClick={() => load(folder, true)}
              disabled={loading}
              className="w-full py-2.5 text-sm font-medium text-accent hover:bg-surface-secondary disabled:opacity-50"
            >
              {loading ? (t('common.loading') || 'Loading...') : (t('admin.supportLoadMore') || 'Load more')}
            </button>
          )}
        </div>

        {/* Reader */}
        <div className={`lg:col-span-2 bg-surface border border-border rounded-xl ${selected ? '' : 'hidden lg:block'}`}>
          {!selected && (
            <p className="p-10 text-center text-sm text-muted">
              {t('admin.supportSelect') || 'Select a message to read it'}
            </p>
          )}

          {selected && (
            <div>
              <div className="flex items-start gap-2 px-4 py-3 border-b border-border">
                <button
                  onClick={() => { setSelected(null); setDetail(null) }}
                  className="lg:hidden p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-secondary"
                  aria-label={t('common.back') || 'Back'}
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-foreground break-words">
                    {selected.subject || (t('admin.supportNoSubject') || '(no subject)')}
                  </h3>
                  <p className="text-sm text-muted mt-1 break-words">
                    {folder === 'sent'
                      ? `${t('admin.supportTo') || 'To'}: ${Array.isArray(selected.to) ? selected.to.join(', ') : selected.to}`
                      : `${t('admin.supportFrom') || 'From'}: ${selected.from}`}
                  </p>
                  <p className="text-xs text-muted mt-0.5">{formatDate(selected.created_at)}</p>
                </div>
                <button
                  onClick={() => startReply(selected)}
                  disabled={folder === 'sent'}
                  title={folder === 'sent' ? undefined : (t('admin.supportReply') || 'Reply')}
                  className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-surface-secondary flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Reply className="w-4 h-4" />
                  {t('admin.supportReply') || 'Reply'}
                </button>
              </div>

              {detailLoading && (
                <div className="flex items-center justify-center h-40">
                  <Loader2 className="w-6 h-6 animate-spin text-accent" />
                </div>
              )}

              {detailError && (
                <p className="p-4 text-sm text-danger-soft-foreground bg-danger-soft">{detailError}</p>
              )}

              {detail && (
                <>
                  {folder === 'inbox' && detail.authentication && (
                    <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-surface-secondary">
                      {AUTH_LABELS.map((label) => (
                        <AuthBadge key={label} label={label} status={detail.authentication?.[label]} />
                      ))}
                    </div>
                  )}

                  <div className="p-4">
                    {bodyHtml ? (
                      // Sandboxed: the message can paint pixels, nothing else.
                      <iframe
                        title={t('admin.supportMessage') || 'Message'}
                        sandbox=""
                        srcDoc={bodyHtml}
                        className="w-full h-[45vh] border border-border rounded-lg bg-white"
                      />
                    ) : (
                      <p className="text-sm text-muted">{t('admin.supportEmptyBody') || 'This message has no body.'}</p>
                    )}
                  </div>

                  {Array.isArray(detail.attachments) && detail.attachments.length > 0 && (
                    <div className="px-4 pb-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
                        {t('admin.supportAttachments') || 'Attachments'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {detail.attachments.map((attachment) => (
                          <button
                            key={attachment.id}
                            onClick={() => download(attachment)}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-foreground hover:bg-surface-secondary max-w-xs"
                          >
                            <Paperclip className="w-4 h-4 shrink-0" />
                            <span className="truncate">{attachment.filename}</span>
                            <span className="text-xs text-muted shrink-0">{formatSize(attachment.size)}</span>
                            <Download className="w-4 h-4 shrink-0 text-muted" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Compose / reply */}
      {compose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Send className="h-5 w-5 text-accent" />
                {compose.inReplyTo
                  ? (t('admin.supportReply') || 'Reply')
                  : (t('admin.supportCompose') || 'Compose')}
              </h3>
              <button
                onClick={() => setCompose(null)}
                className="text-muted hover:text-foreground"
                aria-label={t('common.close') || 'Close'}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="block text-xs font-medium text-muted mb-1">
                  {t('admin.supportTo') || 'To'}
                </span>
                <input
                  type="text"
                  value={compose.to}
                  onChange={(e) => setCompose((c) => ({ ...c, to: e.target.value }))}
                  placeholder="a@b.com, c@d.com"
                  className="w-full px-3 py-2.5 bg-surface-secondary border border-border rounded-xl text-sm text-foreground"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-muted mb-1">
                  {t('admin.supportSubject') || 'Subject'}
                </span>
                <input
                  type="text"
                  value={compose.subject}
                  onChange={(e) => setCompose((c) => ({ ...c, subject: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-surface-secondary border border-border rounded-xl text-sm text-foreground"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-muted mb-1">
                  {t('admin.supportMessage') || 'Message'}
                </span>
                <textarea
                  rows={7}
                  value={compose.message}
                  onChange={(e) => setCompose((c) => ({ ...c, message: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-surface-secondary border border-border rounded-xl text-sm text-foreground resize-y"
                />
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCompose(null)}
                disabled={sending}
                className="px-4 py-2.5 bg-surface-secondary text-foreground rounded-xl font-medium text-sm"
              >
                {t('common.cancel') || 'Cancel'}
              </button>
              <button
                onClick={send}
                disabled={sending || !compose.to.trim() || !compose.subject.trim() || !compose.message.trim()}
                className="px-5 py-2.5 bg-accent text-white rounded-xl font-medium text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {t('admin.supportSend') || 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
