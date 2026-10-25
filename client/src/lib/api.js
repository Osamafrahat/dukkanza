import axios from 'axios'
import { localizeApiError } from './apiError'
import { getBranchHeader } from './branchHeader'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor to add auth token + active branch
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    // Multi-branch scoping: every request carries the branch the operator
    // selected (see lib/branchHeader.js). Absent selection = no header, and
    // the server resolves its own effective branch.
    const branchId = getBranchHeader()
    if (branchId != null) {
      config.headers['x-branch-id'] = branchId
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor to handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (window.__forcePasswordChangeActive) {
      return Promise.reject(error)
    }

    // Localize known permission/auth error payloads in place, so every
    // caller that surfaces `err.response.data.error` (toasts, inline
    // errors) shows the active language instead of raw server English.
    const localized = localizeApiError(error.response?.data)
    if (localized && error.response?.data) {
      error.response.data.error = localized
    }

    const status = error.response?.status
    const sessionExpired = error.response?.data?.sessionExpired
    const isLoginPage = window.location.pathname === '/login'
    const skipRedirect = error.config?.skipAuthRedirect

    let mustChangePw = false
    try {
      const raw = localStorage.getItem('user-storage')
      if (raw) {
        const parsed = JSON.parse(raw)
        const u = parsed?.state?.currentUser
        const val = u?.must_change_password
        mustChangePw = val === true || val === 1 || val === '1' || val === 'true'
      }
    } catch { /* ignore */ }

    // Session death = 401 (missing/invalid/rotated token) or any response the
    // server tagged `sessionExpired` (e.g. deactivated account's 403). A plain
    // 403 is a PERMISSION failure (requireManager/requireSuperAdmin) — the
    // user's session is fine and must NOT be destroyed; the calling code
    // surfaces the error instead.
    const isSessionDeath = status === 401 || (status === 403 && sessionExpired)
    if (isSessionDeath && !isLoginPage && !skipRedirect && !mustChangePw) {
      const upgradeRequired = error.response?.data?.upgradeRequired
      if (upgradeRequired) {
        window.dispatchEvent(new CustomEvent('plan-limit-reached', {
          detail: {
            resource: error.response?.data?.error,
            limit: error.response?.data?.limit,
            current: error.response?.data?.current,
          }
        }))
        return Promise.reject(error)
      }

      localStorage.removeItem('auth_token')
      localStorage.removeItem('user')
      localStorage.removeItem('user-storage')
      localStorage.removeItem('cart-storage')
      localStorage.removeItem('tenant_id')
      // Per-session branch selection must not outlive the dead session —
      // the hard navigation below would otherwise rehydrate it for whoever
      // logs in next on this browser.
      localStorage.removeItem('erp-selected-branch')
      if (sessionExpired) {
        window.location.href = '/login?expired=1'
      } else {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

// Auth API
export const authApi = {
  login: (credentials) => api.post('/auth/login', credentials),
  register: (data) => api.post('/auth/register', data),
  changePassword: (data) => api.post('/auth/change-password', data, { skipAuthRedirect: true }),
  getProfile: () => api.get('/auth/profile'),
  updateProfile: (data) => api.put('/auth/profile', data),
  getMe: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
}

// Products API
export const productsApi = {
  getAll: (params) => api.get('/products', { params }),
  getById: (id) => api.get(`/products/${id}`),
  create: (data) => api.post('/products', data),
  update: (id, data) => api.put(`/products/${id}`, data),
  delete: (id) => api.delete(`/products/${id}`),
  getByBarcode: (barcode) => api.get(`/products/barcode/${barcode}`),
}

// Categories API
export const categoriesApi = {
  getAll: () => api.get('/categories'),
  create: (data) => api.post('/categories', data),
  update: (id, data) => api.put(`/categories/${id}`, data),
  delete: (id) => api.delete(`/categories/${id}`),
}

// Orders API
export const ordersApi = {
  getAll: (params) => api.get('/orders', { params }),
  getById: (id) => api.get(`/orders/${id}`),
  getByCustomer: (customerId) => api.get('/orders', { params: { customer_id: customerId } }),
  create: (data) => api.post('/orders', data),
  updateStatus: (id, status) => api.patch(`/orders/${id}/status`, { status }),
}

// Stock API
export const stockApi = {
  getMovements: (params) => api.get('/stock/movements', { params }),
  receive: (data) => api.post('/stock/receive', data),
  adjust: (data) => api.post('/stock/adjust', data),
  // Multi-branch stock transfers (executed immediately server-side)
  getTransfers: () => api.get('/stock/transfers'),
  createTransfer: (data) => api.post('/stock/transfers', data),
}

// Branches API (stores & warehouses; DELETE archives, never destroys)
export const branchesApi = {
  getAll: () => api.get('/branches'),
  create: (data) => api.post('/branches', data),
  update: (id, data) => api.put(`/branches/${id}`, data),
  archive: (id) => api.delete(`/branches/${id}`),
}

// Suppliers API
export const suppliersApi = {
  getAll: () => api.get('/suppliers'),
  getById: (id) => api.get(`/suppliers/${id}`),
  create: (data) => api.post('/suppliers', data),
  update: (id, data) => api.put(`/suppliers/${id}`, data),
  delete: (id) => api.delete(`/suppliers/${id}`),
}

// Promotions API
export const promotionsApi = {
  getAll: () => api.get('/promotions'),
  validate: (code, orderAmount) => api.post('/promotions/validate', { code, orderAmount }),
  create: (data) => api.post('/promotions', data),
  update: (id, data) => api.put(`/promotions/${id}`, data),
  delete: (id) => api.delete(`/promotions/${id}`),
}

// Reports API
export const reportsApi = {
  getSales: (params) => api.get('/reports/sales', { params }),
  getStock: () => api.get('/reports/stock'),
  getExpenses: (params) => api.get('/reports/expenses', { params }),
  getProfitLoss: (params) => api.get('/reports/profit-loss', { params }),
}

// Settings API
export const settingsApi = {
  get: () => api.get('/settings', { skipAuthRedirect: true }),
  getAll: () => api.get('/settings/all'),
  update: (data) => api.put('/settings', data),
}

// Users API
export const usersApi = {
  getAll: () => api.get('/users', { params: { _: Date.now() } }),
  getById: (id) => api.get(`/users/${id}`),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  toggleActive: (id) => api.patch(`/users/${id}/toggle-active`),
  delete: (id) => api.delete(`/users/${id}`),
}

// Customers API
export const customersApi = {
  getAll: (params) => api.get('/customers', { params }),
  getById: (id) => api.get(`/customers/${id}`),
  create: (data) => api.post('/customers', data),
  update: (id, data) => api.put(`/customers/${id}`, data),
  delete: (id) => api.delete(`/customers/${id}`),
}

// Employees API
export const employeesApi = {
  getAll: () => api.get('/employees'),
  getById: (id) => api.get(`/employees/${id}`),
  create: (data) => api.post('/employees', data),
  update: (id, data) => api.put(`/employees/${id}`, data),
  delete: (id) => api.delete(`/employees/${id}`),
  toggleActive: (id) => api.patch(`/employees/${id}/toggle-active`),
}

// Expenses API
export const expensesApi = {
  getAll: (params) => api.get('/expenses', { params }),
  getSummary: (params) => api.get('/expenses/summary', { params }),
  create: (data) => api.post('/expenses', data),
  update: (id, data) => api.put(`/expenses/${id}`, data),
  delete: (id) => api.delete(`/expenses/${id}`),
}

// Refunds API
export const refundsApi = {
  getAll: () => api.get('/refunds'),
  getById: (id) => api.get(`/refunds/${id}`),
  create: (data) => api.post('/refunds', data),
}

// Email API (promotion sending)
export const emailApi = {
  sendPromotion: (promotionId, options = {}) => api.post('/notifications/promotion', { promotion_id: promotionId, ...options }, { timeout: 30000 }),
  sendPurchaseOrder: (purchaseOrderId, options = {}) =>
    api.post('/notifications/purchase-order', { purchase_order_id: purchaseOrderId, ...options }, { timeout: 30000 }),
}

// Health API
export const healthApi = {
  check: () => api.get('/health', { timeout: 3000 }),
}

// Activities API
export const activitiesApi = {
  getAll: (params) => api.get('/activities', { params }),
  getStats: () => api.get('/activities/stats'),
  create: (data) => api.post('/activities', data),
  cleanup: (days) => api.delete('/activities/cleanup', { params: { days } }),
}

// Accounting API
export const accountsApi = {
  getAll: (params) => api.get('/accounting/accounts', { params }),
  getById: (id) => api.get(`/accounting/accounts/${id}`),
  create: (data) => api.post('/accounting/accounts', data),
  update: (id, data) => api.put(`/accounting/accounts/${id}`, data),
  delete: (id) => api.delete(`/accounting/accounts/${id}`),
  seed: () => api.post('/accounting/accounts/seed'),
  setInitialCapital: (data) => api.post('/accounting/accounts/initial-capital', data),
}

export const journalsApi = {
  getAll: (params) => api.get('/accounting/journals', { params }),
  getById: (id) => api.get(`/accounting/journals/${id}`),
  create: (data) => api.post('/accounting/journals', data),
  reverse: (id) => api.post(`/accounting/journals/${id}/reverse`),
  delete: (id) => api.delete(`/accounting/journals/${id}`),
}

export const accountingReportsApi = {
  getTrialBalance: (params) => api.get('/accounting/reports/trial-balance', { params }),
  getBalanceSheet: (params) => api.get('/accounting/reports/balance-sheet', { params }),
  getProfitLoss: (params) => api.get('/accounting/reports/profit-loss', { params }),
  getAccountLedger: (accountId, params) => api.get(`/accounting/reports/account-ledger/${accountId}`, { params }),
  getFiscalPeriods: () => api.get('/accounting/reports/fiscal-periods'),
  closeFiscalPeriod: (id) => api.post(`/accounting/reports/fiscal-periods/${id}/close`),
}

export const paymentsApi = {
  getAll: (params) => api.get('/accounting/payments', { params }),
  create: (data) => api.post('/accounting/payments', data),
  update: (id, data) => api.put(`/accounting/payments/${id}`, data),
  delete: (id) => api.delete(`/accounting/payments/${id}`),
}

// Sync API (offline order upload)
export const syncOrdersApi = {
  sync: (orderData) => api.post('/sync/order', orderData, { timeout: 30000 }),
  syncBulk: (orders) => api.post('/sync/bulk', { orders }, { timeout: 60000 }),
  getStatus: () => api.get('/sync/status'),
}

// ETA API (Egyptian Tax Authority)
export const etaApi = {
  test: () => api.post('/eta/test'),
  submit: (orderId) => api.post('/eta/submit', { order_id: orderId }),
  getStatus: (etaUUID) => api.get(`/eta/status/${etaUUID}`),
  getQR: (orderId) => api.post('/eta/qr', { order_id: orderId }),
}

// HR: Attendance API
export const attendanceApi = {
  getAll: (params) => api.get('/attendance', { params }),
  getSummary: (employeeId, params) => api.get(`/attendance/summary/${employeeId}`, { params }),
  create: (data) => api.post('/attendance', data),
  clockOut: (id, data) => api.patch(`/attendance/${id}/clock-out`, data),
  update: (id, data) => api.patch(`/attendance/${id}`, data),
  delete: (id) => api.delete(`/attendance/${id}`),
  clockIn: (data) => api.post('/attendance/clock-in', data),
  selfClockOut: (data) => api.post('/attendance/self-clock-out', data),
  breakStart: () => api.post('/attendance/break-start'),
  breakEnd: () => api.post('/attendance/break-end'),
  getDashboard: (params) => api.get('/attendance/dashboard', { params }),
  getMe: () => api.get('/attendance/me'),
}

// HR: Leave API
export const leaveApi = {
  getTypes: () => api.get('/leave/types'),
  createType: (data) => api.post('/leave/types', data),
  updateType: (id, data) => api.put(`/leave/types/${id}`, data),
  getRequests: (params) => api.get('/leave/requests', { params }),
  createRequest: (data) => api.post('/leave/requests', data),
  approveRequest: (id, data) => api.patch(`/leave/requests/${id}/approve`, data),
  deleteRequest: (id) => api.delete(`/leave/requests/${id}`),
  getBalances: (employeeId, params) => api.get(`/leave/balances/${employeeId}`, { params }),
}

// HR: Payroll API
export const payrollApi = {
  getAll: () => api.get('/payroll'),
  getById: (id) => api.get(`/payroll/${id}`),
  process: (data) => api.post('/payroll', data),
  payItem: (id) => api.patch(`/payroll/${id}/pay`),
  delete: (id) => api.delete(`/payroll/${id}`),
}

// HR: Shifts API
export const shiftsApi = {
  getAll: () => api.get('/shifts'),
  create: (data) => api.post('/shifts', data),
  update: (id, data) => api.put(`/shifts/${id}`, data),
  delete: (id) => api.delete(`/shifts/${id}`),
  getAssignments: (params) => api.get('/shifts/assignments', { params }),
  assignShift: (data) => api.post('/shifts/assignments', data),
  bulkAssign: (assignments) => api.post('/shifts/assignments/bulk', { assignments }),
  deleteAssignment: (id) => api.delete(`/shifts/assignments/${id}`),
}

// HR: Performance Reviews API
export const performanceApi = {
  getAll: (params) => api.get('/performance', { params }),
  getById: (id) => api.get(`/performance/${id}`),
  create: (data) => api.post('/performance', data),
  update: (id, data) => api.put(`/performance/${id}`, data),
  delete: (id) => api.delete(`/performance/${id}`),
}

// Services API
export const servicesApi = {
  getAll: () => api.get('/services'),
  getById: (id) => api.get(`/services/${id}`),
  create: (data) => api.post('/services', data),
  update: (id, data) => api.put(`/services/${id}`, data),
  delete: (id) => api.delete(`/services/${id}`),
}

// Service Plans API
export const servicePlansApi = {
  getAll: () => api.get('/service-plans'),
  getById: (id) => api.get(`/service-plans/${id}`),
  create: (data) => api.post('/service-plans', data),
  update: (id, data) => api.put(`/service-plans/${id}`, data),
  delete: (id) => api.delete(`/service-plans/${id}`),
}

// Subscriptions API
export const subscriptionsApi = {
  getAll: (params) => api.get('/subscriptions', { params }),
  getAllPayments: () => api.get('/subscriptions/payments/all'),
  getById: (id) => api.get(`/subscriptions/${id}`),
  create: (data) => api.post('/subscriptions', data),
  quickCreate: (data) => api.post('/subscriptions/quick', data),
  update: (id, data) => api.put(`/subscriptions/${id}`, data),
  delete: (id) => api.delete(`/subscriptions/${id}`),
  cancel: (id) => api.patch(`/subscriptions/${id}/cancel`),
  renew: (id) => api.patch(`/subscriptions/${id}/renew`),
  getPayments: (id) => api.get(`/subscriptions/${id}/payments`),
  recordPayment: (id, data) => api.post(`/subscriptions/${id}/payments`, data),
}

// Super Admin API
export const superAdminApi = {
  getStats: () => api.get('/super-admin/stats'),
  getTenants: (params) => api.get('/super-admin/tenants', { params }),
  getTenant: (id) => api.get(`/super-admin/tenants/${id}`),
  createTenant: (data) => api.post('/super-admin/tenants', data),
  updateTenant: (id, data) => api.put(`/super-admin/tenants/${id}`, data),
  deleteTenant: (id) => api.delete(`/super-admin/tenants/${id}`),
  impersonate: (tenantId) => api.post(`/super-admin/tenants/${tenantId}/impersonate`),
  getPlans: () => api.get('/super-admin/plans'),
  updatePlan: (id, data) => api.put(`/super-admin/plans/${id}`, data),
  getActivity: (params) => api.get('/super-admin/activity', { params }),
  getPayments: (params) => api.get('/super-admin/payments', { params }),
  getAnalytics: (params) => api.get('/super-admin/analytics', { params }),
  getBanners: () => api.get('/super-admin/banners'),
  getWalletPayments: (params) => api.get('/super-admin/wallet', { params }),
  getWalletPendingCount: () => api.get('/super-admin/wallet/pending-count'),
  getWalletPayment: (id) => api.get(`/super-admin/wallet/${id}`),
  confirmWalletPayment: (id) => api.post(`/super-admin/wallet/${id}/confirm`),
  rejectWalletPayment: (id, data) => api.post(`/super-admin/wallet/${id}/reject`, data),
  // Support mailbox (support@dukkanza.com) — flat inbox over Resend's
  // receiving API, plus the panel's own outbound mail in the sent folder.
  getSupportMessages: (params) => api.get('/super-admin/support/messages', { params }),
  getSupportMessage: (id, params) => api.get(`/super-admin/support/messages/${id}`, { params }),
  getSupportAttachment: (id, attachmentId) =>
    api.get(`/super-admin/support/messages/${id}/attachments/${attachmentId}`),
  sendSupportMessage: (data) => api.post('/super-admin/support/send', data),
}

// Billing API
export const billingApi = {
  getPlans: () => api.get('/billing/plans'),
  getCurrent: () => api.get('/billing/current'),
  downgrade: (data) => api.post('/billing/downgrade', data),
}

// Paymob API
export const paymobApi = {
  checkout: (data) => api.post('/billing/paymob/checkout', data),
  verify: (intentionId) => api.get(`/billing/paymob/verify?intention_id=${intentionId}`),
}

// Wallet transfer API — Egyptian wallets (InstaPay, Vodafone Cash, ...):
// receiving numbers + payment-proof submission awaiting superadmin approval.
export const walletApi = {
  getConfig: () => api.get('/billing/wallet/config'),
  getStatus: () => api.get('/billing/wallet/status'),
  // Proofs are up to ~3MB → base64 body; give the upload time to land.
  submit: (data) => api.post('/billing/wallet/submit', data, { timeout: 30000 }),
}

// Cash Shifts API
export const cashShiftsApi = {
  getAll: (params) => api.get('/cash-shifts', { params }),
  getActive: () => api.get('/cash-shifts/active'),
  getActiveStats: () => api.get('/cash-shifts/active/stats'),
  open: (data) => api.post('/cash-shifts', data),
  close: (id, data) => api.patch(`/cash-shifts/${id}/close`, data),
  getById: (id) => api.get(`/cash-shifts/${id}`),
  getOrders: (id) => api.get(`/cash-shifts/${id}/orders`),
  getSummary: () => api.get('/cash-shifts/summary'),
}

// Credit Sales API
export const creditSalesApi = {
  getAll: (params) => api.get('/credit-sales', { params }),
  create: (data) => api.post('/credit-sales', data),
  pay: (id, data) => api.post(`/credit-sales/${id}/pay`, data),
  getByCustomer: (customerId) => api.get(`/credit-sales/customer/${customerId}`),
  getStats: () => api.get('/credit-sales/stats'),
  update: (id, data) => api.patch(`/credit-sales/${id}`, data),
}

// Product Batches API (Expiry Tracking)
export const productBatchesApi = {
  getAll: (params) => api.get('/product-batches', { params }),
  create: (data) => api.post('/product-batches', data),
  update: (id, data) => api.put(`/product-batches/${id}`, data),
  delete: (id) => api.delete(`/product-batches/${id}`),
  getExpiring: () => api.get('/product-batches/expiring'),
  getExpired: () => api.get('/product-batches/expired'),
}

// Purchase Orders API
export const purchaseOrdersApi = {
  getAll: (params) => api.get('/purchase-orders', { params }),
  create: (data) => api.post('/purchase-orders', data),
  getById: (id) => api.get(`/purchase-orders/${id}`),
  update: (id, data) => api.put(`/purchase-orders/${id}`, data),
  receive: (id) => api.patch(`/purchase-orders/${id}/receive`),
  delete: (id) => api.delete(`/purchase-orders/${id}`),
  getStats: () => api.get('/purchase-orders/stats'),
}

// Commissions API
export const commissionsApi = {
  getAll: (params) => api.get('/commissions', { params }),
  getStats: () => api.get('/commissions/stats'),
  getSetupCheck: () => api.get('/commissions/setup-check'),
  getDebug: () => api.get('/commissions/debug'),
  getByEmployee: (employeeId) => api.get(`/commissions/employee/${employeeId}`),
  calculate: (data) => api.post('/commissions/calculate', data),
  approve: (id) => api.patch(`/commissions/${id}/approve`),
  pay: (id) => api.patch(`/commissions/${id}/pay`),
  bulkCalculate: (data) => api.post('/commissions/bulk-calculate', data),
  backfillSalesperson: () => api.post('/commissions/backfill-salesperson'),
}

// Customer Statements API
export const bannersApi = {
  getActive: () => api.get('/banners'),
  getAll: () => api.get('/super-admin/banners'),
  create: (data) => api.post('/super-admin/banners', data),
  update: (id, data) => api.put(`/super-admin/banners/${id}`, data),
  delete: (id) => api.delete(`/super-admin/banners/${id}`),
}

export const customerStatementsApi = {
  getStatement: (customerId, params) => api.get(`/customer-statements/customer/${customerId}`, { params }),
}

// Dead Stock API (extends reportsApi)
export const deadStockApi = {
  get: (params) => api.get('/reports/dead-stock', { params }),
}

export default api
