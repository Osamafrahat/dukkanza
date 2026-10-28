import 'dotenv/config'

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { errorHandler } from './middleware/errorHandler.js'
import { capture500Responses } from './middleware/capture500.js'
import { notifyOperator } from './services/telegramNotify.js'
import { activityLogger } from './middleware/activityLogger.js'
import { loginLimiter } from './middleware/loginLimiter.js'
import { authRouter } from './routes/auth.js'
import { authenticateToken, optionalAuthenticateToken, requireManager, requireSuperAdmin, setTenantContext } from './middleware/auth.js'

import productsRouter from './routes/products.js'
import emailInboundRouter from './routes/emailInbound.js'
import categoriesRouter from './routes/categories.js'
import ordersRouter from './routes/orders.js'
import stockRouter from './routes/stock.js'
import branchesRouter from './routes/branches.js'
import suppliersRouter from './routes/suppliers.js'
import promotionsRouter from './routes/promotions.js'
import reportsRouter from './routes/reports.js'
import settingsRouter from './routes/settings.js'
import usersRouter from './routes/users.js'
import customersRouter from './routes/customers.js'
import employeesRouter from './routes/employees.js'
import expensesRouter from './routes/expenses.js'
import refundsRouter from './routes/refunds.js'
import emailRouter from './routes/email.js'
import activitiesRouter from './routes/activities.js'
import { accountsRouter } from './routes/accounts.js'
import { journalsRouter } from './routes/journals.js'
import { accountingReportsRouter } from './routes/accountingReports.js'
import { paymentsRouter } from './routes/payments.js'
import syncRouter from './routes/sync.js'
import etaRouter from './routes/eta.js'
import { backupRouter } from './routes/backup.js'
import { startBackupScheduler } from './services/backupScheduler.js'
import { startAttendanceCron, runAutoClockOut } from './services/attendanceCron.js'
import { startSubscriptionExpiryCron, runSchemaMigrations } from './services/subscriptionExpiry.js'
import { startKeepAliveCron, startActivityRetentionCron } from './services/keepAliveCron.js'
import chatRouter from './routes/chat.js'
import attendanceRouter from './routes/attendance.js'
import leaveRouter from './routes/leave.js'
import payrollRouter from './routes/payroll.js'
import shiftsRouter from './routes/shifts.js'
import performanceRouter from './routes/performance.js'
import servicesRouter from './routes/services.js'
import servicePlansRouter from './routes/servicePlans.js'
import subscriptionsRouter from './routes/subscriptions.js'
import billingRouter from './routes/billing.js'
import paymobRouter from './routes/paymob.js'
import { walletUserRouter, walletAdminRouter } from './routes/walletPayments.js'
import tenantRouter from './routes/tenant.js'
import superAdminRouter from './routes/superAdmin.js'
import supportMailRouter from './routes/supportMail.js'
import commissionsRouter from './routes/commissions.js'
import customerStatementsRouter from './routes/customerStatements.js'
import cashShiftsRouter from './routes/cashShifts.js'
import creditSalesRouter from './routes/creditSales.js'
import productBatchesRouter from './routes/productBatches.js'
import purchaseOrdersRouter from './routes/purchaseOrders.js'
import bomsRouter from './routes/boms.js'
import workCentersRouter from './routes/workCenters.js'
import productionOrdersRouter from './routes/productionOrders.js'
import manufacturingReportsRouter from './routes/manufacturingReports.js'
import { initSentry, flushSentry } from './services/sentry.js'

const app = express()
const PORT = process.env.PORT || 3001

// Runs before anything else in this module so boot-time failures are captured
// too. No-ops unless SENTRY_DSN is set.
initSentry()

app.set('trust proxy', 1)

// Must precede every route so no self-handled 5xx can slip past it. Catches
// 5xx responses that routes answer without calling next(err); without this,
// most server failures never reach Sentry.
app.use(capture500Responses)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const clientDist = path.join(__dirname, '../../client/dist')
const clientDistExists = fs.existsSync(clientDist)

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    }
  },
  crossOriginEmbedderPolicy: false
}))

if (clientDistExists) {
  app.use(express.static(clientDist))
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, Postman, mobile apps)
    if (!origin) return callback(null, true)

    if (allowedOrigins.length === 0) {
      // No origins configured — allow all in dev, block in production without crash
      if (process.env.NODE_ENV !== 'production') {
        return callback(null, true)
      }
      return callback(null, false)
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(null, false)
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  // x-branch-id is the multi-branch scoping header sent by the web client on
  // every request once a branch is selected. Without it in this allow-list the
  // browser blocks the preflighted request outright (network error client-side).
  allowedHeaders: ['Content-Type', 'Authorization', 'x-branch-id'],
  credentials: true,
  maxAge: 86400
}
app.use(cors(corsOptions))

