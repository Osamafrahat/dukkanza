import ErrorBoundary from './components/ErrorBoundary'
import PlanLimitModal from './components/PlanLimitModal'
import ForcePasswordChange from './components/ForcePasswordChange'
import SessionTimeout from './components/SessionTimeout'
import Toast from './components/Toast'
import Layout from './components/layout/Layout'
import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useAppStore } from './stores/appStore'
import { useUserStore } from './stores/userStore'

const LandingPage = lazy(() => import('./pages/LandingPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const POSPage = lazy(() => import('./pages/POSPage'))
const InventoryPage = lazy(() => import('./pages/InventoryPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const SuppliersPage = lazy(() => import('./pages/SuppliersPage'))
const PromotionsPage = lazy(() => import('./pages/PromotionsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const CustomersPage = lazy(() => import('./pages/CustomersPage'))
const EmployeesPage = lazy(() => import('./pages/EmployeesPage'))
const ExpensesPage = lazy(() => import('./pages/ExpensesPage'))
const RefundsPage = lazy(() => import('./pages/RefundsPage'))
const ActivitiesPage = lazy(() => import('./pages/ActivitiesPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const ChartOfAccountsPage = lazy(() => import('./pages/ChartOfAccountsPage'))
const JournalEntriesPage = lazy(() => import('./pages/JournalEntriesPage'))
const AccountingReportsPage = lazy(() => import('./pages/AccountingReportsPage'))
const PaymentsPage = lazy(() => import('./pages/PaymentsPage'))
const InvoicesPage = lazy(() => import('./pages/InvoicesPage'))
const BackupPage = lazy(() => import('./pages/BackupPage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const AttendancePage = lazy(() => import('./pages/AttendancePage'))
const AttendanceDashboard = lazy(() => import('./pages/AttendanceDashboard'))
const LeavePage = lazy(() => import('./pages/LeavePage'))
const LeaveRequestPage = lazy(() => import('./pages/LeaveRequestPage'))
const PayrollPage = lazy(() => import('./pages/PayrollPage'))
const ShiftSchedulingPage = lazy(() => import('./pages/ShiftSchedulingPage'))
const PerformanceReviewsPage = lazy(() => import('./pages/PerformanceReviewsPage'))
const ServicesPage = lazy(() => import('./pages/ServicesPage'))
const ServicePlansPage = lazy(() => import('./pages/ServicePlansPage'))
const SubscriptionsPage = lazy(() => import('./pages/SubscriptionsPage'))
const SignupPage = lazy(() => import('./pages/SignupPage'))
const PricingPage = lazy(() => import('./pages/PricingPage'))
const BillingPage = lazy(() => import('./pages/BillingPage'))
const SuperAdminPage = lazy(() => import('./pages/SuperAdminPage'))
const CashShiftPage = lazy(() => import('./pages/CashShiftPage'))
const CreditSalesPage = lazy(() => import('./pages/CreditSalesPage'))
const PurchaseOrdersPage = lazy(() => import('./pages/PurchaseOrdersPage'))
const ManufacturingPage = lazy(() => import('./pages/ManufacturingPage'))
const BOMPage = lazy(() => import('./pages/BOMPage'))
const BranchesPage = lazy(() => import('./pages/BranchesPage'))
const CommissionsPage = lazy(() => import('./pages/CommissionsPage'))
const DeadStockReportPage = lazy(() => import('./pages/DeadStockReportPage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))
const ContactPage = lazy(() => import('./pages/ContactPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const RefundPolicyPage = lazy(() => import('./pages/RefundPolicyPage'))

function ProtectedRoute({ children }) {
  const isAuthenticated = useUserStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
    </div>
  )
}

function App() {
  const theme = useAppStore((s) => s.theme)
  const settings = useAppStore((s) => s.settings)
  const loadSettings = useAppStore((s) => s.loadSettings)
  const isAuthenticated = useUserStore((s) => s.isAuthenticated)
  const mustChangePassword = useUserStore((s) => s.mustChangePassword)
  const refreshUser = useUserStore((s) => s.refreshUser)
  const setLanguage = useAppStore((s) => s.setLanguage)

  // SEO: the Arabic variant is addressable at /?lang=ar (see hreflang links
  // in index.html and sitemap.xml). Honour the param on boot, app-wide, so
  // crawlers and shared links render the language the URL promises.
  useEffect(() => {
    const lang = new URLSearchParams(window.location.search).get('lang')
    if (lang === 'ar' || lang === 'en') setLanguage(lang)
  }, [setLanguage])

  useEffect(() => {
    if (isAuthenticated) {
      loadSettings()
      refreshUser()
    }
  }, [isAuthenticated, loadSettings, refreshUser])

  useEffect(() => {
    document.title = settings.storeName || 'Dukkanza'
  }, [settings.storeName])

  const showForcePasswordChange = isAuthenticated && mustChangePassword()

  return (
    <div className={theme === 'dark' ? 'dark' : ''}>
<div className="min-h-screen bg-surface-secondary text-foreground">
        <Router>
          <ErrorBoundary>
            <Toast />
            <SessionTimeout />
            <PlanLimitModal />
          </ErrorBoundary>

          {showForcePasswordChange && (
            <ForcePasswordChange />
          )}

          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={
                  isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />
                } />
                <Route path="/forgot-password" element={
                  isAuthenticated ? <Navigate to="/dashboard" replace /> : <ForgotPasswordPage />
                } />
                <Route path="/reset-password" element={
                  isAuthenticated ? <Navigate to="/dashboard" replace /> : <ResetPasswordPage />
                } />
                <Route path="/signup" element={
                  isAuthenticated ? <Navigate to="/dashboard" replace /> : <SignupPage />
                } />
                <Route path="/pricing" element={<PricingPage />} />
                <Route path="/billing" element={<ProtectedRoute><Layout><BillingPage /></Layout></ProtectedRoute>} />
                <Route path="/super-admin" element={<ProtectedRoute><Layout><SuperAdminPage /></Layout></ProtectedRoute>} />

                <Route path="/dashboard" element={<ProtectedRoute><Layout><DashboardPage /></Layout></ProtectedRoute>} />
                <Route path="/pos" element={<ProtectedRoute><Layout><POSPage /></Layout></ProtectedRoute>} />
                <Route path="/inventory" element={<ProtectedRoute><Layout><InventoryPage /></Layout></ProtectedRoute>} />
                <Route path="/reports" element={<ProtectedRoute><Layout><ReportsPage /></Layout></ProtectedRoute>} />
                <Route path="/suppliers" element={<ProtectedRoute><Layout><SuppliersPage /></Layout></ProtectedRoute>} />
                <Route path="/promotions" element={<ProtectedRoute><Layout><PromotionsPage /></Layout></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><Layout><SettingsPage /></Layout></ProtectedRoute>} />
                <Route path="/users" element={<ProtectedRoute><Layout><UsersPage /></Layout></ProtectedRoute>} />
                <Route path="/customers" element={<ProtectedRoute><Layout><CustomersPage /></Layout></ProtectedRoute>} />
                <Route path="/employees" element={<ProtectedRoute><Layout><EmployeesPage /></Layout></ProtectedRoute>} />
                <Route path="/expenses" element={<ProtectedRoute><Layout><ExpensesPage /></Layout></ProtectedRoute>} />
                <Route path="/refunds" element={<ProtectedRoute><Layout><RefundsPage /></Layout></ProtectedRoute>} />
                <Route path="/activities" element={<ProtectedRoute><Layout><ActivitiesPage /></Layout></ProtectedRoute>} />
                <Route path="/profile" element={<ProtectedRoute><Layout><ProfilePage /></Layout></ProtectedRoute>} />
                <Route path="/accounting/accounts" element={<ProtectedRoute><Layout><ChartOfAccountsPage /></Layout></ProtectedRoute>} />
                <Route path="/accounting/journals" element={<ProtectedRoute><Layout><JournalEntriesPage /></Layout></ProtectedRoute>} />
                <Route path="/accounting/reports" element={<ProtectedRoute><Layout><AccountingReportsPage /></Layout></ProtectedRoute>} />
                <Route path="/accounting/payments" element={<ProtectedRoute><Layout><PaymentsPage /></Layout></ProtectedRoute>} />
                <Route path="/invoices" element={<ProtectedRoute><Layout><InvoicesPage /></Layout></ProtectedRoute>} />
                <Route path="/backup" element={<ProtectedRoute><Layout><BackupPage /></Layout></ProtectedRoute>} />
                <Route path="/chat" element={<ProtectedRoute><Layout><ChatPage /></Layout></ProtectedRoute>} />
                <Route path="/hr/attendance" element={<ProtectedRoute><Layout><AttendancePage /></Layout></ProtectedRoute>} />
                <Route path="/hr/attendance-dashboard" element={<ProtectedRoute><Layout><AttendanceDashboard /></Layout></ProtectedRoute>} />
                <Route path="/hr/leave" element={<ProtectedRoute><Layout><LeavePage /></Layout></ProtectedRoute>} />
                <Route path="/hr/leave/request" element={<ProtectedRoute><Layout><LeaveRequestPage /></Layout></ProtectedRoute>} />
                <Route path="/hr/payroll" element={<ProtectedRoute><Layout><PayrollPage /></Layout></ProtectedRoute>} />
                <Route path="/hr/shifts" element={<ProtectedRoute><Layout><ShiftSchedulingPage /></Layout></ProtectedRoute>} />
                <Route path="/hr/shifts/view" element={<ProtectedRoute><Layout><ShiftSchedulingPage readOnly /></Layout></ProtectedRoute>} />
                <Route path="/hr/performance" element={<ProtectedRoute><Layout><PerformanceReviewsPage /></Layout></ProtectedRoute>} />
                <Route path="/services" element={<ProtectedRoute><Layout><ServicesPage /></Layout></ProtectedRoute>} />
                <Route path="/service-plans" element={<ProtectedRoute><Layout><ServicePlansPage /></Layout></ProtectedRoute>} />
                <Route path="/subscriptions" element={<ProtectedRoute><Layout><SubscriptionsPage /></Layout></ProtectedRoute>} />
                <Route path="/cash-shifts" element={<ProtectedRoute><Layout><CashShiftPage /></Layout></ProtectedRoute>} />
                <Route path="/credit-sales" element={<ProtectedRoute><Layout><CreditSalesPage /></Layout></ProtectedRoute>} />
                <Route path="/purchase-orders" element={<ProtectedRoute><Layout><PurchaseOrdersPage /></Layout></ProtectedRoute>} />
<Route path="/manufacturing" element={<ProtectedRoute><Layout><ManufacturingPage /></Layout></ProtectedRoute>} />
<Route path="/manufacturing/boms" element={<ProtectedRoute><Layout><BOMPage /></Layout></ProtectedRoute>} />
                <Route path="/branches" element={<ProtectedRoute><Layout><BranchesPage /></Layout></ProtectedRoute>} />
                <Route path="/commissions" element={<ProtectedRoute><Layout><CommissionsPage /></Layout></ProtectedRoute>} />
                <Route path="/dead-stock" element={<ProtectedRoute><Layout><DeadStockReportPage /></Layout></ProtectedRoute>} />

                {/* Public pages — no auth, no sidebar (same family as /pricing) */}
                <Route path="/about" element={<AboutPage />} />
                <Route path="/contact" element={<ContactPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/refund-policy" element={<RefundPolicyPage />} />

                <Route path="*" element={<Navigate to={isAuthenticated ? '/dashboard' : '/'} replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </Router>
      </div>
    </div>
  )
}

export default App
