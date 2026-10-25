// supportMail — super-admin support mailbox (support@dukkanza.com).
//
// The router is mounted standalone on a bare express app and driven with
// supertest. Resend's read side goes through global fetch (stubbed here) and
// the send side through the Resend SDK (module-mocked), so no network leaves
// the process. Auth is applied at mount time in index.js rather than inside
// the router, so this file pins that mount explicitly — the guard inventory
// in authorization.test.js covers it structurally too.

import { jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import { readFileSync } from 'node:fs'

const sendSpy = jest.fn()

jest.unstable_mockModule('resend', () => ({
  Resend: jest.fn(() => ({ emails: { send: sendSpy } })),
}))

const { default: supportMailRouter } = await import('../routes/supportMail.js')

const TRACKED = ['RESEND_API_KEY', 'SMTP_FROM', 'MAIL_FROM_SUPPORT', 'MAIL_REPLY_TO']
let saved
let realFetch

beforeAll(() => {
  saved = Object.fromEntries(TRACKED.map((k) => [k, process.env[k]]))
  realFetch = global.fetch
})

afterEach(() => {
  for (const k of TRACKED) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  global.fetch = realFetch
  sendSpy.mockReset()
})

function configure() {
  process.env.RESEND_API_KEY = 're_test_key'
  // production shape: senderFor derives support@ from the SMTP_FROM domain
  process.env.SMTP_FROM = 'orders@dukkanza.com'
}

function stubFetch(status, body) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
  return global.fetch
}

const app = express()
app.use(express.json())
app.use('/api/super-admin/support', supportMailRouter)

const RECEIVED_ID = '8eebc903-8169-47e2-9516-3dbaa5d31a44'
const ATTACHMENT_ID = '2a0c9ce0-3112-4728-976e-47ddcd16a318'

describe('GET /api/super-admin/support/messages', () => {
  test('reads the inbox from Resend receiving list', async () => {
    configure()
    const fetchSpy = stubFetch(200, {
      object: 'list',
      has_more: true,
      data: [{ id: RECEIVED_ID, from: 'a@b.com', to: ['support@dukkanza.com'], subject: 'hi' }],
    })

    const res = await request(app).get('/api/super-admin/support/messages?limit=10')

    expect(res.status).toBe(200)
    expect(res.body.folder).toBe('inbox')
    expect(res.body.items).toHaveLength(1)
    expect(res.body.hasMore).toBe(true)
    const calledUrl = fetchSpy.mock.calls[0][0]
    expect(calledUrl).toContain('https://api.resend.com/emails/receiving?')
    expect(calledUrl).toContain('limit=10')
    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer re_test_key')
  })

  test('sent folder keeps only mail sent from the support address', async () => {
    configure()
    stubFetch(200, {
      has_more: false,
      data: [
        { id: 'm1', from: 'Dukkanza <support@dukkanza.com>', to: ['a@b.com'], subject: 'Re: billing' },
        { id: 'm2', from: 'hello@dukkanza.com', to: ['c@d.com'], subject: 'Welcome' },
        { id: 'm3', from: 'promotions@dukkanza.com', to: ['e@f.com'], subject: 'Sale' },
      ],
    })

    const res = await request(app).get('/api/super-admin/support/messages?folder=sent')

    expect(res.status).toBe(200)
    expect(res.body.folder).toBe('sent')
    expect(res.body.items.map((m) => m.id)).toEqual(['m1'])
  })

  test('clamps the limit and drops non-UUID cursors', async () => {
    configure()
    const fetchSpy = stubFetch(200, { data: [], has_more: false })

    await request(app).get('/api/super-admin/support/messages?limit=999&after=not-a-uuid')

    const calledUrl = fetchSpy.mock.calls[0][0]
    expect(calledUrl).toContain('limit=50')
    expect(calledUrl).not.toContain('after=')
  })

  test('503 until the provider key is configured', async () => {
    configure()
    delete process.env.RESEND_API_KEY
    const res = await request(app).get('/api/super-admin/support/messages')
    expect(res.status).toBe(503)
  })

  test('502 when Resend rejects the read', async () => {
    configure()
    stubFetch(401, { message: 'API key is invalid' })
    const res = await request(app).get('/api/super-admin/support/messages')
    expect(res.status).toBe(502)
    expect(res.body.error).toContain('API key is invalid')
  })
})