// Inbound support-mail relay (Resend email.received webhook). Mounted before
// express.json with its own raw body parser - Svix verification hashes the
// exact request bytes. The signature IS the auth, so this path intentionally
// sits ahead of the general /api rate limiter.
app.use('/api/email/inbound', emailInboundRouter)
app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true, limit: '5mb' }))

// Every request, not just those under /api/. Until this existed only /api/
// was limited, so a hit to / or any other unrouted path fell through to
// Express's default 404 having passed no limiter at all — those paths were
// completely unthrottled. Runs before the per-path limiters below, so it is
// a ceiling; /api/ keeps its own tighter one underneath.
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Fly probes /api/health every 15s to decide whether to keep this machine
  // in rotation. Throttling our own health check would take it out of service.
  skip: (req) => req.path === '/api/health',
})
app.use(globalLimiter)

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})
app.use('/api/', limiter)

app.use('/api/auth/login', loginLimiter)
app.use('/api/auth/change-password', loginLimiter)
app.use('/api/auth/forgot-password', loginLimiter)

app.disable('x-powered-by')

app.use('/api/auth', authRouter)

app.use('/api/products', authenticateToken, setTenantContext, activityLogger, productsRouter)
app.use('/api/categories', authenticateToken, setTenantContext, activityLogger, categoriesRouter)
app.use('/api/orders', authenticateToken, setTenantContext, activityLogger, ordersRouter)
app.use('/api/stock', authenticateToken, setTenantContext, activityLogger, stockRouter)
app.use('/api/branches', authenticateToken, setTenantContext, activityLogger, branchesRouter)
app.use('/api/suppliers', authenticateToken, setTenantContext, activityLogger, suppliersRouter)
app.use('/api/promotions', authenticateToken, setTenantContext, activityLogger, promotionsRouter)
app.use('/api/reports', authenticateToken, setTenantContext, activityLogger, reportsRouter)
app.use('/api/settings', activityLogger, optionalAuthenticateToken, settingsRouter)
app.use('/api/users', authenticateToken, setTenantContext, requireManager, activityLogger, usersRouter)
app.use('/api/customers', authenticateToken, setTenantContext, activityLogger, customersRouter)
app.use('/api/employees', authenticateToken, setTenantContext, activityLogger, employeesRouter)
app.use('/api/expenses', authenticateToken, setTenantContext, activityLogger, expensesRouter)
app.use('/api/refunds', authenticateToken, setTenantContext, activityLogger, refundsRouter)
app.use('/api/notifications', authenticateToken, setTenantContext, activityLogger, emailRouter)
app.use('/api/activities', authenticateToken, setTenantContext, requireManager, activitiesRouter)

