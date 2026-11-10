import { describe, it, expect, beforeEach, jest } from '@jest/globals'

const captureException = jest.fn()

// ESM Jest: mock registrations are not hoisted, so the module under test is
// imported dynamically after the mock is installed.
jest.unstable_mockModule('../services/sentry.js', () => ({
  captureException,
  initSentry: jest.fn(),
  flushSentry: jest.fn(),
}))

const { capture500Responses } = await import('../middleware/capture500.js')

describe('capture500Responses', () => {
  let req, res, next

  beforeEach(() => {
    jest.clearAllMocks()
    req = { method: 'POST', originalUrl: '/api/accounts' }
    res = {
      statusCode: 200,
      locals: {},
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    }
    next = jest.fn()
  })

  const mount = () => capture500Responses(req, res, next)

  it('calls next and does not report on its own', () => {
    mount()
    expect(next).toHaveBeenCalledTimes(1)
    expect(captureException).not.toHaveBeenCalled()
  })

  it('captures a self-handled 500 json response with route context', () => {
    mount()
    res.statusCode = 500
    res.json({ error: 'Internal server error' })

    expect(captureException).toHaveBeenCalledTimes(1)
    const [err, context] = captureException.mock.calls[0]
    expect(err.name).toBe('RouteError')
    expect(err.message).toBe(
      'POST /api/accounts responded 500: Internal server error',
    )
    expect(err.statusCode).toBe(500)
    expect(context).toMatchObject({
      method: 'POST',
      path: '/api/accounts',
      status: 500,
      detail: 'Internal server error',
    })
  })

  it('captures 503 responses too', () => {
    mount()
    res.statusCode = 503
    res.json({ error: 'Payment gateway not configured' })
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it('ignores 4xx responses — normal operation is not an error', () => {
    mount()
    res.statusCode = 404
    res.json({ error: 'Endpoint not found' })
    expect(captureException).not.toHaveBeenCalled()
  })

  it('prefers the handler diagnostic `details` over the generic error', () => {
    // Routes keep `error` generic ("Internal server error"); a handler that
    // adds `details` (tenant delete: the blocking table list) wants THAT
    // string in the Sentry message and the operator alert.
    mount()
    res.statusCode = 500
    res.json({
      error: 'Internal server error',
      details: 'Tenant delete incomplete, failed tables: products',
    })

    expect(captureException).toHaveBeenCalledTimes(1)
    const [err, context] = captureException.mock.calls[0]
    expect(err.message).toBe(
      'POST /api/accounts responded 500: Tenant delete incomplete, failed tables: products',
    )
    expect(context.detail).toBe(
      'Tenant delete incomplete, failed tables: products',
    )
  })

  it('reports only once per request even if json and send both fire', () => {
    mount()
    res.statusCode = 500
    res.json({ error: 'boom' })
    res.send({ error: 'boom' })
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it('stays silent when the error handler already reported the exception', () => {
    res.locals.sentryReported = true
    mount()
    res.statusCode = 500
    res.json({ error: 'boom' })
    expect(captureException).not.toHaveBeenCalled()
  })

  it('passes successful responses straight through', () => {
    mount()
    res.statusCode = 200
    const body = { ok: true }
    const returned = res.json(body)
    expect(returned).toBe(res)
    expect(captureException).not.toHaveBeenCalled()
    expect(res.locals.sentryReported).toBeUndefined()
  })
})