describe('GET /api/super-admin/support/messages/:id', () => {
  test('returns the message body with its authentication result', async () => {
    configure()
    stubFetch(200, {
      id: RECEIVED_ID,
      subject: 'Invoice?',
      html: '<p>hello</p>',
      text: 'hello',
      authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
      attachments: [],
    })

    const res = await request(app).get(`/api/super-admin/support/messages/${RECEIVED_ID}`)

    expect(res.status).toBe(200)
    expect(res.body.text).toBe('hello')
    expect(res.body.authentication.dkim).toBe('pass')
    expect(global.fetch.mock.calls[0][0]).toContain(`/emails/receiving/${RECEIVED_ID}`)
  })

  test('reads a sent message from the sent store, not the receiving store', async () => {
    configure()
    stubFetch(200, { id: RECEIVED_ID, subject: 'Re: invoice', html: '<p>ours</p>', text: 'ours' })

    const res = await request(app).get(
      `/api/super-admin/support/messages/${RECEIVED_ID}?folder=sent`,
    )

    expect(res.status).toBe(200)
    expect(res.body.text).toBe('ours')
    expect(global.fetch.mock.calls[0][0]).toBe(`https://api.resend.com/emails/${RECEIVED_ID}`)
  })

  test('rejects an id that is not a UUID before calling upstream', async () => {
    configure()
    const fetchSpy = stubFetch(200, {})
    const res = await request(app).get('/api/super-admin/support/messages/../../etc/passwd')
    expect([400, 404]).toContain(res.status)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('resolves an attachment download url', async () => {
    configure()
    stubFetch(200, { id: ATTACHMENT_ID, filename: 'a.jpg', download_url: 'https://cdn/x?sig=1' })

    const res = await request(app).get(
      `/api/super-admin/support/messages/${RECEIVED_ID}/attachments/${ATTACHMENT_ID}`,
    )

    expect(res.status).toBe(200)
    expect(res.body.download_url).toContain('https://cdn/')
    expect(global.fetch.mock.calls[0][0]).toContain(`/attachments/${ATTACHMENT_ID}`)
  })
})

describe('POST /api/super-admin/support/send', () => {
  const base = { to: 'customer@example.com', subject: 'Your invoice', message: 'Hello,\nSee attached.' }

  test('sends from support@ and replies to the support address', async () => {
    configure()
    sendSpy.mockResolvedValue({ data: { id: 'email_1' }, error: null })

    const res = await request(app).post('/api/super-admin/support/send').send(base)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.from).toBe('support@dukkanza.com')
    const payload = sendSpy.mock.calls[0][0]
    expect(payload.from).toBe('support@dukkanza.com')
    expect(payload.replyTo).toBe('support@dukkanza.com')
    expect(payload.to).toEqual(['customer@example.com'])
    expect(payload.subject).toBe('Your invoice')
    expect(payload.headers).toBeUndefined()
  })

  test('escapes the message body it turns into HTML', async () => {
    configure()
    sendSpy.mockResolvedValue({ data: { id: 'email_2' }, error: null })

    const res = await request(app)
      .post('/api/super-admin/support/send')
      .send({ ...base, message: '<script>alert(1)</script> & "quotes"' })

    expect(res.status).toBe(200)
    const html = sendSpy.mock.calls[0][0].html
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;quotes&quot;')
  })

  test('threads a reply via In-Reply-To / References', async () => {
    configure()
    sendSpy.mockResolvedValue({ data: { id: 'email_3' }, error: null })

    const res = await request(app)
      .post('/api/super-admin/support/send')
      .send({ ...base, inReplyTo: '<SE1P216MB2312@outlook.com>' })

    expect(res.status).toBe(200)
    expect(sendSpy.mock.calls[0][0].headers).toEqual({
      'In-Reply-To': '<SE1P216MB2312@outlook.com>',
      References: '<SE1P216MB2312@outlook.com>',
    })
  })

  test('refuses a reply reference that would inject headers', async () => {
    configure()
    sendSpy.mockResolvedValue({ data: { id: 'email_4' }, error: null })

    const res = await request(app)
      .post('/api/super-admin/support/send')
      .send({ ...base, inReplyTo: '<a@b.com>\r\nX-Evil: 1' })

    expect(res.status).toBe(400)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  test('validates recipients, subject and body', async () => {
    configure()

    const badEmail = await request(app).post('/api/super-admin/support/send').send({ ...base, to: 'not-an-email' })
    expect(badEmail.status).toBe(400)

    const noSubject = await request(app).post('/api/super-admin/support/send').send({ ...base, subject: '   ' })
    expect(noSubject.status).toBe(400)

    const noBody = await request(app).post('/api/super-admin/support/send').send({ ...base, message: '' })
    expect(noBody.status).toBe(400)

    const tooMany = await request(app)
      .post('/api/super-admin/support/send')
      .send({ ...base, to: ['a@b.com', 'c@d.com', 'e@f.com', 'g@h.com', 'i@j.com', 'k@l.com'] })
    expect(tooMany.status).toBe(400)

    expect(sendSpy).not.toHaveBeenCalled()
  })

  test('503 until the provider key is configured', async () => {
    configure()
    delete process.env.RESEND_API_KEY
    const res = await request(app).post('/api/super-admin/support/send').send(base)
    expect(res.status).toBe(503)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  test('502 when the provider rejects the send', async () => {
    configure()
    sendSpy.mockResolvedValue({ data: null, error: { message: 'domain not verified' } })
    const res = await request(app).post('/api/super-admin/support/send').send(base)
    expect(res.status).toBe(502)
  })
})

describe('mount-time guards', () => {
  test('index.js mounts the support mailbox behind the super-admin guards', () => {
    const indexSrc = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
    expect(indexSrc).toMatch(
      /app\.use\('\/api\/super-admin\/support',\s*authenticateToken,\s*requireSuperAdmin,\s*supportMailRouter\)/,
    )
    expect(indexSrc).toMatch(/import supportMailRouter from '\.\/routes\/supportMail\.js'/)
  })

  test('the route file never trusts caller input into a header value', () => {
    const src = readFileSync(new URL('../routes/supportMail.js', import.meta.url), 'utf8')
    // Message-ID / reference lists are the only strings allowed into
    // In-Reply-To and References; both patterns reject CR and LF.
    expect(src).toContain('const MESSAGE_ID = /^<[^\\s<>]+>$/')
    expect(src).toContain('const REFERENCE_LIST = /^(\\s*<[^<>\\s]+>)+$/')
    expect(src).not.toMatch(/headers:\s*\{\s*['"]?In-Reply-To['"]?\s*:\s*req\./)
  })
})