app.use('/api/accounting/accounts', authenticateToken, setTenantContext, requireManager, activityLogger, accountsRouter)
app.use('/api/accounting/journals', authenticateToken, setTenantContext, requireManager, activityLogger, journalsRouter)
app.use('/api/accounting/reports', authenticateToken, setTenantContext, requireManager, activityLogger, accountingReportsRouter)
app.use('/api/accounting/payments', authenticateToken, setTenantContext, requireManager, activityLogger, paymentsRouter)
app.use('/api/sync', authenticateToken, setTenantContext, syncRouter)
app.use('/api/eta', authenticateToken, setTenantContext, etaRouter)
app.use('/api/backup', authenticateToken, setTenantContext, requireManager, activityLogger, backupRouter)
app.use('/api/chat', authenticateToken, setTenantContext, chatRouter)
app.use('/api/attendance', authenticateToken, setTenantContext, activityLogger, attendanceRouter)
app.use('/api/leave', authenticateToken, setTenantContext, activityLogger, leaveRouter)
app.use('/api/payroll', authenticateToken, setTenantContext, activityLogger, payrollRouter)
app.use('/api/shifts', authenticateToken, setTenantContext, activityLogger, shiftsRouter)
app.use('/api/performance', authenticateToken, setTenantContext, activityLogger, performanceRouter)
app.use('/api/services', authenticateToken, setTenantContext, activityLogger, servicesRouter)
app.use('/api/service-plans', authenticateToken, setTenantContext, activityLogger, servicePlansRouter)
app.use('/api/subscriptions', authenticateToken, setTenantContext, activityLogger, subscriptionsRouter)
app.use('/api/billing', billingRouter)
app.use('/api/billing/paymob', paymobRouter)
app.use('/api/billing/wallet', walletUserRouter)
// Registered before the generic /api/super-admin mount so the wallet admin
// routes resolve without passing through superAdmin.js first.
app.use('/api/super-admin/wallet', walletAdminRouter)
// Same reason as the wallet mount above: registered before the generic
// /api/super-admin mount so the support-mailbox routes resolve without
// passing through superAdmin.js first. Guards are declared here (rather than
// as router.use) so the route-guard inventory test sees them at mount time.
app.use('/api/super-admin/support', authenticateToken, requireSuperAdmin, supportMailRouter)
app.use('/api/tenant', authenticateToken, setTenantContext, tenantRouter)
app.use('/api/super-admin', authenticateToken, superAdminRouter)
app.use('/api/commissions', authenticateToken, setTenantContext, activityLogger, commissionsRouter)
app.use('/api/customer-statements', authenticateToken, setTenantContext, activityLogger, customerStatementsRouter)
app.use('/api/cash-shifts', authenticateToken, setTenantContext, activityLogger, cashShiftsRouter)
app.use('/api/credit-sales', authenticateToken, setTenantContext, activityLogger, creditSalesRouter)
app.use('/api/product-batches', authenticateToken, setTenantContext, activityLogger, productBatchesRouter)
app.use('/api/purchase-orders', authenticateToken, setTenantContext, activityLogger, purchaseOrdersRouter)
app.use('/api/manufacturing/boms', authenticateToken, setTenantContext, activityLogger, bomsRouter)
app.use('/api/manufacturing/work-centers', authenticateToken, setTenantContext, activityLogger, workCentersRouter)
app.use('/api/manufacturing/orders', authenticateToken, setTenantContext, activityLogger, productionOrdersRouter)
app.use('/api/manufacturing/reports', authenticateToken, setTenantContext, activityLogger, manufacturingReportsRouter)

// Public banners endpoint (no auth required — shown on dashboard)
app.get('/api/banners', async (req, res) => {
  try {
    const { default: supabase } = await import('./db/supabase.js')
    const { data, error } = await supabase
      .from('banners')
      .select('*')
      .eq('is_active', true)
      .order('position', { ascending: true })
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.json([])
  }
})

app.get('/api/health', (req, res) => {
  const emailConfigured = !!(process.env.RESEND_API_KEY)
  const smtpConfigured = !!(process.env.SMTP_USER && process.env.SMTP_PASS)
  console.log(`[HEALTH] email=${emailConfigured} smtp=${smtpConfigured}`)
  res.json({
    status: 'ok',
    smtp: emailConfigured || smtpConfigured,
    timestamp: new Date().toISOString(),
  })
})

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' })
})

if (clientDistExists) {
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

app.use(errorHandler)

// Auto-initialize accounting data on startup
async function initAccounting() {
  try {
    console.log('Accounting: will auto-seed per tenant on first access')
  } catch (err) {
    console.error('Accounting init failed (non-fatal):', err.message)
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err)
})

// Fly stops machines with SIGTERM during restarts and deploys. Give
// in-flight Sentry events a moment to leave the box first — without this,
// an error captured moments before shutdown is silently dropped.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    await flushSentry(2000)
    process.exit(0)
  })
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`)
    initAccounting()
    runSchemaMigrations()
    startBackupScheduler()
    startAttendanceCron()
    startSubscriptionExpiryCron()
    startKeepAliveCron()
    startActivityRetentionCron()

    // Deploy confirmation. FLY_APP_NAME gates it so local development
    // never pings the production bot; fire-and-forget so the listen
    // callback is never held open by the Telegram timeout.
    if (process.env.FLY_APP_NAME) {
      notifyOperator({
        emoji: '\u{1F680}',
        title: 'Server booted',
        lines: [
          `App: ${process.env.FLY_APP_NAME}`,
          `Machine: ${process.env.FLY_MACHINE_ID || 'unknown'}`,
          `Time: ${new Date().toISOString()}`,
          ...(process.env.SOURCE_COMMIT ? [`Commit: ${String(process.env.SOURCE_COMMIT).slice(0, 12)}`] : []),
        ],
        link: false,
      }).catch(() => {})
    }
  })
}

export default app
