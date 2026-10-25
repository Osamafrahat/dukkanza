// Super-admin support mailbox — send and read support@dukkanza.com mail.
//
// RECEIVE. Mail is deliberately NOT copied into our database. Resend already
// receives everything addressed to the dukkanza.com MX (domain capability
// `receiving: enabled`) and keeps it, so the panel reads Resend's receiving
// API live: GET /emails/receiving for the list, GET /emails/receiving/{id}
// for one message with its html/text/headers/attachments. That buys the
// feature without a migration, without a second copy of every message to
// store securely, and without touching the existing inbound relay
// (routes/emailInbound.js), which still forwards to the owner mailbox and
// pings Telegram.
//
// SEND. Goes out through emailService's sendPayload choke point (so an
// optional MAIL_REPLY_TO override still applies) with senderFor('support')
// and replyTo pinned to the same address — a recipient's reply therefore
// lands back in support@dukkanza.com and re-enters the relay above instead
// of going nowhere.
//
// Mounted in index.js at /api/super-admin/support behind authenticateToken +
// requireSuperAdmin, mirroring how the super-admin router itself is mounted.
import { Router } from 'express'
import { Resend } from 'resend'
import { senderFor, sendPayload } from '../services/emailService.js'

const router = Router()

const RESEND_API = 'https://api.resend.com'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Message-ID shape only. These strings are written into In-Reply-To /
// References headers on the wire, so a CR/LF smuggled in by the caller would
// be HTTP header injection — hence the no-whitespace, no-angle-bracket rule.
const MESSAGE_ID = /^<[^\s<>]+>$/
const REFERENCE_LIST = /^(\s*<[^<>\s]+>)+$/
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

const MAX_LIST = 50
const MAX_BODY = 20000

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

// The written message body is admin-authored but still flows through a
// template before it becomes HTML, so it is escaped at the sink like every
// other interpolation in this codebase (see client/src/lib/html.js for the
// reasoning: mail HTML ends up in the recipient's client, and in ours when
// the sent copy is read back).
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function buildMessageHtml(body) {
  const paragraphs = escapeHtml(body)
    .split(/\r?\n/)
    .map((line) => `<p style="margin:0 0 12px">${line || '&nbsp;'}</p>`)
    .join('')
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body dir="auto" style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111827;margin:0">
${paragraphs}
</body>
</html>`
}

// Shared Resend read path. Upstream failures surface as 502 (the provider
// answered) or 503 (not configured) so the panel can tell "your mailbox is
// empty" apart from "email is broken".
async function resendGet(path) {
  const key = process.env.RESEND_API_KEY
  if (!key) throw httpError(503, 'Email service not configured')

  let response
  try {
    response = await fetch(`${RESEND_API}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
    })
  } catch {
    throw httpError(502, 'Email provider unreachable')
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    console.error('[SUPPORT] upstream', response.status, path, body?.message || '')
    throw httpError(502, body?.message || `Email provider responded ${response.status}`)
  }
  return body
}

// Cursor params are forwarded into a URL, so they are restricted to the UUID
// shape Resend itself expects (anything else would 422 or, worse, become a
// way to smuggle query syntax).
function cursorOf(value) {
  return typeof value === 'string' && UUID.test(value) ? value : null
}

function limitOf(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return 20
  return Math.min(Math.max(parsed, 1), MAX_LIST)
}

function fail(res, err) {
  const status = err.status || 500
  if (status === 500) console.error('[SUPPORT] handler error:', err)
  res.status(status).json({ error: err.message || 'Request failed' })
}

