import { captureException } from '../services/sentry.js'
import { notifyOperatorOnce } from '../services/telegramNotify.js'

/**
 * Reports every 5xx JSON response to Sentry, even when a route handled its
 * own failure without calling next(err).
 *
 * A large share of the routes respond `res.status(500).json({ error })`
 * straight from their catch blocks. Those failures never reach the error
 * handler, so error reporting missed them entirely — the majority of real
 * server faults were invisible to Sentry. This wraps res.json / res.send
 * near the top of the stack and captures the first 5xx response of each
 * request, tagged with enough context to find the failing route.
 *
 * The error handler marks res.locals.sentryReported before it responds, so
 * failures that DO travel via next(err) are reported exactly once — as the
 * real exception, not this synthetic response wrapper.
 */
export function capture500Responses(req, res, next) {
  const reportOnce = (body) => {
    if (res.statusCode < 500 || res.locals.sentryReported) return
    res.locals.sentryReported = true

    // `error` is deliberately generic in most route responses; when a
    // handler adds a safe diagnostic `details` field (e.g. the tenant-delete
    // list of blocking tables), that is the string worth putting in the
    // Sentry message and the operator alert - a bare "Internal server
    // error" cannot be acted on.
    const detail =
      body && typeof body === 'object' ? body.details ?? body.error : undefined
    const err = new Error(
      `${req.method} ${req.originalUrl} responded ${res.statusCode}${detail ? `: ${detail}` : ''}`,
    )
    err.name = 'RouteError'
    err.statusCode = res.statusCode
    captureException(err, {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      detail,
      tenantId: req.user?.tenantId,
      userId: req.user?.id,
    })

    // Telegram alert for the same trigger, deduped per route+status for
    // an hour (shared key with the error-handler hook below, so a failure
    // travelling via next(err) reports exactly once across both). SECURITY:
    // the query string is stripped before the path reaches the message -
    // URLs may carry tokens or PII, and none of it should leave the box.
    const pathOnly = (req.originalUrl || '/').split('?')[0]
    notifyOperatorOnce({
      key: `5xx ${req.method} ${pathOnly} ${res.statusCode}`,
      cooldownSec: 3600,
      emoji: '\u{1F525}',
      title: `Server error (${res.statusCode})`,
      lines: [`${req.method} ${pathOnly}`, String(detail || res.statusCode)],
      link: false,
    }).catch(() => {})
  }

  const originalJson = res.json.bind(res)
  res.json = (body) => {
    reportOnce(body)
    return originalJson(body)
  }

  const originalSend = res.send.bind(res)
  res.send = (body) => {
    reportOnce(body)
    return originalSend(body)
  }

  next()
}