// GET /messages?folder=inbox|sent — the inbox list, or the panel's own
// outbound mail (Resend's sent list holds everything the account sends, so
// it is filtered down to the support sender to keep promotions/welcome mail
// out of this tab). Pagination cursors pass through for the inbox folder;
// the sent filter is applied after the page is fetched, which makes its
// hasMore an upper bound rather than an exact count — acceptable at the
// volumes a support mailbox sees.
router.get('/messages', async (req, res) => {
  try {
    const folder = req.query.folder === 'sent' ? 'sent' : 'inbox'
    const qs = new URLSearchParams({ limit: String(limitOf(req.query.limit)) })
    const after = cursorOf(req.query.after)
    const before = cursorOf(req.query.before)
    if (after) qs.set('after', after)
    if (before) qs.set('before', before)

    if (folder === 'inbox') {
      const body = await resendGet(`/emails/receiving?${qs}`)
      return res.json({ folder, items: body?.data || [], hasMore: !!body?.has_more })
    }

    const body = await resendGet(`/emails?${qs}`)
    const support = senderFor('support').toLowerCase()
    const items = (body?.data || []).filter((mail) =>
      String(mail?.from || '').toLowerCase().includes(support),
    )
    res.json({ folder, items, hasMore: !!body?.has_more })
  } catch (err) {
    fail(res, err)
  }
})

// GET /messages/:id?folder=inbox|sent — one message with its body. Inbox
// detail also carries headers, attachments and the SPF/DKIM/DMARC result
// (the panel shows those as trust badges, which is how you spot a spoofed
// "payment received" mail); sent detail is read from Resend's sent store,
// which is a different collection and therefore a different path.
router.get('/messages/:id', async (req, res) => {
  try {
    const { id } = req.params
    if (!UUID.test(id)) throw httpError(400, 'Invalid message id')
    const folder = req.query.folder === 'sent' ? 'sent' : 'inbox'
    res.json(await resendGet(folder === 'sent' ? `/emails/${id}` : `/emails/receiving/${id}`))
  } catch (err) {
    fail(res, err)
  }
})

// GET /messages/:id/attachments/:attachmentId — returns Resend's
// time-limited download_url rather than proxying bytes, so large files
// never pass through this API.
router.get('/messages/:id/attachments/:attachmentId', async (req, res) => {
  try {
    const { id, attachmentId } = req.params
    if (!UUID.test(id) || !UUID.test(attachmentId)) throw httpError(400, 'Invalid attachment id')
    res.json(await resendGet(`/emails/receiving/${id}/attachments/${attachmentId}`))
  } catch (err) {
    fail(res, err)
  }
})

// POST /send — compose, or reply (pass inReplyTo: the original Message-ID so
// the client threads it as a real reply instead of a fresh subject).
router.post('/send', async (req, res) => {
  try {
    const { to, subject, message, inReplyTo, references } = req.body || {}

    const recipients = (Array.isArray(to) ? to : [to])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
    if (recipients.length === 0 || recipients.length > 5) {
      return res.status(400).json({ error: 'Between 1 and 5 recipients are required' })
    }
    if (!recipients.every((address) => EMAIL.test(address))) {
      return res.status(400).json({ error: 'Invalid recipient address' })
    }

    const title = String(subject || '').trim()
    if (!title || title.length > 300) {
      return res.status(400).json({ error: 'Subject is required (max 300 characters)' })
    }

    const body = String(message || '').trim()
    if (!body || body.length > MAX_BODY) {
      return res.status(400).json({ error: `Message is required (max ${MAX_BODY} characters)` })
    }

    const replyToId = String(inReplyTo || '').trim()
    const referenceHeader = String(references || '').trim()
    if (replyToId && !MESSAGE_ID.test(replyToId)) {
      return res.status(400).json({ error: 'Invalid reply reference' })
    }
    if (referenceHeader && !REFERENCE_LIST.test(referenceHeader)) {
      return res.status(400).json({ error: 'Invalid reply reference' })
    }

    const key = process.env.RESEND_API_KEY
    if (!key) return res.status(503).json({ error: 'Email service not configured' })

    const from = senderFor('support')
    const payload = {
      from,
      to: recipients,
      subject: title,
      html: buildMessageHtml(body),
      replyTo: from,
    }
    if (replyToId) {
      payload.headers = { 'In-Reply-To': replyToId, References: referenceHeader || replyToId }
    }

    const { data, error } = await sendPayload(new Resend(key), payload)
    if (error) {
      console.error('[SUPPORT] send failed:', error.message)
      return res.status(502).json({ error: 'Email provider rejected the message' })
    }

    console.log('[SUPPORT] sent', data?.id, '->', recipients.join(','))
    res.json({ success: true, id: data?.id, from, to: recipients, subject: title })
  } catch (err) {
    fail(res, err)
  }
})

export default router
